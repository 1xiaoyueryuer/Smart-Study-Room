<script setup>
import StudyTips from '../components/StudyTips.vue'
import SAnimatedNumber from '../components/ui/SAnimatedNumber.vue'
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useNotificationStore } from '../stores/notification'
import { listMyReservations } from '../api/reservation'
import { getOverview } from '../api/stats'
import { listNotifications } from '../api/notification'
import { validOverview, ratioText } from '../composables/statsForm.js'
import { createStatsRefresh } from '../composables/statsRefresh.js'
import { checkinDeadlineOf, deadlineLabel } from '../composables/checkinDeadline.js'
import { formatCampusDateTime } from '../composables/campusDateTime.js'
import AppIcon from '../components/AppIcon.vue'
import SBanner from '../components/ui/SBanner.vue'
import SButton from '../components/ui/SButton.vue'

const router = useRouter()
const auth = useAuthStore()
const notifStore = useNotificationStore()

const who = computed(() => auth.user?.real_name || auth.user?.username || '同学')
const todayText = computed(() =>
  new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
)
const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 6) return '夜深了'
  if (h < 12) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
})

const statsOverview = ref(null)
const statsError = ref('')
const statsLoading = ref(false)
const statsVisible = ref(true)
const unread = computed(() => notifStore.unread)
let unreadTimer = null
let disposed = false

const openAvailableSeats = computed(() => statsOverview.value?.current.open_available_seats ?? null)
const inUseNow = computed(() => statsOverview.value?.current.in_use_now ?? null)
const complaintTodoCount = computed(() => statsOverview.value?.current.complaint_todo_count ?? null)
const currentUsageText = computed(() => statsOverview.value ? ratioText(statsOverview.value.current.usage_ratio) : '尚未读取')
const statsSnapshotText = computed(() => statsOverview.value ? formatCampusDateTime(statsOverview.value.snapshot_at) : '')

// 本人最近一条有效预约：报告只要求本人记录，不做学习时长/排名等个人统计。
const reservations = ref([])
const reservationsLoading = ref(false)
const reservationsError = ref('')
const activeReservations = computed(() => reservations.value.filter(row => ['pending','checked_in'].includes(row.status)))

// 学生个人概览指标
const pendingCount = computed(() => reservations.value.filter(row => row.status === 'pending').length)
const checkedInCount = computed(() => reservations.value.filter(row => row.status === 'checked_in').length)
const completedCount = computed(() => reservations.value.filter(row => row.status === 'completed').length)
const totalCount = computed(() => reservations.value.length)

// 管理取消登录提示卡：只展示服务端真实通知，不伪造确认状态。
const cancellations = ref([])
async function loadCancellations() {
  if (!auth.isOrdinary) return
  try {
    const response = await listNotifications({ page: 1, page_size: 3, type: 'management_cancelled' })
    cancellations.value = (response.data?.items || []).filter(item => item.type === 'management_cancelled')
  } catch { cancellations.value = [] }
}

function refreshUnread() {
  notifStore.refresh()
}

async function loadReservations() {
  if (!auth.isOrdinary) return
  reservationsLoading.value = true
  reservationsError.value = ''
  try {
    const response = await listMyReservations({ page: 1, page_size: 20 })
    reservations.value = response.data?.items || []
  } catch (error) {
    reservationsError.value = error.message
  } finally {
    reservationsLoading.value = false
  }
}

const statsRefresh = createStatsRefresh({onVisibility:visible=>{statsVisible.value=visible},resources:{overview:{
  read:async()=>{
    if (!auth.isAdmin) return null
    const actor=auth.user?.id
    try { const response=await getOverview();return {actor,data:response.data} }
    catch(error) { if(!auth.isAdmin||auth.user?.id!==actor)return null;throw error }
  },
  success:result=>{
    if(!result||!auth.isAdmin||auth.user?.id!==result.actor)return null
    if(!validOverview(result.data))throw new Error('统计回执不完整，请重新读取')
    statsOverview.value=result.data;return result.data
  },
  failure:error=>{statsError.value=error.message||'统计读取失败'},
  loading:value=>{statsLoading.value=value;if(value)statsError.value=''}
}}})
function loadStats(){if(auth.isAdmin)return statsRefresh.refresh('overview')}

onMounted(async () => {
  if(auth.isAdmin){statsRefresh.select('overview',{});statsRefresh.start()}
  await Promise.all([loadReservations(), loadCancellations()])
  if (disposed) return
  refreshUnread()
  unreadTimer = setInterval(refreshUnread, 30000)
})

onUnmounted(() => {
  disposed = true
  statsRefresh.stop()
  if (unreadTimer) {
    clearInterval(unreadTimer)
    unreadTimer = null
  }
})

const shortcuts = computed(() => auth.isAdmin
  ? [
      { title: '热力图统计', desc: '真实使用记录 · 近七日趋势', icon: 'analytics', to: '/analytics' },
      { title: '管理端', desc: '自习室 · 座位 · 用户', icon: 'admin', to: '/admin' },
      { title: '个人中心', desc: '账户资料与联系方式', icon: 'profile', to: '/profile' }
    ]
  : [
      { title: '座位预约', desc: '按楼层分区选座 · 图列表双视图', icon: 'booking', to: '/booking' },
      { title: '我的预约', desc: '扫码签到 · 提前签退 · 使用记录', icon: 'reservations', to: '/mine' },
      { title: '求助与投诉', desc: '预约问题 · 设施报修 · 服务反馈', icon: 'ticket', to: '/complaints' },
      { title: '消息中心', desc: unread.value > 0 ? `${unread.value} 条未读` : '预约与反馈通知', icon: 'notification', to: '/notifications' }
    ])

// 自习室种类卡片：四个分区（与设计稿一致），入口统一去预约页。
const zones = [
  { key: 'A', name: 'A区', img: '/images/zone-a.jpg' },
  { key: 'B', name: 'B区', img: '/images/zone-b.jpg' },
  { key: 'C', name: 'C区', img: '/images/zone-c.jpg' },
  { key: 'D', name: 'D区', img: '/images/zone-d.jpg' }
]

function statusText(row) {
  return ({ pending: '待签到', checked_in: '使用中', completed: '已结束' })[row.status] || row.status
}
function statusPillClass(row) {
  return ({ pending: 'pill-warning', checked_in: 'pill-success', completed: 'pill-neutral' })[row.status] || 'pill-plain'
}
function timeText(row) {
  const start = (row.start_time || '').slice(0, 5)
  const end = (row.end_time || '').slice(0, 5)
  return `${row.res_date} ${start}—${end}`
}
</script>

<template>
  <div v-reveal class="page-view home-page" :class="{ 'home-page--user': auth.isOrdinary }">
    <!-- ===== 管理员端：维持原布局不变 ===== -->
    <template v-if="auth.isAdmin">
      <header class="home-hello" data-page-title>
        <p class="hello-date">{{ todayText }}</p>
        <h1>{{ greeting }}，{{ who }}</h1>
      </header>

      <div class="home-layout">
        <div class="home-main">
          <section class="hero">
            <div class="hero-copy">
              <p class="hero-eyebrow">静阅 · 专注空间</p>
              <h2 class="hero-title-admin">今日运营，一目了然</h2>
              <p class="hero-sub">查看真实使用统计与待办，安排今天的开放资源</p>
              <SButton variant="primary" size="lg" class="hero-cta" @click="router.push('/analytics')">查看统计</SButton>
            </div>
            <img class="hero-photo" src="/images/home-hero.jpg" alt="" aria-hidden="true" />
          </section>

          <section class="card quick-card">
            <div class="card-title-row"><h3>常用功能</h3><span class="muted">快速进入对应业务</span></div>
            <div class="quick-grid">
              <button v-for="s in shortcuts" :key="s.to" type="button" class="quick-item" @click="router.push(s.to)">
                <span class="quick-icon"><AppIcon :name="s.icon" :size="22" /></span>
                <span class="quick-copy"><b>{{ s.title }}</b><small>{{ s.desc }}</small></span>
                <AppIcon class="quick-arrow" name="chevron-right" :size="16" />
              </button>
            </div>
          </section>

          <div class="tips-anchor">
            <StudyTips title="管理提示">
              <ul class="tips tips-list">
                <li>资源变更先预览影响清单，确认后管理取消受影响预约，不记用户违约。</li>
                <li>投诉先受理再核实，未知身份不归责；设施报修由系统按影响范围和安全风险自动分级，存在安全风险固定5级。</li>
                <li>统计快照每 10 秒刷新，失败保留上次成功值与时间。</li>
                <li>评价隐藏后本人修改不自动恢复公开，需管理员复核。</li>
              </ul>
            </StudyTips>
          </div>
        </div>

        <aside class="home-side">
          <section class="card overview-card">
            <div class="card-title-row">
              <h3>今日概览</h3>
              <RouterLink to="/analytics" class="text-link">详细统计</RouterLink>
            </div>
            <p v-if="statsLoading" class="muted">正在加载统计…</p>
            <p class="muted" role="status">{{ statsVisible ? '页面可见时每 10 秒刷新。' : '页面已隐藏，刷新暂停。' }}</p>
            <SBanner v-if="statsError" type="error" :title="statsError"><SButton size="sm" @click="loadStats">重试统计</SButton></SBanner>

            <div class="mini-kpis">
              <div><SAnimatedNumber v-if="inUseNow !== null" :value="inUseNow" /><span v-else>—</span><small>使用中</small></div>
              <div><SAnimatedNumber v-if="openAvailableSeats !== null" :value="openAvailableSeats" /><span v-else>—</span><small>开放可用</small></div>
              <div><span>{{ currentUsageText }}</span><small>使用比例</small></div>
              <div><SAnimatedNumber v-if="complaintTodoCount !== null" :value="complaintTodoCount" /><span v-else>—</span><small>投诉待办</small></div>
            </div>
            <p v-if="statsOverview" class="snapshot">快照 {{ statsSnapshotText }}</p>
          </section>

          <section class="card schedule-card">
            <div class="card-title-row">
              <h3>我的学习安排</h3>
              <RouterLink to="/mine" class="text-link">全部记录</RouterLink>
            </div>
            <p v-if="reservationsLoading" class="muted">正在读取本人预约…</p>
            <SBanner v-else-if="reservationsError" type="error" :title="reservationsError"><SButton size="sm" @click="loadReservations">重试</SButton></SBanner>
            <div v-else-if="activeReservations.length" class="schedule-list">
              <article v-for="row in activeReservations" :key="row.id" class="schedule-item">
                <div class="schedule-head">
                  <h4>{{ row.room_name }} · {{ row.seat_no }}</h4>
                  <span class="pill" :class="statusPillClass(row)">{{ statusText(row) }}</span>
                </div>
                <p class="schedule-time">{{ timeText(row) }}</p>
                <p v-if="checkinDeadlineOf(row)" class="schedule-deadline">签到截止 <b>{{ deadlineLabel(checkinDeadlineOf(row)) }}</b></p>
                <div class="schedule-actions">
                  <SButton v-if="row.status === 'pending'" variant="primary" size="sm" @click="router.push(`/mine/${row.id}/checkin`)">去签到</SButton>
                  <SButton variant="soft" size="sm" @click="router.push('/mine')">查看详情</SButton>
                </div>
              </article>
            </div>
            <div v-else class="empty-schedule">
              <AppIcon name="desk-book" :size="30" class="empty-icon" />
              <p>今天还没有安排学习，挑一个合适的座位开始吧。</p>
              <SButton variant="primary" block @click="router.push('/booking')">去选座</SButton>
            </div>
          </section>
        </aside>
      </div>
    </template>

    <!-- ===== 用户端：新版首页（设计稿） ===== -->
    <template v-else>
      <section v-if="cancellations.length" class="cancel-notice">
        <div class="cancel-copy">
          <span class="pill pill-warning">资源管理取消</span>
          <h3>{{ cancellations[0].title }}</h3>
          <p>{{ cancellations[0].content }}</p>
          <p class="cancel-meta">本次管理取消不记本人违规；预计恢复时间以系统可预约状态为准。无需专程到场确认，已到场或需要帮助可点“需要协助”。</p>
        </div>
        <div class="cancel-actions">
          <SButton variant="primary" @click="router.push('/notifications')">查看通知</SButton>
          <SButton variant="soft" @click="router.push('/booking')">重新选座</SButton>
          <SButton variant="soft" @click="router.push({name:'complaints',query:{type:'service'}})">需要协助</SButton>
        </div>
      </section>

      <div class="hero-zone">
        <section class="hero-full">
          <div class="hero-inner">
            <div class="hero-copy">
              <p class="hero-eyebrow" data-page-title>
                <span class="eyebrow-dash" aria-hidden="true" />
                <span>静阅 · 专注空间</span>
              </p>
              <h1 class="hero-title">
                <span class="hero-title-line">今日宜专注，</span>
                <span class="hero-title-line">让每一次坐下都<span class="hero-title-gold">算数</span></span>
              </h1>
              <p class="hero-sub">预约专属座位，找到一段不被打扰的学习时光</p>
            </div>
          </div>
          <div class="hero-bottom">
            <div class="hero-actions">
              <button type="button" class="hero-btn hero-btn--solid" @click="router.push('/booking')">立即预约</button>
              <button type="button" class="hero-btn hero-btn--outline" @click="router.push('/mine')">我的预约</button>
            </div>
            <div class="hero-kpis">
              <div class="hero-kpi"><b>{{ pendingCount }}</b><span>待签到</span></div>
              <div class="hero-kpi"><b>{{ checkedInCount }}</b><span>使用中</span></div>
              <div class="hero-kpi"><b>{{ completedCount }}</b><span>已结束</span></div>
              <div class="hero-kpi"><b>{{ totalCount }}</b><span>累计预约</span></div>
            </div>
          </div>
        </section>

        <!-- 右上角黑板面板：我的学习安排（保留原有数据与入口） -->
        <aside class="board" aria-label="我的学习安排">
          <div class="board-surface">
            <div class="board-head">
              <h3>
                <svg class="board-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 11h18" /></svg>
                <span>我的学习安排</span>
              </h3>
              <RouterLink to="/mine" class="board-link">全部历史 ›</RouterLink>
            </div>
            <p v-if="reservationsLoading" class="board-hint">正在读取本人预约…</p>
            <p v-else-if="reservationsError" class="board-hint">{{ reservationsError }}</p>
            <ul v-else-if="activeReservations.length" class="board-list">
              <li v-for="row in activeReservations.slice(0, 3)" :key="row.id">
                <RouterLink v-if="row.status === 'pending'" :to="`/mine/${row.id}/checkin`" class="board-item">
                  <b>{{ row.room_name }} · {{ row.seat_no }}</b>
                  <small>{{ timeText(row) }}</small>
                  <em>{{ statusText(row) }}</em>
                </RouterLink>
                <RouterLink v-else :to="'/mine'" class="board-item">
                  <b>{{ row.room_name }} · {{ row.seat_no }}</b>
                  <small>{{ timeText(row) }}</small>
                  <em>{{ statusText(row) }}</em>
                </RouterLink>
              </li>
            </ul>
            <template v-else>
              <p class="board-hint">今天还没有安排学习</p>
              <RouterLink to="/booking" class="board-cta">去选座</RouterLink>
            </template>
          </div>
        </aside>
      </div>

      <section class="zone-section">
        <div class="zone-head">
          <h3>自习室列表</h3>
          <span class="zone-head-meta">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            按开放时间选择学习空间
          </span>
        </div>
        <div class="zone-grid">
          <article v-for="z in zones" :key="z.key" class="zone-card">
            <img class="zone-photo" :src="z.img" alt="" aria-hidden="true" />
            <div class="zone-body">
              <h4>{{ z.name }}</h4>
              <button type="button" class="zone-cta" @click="router.push('/booking')">去预约</button>
            </div>
          </article>
        </div>
      </section>

      <div class="user-bottom">
        <StudyTips title="使用须知">
          <ul class="tips tips-list">
            <li>可预约当天至后天，单次至少 30 分钟，起止在开放空档内自选。</li>
            <li>开始前取消不记违规；开始后未签到放弃记一次违约。</li>
            <li>签到窗口为开始时刻起至开始后 15 分钟；本系统当前不提供签到延期。</li>
            <li>短暂离开不延长原结束时间；提前签退释放剩余时段。</li>
          </ul>
        </StudyTips>
      </div>
    </template>
  </div>
</template>

<style scoped>
.home-page { padding-top: 22px; }
.home-hello { margin: 0 2px 22px; }
.hello-date { color: var(--text-3); font-size: var(--fs-body-sm); letter-spacing: .04em; }
.home-hello h1 { margin-top: 6px; font-size: 34px; color: var(--text-1); }
.home-layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 24px; }
.cancel-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 22px;
  padding: 18px 22px;
  border: 1px solid var(--amber-weak);
  border-radius: var(--r-xl);
  background: var(--amber-faint);
}
.cancel-copy { min-width: 0; }
.cancel-copy h3 { margin: 8px 0 4px; font-size: 20px; color: var(--text-1); }
.cancel-copy p { color: var(--text-2); font-size: var(--fs-body-sm); line-height: 1.6; }
.cancel-meta { color: var(--text-3) !important; font-size: 11px !important; margin-top: 6px; }
.cancel-actions { display: flex; flex-wrap: wrap; gap: 8px; flex: 0 0 auto; }
@media (max-width: 760px) { .cancel-notice { flex-direction: column; align-items: flex-start; } }
.home-main { min-width: 0; display: flex; flex-direction: column; gap: 20px; }
.home-side { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.tips-anchor { margin-top: auto; min-width: 0; }
.home-side .schedule-card { flex: 1 1 auto; }

/* ============ 用户端新版首页（按参考图） ============ */
/* 整页底色：浅薄荷白 */
.home-page--user { background: #eef5f4; box-shadow: 0 0 0 100vmax #eef5f4; padding-top: 28px; }

/* 顶部区：照片整幅铺满上半屏，文字/按钮/统计由 HTML 渲染 */
.hero-zone { position: relative; margin-bottom: 34px; }
.hero-full {
  position: relative;
  /* 冲出版心 padding，左右铺到视口边缘 */
  margin: -28px calc(50% - 50vw) 0;
  /* 与照片同比例铺满，背景 100% 100% 不裁切，黑板面板可按百分比与照片位置精确对齐 */
  aspect-ratio: 1487 / 469;
  padding: 0;
  background: #24322e url('/images/home-hero-room.jpg') 0 0 / 100% 100% no-repeat;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
/* 左侧压暗 + 右下压暗：保证文字与统计在照片上的可读性 */
.hero-full::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(95deg, rgba(8, 16, 18, .62) 0%, rgba(8, 16, 18, .34) 36%, rgba(8, 16, 18, .06) 62%, transparent 76%),
    radial-gradient(120% 130% at 100% 100%, rgba(6, 12, 10, .55), transparent 58%);
  pointer-events: none;
}
.hero-inner {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 1560px;
  margin: 0 auto;
  padding: 56px 40px 24px;
}
.hero-copy { max-width: 100%; }
.hero-full .hero-eyebrow { display: flex; align-items: center; gap: 14px; color: rgba(255, 255, 255, .9); font-size: 15px; letter-spacing: .28em; }
.eyebrow-dash { width: 46px; height: 1px; background: rgba(255, 255, 255, .75); flex: 0 0 auto; }
.hero-title {
  margin: 16px 0 16px;
  font-family: var(--font-display);
  font-size: clamp(30px, 4.5vw, 62px);
  font-weight: 700;
  line-height: 1.16;
  letter-spacing: .02em;
  color: #ffffff;
  text-shadow: 0 6px 30px rgba(4, 10, 12, .45);
}
.hero-title-line { display: block; white-space: nowrap; }
.hero-title-gold { color: #fbd266; }
/* 提高优先级，避免被管理员 hero 的同名规则覆盖 */
.hero-full .hero-sub { max-width: 620px; color: rgba(255, 255, 255, .95); font-size: clamp(15px, 1.1vw, 17px); line-height: 1.7; text-shadow: 0 2px 14px rgba(4, 10, 12, .5); }

/* 底部一行：按钮（左）与统计卡（右）同一水平线 */
.hero-bottom {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 1560px;
  margin: 0 auto;
  padding: 0 40px 46px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 28px;
  flex-wrap: wrap;
}
.hero-actions { display: flex; flex-wrap: wrap; gap: 14px; }
.hero-btn {
  all: unset;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 56px;
  padding: 0 40px;
  border-radius: 10px;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: .02em;
  cursor: pointer;
  transition: transform var(--dur-1) var(--ease), background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease);
}
.hero-btn:focus-visible { outline: 2px solid #f2e6c4; outline-offset: 3px; }
.hero-btn--solid { background: #135e4d; color: #f7f6f0; box-shadow: 0 10px 26px rgba(4, 16, 12, .32); }
.hero-btn--solid:hover { background: #17705b; transform: translateY(-1px); }
.hero-btn--outline { background: transparent; color: #ffffff; border: 1px solid rgba(255, 255, 255, .8); }
.hero-btn--outline:hover { background: rgba(255, 255, 255, .14); transform: translateY(-1px); }

/* 四个统计指标：数字 + 标签，竖线分隔，无卡片底色 */
.hero-kpis { display: flex; align-items: stretch; }
.hero-kpi { min-width: 96px; padding: 0 26px; text-align: center; border-left: 1px solid rgba(255, 255, 255, .32); }
.hero-kpi:first-child { border-left: 0; }
.hero-kpi b { display: block; font-family: var(--font-display); font-size: 34px; font-weight: 600; line-height: 1.1; color: #ffffff; font-variant-numeric: tabular-nums; text-shadow: 0 2px 16px rgba(4, 10, 12, .5); }
.hero-kpi span { display: block; margin-top: 8px; font-size: 13px; color: rgba(255, 255, 255, .85); }

/* 右上角黑板面板：我的学习安排（位置/尺寸按照片比例，完整覆盖背景中的面板区域） */
.board { position: absolute; top: 14.5%; right: 4.2%; width: 26.9%; min-height: 44%; z-index: 3; }
.board-surface {
  padding: 22px 24px;
  border-radius: 16px;
  background: #22473a;
  box-shadow: 0 18px 40px rgba(4, 14, 10, .35);
  color: #e9f1ea;
}
.board-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.board-head h3 { display: flex; align-items: center; gap: 9px; margin: 0; font-size: 19px; font-weight: 700; letter-spacing: .02em; color: #f4f8f2; }
.board-icon { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; flex: 0 0 auto; }
.board-link { color: rgba(226, 238, 226, .78); font-size: 12.5px; text-decoration: none; white-space: nowrap; }
.board-link:hover { color: #ffffff; }
.board-hint { margin: 16px 0 0; color: rgba(226, 238, 226, .82); font-size: 14px; }
.board-list { list-style: none; margin: 16px 0 0; padding: 0; display: grid; gap: 9px; }
.board-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 3px 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, .07);
  color: #eaf2e9;
  text-decoration: none;
}
.board-item:hover { background: rgba(255, 255, 255, .13); }
.board-item b { font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
.board-item em { font-style: normal; font-size: 11.5px; color: #cfe3cf; white-space: nowrap; }
.board-item small { grid-column: 1 / -1; font-size: 12px; color: #b2c4b2; font-variant-numeric: tabular-nums; }
.board-cta { display: inline-block; margin-top: 16px; padding: 8px 18px; border-radius: 999px; background: #f2f0e3; color: #1e3a2d; font-size: 13px; font-weight: 600; text-decoration: none; }
.board-cta:hover { background: #ffffff; }

.user-bottom { margin-top: 8px; }

/* 自习室列表 */
.zone-section { margin-bottom: 26px; }
.zone-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 2px 18px; }
.zone-head h3 { display: flex; align-items: center; margin: 0; font-size: 26px; font-weight: 700; color: #182420; font-family: var(--font-display); }
.zone-head h3::before { content: ''; width: 6px; height: 26px; border-radius: 3px; background: #135e4d; margin-right: 14px; flex: 0 0 auto; }
.zone-head-meta { display: inline-flex; align-items: center; gap: 7px; color: #5d6f68; font-size: 13px; }
.zone-head-meta svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.zone-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; }
.zone-card { background: #ffffff; border: 0; border-radius: 16px; overflow: hidden; box-shadow: 0 6px 20px rgba(30, 50, 44, .08); transition: transform var(--dur-2) var(--ease), box-shadow var(--dur-2) var(--ease); }
.zone-card:hover { transform: translateY(-3px); box-shadow: 0 12px 28px rgba(30, 50, 44, .14); }
.zone-photo { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: cover; }
.zone-body { padding: 14px 18px; display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: 12px; }
.zone-body h4 { margin: 0; font-size: 22px; font-weight: 700; color: #1b2724; font-family: var(--font-display); }
.zone-cta { all: unset; padding: 8px 20px; border-radius: 999px; background: #135e4d; color: #f6f7f1; font-size: 14px; font-weight: 600; cursor: pointer; transition: background var(--dur-1) var(--ease); }
.zone-cta:hover { background: #17705b; }
.zone-cta:focus-visible { outline: 2px solid #135e4d; outline-offset: 3px; }

@media (max-width: 1200px) and (min-width: 901px) {
  .hero-inner { padding: 32px 28px 10px; }
  .hero-bottom { padding: 0 28px 28px; }
  .hero-title { font-size: clamp(24px, 3.9vw, 44px); }
  .hero-bottom .hero-btn { height: 50px; padding: 0 28px; font-size: 16px; }
  .hero-kpi { min-width: 64px; padding: 0 14px; }
  .hero-kpi b { font-size: 26px; }
  .hero-kpi span { font-size: 12px; margin-top: 6px; }
  .board-surface { padding: 16px 18px; }
  .board-head h3 { font-size: 16px; gap: 7px; }
  .board-icon { width: 17px; height: 17px; }
  .board-link { font-size: 11.5px; }
  .board-hint { margin-top: 10px; font-size: 12.5px; }
  .board-cta { margin-top: 10px; padding: 6px 14px; font-size: 12px; }
  .zone-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 900px) {
  .zone-grid { grid-template-columns: 1fr; }
  .hero-full {
    aspect-ratio: auto;
    min-height: clamp(420px, 62vh, 560px);
    background-image: url('/images/home-hero-room-m.jpg');
    background-size: cover;
    background-position: center;
  }
  .hero-inner { padding: 30px 20px 16px; }
  .hero-title { font-size: clamp(26px, 8.2vw, 42px); }
  .hero-bottom { padding: 0 20px 24px; flex-direction: column; align-items: flex-start; gap: 16px; }
  .hero-actions { gap: 10px; }
  .hero-btn { height: 48px; padding: 0 26px; font-size: 16px; }
  .hero-kpis { width: 100%; }
  .hero-kpi { flex: 1 1 0; min-width: 0; padding: 0 10px; }
  .hero-kpi b { font-size: 26px; }
  .board { position: static; width: auto; max-width: 420px; min-height: 0; margin: 18px 0 0 auto; }
  .zone-head h3 { font-size: 22px; }
  .home-hello h1 { font-size: 28px; }
  .quick-grid { grid-template-columns: 1fr; }
}

.hero {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 42%;
  gap: 12px;
  min-height: 320px;
  padding: 40px 36px;
  border: 1px solid var(--border);
  border-radius: var(--r-2xl);
  background:
    radial-gradient(120% 130% at 10% 0%, rgba(251, 245, 229, .95), transparent 58%),
    linear-gradient(100deg, #fbf5e5 0%, #f7f0de 52%, #efe7d4 100%);
  overflow: hidden;
}
.hero-copy { position: relative; z-index: 1; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; min-width: 0; }
.hero-eyebrow { color: #d9cba4; font-size: 12px; letter-spacing: .22em; }
.hero h2 {
  margin: 10px 0 8px;
  font-size: clamp(38px, 4.2vw, 60px);
  line-height: 1.1;
  color: #14291f;
  letter-spacing: .04em;
  white-space: nowrap;
}
.hero h2.hero-title-admin { font-size: clamp(30px, 3.2vw, 46px); }
.hero-sub { color: #1f3a2b; font-size: 16px; margin-bottom: 24px; }
.hero-photo {
  position: absolute;
  top: 0;
  right: 0;
  height: 100%;
  width: 58%;
  object-fit: cover;
  object-position: right center;
  pointer-events: none;
  /* 左缘渐变蒙版：照片向奶油背景淡出，避免裁图阴影带形成硬分界 */
  -webkit-mask-image: linear-gradient(to right, transparent 0%, rgba(0, 0, 0, .45) 12%, #000 26%);
  mask-image: linear-gradient(to right, transparent 0%, rgba(0, 0, 0, .45) 12%, #000 26%);
}

/* 设计稿同款深绿胶囊主按钮 */
.hero .hero-cta {
  --btn-height: 52px;
  --btn-padding: 30px;
  --btn-font: 15.5px;
  margin-top: 4px;
  background: #204637;
  border-radius: 999px;
  box-shadow: 0 12px 26px rgba(32, 70, 55, .28);
}
.hero .hero-cta:hover { background: #2a5746; }

/* 常用功能网格：放大入口，两两一行 */
.quick-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
.quick-item {
  all: unset;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 24px 22px;
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  background: var(--surface);
  cursor: pointer;
  transition: transform var(--dur-2) var(--ease), box-shadow var(--dur-2) var(--ease), border-color var(--dur-2) var(--ease);
}
.quick-item:hover { transform: translateY(-2px); box-shadow: var(--shadow-2); border-color: var(--primary-weak); }
.quick-icon { width: 58px; height: 58px; flex: 0 0 58px; border-radius: 50%; display: grid; place-items: center; background: var(--primary-weak); color: var(--primary); }
.quick-copy { flex: 1; min-width: 0; }
.quick-copy b { display: block; font-size: 17px; color: var(--text-1); font-weight: 600; }
.quick-copy small { display: block; margin-top: 4px; color: var(--text-3); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.quick-arrow { color: var(--text-3); flex: 0 0 auto; }

/* 我的学习安排：四行竖排，条目填满卡片 */
.schedule-card { display: flex; flex-direction: column; }
.schedule-list { flex: 1; display: flex; flex-direction: column; gap: 14px; }
.schedule-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  text-align: center;
  padding: 16px 18px;
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  background: var(--surface-2);
}
.schedule-head { display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap; }
.schedule-head h4 { margin: 0; font-family: var(--font-display); font-size: 18px; color: var(--text-1); }
.schedule-time { margin: 10px 0 0; color: var(--text-2); font-size: var(--fs-body-sm); font-variant-numeric: tabular-nums; }
.schedule-deadline { margin: 8px 0 0; color: var(--text-3); font-size: var(--fs-body-sm); }
.schedule-deadline b { color: var(--amber-strong); font-variant-numeric: tabular-nums; }
.schedule-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; justify-content: center; }
.empty-schedule { display: grid; gap: 14px; justify-items: center; text-align: center; padding: 18px 0 6px; color: var(--text-3); }
.empty-icon { color: var(--primary-weak); }
.empty-schedule p { margin: 0; }

/* 概览 KPI */
.mini-kpis { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin: 14px 0 6px; }
.mini-kpis > div { background: var(--surface-2); border-radius: var(--r-md); padding: 14px 12px; text-align: center; }
.mini-kpis span { display: block; font-family: var(--font-display); font-size: 26px; color: var(--text-1); }
.mini-kpis small { display: block; margin-top: 4px; color: var(--text-3); font-size: 12px; }
.snapshot { color: var(--text-4); font-size: 11px; margin-top: 6px; }
.text-link { color: var(--primary); font-size: var(--fs-caption); text-decoration: none; }
.text-link:hover { text-decoration: underline; }

@media (max-width: 1200px) {
  .home-layout { grid-template-columns: minmax(0, 1fr); }
  .home-side { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
  .tips-anchor { margin-top: 0; }
}
@media (max-width: 760px) {
  .hero { grid-template-columns: 1fr; padding: 26px 22px; min-height: 300px; }
  .hero-photo { display: none; }
  .home-hello h1 { font-size: 28px; }
  .quick-grid { grid-template-columns: 1fr; }
}
</style>
