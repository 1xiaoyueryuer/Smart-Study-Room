# -*- coding: utf-8 -*-
"""重绘系统设计报告的七张 PNG。运行：python docs/design/src/render_figures.py。

依赖 Pillow 和宋体（Windows SimSun，或通过 STUDYROOM_SIMSUN 指定宋体文件）。
图中坐标以逻辑像素表示，导出时放大两倍。
"""

from functools import lru_cache
from itertools import combinations, pairwise
from pathlib import Path
import os

from PIL import Image, ImageDraw, ImageFont


OUT = Path(__file__).resolve().parents[1] / "figures"
SCALE = 2
WIDTH = 1280
TOP = 110
BLACK = "#000000"
LINE = "#252525"
BORDER = "#888888"
GRID = "#c7c7c7"
PALE = "#f5f5f5"
WHITE = "#ffffff"


@lru_cache
def font(size):
    windows = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    path = Path(os.environ.get("STUDYROOM_SIMSUN", windows / "simsun.ttc"))
    if not path.is_file():
        raise RuntimeError("未找到宋体；请安装 SimSun 或设置 STUDYROOM_SIMSUN")
    return ImageFont.truetype(str(path), size * SCALE)


def intersects(left, right):
    return (left[0] < right[2] and left[2] > right[0]
            and left[1] < right[3] and left[3] > right[1])


class Figure:
    def __init__(self, number, name, height):
        self.name = f"图 {number}  {name}"
        self.height = height
        self.image = Image.new("RGB", (WIDTH * SCALE, height * SCALE), WHITE)
        self.draw = ImageDraw.Draw(self.image)
        self.labels = []
        self.boxes = []
        self.decorations = []
        self.segments = []

    def text(self, x, y, value, size=22, *, align="l", bold=False, inside=None):
        xy = (x * SCALE, y * SCALE)
        anchor = align + "t"
        face = font(size)
        weight = int(bold)
        bounds = tuple(n / SCALE for n in
                       self.draw.textbbox(xy, value, font=face, anchor=anchor, stroke_width=weight))
        minimum = inside or (24, TOP, WIDTH - 24, self.height - 12)
        if not (minimum[0] + 5 <= bounds[0] <= bounds[2] <= minimum[2] - 5
                and minimum[1] + 5 <= bounds[1] <= bounds[3] <= minimum[3] - 5):
            raise ValueError(f"{self.name}：文字越界 {value!r} {bounds} / {minimum}")
        self.labels.append((bounds, value))
        self.draw.text(xy, value, font=face, anchor=anchor, fill=BLACK, stroke_width=weight)

    def rect(self, bounds, fill=WHITE, outline=BORDER, radius=10):
        self.draw.rounded_rectangle(tuple(n * SCALE for n in bounds), radius=radius * SCALE,
                                    fill=fill, outline=outline, width=2 * SCALE)

    def panel(self, bounds, title):
        self.rect(bounds, outline=GRID)
        self.text(bounds[0] + 20, bounds[1] + 13, title, 22, bold=True, inside=bounds)

    def card(self, bounds, title, *details, fill=WHITE, title_size=24, detail_size=20,
             align="l", radius=10):
        self.rect(bounds, fill, radius=radius)
        self.boxes.append((bounds, title))
        x = (bounds[0] + bounds[2]) / 2 if align == "m" else bounds[0] + 18
        height = title_size + len(details) * (detail_size + 6)
        y = bounds[1] + (bounds[3] - bounds[1] - height) / 2
        self.text(x, y, title, title_size, align=align, bold=True, inside=bounds)
        y += title_size + 6
        for detail in details:
            self.text(x, y, detail, detail_size, align=align, inside=bounds)
            y += detail_size + 6

    def uml(self, bounds, name, attribute, *operations, fill=WHITE):
        self.rect(bounds, fill, radius=0)
        self.boxes.append((bounds, name))
        x1, y1, x2, _ = bounds
        self.text(x1 + 17, y1 + 11, name, 22, bold=True, inside=bounds)
        self.stroke((x1 + 12, y1 + 43), (x2 - 12, y1 + 43),
                    color=GRID, within_box=True)
        self.text(x1 + 17, y1 + 51, attribute, 17, inside=bounds)
        self.stroke((x1 + 12, y1 + 71), (x2 - 12, y1 + 71),
                    color=GRID, width=1, within_box=True)
        for i, operation in enumerate(operations):
            self.text(x1 + 17, y1 + 75 + i * 25, operation, 17, inside=bounds)

    def stroke(self, *points, arrow=False, dashed=False, color=LINE, width=2, within_box=False):
        for (x1, y1), (x2, y2) in pairwise(points):
            if (x1 == x2) == (y1 == y2):
                raise ValueError(f"{self.name}：连线必须是非零水平或垂直线段 {(x1, y1), (x2, y2)}")
            self.segments.append(((min(x1, x2) - width / 2, min(y1, y2) - width / 2,
                                   max(x1, x2) + width / 2, max(y1, y2) + width / 2), points, within_box))
            self.draw_segment((x1, y1), (x2, y2), color, width, dashed)
        if arrow:
            (x1, y1), (x2, y2) = points[-2:]
            dx = (x2 > x1) - (x2 < x1)
            dy = (y2 > y1) - (y2 < y1)
            head = ((x2, y2), (x2 - 11 * dx + 5 * dy, y2 - 11 * dy - 5 * dx),
                    (x2 - 11 * dx - 5 * dy, y2 - 11 * dy + 5 * dx))
            xs, ys = zip(*head)
            self.decorations.append((min(xs), min(ys), max(xs), max(ys)))
            tip, first, second = [tuple(n * SCALE for n in point) for point in head]
            if arrow == "open":
                self.draw.line((first, tip, second), fill=color, width=width * SCALE)
            else:
                self.draw.polygon((tip, first, second), fill=color)

    def draw_segment(self, start, end, color, width, dashed=False):
        if dashed:
            x1, y1 = start
            x2, y2 = end
            length = abs(x2 - x1) + abs(y2 - y1)
            dx, dy = (x2 - x1) / length, (y2 - y1) / length
            for step in range(0, int(length), 12):
                stop = min(length, step + 7)
                seg = (x1 + dx * step, y1 + dy * step, x1 + dx * stop, y1 + dy * stop)
                self.draw.line(tuple(n * SCALE for n in seg), fill=color, width=width * SCALE)
        else:
            self.draw.line(tuple(n * SCALE for n in (*start, *end)), fill=color, width=width * SCALE)

    def dot(self, x, y, radius=7):
        self.draw.ellipse(tuple(n * SCALE for n in (x - radius, y - radius, x + radius, y + radius)),
                          fill=LINE)

    def note(self, y, value):
        self.text(50, y, value, 20)

    def validate(self):
        for (first, label), (second, other) in combinations(self.labels, 2):
            if intersects(first, second):
                raise ValueError(f"{self.name}：文本相交 {label!r} 与 {other!r}")
        for segment, points, within_box in self.segments:
            for bounds, label in self.labels:
                if intersects(segment, bounds):
                    raise ValueError(f"{self.name}：连线 {points} 与文字 {label!r} 相交")
            for (x1, y1, x2, y2), title in self.boxes:
                if not within_box and intersects(segment, (x1 + 2, y1 + 2, x2 - 2, y2 - 2)):
                    raise ValueError(f"{self.name}：连线 {points} 穿过节点 {title!r}")
        for marker in self.decorations:
            for bounds, label in self.labels:
                if intersects(marker, bounds):
                    raise ValueError(f"{self.name}：箭头或基数标记与文字 {label!r} 相交")
        for (first, title), (second, other) in combinations(self.boxes, 2):
            if intersects(first, second):
                raise ValueError(f"{self.name}：节点相交 {title!r} 与 {other!r}")


def architecture():
    f = Figure(3, "系统总体架构图", 782)
    layers = [
        ("客户端层", "浏览器 · Vue 3 单页应用", "学生、教职工与管理员通过同一 Web 入口访问"),
        ("接口层", "Spring Boot Web", "静态页面路由、REST 接口、安全拦截、参数校验与异常映射"),
        ("业务层", "Service / Policy", "账号认证、开放与预约、投诉、违规与限制、申诉、评价与统计"),
        ("数据访问与存储层", "Store 通过 JdbcTemplate 访问 PostgreSQL", "Flyway 管理数据库结构，PostgreSQL 保存业务事实"),
    ]
    for y, (label, title, detail) in zip((132, 280, 428, 576), layers):
        f.card((48, y, 868, y + 98), title, detail, fill=PALE)
        f.text(834, y + 14, label, 17, align="r", bold=True)
    for y, label in ((230, "HTTP · 页面与 JSON"), (378, "业务调用"), (526, "经 Store 执行 SQL")):
        f.stroke((448, y), (448, y + 50), arrow=True)
        f.text(466, y + 13, label, 19)
    f.card((948, 576, 1232, 674), "Redis", "限流与令牌撤销", align="m", fill=PALE)
    f.stroke((868, 336), (1090, 336), (1090, 576), arrow=True)
    f.stroke((868, 484), (1090, 484))
    f.dot(1090, 484, 3)
    f.text(885, 309, "安全拦截限流", 18)
    f.text(885, 457, "认证服务读写撤销状态", 18)
    f.note(718, "关键预约与资源写事务在 PostgreSQL 内先锁定 booking_mutex，再校验和写入。")
    return f


def deployment():
    f = Figure(4, "系统部署架构图", 847)
    f.card((498, 130, 918, 211), "同一局域网的其他设备", "各自登录同一应用", align="m")
    f.panel((48, 252, 1232, 685), "应用主机")
    f.card((77, 330, 374, 435), "主机浏览器", "127.0.0.1:8080", align="m")
    f.card((498, 330, 918, 472), "Spring Boot · Java 17", "单个应用进程，提供 /api",
           "前端 dist 随 JAR 的 static/ 一起发布", fill=PALE, align="m")
    f.card((92, 555, 468, 654), "PostgreSQL 17 · Docker", "本机 5433 映射容器 5432", "开发库和测试库分开", detail_size=18)
    f.card((821, 555, 1204, 654), "Redis 7.2 · 本机实例", "默认 6379，Compose 备用 6380", "使用 3 号库", detail_size=18)
    f.stroke((708, 211), (708, 330), arrow=True)
    f.text(727, 224, "HTTP · 主机局域网 IP:8080", 19)
    f.text(727, 260, "需要启用非回环监听", 19)
    f.stroke((374, 382), (498, 382), arrow=True)
    f.text(436, 350, "HTTP", 19, align="m")
    f.stroke((600, 472), (600, 525), (273, 525), (273, 555), arrow=True)
    f.stroke((819, 472), (819, 525), (1012, 525), (1012, 555), arrow=True)
    f.text(427, 494, "JDBC", 19)
    f.text(923, 494, "Redis 协议", 19)
    f.card((48, 717, 1232, 807), "开发与交付",
           "本机 scripts/ 构建、启停与验证；GitHub 管理代码、拉取请求和 CI 检查。", fill=PALE)
    return f


def modules():
    f = Figure(5, "系统模块结构图", 736)
    f.card((380, 132, 900, 213), "智慧自习室预约与管理系统", fill=PALE, align="m")
    f.panel((48, 269, 1232, 578), "业务模块")
    f.stroke((640, 213), (640, 269), arrow=True)
    items = [
        ("账号与权限", "F01 · 登录、账号维护"),
        ("资源与开放", "F02、F05 · 开放、变更善后"),
        ("预约", "F03、F04 · 选座、签到、结算"),
        ("投诉与反馈", "F06 · 求助、报修、反馈"),
        ("违规与限制", "F07 · 违规登记、预约限制"),
        ("申诉与纠错", "F08 · 申诉审核、核实补签"),
        ("评价与消息", "F09、F10 · 评价、记录、消息"),
        ("统计与审计", "F11 · 热力图；跨模块审计"),
    ]
    for index, (title, detail) in enumerate(items):
        row, column = divmod(index, 4)
        x, y = 67 + 292 * column, 320 + 120 * row
        f.card((x, y, x + 270, y + 101), title, detail, detail_size=17)
    f.card((48, 615, 1232, 698), "F12 · 局域网接入与共同预约",
           "各设备复用同一套账号、座位和预约规则；接入页提供二维码与共享看板。", fill=PALE)
    return f


def lifecycle():
    f = Figure(7, "预约状态图", 840)
    f.card((500, 151, 780, 246), "待签到 · pending", "创建成功后的初始状态", fill=PALE, align="m")
    f.card((48, 410, 365, 506), "已取消 · cancelled", "不登记用户违规", align="m")
    f.card((500, 410, 780, 506), "使用中 · checked_in", "已建立唯一使用记录", fill=PALE, align="m")
    f.card((915, 410, 1232, 506), "未签到结束 · unused_ended", "登记违规并通知", title_size=21, align="m")
    f.card((500, 679, 780, 770), "已完成 · completed", "使用记录已结算", align="m")
    f.dot(640, 126)
    f.stroke((640, 133), (640, 151), arrow="open")

    for x, y, label in (
        (105, 174, "本人取消 [开始前]"),
        (208, 202, "资源变更确认"),
        (310, 230, "预约限制生效"),
    ):
        f.stroke((500, y), (x, y), (x, 410), arrow="open")
        f.text(x + 15, y - 24, label, 18)

    for x, y, label in (
        (1170, 174, "签到截止 [仍未签到]"),
        (1020, 230, "主动放弃 [窗口内]"),
    ):
        f.stroke((780, y), (x, y), (x, 410), arrow="open")
        f.text(807, y - 25, label, 18)

    f.stroke((561, 246), (561, 410), arrow="open")
    f.stroke((719, 246), (719, 410), arrow="open")
    f.text(545, 302, "本人扫码签到", 19, align="r")
    f.text(545, 331, "[窗口内，座位码有效", 17, align="r")
    f.text(545, 358, "且资源开放]", 17, align="r")
    f.text(736, 302, "管理员核实补签", 19)
    f.text(736, 331, "[窗口内，核实依据齐全]", 17)

    f.stroke((500, 473), (398, 473), (398, 585), (207, 585), (207, 506), arrow="open")
    f.text(229, 525, "资源变更确认", 19)
    f.text(229, 555, "/ 按确认时刻结算", 18)

    f.stroke((561, 506), (561, 679), arrow="open")
    f.stroke((719, 506), (719, 679), arrow="open")
    f.text(544, 613, "提前签退 / 按实际时刻结算", 19, align="r")
    f.text(736, 613, "到期结束 / 按计划时刻结算", 19)
    f.note(792, "签到窗口为 [预约开始，开始后 15 分钟)。")
    return f


def sequence():
    f = Figure(6, "预约创建顺序图", 1334)
    participants = [
        (97, "浏览器", "Vue 3"), (252, "接口控制器", "ApiController"),
        (407, "预约服务", "BookingService"), (562, "数据访问", "Store"),
        (717, "限制策略", "RestrictionPolicy"), (872, "开放安排", "OpeningScheduleService"),
        (1027, "消息服务", "NotificationService"), (1182, "审计服务", "AuditService"),
    ]
    for x, label, cls in participants:
        f.card((x - 71, 135, x + 71, 195), label, cls, title_size=21,
               detail_size=12, align="m", fill=PALE, radius=0)
        f.stroke((x, 195), (x, 1192), dashed=True, color=BORDER)
    # 每条消息的标题置于相邻生命线之间，避免盖住生命线。
    messages = [
        (0, 1, ("POST", "/api/reservations")),
        (1, 2, ("createForClient",)),
        (2, 3, ("锁定预约互斥行",)),
        (2, 2, ("校验时间、账号", "推进旧预约及限制")),
        (2, 4, ("查询预约资格",)),
        (4, 2, ("返回资格",)),
        (2, 3, ("读取目标座位与", "空间，核验可用")),
        (2, 5, ("校验开放窗口",)),
        (2, 2, ("结算相关旧预约", "应用有效限制")),
        (2, 3, ("查座位、用户冲突", "通过后插入预约")),
        (2, 6, ("记录站内消息",)),
        (2, 7, ("记录创建审计",)),
        (2, 3, ("读预约和使用记录",)),
        (2, 2, ("组装预约视图", "附上允许动作")),
        (2, 1, ("返回结果", "ActionResult")),
        (1, 0, ("HTTP 200", "统一响应信封")),
    ]
    replies = {5, 14, 15}
    for index, (sender, receiver, lines) in enumerate(messages):
        x1, x2 = participants[sender][0], participants[receiver][0]
        y = 244 + index * 61
        if sender == receiver:
            f.stroke((x1, y), (x1 + 45, y), (x1 + 45, y + 10), (x1, y + 10), arrow=True)
        else:
            reply = index in replies
            f.stroke((x1, y), (x2, y), arrow="open" if reply else True, dashed=reply)
        for offset, label in enumerate(reversed(lines)):
            f.text(min(x1, x2) + 8, y - 25 - 20 * offset, label, 16 if label.startswith("/") else 18)

    f.note(1214, "手动选座成功路径。实线带实心箭头表示同步调用，虚线带开放箭头表示返回。")
    f.note(1248, "预约写入、站内消息和审计在同一服务事务内。资格失败返回 403，时段冲突返回 409。")
    f.note(1282, "其余读取、重复校验及部分返回消息从略。")
    return f


def entity(f, x, y, table, description, width=205):
    f.card((x, y, x + width, y + 73), table, description, title_size=19, detail_size=16, fill=PALE, radius=0)


def cardinality(f, point, toward, count):
    x, y = point
    dx = (toward[0] > x) - (toward[0] < x)
    dy = (toward[1] > y) - (toward[1] < y)

    def offset(along, across=0):
        return (x + dx * along - dy * across, y + dy * along + dx * across)

    xs, ys = zip(offset(0, -8), offset(26, 8))
    f.decorations.append((min(xs), min(ys), max(xs), max(ys)))

    f.draw_segment(offset(0), offset(13), LINE, 2)
    if count.endswith("*"):
        for wing in (-7, 7):
            f.draw_segment(offset(13), offset(1, wing), LINE, 2)
    else:
        f.draw_segment(offset(9, -7), offset(9, 7), LINE, 2)
    if count.startswith("0"):
        cx, cy = offset(21)
        circle = (cx - 4, cy - 4, cx + 4, cy + 4)
        f.draw.ellipse(tuple(n * SCALE for n in circle), fill=WHITE, outline=LINE, width=2 * SCALE)
    else:
        f.draw_segment(offset(19, -7), offset(19, 7), LINE, 2)


def relationship(f, *points, first, second, identifying=False):
    f.stroke(*points, dashed=not identifying)
    cardinality(f, points[0], points[1], first)
    cardinality(f, points[-1], points[-2], second)


def entities():
    f = Figure(1, "核心数据实体关系图", 1355)
    f.panel((48, 133, 627, 648), "空间与预约")
    f.panel((653, 133, 1232, 648), "投诉与反馈")
    f.panel((48, 675, 627, 1172), "违规、限制与申诉")
    f.panel((653, 675, 1232, 1172), "站内消息")
    entity(f, 74, 188, "rooms", "空间")
    entity(f, 377, 188, "users", "校园账号")
    entity(f, 74, 311, "seats", "座位 · room_id")
    entity(f, 377, 311, "reservations", "预约 · 属于用户与座位")
    entity(f, 74, 434, "seat_codes", "座位码 · seat_id")
    entity(f, 377, 434, "usage_records", "使用记录 · 预约唯一")
    entity(f, 377, 557, "reviews", "评价 · 预约唯一")
    relationship(f, (155, 261), (155, 311), first="1", second="0..*")
    relationship(f, (498, 261), (498, 311), first="1", second="0..*")
    relationship(f, (279, 350), (377, 350), first="1", second="0..*")
    relationship(f, (155, 384), (155, 434), first="1", second="0..1", identifying=True)
    relationship(f, (476, 384), (476, 434), first="1", second="0..1")
    relationship(f, (582, 361), (611, 361), (611, 593), (582, 593), first="1", second="0..1")

    entity(f, 679, 188, "users", "提交人")
    entity(f, 1002, 188, "reservations", "关联预约")
    entity(f, 679, 333, "complaints", "投诉 · 预约外键可空")
    entity(f, 1002, 333, "complaint_events", "事件 · complaint_id")
    entity(f, 679, 478, "rooms", "关联空间")
    relationship(f, (750, 261), (750, 333), first="1", second="0..*")
    relationship(f, (1104, 261), (1104, 295), (837, 295), (837, 333), first="0..1", second="0..*")
    relationship(f, (884, 372), (1002, 372), first="1", second="0..*")
    relationship(f, (781, 406), (781, 478), first="0..*", second="0..1")
    f.text(678, 581, "被占求助必须关联提交人自己的预约。", 17)

    entity(f, 74, 733, "users", "限制对象及违规主体")
    entity(f, 397, 733, "reservations", "违规关联预约")
    entity(f, 74, 856, "restrictions", "预约限制 · user_id")
    entity(f, 397, 856, "violations", "违规 · 关联用户与预约")
    entity(f, 74, 979, "appeal_reviews", "审核 · appeal_id")
    entity(f, 397, 979, "appeals", "申诉 · 关联违规与用户")
    relationship(f, (159, 806), (159, 856), first="1", second="0..*")
    relationship(f, (498, 806), (498, 856), first="1", second="0..*")
    relationship(f, (498, 929), (498, 979), first="1", second="0..*")
    relationship(f, (279, 1018), (397, 1018), first="0..1", second="1")
    relationship(f, (279, 770), (338, 770), (338, 893), (397, 893), first="1", second="0..*")
    f.text(73, 1080, "自动限制通过 restriction_evaluation_sources", 17)
    f.text(73, 1106, "固定 3 条违规。每条违规最多作为一个自动限制的来源。", 17)

    entity(f, 679, 733, "users", "消息接收人", width=527)
    entity(f, 679, 856, "notifications", "站内消息 · user_id、type、event_key", width=527)
    relationship(f, (943, 806), (943, 856), first="1", second="0..*")
    f.text(679, 968, "按消息类型关联对应业务对象", 19, bold=True)
    f.text(679, 1010, "预约、投诉、违规、限制、申诉、评价", 19)
    f.text(679, 1053, "部分引用与 user_id 组成复合外键，", 17)
    f.text(679, 1084, "数据库同时校验对象与消息归属。", 17)

    for x, count, label in ((90, "1", "恰好一个"), (320, "0..1", "零或一个"), (550, "0..*", "零到多个")):
        f.stroke((x, 1213), (x + 78, 1213))
        cardinality(f, (x + 78, 1213), (x, 1213), count)
        f.text(x + 94, 1204, label, 19)
    f.note(1254, "同名框代表同一张表。实线表示标识关系，虚线表示非标识关系。")
    f.note(1294, "图中列出主要关系，完整约束见 Flyway V1—V31 迁移脚本。")
    return f


def classes():
    f = Figure(2, "核心设计类图", 1220)
    f.panel((48, 131, 1232, 363), "上游业务协作")
    f.uml((72, 201, 385, 315), "AvailabilityService", "- bookings: BookingService", "+ find(…)", fill=PALE)
    f.uml((482, 201, 798, 315), "BookingService", "- db: Store  ·  - clock: Clock",
          "+ reconcileAvailability(…)", fill=PALE)
    f.uml((895, 201, 1208, 315), "RestrictionWorkflow", "- bookings: BookingService",
          "+ create(…)  ·  + release(…)", fill=PALE)
    f.stroke((385, 272), (482, 272), arrow="open", dashed=True)
    f.stroke((895, 272), (798, 272), arrow="open", dashed=True)
    f.text(433, 237, "找座前结算", 16, align="m")
    f.text(846, 237, "应用限制", 16, align="m")
    f.panel((48, 389, 1232, 1123), "预约服务的直接依赖")
    f.uml((446, 447, 834, 576), "BookingService", "- opening: OpeningScheduleService",
          "+ createForClient(…)  ·  + checkin(…)", "+ action(…)  ·  + correctCheckin(…)", fill=PALE)
    rows = [
        (605, ("OpeningScheduleService", "- db: Store", "+ requireSlot(roomId, seatId, slot)"),
              ("RestrictionPolicy", "- db: Store", "~ eligibility(user, now)  ·  + assess(…)")),
        (735, ("BookingPolicy", "- clock: Clock", "+ validateDate(…)  ·  + validate(slot)"),
              ("UsageService", "- db: Store", "+ start(…)  ·  + finish(…)  ·  + view(…)")),
        (865, ("Slot", "- date  ·  - startMinute  ·  - endMinute", "+ parse(…)  ·  + overlaps(…)"),
              ("ReservationDeadline", "+ SIGN_IN_MINUTES = 15", "+ at(…)  ·  + expiredPending(…)")),
    ]
    f.stroke((640, 576), (640, 1001), dashed=True, arrow="open")
    for (y, left, right), x_left, x_right in zip(rows, (578, 598, 618), (702, 682, 662)):
        f.uml((74, y, 556, y + 105), *left)
        f.uml((724, y, 1206, y + 105), *right)
        f.stroke((x_left, 576), (x_left, y + 52), (556, y + 52), arrow="open", dashed=True)
        f.stroke((x_right, 576), (x_right, y + 52), (724, y + 52), arrow="open", dashed=True)
    f.uml((446, 1001, 834, 1106), "Store", "- jdbc: JdbcTemplate", "+ lockBookings()  ·  + insert(…)", fill=PALE)
    f.note(1154, "虚线带开放箭头表示依赖。+ 公开，- 私有，~ 包内可见。")
    return f


def main():
    figures = (
        (entities, "fig1_数据实体关系图.png"),
        (classes, "fig2_设计类图.png"),
        (architecture, "fig3_系统总体架构.png"),
        (deployment, "fig4_系统部署架构.png"),
        (modules, "fig5_系统模块结构.png"),
        (sequence, "fig6_预约创建顺序图.png"),
        (lifecycle, "fig7_预约状态图.png"),
    )
    rendered = []
    for build, filename in figures:
        figure = build()
        figure.validate()
        rendered.append((figure, filename))
    OUT.mkdir(parents=True, exist_ok=True)
    for figure, filename in rendered:
        image = figure.image.crop((0, TOP * SCALE, WIDTH * SCALE, figure.height * SCALE))
        image.save(OUT / filename, dpi=(180, 180), optimize=True)
        print(f"{filename}  {image.width} × {image.height}")


if __name__ == "__main__":
    main()
