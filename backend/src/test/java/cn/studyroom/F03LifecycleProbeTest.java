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
 * 课堂验证 2：F03 生命周期两条检查
 *  A) 重复 checkout：实测被前置状态校验拦截（performAction:123 state==checked_in），第二次返回 409，无假成功、无重复结算
 *  B) leave/return 先查库再抛 410（BookingService.action:83-89，不存在/他人预约返回 404/403 而非 410）——P1 证据
 * 只连测试库 studyroom_java_test；不修改任何业务代码。
 */
@EnabledIfEnvironmentVariable(named="STUDYROOM_INTEGRATION",matches="true")
@SpringBootTest(properties={"spring.datasource.url=${STUDYROOM_TEST_DB_URL:jdbc:postgresql://127.0.0.1:5433/studyroom_java_test}","studyroom.seed=false","studyroom.scheduler-enabled=false"})
class F03LifecycleProbeTest {
    @Autowired Store db;
    @Autowired BookingService bookings;
    @Autowired SeatCodeService codes;
    @Autowired ResourceService resources;
    @Autowired Environment env;
    long u1,u2,admin,room,s1;

    @TestConfiguration static class TimeConfig {
        @Bean @Primary Clock fixedClock() { return Clock.fixed(Instant.parse("2026-10-30T01:00:00Z"),ZoneId.of("Asia/Shanghai")); }
    }

    @BeforeEach void setup() {
        assertTrue(env.getProperty("spring.datasource.url","").endsWith("/studyroom_java_test"),"必须使用独立测试库");
        TestDatabaseCleanup.clear(db);
        u1=db.insert("INSERT INTO users(username,password_hash) VALUES('test1','unused')");
        u2=db.insert("INSERT INTO users(username,password_hash) VALUES('test2','unused')");
        admin=db.insert("INSERT INTO users(username,password_hash,role) VALUES('resource-admin','unused','admin')");
        room=Store.id(resources.save(admin,null,new Requests.Room("测试空间","测试楼",null,null,1,2,"测试数据",null,null,true,null,"测试空间初始化")),"id");
        resources.batch(admin,room,new Requests.Batch(1,2,1L,"测试批量座位"));
        db.update("DELETE FROM audit_events");
        var seats=db.list("SELECT * FROM seats ORDER BY id");s1=Store.id(seats.get(0),"id");
    }
    private Requests.Reservation request(long seat,String start,String end) { return new Requests.Reservation(seat,"2026-10-30",start,end); }
    private String seatCode(long seat) {
        if(db.count("SELECT count(*) FROM seat_codes WHERE seat_id=?",seat)==0) codes.generate(admin,seat,new Requests.SeatCodeChange(0L,"测试生成真实座位码"));
        return Store.text(db.one("SELECT code_value FROM seat_codes WHERE seat_id=?",seat),"code_value");
    }

    /** A1：第一次 checkout 应成功结算；第二次 checkout 应 409（重复被前置状态检查拦截） */
    @Test void probeRepeatedCheckout() {
        long id=Store.id(bookings.create(u1,request(s1,"09:00","11:00")),"id"); // start 09:00 = now
        bookings.checkin(u1,id,seatCode(s1));
        var first=bookings.action(u1,id,"checkout");
        System.out.println(">>> first checkout status="+first.status()+" resStatus="+first.data().get("status"));
        var after1=db.one("SELECT status,termination_reason,ended_at FROM reservations WHERE id=?",id);
        System.out.println(">>> after1 status="+after1.get("status")+" reason="+after1.get("termination_reason")+" ended="+after1.get("ended_at"));
        try {
            var second=bookings.action(u1,id,"checkout");
            System.out.println(">>> second checkout status="+second.status());
        } catch(Api.Failure e) {
            System.out.println(">>> second checkout threw status="+e.status+" message="+e.getMessage());
        }
        var usage=db.one("SELECT ended_at,end_reason,settled_at FROM usage_records WHERE reservation_id=?",id);
        System.out.println(">>> usage ended="+usage.get("ended_at")+" reason="+usage.get("end_reason"));
        System.out.println(">>> audit complete count="+db.count("SELECT count(*) FROM audit_events WHERE action='reservation.complete' AND object_type='reservation' AND object_id=CAST(? AS TEXT)",id));
    }

    /** A2：第二次 checkout 应 409（状态已非 checked_in），usage/audit 不再新增 */
    @Test void repeatedCheckoutIsRejectedAndDoesNotChangeFacts() {
        long id=Store.id(bookings.create(u1,request(s1,"09:00","11:00")),"id");
        bookings.checkin(u1,id,seatCode(s1));
        assertEquals(200,bookings.action(u1,id,"checkout").status());
        long usageEndedCount=db.count("SELECT count(*) FROM usage_records WHERE reservation_id=? AND ended_at IS NOT NULL",id);
        long auditCount=db.count("SELECT count(*) FROM audit_events WHERE action='reservation.complete' AND object_type='reservation' AND object_id=CAST(? AS TEXT)",id);
        Api.Failure second=assertThrows(Api.Failure.class,()->bookings.action(u1,id,"checkout"));
        assertEquals(409,second.status);
        System.out.println(">>> second checkout rejected 409, message="+second.getMessage());
        assertEquals(usageEndedCount,db.count("SELECT count(*) FROM usage_records WHERE reservation_id=? AND ended_at IS NOT NULL",id));
        assertEquals(auditCount,db.count("SELECT count(*) FROM audit_events WHERE action='reservation.complete' AND object_type='reservation' AND object_id=CAST(? AS TEXT)",id));
    }

    /** B1：不存在的预约调 leave —— 观察返回 404 还是 410 */
    @Test void probeLeaveOnMissingReservation() {
        try {
            var result=bookings.action(u1,999999,"leave");
            System.out.println(">>> leave missing returned status="+result.status());
        } catch(Api.Failure e) {
            System.out.println(">>> leave missing threw status="+e.status+" message="+e.getMessage());
        }
    }

    /** B2：他人的预约调 leave —— 观察返回 403 还是 410 */
    @Test void probeLeaveOnOthersReservation() {
        long id=Store.id(bookings.create(u1,request(s1,"09:00","11:00")),"id");
        try {
            var result=bookings.action(u2,id,"leave");
            System.out.println(">>> leave others returned status="+result.status());
        } catch(Api.Failure e) {
            System.out.println(">>> leave others threw status="+e.status+" message="+e.getMessage());
        }
        System.out.println(">>> reservation status unchanged="+db.one("SELECT status FROM reservations WHERE id=?",id).get("status"));
    }

    /** B3：自己的预约调 leave —— 预期 410（已退出） */
    @Test void probeLeaveOnOwnReservation() {
        long id=Store.id(bookings.create(u1,request(s1,"09:00","11:00")),"id");
        try {
            var result=bookings.action(u1,id,"leave");
            System.out.println(">>> leave own returned status="+result.status());
        } catch(Api.Failure e) {
            System.out.println(">>> leave own threw status="+e.status+" message="+e.getMessage());
        }
    }
}
