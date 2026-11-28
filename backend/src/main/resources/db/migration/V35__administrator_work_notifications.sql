-- Keep administrator targets separate from the owner-bound student notification links.
ALTER TABLE notifications
    ADD COLUMN admin_complaint_id BIGINT,
    ADD COLUMN admin_complaint_event_id BIGINT,
    ADD COLUMN admin_appeal_id BIGINT REFERENCES appeals(id),
    ADD COLUMN admin_complaint_event_type VARCHAR(30) GENERATED ALWAYS AS (
        CASE type WHEN 'admin_complaint_urgent' THEN 'submitted'
                  WHEN 'admin_complaint_returned' THEN 'objected' END
    ) STORED;

ALTER TABLE notifications
    ADD CONSTRAINT notification_admin_complaint_event_fk
        FOREIGN KEY(admin_complaint_event_id,admin_complaint_id,admin_complaint_event_type)
        REFERENCES complaint_events(id,complaint_id,event_type),
    ADD CONSTRAINT notification_admin_target_check CHECK(
        CASE
            WHEN type IN('admin_complaint_urgent','admin_complaint_returned') THEN
                event_key IS NOT NULL AND admin_complaint_id IS NOT NULL
                AND admin_complaint_event_id IS NOT NULL AND admin_appeal_id IS NULL
                AND complaint_id IS NULL AND appeal_id IS NULL AND reservation_id IS NULL
                AND violation_id IS NULL AND restriction_id IS NULL AND review_reservation_id IS NULL
            WHEN type='admin_appeal_submitted' THEN
                event_key IS NOT NULL AND admin_appeal_id IS NOT NULL
                AND admin_complaint_id IS NULL AND admin_complaint_event_id IS NULL
                AND complaint_id IS NULL AND appeal_id IS NULL AND reservation_id IS NULL
                AND violation_id IS NULL AND restriction_id IS NULL AND review_reservation_id IS NULL
            ELSE admin_complaint_id IS NULL AND admin_complaint_event_id IS NULL AND admin_appeal_id IS NULL
        END
    );

ALTER TABLE notifications DROP CONSTRAINT notification_new_event_typed;
ALTER TABLE notifications ADD CONSTRAINT notification_new_event_typed CHECK(event_key IS NULL OR
 (type IN('reservation_success','reservation_cancelled','reservation_checkin','reservation_completed','management_cancelled','restriction_cancelled','reservation_corrected_checkin') AND reservation_id IS NOT NULL) OR
 (type='violation' AND violation_id IS NOT NULL) OR
 (type IN('restriction_started','restriction_released') AND restriction_id IS NOT NULL) OR
 (type IN('complaint_feedback','complaint_auto_closed','complaint_initial_arrangement','complaint_priority_assessed','complaint_service_progress') AND complaint_id IS NOT NULL AND complaint_event_id IS NOT NULL) OR
 (type='appeal_reviewed' AND appeal_id IS NOT NULL) OR
 (type IN('review_replied','review_hidden') AND review_reservation_id IS NOT NULL AND review_operation_id IS NOT NULL) OR
 type IN('admin_complaint_urgent','admin_complaint_returned','admin_appeal_submitted'));

-- Backfill work that still awaits action, retaining the original event's timestamp.
WITH pending_work AS (
    SELECT 'admin_complaint_urgent' AS type, '收到紧急安全报修' AS title,
        '有一条 5 级安全报修等待受理。' AS content, e.created_at,
        c.id AS complaint_id, e.id AS event_id, NULL::BIGINT AS appeal_id
    FROM complaints c JOIN complaint_events e ON e.complaint_id=c.id AND e.event_type='submitted'
    WHERE c.status='submitted' AND c.service_kind='facility_repair' AND c.initial_priority=5
    UNION ALL
    SELECT 'admin_complaint_returned', '工单反馈被退回',
        '提交人对处理结果提出了异议，请继续核查。', e.created_at, c.id, e.id, NULL::BIGINT
    FROM complaints c
    JOIN LATERAL (
        SELECT id,event_type,created_at FROM complaint_events
        WHERE complaint_id=c.id AND event_type IN('feedback','objected')
        ORDER BY id DESC LIMIT 1
    ) e ON e.event_type='objected'
    WHERE c.status='processing'
    UNION ALL
    SELECT 'admin_appeal_submitted', '收到新的违规申诉',
        '有一条违规申诉等待审核。', a.submitted_at, NULL::BIGINT, NULL::BIGINT, a.id
    FROM appeals a WHERE a.status='submitted'
)
INSERT INTO notifications(user_id,type,title,content,created_at,event_key,
    admin_complaint_id,admin_complaint_event_id,admin_appeal_id)
SELECT u.id,w.type,w.title,w.content,w.created_at,w.type||':'||COALESCE(w.event_id,w.appeal_id),
    w.complaint_id,w.event_id,w.appeal_id
FROM pending_work w CROSS JOIN users u
WHERE u.role='admin' AND u.status='active'
ON CONFLICT(user_id,event_key) DO NOTHING;
