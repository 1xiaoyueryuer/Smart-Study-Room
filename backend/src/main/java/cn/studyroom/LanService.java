package cn.studyroom;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 局域网接入信息、在线设备与共享座位看板。
 * 预约写入仍由 BookingService 唯一承担；本类不新增预约入口，也不复制冲突规则。
 */
@Service
public class LanService {
    public static final int PRESENCE_TTL_SECONDS=90;
    private static final int MAX_PRESENCE=256;
    private static final int MAX_DEVICES=50;
    private static final Logger log=LoggerFactory.getLogger(LanService.class);
    private record Presence(String key,long userId,String role,String access,String device,String remoteAddress,long firstSeen,long lastSeen) {}
    private final Store db;
    private final OpeningScheduleService opening;
    private final BookingPolicy policy;
    private final java.time.Clock clock;
    private final String bindAddress;
    private final int port;
    private final ConcurrentHashMap<String,Presence> presences=new ConcurrentHashMap<>();
    public LanService(Store db,OpeningScheduleService opening,BookingPolicy policy,java.time.Clock clock,
            @Value("${server.address:}") String bindAddress,@Value("${server.port:8080}") int port) {
        this.db=db;this.opening=opening;this.policy=policy;this.clock=clock;this.bindAddress=bindAddress;this.port=port;
    }
    /** 已认证请求刷新在线设备；令牌只以摘要形式留在内存，最长保留90秒。 */
    public void touch(String token,String remoteAddress,String userAgent,Map<String,Object> user) {
        if(token==null||token.isBlank()||user==null) return;
        try {
            String key=key(token);
            long now=clock.millis();
            String access=LanNetwork.accessKind(remoteAddress);
            String device=LanNetwork.deviceLabel(userAgent);
            String address=address(remoteAddress);
            String role=Objects.toString(user.get("role"),"");
            long userId=Store.id(user,"id");
            presences.merge(key,new Presence(key,userId,role,access,device,address,now,now),
                    (old,next)->new Presence(next.key(),next.userId(),next.role(),next.access(),next.device(),next.remoteAddress(),old.firstSeen(),now));
            prune(now);
        } catch(RuntimeException e) { log.debug("局域网在线设备记录失败，不影响本次请求",e); }
    }
    public Map<String,Object> devices(String callerToken,boolean admin) {
        long now=clock.millis();
        prune(now);
        String caller=callerToken==null||callerToken.isBlank()?"":key(callerToken);
        List<Map<String,Object>> rows=presences.values().stream()
                .sorted(Comparator.comparingLong(Presence::lastSeen).reversed())
                .limit(MAX_DEVICES)
                .map(presence->view(presence,caller,admin,now))
                .toList();
        var result=new LinkedHashMap<String,Object>();
        result.put("devices",rows);
        result.put("count",rows.size());
        result.put("presence_ttl_seconds",PRESENCE_TTL_SECONDS);
        result.put("server_now",now());
        return result;
    }
    private Map<String,Object> view(Presence presence,String caller,boolean admin,long now) {
        boolean self=presence.key().equals(caller);
        var item=new LinkedHashMap<String,Object>();
        item.put("id",presence.key().substring(0,10));
        item.put("role",presence.role());
        item.put("access",presence.access());
        item.put("device",presence.device());
        item.put("remote_address",admin||self?presence.remoteAddress():LanNetwork.maskAddress(presence.remoteAddress()));
        item.put("first_seen",instant(presence.firstSeen()));
        item.put("last_seen",instant(presence.lastSeen()));
        item.put("active_seconds",Math.max(0,(now-presence.lastSeen())/1000));
        item.put("is_self",self);
        return item;
    }
    public Map<String,Object> info(String remoteAddress) {
        LocalDateTime now=now();
        String bind=LanNetwork.normalizeBind(bindAddress);
        boolean lanBind=LanNetwork.lanBind(bindAddress);
        List<LanNetwork.Link> links=LanNetwork.links(bindAddress,port);
        String access=LanNetwork.accessKind(remoteAddress);
        var server=new LinkedHashMap<String,Object>();
        server.put("bind_address",bind.isEmpty()?"0.0.0.0":bind);
        server.put("port",port);
        server.put("lan_available",lanBind&&!links.isEmpty());
        server.put("campus_zone",BookingPolicy.CAMPUS_ZONE.getId());
        var client=new LinkedHashMap<String,Object>();
        client.put("access",access);
        client.put("remote_address",address(remoteAddress));
        client.put("same_lan","loopback".equals(access)||"lan".equals(access));
        var result=new LinkedHashMap<String,Object>();
        result.put("server",server);
        result.put("client",client);
        result.put("links",links.stream().map(link->{
            var item=new LinkedHashMap<String,Object>();
            item.put("name",link.name());item.put("address",link.address());item.put("url",link.url());return item;
        }).toList());
        result.put("primary_url",links.isEmpty()?null:links.get(0).url());
        result.put("presence_ttl_seconds",PRESENCE_TTL_SECONDS);
        result.put("server_now",now());
        result.put("hint",hint(lanBind,links));
        return result;
    }
    private String hint(boolean lanBind,List<LanNetwork.Link> links) {
        if(!lanBind) return "当前仅监听本机回环地址。请在本机 .local/application-local.properties 增加 server.address=0.0.0.0 并重启服务，其他设备才能通过局域网访问。";
        if(links.isEmpty()) return "监听已允许局域网访问，但未检测到可用的局域网地址，请确认主机已连接同一 Wi-Fi 或网线。";
        return "同一局域网内的其他设备打开接入地址即可登录同一套系统；所有设备读取同一份座位与预约数据。";
    }
    /** 座位与预约冲突的唯一判定仍在预约提交；看板只做聚合展示，不代替提交校验。 */
    @Transactional(readOnly=true)
    public Map<String,Object> board(String date,String start,String end) {
        Api.require(date!=null&&!date.isBlank()&&start!=null&&!start.isBlank()&&end!=null&&!end.isBlank(),400,"请提供共享看板的日期与起止时间");
        Slot slot=Slot.parse(date,start,end);
        LocalDateTime snapshot=now();
        policy.validateDate(slot.date(),snapshot);
        var booked=new LinkedHashMap<Long,Long>();
        for(var row:db.list("SELECT s.room_id,count(DISTINCT s.id) AS booked_seats FROM reservations rv JOIN seats s ON s.id=rv.seat_id WHERE rv.res_date=? AND rv.status IN('pending','checked_in') AND rv.start_time<CAST(? AS TIME) AND rv.end_time>CAST(? AS TIME) AND s.status='available' GROUP BY s.room_id",
                java.sql.Date.valueOf(slot.date()),slot.endText(),slot.startText())) booked.put(Store.id(row,"room_id"),((Number)row.get("booked_seats")).longValue());
        var rooms=db.list("SELECT r.id,r.name,r.building,r.floor,r.location,r.enabled,(SELECT count(*) FROM seats s WHERE s.room_id=r.id AND s.status='available') AS total_seats FROM rooms r ORDER BY r.building NULLS LAST,r.floor NULLS LAST,r.name,r.id");
        var rows=new ArrayList<Map<String,Object>>();
        for(var room:rooms) {
            long roomId=Store.id(room,"id");
            long total=((Number)room.get("total_seats")).longValue();
            long bookedSeats=booked.getOrDefault(roomId,0L);
            var day=opening.calendar(roomId,slot.date()).day(slot.date(),null);
            var item=new LinkedHashMap<String,Object>();
            item.put("room_id",roomId);
            item.put("name",room.get("name"));
            item.put("building",room.get("building"));
            item.put("floor",room.get("floor"));
            item.put("location",room.get("location"));
            item.put("enabled",room.get("enabled"));
            item.put("open",Boolean.TRUE.equals(room.get("enabled"))&&day.contains(slot));
            item.put("closed_reasons",day.closedReasons());
            item.put("total_seats",total);
            item.put("booked_seats",bookedSeats);
            item.put("available_seats",Math.max(0,total-bookedSeats));
            rows.add(item);
        }
        var result=new LinkedHashMap<String,Object>();
        result.put("date",slot.date().toString());
        result.put("start_time",slot.startText());
        result.put("end_time",slot.endText());
        result.put("campus_zone",BookingPolicy.CAMPUS_ZONE.getId());
        result.put("server_now",now());
        result.put("campus_today",snapshot.toLocalDate().toString());
        result.put("rooms",rows);
        result.put("recent_bookings_10m",db.count("SELECT count(*) FROM reservations WHERE created_at>=? AND status IN('pending','checked_in')",Timestamp.valueOf(snapshot.minusMinutes(10))));
        result.put("shared_note","同一局域网内的设备共用同一份座位与预约数据；提交预约时服务端仍重新校验冲突与资格。");
        return result;
    }
    public byte[] qrPng() {
        var links=LanNetwork.links(bindAddress,port);
        Api.require(!links.isEmpty(),409,"当前服务未监听局域网地址，请设置 server.address=0.0.0.0 后重启");
        return QrImages.png(links.get(0).url(),512);
    }
    @EventListener(ApplicationReadyEvent.class)
    public void announce() {
        String bind=LanNetwork.normalizeBind(bindAddress);
        var links=LanNetwork.links(bindAddress,port);
        if(!LanNetwork.lanBind(bindAddress)) {
            log.info("局域网接入未开启：当前仅监听 {}:{}；多设备访问请在本地配置设置 server.address=0.0.0.0",bind.isEmpty()?"127.0.0.1":bind,port);
            return;
        }
        if(links.isEmpty()) { log.warn("局域网监听已开启（{}:{}），但未检测到可用的局域网地址",bind.isEmpty()?"0.0.0.0":bind,port); return; }
        for(var link:links) log.info("局域网接入：{}  [{}]",link.url(),link.name());
    }
    private void prune(long now) {
        presences.entrySet().removeIf(entry->now-entry.getValue().lastSeen()>PRESENCE_TTL_SECONDS*1000L);
        if(presences.size()<=MAX_PRESENCE) return;
        presences.values().stream().sorted(Comparator.comparingLong(Presence::lastSeen)).limit(presences.size()-MAX_PRESENCE)
                .map(Presence::key).toList().forEach(presences::remove);
    }
    private String instant(long epochMillis) {
        return java.time.Instant.ofEpochMilli(epochMillis).atZone(BookingPolicy.CAMPUS_ZONE).toOffsetDateTime().toString();
    }
    private String key(String token) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8))); }
        catch(NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    private String address(String raw) {
        if(raw==null||raw.isBlank()) return "";
        String value=raw.trim();
        return value.length()>64?value.substring(0,64):value;
    }
    private LocalDateTime now() {
        return LocalDateTime.ofInstant(clock.instant(),BookingPolicy.CAMPUS_ZONE).truncatedTo(ChronoUnit.MICROS);
    }
}
