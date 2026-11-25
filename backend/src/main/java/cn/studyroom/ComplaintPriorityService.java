package cn.studyroom;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.text.Normalizer;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** System auto-grades 1-5 from safety and impact. Mapping versions remain legacy read-only history. */
@Service
public class ComplaintPriorityService {
    public static final long AUTO_RULE_VERSION=1;
    public record Classification(Integer priority,String status,long ruleVersion) {}
    private record Rule(String faultType,String impactScope,Integer priority,boolean enabled) {
        Map<String,Object> view(){var row=new LinkedHashMap<String,Object>();row.put("fault_type",faultType);row.put("impact_scope",impactScope);row.put("priority",priority);row.put("enabled",enabled);return row;}
    }
    private final Store db;private final AuthService auth;private final ObjectMapper json;
    public ComplaintPriorityService(Store db,AuthService auth,ObjectMapper json){this.db=db;this.auth=auth;this.json=json;}

    @Transactional(readOnly=true)
    public Map<String,Object> current(long actor,boolean includeDisabled){active(actor);var latest=db.one("SELECT version,mappings,actor_id,reason,created_at FROM complaint_priority_mapping_versions ORDER BY version DESC LIMIT 1");var rules=parse(latest.get("mappings"));if(!includeDisabled)rules=rules.stream().filter(Rule::enabled).toList();return projection(latest,rules,includeDisabled);}

    @Transactional(readOnly=true)
    public Map<String,Object> currentAdmin(long actor,boolean includeDisabled){requireAdmin(actor);return current(actor,includeDisabled);}

    @Transactional(readOnly=true)
    public Object rejectLegacyWrite(long actor){requireAdmin(actor);throw Api.fail(410,"报修分级设置已停用；历史映射只读保留");}

    @Transactional(readOnly=true)
    public Classification classify(String faultType,String impactScope,boolean safetyRisk,boolean unsafeArea){
        if(safetyRisk||unsafeArea)return new Classification(5,"safety_override",AUTO_RULE_VERSION);
        String scope=normal(impactScope).toLowerCase(Locale.ROOT);
        int level=switch(scope){
            case "minor" -> 1;
            case "inconvenient" -> 2;
            case "one_seat" -> 3;
            case "multiple" -> 4;
            default -> {
                if(scope.contains("不影响")||scope.contains("外观"))yield 1;
                if(scope.contains("一个座位")||scope.contains("单台"))yield 3;
                if(scope.contains("多个")||scope.contains("较大")||scope.contains("共享"))yield 4;
                yield 2;
            }
        };
        return new Classification(level,"auto",AUTO_RULE_VERSION);
    }

    private List<Rule> parse(Object raw){try{String source=raw==null?"[]":raw.toString();var rows=json.readValue(source,new TypeReference<List<Map<String,Object>>>(){});var out=new ArrayList<Rule>();for(var row:rows)out.add(new Rule(normal(Objects.toString(row.get("fault_type"),"")),normal(Objects.toString(row.get("impact_scope"),"")),row.get("priority")==null?null:((Number)row.get("priority")).intValue(),Boolean.TRUE.equals(row.get("enabled"))));return List.copyOf(out);}catch(Exception e){throw new IllegalStateException("优先级映射快照不可读取",e);}}
    private Map<String,Object> projection(Map<String,Object> version,List<Rule> rules,boolean includeMeta){var result=new LinkedHashMap<String,Object>();result.put("version",Store.id(version,"version"));result.put("rules",rules.stream().map(Rule::view).toList());if(includeMeta){result.put("reason",version.get("reason"));result.put("actor_id",version.get("actor_id"));result.put("created_at",AttachmentService.offset(version.get("created_at")));}return result;}
    private String normal(String value){return Normalizer.normalize(Objects.toString(value,""),Normalizer.Form.NFC).trim();}
    private void active(long actor){Api.require("active".equals(auth.profile(actor).get("status")),403,"账号已停用");}
    private void requireAdmin(long actor){var user=auth.profile(actor);Api.require("admin".equals(user.get("role"))&&"active".equals(user.get("status")),403,"需要启用的管理员权限");}
}
