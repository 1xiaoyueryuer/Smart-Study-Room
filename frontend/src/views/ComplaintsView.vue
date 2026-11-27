<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { listMyComplaints, getComplaint } from '../api/complaint'
import { complaintStatuses, complaintCategory, complaintNumber, isFacilityRepair, parseRepair } from '../composables/complaintForm.js'
import { formatCampusDateTime } from '../composables/campusDateTime.js'
import { useServiceTargetClock } from '../composables/useServiceTargetClock.js'
import ComplaintForm from '../components/ComplaintForm.vue'
import ComplaintRecord from '../components/ComplaintRecord.vue'
import SButton from '../components/ui/SButton.vue'
import SBanner from '../components/ui/SBanner.vue'
import SEmpty from '../components/ui/SEmpty.vue'
import {createRecordPager,recordFields} from '../composables/recordPage.js'
import RecordPageControls from '../components/RecordPageControls.vue'

const route = useRoute()
const auth = useAuthStore()
const pager = createRecordPager(listMyComplaints, { initial: { type: '' } })
const fields = recordFields('complaint')
const {items, loading, loaded, error, filters, snapshot, snapshotQuery} = pager
const formComponent = ref(null)
const formOpen = ref(false)
const category = ref('all')
const selectedId = ref(null)
const detail = ref(null)
const detailLoading = ref(false)
const detailError = ref('')
let detailSequence = 0, alive = true

// 本次记录保留在前端页面：列表快照、分类与选中项缓存在 sessionStorage（按账号隔离）
const cacheKey = () => `studyroom:complaints:${auth.user?.id || 'anonymous'}`
function readCache() {
  try {
    const raw = sessionStorage.getItem(cacheKey())
    if (!raw) return null
    const value = JSON.parse(raw)
    return value && Array.isArray(value.items) && value.snapshot ? value : null
  } catch { return null }
}
function writeCache() {
  try {
    if (!loaded.value || !snapshot.value) return
    sessionStorage.setItem(cacheKey(), JSON.stringify({
      items: items.value, snapshot: snapshot.value, snapshotQuery: snapshotQuery.value,
      category: category.value, selectedId: selectedId.value, detail: detail.value,
      savedAt: Date.now()
    }))
  } catch { /* 存储不可用时不影响页面 */ }
}
function restoreCache(value) {
  category.value = value.category || 'all'
  // 先恢复选中项与详情，再恢复列表，避免列表监听器自动改选第一条
  if (value.detail) { detail.value = value.detail; selectedId.value = value.selectedId ?? value.detail.id }
  else if (value.selectedId) selectedId.value = value.selectedId
  items.value = value.items
  snapshot.value = value.snapshot
  snapshotQuery.value = value.snapshotQuery
  loaded.value = true
}

const targetClock = useServiceTargetClock({records: items, blocked: computed(() => loading.value || !!formComponent.value?.targetReadBlocked), onDue: () => load()})
const load = () => pager.refresh()

const categories = [
  {key: 'all', label: '全部'},
  {key: 'occupation', label: '预约与座位'},
  {key: 'facility', label: '设施报修'},
  {key: 'other', label: '其他服务'}
]

const visibleItems = computed(() => {
  if (category.value === 'all') return items.value
  if (category.value === 'occupation') return items.value.filter(item => item.type === 'occupation')
  if (category.value === 'facility') return items.value.filter(item => item.type === 'service' && isFacilityRepair(item))
  return items.value.filter(item => item.type === 'service' && !isFacilityRepair(item))
})

function categoryOf(item) { return complaintCategory(item.type, item.description, item.service_kind) }
function roomOf(item) { return item.context_snapshot?.room_name || (item.room_id ? `空间#${item.room_id}` : '未关联空间') }
function titleOf(item) {
  const repair = parseRepair(item.description)
  if (repair) return `${repair.faultType || '设施'}故障`
  if (item.service_kind === 'other_service' && item.service_topic) return item.service_topic
  const first = String(item.description || '').split(/\r?\n/).find(line => line.trim() && !line.startsWith('【')) || '求助与投诉'
  return first.length > 24 ? first.slice(0, 24) + '…' : first
}
function timeOf(item) {
  return formatCampusDateTime(item.submitted_at)
}

// 切换分类只在已加载的记录里筛选，保留页面上的记录、不重新请求后端
function selectCategory(key) {
  if (loading.value) return
  category.value = key
}

async function selectItem(item) {
  selectedId.value = item.id
  const ticket = ++detailSequence
  detailLoading.value = true
  detailError.value = ''
  detail.value = null
  try {
    const response = await getComplaint(item.id)
    if (!alive || ticket !== detailSequence) return
    if (response.data?.id !== item.id) throw new Error('详情返回不完整')
    detail.value = response.data
  } catch (failure) {
    if (alive && ticket === detailSequence) detailError.value = failure.message
  } finally {
    if (alive && ticket === detailSequence) detailLoading.value = false
  }
}

function closeDetail() {
  selectedId.value = null
  detail.value = null
  detailError.value = ''
  detailSequence++
}

function created(id) {
  formOpen.value = false
  const previous = selectedId.value
  return load().then(() => {
    const target = items.value.find(item => item.id === id)
    if (target) return selectItem(target)
    // 新记录不在当前页时，保留原选中项，不跳页、不清空详情
    const kept = previous && items.value.find(item => item.id === previous)
    if (kept) return selectItem(kept)
  })
}

function toggleForm() {
  formOpen.value = !formOpen.value
}

watch(items, (value) => {
  if (!value.length) {
    if (!detail.value) selectedId.value = null
    return
  }
  if (!selectedId.value && !detail.value) selectItem(value[0])
}, {immediate: true})

watch([items, snapshot, category, selectedId, detail], writeCache)

watch(() => route.query, (query) => {
  if (query.reservation_id || query.type) formOpen.value = true
}, {immediate: true})

const CACHE_FRESH_MS = 2 * 60 * 1000
onMounted(() => {
  const cached = readCache()
  if (!cached) { load(); return }
  restoreCache(cached)
  // 2 分钟内的缓存直接使用；更久则先用缓存渲染，再后台静默刷新（列表不隐藏）
  if (!cached.savedAt || Date.now() - cached.savedAt > CACHE_FRESH_MS) void load()
})
onBeforeUnmount(() => {
  writeCache()
  alive = false; detailSequence++; pager.dispose()
})
</script>

<template>
  <div class="page-view complaints-page">
    <header class="view-heading with-action" data-page-title>
      <div class="heading-copy">
        <h1>求助与投诉</h1>
        <p class="heading-sub">预约与座位问题、设施报修、其他服务反馈；提交后等待受理与核实。</p>
      </div>
      <SButton variant="primary" @click="toggleForm">{{ formOpen ? '收起表单' : '＋ 新建求助' }}</SButton>
    </header>

    <section v-if="formOpen" class="card form-panel">
      <ComplaintForm ref="formComponent" :initial-type="String(route.query.type || 'service')" :initial-reservation-id="route.query.reservation_id || null" @created="created" />
    </section>

    <div class="complaint-workbench">
      <section class="card list-panel">
        <nav class="complaint-tabs" aria-label="求助类型">
          <button v-for="tab in categories" :key="tab.key" type="button" :class="{active: category === tab.key}" :disabled="loading" @click="selectCategory(tab.key)">{{ tab.label }}</button>
        </nav>
        <SBanner v-if="error" type="error" :title="error"><SButton size="sm" @click="load">重试列表</SButton></SBanner>
        <p v-if="loading && !loaded" role="status">正在读取本人求助与投诉…</p>
        <ul v-if="items.length" class="ticket-list">
          <li v-for="item in visibleItems" :key="item.id">
            <button type="button" class="ticket-item" :class="{active: selectedId === item.id}" @click="selectItem(item)">
              <span class="ticket-top">
                <span class="pill" :class="item.status === 'closed' ? 'pill-success' : item.status === 'submitted' ? 'pill-neutral' : 'pill-warning'">{{ complaintStatuses[item.status] || item.status }}</span>
                <b class="ticket-code">{{ complaintNumber(item.id) }}</b>
              </span>
              <b class="ticket-title">{{ titleOf(item) }}</b>
              <small class="ticket-meta">{{ categoryOf(item) }} · {{ roomOf(item) }}</small>
              <small class="ticket-time">提交时间 {{ timeOf(item) }}</small>
            </button>
          </li>
        </ul>
        <SEmpty v-if="loaded && !error && !visibleItems.length" :description="items.length ? '该分类暂无记录，可切换「全部」查看' : '暂无记录，可新建求助'" />
        <RecordPageControls :snapshot="snapshot" :query="snapshotQuery" :fields="fields" :disabled="loading" @page="pager.turn" />
      </section>

      <section class="card detail-panel">
        <div class="detail-head">
          <h3>详情</h3>
          <div class="row-actions">
            <RouterLink v-if="selectedId" :to="`/complaints/${selectedId}`" class="text-link">打开完整页面</RouterLink>
            <SButton v-if="selectedId" size="sm" @click="closeDetail">关闭</SButton>
          </div>
        </div>
        <p v-if="detailLoading" role="status">正在读取本人详情…</p>
        <SBanner v-if="detailError" type="error" :title="detailError"><SButton size="sm" @click="selectItem({id:selectedId})">重试详情</SButton></SBanner>
        <ComplaintRecord v-if="detail && !detailLoading" :record="detail" :target-progress="targetClock.progress(detail)" compact />
        <SEmpty v-else-if="!detailLoading && !detailError" description="从左侧选择一条记录查看详情" />
      </section>
    </div>
  </div>
</template>

<style scoped>
.complaints-page { max-width: 1480px; }
.view-heading.with-action { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; }
.form-panel { margin-bottom: 20px; }
.complaints-page>.card,.complaint-workbench>.card{border:1px solid var(--border-strong);box-shadow:0 3px 14px rgba(50,45,34,.055)}
.complaint-workbench { display: grid; grid-template-columns: minmax(300px, 380px) minmax(0, 1fr); gap: 20px; align-items: start; }
.list-panel { display: flex; flex-direction: column; min-width: 0; max-height: calc(100vh - 240px); }
.complaint-tabs { display: flex; flex-wrap: wrap; gap: 4px; padding-bottom: 12px; border-bottom: 1px solid var(--hairline); margin-bottom: 10px; }
.complaint-tabs button {
  all: unset;
  padding: 7px 12px;
  border-radius: var(--r-md);
  color: var(--text-2);
  font-size: var(--fs-body-sm);
  cursor: pointer;
  white-space: nowrap;
}
.complaint-tabs button:hover { background: var(--surface-2); color: var(--text-1); }
.complaint-tabs button.active { background: var(--primary-weak); color: var(--primary-active); font-weight: 600; }
.ticket-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; min-height: 0; }
.ticket-item {
  all: unset;
  display: grid;
  gap: 6px;
  width: 100%;
  box-sizing: border-box;
  padding: 14px 15px;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--surface);
  cursor: pointer;
  transition: border-color var(--dur-1) var(--ease), background var(--dur-1) var(--ease), transform var(--dur-1) var(--ease);
}
.ticket-item:hover { border-color: var(--border-strong); transform: translateY(-1px); }
.ticket-item.active { border-color: var(--primary); background: var(--primary-faint); }
.ticket-item b { color: var(--text-1); font-size: 15px; font-weight: 600; line-height: 1.45; }
.ticket-item small { color: var(--text-3); font-size: 11px; line-height: 1.5; }
/* 参考图排版：状态与单号同一行（左右分布），标题、分类·位置、时间各占一行 */
.ticket-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.ticket-item .ticket-top .pill { justify-self: auto; }
.ticket-item .ticket-code { color: var(--text-3); font-size: 11.5px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: .02em; }
.ticket-item .ticket-title { color: var(--text-1); font-size: 15px; font-weight: 700; line-height: 1.45; }
.ticket-item .ticket-meta { color: var(--text-2); font-size: 12px; }
.ticket-item .ticket-time { color: var(--text-3); font-size: 11px; font-variant-numeric: tabular-nums; }
.detail-panel { min-width: 0; min-height: 420px; }
.detail-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 12px; margin-bottom: 14px; border-bottom: 1px solid var(--hairline); }
.text-link { color: var(--primary); font-size: var(--fs-caption); text-decoration: none; }
.text-link:hover { text-decoration: underline; }
@media (max-width: 960px) {
  .complaint-workbench { grid-template-columns: 1fr; }
  .list-panel { max-height: none; }
  .view-heading.with-action { align-items: flex-start; flex-direction: column; }
}
</style>
