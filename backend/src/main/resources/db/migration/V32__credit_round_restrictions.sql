CREATE TABLE credit_rounds (
 id BIGSERIAL PRIMARY KEY,
 user_id BIGINT NOT NULL REFERENCES users(id),
 started_at TIMESTAMP NOT NULL,
 reset_at TIMESTAMP NOT NULL CHECK(reset_at>started_at),
 closed_at TIMESTAMP CHECK(closed_at>=started_at),
 trigger_restriction_id BIGINT,
 UNIQUE(id,user_id)
);
CREATE UNIQUE INDEX credit_one_open_round_per_user ON credit_rounds(user_id) WHERE closed_at IS NULL;
CREATE INDEX credit_open_round_deadline ON credit_rounds(reset_at,user_id) WHERE closed_at IS NULL;

CREATE TABLE credit_round_violations (
 violation_id BIGINT PRIMARY KEY,
 round_id BIGINT NOT NULL,
 user_id BIGINT NOT NULL,
 effective_at TIMESTAMP NOT NULL,
 UNIQUE(round_id,user_id,violation_id),
 FOREIGN KEY(round_id,user_id) REFERENCES credit_rounds(id,user_id),
 FOREIGN KEY(violation_id,user_id) REFERENCES violations(id,user_id)
);

CREATE TABLE credit_round_events (
 id BIGSERIAL PRIMARY KEY,
 round_id BIGINT NOT NULL,
 user_id BIGINT NOT NULL,
 violation_id BIGINT,
 type VARCHAR(12) NOT NULL CHECK(type IN('violation','appeal','reset')),
 delta INTEGER NOT NULL CHECK(delta BETWEEN -10 AND 100),
 score_after INTEGER NOT NULL CHECK(score_after BETWEEN 0 AND 100),
 reason VARCHAR(160) NOT NULL,
 created_at TIMESTAMP NOT NULL,
 FOREIGN KEY(round_id,user_id) REFERENCES credit_rounds(id,user_id),
 FOREIGN KEY(round_id,user_id,violation_id) REFERENCES credit_round_violations(round_id,user_id,violation_id),
 UNIQUE(violation_id,type),
 CHECK((type='reset' AND violation_id IS NULL AND delta>=0 AND score_after=100)
    OR (type='violation' AND violation_id IS NOT NULL AND delta<=0)
    OR (type='appeal' AND violation_id IS NOT NULL AND delta BETWEEN 0 AND 10))
);
CREATE UNIQUE INDEX credit_one_reset_per_round ON credit_round_events(round_id) WHERE type='reset';
CREATE INDEX credit_events_by_user ON credit_round_events(user_id,created_at DESC,id DESC);

CREATE TABLE credit_restriction_evaluations (
 restriction_id BIGINT PRIMARY KEY,
 round_id BIGINT NOT NULL,
 user_id BIGINT NOT NULL,
 source VARCHAR(20) NOT NULL DEFAULT 'automatic' CHECK(source='automatic'),
 first_violation_id BIGINT NOT NULL,
 second_violation_id BIGINT NOT NULL CHECK(second_violation_id<>first_violation_id),
 window_start TIMESTAMP NOT NULL,
 window_end TIMESTAMP NOT NULL CHECK(window_end>=window_start AND window_end<window_start+INTERVAL '360 hours'),
 source_violations JSONB NOT NULL CHECK(jsonb_typeof(source_violations)='array' AND jsonb_array_length(source_violations)=2),
 FOREIGN KEY(restriction_id,user_id,source) REFERENCES restrictions(id,user_id,source),
 FOREIGN KEY(round_id,user_id,first_violation_id) REFERENCES credit_round_violations(round_id,user_id,violation_id),
 FOREIGN KEY(round_id,user_id,second_violation_id) REFERENCES credit_round_violations(round_id,user_id,violation_id),
 UNIQUE(restriction_id,round_id,user_id)
);
CREATE INDEX credit_restrictions_by_round ON credit_restriction_evaluations(round_id,restriction_id DESC);
ALTER TABLE credit_rounds ADD CONSTRAINT credit_round_current_restriction_fk
 FOREIGN KEY(trigger_restriction_id,id,user_id) REFERENCES credit_restriction_evaluations(restriction_id,round_id,user_id);

CREATE TABLE credit_restriction_recalculations (
 review_id BIGINT NOT NULL,
 restriction_id BIGINT NOT NULL,
 round_id BIGINT NOT NULL,
 user_id BIGINT NOT NULL,
 violation_id BIGINT NOT NULL,
 decision VARCHAR(20) NOT NULL DEFAULT 'approved' CHECK(decision='approved'),
 projection JSONB NOT NULL CHECK(jsonb_typeof(projection)='object'),
 PRIMARY KEY(review_id,restriction_id),
 FOREIGN KEY(review_id,user_id,violation_id,decision) REFERENCES appeal_reviews(id,user_id,violation_id,decision) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(restriction_id,round_id,user_id) REFERENCES credit_restriction_evaluations(restriction_id,round_id,user_id),
 FOREIGN KEY(round_id,user_id,violation_id) REFERENCES credit_round_violations(round_id,user_id,violation_id)
);
CREATE TRIGGER immutable_credit_restriction_evaluation BEFORE UPDATE ON credit_restriction_evaluations
 FOR EACH ROW EXECUTE FUNCTION reject_appeal_review_fact_update();
CREATE TRIGGER immutable_credit_restriction_recalculation BEFORE UPDATE ON credit_restriction_recalculations
 FOR EACH ROW EXECUTE FUNCTION reject_appeal_review_fact_update();

-- Validate the original evidence for both generations without rewriting old records.
CREATE OR REPLACE FUNCTION validate_automatic_restriction_batch() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE batch_id BIGINT; batch_ids BIGINT[]; batch restrictions%ROWTYPE; evaluation restriction_evaluations%ROWTYPE;
 credit_evaluation credit_restriction_evaluations%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='restrictions' THEN
  IF TG_OP='INSERT' THEN batch_ids=ARRAY[NEW.id]; ELSIF TG_OP='DELETE' THEN batch_ids=ARRAY[OLD.id]; ELSE batch_ids=ARRAY[OLD.id,NEW.id]; END IF;
 ELSE
  IF TG_OP='INSERT' THEN batch_ids=ARRAY[NEW.restriction_id]; ELSIF TG_OP='DELETE' THEN batch_ids=ARRAY[OLD.restriction_id]; ELSE batch_ids=ARRAY[OLD.restriction_id,NEW.restriction_id]; END IF;
 END IF;
 FOREACH batch_id IN ARRAY batch_ids LOOP
  SELECT * INTO batch FROM restrictions WHERE id=batch_id;
  IF NOT FOUND THEN CONTINUE; END IF;
  SELECT * INTO evaluation FROM restriction_evaluations WHERE restriction_id=batch_id;
  SELECT * INTO credit_evaluation FROM credit_restriction_evaluations WHERE restriction_id=batch_id;
  IF batch.source='automatic' THEN
   IF credit_evaluation.restriction_id IS NOT NULL THEN
    IF evaluation.restriction_id IS NOT NULL OR credit_evaluation.window_end<>batch.starts_at OR batch.ends_at<>batch.starts_at+INTERVAL '360 hours'
      OR NOT EXISTS(SELECT 1 FROM credit_round_violations WHERE violation_id=credit_evaluation.first_violation_id AND effective_at=credit_evaluation.window_start)
      OR NOT EXISTS(SELECT 1 FROM credit_round_violations WHERE violation_id=credit_evaluation.second_violation_id AND effective_at=credit_evaluation.window_end) THEN
     RAISE EXCEPTION 'credit restriction requires its original two effective violations and 360-hour duration' USING ERRCODE='23514';
    END IF;
   ELSIF evaluation.restriction_id IS NULL OR evaluation.evaluated_at<>batch.starts_at OR batch.ends_at<>batch.starts_at+INTERVAL '168 hours'
     OR (SELECT count(*) FROM restriction_evaluation_sources WHERE restriction_id=batch_id)<>3 THEN
    RAISE EXCEPTION 'automatic restriction requires its original evaluation and exactly three permanent sources' USING ERRCODE='23514';
   END IF;
  ELSIF evaluation.restriction_id IS NOT NULL OR credit_evaluation.restriction_id IS NOT NULL THEN
   RAISE EXCEPTION 'only automatic restrictions can own an evaluation' USING ERRCODE='23514';
  END IF;
 END LOOP;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER credit_evaluation_batch_check AFTER INSERT OR DELETE ON credit_restriction_evaluations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_automatic_restriction_batch();
