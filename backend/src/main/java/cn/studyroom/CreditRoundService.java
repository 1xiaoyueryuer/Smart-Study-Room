package cn.studyroom;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import static cn.studyroom.RestrictionPolicy.offset;
import static cn.studyroom.RestrictionPolicy.stamp;

/** Current credit rounds use effective registration time. Historical credit and restrictions remain separate. */
@Service
public class CreditRoundService {
    static final String POLICY_VERSION = "credit_round_v1";
    static final int DEDUCTION = 10;
    static final int THRESHOLD = 2;
    static final int HOURS = 360;
    private static final int FULL_SCORE = 100;
    private static final String RESTRICTION_REASON = "15天内累计两条有效违规，暂停新预约15天";

    private final Store db;
    private final AuditService audit;
    private final ObjectMapper json;

    public CreditRoundService(Store db, AuditService audit, ObjectMapper json) {
        this.db = db;
        this.audit = audit;
        this.json = json;
    }

    @Transactional(propagation=Propagation.MANDATORY)
    public void recordViolation(long user, long violation, LocalDateTime effectiveAt) {
        db.lockBookings();
        var account = db.one("SELECT role FROM users WHERE id=?", user);
        if (!AuthService.isOrdinary(account.get("role"))) return;
        settle(user, effectiveAt);
        var round = openRound(user);
        long roundId = round == null
            ? db.insert("INSERT INTO credit_rounds(user_id,started_at,reset_at) VALUES(?,?,?)",
                user, stamp(effectiveAt), stamp(effectiveAt.plusHours(HOURS)))
            : Store.id(round, "id");
        var prior = activeViolations(roundId);
        db.update("INSERT INTO credit_round_violations(violation_id,round_id,user_id,effective_at) VALUES(?,?,?,?)",
            violation, roundId, user, stamp(effectiveAt));
        int score = score(prior.size() + 1);
        event(roundId, user, violation, "violation", score - score(prior.size()), score, "有效违规扣分", effectiveAt);
        if (round != null && prior.size() == THRESHOLD - 1 && round.get("trigger_restriction_id") == null) {
            trigger(roundId, user, prior.get(0), violation, effectiveAt);
        }
    }

    private void trigger(long round, long user, Map<String,Object> first, long second, LocalDateTime now) {
        long firstId = Store.id(first, "violation_id");
        var starts = time(first, "effective_at");
        var ends = now.plusHours(HOURS);
        long id = db.insert("""
            INSERT INTO restrictions(user_id,source,starts_at,ends_at,reason,created_at)
            VALUES(?,'automatic',?,?,?,?)
            """, user, stamp(now), stamp(ends), RESTRICTION_REASON, stamp(now));
        db.update("""
            INSERT INTO credit_restriction_evaluations(
                restriction_id,round_id,user_id,first_violation_id,second_violation_id,window_start,window_end,source_violations)
            VALUES(?,?,?,?,?,?,?,CAST(? AS JSONB))
            """, id, round, user, firstId, second, stamp(starts), stamp(now),
            serialized(List.of(violationView(firstId, starts), violationView(second, now))));
        db.update("UPDATE credit_rounds SET trigger_restriction_id=?,reset_at=? WHERE id=?", id, stamp(ends), round);
        audit.record(null, "restriction.automatic_create", "restriction", Long.toString(id), RESTRICTION_REASON, Map.of(),
            Map.of("user_id", user, "source", "automatic", "evaluated_at", offset(now), "window_start", offset(starts),
                "window_end", offset(now), "source_violation_ids", List.of(firstId, second), "threshold", THRESHOLD,
                "duration_hours", HOURS));
    }

    @Transactional(propagation=Propagation.MANDATORY)
    public void settle(long user, LocalDateTime now) {
        var round = openRound(user);
        if (round == null || now.isBefore(time(round, "reset_at"))) return;
        close(Store.id(round, "id"), user, time(round, "reset_at"));
    }

    private void close(long round, long user, LocalDateTime at) {
        int before = (int) Store.id(db.one(
            "SELECT score_after FROM credit_round_events WHERE round_id=? ORDER BY id DESC LIMIT 1", round), "score_after");
        db.update("UPDATE credit_rounds SET closed_at=? WHERE id=?", stamp(at), round);
        if (before < FULL_SCORE) event(round, user, null, "reset", FULL_SCORE - before, FULL_SCORE, "信誉分周期结束", at);
    }

    Map<String,Object> overview(long user, LocalDateTime now) {
        var round = openRound(user);
        int count = round == null || !now.isBefore(time(round, "reset_at")) ? 0 : activeViolations(Store.id(round, "id")).size();
        var result = new LinkedHashMap<String,Object>();
        result.put("score", score(count));
        result.put("reset_at", count == 0 ? null : offset(round.get("reset_at")));
        result.put("violation_count", count);
        result.put("deduction_per_violation", DEDUCTION);
        var logs = db.list("""
            SELECT id,delta,score_after,reason,created_at,violation_id,type
            FROM credit_round_events WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 50
            """, user);
        for (var row : logs) row.put("created_at", offset(row.get("created_at")));
        result.put("logs", logs);
        return result;
    }

    Map<String,Object> evaluation(long restriction) {
        var rows = db.list("SELECT * FROM credit_restriction_evaluations WHERE restriction_id=?", restriction);
        if (rows.isEmpty()) return null;
        var evaluation = rows.get(0);
        var result = new LinkedHashMap<String,Object>();
        result.put("policy_version", POLICY_VERSION);
        result.put("evaluated_at", offset(evaluation.get("window_end")));
        result.put("window_start", offset(evaluation.get("window_start")));
        result.put("window_end", offset(evaluation.get("window_end")));
        result.put("window_start_inclusive", true);
        result.put("window_end_inclusive", true);
        result.put("threshold", THRESHOLD);
        result.put("duration_hours", HOURS);
        result.put("source_violations", List.of(
            violationView(Store.id(evaluation, "first_violation_id"), time(evaluation, "window_start")),
            violationView(Store.id(evaluation, "second_violation_id"), time(evaluation, "window_end"))));
        return result;
    }

    Map<String,Object> projectAppeal(long user, long violation, LocalDateTime now) {
        var rows = db.list("""
            SELECT e.*,r.starts_at,r.ends_at,r.released_at
            FROM credit_round_violations v JOIN credit_restriction_evaluations e ON e.round_id=v.round_id
            JOIN restrictions r ON r.id=e.restriction_id
            LEFT JOIN appeal_reviews revoked ON revoked.violation_id=v.violation_id AND revoked.violation_action='revoked'
            WHERE v.violation_id=? AND v.user_id=? AND v.effective_at<r.ends_at
              AND (revoked.id IS NULL OR EXISTS(
                SELECT 1 FROM credit_restriction_recalculations prior
                WHERE prior.review_id=revoked.id AND prior.restriction_id=e.restriction_id
              ))
            ORDER BY e.restriction_id DESC LIMIT 1
            """, violation, user);
        if (rows.isEmpty()) return null;
        var batch = rows.get(0);
        long round = Store.id(batch, "round_id");
        int before = 0;
        int after = 0;
        var sources = new ArrayList<Map<String,Object>>();
        for (var item : violations(round)) {
            long sourceId = Store.id(item, "violation_id");
            var source = violationView(sourceId, time(item, "effective_at"));
            boolean valid = "active".equals(source.get("status"));
            if (valid) before++;
            boolean retained = valid && sourceId != violation;
            if (retained) after++;
            source.put("status_after", retained ? "active" : "revoked");
            sources.add(source);
        }
        String status = batch.get("released_at") != null ? "released"
            : now.isBefore(time(batch, "ends_at")) ? "active" : "expired";
        String outcome = switch (status) {
            case "released" -> "released_recorded";
            case "expired" -> "expired_recorded";
            default -> after < THRESHOLD ? "released" : "retained";
        };
        var result = new LinkedHashMap<String,Object>();
        result.put("policy_version", POLICY_VERSION);
        result.put("restriction_id", batch.get("restriction_id"));
        result.put("status_before", status);
        result.put("status_after", outcome.equals("released") ? "released" : status);
        result.put("outcome", outcome);
        result.put("valid_count_before", before);
        result.put("valid_count_after", after);
        result.put("threshold", THRESHOLD);
        result.put("duration_hours", HOURS);
        result.put("evaluated_at", offset(batch.get("window_end")));
        for (String key : List.of("window_start", "window_end", "starts_at", "ends_at")) result.put(key, offset(batch.get(key)));
        result.put("source_violations", sources);
        return result;
    }

    @Transactional(propagation=Propagation.MANDATORY)
    public void saveAppeal(long review, long user, long violation, Map<String,Object> result) {
        long restriction = Store.id(result, "restriction_id");
        var evaluation = db.one("SELECT round_id FROM credit_restriction_evaluations WHERE restriction_id=?", restriction);
        db.update("""
            INSERT INTO credit_restriction_recalculations(review_id,restriction_id,round_id,user_id,violation_id,projection)
            VALUES(?,?,?,?,?,CAST(? AS JSONB))
            """, review, restriction, Store.id(evaluation, "round_id"), user, violation, serialized(result));
    }

    @Transactional(propagation=Propagation.MANDATORY)
    public void applyAppeal(long user, long violation, LocalDateTime now) {
        var round = openRound(user);
        if (round == null || !now.isBefore(time(round, "reset_at"))) return;
        long roundId = Store.id(round, "id");
        if (db.count("SELECT COUNT(*) FROM credit_round_violations WHERE round_id=? AND violation_id=?", roundId, violation) == 0) return;
        var survivors = activeViolations(roundId);
        int score = score(survivors.size());
        event(roundId, user, violation, "appeal", score - score(survivors.size() + 1), score, "申诉成立，撤销对应扣分", now);
        if (survivors.isEmpty()) {
            db.update("UPDATE credit_rounds SET closed_at=?,trigger_restriction_id=NULL WHERE id=?", stamp(now), roundId);
        } else if (survivors.size() < THRESHOLD) {
            var deadline = time(survivors.get(0), "effective_at").plusHours(HOURS);
            db.update("UPDATE credit_rounds SET reset_at=?,trigger_restriction_id=NULL WHERE id=?", stamp(deadline), roundId);
            if (!now.isBefore(deadline)) close(roundId, user, now);
        }
    }

    Map<String,Object> appealFingerprint(long user, long violation, LocalDateTime now) {
        var round = openRound(user);
        if (round == null) return Map.of();
        var facts = violations(Store.id(round, "id"));
        var result = new LinkedHashMap<String,Object>();
        result.put("current_round", round);
        result.put("expired", !now.isBefore(time(round, "reset_at")));
        result.put("violations", facts);
        var active = facts.stream().filter(row -> "active".equals(row.get("status"))).toList();
        if (active.size() == THRESHOLD && active.stream().anyMatch(row -> Store.id(row, "violation_id") == violation)) {
            var survivor = active.stream().filter(row -> Store.id(row, "violation_id") != violation).findFirst().orElseThrow();
            result.put("survivor_probation_expired", !now.isBefore(time(survivor, "effective_at").plusHours(HOURS)));
        }
        return result;
    }

    private Map<String,Object> openRound(long user) {
        var rows = db.list("SELECT * FROM credit_rounds WHERE user_id=? AND closed_at IS NULL", user);
        return rows.isEmpty() ? null : rows.get(0);
    }

    private List<Map<String,Object>> violations(long round) {
        return db.list("""
            SELECT c.violation_id,c.effective_at,v.status
            FROM credit_round_violations c JOIN violations v ON v.id=c.violation_id
            WHERE c.round_id=? ORDER BY c.effective_at,c.violation_id
            """, round);
    }

    private List<Map<String,Object>> activeViolations(long round) {
        return violations(round).stream().filter(row -> "active".equals(row.get("status"))).toList();
    }

    private Map<String,Object> violationView(long id, LocalDateTime effectiveAt) {
        var source = new LinkedHashMap<>(ViolationService.safeOne(db, id));
        source.put("effective_at", offset(effectiveAt));
        return source;
    }

    private void event(long round, long user, Long violation, String type, int delta, int after, String reason, LocalDateTime at) {
        db.update("""
            INSERT INTO credit_round_events(round_id,user_id,violation_id,type,delta,score_after,reason,created_at)
            VALUES(?,?,?,?,?,?,?,?)
            """, round, user, violation, type, delta, after, reason, stamp(at));
    }

    private static int score(int count) {
        return FULL_SCORE - Math.min(count, FULL_SCORE / DEDUCTION) * DEDUCTION;
    }

    private static LocalDateTime time(Map<String,Object> row, String key) {
        return LocalDateTime.parse(Store.text(row, key));
    }

    private String serialized(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (JsonProcessingException failure) {
            throw new IllegalStateException("无法保存信誉分相关事实", failure);
        }
    }
}
