# 首页 Hero 区视觉改版功能代码实施方案

F13。实际范围、设计规格与验收例见同目录架构方案；本文件记录实际实现与验证结果。

## 实际改动

1. `frontend/src/views/HomeView.vue`（仅模板与样式，script 段 0 行改动）：
   - hero 模板：删除手绘 SVG `hero-art`，新增装饰图 `<img class="hero-photo" src="/images/home-hero.jpg" alt="" aria-hidden="true">`；CTA 按钮加 `hero-cta` class（仍为 SButton primary + lg，跳转逻辑不变）。
   - hero 样式：背景改 `radial-gradient + linear-gradient(100deg,#fbf5e5,#f7f0de 52%,#efe7d4)`；标题 #14291f、副标题 #1f3a2b、眉题 #d9cba4；新增 `.hero-photo`（absolute 右、高 100%、宽 46%、object-fit cover、右对齐）与 `.hero .hero-cta` 胶囊覆盖（#204637 底、白字、999px 圆角、52px 高、阴影）；网格改 `minmax(0,1fr) 46%`、min-height 320px；≤760px 隐藏照片、min-height 300px。
2. 新增 `frontend/public/images/home-hero.jpg`（1440×839，225,249 字节）：自用户设计稿裁剪 x1950..3872 × 全高后缩放，JPEG q90。裁剪左缘保留设计稿原有柔影过渡，落地后由 `object-fit: cover` 裁去冗余空白。

## 实际验证

- 生产构建：`npm run build` 通过（1.4s），仅既有 chunk 体积提示（SeatScene/AnalyticsView，与本次无关）。
- 前端 node 测试：307 条，306 通过、1 失败。唯一失败为 `tests/roles.test.js:115`（期望 HomeView 导出 `loadRooms/rooms/roomOpeningText`），经核实 HEAD 版本同样无这些导出、本次 diff 未触及 script 段，属既有失败，非本次引入；已在仓库记录待处理，不在本步范围内擅自实现该首页取房功能。
- 浏览器实测（dev 服务器 5174，真实登录「模拟学生1」）：
  - 1440×900：hero 986×320，照片 453×318 贴右缘，文字列右缘 557 < 照片左缘 572，无重叠。
  - 934×708：照片 406×318，副标题右缘 345 与照片左缘 497 留 152px；CTA 背景 rgb(32,70,55)、圆角 999px、白字、52px 高；标题 rgb(20,41,31)。
  - 400×800：照片 display none，hero 300px 单列正常。
  - 图片加载成功（naturalWidth 1440×839）。

## 迭代修正

- 2026-11-26 用户反馈：照片左缘与背景之间有明显的竖向分界线。原因：裁剪素材左侧的柔影带色深于 hero 背景渐变，衔接处形成硬边。修正：`.hero-photo` 增加左缘渐变蒙版（`linear-gradient(to right, transparent 0%, rgba(0,0,0,.45) 12%, #000 26%)`，含 -webkit- 前缀），照片在左缘淡出融入奶油背景。构建通过，浏览器实测蒙版生效；淡化幅度如仍不自然可原位调百分比。
- 2026-11-26 用户反馈：右侧画面偏少。修正：`.hero-photo` 宽度 46%→58%，网格改 `minmax(0,1fr) 42%`。实测 934 视口照片 406→512px、1440 视口 453→571px，文字内容右缘仍与照片左缘保持 46px/89px 间距，左缘蒙版保留衔接。
- 2026-11-26 F14 起：本 hero 视觉仅应用于管理员端首页，普通用户首页改版见 F14-用户端首页改版。

## 未验证项

- 未做人工视觉走查：本模型无图像输入，无法直接核对渲染效果与设计稿的视觉一致性；已用 DOM 几何与计算样式测量代替，素材与参数可在用户反馈后原位微调。
- 未对管理员账号做浏览器实测（模板分支与原实现相同，仅文案不同，风险低）。
