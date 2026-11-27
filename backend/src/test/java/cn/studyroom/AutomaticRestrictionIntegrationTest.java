package cn.studyroom;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.*;
import org.springframework.boot.test.context.*;
import org.springframework.context.annotation.*;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@EnabledIfEnvironmentVariable(named="STUDYROOM_INTEGRATION",matches="true")
@SpringBootTest(properties={"spring.datasource.url=${STUDYROOM_TEST_DB_URL:jdbc:postgresql://127.0.0.1:5433/studyroom_java_test}","studyroom.seed=false","studyroom.scheduler-enabled=false"})
@AutoConfigureMockMvc(print=MockMvcPrint.NONE)
class AutomaticRestrictionIntegrationTest {
    @TestConfiguration static class TimeConfig { @Bean @Primary MinuteBookingIntegrationTest.TestClock testClock() { var c=new MinuteBookingIntegrationTest.TestClock();c.set(LocalDate.now(BookingPolicy.CAMPUS_ZONE).minusDays(1).atTime(9,0));return c; } }
    @Autowired Store db;
    @Autowired BookingService bookings;
    @Autowired SeatCodeService codes;
    @Autowired OpeningScheduleService opening;
    @Autowired ResourceService resources;
    @Autowired ComplaintService complaints;
    @Autowired ComplaintManagementService management;
    @Autowired ComplaintWorkflowService workflow;
    @Autowired ViolationService violations;
    @Autowired CreditRoundService credit;
    @Autowired RestrictionWorkflow restrictionWorkflow;
    @Autowired RestrictionPolicy restrictionPolicy;
    @Autowired RestrictionActivationRunner restrictionRunner;
    @Autowired AttachmentService attachments;
    @Autowired org.springframework.transaction.support.TransactionTemplate transactions;
    @Autowired MinuteBookingIntegrationTest.TestClock clock;
    @Autowired MockMvc http;
    @Autowired ObjectMapper json;
    @Autowired StringRedisTemplate redis;
    long admin,admin2,student,staff,other,room,seat1,seat2;
    LocalDate base;
    String remote;
    @BeforeEach void fixture() {
        assertEquals("studyroom_java_test",db.one("SELECT current_database() AS name").get("name"));
        TestDatabaseCleanup.clear(db);
        base=LocalDate.now(BookingPolicy.CAMPUS_ZONE).minusDays(1);clock.set(base.atTime(9,0));remote="s20rt-test-"+UUID.randomUUID();
        String hash=new BCryptPasswordEncoder().encode("S02-test-only-password");
        admin=db.insert("INSERT INTO users(username,password_hash,role,campus_id) VALUES('s20rt_admin',?,'admin','S09-admin')",hash);
        admin2=db.insert("INSERT INTO users(username,password_hash,role,campus_id) VALUES('s20rt_admin2',?,'admin','S15-admin2')",hash);
        student=db.insert("INSERT INTO users(username,password_hash,role,campus_id) VALUES('s20rt_student',?,'student','S09-student')",hash);
        staff=db.insert("INSERT INTO users(username,password_hash,role,campus_id) VALUES('s20rt_staff',?,'staff','S09-staff')",hash);
        other=db.insert("INSERT INTO users(username,password_hash,role,campus_id) VALUES('s20rt_other',?,'student','S14-other')",hash);
        db.update("UPDATE users SET real_name='S19模拟管理员甲' WHERE id=?",admin);
        room=db.insert("INSERT INTO rooms(name,seat_rows,seat_cols) VALUES('S14模拟空间',1,2)");opening.initializeDefaults(room);
        seat1=db.insert("INSERT INTO seats(room_id,seat_no,row_no,col_no) VALUES(?,'01',1,1)",room);seat2=db.insert("INSERT INTO seats(room_id,seat_no,row_no,col_no) VALUES(?,'02',1,2)",room);
    }
    @AfterEach void clearRate() { redis.delete("studyroom-java:rate:login:"+remote); }
    void at(int h,int m,int s) { clock.set(base.atTime(h,m,s)); }
    String token(String role) throws Exception {
        var result=http.perform(post("/api/auth/login").with(r->{r.setRemoteAddr(remote);return r;}).contentType("application/json").content(json.writeValueAsString(Map.of("username","s20rt_"+role,"password","S02-test-only-password")))).andExpect(status().isOk()).andReturn();
        return json.readTree(result.getResponse().getContentAsString()).path("data").path("token").asText();
    }
    long reservation(long user,long seat) { return Store.id(bookings.create(user,new Requests.Reservation(seat,base.toString(),"10:00","11:00")),"id"); }
    String code(long seat) { codes.generate(admin,seat,new Requests.SeatCodeChange(0L,"测试实际生成座位码"));return current(seat); }
    String current(long seat) { return Store.text(db.one("SELECT code_value FROM seat_codes WHERE seat_id=?",seat),"code_value"); }
    MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder req,String token) { return req.header("Authorization","Bearer "+token); }
    MockHttpServletRequestBuilder checkin(long id,String code,String token) throws Exception { return auth(post("/api/reservations/"+id+"/checkin"),token).contentType("application/json").content(json.writeValueAsString(Map.of("seat_code",code))); }
    Map<String,Object> row(long id) { return db.one("SELECT * FROM reservations WHERE id=?",id); }



    String key(){return UUID.randomUUID().toString();}
    LocalDateTime now(){return LocalDateTime.ofInstant(clock.instant(),BookingPolicy.CAMPUS_ZONE).truncatedTo(java.time.temporal.ChronoUnit.MICROS);}
    String offset(LocalDateTime t){return t.atZone(BookingPolicy.CAMPUS_ZONE).toOffsetDateTime().toString();}
    Requests.RestrictionCreate create(long user){return new Requests.RestrictionCreate(user,offset(base.plusDays(2).atTime(18,0)),"PUBLIC-S19-REASON 管理限制公开原因","PRIVATE-S19-VERIFICATION 工程模拟核实依据",true,key());}
    Requests.RestrictionRelease release(long id){return new Requests.RestrictionRelease(version(id),"PUBLIC-S19-RELEASE 本条解除原因","PRIVATE-S19-RELEASE 工程模拟解除依据",true,key());}
    @SuppressWarnings("unchecked")Map<String,Object> record(Map<String,Object> receipt){return (Map<String,Object>)receipt.get("restriction");}
    long restriction(Map<String,Object> receipt){return Store.id(record(receipt),"id");}
    long version(long id){return Store.id(db.one("SELECT version FROM restrictions WHERE id=?",id),"version");}
    String state(long id){return Store.text(restrictionPolicy.detail(id,now(),false),"status");}
    Map<String,Object> qualify(long user){return restrictionWorkflow.eligibility(user);}
    long booking(long user,long seat,String start,String end){return Store.id(bookings.create(user,new Requests.Reservation(seat,base.toString(),start,end)),"id");}
    long future(long user){return Store.id(bookings.create(user,new Requests.Reservation(seat2,base.plusDays(1).toString(),"12:00","13:00")),"id");}
    long legacy(long user,LocalDateTime start,LocalDateTime end){db.update("UPDATE users SET credit_banned_until=? WHERE id=?",java.sql.Timestamp.valueOf(end),user);return db.insert("INSERT INTO restrictions(user_id,source,starts_at,ends_at,reason,creator_id,verification_note,facts_confirmed,created_at) VALUES(?,'legacy',?,?,'S19明确工程模拟余期接管，原原因起点未知',NULL,NULL,false,?)",user,java.sql.Timestamp.valueOf(start),java.sql.Timestamp.valueOf(end),java.sql.Timestamp.valueOf(start));}
    String facts(){var all=new LinkedHashMap<String,Object>();for(String table:List.of("credit_rounds","credit_round_violations","credit_round_events","credit_restriction_evaluations","restrictions","restriction_operations","reservations","usage_records","violations","notifications","audit_events","credit_logs","users"))all.put(table,db.list("SELECT to_jsonb(t)::text AS raw FROM "+table+" t ORDER BY to_jsonb(t)::text"));return all.toString();}
    MockHttpServletRequestBuilder body(MockHttpServletRequestBuilder req,Object payload,String token)throws Exception{return auth(req,token).contentType("application/json").content(json.writeValueAsString(payload));}
    String path(long id){return "/api/admin/restrictions/"+id+"/release";}
    long[] pendingAndInUse(){clock.set(base.atTime(8,0));long expired=booking(student,seat2,"09:00","09:30"),used=booking(student,seat1,"10:00","11:00"),pending=booking(student,seat2,"12:00","13:00");String raw=code(seat1);clock.set(base.atTime(10,1));assertEquals(200,bookings.checkin(student,used,raw).status());clock.set(base.atTime(10,5,0,123456000));return new long[]{expired,used,pending};}

    long source(long user,LocalDateTime occurred){
        var start=occurred.minusMinutes(15);long reservation=db.insert("INSERT INTO reservations(user_id,seat_id,res_date,start_time,end_time,status,ended_at,termination_reason) VALUES(?,?,?,CAST(? AS TIME),CAST(? AS TIME),'unused_ended',?,'no_show')",user,seat1,java.sql.Date.valueOf(start.toLocalDate()),start.toLocalTime().toString(),start.plusMinutes(30).toLocalTime().toString(),java.sql.Timestamp.valueOf(occurred));
        return db.insert("INSERT INTO violations(user_id,reservation_id,type,event_key,occurred_at,registered_at,status,reason,source) VALUES(?,?,'no_show',?,?,?,'active','S20明确历史事实工程构型，不以registered代替occurred','automatic')",user,reservation,"unused:"+reservation,java.sql.Timestamp.valueOf(occurred),java.sql.Timestamp.valueOf(now()));
    }
    long currentViolation(long user, LocalDateTime occurred) {
        return transactions.execute(status -> {
            db.lockBookings();
            long id = source(user, occurred);
            credit.recordViolation(user, id, now());
            return id;
        });
    }
    long automatic(long user){return Store.id(db.one("SELECT id FROM restrictions WHERE user_id=? AND source='automatic' ORDER BY id DESC LIMIT 1",user),"id");}
    List<Long> consumed(long id) {
        var evaluation = db.one("SELECT first_violation_id,second_violation_id FROM credit_restriction_evaluations WHERE restriction_id=?", id);
        return List.of(Store.id(evaluation, "first_violation_id"), Store.id(evaluation, "second_violation_id"));
    }
    long automaticCount(long user){return db.count("SELECT count(*) FROM restrictions WHERE user_id=? AND source='automatic'",user);}
    @Test void oldUnconsumedFactsStayHistoricalEvenWithAnIndependentRestriction() {
        long legacy = legacy(student, now(), now().plusDays(2));
        for (int days = 1; days <= 3; days++) source(student, now().minusDays(days));
        assertEquals(false, qualify(student).get("can_book"));
        clock.set(now().plusDays(2));
        assertEquals(true, qualify(student).get("can_book"));
        assertEquals("expired", state(legacy));
        assertEquals(0, automaticCount(student));
        assertEquals(0, db.count("SELECT count(*) FROM credit_round_violations"));
        assertEquals(100, bookings.creditOverview(student).get("score"));
    }

    @Test void sameTimeRegistrationUsesIdOrderAndManualReleaseDoesNotRecreateRestriction() {
        var occurred = now().minusMinutes(1);
        long first = currentViolation(student, occurred);
        long second = currentViolation(student, occurred);
        currentViolation(student, occurred);
        qualify(student);
        long restriction = automatic(student);
        assertEquals(List.of(first, second), consumed(restriction));
        var response = restrictionWorkflow.release(admin, restriction, release(restriction));
        assertEquals(true, ((Map<?,?>) response.get("eligibility")).get("can_book"));
        assertEquals(70, bookings.creditOverview(student).get("score"));
        assertEquals(1, automaticCount(student));
        clock.set(now().plusDays(15));
        assertEquals(100, bookings.creditOverview(student).get("score"));
        assertEquals(1, automaticCount(student));
    }

    @Test void automaticRestrictionStartsAlongsideManualAndLegacyRestrictions() {
        long legacy = legacy(student, now(), now().plusDays(2));
        var request = new Requests.RestrictionCreate(student, offset(now().plusDays(1)),
            "manual public", "private admin self report", true, key());
        long manual = restriction(restrictionWorkflow.create(admin, request));
        currentViolation(student, now().minusDays(2));
        currentViolation(student, now().minusDays(1));
        long automatic = automatic(student);
        assertEquals(now().toString(), restrictionPolicy.required(automatic).get("starts_at"));
        clock.set(now().plusDays(2));
        assertEquals(false, qualify(student).get("can_book"));
        assertEquals("expired", state(manual));
        assertEquals("expired", state(legacy));
        assertEquals("active", state(automatic));
    }

    @Test void restrictionKeepsFrozenSourcesWhileReadingTheirCurrentStatuses() {
        long first = currentViolation(student, now().minusDays(2));
        long second = currentViolation(student, now().minusDays(1));
        qualify(student);
        long restriction = automatic(student);
        restrictionWorkflow.release(admin, restriction, release(restriction));
        db.update("UPDATE violations SET status='revoked' WHERE id=?", first);
        var stored = db.one("SELECT source_violations->0->>'status' AS status FROM credit_restriction_evaluations WHERE restriction_id=?", restriction);
        assertEquals("active", stored.get("status"));
        assertTrue(jsonValue(restrictionPolicy.detail(restriction,now(),false)).contains("revoked"));
        assertEquals(List.of(first, second), consumed(restriction));
    }
    String jsonValue(Object value){try{return json.writeValueAsString(value);}catch(Exception e){throw new IllegalStateException(e);}}
    @Test void disabledOrdinaryAccountAccruesCreditAndAdministratorAccountDoesNot() {
        db.update("UPDATE users SET status='disabled' WHERE id=?", staff);
        for (long user : List.of(staff, admin2)) {
            currentViolation(user, now().minusDays(2));
            currentViolation(user, now().minusDays(1));
        }
        assertEquals("disabled", qualify(staff).get("blocked_by"));
        assertEquals(1, automaticCount(staff));
        assertEquals("role", qualify(admin2).get("blocked_by"));
        assertEquals(0, automaticCount(admin2));
        assertEquals(0, db.count("SELECT count(*) FROM credit_round_violations WHERE user_id=?", admin2));
    }
    @Test void wholeExpiredBatchIsSettledBeforeAnyNewRestrictionCancelsRemainingPending(){clock.set(base.atTime(7,0));long[] ids={booking(student,seat1,"08:00","08:30"),booking(student,seat1,"08:30","09:00"),booking(student,seat1,"09:00","09:30"),booking(student,seat1,"09:30","10:00"),future(student)};clock.set(base.atTime(10,15));bookings.mine(student);assertEquals(4,db.count("SELECT count(*) FROM violations WHERE user_id=?",student));for(int i=0;i<4;i++){assertEquals("unused_ended",row(ids[i]).get("status"));assertEquals("no_show",row(ids[i]).get("termination_reason"));}assertEquals("cancelled",row(ids[4]).get("status"));assertEquals(2,consumed(automatic(student)).size());assertEquals(1,automaticCount(student));}
    @Test void checkedInContinuesToOriginalEndWhileAutomaticCancelsOnlyUnstartedPending(){long used=reservation(student,seat1),pending=future(student);String raw=code(seat1);clock.set(base.atTime(10,1));bookings.checkin(student,used,raw);currentViolation(student,now().minusDays(2));currentViolation(student,now().minusDays(1));qualify(student);assertEquals("checked_in",row(used).get("status"));assertNull(db.one("SELECT ended_at FROM usage_records WHERE reservation_id=?",used).get("ended_at"));assertEquals("cancelled",row(pending).get("status"));clock.set(base.atTime(11,0));bookings.detail(student,used);assertEquals("completed",row(used).get("status"));assertEquals(base+"T11:00",db.one("SELECT ended_at FROM usage_records WHERE reservation_id=?",used).get("ended_at"));assertEquals(2,db.count("SELECT count(*) FROM violations WHERE user_id=?",student));}
    @Test void firstCheckinAssessesBacklogBeforeItCanBecomeUsageAndTyped409Commits()throws Exception{
        String owner=token("student");
        clock.set(base.atTime(8,0));
        booking(student,seat1,"09:00","09:30");
        long id=reservation(student,seat1);
        String raw=code(seat1);
        currentViolation(student,now().minusDays(1));
        clock.set(base.atTime(10,1));
        http.perform(checkin(id,raw,owner)).andExpect(status().isConflict()).andExpect(jsonPath("$.details.status").value("cancelled"));
        assertEquals(0,db.count("SELECT count(*) FROM usage_records"));
        assertEquals(1,automaticCount(student));
    }
    @Test void abandonSecondViolationTriggersSameTransactionAndReturnsItsRealUnusedState(){long id=reservation(student,seat1),pending=future(student);currentViolation(student,now().minusDays(1));clock.set(base.atTime(10,1));var result=bookings.action(student,id,"abandon");assertEquals(200,result.status());assertEquals("unused_ended",result.data().get("status"));assertEquals("cancelled",row(pending).get("status"));assertEquals(2,db.count("SELECT count(*) FROM violations WHERE user_id=?",student));assertEquals(1,automaticCount(student));}
    @Test void newBookingTyped403CommitsEvaluationAndNoShowFacts()throws Exception{String owner=token("student");long id=reservation(student,seat1);currentViolation(student,now().minusDays(1));clock.set(base.atTime(10,15));http.perform(body(post("/api/reservations"),new Requests.Reservation(seat2,base.plusDays(1).toString(),"14:00","15:00"),owner)).andExpect(status().isForbidden()).andExpect(jsonPath("$.details.active_restrictions[0].automatic_evaluation.source_violations.length()").value(2));assertEquals("unused_ended",row(id).get("status"));assertEquals(1,automaticCount(student));}
    @Test void appliedRestrictionStillBlocksBookingsWhenServerClockMovesBack() throws Exception {
        String owner = token("student");
        long missed = reservation(student, seat1);
        long pending = future(student);
        currentViolation(student, now().minusDays(1));

        var appliedAt = base.atTime(10, 15);
        clock.set(appliedAt);
        bookings.tick();
        long restriction = automatic(student);
        assertEquals("unused_ended", row(missed).get("status"));
        assertEquals("cancelled", row(pending).get("status"));
        assertEquals(2, db.count("SELECT count(*) FROM violations WHERE user_id=?", student));
        assertEquals(appliedAt.toString(), restrictionPolicy.required(restriction).get("effects_applied_at"));
        assertEquals(appliedAt.toString(), db.one("SELECT created_at FROM notifications WHERE restriction_id=? AND type='restriction_started'", restriction).get("created_at"));
        String before = facts();

        clock.set(appliedAt.minusMinutes(1));
        http.perform(auth(get("/api/booking-eligibility"), owner)).andExpect(status().isOk())
            .andExpect(jsonPath("$.data.can_book").value(false))
            .andExpect(jsonPath("$.data.active_restrictions[0].id").value(restriction));
        http.perform(body(post("/api/reservations"), new Requests.Reservation(seat2, base.plusDays(1).toString(), "14:00", "15:00"), owner))
            .andExpect(status().isForbidden()).andExpect(jsonPath("$.details.code").value("booking_restricted"));
        assertEquals(before, facts());

        clock.set(appliedAt.plusDays(15));
        assertEquals(true, qualify(student).get("can_book"));
    }
    @Test void availabilityRemainsReadableButReconcilesAllMyDatesAndAssessment()throws Exception{String owner=token("student");long expired=reservation(student,seat1);currentViolation(student,now().minusDays(1));clock.set(base.atTime(10,15));http.perform(auth(get("/api/availability").param("room_id",Long.toString(room)).param("date",base.plusDays(1).toString()),owner)).andExpect(status().isOk());assertEquals("unused_ended",row(expired).get("status"));assertEquals(1,automaticCount(student));}
    @Test void ownerViolationsFirstReadAndRoomSeatMapBothReachSameAssessmentCore(){
        clock.set(base.atTime(8,0));
        long ownerPending=booking(student,seat1,"09:00","09:30"),otherPending=booking(other,seat2,"09:00","09:30");
        currentViolation(student,now().minusDays(1));
        currentViolation(other,now().minusDays(1));
        clock.set(base.atTime(10,0));
        bookings.violationsMine(student);
        assertEquals("unused_ended",row(ownerPending).get("status"));
        assertEquals(1,automaticCount(student));
        resources.seatMap(room,base.toString(),"10:00","11:00");
        assertEquals("unused_ended",row(otherPending).get("status"));
        assertEquals(1,automaticCount(other));
    }
    @Test void startupFindsPendingNoShowAndScheduledTaskSettlesExpiredRound(){
        reservation(student,seat1);
        currentViolation(student,now().minusDays(1));
        clock.set(base.atTime(10,15));
        restrictionRunner.run(new org.springframework.boot.DefaultApplicationArguments(new String[0]));
        assertEquals(1,automaticCount(student));
        clock.set(now().plusDays(15));
        bookings.tick();
        assertEquals(1,db.count("SELECT count(*) FROM credit_round_events WHERE type='reset'"));
        String before=facts();
        bookings.tick();
        assertEquals(before,facts());
    }
    @Test void concurrentQualificationAndTaskCreateOnlyOneBatchAndPermanentSources()throws Exception {
        reservation(student,seat1);
        currentViolation(student,now().minusDays(1));
        clock.set(base.atTime(10,15));
        var pool=Executors.newFixedThreadPool(3);
        var barrier=new CyclicBarrier(3);
        try {
            var a=pool.submit(()->{barrier.await();return qualify(student);});
            var b=pool.submit(()->{barrier.await();bookings.tick();return true;});
            var c=pool.submit(()->{barrier.await();return bookings.violationsMine(student);});
            a.get(20,TimeUnit.SECONDS);
            b.get(20,TimeUnit.SECONDS);
            c.get(20,TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }
        assertEquals(1,automaticCount(student));
        long restriction=automatic(student);
        assertEquals(2,consumed(restriction).size());
        assertEquals(1,db.count("SELECT count(*) FROM notifications WHERE type='restriction_started'"));
        assertEquals(offset(now()),db.one("""
            SELECT source_violations->1->>'notified_at' AS notified_at
            FROM credit_restriction_evaluations WHERE restriction_id=?
            """,restriction).get("notified_at"));
    }
    long refusalSource(){
        long reservation=reservation(other,seat1);clock.set(base.atTime(10,1));long complaint=Store.id(complaints.create(other,new Requests.Complaint("occupation",reservation,null,"S20明确工程模拟第三方占座核实来源",List.of(),key())),"id");management.accept(admin,complaint,new Requests.ComplaintAccept(1L,key()));return Store.id(management.verify(admin,complaint,new Requests.ComplaintVerification(2L,key(),"verified_refusal",offset(now()),"允许主动公开的核实进度","PRIVATE-S20-FACTS",student,true,"PRIVATE-S20-IDENTITY",true,true)),"event_id");
    }
    @Test void manualSecondEventUsesSameTransactionAndSafeSourceDoesNotExposeReporter()throws Exception{
        String adminToken=token("admin"),owner=token("student");long pending=future(student);currentViolation(student,now().minusDays(1));long event=refusalSource();var request=new Requests.ManualViolation(key(),"独立面向被登记人的事实说明");http.perform(body(post("/api/admin/complaint-events/"+event+"/violations"),request,adminToken)).andExpect(status().isOk()).andExpect(jsonPath("$.data.replayed").value(false));assertEquals(1,automaticCount(student));assertEquals("cancelled",row(pending).get("status"));String safe=http.perform(auth(get("/api/restrictions/mine"),owner)).andExpect(status().isOk()).andExpect(jsonPath("$.data.items[0].automatic_evaluation.source_violations[1].source").value("manual")).andExpect(jsonPath("$.data.items[0].automatic_evaluation.source_violations[1].reservation_id").isEmpty()).andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);assertFalse(safe.contains("PRIVATE-S20"));assertFalse(safe.contains("source_event_id"));assertFalse(safe.contains("subject_user_id"));assertFalse(safe.contains("reporter"));String before=facts();http.perform(body(post("/api/admin/complaint-events/"+event+"/violations"),request,adminToken)).andExpect(status().isOk()).andExpect(jsonPath("$.data.replayed").value(true));assertEquals(before,facts());assertEquals(1,automaticCount(student));
    }
    @Test void automaticFailureRollsBackManualSecondViolationNotificationAndRegistrationOperation()throws Exception{
        String adminToken=token("admin");currentViolation(student,now().minusDays(1));long event=refusalSource();String before=facts();db.update("ALTER TABLE credit_restriction_evaluations ADD CONSTRAINT s20_manual_fail CHECK(first_violation_id=0) NOT VALID");try{http.perform(body(post("/api/admin/complaint-events/"+event+"/violations"),new Requests.ManualViolation(key(),"明确工程模拟公开事实"),adminToken)).andExpect(status().isInternalServerError());assertEquals(before,facts());assertEquals(0,db.count("SELECT count(*) FROM violations WHERE source_event_id=?",event));}finally{db.update("ALTER TABLE credit_restriction_evaluations DROP CONSTRAINT s20_manual_fail");}
    }
    @Test void successfulOldRestrictionOperationReplayDoesNotReconcileNewExpiredBookings(){var request=create(student);long id=restriction(restrictionWorkflow.create(admin,request));var released=release(id);restrictionWorkflow.release(admin,id,released);long pending=reservation(student,seat1);currentViolation(student,now().minusDays(1));clock.set(base.atTime(10,15));String before=facts();db.update("ALTER TABLE credit_restriction_evaluations ADD CONSTRAINT s20_replay_fail CHECK(first_violation_id=0) NOT VALID");try{assertEquals(true,restrictionWorkflow.create(admin,request).get("replayed"));assertEquals(true,restrictionWorkflow.release(admin,id,released).get("replayed"));assertEquals(before,facts());assertEquals("pending",row(pending).get("status"));assertEquals(0,automaticCount(student));}finally{db.update("ALTER TABLE credit_restriction_evaluations DROP CONSTRAINT s20_replay_fail");}}
    @org.junit.jupiter.params.ParameterizedTest @org.junit.jupiter.params.provider.ValueSource(strings={"restriction","evaluation","source","notification","audit","cancel"})
    void dependencyFailureRollsBackNewUnusedViolationEvaluationAndAllEffects(String layer)throws Exception{String owner=token("student");long id=reservation(student,seat1),pending=future(student);long first=currentViolation(student,now().minusDays(1));clock.set(base.atTime(10,15));String before=facts();String table=switch(layer){case "restriction"->"restrictions";case "evaluation"->"credit_restriction_evaluations";case "source"->"credit_round_violations";case "notification","cancel"->"notifications";default->"audit_events";};String condition=switch(layer){case "restriction"->"source<>'automatic'";case "evaluation"->"first_violation_id=0";case "source"->"violation_id="+first;case "notification"->"type<>'restriction_started'";case "cancel"->"type<>'restriction_cancelled'";default->"action<>'restriction.automatic_create'";};db.update("ALTER TABLE "+table+" ADD CONSTRAINT s20_fail CHECK("+condition+") NOT VALID");try{http.perform(auth(get("/api/booking-eligibility"),owner)).andExpect(status().isInternalServerError());assertEquals(before,facts());assertEquals("pending",row(id).get("status"));assertEquals("pending",row(pending).get("status"));}finally{db.update("ALTER TABLE "+table+" DROP CONSTRAINT s20_fail");}}
}
