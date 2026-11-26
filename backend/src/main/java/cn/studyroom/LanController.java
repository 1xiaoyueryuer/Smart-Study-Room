package cn.studyroom;

import javax.servlet.http.HttpServletRequest;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/lan")
public class LanController {
    private final LanService lan;
    public LanController(LanService lan) { this.lan=lan; }
    @GetMapping("/info") Object info(HttpServletRequest req) { return Api.ok(lan.info(req.getRemoteAddr())); }
    @GetMapping("/devices") Object devices(HttpServletRequest req) {
        var user=WebSecurity.user(req);
        return Api.ok(lan.devices((String)req.getAttribute("token"),"admin".equals(user.get("role"))));
    }
    @GetMapping("/board") Object board(@RequestParam java.util.Map<String,String> parameters) {
        return Api.ok(lan.board(parameters.get("date"),parameters.get("start"),parameters.get("end")));
    }
    @GetMapping("/qr.png") ResponseEntity<byte[]> qr() {
        return ResponseEntity.ok().contentType(MediaType.IMAGE_PNG).cacheControl(CacheControl.noStore()).body(lan.qrPng());
    }
}
