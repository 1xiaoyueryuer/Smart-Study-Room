package cn.studyroom;

import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** 局域网地址判定、接入地址枚举与设备标识的纯函数；不依赖 Spring、数据库或 Redis。 */
public final class LanNetwork {
    private LanNetwork() {}
    public record Link(String name,String address,String url) {}
    /** 只看私网与回环：公网来源仍可登录，但不视为局域网共同预约场景。 */
    public static boolean isPrivateOrLoopback(String raw) {
        var address=parse(raw);
        return address!=null&&(address.isLoopbackAddress()||address.isSiteLocalAddress()||address.isLinkLocalAddress()||isUniqueLocalIpv6(address));
    }
    public static String accessKind(String raw) {
        var address=parse(raw);
        if(address==null) return "unknown";
        if(address.isLoopbackAddress()) return "loopback";
        return isPrivateOrLoopback(raw)?"lan":"other";
    }
    private static InetAddress parse(String raw) {
        if(raw==null||raw.isBlank()) return null;
        String value=raw.trim();
        int zone=value.indexOf('%');
        if(zone>=0) value=value.substring(0,zone);
        if(value.startsWith("[")&&value.endsWith("]")&&value.length()>2) value=value.substring(1,value.length()-1);
        try { return InetAddress.getByName(value); }
        catch(UnknownHostException e) { return null; }
    }
    private static boolean isUniqueLocalIpv6(InetAddress address) {
        byte[] bytes=address.getAddress();
        return bytes.length==16&&(bytes[0]&0xfe)==0xfc;
    }
    /** 空值、0.0.0.0、:: 表示监听全部网卡；具体回环地址不算局域网监听。 */
    public static boolean lanBind(String bindAddress) {
        String bind=normalizeBind(bindAddress);
        if(bind.isEmpty()||bind.equals("0.0.0.0")||bind.equals("::")) return true;
        var address=parse(bind);
        return address!=null&&!address.isLoopbackAddress();
    }
    public static String normalizeBind(String bindAddress) {
        String bind=bindAddress==null?"":bindAddress.trim();
        if(bind.startsWith("[")&&bind.endsWith("]")&&bind.length()>2) bind=bind.substring(1,bind.length()-1);
        return bind;
    }
    /** 按网卡枚举本机可用的局域网地址；回环监听时返回空列表。 */
    public static List<Link> links(String bindAddress,int port) {
        return links(bindAddress,port,"http");
    }
    /** scheme 只接受 http/https；HTTPS 模式用于手机浏览器的安全上下文与摄像头权限。 */
    public static List<Link> links(String bindAddress,int port,String scheme) {
        String protocol="https".equalsIgnoreCase(scheme)?"https":"http";
        String bind=normalizeBind(bindAddress);
        var links=new ArrayList<Link>();
        if(!lanBind(bind)) return links;
        if(!bind.isEmpty()&&!bind.equals("0.0.0.0")&&!bind.equals("::")) {
            links.add(new Link("配置的监听地址",bind,url(bind,port,protocol)));
            return links;
        }
        Set<String> seen=new LinkedHashSet<>();
        var physical=new ArrayList<Link>();
        var virtual=new ArrayList<Link>();
        try {
            var interfaces=NetworkInterface.getNetworkInterfaces();
            while(interfaces.hasMoreElements()) {
                var network=interfaces.nextElement();
                if(!network.isUp()||network.isLoopback()) continue;
                String name=network.getDisplayName()==null||network.getDisplayName().isBlank()?network.getName():network.getDisplayName();
                var target=virtualName(name)?virtual:physical;
                for(InterfaceAddress interfaceAddress:network.getInterfaceAddresses()) {
                    InetAddress address=interfaceAddress.getAddress();
                    if(address.isLoopbackAddress()||address.isLinkLocalAddress()||address.isMulticastAddress()) continue;
                    if(!address.isSiteLocalAddress()&&!isUniqueLocalIpv6(address)) continue;
                    String host=address.getHostAddress();
                    if(host==null||host.isBlank()||!seen.add(host)) continue;
                    target.add(new Link(name,host,url(host,port,protocol)));
                }
            }
        } catch(SocketException e) { return List.of(); }
        // 同机安装的 VMware / Hyper-V / Docker / WSL 网卡不是其他设备可达的接入地址，仅在没有真实网卡时兜底。
        var chosen=physical.isEmpty()?virtual:physical;
        chosen.sort(Comparator.comparing((Link link)->link.address().contains(":")).thenComparing(Link::address));
        return List.copyOf(chosen);
    }
    private static boolean virtualName(String name) {
        String normalized=name==null?"":name.toLowerCase(java.util.Locale.ROOT);
        return normalized.matches(".*(vmware|virtualbox|hyper-v|vethernet|virtual|docker|wsl|loopback|tap|tun|vpn|tailscale|zerotier|bluetooth|npcap).*");
    }
    private static String url(String address,int port,String scheme) {
        return scheme+"://"+(address.contains(":")?"["+address+"]":address)+":"+port;
    }
    public static String deviceLabel(String userAgent) {
        if(userAgent==null||userAgent.isBlank()) return "未知设备";
        String ua=userAgent.toLowerCase(java.util.Locale.ROOT);
        if(ua.contains("iphone")) return "iPhone";
        if(ua.contains("ipad")) return "iPad";
        if(ua.contains("android")) return "Android 设备";
        if(ua.contains("windows")) return "Windows 设备";
        if(ua.contains("macintosh")||ua.contains("mac os")) return "Mac 设备";
        if(ua.contains("linux")) return "Linux 设备";
        return "其他设备";
    }
    /** 非本人设备的远端地址仅保留网段，避免在共享页面暴露完整内网地址。 */
    public static String maskAddress(String raw) {
        if(raw==null||raw.isBlank()) return "";
        String value=raw.trim();
        int zone=value.indexOf('%');
        if(zone>=0) value=value.substring(0,zone);
        int dot=value.lastIndexOf('.');
        if(dot>0) return value.substring(0,dot)+".*";
        int colon=value.lastIndexOf(':');
        if(colon>0) return value.substring(0,colon)+":*";
        return "***";
    }
}
