package cn.studyroom;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.zxing.*;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.qrcode.QRCodeReader;
import java.io.ByteArrayInputStream;
import java.util.*;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.*;
import org.springframework.boot.test.context.*;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** F13：批量补齐缺失座位码；真实 PostgreSQL/Redis，只连接 studyroom_java_test。 */
@EnabledIfEnvironmentVariable(named="STUDYROOM_INTEGRATION",matches="true")
@SpringBootTest(properties={"spring.datasource.url=${STUDYROOM_TEST_DB_URL:jdbc:postgresql://127.0.0.1:5433/studyroom_java_test}","studyroom.seed=false","studyroom.scheduler-enabled=false"})
@AutoConfigureMockMvc(print=MockMvcPrint.NONE)
class BatchSeatCodeIntegrationTest {
    @Autowired Store db;
    @Autowired SeatCodeService codes;
    @Autowired MockMvc http;
    @Autowired ObjectMapper json;
    @Autowired StringRedisTemplate redis;
    long admin,student,staff,room,seat1,seat2,seat3;
    String remote;
    @BeforeEach void fixture() {
        assertEquals("studyroom_java_test",db.one("SELECT current_database() AS name").get("name"));
        TestDatabaseCleanup.clear(db);
        remote="f13-test-"+UUID.randomUUID();
        String hash=new BCryptPasswordEncoder().encode("F13-test-only-password");
        admin=db.insert("INSERT INTO users(username,password_hash,role,campus_id) VALUES('f13_admin',?,'admin','F13-admin')",hash);
        student=db.insert("INSERT INTO users(username,password_hash,role,campus_id) VALUES('f13_student',?,'student','F13-student')",hash);
        staff=db.insert("INSERT INTO users(username,password_hash,role,campus_id) VALUES('f13_staff',?,'staff','F13-staff')",hash);
        room=db.insert("INSERT INTO rooms(name,seat_rows,seat_cols) VALUES('F13模拟空间',1,3)");
        seat1=db.insert("INSERT INTO seats(room_id,seat_no,row_no,col_no) VALUES(?,'01',1,1)",room);
        seat2=db.insert("INSERT INTO seats(room_id,seat_no,row_no,col_no) VALUES(?,'02',1,2)",room);
        seat3=db.insert("INSERT INTO seats(room_id,seat_no,row_no,col_no) VALUES(?,'03',1,3)",room);
    }
    @AfterEach void clearRate() { redis.delete("studyroom-java:rate:login:"+remote); }
    String token(String role) throws Exception {
        var result=http.perform(post("/api/auth/login").with(r->{r.setRemoteAddr(remote);return r;}).contentType("application/json").content(json.writeValueAsString(Map.of("username","f13_"+role,"password","F13-test-only-password")))).andExpect(status().isOk()).andReturn();
        return json.readTree(result.getResponse().getContentAsString()).path("data").path("token").asText();
    }
    String existingCode(long seat) { codes.generate(admin,seat,new Requests.SeatCodeChange(0L,"测试已有座位码"));return current(seat); }
    String current(long seat) { return Store.text(db.one("SELECT code_value FROM seat_codes WHERE seat_id=?",seat),"code_value"); }
    MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder req,String token) { return req.header("Authorization","Bearer "+token); }
    MockHttpServletRequestBuilder batch(String token,String body) throws Exception { return auth(post("/api/admin/seat-codes/batch"),token).contentType("application/json").content(body); }
    static String decode(byte[] png) throws Exception {
        assertArrayEquals(new byte[]{(byte)137,80,78,71,13,10,26,10},Arrays.copyOf(png,8));var image=ImageIO.read(new ByteArrayInputStream(png));
        int width=image.getWidth(),height=image.getHeight();assertEquals(384,width);assertEquals(384,height);var source=new RGBLuminanceSource(width,height,image.getRGB(0,0,width,height,null,0,width));
        try{return new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(source)),Map.of(DecodeHintType.PURE_BARCODE,true)).getText();}finally{image.flush();}
    }
    @Test void batchFillsOnlyMissingSeatsAndGeneratedCodesDriveRealPng() throws Exception {
        String token=token("admin"),existing=existingCode(seat1);
        var response=http.perform(batch(token,"{\"reason\":\"部署前批量补齐缺失座位码\"}")).andExpect(status().isOk())
            .andExpect(jsonPath("$.data.total_seats").value(3)).andExpect(jsonPath("$.data.generated").value(2)).andExpect(jsonPath("$.data.skipped").value(1))
            .andReturn().getResponse().getContentAsString();
        assertFalse(response.contains(existing));assertFalse(response.contains("code_value"));
        assertEquals(3,db.count("SELECT count(*) FROM seat_codes"));
        assertEquals(existing,current(seat1));assertEquals(1,db.count("SELECT version FROM seat_codes WHERE seat_id=?",seat1));
        for(long seat:List.of(seat2,seat3)) {
            String value=current(seat);assertTrue(value.matches("studyroom-seat:v1:[A-Za-z0-9_-]{43}"));
            assertEquals(value,decode(codes.png(admin,seat)));
            assertEquals(1,db.count("SELECT version FROM seat_codes WHERE seat_id=? AND enabled",seat));
        }
        assertEquals(2,db.count("SELECT count(*) FROM audit_events WHERE action='seat_code.batch_generate'"));
        String audit=db.list("SELECT * FROM audit_events").toString();
        assertFalse(audit.contains(current(seat2)));assertFalse(audit.contains(current(seat3)));
    }
    @Test void repeatSkipsEverythingAndDisabledOrMaintenanceSeatsKeepState() throws Exception {
        String token=token("admin");existingCode(seat1);codes.setEnabled(admin,seat1,new Requests.SeatCodeStatus(1L,false,"停用已有码"));
        db.update("UPDATE seats SET status='maintenance' WHERE id=?",seat3);
        http.perform(batch(token,"{\"reason\":\"第一次补齐\"}")).andExpect(status().isOk())
            .andExpect(jsonPath("$.data.generated").value(2)).andExpect(jsonPath("$.data.skipped").value(1));
        assertFalse((Boolean)codes.metadata(admin,seat1).get("enabled"));assertEquals(2,db.count("SELECT version FROM seat_codes WHERE seat_id=?",seat1));
        assertEquals(1,db.count("SELECT count(*) FROM seat_codes WHERE seat_id=? AND enabled",seat3));
        http.perform(batch(token,"{\"reason\":\"重复执行应幂等\"}")).andExpect(status().isOk())
            .andExpect(jsonPath("$.data.total_seats").value(3)).andExpect(jsonPath("$.data.generated").value(0)).andExpect(jsonPath("$.data.skipped").value(3));
        assertEquals(3,db.count("SELECT count(*) FROM seat_codes"));assertEquals(2,db.count("SELECT count(*) FROM audit_events WHERE action='seat_code.batch_generate'"));
        assertFalse((Boolean)codes.metadata(admin,seat1).get("enabled"));
    }
    @Test void nonAdminAndInvalidReasonNeverWrite() throws Exception {
        for(String role:List.of("student","staff")) http.perform(batch(token(role),"{\"reason\":\"越权批量生成\"}")).andExpect(status().isForbidden());
        http.perform(post("/api/admin/seat-codes/batch").contentType("application/json").content("{\"reason\":\"未登录\"}")).andExpect(status().isUnauthorized());
        String token=token("admin");
        for(String body:List.of("{}","{\"reason\":\"\"}","{\"reason\":\"   \"}","{\"reason\":\""+"x".repeat(1001)+"\"}")) http.perform(batch(token,body)).andExpect(status().isBadRequest());
        assertEquals(0,db.count("SELECT count(*) FROM seat_codes"));assertEquals(0,db.count("SELECT count(*) FROM audit_events WHERE action='seat_code.batch_generate'"));
        assertEquals(403,assertThrows(Api.Failure.class,()->codes.batchGenerate(student,new Requests.SeatCodeBatch("越权"))).status);
        assertEquals(400,assertThrows(Api.Failure.class,()->codes.batchGenerate(admin,null)).status);
    }
    @Test void auditFailureRollsBackWholeBatchWithoutPartialCodes() {
        db.update("ALTER TABLE audit_events ADD CONSTRAINT f13_fail CHECK(action<>'seat_code.batch_generate') NOT VALID");
        try {
            assertThrows(DataIntegrityViolationException.class,()->codes.batchGenerate(admin,new Requests.SeatCodeBatch("批量审计故障")));
            assertEquals(0,db.count("SELECT count(*) FROM seat_codes"));
        } finally { db.update("ALTER TABLE audit_events DROP CONSTRAINT f13_fail"); }
    }
    @Test void emptyDatabaseReturnsZeroWithoutAudit() {
        db.update("DELETE FROM seats");
        var result=codes.batchGenerate(admin,new Requests.SeatCodeBatch("无座位时执行"));
        assertEquals(0L,result.get("total_seats"));assertEquals(0L,result.get("generated"));assertEquals(0L,result.get("skipped"));
        assertEquals(0,db.count("SELECT count(*) FROM audit_events WHERE action='seat_code.batch_generate'"));
    }
}
