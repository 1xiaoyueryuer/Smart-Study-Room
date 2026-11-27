import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { computed, ref } from 'vue'
import * as lanBoard from '../src/composables/lanBoard.js'
import * as usePagination from '../src/composables/usePagination.js'

const policyData = {
  dates: ['2026-11-28', '2026-11-29', '2026-11-30'],
  server_now: '2026-11-28T13:20:00+08:00'
}
const infoData = {
  primary_url: 'http://192.168.1.5:8081',
  server: { bind_address: '0.0.0.0', port: 8081, secure: false, campus_zone: 'Asia/Shanghai' },
  client: { access: 'same_device', remote_address: '192.168.1.5' },
  links: []
}

async function loadLanView() {
  const calls = { policy: 0, info: 0, qr: 0, devices: 0, board: [], clipboard: [] }
  const timers = []
  const cleared = []
  const urls = []
  const revoked = []
  const notices = []
  const mounted = []
  const unmounted = []
  const responses = {
    policy: async () => ({ data: policyData }),
    info: async () => ({ data: infoData }),
    devices: async () => ({ data: { devices: [] } }),
    board: async () => ({ data: { rooms: [] } }),
    qr: async () => new Blob(['qr'], { type: 'image/png' })
  }
  const context = vm.createContext({
    console,
    Blob,
    Date,
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    clearInterval: id => cleared.push(id),
    URL: {
      createObjectURL: blob => { urls.push(blob); return `blob:qr-${urls.length}` },
      revokeObjectURL: url => revoked.push(url)
    },
    navigator: { clipboard: { writeText: async text => calls.clipboard.push(text) } },
    document: {}
  })
  const source = (await readFile(new URL('../src/views/LanView.vue', import.meta.url), 'utf8')).split('<script setup>')[1].split('</script>')[0]
  const module = new vm.SourceTextModule(source + `
export {loadPolicy,loadInfo,loadQr,loadDevices,loadBoard,pickDate,changeStart,changeEnd,campusDateLabel,dateChips,endOptions,info,devices,board,policy,dates,boardWindow,devicePage,deviceItems,devicePages,roomPage,roomItems,roomPages,infoError,devicesError,boardError,qrUrl,qrError,infoLoading,devicesLoading,boardLoading}`, { context })
  await module.link(specifier => {
    let exports = null
    if (specifier === 'vue') {
      exports = { ref, computed, onMounted: fn => mounted.push(fn), onUnmounted: fn => unmounted.push(fn) }
    } else if (specifier === '../api/lan') {
      exports = {
        getLanInfo: async () => { calls.info++; return responses.info() },
        listLanDevices: async () => { calls.devices++; return responses.devices() },
        getLanBoard: async (date, start, end) => { calls.board.push({ date, start, end }); return responses.board(date, start, end) },
        getLanQr: async () => { calls.qr++; return responses.qr() }
      }
    } else if (specifier === '../api/reservation') {
      exports = { getBookingPolicy: async () => { calls.policy++; return responses.policy() } }
    } else if (specifier === '../composables/lanBoard') {
      exports = lanBoard
    } else if (specifier === '../composables/usePagination') {
      exports = usePagination
    } else if (specifier === '../components/ui/feedback') {
      exports = { message: { success: text => notices.push(text) } }
    } else if (specifier.startsWith('../components/')) {
      exports = { default: {} }
    }
    assert.ok(exports, `Unmocked import: ${specifier}`)
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
    }, { context })
  })
  await module.evaluate()
  return { page: module.namespace, calls, timers, cleared, urls, revoked, notices, mounted, unmounted, responses }
}

test('mounting loads policy, info, devices and board, then starts the three pollers', async () => {
  const harness = await loadLanView()
  harness.responses.devices = async () => ({ data: { devices: Array.from({ length: 12 }, (_, index) => ({ id: index + 1, name: `设备${index + 1}` })) } })
  await harness.mounted[0]()
  const page = harness.page
  assert.equal(harness.calls.policy, 1)
  assert.equal(harness.calls.info, 1)
  assert.equal(harness.calls.devices, 1)
  assert.equal(harness.calls.board.length, 1)
  assert.deepEqual({ ...harness.calls.board[0] }, { date: '2026-11-28', start: '13:30', end: '15:30' })
  assert.equal(page.devices.value.length, 12)
  assert.equal(page.devicePages.value, 2)
  assert.equal(page.deviceItems.value.length, 10)
  assert.deepEqual(harness.timers.map(timer => timer.ms), [10000, 10000, 30000])
  assert.equal(harness.calls.qr, 1, '首次读取到接入地址时生成一次二维码')
  assert.equal(page.qrUrl.value, 'blob:qr-1')
})

test('unmounting clears every poller and releases the QR object URL', async () => {
  const harness = await loadLanView()
  await harness.mounted[0]()
  harness.unmounted.forEach(fn => fn())
  assert.deepEqual(harness.cleared, [1, 2, 3])
  assert.deepEqual(harness.revoked, ['blob:qr-1'])
})

test('a device read failure keeps the previous rows and exposes a retryable error', async () => {
  const harness = await loadLanView()
  harness.responses.devices = async () => ({ data: { devices: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] } })
  await harness.page.loadDevices()
  assert.equal(harness.page.devices.value.length, 2)
  assert.equal(harness.page.devicesError.value, '')

  harness.responses.devices = async () => { throw new Error('设备读取失败') }
  await harness.page.loadDevices()
  assert.equal(harness.page.devicesError.value, '设备读取失败')
  assert.equal(harness.page.devices.value.length, 2, '失败时保留上次成功的设备列表')
  assert.equal(harness.page.devicesLoading.value, false)
})

test('board reads follow the selected window and skip incomplete windows', async () => {
  const harness = await loadLanView()
  await harness.mounted[0]()
  const page = harness.page
  const before = harness.calls.board.length

  page.pickDate('2026-11-30')
  await Promise.resolve()
  assert.deepEqual({ ...harness.calls.board.at(-1) }, { date: '2026-11-30', start: '13:30', end: '15:30' })

  page.changeStart('16:00')
  await Promise.resolve()
  assert.deepEqual({ ...harness.calls.board.at(-1) }, { date: '2026-11-30', start: '16:00', end: '16:30' }, '开始时间晚于结束时间时自动顺延半小时')

  page.changeEnd('18:00')
  await Promise.resolve()
  assert.deepEqual({ ...harness.calls.board.at(-1) }, { date: '2026-11-30', start: '16:00', end: '18:00' })

  const callsAfter = harness.calls.board.length
  page.boardWindow.value = { date: '', start: '14:00', end: '16:00' }
  await page.loadBoard()
  assert.equal(harness.calls.board.length, callsAfter, '缺少日期时不发起请求')
})

test('a failing board read keeps the previous board and shows the error', async () => {
  const harness = await loadLanView()
  harness.responses.board = async () => ({ data: { rooms: [{ id: 1, name: 'A区' }] } })
  await harness.mounted[0]()
  assert.equal(harness.page.board.value.rooms.length, 1)
  harness.responses.board = async () => { throw new Error('看板读取失败') }
  await harness.page.loadBoard()
  assert.equal(harness.page.boardError.value, '看板读取失败')
  assert.equal(harness.page.board.value.rooms.length, 1)
})

test('device pagination clamps back to the first page after the list shrinks', async () => {
  const harness = await loadLanView()
  harness.responses.devices = async () => ({ data: { devices: Array.from({ length: 12 }, (_, index) => ({ id: index + 1 })) } })
  await harness.page.loadDevices()
  harness.page.devicePage.value = 2
  assert.equal(harness.page.deviceItems.value.length, 2)
  harness.responses.devices = async () => ({ data: { devices: [{ id: 1 }, { id: 2 }] } })
  await harness.page.loadDevices()
  assert.equal(harness.page.devicePages.value, 1)
  assert.equal(harness.page.devicePage.value, 1)
})

test('date chips and labels describe today, tomorrow and the day after', async () => {
  const harness = await loadLanView()
  await harness.page.loadPolicy()
  assert.deepEqual(Array.from(harness.page.dateChips.value, chip => chip.label), ['今天', '明天', '后天'])
  assert.equal(harness.page.campusDateLabel('2026-11-28'), '今天 2026-11-28')
  assert.equal(harness.page.campusDateLabel('2026-11-29'), '明天 2026-11-29')
  assert.equal(harness.page.campusDateLabel('2026-11-30'), '后天 2026-11-30')
  assert.equal(harness.page.campusDateLabel('2026-12-05'), '2026-12-05')
  assert.deepEqual(Array.from(harness.page.dates.value), policyData.dates)
})

test('a failed policy read leaves the board window empty instead of guessing a date', async () => {
  const harness = await loadLanView()
  harness.responses.policy = async () => { throw new Error('政策读取失败') }
  await harness.mounted[0]()
  assert.equal(harness.page.policy.value, null)
  assert.deepEqual(Array.from(harness.page.dates.value), [])
  assert.equal(harness.calls.board.length, 0, '没有日期时首页不请求看板')
})

test('info failures surface a visible error without blocking the rest of the page', async () => {
  const harness = await loadLanView()
  harness.responses.info = async () => { throw new Error('接入信息读取失败') }
  await harness.mounted[0]()
  assert.equal(harness.page.infoError.value, '接入信息读取失败')
  assert.equal(harness.page.qrUrl.value, '')
  assert.equal(harness.calls.devices, 1, '接入信息失败不影响设备读取')
})

test('the board title falls back to the raw date beyond the third booking day', async () => {
  const harness = await loadLanView()
  harness.page.dates.value = ['2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01']
  assert.equal(harness.page.campusDateLabel('2026-11-30'), '后天 2026-11-30')
  assert.equal(harness.page.campusDateLabel('2026-12-01'), '2026-12-01', '第 4 天及以后不再显示“后天”')
})
