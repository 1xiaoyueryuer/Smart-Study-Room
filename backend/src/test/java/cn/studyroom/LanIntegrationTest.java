package cn.studyroom;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.core.env.Environment;
import static org.junit.jupiter.api.Assertions.*;

/** 局域网接入、在线设备与共享看板必须使用独立真实测试库；预约写入仍走 BookingService。 */
@EnabledIfEnvironmentVariable(named="STUDYROOM_INTEGRATION",matches="true")
@SpringBootTest(properties={"spring.datasource.url=${STUDYROOM_TEST_DB_URL:jdbc:postgresql://127.0.0.1:5433/studyroom_java_test}","studyroom.seed=false","studyroom.scheduler-enabled=false","server.address=127.0.0.1","server.ssl.enabled=false"})
class LanIntegrationTest {
    @Autowired Store db;
    @Autowired LanService lan;
    @Autowired ResourceService resources;
    @Autowired BookingService bookings;
    @Autowired Environment env;
    long u1,u2,u3,staff,admin,room,s1,s2;
    @TestConfiguration static class TimeConfig {
        @Bean @Primary Clock fixedClock() { return Clock.fixed(Instant.parse("2026-10-30T01:30:00Z"),ZoneId.of("Asia/Shanghai")); }
    }
    @BeforeEach void setup() {
        assertTrue(env.getProperty("spring.datasource.url","").endsWith("/studyroom_java_test"),"必须使用独立测试库");
        TestDatabaseCleanup.clear(db);
        u1=db.insert("INSERT INTO users(username,password_hash) VALUES('lan-a','unused')");
        u2=db.insert("INSERT INTO users(username,password_hash) VALUES('lan-b','unused')");
        staff=db.insert("INSERT INTO users(username,password_hash,role) VALUES('lan-staff','unused','staff')");
        admin=db.insert("INSERT INTO users(username,password_hash,role) VALUES('lan-admin','unused','admin')");
        room=Store.id(resources.save(admin,null,new Requests.Room("局域网测试空间","图书馆",null,null,1,2,"端到端测试","测试楼","2F",true,null,"测试空间初始化")),"id");
        resources.batch(admin,room,new Requests.Batch(1,2,1L,"测试批量座位"));
        var seats=db.list("SELECT id FROM seats ORDER BY id");s1=Store.id(seats.get(0),"id");s2=Store.id(seats.get(1),"id");
    }
    private Requests.Reservation request(long seat,String start,String end) { return new Requests.Reservation(seat,"2026-10-30",start,end); }
    @SuppressWarnings("unchecked")
    private Map<String,Object> row(Map<String,Object> board,long roomId) {
        return ((List<Map<String,Object>>)board.get("rooms")).stream().filter(item->Store.id(item,"room_id")==roomId).findFirst().orElseThrow();
    }
    @Test void infoDistinguishesLoopbackLanAndPublicClients() {
        var loopback=lan.info("127.0.0.1");
        @SuppressWarnings("unchecked") var loopClient=(Map<String,Object>)loopback.get("client");
        assertEquals("loopback",loopClient.get("access"));
        assertEquals(true,loopClient.get("same_lan"));
        @SuppressWarnings("unchecked") var server=(Map<String,Object>)loopback.get("server");
        assertEquals("127.0.0.1",server.get("bind_address"));
        assertEquals(false,server.get("secure"));
        assertEquals(false,server.get("lan_available"));
        assertEquals(0,((List<?>)loopback.get("links")).size());
        assertTrue(String.valueOf(loopback.get("hint")).contains("server.address=0.0.0.0"));
        @SuppressWarnings("unchecked") var lanClient=(Map<String,Object>)lan.info("192.168.1.23").get("client");
        assertEquals("lan",lanClient.get("access"));
        assertEquals(true,lanClient.get("same_lan"));
        @SuppressWarnings("unchecked") var publicClient=(Map<String,Object>)lan.info("203.0.113.7").get("client");
        assertEquals("other",publicClient.get("access"));
        assertEquals(false,publicClient.get("same_lan"));
    }
    @Test void qrExplainsLoopbackOnlyBinding() {
        var failure=assertThrows(Api.Failure.class,()->lan.qrPng());
        assertEquals(409,failure.status);
        assertTrue(failure.getMessage().contains("server.address=0.0.0.0"));
    }
    @Test void presenceKeepsOnlySessionDigestsAndMasksOtherDevices() {
        lan.touch("token-device-a","192.168.1.10","Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",Map.of("id",u1,"role","student"));
        lan.touch("token-device-b","192.168.1.11","Mozilla/5.0 (Windows NT 10.0; Win64; x64)",Map.of("id",staff,"role","staff"));
        @SuppressWarnings("unchecked") var devices=(List<Map<String,Object>>)lan.devices("token-device-a",false).get("devices");
        assertEquals(2,devices.size());
        var self=devices.stream().filter(row->Boolean.TRUE.equals(row.get("is_self"))).findFirst().orElseThrow();
        assertEquals("192.168.1.10",self.get("remote_address"));
        assertEquals("iPhone",self.get("device"));
        var other=devices.stream().filter(row->!Boolean.TRUE.equals(row.get("is_self"))).findFirst().orElseThrow();
        assertEquals("192.168.1.*",other.get("remote_address"));
        assertEquals("staff",other.get("role"));
        assertFalse(other.containsKey("username"));
        assertFalse(other.containsKey("real_name"));
        assertFalse(devices.toString().contains("token-device"));
        @SuppressWarnings("unchecked") var adminView=(List<Map<String,Object>>)lan.devices(null,true).get("devices");
        assertTrue(adminView.stream().anyMatch(row->"192.168.1.11".equals(row.get("remote_address"))));
        assertEquals(2,lan.devices("token-device-a",false).get("count"));
    }
    @Test void boardAggregatesSharedReservationsAndReleasesCancelledSeats() {
        var first=Store.id(bookings.create(u1,request(s1,"10:00","11:00")),"id");
        bookings.create(u2,request(s2,"10:00","11:00"));
        var board=lan.board("2026-10-30","10:00","11:00");
        assertEquals("2026-10-30",board.get("date"));
        assertEquals("10:00",board.get("start_time"));
        assertEquals("11:00",board.get("end_time"));
        var occupied=row(board,room);
        assertEquals(true,occupied.get("open"));
        assertEquals(2L,((Number)occupied.get("total_seats")).longValue());
        assertEquals(2L,((Number)occupied.get("booked_seats")).longValue());
        assertEquals(0L,((Number)occupied.get("available_seats")).longValue());
        assertEquals(1,((List<?>)board.get("rooms")).size());
        assertTrue(String.valueOf(board.get("shared_note")).contains("同一局域网"));
        bookings.action(u1,first,"cancel");
        var released=row(lan.board("2026-10-30","10:00","11:00"),room);
        assertEquals(1L,((Number)released.get("booked_seats")).longValue());
        assertEquals(1L,((Number)released.get("available_seats")).longValue());
    }
    @Test void boardRejectsDatesOutsideBookingWindow() {
        assertEquals(400,assertThrows(Api.Failure.class,()->lan.board("2026-11-03","10:00","11:00")).status);
        assertEquals(400,assertThrows(Api.Failure.class,()->lan.board("2026-10-30","11:00","10:00")).status);
        assertEquals(400,assertThrows(Api.Failure.class,()->lan.board(null,"10:00","11:00")).status);
    }
    @Test void concurrentDevicesCanOnlyTakeTheSameSeatOnce() throws Exception {
        var devices=new ArrayList<Long>();
        for(int i=0;i<6;i++) devices.add(db.insert("INSERT INTO users(username,password_hash) VALUES(?,'unused')","lan-concurrent-"+i));
        var codes=race(6,i->bookings.create(devices.get(i),request(s1,"10:00","11:00")));
        assertEquals(1,codes.stream().filter(code->code==200).count());
        assertEquals(5,codes.stream().filter(code->code==409).count());
        assertEquals(1,db.count("SELECT count(*) FROM reservations"));
        assertEquals(1L,((Number)row(lan.board("2026-10-30","10:00","11:00"),room).get("booked_seats")).longValue());
    }
    private interface Work { void run(int n); }
    private List<Integer> race(int n,Work work) throws Exception {
        var pool=Executors.newFixedThreadPool(n);
        var start=new CountDownLatch(1);
        var futures=new ArrayList<Future<Integer>>();
        try {
            for(int i=0;i<n;i++) { final int k=i;futures.add(pool.submit(()->{ start.await();try { work.run(k);return 200; }catch(Api.Failure e) { return e.status; } })); }
            start.countDown();
            var codes=new ArrayList<Integer>();
            for(var future:futures) codes.add(future.get(30,TimeUnit.SECONDS));
            return codes;
        } finally { pool.shutdownNow(); }
    }
}
