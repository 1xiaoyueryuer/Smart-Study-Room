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
  <div v-reveal class="page-view home-page">
    <header class="home-hello" data-page-title>
      <p class="hello-date">{{ todayText }}</p>
      <h1>{{ greeting }}，{{ who }}</h1>
    </header>

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

    <div class="home-layout">
      <div class="home-main">
        <section class="hero">
          <div class="hero-copy">
            <p class="hero-eyebrow">静阅 · 专注空间</p>
            <h2 :class="{ 'hero-title-admin': auth.isAdmin }">{{ auth.isAdmin ? '今日运营，一目了然' : '今日宜专注' }}</h2>
            <p class="hero-sub">{{ auth.isAdmin ? '查看真实使用统计与待办，安排今天的开放资源' : '预约你的专属座位，让每一次坐下都算数' }}</p>
            <SButton variant="primary" size="lg" @click="router.push(auth.isAdmin ? '/analytics' : '/booking')">
              {{ auth.isAdmin ? '查看统计' : '立即预约' }}
            </SButton>
          </div>
          <div class="hero-art" aria-hidden="true">
            <svg viewBox="0 0 520 300" fill="none">
              <rect x="24" y="52" width="472" height="210" rx="18" fill="var(--primary-weak)" opacity=".45" />
              <path d="M60 210h400v18H60z" fill="#b98d5f" opacity=".55" />
              <path d="M60 228h400v10H60z" fill="#a97c4e" opacity=".35" />
              <path d="M120 88h120v104H120z" fill="#fffdf8" stroke="#cfc2a9" stroke-width="3" />
              <path d="M120 120h120M120 152h120" stroke="#e0d6c2" stroke-width="2" />
              <path d="M132 100h44M132 112h66M132 132h58M132 144h40M132 164h64M132 176h48" stroke="#c9bda6" stroke-width="5" stroke-linecap="round" />
              <path d="M300 92c0-16 12-28 28-28h4v122h-32z" fill="#e3d6bd" />
              <path d="M345 136c0-10 8-18 18-18s18 8 18 18" stroke="#8a6a44" stroke-width="5" stroke-linecap="round" />
              <path d="M363 136v46" stroke="#8a6a44" stroke-width="5" stroke-linecap="round" />
              <path d="M336 182h56" stroke="#8a6a44" stroke-width="5" stroke-linecap="round" />
              <path d="M392 172c10-22 28-34 52-34" stroke="#4c7a5c" stroke-width="4" stroke-linecap="round" />
              <path d="M404 158c-2-14 4-26 16-32M414 148c10 0 18 6 22 16" stroke="#4c7a5c" stroke-width="4" stroke-linecap="round" />
              <circle cx="452" cy="92" r="22" fill="#f2d8a8" opacity=".7" />
            </svg>
          </div>
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
          <StudyTips :title="auth.isOrdinary ? '使用须知' : '管理提示'">
            <ul v-if="auth.isOrdinary" class="tips tips-list">
              <li>可预约当天至后天，单次至少 30 分钟，起止在开放空档内自选。</li>
              <li>开始前取消不记违规；开始后未签到放弃记一次违约。</li>
              <li>签到窗口为开始时刻起至开始后 15 分钟；本系统当前不提供签到延期。</li>
              <li>短暂离开不延长原结束时间；提前签退释放剩余时段。</li>
            </ul>
            <ul v-else class="tips tips-list">
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
            <h3>{{ auth.isAdmin ? '今日概览' : '我的概览' }}</h3>
            <RouterLink v-if="auth.isAdmin" to="/analytics" class="text-link">详细统计</RouterLink>
          </div>
          <p v-if="auth.isAdmin && statsLoading" class="muted">正在加载统计…</p>
          <p v-if="auth.isAdmin" class="muted" role="status">{{ statsVisible ? '页面可见时每 10 秒刷新。' : '页面已隐藏，刷新暂停。' }}</p>
          <SBanner v-if="auth.isAdmin && statsError" type="error" :title="statsError"><SButton size="sm" @click="loadStats">重试统计</SButton></SBanner>

          <div v-if="auth.isAdmin" class="mini-kpis">
            <div><SAnimatedNumber v-if="inUseNow !== null" :value="inUseNow" /><span v-else>—</span><small>使用中</small></div>
            <div><SAnimatedNumber v-if="openAvailableSeats !== null" :value="openAvailableSeats" /><span v-else>—</span><small>开放可用</small></div>
            <div><span>{{ currentUsageText }}</span><small>使用比例</small></div>
            <div><SAnimatedNumber v-if="complaintTodoCount !== null" :value="complaintTodoCount" /><span v-else>—</span><small>投诉待办</small></div>
          </div>
          <div v-else class="mini-kpis">
            <div><span>{{ pendingCount }}</span><small>待签到</small></div>
            <div><span>{{ checkedInCount }}</span><small>使用中</small></div>
            <div><span>{{ completedCount }}</span><small>已结束</small></div>
            <div><span>{{ totalCount }}</span><small>累计预约</small></div>
          </div>
          <p v-if="auth.isAdmin && statsOverview" class="snapshot">快照 {{ statsSnapshotText }}</p>
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

.hero {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 38%;
  gap: 12px;
  min-height: 280px;
  padding: 34px 36px;
  border: 1px solid var(--border);
  border-radius: var(--r-2xl);
  background:
    radial-gradient(120% 130% at 92% 12%, rgba(47, 93, 70, .10), transparent 55%),
    linear-gradient(135deg, #fbf7ec 0%, #f3ecdc 100%);
  overflow: hidden;
}
.hero-copy { display: flex; flex-direction: column; justify-content: center; align-items: flex-start; min-width: 0; }
.hero-eyebrow { color: var(--primary); font-size: 12px; letter-spacing: .22em; }
.hero h2 {
  margin: 10px 0 8px;
  font-size: clamp(38px, 4.2vw, 60px);
  line-height: 1.1;
  color: #2a3f33;
  letter-spacing: .04em;
  white-space: nowrap;
}
.hero h2.hero-title-admin { font-size: clamp(30px, 3.2vw, 46px); }
.hero-sub { color: var(--text-2); font-size: 16px; margin-bottom: 24px; }
.hero-art { display: flex; align-items: center; justify-content: center; min-width: 0; }
.hero-art svg { width: 100%; max-width: 520px; height: auto; }

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
  .hero { grid-template-columns: 1fr; padding: 26px 22px; }
  .hero-art { display: none; }
  .home-hello h1 { font-size: 28px; }
  .quick-grid { grid-template-columns: 1fr; }
}
</style>
