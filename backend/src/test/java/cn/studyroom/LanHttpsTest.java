package cn.studyroom;

import com.google.zxing.*;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.qrcode.QRCodeReader;
import java.io.ByteArrayInputStream;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/** HTTPS 模式下局域网信息与二维码必须统一使用 https，不启动 Spring 或数据库。 */
class LanHttpsTest {
    @Test void secureInfoAndQrUseHttps() throws Exception {
        var service=new LanService(null,null,null,
                Clock.fixed(Instant.parse("2026-11-26T14:00:00Z"),ZoneOffset.UTC),"192.168.1.50",8443,true);
        var info=service.info("192.168.1.23");
        @SuppressWarnings("unchecked") var server=(Map<String,Object>)info.get("server");
        assertEquals(true,server.get("secure"));
        assertEquals("https://192.168.1.50:8443",info.get("primary_url"));
        @SuppressWarnings("unchecked") var links=(List<Map<String,Object>>)info.get("links");
        assertEquals(1,links.size());
        assertEquals("https://192.168.1.50:8443",links.get(0).get("url"));
        assertEquals("https://192.168.1.50:8443",decode(service.qrPng()));
        assertTrue(String.valueOf(info.get("hint")).contains("HTTPS"));
    }
    private static String decode(byte[] png) throws Exception {
        assertArrayEquals(new byte[]{(byte)137,80,78,71,13,10,26,10},java.util.Arrays.copyOf(png,8));
        var image=ImageIO.read(new ByteArrayInputStream(png));
        int width=image.getWidth(),height=image.getHeight();
        var source=new RGBLuminanceSource(width,height,image.getRGB(0,0,width,height,null,0,width));
        try{return new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(source)),Map.of(DecodeHintType.PURE_BARCODE,true)).getText();}
        finally{image.flush();}
    }
}
