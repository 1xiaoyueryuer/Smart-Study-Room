# -*- coding: utf-8 -*-
"""系统设计报告图件生成脚本（第 3 版 · 部署拓扑风格）
风格规范（依据用户提供的参考图）：
- 白底、深灰细边框节点（圆角），节点内为「名称（粗体居中）+ 灰色小字说明」
- 分组用虚线大框，左上角灰色分组标签
- 连接线为灰色细线箭头，标签小字放在线旁
- 文字稀疏、留白充足；框高按内容行数自动计算，杜绝重叠
"""
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Rectangle, Circle

OUT = os.path.join(os.path.dirname(__file__), "..", "figures")
os.makedirs(OUT, exist_ok=True)

plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei"]
plt.rcParams["axes.unicode_minus"] = False
plt.rcParams["font.family"] = "sans-serif"

# 配色（参考图风格：黑白灰 + 少量深蓝）
TITLE = "#1F1F1F"      # 标题
NODE_FC = "#FFFFFF"    # 节点填充
NODE_EC = "#404040"    # 节点边框
NODE_TEXT = "#1A1A1A"  # 节点名称
SUB = "#707070"        # 说明小字
GROUP_EC = "#9AA5B1"   # 虚线分组框
LINE = "#8A8A8A"       # 连线
LBL = "#4A4A4A"        # 连线标签

def save(fig, name):
    path = os.path.join(OUT, name)
    fig.savefig(path, dpi=200, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print("saved", os.path.basename(path))

def node(ax, x, y, w, name, sub=None, name_fs=10.5, sub_fs=8, h=None):
    """节点：名称一行居中粗体，说明（可多行，'|' 分隔）灰色小字居中。框高按内容自适应。"""
    lines = sub.split("|") if sub else []
    if h is None:
        h = 0.34 + 0.20 + (len(lines) * 0.19 if lines else 0) + 0.10
    p = FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.01,rounding_size=0.08",
                       fc=NODE_FC, ec=NODE_EC, lw=1.2)
    ax.add_patch(p)
    ax.text(x + w / 2, y + h - 0.22, name, ha="center", va="center",
            fontsize=name_fs, fontweight="bold", color=NODE_TEXT)
    yy = y + h - 0.22 - 0.20
    for i, ln in enumerate(lines):
        ax.text(x + w / 2, yy - i * 0.19, ln, ha="center", va="center",
                fontsize=sub_fs, color=SUB)
    return h

def group(ax, x, y, w, h, label):
    """虚线分组框，左上角标签。"""
    ax.add_patch(Rectangle((x, y), w, h, fc="none", ec=GROUP_EC, lw=1.1,
                           linestyle=(0, (5, 4))))
    ax.text(x + 0.08, y + h - 0.16, label, fontsize=8.5, color="#5B6B8C",
            ha="left", va="center")

def arrow(ax, x1, y1, x2, y2, text=None, tdx=0.0, tdy=0.0, rad=0.0, lw=1.3, fs=8.5):
    a = FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="-|>", mutation_scale=14,
                        color=LINE, lw=lw, connectionstyle=f"arc3,rad={rad}")
    ax.add_patch(a)
    if text:
        ax.text((x1 + x2) / 2 + tdx, (y1 + y2) / 2 + tdy, text, ha="center", va="center",
                fontsize=fs, color=LBL, bbox=dict(fc="white", ec="none", pad=0.5))

def title(ax, text, W, H):
    ax.text(W / 2, H - 0.4, text, ha="center", fontsize=14, fontweight="bold", color=TITLE)

def note(ax, text, y):
    ax.text(0.5, y, text, fontsize=8.5, color="#6B7280")

def clean(ax, w, h):
    ax.set_xlim(0, w); ax.set_ylim(0, h); ax.axis("off")

# ============================================================
# 图 1 系统总体架构图
# ============================================================
W, H = 13.0, 8.8
fig, ax = plt.subplots(figsize=(13.0, 8.8))
clean(ax, W, H)
title(ax, "图 1  智慧自习室预约与管理系统总体架构图", W, H)

group(ax, 0.6, 7.0, 11.8, 1.25, "客户端层 · 浏览器（Vue 3 单页应用）")
items1 = ["登录 / 注册", "座位预约", "我的预约 / 签到", "求助与投诉", "消息 / 个人中心", "管理端"]
n = len(items1); cw = 1.72; gap = (11.8 - 0.3 - n * cw) / (n - 1)
for i, t in enumerate(items1):
    node(ax, 0.9 + i * (cw + gap), 7.18, cw, t, h=0.8)

group(ax, 0.6, 5.35, 11.8, 1.25, "接口层 · Spring Boot（20 个控制器 · 统一前缀 /api）")
items2 = [("REST 接口", "统一信封 {code, message, data}"), ("参数校验", "Bean Validation"),
          ("异常映射", "统一错误码"), ("安全拦截", "认证 / 权限 / 限流"), ("静态资源", "SpaController")]
n = len(items2); cw = 2.05; gap = (11.8 - 0.3 - n * cw) / (n - 1)
for i, (t, s) in enumerate(items2):
    node(ax, 0.9 + i * (cw + gap), 5.5, cw, t, sub=s, h=0.95)

group(ax, 0.6, 2.9, 11.8, 2.0, "业务层 · Service / Policy（业务规则集中实现）")
domains = [("账号与权限", "认证 / 导入"), ("资源与开放", "窗口 / 停用"), ("预约生命周期", "创建 / 签到 / 结算"),
           ("连续空档找座", "快照查询"), ("投诉核实反馈", "受理 / 反馈"), ("违规与限制", "累计 / 限制"),
           ("申诉与评价", "申诉 / 审核 / 评价")]
n = len(domains); cw = 1.55; gap = (11.8 - 0.3 - n * cw) / (n - 1)
for i, (t, s) in enumerate(domains):
    node(ax, 0.9 + i * (cw + gap), 3.05, cw, t, sub=s, h=1.05)
node(ax, 0.9, 4.28, 11.5, "支撑服务", sub="消息 / 审计 / 材料 / 统计 / 记录分页", h=0.62, name_fs=9.5)

group(ax, 0.6, 1.15, 11.8, 1.3, "数据访问与存储层")
items4 = [("Store", "唯一 SQL 入口"), ("PostgreSQL 17", "Flyway V1—V31"),
          ("Redis 7.2", "限流 / 令牌撤销"), ("通用结构", "Slot / RecordPage")]
n = len(items4); cw = 2.6; gap = (11.8 - 0.3 - n * cw) / (n - 1)
for i, (t, s) in enumerate(items4):
    node(ax, 0.9 + i * (cw + gap), 1.3, cw, t, sub=s, h=0.95)

arrow(ax, 6.5, 7.0, 6.5, 6.62, "HTTP / JSON", tdx=1.5, tdy=0.14)
arrow(ax, 6.5, 5.35, 6.5, 4.92, "调用")
arrow(ax, 6.5, 2.9, 6.5, 2.47, "JDBC / Redis")
note(ax, "写事务先锁定互斥表固定行，保证并发写串行化。", 0.5)
save(fig, "fig1_系统总体架构.png")

# ============================================================
# 图 2 系统部署架构图（严格仿参考图「部署拓扑」风格）
# ============================================================
W, H = 13.5, 8.6
fig, ax = plt.subplots(figsize=(13.5, 8.6))
clean(ax, W, H)
title(ax, "图 2  系统部署架构图", W, H)

group(ax, 0.5, 1.0, 9.3, 6.6, "本系统部署的组件")

node(ax, 1.0, 6.6, 2.6, "浏览器", sub="学生端 / 管理端|前端构建产物装入 JAR", h=1.0)
node(ax, 5.0, 6.6, 4.3, "接口服务", sub="Spring Boot · Java 17|127.0.0.1:8080 · 仅监听本机", h=1.0)
node(ax, 5.0, 5.0, 4.3, "前端静态资源", sub="dist 打包进 JAR 的 static/|运行时无需另起 Node 服务", h=1.0)
node(ax, 5.0, 3.4, 4.3, "业务数据", sub="PostgreSQL 17 · 开发库 / 测试库|127.0.0.1:5433 · Flyway V1—V31", h=1.0)
node(ax, 5.0, 1.8, 4.3, "Redis 7.2", sub="仅用于限流与令牌撤销|3 号库 · 键前缀 studyroom-java:", h=1.0)
node(ax, 1.0, 1.8, 2.6, "scripts/", sub="构建 · 启停|联调 · 性能采样", h=1.0)

arrow(ax, 3.6, 7.1, 5.0, 7.1, "HTTP")
arrow(ax, 7.15, 6.6, 7.15, 6.05, "JDBC")
arrow(ax, 7.15, 5.0, 7.15, 4.45, "JDBC")
arrow(ax, 7.15, 3.4, 7.15, 2.85, "Redis 协议")
arrow(ax, 2.3, 6.6, 2.3, 2.85, "部署", rad=0.25, tdx=-0.9)

group(ax, 10.1, 1.0, 2.9, 6.6, "外部（不在系统边界内）")
node(ax, 10.4, 5.6, 2.3, "GitHub 远程仓库", sub="分支 / 拉取请求|CI 检查", h=1.0)
node(ax, 10.4, 3.9, 2.3, "Docker 容器", sub="PostgreSQL 17|运行于本机", h=1.0)
node(ax, 10.4, 2.2, 2.3, "浏览器入口", sub="http://127.0.0.1:8080", h=1.0)
arrow(ax, 9.3, 6.1, 10.4, 6.1, "推送 / 拉取")
arrow(ax, 9.3, 4.4, 10.4, 4.4, "容器编排")

note(ax, "应用与数据库同机部署；写事务互斥串行化，单机教学规模。", 0.35)
save(fig, "fig2_系统部署架构.png")

# ============================================================
# 图 3 系统模块结构图
# ============================================================
W, H = 13.0, 8.2
fig, ax = plt.subplots(figsize=(13.0, 8.2))
clean(ax, W, H)
title(ax, "图 3  系统模块结构图", W, H)

node(ax, 4.3, 7.05, 4.4, "智慧自习室预约与管理系统", h=0.7)

mods = [
    ("账号与权限模块", "登录 · 账号维护 · 导入"),
    ("资源与开放模块", "空间 · 窗口 · 座位码"),
    ("预约模块", "选座 · 签到 · 结算"),
    ("投诉与反馈模块", "求助 · 报修 · 反馈"),
    ("违规与限制模块", "违规 · 累计 · 限制"),
    ("申诉与纠错模块", "申诉 · 审核 · 重算"),
    ("评价与消息模块", "评价 · 回复 · 消息"),
    ("统计与审计模块", "快照 · 热力图 · 审计"),
]
cols, rows = 4, 2
gw, gh = 2.85, 1.05
gx0, gy0 = 0.85, 0.9
hgap = (W - 2 * gx0 - cols * gw) / (cols - 1)
vgap = 1.15
bus_y = 6.75
top_top = gy0 + (rows - 1) * (gh + vgap) + gh

for idx, (name, sub) in enumerate(mods):
    r, c = divmod(idx, cols)
    x = gx0 + c * (gw + hgap)
    y = gy0 + (rows - 1 - r) * (gh + vgap)
    node(ax, x, y, gw, name, sub=sub, h=gh, name_fs=9.5)

for c in range(cols):
    x = gx0 + c * (gw + hgap)
    ax.plot([x + gw / 2, x + gw / 2], [top_top, bus_y], color=LINE, lw=1.1)
for c in range(cols):
    x = gx0 + c * (gw + hgap)
    x_bottom = x + gw / 2
    y_bottom = gy0
    mid_y = gy0 + gh + vgap / 2
    x_gap = x + gw + hgap / 2 if c < 2 else x - hgap / 2
    ax.plot([x_bottom, x_bottom], [y_bottom + gh, mid_y], color=LINE, lw=1.1)
    ax.plot([x_bottom, x_gap], [mid_y, mid_y], color=LINE, lw=1.1)
    ax.plot([x_gap, x_gap], [mid_y, bus_y], color=LINE, lw=1.1)
ax.plot([gx0 + gw / 2, gx0 + 3 * (gw + hgap) + gw / 2], [bus_y, bus_y], color=LINE, lw=1.1)
ax.plot([6.5, 6.5], [bus_y, 7.05], color=LINE, lw=1.1)

note(ax, "模块对应功能编号 F01—F11；每个模块由控制器与服务组成，数据访问统一经由 Store。", 0.35)
save(fig, "fig3_系统模块结构.png")

# ============================================================
# 图 4 预约状态图
# ============================================================
W, H = 13.5, 8.2
fig, ax = plt.subplots(figsize=(13.5, 8.2))
clean(ax, W, H)
title(ax, "图 4  预约状态图", W, H)

node(ax, 5.2, 6.4, 3.0, "待签到 pending", sub="签到窗口：开始 ~ 开始后 15 分钟", h=1.0)
node(ax, 5.2, 4.3, 3.0, "使用中 checked_in", sub="有唯一使用记录", h=0.85)
node(ax, 5.2, 2.3, 3.0, "已完成 completed", sub="使用记录已结算", h=0.85)
node(ax, 0.7, 2.3, 3.2, "已取消 cancelled", sub="开始前取消 · 不登记违规", h=0.85)
node(ax, 9.5, 2.3, 3.3, "未签到结束 unused_ended", sub="登记违规并通知", h=0.85)
node(ax, 9.5, 0.7, 3.3, "已取消（管理）", sub="使用中按确认时刻结算", h=0.85)

ax.add_patch(Circle((2.0, 6.9), 0.18, fc="#404040"))
arrow(ax, 2.0, 6.9, 5.2, 6.9, "创建预约", tdy=0.28)
arrow(ax, 6.7, 6.4, 6.7, 5.15, "扫码签到", tdy=0.22)
arrow(ax, 6.7, 4.3, 6.7, 3.15, "提前签退 / 到期自动结束", tdy=0.22)
arrow(ax, 5.2, 6.75, 3.9, 5.75, "开始前取消", rad=0.12, tdy=0.25)
arrow(ax, 8.2, 6.75, 9.9, 5.75, "未签到 / 主动放弃", rad=0.12, tdy=0.25)
arrow(ax, 8.2, 4.4, 9.9, 3.3, "资源管理取消", rad=0.12, tdy=0.25)
arrow(ax, 11.15, 2.3, 11.15, 1.6)

note(ax, "调度器每 10 秒推进状态结算；未签到与到期自动结束由签到截止判断类与预约服务统一判定。", 0.3)
save(fig, "fig4_预约状态图.png")

# ============================================================
# 图 5 预约创建顺序图
# ============================================================
W, H = 14.5, 9.6
fig, ax = plt.subplots(figsize=(14.5, 9.6))
clean(ax, W, H)
title(ax, "图 5  预约创建顺序图", W, H)

roles = ["用户浏览器", "预约控制器", "预约服务", "开放安排服务", "限制策略", "数据访问层", "消息服务"]
xs = [1.2, 3.3, 5.5, 7.7, 9.8, 11.9, 13.6]
for x, r in zip(xs, roles):
    node(ax, x - 0.95, 7.9, 1.9, r, h=0.65, name_fs=8.5)
    ax.plot([x, x], [0.85, 7.85], color=LINE, lw=1.0, ls=(0, (4, 3)))

def msg(ax, y, x1, x2, label, tdx=0.0):
    arrow(ax, x1, y, x2, y, lw=1.2)
    ax.text((x1 + x2) / 2 + tdx, y + 0.17, label, ha="center", va="bottom",
            fontsize=8, bbox=dict(fc="white", ec="none", pad=0.5))

msg(ax, 7.2, 1.2, 3.3, "POST /api/reservations")
msg(ax, 6.8, 3.3, 5.5, "createForClient(uid, req)")
msg(ax, 6.4, 5.5, 11.9, "lockBookings() 锁定互斥行")
msg(ax, 6.0, 5.5, 7.7, "requireSlot(seat, slot)", tdx=0.4)
msg(ax, 5.6, 7.7, 5.5, "开放窗口校验通过")
msg(ax, 5.2, 5.5, 9.8, "eligibility(uid)")
msg(ax, 4.8, 9.8, 5.5, "返回可预约资格")
msg(ax, 4.4, 5.5, 11.9, "冲突检查并插入预约记录")
msg(ax, 4.0, 11.9, 5.5, "返回预约记录")
msg(ax, 3.6, 5.5, 13.6, "reservation() 站内消息", tdx=0.3)
msg(ax, 3.2, 5.5, 11.9, "audit.record() 审计留痕", tdx=0.2)
msg(ax, 2.8, 5.5, 3.3, "返回动作结果")
msg(ax, 2.4, 3.3, 1.2, "HTTP {code, message, data}")

note(ax, "同步请求为实线箭头，返回为虚线语义；业务失败返回 4xx 并携带 details 投影，预约状态保持。", 0.5)
save(fig, "fig5_预约创建顺序图.png")

# ============================================================
# 图 6 数据实体关系图（ER 图）
# ============================================================
W, H = 14.0, 9.6
fig, ax = plt.subplots(figsize=(14.0, 9.6))
clean(ax, W, H)
title(ax, "图 6  核心数据实体关系图（ER 图）", W, H)

ents = [
    ("users 用户", 0.7, 7.3, 2.9, "id · username · campus_id|role · status"),
    ("restrictions 限制", 0.7, 4.4, 2.9, "user_id · starts_at · ends_at|source · released_at"),
    ("violations 违规", 0.7, 1.5, 2.9, "user_id · reservation_id|type · status"),
    ("appeals 申诉", 4.0, 1.5, 2.9, "violation_id · deadline|status · version"),
    ("rooms 空间", 5.5, 7.3, 2.9, "name · building · floor|enabled · version"),
    ("seats 座位", 5.5, 4.4, 2.9, "seat_no · zone|has_power · status"),
    ("reservations 预约", 5.5, 1.5, 2.9, "user_id · seat_id|res_date · start_time · end_time|status"),
    ("usage_records 使用记录", 9.0, 1.5, 2.9, "reservation_id 唯一|checkin_at · ended_at|origin"),
    ("complaints 投诉", 9.0, 4.4, 2.9, "user_id · type · status|service 字段"),
    ("complaint_events 事件", 9.0, 7.3, 2.9, "event_type · source|不可覆盖"),
    ("seat_codes 座位码", 12.1, 7.3, 1.8, "seat_id 主键|code_value"),
    ("notifications 消息", 12.1, 4.4, 1.8, "user_id|type · event_key"),
]
for name, x, y, w, sub in ents:
    node(ax, x, y, w, name, sub=sub, h=None, name_fs=9.5)

def rel(ax, x1, y1, x2, y2, label, rad=0.0, tdx=0.0):
    arrow(ax, x1, y1, x2, y2, label, lw=1.2, fs=7.8, rad=rad, tdx=tdx)

rel(ax, 2.15, 7.3, 2.15, 5.35, "1—N")
rel(ax, 2.15, 4.4, 2.15, 2.45, "1—N")
rel(ax, 3.5, 2.05, 4.0, 2.3, "1—N")
rel(ax, 6.95, 7.3, 6.95, 5.35, "1—N 包含")
rel(ax, 6.95, 4.4, 6.95, 2.5, "1—N 被预约")
rel(ax, 8.4, 2.1, 9.0, 2.35, "1—1 使用")
rel(ax, 10.45, 5.35, 10.45, 7.3, "1—N 事件")
rel(ax, 12.1, 7.3, 12.1, 5.35, "1—1")
# 预约 -> 投诉（折线）
ax.plot([6.95, 6.95], [1.5, 2.2], color=LINE, lw=1.2)
ax.plot([6.95, 9.0], [2.2, 2.2], color=LINE, lw=1.2)
ax.plot([9.0, 9.0], [2.2, 4.4], color=LINE, lw=1.2)
ax.text(8.0, 2.38, "1—N 投诉", ha="center", va="center", fontsize=7.8, color=LBL,
        bbox=dict(fc="white", ec="none", pad=0.5))
# 消息 -> 用户（折线）
ax.plot([12.1, 12.1], [4.4, 5.0], color=LINE, lw=1.2)
ax.plot([12.1, 11.5], [5.0, 5.0], color=LINE, lw=1.2)
ax.plot([11.5, 11.5], [5.0, 6.7], color=LINE, lw=1.2)
ax.plot([11.5, 3.6], [6.7, 6.7], color=LINE, lw=1.2)
ax.add_patch(FancyArrowPatch((3.6, 6.7), (3.6, 7.3), arrowstyle="-|>",
                             mutation_scale=13, color=LINE, lw=1.2))
ax.text(7.5, 6.88, "N—1", ha="center", va="center", fontsize=7.8, color=LBL,
        bbox=dict(fc="white", ec="none", pad=0.5))

note(ax, "关系线标注多重性（1、1—N、N—1）；完整字段与约束以数据库迁移脚本 V1—V31 为准。", 0.45)
save(fig, "fig6_数据实体关系图.png")

# ============================================================
# 图 7 核心设计类图
# ============================================================
W, H = 17.5, 12.2
fig, ax = plt.subplots(figsize=(17.5, 12.2))
clean(ax, W, H)
title(ax, "图 7  核心设计类图（节选）", W, H)

HEADER = 0.5
PAD = 0.32
LSP = 0.30
SEP = 0.18
BOT = 0.2

def uml(ax, x, y, w, name, attrs, methods):
    h = HEADER + PAD + len(attrs) * LSP + SEP + 0.10 + len(methods) * LSP + BOT
    ax.add_patch(Rectangle((x, y), w, h, fc="white", ec=NODE_EC, lw=1.3))
    ax.add_patch(Rectangle((x, y + h - HEADER), w, HEADER, fc="#F2F2F2", ec=NODE_EC, lw=1.0))
    ax.text(x + w / 2, y + h - HEADER / 2, name, ha="center", va="center",
            fontsize=10, fontweight="bold", color=NODE_TEXT)
    ay = y + h - HEADER - PAD
    for a in attrs:
        ax.text(x + 0.14, ay, a, fontsize=7.8, color=NODE_TEXT, va="center")
        ay -= LSP
    sep_y = ay + LSP - 0.10
    ax.plot([x, x + w], [sep_y, sep_y], color=NODE_EC, lw=0.9)
    ay = sep_y - SEP
    for m in methods:
        ax.text(x + 0.14, ay, m, fontsize=7.8, color="#1F4E79", va="center")
        ay -= LSP
    return h

def dep(ax, x1, y1, x2, y2):
    ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="-|>", mutation_scale=13,
                                 color=LINE, lw=1.2, linestyle=(0, (4, 3))))

row1_y, row2_y, row3_y = 9.6, 6.0, 2.2
x1a, x1b, x1c = 0.7, 6.3, 12.0
cw1, cw2 = 5.3, 5.5

hA = uml(ax, x1a, row1_y, cw1, "AvailabilityService 找座服务",
         ["- db / auth / clock / policy", "- bookings / opening"],
         ["+ find(uid, roomId, date, ...)", "+ reconcileAvailability()"])
hB = uml(ax, x1b, row1_y, cw2, "BookingService 预约服务",
         ["- db / clock / opening / policy", "- audit / violations / codes", "- usage / restrictions / messages"],
         ["+ createForClient(uid, req)", "+ checkin(uid, id, seatCode)", "+ action(uid, id, action)"])
hC = uml(ax, x1c, row1_y, cw1, "RestrictionWorkflow 限制工作流",
         ["- db / auth / policy", "- bookings / violations"],
         ["+ registerManualViolation()", "+ create(actor, req)", "+ release(actor, id, req)"])

hD = uml(ax, x1a, row2_y, cw1, "OpeningScheduleService 开放安排服务",
         ["- db / auth / audit / clock"],
         ["+ calendar(roomId)", "+ requireSlot(seat, slot)", "+ save / saveBlock"])
hE = uml(ax, x1b, row2_y, cw2, "RestrictionPolicy 限制策略",
         ["- db / audit / json / messages"],
         ["+ eligibility(uid) : 资格投影", "+ assess(uid, now)", "+ create / release / 重算"])
hF = uml(ax, x1c, row2_y, cw1, "Store 数据访问类（唯一 SQL 入口）",
         ["- jdbc : JdbcTemplate"],
         ["+ list / one / update / count", "+ insert(sql, ...) : id", "+ lockBookings()"])

x3 = [0.7, 5.2, 9.7, 14.2]
hG = uml(ax, x3[0], row3_y, 4.0, "UsageService 使用服务", ["- db"], ["+ start / finish / view"])
hH = uml(ax, x3[1], row3_y, 4.0, "BookingPolicy 预约规则", ["- clock", "MAX_ADVANCE_DAYS = 2"], ["+ validateDate / validate"])
hI = uml(ax, x3[2], row3_y, 4.0, "Slot 时间区间（记录类）", ["- date / start / end"], ["+ parse / overlaps", "+ startsAt / endsAt"])
hJ = uml(ax, x3[3], row3_y, 2.9, "ReservationDeadline 签到截止", ["- SIGN_IN_MINUTES = 15"], ["+ at / expiredPending"])

# 依赖箭头只走类框之间的空隙
dep(ax, x1a + cw1, row1_y + hA - 0.9, x1b, row1_y + hA - 0.9)
dep(ax, x1b + cw2, row1_y + hB - 0.9, x1c, row1_y + hB - 0.9)
dep(ax, x1a + cw1 / 2, row1_y, x1a + cw1 / 2, row2_y + hD)
dep(ax, x1b + cw2 / 2, row1_y, x1b + cw2 / 2, row2_y + hE)
dep(ax, x1c + cw1 / 2, row1_y, x1c + cw1 / 2, row2_y + hF)
dep(ax, x1b + cw2, row2_y + hE - 0.5, x1c, row2_y + hF - 0.5)
dep(ax, x1a + cw1 / 2, row2_y, x1a + cw1 / 2, row3_y + hG)
dep(ax, x1b + cw2 / 2, row2_y, x1b + cw2 / 2, row3_y + hH)
dep(ax, x1c + cw1 / 2, row2_y, x1c + cw1 / 2, row3_y + hI)

note(ax, "虚线箭头表示依赖（调用 / 编排 / 数据访问）；所有业务服务均依赖 Store 完成数据访问。", 0.45)
save(fig, "fig7_设计类图.png")

print("ALL DONE")
