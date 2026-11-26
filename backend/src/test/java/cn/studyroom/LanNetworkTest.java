package cn.studyroom;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import java.util.List;
import org.junit.jupiter.api.Test;

/** 纯函数测试：不启动 Spring、不连接数据库。 */
class LanNetworkTest {
    @Test void classifiesLoopbackLanAndPublicSources() {
        assertEquals("loopback",LanNetwork.accessKind("127.0.0.1"));
        assertEquals("loopback",LanNetwork.accessKind("::1"));
        assertEquals("loopback",LanNetwork.accessKind("[::1]"));
        assertEquals("lan",LanNetwork.accessKind("192.168.1.23"));
        assertEquals("lan",LanNetwork.accessKind("10.2.3.4"));
        assertEquals("lan",LanNetwork.accessKind("172.16.0.9"));
        assertEquals("lan",LanNetwork.accessKind("fe80::1%eth0"));
        assertEquals("lan",LanNetwork.accessKind("fd12:3456::7"));
        assertEquals("other",LanNetwork.accessKind("203.0.113.7"));
        assertEquals("other",LanNetwork.accessKind("172.32.0.1"));
        assertEquals("other",LanNetwork.accessKind("2001:db8::1"));
        assertEquals("unknown",LanNetwork.accessKind(null));
        assertEquals("unknown",LanNetwork.accessKind(" "));
        assertEquals("unknown",LanNetwork.accessKind("256.256.256.256"));
    }

    @Test void onlyActiveLanBindsProduceReachableLinks() {
        assertFalse(LanNetwork.lanBind("127.0.0.1"));
        assertFalse(LanNetwork.lanBind("::1"));
        assertTrue(LanNetwork.lanBind(""));
        assertTrue(LanNetwork.lanBind("0.0.0.0"));
        assertTrue(LanNetwork.lanBind("192.168.1.50"));
        assertTrue(LanNetwork.links("127.0.0.1",8080).isEmpty());
        List<LanNetwork.Link> links=LanNetwork.links("192.168.1.50",8080);
        assertEquals(1,links.size());
        assertEquals("http://192.168.1.50:8080",links.get(0).url());
        var ipv6=LanNetwork.links("fe80::1",8080);
        assertEquals(1,ipv6.size());
        assertEquals("http://[fe80::1]:8080",ipv6.get(0).url());
    }

    @Test void deviceLabelAndAddressMaskKeepOnlyNeededDetail() {
        assertEquals("iPhone",LanNetwork.deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"));
        assertEquals("iPad",LanNetwork.deviceLabel("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"));
        assertEquals("Android 设备",LanNetwork.deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8)"));
        assertEquals("Windows 设备",LanNetwork.deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"));
        assertEquals("Mac 设备",LanNetwork.deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)"));
        assertEquals("未知设备",LanNetwork.deviceLabel(null));
        assertEquals("其他设备",LanNetwork.deviceLabel("curl/8.0"));
        assertEquals("192.168.1.*",LanNetwork.maskAddress("192.168.1.23"));
        assertEquals("fe80::*",LanNetwork.maskAddress("fe80::1%eth0"));
        assertEquals("",LanNetwork.maskAddress(null));
    }
}
