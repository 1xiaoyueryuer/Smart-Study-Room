package cn.studyroom;

import javax.servlet.http.HttpServletRequest;
import javax.validation.Valid;
import org.springframework.web.bind.annotation.*;

/** 跨座位的座位码批量补齐入口；单座位生成、轮换与启停仍由 SeatCodeController 负责。 */
@RestController
@RequestMapping("/api/admin/seat-codes")
public class SeatCodeBatchController {
    private final SeatCodeService codes;
    public SeatCodeBatchController(SeatCodeService codes) { this.codes=codes; }
    @PostMapping("/batch") Object batch(HttpServletRequest req,@Valid @RequestBody Requests.SeatCodeBatch body) { return Api.ok(codes.batchGenerate(WebSecurity.uid(req),body)); }
}
