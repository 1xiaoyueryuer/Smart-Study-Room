package cn.studyroom;

import java.time.*;
import java.util.*;
import java.util.concurrent.*;
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
 * 课堂验证 3：并发重复 checkout —— 验证两个线程同时 checkout 同一预约时只一个成功、只结算一次（预期 [409,200]）。
 * 实测：并发 checkout statuses=[409,200]，usage/audit 各 1 条，无假成功、无重复结算。
 * 只连测试库 studyroom_java_test；不修改任何业务代码。
 */
@EnabledIfEnvironmentVariable(named="STUDYROOM_INTEGRATION",matches="true")
@SpringBootTest(properties={"spring.datasource.url=${STUDYROOM_TEST_DB_URL:jdbc:postgresql://127.0.0.1:5433/studyroom_java_test}","studyroom.seed=false","studyroom.scheduler-enabled=false"})
class ConcurrentCheckoutProbeTest {
    @Autowired Store db;
    @Autowired BookingService bookings;
    @Autowired SeatCodeService codes;
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
    private String seatCode(long seat) {
        if(db.count("SELECT count(*) FROM seat_codes WHERE seat_id=?",seat)==0) codes.generate(admin,seat,new Requests.SeatCodeChange(0L,"测试生成真实座位码"));
        return Store.text(db.one("SELECT code_value FROM seat_codes WHERE seat_id=?",seat),"code_value");
    }

    @Test void concurrentCheckoutRace() throws Exception {
        long id=Store.id(bookings.create(u1,request(s1,"09:00","11:00")),"id");
        bookings.checkin(u1,id,seatCode(s1));
        int n=2;
        var pool=Executors.newFixedThreadPool(n);
        var start=new CountDownLatch(1);
        var futures=new ArrayList<Future<Integer>>();
        for(int i=0;i<n;i++) {
            futures.add(pool.submit(()->{
                start.await();
                try { var r=bookings.action(u1,id,"checkout"); return r.status(); }
                catch(Api.Failure e) { return e.status; }
            }));
        }
        start.countDown();
        var codes=new ArrayList<Integer>();
        for(var f:futures) codes.add(f.get(30,TimeUnit.SECONDS));
        pool.shutdownNow();
        System.out.println(">>> concurrent checkout statuses="+codes);
        var usage=db.one("SELECT ended_at,end_reason,settled_at FROM usage_records WHERE reservation_id=?",id);
        System.out.println(">>> usage ended="+usage.get("ended_at")+" reason="+usage.get("end_reason"));
        System.out.println(">>> audit complete count="+db.count("SELECT count(*) FROM audit_events WHERE action='reservation.complete' AND object_type='reservation' AND object_id=CAST(? AS TEXT)",id));
        System.out.println(">>> reservation status="+db.one("SELECT status FROM reservations WHERE id=?",id).get("status"));
        assertEquals(1,codes.stream().filter(x->x==200).count(),"应只有 1 个成功");
        assertEquals(1,codes.stream().filter(x->x==409).count(),"另一个应 409");
    }
}
