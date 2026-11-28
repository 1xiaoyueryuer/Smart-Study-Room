<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { getReservation, checkinReservation } from '../api/reservation'
import { createSeatScanner } from '../composables/seatScanner.js'
import { checkinDeadlineOf } from '../composables/checkinDeadline.js'
import SButton from '../components/ui/SButton.vue'
import SBanner from '../components/ui/SBanner.vue'
import UsageRecordSummary from '../components/UsageRecordSummary.vue'
const props = defineProps({ id: { type: [String, Number], required: true } })
const reservation = ref(null), loading = ref(false), detailError = ref(''), scanError = ref(''), scanNotice = ref(''), uncertainResult = ref(false), accepted = ref(false), success = ref(false), submitting = ref(false), decoding = ref(false), cameraActive = ref(false), video = ref(null)
const insecureContext = globalThis.isSecureContext === false
const checkinAvailable = computed(() => reservation.value?.allowed_actions?.includes('checkin'))
const canCheckin = computed(() => !loading.value && !detailError.value && !accepted.value &&
  !uncertainResult.value && checkinAvailable.value)
const needsResultCheck = computed(() => uncertainResult.value || (accepted.value && !success.value && !!scanNotice.value))
const deadline = computed(() => checkinDeadlineOf(reservation.value))
const checkinStatus = computed(() => {
  const row = reservation.value
  if (!row || checkinAvailable.value) return ''
  switch (row.status) {
    case 'pending': return row.allowed_actions?.includes('cancel') ? `${row.start_time} 开始签到` : '当前无法签到'
    case 'unused_ended': return row.termination_reason === 'no_show' ? '已错过签到，预约已结束' : '预约已结束'
    case 'checked_in': return '已签到，可以开始自习'
    case 'completed': return '本次自习已结束'
    case 'cancelled': return '预约已取消'
    default: return '当前无法签到'
  }
})
let loadSequence = 0, reservationScope = 0, disposed = false
const scanner = createSeatScanner({ onCode: submitCode, onError: text => { scanError.value = text }, onCamera: active => { cameraActive.value = active } })
async function load() {
  if (disposed) return
  const ticket = ++loadSequence, scope = reservationScope, reservationId = props.id
  loading.value = true; detailError.value = ''
  try {
    const result = await getReservation(reservationId)
    if (ticket === loadSequence && scope === reservationScope && !disposed) {
      reservation.value = result.data
      const status = reservation.value?.status
      const usageConfirmed = ['checked_in', 'completed'].includes(status) && !!reservation.value?.usage_record?.checkin_at
      const endedWithoutSignIn = ['unused_ended', 'cancelled'].includes(status)
      if (usageConfirmed) scanError.value = ''
      if (uncertainResult.value) {
        if (usageConfirmed || endedWithoutSignIn) {
          scanError.value = ''
          uncertainResult.value = false
        } else if (status === 'pending' && checkinAvailable.value) {
          scanError.value = ''
          scanNotice.value = '还未签到，可以重新扫码或选择图片。'
          uncertainResult.value = false
        }
      }
      if (accepted.value) {
        success.value = usageConfirmed
        scanNotice.value = endedWithoutSignIn || usageConfirmed
          ? '' : '签到已提交，暂时还查不到结果。'
      }
    }
  }
  catch (error) {
    if (ticket === loadSequence && scope === reservationScope && !disposed) {
      detailError.value = error.message
      if (accepted.value && !success.value) scanNotice.value = '签到已提交，暂时还查不到结果。'
    }
  }
  finally { if (ticket === loadSequence && scope === reservationScope && !disposed) loading.value = false }
}
async function submitCode(code) {
  if (!canCheckin.value || submitting.value || disposed) return
  const reservationId = props.id, scope = reservationScope
  const current = () => !disposed && scope === reservationScope && reservationId === props.id
  submitting.value = true; success.value = false; accepted.value = false; scanError.value = ''; scanNotice.value = ''; uncertainResult.value = false
  try {
    await checkinReservation(reservationId, code)
    if (current()) accepted.value = true
  } catch (error) {
    if (!current()) return
    uncertainResult.value = error.status == null || error.status === 408 || error.status >= 500
    if (uncertainResult.value) {
      scanError.value = '签到结果尚未确认。'
    } else if (error.details?.termination_reason === 'no_show') {
      scanError.value = '已超过签到期限，预约已结束。'
    } else if (error.message === '码已失效或不属于本预约座位') {
      scanError.value = '这个二维码已失效或不属于你的座位。请扫描预约座位上的二维码。'
    } else if (error.message === '签到窗口为预约开始至开始后15分钟之前' || error.message?.endsWith('请刷新记录')) {
      scanError.value = '本次签到未完成。'
    } else {
      scanError.value = error.message || '签到未完成，请再试一次。'
    }
  } finally {
    if (current()) {
      scanner.stop()
      await load()
      if (current()) {
        submitting.value = false
      }
    }
  }
}
async function upload(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file || !canCheckin.value || submitting.value || decoding.value) return
  const scope = reservationScope
  decoding.value = true; scanError.value = ''; scanNotice.value = ''; success.value = false
  try { await scanner.file(file) } finally { if (!disposed && scope === reservationScope) decoding.value = false }
}
async function startCamera() {
  if (insecureContext || !canCheckin.value || submitting.value || decoding.value || cameraActive.value) return
  scanError.value = ''; scanNotice.value = ''; success.value = false
  await scanner.camera(video.value)
}
function refresh() { scanner.stop(); return load() }
watch(() => props.id, () => { reservationScope++; uncertainResult.value = false; accepted.value = false; scanner.stop(); submitting.value = false; decoding.value = false; reservation.value = null; scanError.value = ''; scanNotice.value = ''; success.value = false; void load() }, { immediate: true })
onBeforeUnmount(() => { disposed = true; loadSequence++; scanner.stop() })
</script>
<template>
  <div class="page-view checkin-page">
    <header class="view-heading" data-page-title><h1>扫码签到</h1></header>
    <section class="card checkin-card">
      <p v-if="loading" role="status">{{ submitting || needsResultCheck ? '正在查看签到结果…' : '正在加载预约…' }}</p>
      <SBanner v-else-if="detailError && !needsResultCheck" type="error" title="暂时打不开预约。">
        <SButton size="sm" @click="refresh">重新加载预约</SButton>
      </SBanner>
      <template v-if="reservation && !loading && !detailError">
        <div class="reservation-brief">
          <h2>{{ reservation.room_name }} · {{ reservation.seat_no }}</h2>
          <p class="muted">{{ reservation.res_date }} {{ reservation.start_time }}–{{ reservation.end_time }}</p>
        </div>
        <div v-if="deadline && reservation.status === 'pending'" class="deadline-box">
          <span class="deadline-label">签到截止</span>
          <strong>{{ deadline.text }}</strong>
        </div>
        <SBanner v-if="checkinStatus && !success && !needsResultCheck && !scanError" :title="checkinStatus">
          <SButton v-if="reservation.status === 'pending'" size="sm" @click="refresh">查看是否可以签到</SButton>
        </SBanner>
        <p v-if="['admin_resource_change','admin_restriction'].includes(reservation.termination_reason)">
          {{ reservation.termination_note || '预约已由管理员取消。' }} 本次取消不计违规。
        </p>
      </template>
      <SBanner v-if="success" type="success" :title="reservation?.status === 'completed' ? '已签到，本次自习已结束' : '签到成功，可以开始自习'" />
      <SBanner v-else-if="needsResultCheck && !loading && !submitting" type="warning" :title="scanNotice || scanError">
        <SButton size="sm" @click="refresh">查看签到结果</SButton>
      </SBanner>
      <SBanner v-else-if="scanNotice && !loading && !submitting" :title="scanNotice" />
      <SBanner v-else-if="scanError && !loading && !submitting" type="error" :title="scanError" />
      <p v-if="decoding || (submitting && !loading)" role="status">{{ submitting ? '正在签到…' : '正在识别图片…' }}</p>
      <div v-if="canCheckin && !submitting" class="scan-controls">
        <p v-if="insecureContext" class="muted">当前地址无法打开摄像头。你可以直接选择二维码图片签到。</p>
        <div v-else class="row-actions">
          <SButton v-if="!cameraActive" variant="primary" :disabled="decoding" @click="startCamera">打开摄像头扫码</SButton>
          <SButton v-else @click="scanner.stop">关闭摄像头</SButton>
        </div>
        <p v-if="cameraActive" role="status">将预约座位上的二维码对准镜头。</p>
        <video v-show="cameraActive" ref="video" class="scan-video" muted playsinline autoplay aria-label="座位二维码摄像头预览" />
        <label v-if="!cameraActive" class="upload-label">
          选择座位二维码图片
          <input type="file" accept="image/png,image/jpeg,image/webp" :disabled="decoding" aria-describedby="checkin-image-guide" @change="upload" />
          <small id="checkin-image-guide" class="muted">PNG、JPEG 或 WebP，5 MiB 以内，单边不超过 4096 像素。</small>
        </label>
      </div>
      <details v-if="reservation?.usage_record && !loading && !detailError">
        <summary>使用记录</summary>
        <UsageRecordSummary :record="reservation.usage_record" />
      </details>
      <div class="row-actions checkin-links">
        <RouterLink to="/mine">{{ success ? '查看我的预约' : '返回我的预约' }}</RouterLink>
        <RouterLink v-if="reservation?.status === 'pending' && !detailError" :to="{ name: 'complaints', query: { type: 'occupation', reservation_id: String(reservation.id) } }">座位被占，找人帮忙</RouterLink>
      </div>
    </section>
  </div>
</template>
<style scoped>
.checkin-page { max-width: 900px; }
.checkin-card, .scan-controls { display: grid; gap: 16px; }
.reservation-brief { display: grid; gap: 4px; }
.reservation-brief h2 { font-size: var(--fs-h3, 20px); }
.upload-label { display: grid; gap: 6px; max-width: 100%; overflow-wrap: anywhere; }
.upload-label input { max-width: 100%; min-width: 0; }
.scan-video { width: 100%; max-height: 440px; border-radius: var(--r-md); background: #111; }
.row-actions { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; }
.deadline-box { display: grid; gap: 4px; padding: 12px 16px; border-radius: var(--r-lg); background: var(--surface-2); border: 1px solid var(--hairline); }
.deadline-label { color: var(--text-2); font-size: var(--fs-caption); }
.deadline-box strong { font-size: clamp(19px, 4vw, 27px); color: var(--primary); font-variant-numeric: tabular-nums; }
details summary { cursor: pointer; }
details[open] summary { margin-bottom: 8px; }
.checkin-links a { color: var(--primary); }
</style>
