package cn.studyroom;

import java.util.*;
import javax.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class ComplaintPriorityController {
    private final ComplaintPriorityService priorities;private final com.fasterxml.jackson.databind.ObjectMapper json;
    public ComplaintPriorityController(ComplaintPriorityService priorities,com.fasterxml.jackson.databind.ObjectMapper json){this.priorities=priorities;this.json=json;}
    @GetMapping("/complaint-priority-mappings") Object options(HttpServletRequest req){return Api.ok(priorities.current(WebSecurity.uid(req),false));}
    @GetMapping("/admin/complaint-priority-mappings") Object adminMappings(HttpServletRequest req){return Api.ok(priorities.currentAdmin(WebSecurity.uid(req),true));}
    @PutMapping("/admin/complaint-priority-mappings") Object replace(HttpServletRequest req,@RequestBody(required=false) Map<String,Object> ignored){return priorities.rejectLegacyWrite(WebSecurity.uid(req));}
}
