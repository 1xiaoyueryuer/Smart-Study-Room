<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getLanInfo, listLanDevices, getLanBoard, getLanQr } from '../api/lan'
import { getBookingPolicy } from '../api/reservation'
import {
  START_TIMES, END_TIMES, defaultBoardWindow, adjustEnd,
  accessLabel, roleLabel, activeLabel
} from '../composables/lanBoard'
import { message } from '../components/ui/feedback'
import AppIcon from '../components/AppIcon.vue'
import SButton from '../components/ui/SButton.vue'
import SBanner from '../components/ui/SBanner.vue'
import STag from '../components/ui/STag.vue'
import SSelect from '../components/ui/SSelect.vue'
import SEmpty from '../components/ui/SEmpty.vue'

const info = ref(null)
const devices = ref([])
const board = ref(null)
const policy = ref(null)
const dates = ref([])
const boardWindow = ref({ date: '', start: '14:00', end: '16:00' })
const infoError = ref('')
const devicesError = ref('')
const boardError = ref('')
const qrUrl = ref('')
const qrError = ref('')
const infoLoading = ref(false)
const devicesLoading = ref(false)
const boardLoading = ref(false)
const copied = ref('')
let devicesTimer = null
let boardTimer = null
let infoTimer = null

const startOptions = START_TIMES.map((time) => ({ label: time, value: time }))
const endOptions = computed(() => END_TIMES
  .filter((time) => time > boardWindow.value.start)
  .map((time) => ({ label: time, value: time })))
const dateChips = computed(() => dates.value.map((date, index) => ({
  date,
  label: index === 0 ? '今天' : index === 1 ? '明天' : index === 2 ? '后天' : date
})))

function campusDateLabel(date) {
  const index = dates.value.indexOf(date)
  return index >= 0 ? `${index === 0 ? '今天' : index === 1 ? '明天' : '后天'} ${date}` : date
}

async function loadPolicy() {
  try {
    const response = await getBookingPolicy()
    policy.value = response.data
    dates.value = response.data?.dates || []
    if (!boardWindow.value.date) boardWindow.value = defaultBoardWindow(response.data?.server_now, dates.value)
  } catch { /* 日期选项读取失败时仍可用看板默认窗口 */ }
}

async function loadInfo() {
  infoLoading.value = true
  try {
    const response = await getLanInfo()
    info.value = response.data
    infoError.value = ''
    if (response.data?.primary_url) await loadQr()
  } catch (failure) {
    infoError.value = failure.message || '局域网接入信息读取失败'
  } finally {
    infoLoading.value = false
  }
}

async function loadQr() {
  if (qrUrl.value) return
  try {
    const blob = await getLanQr()
    if (!(blob instanceof Blob)) throw new Error('二维码响应格式错误')
    qrUrl.value = URL.createObjectURL(blob)
    qrError.value = ''
  } catch (failure) {
    qrError.value = failure.message || '二维码生成失败'
  }
}

async function loadDevices() {
  devicesLoading.value = true
  try {
    const response = await listLanDevices()
    devices.value = response.data?.devices || []
    devicesError.value = ''
  } catch (failure) {
    devicesError.value = failure.message || '在线设备读取失败'
  } finally {
    devicesLoading.value = false
  }
}

async function loadBoard() {
  if (!boardWindow.value.date || !boardWindow.value.start || !boardWindow.value.end) return
  boardLoading.value = true
  try {
    const response = await getLanBoard(boardWindow.value.date, boardWindow.value.start, boardWindow.value.end)
    board.value = response.data
    boardError.value = ''
  } catch (failure) {
    boardError.value = failure.message || '共享看板读取失败'
  } finally {
    boardLoading.value = false
  }
}

function pickDate(date) {
  boardWindow.value.date = date
  loadBoard()
}

function changeStart(start) {
  boardWindow.value.start = start
  boardWindow.value.end = adjustEnd(start, boardWindow.value.end)
  loadBoard()
}

function changeEnd(end) {
  boardWindow.value.end = end
  loadBoard()
}

async function copy(text) {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
  copied.value = text
  message.success('接入地址已复制')
  setTimeout(() => { if (copied.value === text) copied.value = '' }, 2000)
}

onMounted(async () => {
  await loadPolicy()
  await Promise.all([loadInfo(), loadDevices(), loadBoard()])
  devicesTimer = setInterval(loadDevices, 10000)
  boardTimer = setInterval(loadBoard, 10000)
  infoTimer = setInterval(loadInfo, 30000)
})

onUnmounted(() => {
  clearInterval(devicesTimer)
  clearInterval(boardTimer)
  clearInterval(infoTimer)
  if (qrUrl.value) URL.revokeObjectURL(qrUrl.value)
})
</script>

<template>
  <div v-reveal class="page-view lan-page">
    <header class="view-heading">
      <div class="heading-copy" data-page-title>
        <h1>局域网共同预约</h1>
        <p class="heading-sub">一台设备作主机，同一局域网内的其他设备访问同一套系统，共用座位与预约数据。</p>
      </div>
    </header>

    <SBanner v-if="infoError" type="error" :title="infoError" />

    <SBanner
      v-else-if="info && !info.server.lan_available"
      type="warning"
      title="当前未开放局域网访问"
    >
      服务当前只监听 {{ info.server.bind_address }}:{{ info.server.port }}。请在主机
      <code>.local/application-local.properties</code> 增加 <code>server.address=0.0.0.0</code> 后重启；
      其他设备连接同一 Wi-Fi，用主机地址访问。
    </SBanner>

    <SBanner
      v-else-if="info && info.server.lan_available"
      type="success"
      title="局域网访问已开启"
    >
      其他设备连接同一 Wi-Fi 后打开下方接入地址，登录自己的校园账号即可预约；所有设备读取同一份座位与预约状态。
    </SBanner>

    <div class="lan-grid">
      <section class="card lan-card">
        <div class="card-title-row">
          <h3>接入状态</h3>
          <SButton size="sm" variant="secondary" :loading="infoLoading" @click="loadInfo">
            <AppIcon name="refresh" :size="14" />刷新
          </SButton>
        </div>
        <dl class="lan-facts">
          <div><dt>服务监听</dt><dd class="num">{{ info?.server?.bind_address || '—' }}:{{ info?.server?.port || '—' }}</dd></div>
          <div><dt>访问协议</dt><dd>{{ info?.server?.secure ? 'HTTPS' : 'HTTP' }}</dd></div>
          <div><dt>当前设备接入</dt><dd><STag :type="info?.client?.access === 'other' ? 'warning' : 'success'">{{ accessLabel(info?.client?.access) }}</STag></dd></div>
          <div><dt>当前设备地址</dt><dd class="num">{{ info?.client?.remote_address || '—' }}</dd></div>
          <div><dt>校园时区</dt><dd>{{ info?.server?.campus_zone || 'Asia/Shanghai' }}</dd></div>
        </dl>
        <p class="lan-hint">{{ info?.hint }}</p>
      </section>

      <section class="card lan-card lan-connect">
        <div class="card-title-row"><h3>主机接入地址</h3></div>
        <p v-if="!info?.primary_url" class="muted">尚未检测到可用的局域网地址，请确认主机已连接 Wi-Fi 或网线。</p>
        <template v-else>
          <div class="lan-url-row">
            <code class="lan-url">{{ info.primary_url }}</code>
            <SButton size="sm" @click="copy(info.primary_url)">{{ copied === info.primary_url ? '已复制' : '复制' }}</SButton>
          </div>
          <div class="lan-qr-wrap">
            <img v-if="qrUrl" :src="qrUrl" alt="局域网接入二维码，扫码后打开系统" class="lan-qr" />
            <p v-else class="muted small">{{ qrError || '二维码生成中…' }}</p>
          </div>
          <p class="muted small">手机扫码或手动输入地址即可打开系统；登录后与其他设备看到同一份预约数据。</p>
          <ul v-if="info.links.length > 1" class="lan-links">
            <li v-for="link in info.links" :key="link.address">
              <span>{{ link.name }}</span>
              <code>{{ link.url }}</code>
              <SButton size="sm" variant="ghost" @click="copy(link.url)">复制</SButton>
            </li>
          </ul>
        </template>
      </section>
    </div>

    <section class="card">
      <div class="card-title-row">
        <h3>在线设备 <span class="muted">共 {{ devices.length }} 台</span></h3>
        <SButton size="sm" variant="secondary" :loading="devicesLoading" @click="loadDevices">
          <AppIcon name="refresh" :size="14" />刷新
        </SButton>
      </div>
      <p class="muted small">最近 90 秒内访问过系统的设备；令牌只以摘要形式保存在内存中，不展示账号标识。</p>
      <SBanner v-if="devicesError" type="error" :title="devicesError" />
      <div v-else class="table-wrap">
        <div class="table-scroll" tabindex="0" aria-label="在线设备表格，可左右滑动">
          <table class="table lan-device-table">
            <thead>
              <tr>
                <th style="width:120px">设备</th>
                <th style="width:100px">身份</th>
                <th style="width:110px">接入方式</th>
                <th style="width:120px">远端地址</th>
                <th style="min-width:110px">最近活跃</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="device in devices" :key="device.id">
                <td>{{ device.device }}<STag v-if="device.is_self" type="info" style="margin-left:6px">本机</STag></td>
                <td>{{ roleLabel(device.role) }}</td>
                <td><STag :type="device.access === 'lan' ? 'success' : device.access === 'loopback' ? 'info' : 'warning'">{{ accessLabel(device.access) }}</STag></td>
                <td class="num">{{ device.remote_address || '—' }}</td>
                <td class="num">{{ activeLabel(device.active_seconds) }}</td>
              </tr>
            </tbody>
          </table>
          <SEmpty v-if="!devices.length" description="暂无其他在线设备。让同学连接同一 Wi-Fi 并打开接入地址，即可一起预约。" />
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-title-row">
        <h3>共享座位看板 <span class="muted">{{ campusDateLabel(board?.date) }} {{ board?.start_time }}–{{ board?.end_time }}</span></h3>
        <SButton size="sm" variant="secondary" :loading="boardLoading" @click="loadBoard">
          <AppIcon name="refresh" :size="14" />刷新
        </SButton>
      </div>
      <div class="lan-board-controls">
        <div class="chips" role="group" aria-label="看板日期">
          <button
            v-for="chip in dateChips"
            :key="chip.date"
            type="button"
            class="lan-chip"
            :class="{ active: boardWindow.date === chip.date }"
            @click="pickDate(chip.date)"
          >{{ chip.label }}</button>
        </div>
        <label class="lan-field">
          <span>开始时间</span>
          <SSelect :model-value="boardWindow.start" :options="startOptions" size="sm" @update:model-value="changeStart" />
        </label>
        <label class="lan-field">
          <span>结束时间</span>
          <SSelect :model-value="boardWindow.end" :options="endOptions" size="sm" @update:model-value="changeEnd" />
        </label>
      </div>
      <SBanner v-if="boardError" type="error" :title="boardError" />
      <div v-else class="table-wrap">
        <div class="table-scroll" v-loading="boardLoading" tabindex="0" aria-label="共享座位看板表格，可左右滑动">
          <table class="table lan-board-table">
            <thead>
              <tr>
                <th style="min-width:180px">空间</th>
                <th style="width:90px">开放</th>
                <th style="width:96px">可约座位</th>
                <th style="width:96px">已约座位</th>
                <th style="width:96px">座位总数</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="room in board?.rooms || []" :key="room.room_id">
                <td class="ellip">{{ room.name }}<span class="muted small"> {{ [room.building, room.floor].filter(Boolean).join(' · ') }}</span></td>
                <td>
                  <STag :type="room.open ? 'success' : 'warning'" :title="(room.closed_reasons || []).join('；')">{{ room.open ? '开放' : '未开放' }}</STag>
                </td>
                <td class="num">{{ room.available_seats }}</td>
                <td class="num">{{ room.booked_seats }}</td>
                <td class="num">{{ room.total_seats }}</td>
              </tr>
            </tbody>
          </table>
          <SEmpty v-if="!(board?.rooms || []).length" description="当前没有可显示的空间" />
        </div>
      </div>
      <p v-if="board" class="muted small">
        近 10 分钟新增预约 <b>{{ board.recent_bookings_10m }}</b> 条；{{ board.shared_note }}
      </p>
    </section>

    <section class="card">
      <div class="card-title-row"><h3>怎么一起用</h3></div>
      <ol class="steps">
        <li>在主机设备上启动系统，并在本地配置中设置 <code>server.address=0.0.0.0</code> 后重启。</li>
        <li>让其他设备连接与主机相同的 Wi-Fi；打开本页顶部显示的接入地址或扫码。</li>
        <li v-if="info?.server?.secure">手机摄像头需要 HTTPS：首次使用前请按 F12 文档在手机安装并信任本地 CA，之后即可在扫码签到页开启摄像头。</li>
        <li v-else>手机摄像头需要 HTTPS；当前为 HTTP，扫码签到可改用上传图片，或按 F12 文档开启 HTTPS。</li>
        <li>每台设备用自己的校园账号登录，进入「座位预约」正常选座提交。</li>
        <li>所有设备共用同一份座位与预约数据；同一座位同一时段并发提交时，只有一方成功，另一方会看到冲突提示。</li>
      </ol>
      <p class="muted small">该能力面向小范围教学演示；HTTPS 可通过本地 CA 开启，生产环境仍需正式证书、反向代理与校园统一认证。</p>
    </section>
  </div>
</template>

<style scoped>
.lan-page { display: flex; flex-direction: column; gap: 16px; }
.lan-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
.lan-card { min-width: 0; }
.lan-facts { display: grid; gap: 10px; margin: 4px 0 12px; }
.lan-facts > div {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding-bottom: 8px; border-bottom: 1px dashed var(--hairline);
}
.lan-facts dt { color: var(--text-3); font-size: 13px; }
.lan-facts dd { margin: 0; color: var(--text-1); font-size: 13px; text-align: right; word-break: break-all; }
.lan-hint { margin: 0; color: var(--text-3); font-size: 12.5px; line-height: 1.7; }
.lan-url-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.lan-url {
  flex: 1; min-width: 0; padding: 8px 10px; border-radius: var(--r-sm);
  background: var(--surface-2); color: var(--text-1); font-size: 13.5px; word-break: break-all;
}
.lan-qr-wrap { display: flex; justify-content: center; margin: 14px 0 10px; }
.lan-qr { width: 190px; height: 190px; padding: 6px; background: #fff; border: 1px solid var(--border); border-radius: var(--r-md); }
.lan-links { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.lan-links li { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12.5px; }
.lan-links code { color: var(--text-2); word-break: break-all; }
.chips { display: flex; gap: 8px; flex-wrap: wrap; }
.lan-chip {
  all: unset; padding: 7px 14px; border-radius: var(--r-full);
  background: var(--surface-2); color: var(--text-2); font-size: 13px; cursor: pointer;
  transition: background var(--dur-1) var(--ease), color var(--dur-1) var(--ease);
}
.lan-chip:hover { background: var(--surface-3); color: var(--text-1); }
.lan-chip.active { background: var(--primary-weak); color: var(--primary-active); font-weight: 600; }
.lan-board-controls { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.lan-field { display: flex; flex-direction: column; gap: 6px; min-width: 120px; }
.lan-field span { color: var(--text-3); font-size: 12px; }
.lan-device-table { min-width: 620px; }
.lan-board-table { min-width: 640px; }
.steps { margin: 0; padding-left: 18px; color: var(--text-2); line-height: 1.95; font-size: 14px; }
.steps code { font-size: 12.5px; }
.small { font-size: 12.5px; }
@media (max-width: 640px) {
  .lan-grid { grid-template-columns: 1fr; }
  .lan-qr { width: 160px; height: 160px; }
}
</style>
