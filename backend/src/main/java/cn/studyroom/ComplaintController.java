package cn.studyroom;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import javax.servlet.http.HttpServletRequest;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class ComplaintController {
    private static final Set<String> PUBLICATION_FIELDS = Set.of("visibility","public_summary","public_details","public_attachment_ids");
    private final ComplaintService complaints;private final AttachmentService attachments;private final ObjectMapper json;private final ComplaintWorkflowService workflow;
    public ComplaintController(ComplaintService complaints,AttachmentService attachments,ObjectMapper json,ComplaintWorkflowService workflow) { this.complaints=complaints;this.attachments=attachments;this.json=json;this.workflow=workflow; }
    @PostMapping("/complaints") Object create(HttpServletRequest req,@RequestBody Map<String,Object> body) {
        var allowed=new HashSet<>(Set.of("type","reservation_id","room_id","seat_id","description","attachment_ids","operation_id","service_kind","service_topic","fault_type","impact_scope","safety_risk","unsafe_area","priority_preview","request_type"));allowed.addAll(PUBLICATION_FIELDS);Api.require(allowed.containsAll(body.keySet())&&body.keySet().containsAll(Set.of("type","description","operation_id")),400,"投诉仅接受类型、地点或本人预约、说明、附件、可见范围及对应分支字段");Api.require(body.get("description") instanceof String&&body.get("type") instanceof String,400,"投诉类型和说明须为文本");
        var normalized=new java.util.LinkedHashMap<>(body);
        Object seat=normalized.get("seat_id");
        Api.require(seat==null||seat instanceof Integer||seat instanceof Long,400,"请选择座位图中的座位");
        // 兼容同学前端旧版枚举；数据库仍只保存当前V1.1正式枚举。
        if("facility".equals(normalized.get("service_kind"))) normalized.put("service_kind","facility_repair");
        if("other".equals(normalized.get("service_kind"))) normalized.put("service_kind","other_service");
        if(!normalized.containsKey("service_topic")&&normalized.get("request_type") instanceof String) normalized.put("service_topic",normalized.get("request_type"));
        normalized.remove("priority_preview");normalized.remove("request_type");
        for(String key:List.of("safety_risk","unsafe_area")) {
            Object value=normalized.get(key);
            if(value instanceof String text) normalized.put(key,"yes".equalsIgnoreCase(text)||"true".equalsIgnoreCase(text));
            Api.require(!normalized.containsKey(key)||normalized.get(key)==null||normalized.get(key) instanceof Boolean,400,key+"须为布尔值");
        }
        if("facility_repair".equals(normalized.get("service_kind"))&&!normalized.containsKey("unsafe_area")) normalized.put("unsafe_area",false);
        for(String key:List.of("service_kind","service_topic","fault_type","impact_scope"))Api.require(!normalized.containsKey(key)||normalized.get(key)==null||normalized.get(key) instanceof String,400,key+"须为文本");
        boolean hasPublication = !Collections.disjoint(body.keySet(),PUBLICATION_FIELDS);
        normalized.keySet().removeAll(PUBLICATION_FIELDS);
        Requests.Complaint request;
        try { request=json.convertValue(normalized,Requests.Complaint.class); }
        catch(IllegalArgumentException e) { throw Api.fail(400,"投诉参数格式错误"); }
        long actor = WebSecurity.uid(req);
        return Api.ok(hasPublication ? complaints.create(actor,request,publication(body))
            : complaints.create(actor,request));
    }
    @GetMapping("/complaints/rooms/{id}/seats") Object roomSeats(HttpServletRequest req,@PathVariable long id) {
        return Api.ok(complaints.reportableSeats(WebSecurity.uid(req),id));
    }
    @GetMapping("/complaints/mine") Object mine(HttpServletRequest req,@RequestParam Map<String,String> parameters) { return Api.ok(workflow.records(WebSecurity.uid(req),parameters,false)); }
    @GetMapping("/complaints/campus")
    ResponseEntity<Object> campus(HttpServletRequest req,@RequestParam Map<String,String> parameters) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
            .body(Api.ok(complaints.campus(WebSecurity.uid(req),parameters)));
    }
    @GetMapping("/complaints/campus/photos/{id}/{size:content|thumbnail}")
    ResponseEntity<byte[]> campusPhoto(HttpServletRequest req,@PathVariable String id,@PathVariable String size) {
        boolean thumbnail = "thumbnail".equals(size);
        byte[] image = attachments.campusPhoto(WebSecurity.uid(req),id,thumbnail);
        return ResponseEntity.ok().contentType(thumbnail ? MediaType.IMAGE_JPEG : MediaType.IMAGE_PNG).contentLength(image.length)
            .cacheControl(CacheControl.noStore()).header("X-Content-Type-Options","nosniff").body(image);
    }
    @GetMapping("/complaints/{id}") Object detail(HttpServletRequest req,@PathVariable long id) { return Api.ok(workflow.detail(WebSecurity.uid(req),id)); }
    @PutMapping("/complaints/{id}/visibility")
    Object changeVisibility(HttpServletRequest req,@PathVariable long id,@RequestBody Map<String,Object> body) {
        var allowed = new HashSet<>(PUBLICATION_FIELDS);
        allowed.add("version");
        Api.require(allowed.containsAll(body.keySet()),400,"请提交版本和公开设置");
        Object version = body.get("version");
        Api.require(version instanceof Integer || version instanceof Long,400,"版本须为正整数");
        return Api.ok(complaints.changeVisibility(WebSecurity.uid(req),id,((Number) version).longValue(),
            publication(body),!body.containsKey("public_details"),!body.containsKey("public_attachment_ids")));
    }
    private ComplaintService.Publication publication(Map<String,Object> body) {
        Object visibility = body.get("visibility");
        Object summary = body.get("public_summary");
        Object details = body.get("public_details");
        Object photos = body.get("public_attachment_ids");
        Api.require(visibility instanceof String,400,"请选择可见范围");
        Api.require(summary == null || summary instanceof String,400,"公开摘要须为文本");
        Api.require(details == null || details instanceof String,400,"公开详情须为文本");
        if(!body.containsKey("public_attachment_ids")) photos=List.of();
        Api.require(photos instanceof List<?> ids && ids.size()<=3 && ids.stream().allMatch(String.class::isInstance),
            400,"请选择最多3张公开照片");
        return new ComplaintService.Publication((String) visibility,(String) summary,(String) details,
            ((List<?>) photos).stream().map(String.class::cast).toList());
    }
    @PostMapping("/complaints/{id}/{action:withdraw|confirm|object}") Object action(HttpServletRequest req,@PathVariable long id,@PathVariable String action,@RequestBody Map<String,Object> body) {
        var allowed=action.equals("object")?Set.of("version","operation_id","description"):Set.of("version","operation_id");Api.require(allowed.containsAll(body.keySet()),400,"投诉操作只接受版本、操作标识和本次允许的说明");for(String key:List.of("operation_id","description")) Api.require(!body.containsKey(key)||body.get(key)==null||body.get(key) instanceof String,400,key+"须为文本");Requests.ComplaintResponse request;try{request=json.convertValue(body,Requests.ComplaintResponse.class);}catch(IllegalArgumentException e){throw Api.fail(400,"投诉操作参数格式错误");}
        var result=workflow.action(WebSecurity.uid(req),id,action,request);if(result.status()!=200)throw Api.fail(result.status(),result.message(),result.details());return Api.ok(result.data());
    }
}
