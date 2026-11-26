package cn.studyroom;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@EnabledIfEnvironmentVariable(named = "STUDYROOM_INTEGRATION", matches = "true")
@SpringBootTest(properties = {
    "spring.datasource.url=${STUDYROOM_TEST_DB_URL:jdbc:postgresql://127.0.0.1:5433/studyroom_java_test}",
    "studyroom.seed=false", "studyroom.scheduler-enabled=false"
})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
class CreditRoundIntegrationTest {
    @TestConfiguration
    static class TimeConfig {
        @Bean
        @Primary
        MinuteBookingIntegrationTest.TestClock creditTestClock() {
            var time = new MinuteBookingIntegrationTest.TestClock();
            time.set(DAY.atTime(9, 0));
            return time;
        }
    }

    @Autowired Store db;
    @Autowired BookingService bookings;
    @Autowired OpeningScheduleService opening;
    @Autowired AppealService appeals;
    @Autowired AppealReviewService reviews;
    @Autowired ComplaintService complaints;
    @Autowired ComplaintManagementService complaintManagement;
    @Autowired RestrictionWorkflow restrictionWorkflow;
    @Autowired MinuteBookingIntegrationTest.TestClock clock;
    @Autowired MockMvc http;
    @Autowired ObjectMapper json;

    private static final String PASSWORD = "credit-test-only-password";
    private static final LocalDate DAY = LocalDate.now(BookingPolicy.CAMPUS_ZONE).minusDays(1);
    private long admin;
    private long student;
    private long reporter;
    private long seat;
    private String token;

    @BeforeEach
    void fixture() throws Exception {
        TestDatabaseCleanup.clear(db);
        clock.set(DAY.atTime(9, 0));
        String hash = new BCryptPasswordEncoder().encode(PASSWORD);
        admin = account("credit_admin", "admin", hash);
        student = account("credit_student", "student", hash);
        reporter = account("credit_reporter", "student", hash);
        long room = db.insert("INSERT INTO rooms(name,seat_rows,seat_cols) VALUES('信誉分测试空间',1,1)");
        opening.initializeDefaults(room);
        seat = db.insert("INSERT INTO seats(room_id,seat_no,row_no,col_no) VALUES(?,'01',1,1)", room);
        token = json.readTree(http.perform(post("/api/auth/login")
            .with(request -> { request.setRemoteAddr(UUID.randomUUID().toString()); return request; })
            .contentType("application/json")
            .content(json.writeValueAsString(Map.of("username", "credit_student", "password", PASSWORD))))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString())
            .path("data").path("token").asText();
    }

    @Test
    void firstViolationExpiresAtExactlyFifteenDaysAndNextStartsNewRound() throws Exception {
        long reservation = book(student, DAY, "10:00", "10:30");
        var firstTime = DAY.atTime(10, 0);
        assertTrue(eligibility().path("can_book").asBoolean());
        abandon(reservation, firstTime);
        assertCredit(90, 1, firstTime.plusDays(15));
        assertTrue(eligibility().path("can_book").asBoolean());

        http.perform(post("/api/reservations/{id}/abandon", reservation)
            .header("Authorization", "Bearer " + token)).andExpect(status().isConflict());
        assertEquals(1, credit().path("logs").size());

        var reset = firstTime.plusDays(15);
        clock.set(reset.minusDays(1));
        long next = book(student, reset.toLocalDate(), "10:00", "10:30");
        clock.set(reset.minusNanos(1_000));
        assertCredit(90, 1, reset);
        clock.set(reset);
        assertCredit(100, 0, null);
        abandon(next, reset);
        assertCredit(90, 1, reset.plusDays(15));
        assertTrue(eligibility().path("can_book").asBoolean());
    }

    @Test
    void secondViolationBlocksNewBookingsAndLaterMisconductKeepsTheDeadline() throws Exception {
        long first = book(student, DAY, "10:00", "10:30");
        long second = book(student, DAY, "11:00", "11:30");
        long reporterReservation = book(reporter, DAY, "12:00", "13:00");
        abandon(first, DAY.atTime(10, 0));
        var trigger = DAY.atTime(11, 15);
        clock.set(trigger);
        bookings.detail(student, second);
        var deadline = trigger.plusDays(15);
        assertCredit(80, 2, deadline);
        var active = eligibility().path("active_restrictions").get(0);
        assertEquals(2, active.path("automatic_evaluation").path("threshold").asInt());
        assertEquals(360, active.path("automatic_evaluation").path("duration_hours").asInt());
        assertEquals(deadline, localTime(active.path("ends_at")));
        http.perform(post("/api/reservations").header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content(json.writeValueAsString(new Requests.Reservation(seat, DAY.toString(), "14:00", "14:30"))))
            .andExpect(status().isForbidden());

        long filed = verifiedRefusal(reporterReservation);
        assertCredit(70, 3, deadline);
        assertEquals(deadline, localTime(eligibility().path("active_restrictions").get(0).path("ends_at")));
        approve(filed);
        assertCredit(80, 2, deadline);
        assertFalse(eligibility().path("can_book").asBoolean());
        clock.set(deadline);
        assertCredit(100, 0, null);
        assertTrue(eligibility().path("can_book").asBoolean());
    }

    @Test
    void appealRestoresTheSurvivorsOwnDeadlineAndItCanCountWithANewViolation() throws Exception {
        long first = book(student, DAY, "10:00", "10:30");
        long second = book(student, DAY, "11:00", "11:30");
        var firstTime = DAY.atTime(10, 0);
        var secondTime = DAY.atTime(11, 0);
        abandon(first, firstTime);
        abandon(second, secondTime);
        assertCredit(80, 2, secondTime.plusDays(15));

        approve(db.one("SELECT id FROM violations WHERE reservation_id=?", second));
        assertCredit(90, 1, firstTime.plusDays(15));
        assertTrue(eligibility().path("can_book").asBoolean());
        long replacement = book(student, DAY, "13:00", "13:30");
        var replacementTime = DAY.atTime(13, 0);
        abandon(replacement, replacementTime);
        assertCredit(80, 2, replacementTime.plusDays(15));
        assertFalse(eligibility().path("can_book").asBoolean());
    }

    @Test
    void approvingAnAppealFromAnExpiredRoundLeavesTheNewRoundInEffect() throws Exception {
        long first = book(student, DAY, "10:00", "10:30");
        long second = book(student, DAY, "11:00", "11:30");
        var secondTime = DAY.atTime(11, 0);
        abandon(first, DAY.atTime(10, 0));
        abandon(second, secondTime);
        long firstViolation = Store.id(db.one("SELECT id FROM violations WHERE reservation_id=?", first), "id");
        long oldAppeal = submitAppeal(firstViolation);

        var oldDeadline = secondTime.plusDays(15);
        clock.set(oldDeadline);
        assertCredit(100, 0, null);
        long nextFirst = book(student, oldDeadline.toLocalDate(), "12:00", "12:30");
        long nextSecond = book(student, oldDeadline.toLocalDate(), "13:00", "13:30");
        var newTrigger = oldDeadline.toLocalDate().atTime(13, 0);
        abandon(nextFirst, newTrigger.minusHours(1));
        abandon(nextSecond, newTrigger);
        long newRestriction = eligibility().path("active_restrictions").get(0).path("id").asLong();

        approveAppeal(oldAppeal);
        assertEquals("revoked", db.one("SELECT status FROM violations WHERE id=?", firstViolation).get("status"));
        assertCredit(80, 2, newTrigger.plusDays(15));
        var eligibility = eligibility();
        assertFalse(eligibility.path("can_book").asBoolean());
        assertEquals(newRestriction, eligibility.path("active_restrictions").get(0).path("id").asLong());
    }

    private long account(String name, String role, String hash) {
        return db.insert("INSERT INTO users(username,password_hash,role,campus_id) VALUES(?,?,?,?)",
            name, hash, role, name);
    }

    private long book(long user, LocalDate date, String start, String end) {
        return Store.id(bookings.create(user, new Requests.Reservation(seat, date.toString(), start, end)), "id");
    }

    private void abandon(long reservation, LocalDateTime at) throws Exception {
        clock.set(at);
        http.perform(post("/api/reservations/{id}/abandon", reservation)
            .header("Authorization", "Bearer " + token)).andExpect(status().isOk());
    }

    private JsonNode data(String endpoint) throws Exception {
        var response = http.perform(get(endpoint).header("Authorization", "Bearer " + token))
            .andExpect(status().isOk()).andReturn().getResponse();
        return json.readTree(response.getContentAsString()).path("data");
    }

    private JsonNode credit() throws Exception {
        return data("/api/credit");
    }

    private JsonNode eligibility() throws Exception {
        return data("/api/booking-eligibility");
    }

    private void assertCredit(int score, int count, LocalDateTime resetAt) throws Exception {
        var result = credit();
        assertEquals(score, result.path("score").asInt(-1));
        assertEquals(count, result.path("violation_count").asInt(-1));
        assertEquals(10, result.path("deduction_per_violation").asInt());
        if (resetAt == null) assertTrue(result.path("reset_at").isNull());
        else assertEquals(resetAt, localTime(result.path("reset_at")));
    }

    private LocalDateTime localTime(JsonNode value) {
        return java.time.OffsetDateTime.parse(value.asText()).toLocalDateTime();
    }

    private long verifiedRefusal(long reservation) {
        clock.set(DAY.atTime(12, 5));
        long complaint = Store.id(complaints.create(reporter, new Requests.Complaint(
            "occupation", reservation, null, "测试预约被占", List.of(), operation())), "id");
        complaintManagement.accept(admin, complaint, new Requests.ComplaintAccept(1L, operation()));
        clock.set(DAY.atTime(12, 10));
        long event = Store.id(complaintManagement.verify(admin, complaint, new Requests.ComplaintVerification(
            2L, operation(), "verified_refusal", DAY + "T12:04:00+08:00", "已核实", "测试证据",
            student, true, "测试身份", true, true)), "event_id");
        var receipt = restrictionWorkflow.registerManualViolation(admin, event, new Requests.ManualViolation(operation(), "已核实拒不让座"));
        return ((Number) ((Map<?, ?>) receipt.get("violation")).get("id")).longValue();
    }

    private void approve(Map<String, Object> violation) {
        approve(Store.id(violation, "id"));
    }

    private void approve(long violation) {
        approveAppeal(submitAppeal(violation));
    }

    private long submitAppeal(long violation) {
        var receipt = appeals.create(student, violation, new Requests.Appeal(operation(), "测试申诉说明", List.of()));
        return ((Number) ((Map<?, ?>) receipt.get("appeal")).get("id")).longValue();
    }

    private void approveAppeal(long appeal) {
        var review = new Requests.AppealReview(1L, "approved", "核实后撤销", "测试核实依据", true);
        var preview = reviews.preview(admin, appeal, review);
        reviews.confirm(admin, appeal, new Requests.AppealReviewConfirm(review.version(), review.decision(),
            review.reason(), review.verificationNote(), true, preview.get("impact_hash").toString(), operation()));
    }

    private String operation() {
        return UUID.randomUUID().toString();
    }
}
