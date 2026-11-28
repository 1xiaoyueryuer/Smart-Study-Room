package cn.studyroom;

import java.sql.Timestamp;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;

/** One typed message publisher participates in each existing business transaction. */
@Service
@Transactional(propagation=Propagation.MANDATORY)
public class NotificationService {
    private static final Set<String> RESERVATION_TYPES=Set.of("reservation_success","reservation_cancelled","reservation_checkin","reservation_completed","management_cancelled","restriction_cancelled","reservation_corrected_checkin");
    private static final Set<String> TYPES=Set.of("reservation_success","reservation_cancelled","reservation_checkin","reservation_completed","management_cancelled","restriction_cancelled","reservation_corrected_checkin","violation","restriction_started","restriction_released","complaint_feedback","complaint_auto_closed","complaint_initial_arrangement","complaint_priority_assessed","complaint_service_progress","appeal_reviewed","review_replied","review_hidden","checkin_reminder","credit_change","waitlist_promoted","system","admin_complaint_urgent","admin_complaint_returned","admin_appeal_submitted");
    private static final DateTimeFormatter DISPLAY_TIME=DateTimeFormatter.ofPattern("uuuu-MM-dd HH:mm:ss");
    private static final String ADMIN_VISIBLE = "(? OR (admin_complaint_id IS NULL AND admin_appeal_id IS NULL))";
    private static final String VISIBLE_OWNER = " WHERE user_id=? AND created_at<=? AND "+ADMIN_VISIBLE;
    private final Store db;private final AuthService auth;private final Clock clock;
    public NotificationService(Store db,AuthService auth,Clock clock){this.db=db;this.auth=auth;this.clock=clock;}
    public long reservation(long owner,long reservation,Long restriction,String type,String title,String content,LocalDateTime occurred){Api.require(RESERVATION_TYPES.contains(type)&&("restriction_cancelled".equals(type)==(restriction!=null)),400,"预约通知类型或限制关联不正确");return publish(owner,type,title,content,type+":"+reservation,occurred,reservation,null,restriction,null,null,null,null,null);}
    public long violation(long owner,long violation,String title,String content,LocalDateTime occurred){return publish(owner,"violation",title,content,"violation:"+violation,occurred,null,violation,null,null,null,null,null,null);}
    public long restriction(long owner,long restriction,String type,String title,String content,LocalDateTime occurred){Api.require(Set.of("restriction_started","restriction_released").contains(type),400,"限制通知类型不正确");return publish(owner,type,title,content,type+":"+restriction,occurred,null,null,restriction,null,null,null,null,null);}
    public long complaint(long owner,long complaint,long event,String type,String title,String content,LocalDateTime occurred){Api.require(Set.of("complaint_feedback","complaint_auto_closed","complaint_initial_arrangement","complaint_priority_assessed","complaint_service_progress").contains(type),400,"投诉通知类型不正确");return publish(owner,type,title,content,type+":"+event,occurred,null,null,null,complaint,event,null,null,null);}
    public long appeal(long owner,long appeal,String title,String content,LocalDateTime occurred){return publish(owner,"appeal_reviewed",title,content,"appeal_reviewed:"+appeal,occurred,null,null,null,null,null,appeal,null,null);}
    public void urgentComplaint(long complaint,long event,LocalDateTime occurred) {
        alertAdmins("admin_complaint_urgent","收到紧急安全报修","有一条 5 级安全报修等待受理。",event,complaint,event,null,occurred);
    }
    public void returnedComplaint(long complaint,long event,LocalDateTime occurred) {
        alertAdmins("admin_complaint_returned","工单反馈被退回","提交人对处理结果提出了异议，请继续核查。",event,complaint,event,null,occurred);
    }
    public void submittedAppeal(long appeal,LocalDateTime occurred) {
        alertAdmins("admin_appeal_submitted","收到新的违规申诉","有一条违规申诉等待审核。",appeal,null,null,appeal,occurred);
    }
    private void alertAdmins(String type,String title,String content,long source,Long complaint,Long event,Long appeal,LocalDateTime occurred) {
        db.lockBookings();
        db.update("""
            INSERT INTO notifications(user_id,type,title,content,created_at,event_key,
                admin_complaint_id,admin_complaint_event_id,admin_appeal_id)
            SELECT id,?,?,?,?,?,?,?,? FROM users WHERE role='admin' AND status='active'
            ON CONFLICT(user_id,event_key) DO NOTHING
            """,type,title,content,Timestamp.valueOf(occurred.truncatedTo(ChronoUnit.MICROS)),
            type+":"+source,complaint,event,appeal);
    }
    static String displayTime(LocalDateTime value) {
        return value.format(DISPLAY_TIME);
    }
    public long review(long owner,long reservation,String operation,String type,String title,String content,LocalDateTime occurred){Api.require(Set.of("review_replied","review_hidden").contains(type),400,"评价通知类型不正确");operation=AttachmentService.uuid(operation,"review_operation_id");return publish(owner,type,title,content,type+":"+operation,occurred,null,null,null,null,null,null,reservation,operation);}
    private long publish(long owner,String type,String title,String content,String key,LocalDateTime occurred,Long reservation,Long violation,Long restriction,Long complaint,Long event,Long appeal,Long reviewReservation,String reviewOperation){
        db.lockBookings();Api.require(owner>0&&title!=null&&!title.isBlank()&&content!=null&&occurred!=null,400,"通知缺少实际事件信息");var old=db.list("SELECT * FROM notifications WHERE user_id=? AND event_key=?",owner,key);if(!old.isEmpty()){var row=old.get(0);Map<String,Object> expected=new LinkedHashMap<>();expected.put("type",type);expected.put("title",title);expected.put("content",content);expected.put("reservation_id",reservation);expected.put("violation_id",violation);expected.put("restriction_id",restriction);expected.put("complaint_id",complaint);expected.put("complaint_event_id",event);expected.put("appeal_id",appeal);expected.put("review_reservation_id",reviewReservation);expected.put("review_operation_id",reviewOperation);for(var field:expected.entrySet())Api.require(Objects.equals(Objects.toString(row.get(field.getKey()),null),Objects.toString(field.getValue(),null)),409,"同一通知事件的对象或内容不一致，未发布新消息");return Store.id(row,"id");}
        return db.insert("INSERT INTO notifications(user_id,type,title,content,created_at,event_key,reservation_id,violation_id,restriction_id,complaint_id,complaint_event_id,appeal_id,review_reservation_id,review_operation_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,CAST(? AS UUID))",owner,type,title,content,Timestamp.valueOf(occurred.truncatedTo(ChronoUnit.MICROS)),key,reservation,violation,restriction,complaint,event,appeal,reviewReservation,reviewOperation);
    }
    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    public Map<String,Object> list(long actor,Map<String,String> parameters) {
        boolean admin = activeAdmin(actor);
        Api.require(Set.of("page","page_size","type","types","is_read").containsAll(parameters.keySet()),400,"通知查询包含不允许的参数");
        int page = number(parameters.getOrDefault("page","1"));
        int size = number(parameters.getOrDefault("page_size","20"));
        Api.require(size<=50,400,"每页最多50条");
        String type = parameters.get("type");
        String groupedTypes = parameters.get("types");
        String read = parameters.get("is_read");
        Api.require(type==null||TYPES.contains(type),400,"通知类型筛选无效");
        List<String> types = groupedTypes==null ? List.of() : List.of(groupedTypes.split(",",-1));
        Api.require(groupedTypes==null || (type==null && types.size()<=TYPES.size() && TYPES.containsAll(types)),400,"通知类型筛选无效");
        Api.require(read==null||Set.of("true","false").contains(read),400,"已读筛选须为true或false");

        LocalDateTime snapshot = now();
        Timestamp cutoff = Timestamp.valueOf(snapshot);
        var where = new StringBuilder(VISIBLE_OWNER);
        var args = new ArrayList<Object>(List.of(actor, cutoff, admin));
        if (type != null) {
            where.append(" AND type=?");
            args.add(type);
        }
        if (!types.isEmpty()) {
            where.append(" AND type IN (").append(String.join(",",Collections.nCopies(types.size(),"?"))).append(")");
            args.addAll(types);
        }
        if (read != null) {
            where.append(" AND is_read=?");
            args.add(Boolean.valueOf(read));
        }
        long total = db.count("SELECT count(*) FROM notifications" + where, args.toArray());
        args.add(size);
        args.add((long) (page - 1) * size);
        var items = db.list("SELECT * FROM notifications" + where + " ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",
            args.toArray()).stream().map(this::projection).toList();

        var byType = new LinkedHashMap<String,Object>();
        for (var row : db.list("SELECT type,count(*) AS count FROM notifications" + VISIBLE_OWNER + " GROUP BY type ORDER BY type", actor, cutoff, admin)) {
            byType.put(Store.text(row,"type"),row.get("count"));
        }
        return Map.of("items",items,"total",total,"page",page,"page_size",size,"server_now",AttachmentService.offset(snapshot),
            "counts",Map.of("total",db.count("SELECT count(*) FROM notifications" + VISIBLE_OWNER, actor, cutoff, admin),
                "unread",unreadCount(actor, cutoff, admin),"by_type",byType));
    }
    private Map<String,Object> projection(Map<String,Object> row) {
        var result=new LinkedHashMap<String,Object>();
        for(String key:List.of("id","type","title","content","is_read","event_key","reservation_id","violation_id","restriction_id","complaint_id","complaint_event_id","appeal_id","review_reservation_id","review_operation_id")) {
            result.put(key,row.get(key));
        }
        if(row.get("admin_complaint_id")!=null) {
            result.put("complaint_id",row.get("admin_complaint_id"));
            result.put("complaint_event_id",row.get("admin_complaint_event_id"));
        }
        if(row.get("admin_appeal_id")!=null) result.put("appeal_id",row.get("admin_appeal_id"));
        result.put("created_at",AttachmentService.offset(row.get("created_at")));
        String business=null;
        Object id=null;
        for(String[] target:List.of(new String[]{"reservation_id","reservation"},new String[]{"review_reservation_id","review"},
            new String[]{"complaint_id","complaint"},new String[]{"appeal_id","appeal"},
            new String[]{"violation_id","violation"},new String[]{"restriction_id","restriction"})) {
            if(result.get(target[0])!=null) {
                business=target[1];
                id=result.get(target[0]);
                break;
            }
        }
        result.put("business_type",business);
        result.put("business_id",id);
        return result;
    }
    @Transactional(readOnly=true)
    public Map<String,Object> unread(long actor) {
        boolean admin = activeAdmin(actor);
        return Map.of("count", unreadCount(actor, Timestamp.valueOf(now()), admin));
    }
    @Transactional
    public Map<String,Object> read(long actor,long id) {
        db.lockBookings();
        boolean admin = activeAdmin(actor);
        Timestamp cutoff = Timestamp.valueOf(now());
        var notification = db.one("SELECT user_id,created_at<=? AND "+ADMIN_VISIBLE+" AS visible FROM notifications WHERE id=?", cutoff, admin, id);
        Api.require(Store.id(notification,"user_id") == actor,403,"无权读取他人通知");
        Api.require(Boolean.TRUE.equals(notification.get("visible")),404,"记录不存在");
        int marked = db.update("UPDATE notifications SET is_read=true WHERE id=? AND user_id=? AND is_read=false", id, actor);
        return Map.of("id",id,"marked",marked,"unread_count",unreadCount(actor, cutoff, admin));
    }
    @Transactional
    public Map<String,Object> readAll(long actor) {
        db.lockBookings();
        boolean admin = activeAdmin(actor);
        Timestamp cutoff = Timestamp.valueOf(now());
        int marked = db.update("UPDATE notifications SET is_read=true" + VISIBLE_OWNER + " AND is_read=false", actor, cutoff, admin);
        return Map.of("marked",marked,"unread_count",unreadCount(actor, cutoff, admin));
    }
    private long unreadCount(long actor, Timestamp cutoff, boolean admin) {
        return db.count("SELECT count(*) FROM notifications" + VISIBLE_OWNER + " AND is_read=false", actor, cutoff, admin);
    }
    private boolean activeAdmin(long actor) {
        var user = auth.profile(actor);
        Api.require("active".equals(user.get("status")),403,"账号已停用");
        return "admin".equals(user.get("role"));
    }
    private int number(String value){try{Api.require(value!=null&&value.matches("[0-9]+"),400,"通知页码须为正整数");int parsed=Integer.parseInt(value);Api.require(parsed>0,400,"通知页码须为正整数");return parsed;}catch(NumberFormatException e){throw Api.fail(400,"通知页码超出范围");}}
    private LocalDateTime now(){return LocalDateTime.ofInstant(clock.instant(),BookingPolicy.CAMPUS_ZONE).truncatedTo(ChronoUnit.MICROS);}
}
