package cn.studyroom;

import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.core.env.Environment;
import static org.junit.jupiter.api.Assertions.*;

/**
 * 课堂验证：abandon 分支没有显式 15 分钟窗口校验（BookingService:108-111 只查 !now.isBefore(start)），
 * 正确性依赖 performAction :95 enforceRestrictions 先结算过期 pending。
 * 本测试验证：已过 start+15m 的 pending 预约调 abandon → 返回 409，且实际被记为 no_show（occurred_at=start+15m）。
 * 只连测试库 studyroom_java_test；不修改任何业务代码。
 */
@EnabledIfEnvironmentVariable(named="STUDYROOM_INTEGRATION",matches="true")
@SpringBootTest(properties={"spring.datasource.url=${STUDYROOM_TEST_DB_URL:jdbc:postgresql://127.0.0.1:5433/studyroom_java_test}","studyroom.seed=false","studyroom.scheduler-enabled=false"})
class AbandonWindowVerificationTest {
    @Autowired Store db;
    @Autowired BookingService bookings;
    @Autowired ResourceService resources;
    @Autowired Environment env;
    long u1,admin,room,s1;

    @TestConfiguration static class TimeConfig {
        @Bean @Primary Clock fixedClock() { return Clock.fixed(Instant.parse("2026-10-30T01:00:00Z"),ZoneId.of("Asia/Shanghai")); }
    }

    @BeforeEach void setup() {
        assertTrue(env.getProperty("spring.datasource.url","").endsWith("/studyroom_java_test"),"必须使用独立测试库");
        TestDatabaseCleanup.clear(db);
        u1=db.insert("INSERT INTO users(username,password_hash) VALUES('test1','unused')");
        admin=db.insert("INSERT INTO users(username,password_hash,role) VALUES('resource-admin','unused','admin')");
        room=Store.id(resources.save(admin,null,new Requests.Room("测试空间","测试楼",null,null,1,2,"测试数据",null,null,true,null,"测试空间初始化")),"id");
        resources.batch(admin,room,new Requests.Batch(1,2,1L,"测试批量座位"));
        db.update("DELETE FROM audit_events");
        var seats=db.list("SELECT * FROM seats ORDER BY id");s1=Store.id(seats.get(0),"id");
    }
    private Requests.Reservation request(long seat,String start,String end) { return new Requests.Reservation(seat,"2026-10-30",start,end); }

    /** 探针：已过 start+15m 的 pending 预约调 abandon —— 看真实行为（409 拦截 or 200 成功） */
    @Test void probeAbandonAfterDeadline() {
        long id=Store.id(bookings.create(u1,request(s1,"10:00","11:00")),"id");
        db.update("UPDATE reservations SET start_time=TIME '08:00',end_time=TIME '09:00' WHERE id=?",id); // 校园时钟 09:00，已过 start+15m(08:15)
        try {
            var result=bookings.action(u1,id,"abandon");
            System.out.println(">>> abandon returned status="+result.status()+" message="+result.message());
        } catch(Api.Failure e) {
            System.out.println(">>> abandon threw status="+e.status+" message="+e.getMessage());
        }
        var row=db.one("SELECT status,termination_reason FROM reservations WHERE id=?",id);
        System.out.println(">>> reservation status="+row.get("status")+" termination_reason="+row.get("termination_reason"));
        System.out.println(">>> violations="+db.count("SELECT count(*) FROM violations WHERE reservation_id=?",id));
        for(var v:db.list("SELECT type,occurred_at FROM violations WHERE reservation_id=?",id)) System.out.println(">>> violation type="+v.get("type")+" occurred_at="+v.get("occurred_at"));
    }

    /** 场景B：窗口内（start 至 start+15m 之间）调 abandon —— 应成功，记 type=abandon，occurred_at=动作时刻 */
    @Test void abandonInsideWindowSucceedsAsAbandon() {
        long id=Store.id(bookings.create(u1,request(s1,"10:00","11:00")),"id");
        db.update("UPDATE reservations SET start_time=TIME '08:50',end_time=TIME '10:00' WHERE id=?",id); // start 08:50 <= now 09:00 < start+15m 09:05
        var result=bookings.action(u1,id,"abandon");
        assertEquals(200,result.status());
        var row=db.one("SELECT status,termination_reason FROM reservations WHERE id=?",id);
        assertEquals("unused_ended",row.get("status"));
        assertEquals("abandon",row.get("termination_reason"));
        var violation=db.one("SELECT type,occurred_at FROM violations WHERE reservation_id=?",id);
        assertEquals("abandon",violation.get("type"));
        assertTrue(violation.get("occurred_at").toString().startsWith("2026-10-30T09:00"),"occurred_at 应为动作时刻，实际="+violation.get("occurred_at"));
    }

    /** 场景C：开始前调 abandon —— 应 409，状态不变 */
    @Test void abandonBeforeStartIsRejected() {
        long id=Store.id(bookings.create(u1,request(s1,"10:00","11:00")),"id"); // now 09:00 < start 10:00
        Api.Failure failure=assertThrows(Api.Failure.class,()->bookings.action(u1,id,"abandon"));
        assertEquals(409,failure.status);
        assertEquals("pending",db.one("SELECT status FROM reservations WHERE id=?",id).get("status"));
        assertEquals(0,db.count("SELECT count(*) FROM violations"));
    }

    /** 场景D：调度器关闭时，过期预约经 bookings.tick 结算为 no_show —— 证明结算路径与 abandon 独立 */
    @Test void tickSettlesExpiredPendingAsNoShowWithoutScheduler() {
        long id=Store.id(bookings.create(u1,request(s1,"10:00","11:00")),"id");
        db.update("UPDATE reservations SET start_time=TIME '08:00',end_time=TIME '09:00' WHERE id=?",id);
        bookings.tick();
        assertEquals("unused_ended",db.one("SELECT status FROM reservations WHERE id=?",id).get("status"));
        assertEquals("no_show",db.one("SELECT termination_reason FROM reservations WHERE id=?",id).get("termination_reason"));
        assertEquals(1,db.count("SELECT count(*) FROM violations WHERE reservation_id=? AND type='no_show'",id));
    }
}
