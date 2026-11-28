package cn.studyroom;

import java.util.List;
import java.util.Map;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebSecurity implements WebMvcConfigurer {
    private static final DefaultRedisScript<Long> RATE_LIMIT = new DefaultRedisScript<>("""
        local count = redis.call('INCR', KEYS[1])
        local remaining = redis.call('PTTL', KEYS[1])
        if remaining < 0 then
            redis.call('PEXPIRE', KEYS[1], ARGV[1])
            remaining = tonumber(ARGV[1])
        end
        if count > tonumber(ARGV[2]) then return -math.max(1, remaining) end
        return 0
        """, Long.class);
    private final AuthService auth;
    private final StringRedisTemplate redis;
    private final ObjectMapper json;
    private final LanService lan;
    public WebSecurity(AuthService auth,StringRedisTemplate redis,ObjectMapper json,LanService lan) { this.auth=auth;this.redis=redis;this.json=json;this.lan=lan; }
    @Override public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new HandlerInterceptor() {
            @Override public boolean preHandle(HttpServletRequest req,HttpServletResponse resp,Object handler) throws Exception {
                try {
                    String path=java.util.Objects.toString(req.getAttribute(org.springframework.web.servlet.HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE),req.getRequestURI());
                    if("OPTIONS".equals(req.getMethod())||path.equals("/api/health")) return true;
                    if(path.equals("/api/auth/register")) throw Api.fail(403,"校园账号由管理员维护，不开放公共注册");
                    if(path.equals("/api/auth/login")) {
                        rate("login:"+req.getRemoteAddr(),10,60000,resp); return true;
                    }
                    String header=req.getHeader("Authorization");
                    Api.require(header!=null&&header.startsWith("Bearer "),401,"请先登录");
                    String token=header.substring(7);
                    Map<String,Object> user=auth.authenticate(token); req.setAttribute("user",user);req.setAttribute("token",token);
                    lan.touch(token,req.getRemoteAddr(),req.getHeader("User-Agent"),user);
                    if(path.startsWith("/api/admin/")||path.startsWith("/api/stats/")) Api.require("admin".equals(user.get("role")),403,"需要管理员权限");
                    if ("POST".equals(req.getMethod())&&(path.equals("/api/reservations")||path.startsWith("/api/reservations/")||path.equals("/api/waitlist")||path.startsWith("/api/waitlist/")))
                        Api.require(AuthService.isOrdinary(user.get("role")),403,"仅学生和教职工可操作本人预约或候补");
                    if("POST".equals(req.getMethod())&&(path.equals("/api/reservations/auto")||path.equals("/api/waitlist"))) throw Api.fail(410,"旧自动分配与新增候补已退出，请手动选择座位预约");
                    if("POST".equals(req.getMethod())&&path.equals("/api/reservations"))
                        rate("reserve:"+user.get("id"),2,1000,resp);
                    return true;
                } catch(Api.Failure e) { write(resp,e.status,e.getMessage());return false; }
                catch(org.springframework.data.redis.RedisConnectionFailureException e) { write(resp,503,"Redis 暂时不可用，请检查服务");return false; }
            }
        }).addPathPatterns("/api/**");
    }
    private void rate(String key,int max,long millis,HttpServletResponse response) {
        Long result=redis.execute(RATE_LIMIT,List.of("studyroom-java:rate:"+key),Long.toString(millis),Integer.toString(max));
        Api.require(result!=null,503,"暂时无法处理请求，请稍后重试");
        if(result<0) {
            long seconds=(-result+999)/1000;
            response.setHeader("Retry-After",Long.toString(seconds));
            throw Api.fail(429,"操作过于频繁，请约 "+seconds+" 秒后重试");
        }
    }
    private void write(HttpServletResponse resp,int code,String message) throws Exception {
        resp.setStatus(code);resp.setContentType("application/json;charset=UTF-8");
        json.writeValue(resp.getWriter(),Map.of("code",code,"message",message));
    }
    @SuppressWarnings("unchecked") public static Map<String,Object> user(HttpServletRequest req) { return (Map<String,Object>)req.getAttribute("user"); }
    public static long uid(HttpServletRequest req) { return Store.id(user(req),"id"); }
}
