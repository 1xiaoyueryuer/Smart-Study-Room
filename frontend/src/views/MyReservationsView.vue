<script setup>
import PageHelp from '../components/PageHelp.vue'
import {createRecordPager,recordFields} from '../composables/recordPage.js'
import RecordFilters from '../components/RecordFilters.vue'
import RecordPageControls from '../components/RecordPageControls.vue'

import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {hasCompletedReviewUsage as showReviewEntry, reviewReservationParam} from '../composables/reviewManagement.js'
import {checkinDeadlineOf} from '../composables/checkinDeadline.js'
import { formatCampusDateTime } from '../composables/campusDateTime.js'
import { message, confirmDialog } from '../components/ui/feedback'
import {
  listMyReservations, cancelReservation, abandonReservation,
  checkoutReservation, getReservation
} from '../api/reservation'
import SButton from '../components/ui/SButton.vue'
import STag from '../components/ui/STag.vue'
import SEmpty from '../components/ui/SEmpty.vue'
import SBanner from '../components/ui/SBanner.vue'
import UsageRecordSummary from '../components/UsageRecordSummary.vue'
import ReviewEditor from '../components/ReviewEditor.vue'

const router = useRouter()
const route=useRoute()
const reviewEditor=ref(null)
const linkedReservation=ref(null),linkedLoading=ref(false),linkedError=ref('');let linkedAlive=true,linkedSequence=0
const pager=createRecordPager(listMyReservations,{initial:{record_type:'reservation'},blocked:()=>busyId.value!==null}),fields=recordFields('reservation')
const {items:list,loading,error,filters,snapshot,snapshotQuery}=pager
const actionError = ref(''), busyId = ref(null), showViolationRecord = ref(false)
const actionResultId = ref(null), actionResult = ref('')

const statusMeta = {
  pending:     { text: '待签到',   type: 'warning' },
  checked_in:  { text: '使用中',   type: 'success' },
  completed:   { text: '已结束',   type: '' },
  cancelled:   { text: '已取消',   type: 'info' },
  unused_ended: { text:'未使用结束', type:'info' },
  violation: { text:'历史违约', type:'info' }
}
const sourceMeta = { manual: '手动选座', auto: '历史智能分配', waitlist: '历史候补递补' }
const terminationLabels = {user_cancelled:'开始前自行取消',abandon:'开始后主动放弃',no_show:'超时未签到',legacy_violation:'历史违约，不另计违规',early_checkout:'提前签退',auto_end:'到期自动结束',legacy_unclassified:'历史预约已结束',demo_completed:'演示预约已结束',temp_leave_timeout:'历史预约因暂离结束',admin_resource_change:'因自习室调整取消，不扣分',admin_restriction:'因预约受限取消，不扣分'}

function deadlineOf(row) { return checkinDeadlineOf(row) }
const pendingRows = computed(() => list.value.filter(row => row.status === 'pending' && deadlineOf(row)).slice(0, 3))

const load=()=>pager.refresh(true)
onBeforeUnmount(()=>{pager.dispose();linkedAlive=false;linkedSequence++})
async function getReservationDetails(id) {
  const { data } = await getReservation(id)
  if (data?.id !== id || typeof data.status !== 'string' || !Array.isArray(data.allowed_actions)) throw new Error('预约详情不完整')
  return data
}

async function readLinkedReservation() {
  const id = reviewReservationParam(route.query.reservation_id)
  const ticket = ++linkedSequence
  linkedReservation.value = null
  linkedError.value = ''
  if (id === null) {
    linkedLoading.value = false
    return
  }
  linkedLoading.value = true
  try {
    const data = await getReservationDetails(id)
    if (!linkedAlive || ticket !== linkedSequence) return
    linkedReservation.value = data
  } catch (failure) {
    if (linkedAlive && ticket === linkedSequence) {
      linkedError.value = failure.status === 403 || failure.status === 404 ? '这笔预约无法查看。' : '暂时无法加载这笔预约。'
    }
  } finally {
    if (linkedAlive && ticket === linkedSequence) linkedLoading.value = false
  }
}
function closeLinkedReservation(){linkedSequence++;linkedReservation.value=null;linkedError.value='';const query={...route.query};delete query.reservation_id;void router.replace({query})}
watch(()=>route.query.reservation_id,readLinkedReservation)

const actionVariant = {
  primary: 'primary',
  danger: 'soft-danger',
  warning: 'soft-warn',
  success: 'soft-success',
  info: 'soft'
}

const actionDefinitions = {
  checkin:{key:'checkin',label:'扫码签到',type:'primary'},
  cancel:{key:'cancel',label:'开始前取消',type:'danger'},
  abandon:{key:'abandon',label:'开始后放弃',type:'danger'},
  checkout:{key:'checkout',label:'提前签退',type:'primary'}
}
function actionsOf(row) {
  return Array.isArray(row.allowed_actions) ? row.allowed_actions.map(key=>actionDefinitions[key]).filter(Boolean) : []
}
const apiMap = { cancel:cancelReservation,abandon:abandonReservation,checkout:checkoutReservation }
async function refreshAll() {
  const [listLoaded] = await Promise.all([load(), readLinkedReservation()])
  return listLoaded
}
async function readActionResult() {
  const id = actionResultId.value
  if (id === null || busyId.value !== null) return
  busyId.value = id
  try {
    const listLoaded = await refreshAll()
    const row = (listLoaded && list.value.find(reservation => reservation.id === id))
      || (linkedReservation.value?.id === id ? linkedReservation.value : await getReservationDetails(id))
    if (!linkedAlive) return
    actionResultId.value = null
    if (row.termination_reason === 'no_show') {
      actionError.value = '预约已因超时未签到结束，记一次违规。'
      showViolationRecord.value = true
      return
    }
    actionError.value = ''
    actionResult.value = statusMeta[row.status]?.text ? `这笔预约当前状态为「${statusMeta[row.status].text}」。` : '已查询这笔预约的最新状态。'
  } catch {
    if (linkedAlive) actionError.value = '暂时查不到这笔预约的最新状态。'
  } finally {
    if (linkedAlive) busyId.value = null
  }
}
function requestOccupationHelp(row) { if (!loading.value && !error.value && busyId.value === null) return router.push({name:'complaints',query:{type:'occupation',reservation_id:String(row.id)}}) }
async function doAction(row, key) {
  if (loading.value || error.value || busyId.value !== null || !actionsOf(row).some(action=>action.key===key)) return
  if (key === 'checkin') { await router.push({ name: 'checkin', params: { id: row.id } }); return }
  const reservationId = row.id
  busyId.value = reservationId
  actionError.value = ''
  showViolationRecord.value = false
  actionResultId.value = null
  actionResult.value = ''
  try {
    if (key==='cancel' || key==='abandon') {
      try {
        await confirmDialog(key==='cancel' ? '开始前取消不扣信用分。' : '放弃后会释放座位，并登记一次违规，扣 10 分。', key==='cancel'?'取消预约':'放弃预约', {confirmButtonText:key==='cancel'?'确认取消':'确认放弃',type:'warning'})
      } catch { return }
    }
    if (key === 'checkout') {
      try { await confirmDialog('签退后，座位会立即释放。这次签退不扣分。', '提前签退', { confirmButtonText: '确认签退', type: 'warning' }) }
      catch { return }
    }
    try {
      await apiMap[key](reservationId)
      message.success(`${actionDefinitions[key].label}成功`)
    } catch (failure) {
      if (failure.status === 409 && failure.details?.termination_reason === 'no_show') {
        actionError.value = '预约已因超时未签到结束，记一次违规。'
        showViolationRecord.value = true
      } else if (failure.status === 409 && failure.details?.status === 'completed') {
        actionError.value = '预约已结束，可在这笔预约下查看使用记录。'
      } else if (failure.status === 409) {
        actionError.value = '这笔预约的状态已变化。'
      } else if (failure.status == null || failure.status === 408 || failure.status >= 500) {
        actionError.value = '暂时无法确认这次操作的结果。'
        actionResultId.value = reservationId
      } else {
        actionError.value = failure.message
      }
    }
    if (actionResultId.value === null) await refreshAll()
  } finally { busyId.value = null }
  if (linkedAlive && actionResultId.value === reservationId) await readActionResult()
}

const filtered=list,pageItems=list

onMounted(async()=>{await refreshAll();const target=reviewReservationParam(route.query.review_reservation_id);if(target!==null)await reviewEditor.value?.open(target)})

</script>

<template>
  <div v-reveal class="page-view">
    <header class="view-heading has-page-help"><div class="heading-copy" data-page-title>
      <h1>我的预约</h1>
    </div><PageHelp title="预约帮助">
        <ul class="tips">
          <li>到场后，在预约卡片显示的截止时间前扫描座位二维码。</li>
          <li>开始前取消不扣分。开始后放弃或超时未签到会扣 10 分。</li>
          <li>提前离开时可以签退，把座位留给下一位。</li>
        </ul>
      </PageHelp></header>
    <!-- 我的预约：页面级双栏 = 左状态筛选 | 右列表 -->
    <div class="mine-stack">
      <section v-if="pendingRows.length" class="pending-strip" aria-label="待签到预约">
        <article v-for="row in pendingRows" :key="row.id" class="pending-card">
          <div class="pending-head">
            <STag type="warning" dot>待签到</STag>
            <span class="pending-room">{{ row.room_name }} · {{ row.seat_no }}</span>
          </div>
          <div class="pending-time">{{ row.res_date }} {{ row.start_time.slice(0, 5) }}—{{ row.end_time.slice(0, 5) }}</div>
          <div class="pending-deadline">
            签到截止 <b>{{ deadlineOf(row).text }}</b>
            <span v-if="deadlineOf(row).extended" class="ext-hint">已延期</span>
          </div>
          <div class="row-actions">
            <SButton v-for="a in actionsOf(row)" :key="a.key" size="sm" :variant="actionVariant[a.type]" :disabled="busyId !== null" @click="doAction(row, a.key)">{{ a.label }}</SButton>
            <SButton size="sm" variant="soft" :disabled="busyId !== null" @click="requestOccupationHelp(row)">座位被占求助</SButton>
          </div>
        </article>
      </section>

      <section class="card mine-card">
        <div class="card-title-row">
          <h3>预约与使用记录</h3>
          <SButton size="sm" :disabled="loading||busyId!==null" @click="refreshAll">刷新</SButton>
        </div>
        <RecordFilters v-model="filters" :fields="fields" :disabled="loading||busyId!==null" @apply="pager.apply" />

        <p v-if="loading" role="status">正在更新预约…</p>
        <SBanner v-if="error" type="error" :title="error"><SButton size="sm" :disabled="loading || busyId !== null" @click="refreshAll">重新加载预约</SButton></SBanner>
        <SBanner v-if="actionError" type="error" :title="actionError">
          <RouterLink v-if="showViolationRecord" to="/profile#violations">查看违规记录</RouterLink>
          <SButton v-if="actionResultId !== null" size="sm" :disabled="loading || busyId !== null" @click="readActionResult">查询预约状态</SButton>
        </SBanner>
        <p v-if="actionResult" role="status">{{ actionResult }}</p>
        <div v-list-motion="pageItems.map(row => row.id + row.status).join()" class="table-wrap mine-table-wrap">
          <div class="table-scroll no-x" v-loading="loading" aria-label="预约记录">
            <table class="table mine-table">
              <colgroup>
                <col style="width:11%" />
                <col style="width:14%" />
                <col style="width:8%" />
                <col style="width:18%" />
                <col style="width:30%" />
                <col style="width:19%" />
              </colgroup>
              <thead>
                <tr>
                  <th>日期 / 时段</th>
                  <th>自习室 / 座位</th>
                  <th>来源</th>
                  <th>状态</th>
                  <th>使用记录</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in pageItems" :key="row.id">
                  <td class="num"><b>{{ row.res_date }}</b><div class="time-line">{{ row.start_time.slice(0, 5) }}–{{ row.end_time.slice(0, 5) }}</div></td>
                  <td class="room-cell"><div class="room-name" :title="row.room_name">{{ row.room_name }}</div><div class="seat-line">座位 {{ row.seat_no }}</div></td>
                  <td><STag>{{ sourceMeta[row.source] || row.source }}</STag></td>
                  <td class="status-cell">
                    <STag :type="statusMeta[row.status]?.type" dot :line="row.status === 'cancelled'">{{ statusMeta[row.status]?.text || row.status }}</STag>
                    <div v-if="deadlineOf(row) && ['pending','checked_in'].includes(row.status)" class="deadline-line" :class="{ extended: deadlineOf(row).extended }">
                      签到截止 <b>{{ deadlineOf(row).text }}</b>
                      <span v-if="deadlineOf(row).extended">（原 {{ deadlineOf(row).baseText }}，已延期）</span>
                    </div>
                    <div class="termination-detail">{{ terminationLabels[row.termination_reason] || row.termination_reason || '—' }}</div>
                    <div v-if="['admin_resource_change','admin_restriction'].includes(row.termination_reason) && row.termination_note" class="termination-detail">取消原因：{{ row.termination_note }}</div>
                    <div v-if="row.ended_at" class="termination-detail">结束：{{ formatCampusDateTime(row.ended_at) }}</div>
                    <div v-if="row.legacy_status === 'temp_leave'" class="termination-detail">历史预约曾登记暂离。</div>
                  </td>
                  <td class="usage-cell">
                    <UsageRecordSummary :record="row.usage_record" />
                    <div v-if="row.legacy_status === 'temp_leave' && row.leave_at" class="termination-detail">暂离时间：{{ formatCampusDateTime(row.leave_at) }}</div>
                    <SButton v-if="showReviewEntry(row)" class="usage-review-button" size="sm" variant="soft" :disabled="loading || !!error || busyId !== null" @click="reviewEditor?.open(row.id)">评价这次使用</SButton>
                  </td>
                  <td class="actions-cell">
                    <span class="row-actions">
                      <SButton v-for="a in actionsOf(row)" :key="a.key" size="sm" :variant="actionVariant[a.type]" :disabled="loading || !!error || busyId !== null" :loading="busyId === row.id" @click="doAction(row, a.key)">{{ a.label }}</SButton>
                      <SButton size="sm" variant="soft" :disabled="loading || !!error || busyId !== null" @click="requestOccupationHelp(row)">座位被占求助</SButton>
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
            <SEmpty v-if="!filtered.length && !loading && !error" description="当前筛选条件下暂无预约记录" />
          </div>
        </div>
        <RecordPageControls :snapshot="snapshot" :query="snapshotQuery" :fields="fields" :disabled="loading||busyId!==null" @page="pager.turn"/>
      </section>

      <section v-if="route.query.reservation_id" class="card">
        <div class="card-title-row">
          <h3>预约详情</h3>
          <div class="row-actions">
            <SButton v-if="linkedReservation" size="sm" :disabled="linkedLoading || busyId !== null" @click="readLinkedReservation">更新详情</SButton>
            <SButton size="sm" @click="closeLinkedReservation">关闭详情</SButton>
          </div>
        </div>
        <p v-if="linkedLoading" role="status">正在加载预约详情…</p>
        <SBanner v-if="linkedError" type="error" :title="linkedError">
          <SButton size="sm" :disabled="linkedLoading || busyId !== null" @click="readLinkedReservation">重新加载详情</SButton>
        </SBanner>
        <template v-if="linkedReservation">
          <h4>{{ linkedReservation.room_name }} · {{ linkedReservation.seat_no }}</h4>
          <p>{{ linkedReservation.res_date }} {{ linkedReservation.start_time }}—{{ linkedReservation.end_time }}</p>
          <STag :type="statusMeta[linkedReservation.status]?.type">{{ statusMeta[linkedReservation.status]?.text || linkedReservation.status }}</STag>
          <p v-if="deadlineOf(linkedReservation)" class="linked-deadline">
            签到截止 <b>{{ deadlineOf(linkedReservation).text }}</b>
            <span v-if="deadlineOf(linkedReservation).extended">（已延期，原 {{ deadlineOf(linkedReservation).baseText }}）</span>
          </p>
          <p v-if="linkedReservation.termination_reason">{{ terminationLabels[linkedReservation.termination_reason] || linkedReservation.termination_reason }}</p>
          <UsageRecordSummary :record="linkedReservation.usage_record" />
          <div class="row-actions">
            <SButton v-for="action in actionsOf(linkedReservation)" :key="action.key" :disabled="busyId !== null" @click="doAction(linkedReservation, action.key)">{{ action.label }}</SButton>
            <SButton v-if="showReviewEntry(linkedReservation)" variant="soft" :disabled="busyId !== null" @click="reviewEditor?.open(linkedReservation.id)">评价这次使用</SButton>
          </div>
        </template>
      </section>

      <ReviewEditor ref="reviewEditor"/>
    </div>
  </div>
</template>

<style scoped>


.kpi-lg .kpi-num { font-size: 24px; }
.mine-stack { display: flex; flex-direction: column; gap: 16px; }
.mine-card { min-width: 0; }
.mine-table-wrap { margin-top: 20px; overflow: hidden; }
.mine-table-wrap .table-scroll { overflow-x: hidden; }
.mine-table { width: 100%; table-layout: fixed; }
.mine-table th, .mine-table td { padding: 10px; vertical-align: top; font-size: 13px; }
.mine-table thead th { font-size: 11px; }
.mine-table .num b { display: block; color: var(--text-1); font-weight: 600; font-variant-numeric: tabular-nums; }
.time-line { color: var(--text-3); font-size: 12px; margin-top: 3px; }
.room-cell { min-width: 0; }
.room-name { color: var(--text-1); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.seat-line { color: var(--text-3); font-size: 12px; margin-top: 3px; }
.status-cell, .usage-cell { min-width: 0; }
.usage-review-button { margin-top: 8px; }
.status-cell .termination-detail { max-width: none; }
.actions-cell .row-actions { display: flex; flex-wrap: wrap; gap: 6px; white-space: normal; }
.actions-cell :deep(.s-btn) { font-size: 11px; }
.deadline-line { margin-top: 6px; color: var(--text-3); font-size: var(--fs-caption); white-space: nowrap; }
.deadline-line b { color: var(--text-1); font-variant-numeric: tabular-nums; }
.deadline-line.extended b { color: var(--amber-strong); }
.pending-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
.pending-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 18px 20px;
  background: linear-gradient(160deg, #fffdf8, #faf3e4);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-1);
}
.pending-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.pending-room { color: var(--text-2); font-size: var(--fs-body-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pending-time { font-family: var(--font-display); font-size: 20px; color: var(--text-1); }
.pending-deadline { color: var(--text-2); font-size: var(--fs-body-sm); display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
.pending-deadline b { font-family: var(--font-display); font-size: 24px; color: var(--primary); font-variant-numeric: tabular-nums; }
.ext-tag { background: var(--amber-weak); color: var(--amber-strong); border-radius: var(--r-full); padding: 2px 8px; font-size: 11px; }
.ext-hint { color: var(--text-4); font-size: 11px; }
.pending-card .row-actions { margin-top: auto; }
.linked-deadline { color: var(--text-2); font-size: var(--fs-body-sm); }
.linked-deadline b { color: var(--amber-strong); font-variant-numeric: tabular-nums; }
.termination-detail { font-size:var(--fs-caption); max-width:240px; overflow-wrap:anywhere; color:var(--text-3); margin-top:5px; }
</style>
