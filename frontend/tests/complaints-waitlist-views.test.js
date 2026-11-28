import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { ref, computed, watch } from 'vue'
import * as complaintForm from '../src/composables/complaintForm.js'
import * as campusDateTime from '../src/composables/campusDateTime.js'
import * as recordPage from '../src/composables/recordPage.js'
import * as usePaginationModule from '../src/composables/usePagination.js'

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const fullSourceOf = async file => readFile(new URL(`../src/views/${file}`, import.meta.url), 'utf8')
const sourceOf = async file => (await fullSourceOf(file)).split('<script setup>')[1].split('</script>')[0]

async function loadScript(source, mocks) {
  const mounted = []
  const unmounted = []
  const vue = {
    ref,
    computed,
    watch,
    onMounted: fn => mounted.push(fn),
    onBeforeUnmount: fn => unmounted.push(fn)
  }
  const context = vm.createContext({ console })
  const module = new vm.SourceTextModule(source, { context })
  await module.link(specifier => {
    const exports = specifier === 'vue' ? vue : mocks[specifier]
    assert.ok(exports, `Unmocked import: ${specifier}`)
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
    }, { context })
  })
  await module.evaluate()
  return { page: module.namespace, mounted, unmounted }
}

function envelope(items, query, extra = {}) {
  return { items, total: extra.total ?? items.length, page: query.page, page_size: query.page_size, server_now: '2026-11-27T10:00:00+08:00' }
}

function complaintRow(id, overrides = {}) {
  return {
    id,
    type: 'service',
    service_kind: 'facility_repair',
    status: 'submitted',
    submitted_at: '2026-11-27T09:00:00+08:00',
    description: '自动分级验证：multiple',
    context_snapshot: { room_name: '1F-A区' },
    ...overrides
  }
}

async function complaintsPage(overrides = {}) {
  const calls = { list: [], detail: [] }
  const route = overrides.route || { query: {} }
  const mocks = {
    'vue-router': { useRoute: () => route },
    '../api/complaint': {
      listMyComplaints: async query => {
        calls.list.push({ ...query })
        return overrides.list ? overrides.list(query) : { data: envelope([], query) }
      },
      getComplaint: async id => {
        calls.detail.push(id)
        return overrides.detail ? overrides.detail(id) : { data: { id } }
      }
    },
    '../composables/complaintForm.js': complaintForm,
    '../composables/campusDateTime.js': campusDateTime,
    '../composables/recordPage.js': recordPage,
    '../composables/useServiceTargetClock.js': { useServiceTargetClock: () => ({ progress: () => null }) },
    '../components/ComplaintForm.vue': { default: {} },
    '../components/ComplaintRecord.vue': { default: {} },
    '../components/ui/SButton.vue': { default: {} },
    '../components/ui/SBanner.vue': { default: {} },
    '../components/ui/SEmpty.vue': { default: {} },
    '../components/RecordPageControls.vue': { default: {} }
  }
  const full = await fullSourceOf('ComplaintsView.vue')
  const source = await sourceOf('ComplaintsView.vue')
  const { page, mounted, unmounted } = await loadScript(
    source + '\nexport {load,selectCategory,selectItem,closeDetail,created,visibleItems,items,loading,error,category,selectedId,detail,detailError,detailLoading,formOpen,snapshot,loaded}',
    mocks
  )
  return { page, calls, source, full, mounted, unmounted }
}

test('complaints list reads the first page on load and keeps rows after a later failure', async () => {
  let failNext = false
  const page = await complaintsPage({
    list: query => failNext ? Promise.reject(new Error('网络中断')) : Promise.resolve({ data: envelope([complaintRow(1)], query) })
  })
  const { page: view } = page
  await view.load()
  assert.deepEqual(page.calls.list[0], { page: 1, page_size: 10 })
  assert.equal(view.items.value.length, 1)
  assert.equal(view.loaded.value, true)
  assert.equal(view.loading.value, false)

  failNext = true
  await view.load()
  assert.equal(view.error.value, '网络中断')
  assert.equal(view.items.value.length, 1, '失败后旧数据必须保留')
  assert.equal(view.loading.value, false)
})

test('complaints category switch requests the coarse type and filters the visible rows locally', async () => {
  const rows = [
    complaintRow(1),
    complaintRow(2, { service_kind: 'other_service', service_topic: '环境卫生' }),
    complaintRow(3, { type: 'occupation', service_kind: null, description: '座位被占用' })
  ]
  const page = await complaintsPage({ list: query => Promise.resolve({ data: envelope(rows, query) }) })
  const { page: view } = page
  await view.load()
  assert.equal(view.visibleItems.value.length, 3)

  await view.selectCategory('facility')
  assert.equal(page.calls.list.at(-1).type, 'service')
  await tick()
  assert.deepEqual(Array.from(view.visibleItems.value, row => row.id), [1])

  await view.selectCategory('other')
  assert.equal(page.calls.list.at(-1).type, 'service')
  await tick()
  assert.deepEqual(Array.from(view.visibleItems.value, row => row.id), [2])

  await view.selectCategory('occupation')
  assert.equal(page.calls.list.at(-1).type, 'occupation')
  await tick()
  assert.deepEqual(Array.from(view.visibleItems.value, row => row.id), [3])
})

test('an empty category clears the selected detail instead of keeping another category record', async () => {
  const page = await complaintsPage({ list: query => Promise.resolve({ data: envelope([complaintRow(1)], query) }) })
  const { page: view } = page
  await view.load()
  await tick()
  assert.equal(view.detail.value.id, 1)

  await view.selectCategory('other')
  await tick()
  assert.equal(view.visibleItems.value.length, 0)
  assert.equal(view.selectedId.value, null)
  assert.equal(view.detail.value, null)
  assert.equal(view.detailError.value, '')
})

test('a created complaint refreshes the current page and selects the new row when it is listed', async () => {
  let rows = [complaintRow(1)]
  const page = await complaintsPage({
    list: query => Promise.resolve({ data: envelope(rows, query) }),
    detail: id => Promise.resolve({ data: { id } })
  })
  const { page: view } = page
  await view.load()
  rows = [complaintRow(1), complaintRow(2)]
  await view.created(2)
  await tick()
  assert.equal(page.calls.list.length, 2)
  assert.equal(page.calls.list[1].page, 1, '刷新当前页而不是跳回固定页')
  assert.equal(page.calls.detail.at(-1), 2)
})

test('a created complaint that is not on the current page keeps the current selection', async () => {
  const page = await complaintsPage({
    list: () => Promise.resolve({ data: envelope([complaintRow(1)], { page: 1, page_size: 10 }) }),
    detail: id => Promise.resolve({ data: { id } })
  })
  const { page: view } = page
  await view.load()
  await tick()
  const before = page.calls.detail.length
  await view.created(99)
  await tick()
  assert.equal(view.detail.value.id, 1, '新记录不在当前页时保留原选中项')
  assert.equal(page.calls.detail.length, before, '未找到新记录时不应重新请求详情')
})

test('detail failures surface a visible error and stop the loading state', async () => {
  const page = await complaintsPage({
    detail: () => Promise.reject(new Error('详情读取失败'))
  })
  const { page: view } = page
  await view.selectItem({ id: 7 })
  assert.equal(view.detailError.value, '详情读取失败')
  assert.equal(view.detailLoading.value, false)
  assert.equal(view.detail.value, null)
})

test('closing a detail during an in-flight read discards the response and stops the status text', async () => {
  let resolveDetail
  const page = await complaintsPage({ detail: () => new Promise(resolve => { resolveDetail = resolve }) })
  const { page: view } = page
  const pending = view.selectItem({ id: 8 })
  assert.equal(view.detailLoading.value, true)
  view.closeDetail()
  assert.equal(view.detailLoading.value, false)
  resolveDetail({ data: { id: 8 } })
  await pending
  assert.equal(view.detail.value, null, '关闭后迟到的详情不能回填')
})

test('complaint templates keep the visible loading, empty and retry texts', async () => {
  const { full: source } = await complaintsPage()
  assert.match(source, /role="status">正在加载求助记录…/)
  assert.match(source, /该分类暂无记录，可新建求助/)
  assert.match(source, /选择一条记录查看处理进度/)
  assert.match(source, /@click="load">重新加载记录/)
  assert.match(source, /@click="selectItem\(\{id:selectedId\}\)">重新加载详情/)
})

function waitlistRows() {
  return [
    { id: 1, status: 'waiting', zone: 'quiet', has_power: true, near_window: false },
    { id: 2, status: 'waiting', zone: 'regular', has_power: false, near_window: true },
    { id: 3, status: 'promoted', zone: 'quiet', has_power: false, near_window: false },
    { id: 4, status: 'expired', zone: 'quiet', has_power: false, near_window: false }
  ]
}

async function waitlistPage(overrides = {}) {
  const calls = { list: 0, cancel: [], success: [], dialogs: [] }
  const queue = overrides.dialogs || []
  const mocks = {
    '../components/PageHelp.vue': { default: {} },
    '../components/ui/SAnimatedNumber.vue': { default: {} },
    '../components/ui/SPagination.vue': { default: {} },
    '../components/ui/STag.vue': { default: {} },
    '../components/ui/SEmpty.vue': { default: {} },
    '../components/ui/SBanner.vue': { default: {} },
    '../components/ui/SButton.vue': { default: {} },
    '../components/AppIcon.vue': { default: {} },
    '../components/ui/feedback': {
      message: { success: text => calls.success.push(text) },
      confirmDialog: async (text, title) => {
        calls.dialogs.push({ text, title })
        const next = queue.shift()
        if (next) throw next
        return true
      }
    },
    '../api/waitlist': {
      listMyWaitlist: async () => {
        calls.list++
        return overrides.list ? overrides.list() : { data: waitlistRows() }
      },
      cancelWaitlist: async id => {
        calls.cancel.push(id)
        return overrides.cancel ? overrides.cancel(id) : { data: {} }
      }
    },
    '../composables/usePagination': usePaginationModule
  }
  const full = await fullSourceOf('WaitlistView.vue')
  const source = await sourceOf('WaitlistView.vue')
  const { page, mounted } = await loadScript(
    source + '\nexport {load,doCancel,filtered,buckets,filterStatus,list,error,loading,cancelling,prefText}',
    mocks
  )
  return { page, calls, source, full, mounted }
}

test('waitlist loads rows and reports per-status buckets and filtered rows', async () => {
  const { page: view } = await waitlistPage()
  await view.load()
  assert.equal(view.list.value.length, 4)
  assert.equal(view.buckets.value.all, 4)
  assert.equal(view.buckets.value.waiting, 2)
  assert.equal(view.buckets.value.promoted, 1)
  assert.equal(view.buckets.value.expired, 1)
  assert.equal(view.filtered.value.length, 4)
  view.filterStatus.value = 'waiting'
  assert.deepEqual(Array.from(view.filtered.value, row => row.id), [1, 2])
  assert.equal(view.prefText({ zone: 'quiet', has_power: true, near_window: true }), '静音区 / 电源 / 靠窗')
  assert.equal(view.prefText({}), '不限')
})

test('waitlist keeps the previous rows when a refresh fails and exposes the retryable error', async () => {
  let fail = false
  const { page: view } = await waitlistPage({ list: () => fail ? Promise.reject(new Error('读取失败')) : Promise.resolve({ data: waitlistRows() }) })
  await view.load()
  fail = true
  await view.load()
  assert.equal(view.error.value, '读取失败')
  assert.equal(view.list.value.length, 4, '失败后旧记录必须保留')
  assert.equal(view.loading.value, false)
})

test('cancelling a waitlist confirmation never calls the API', async () => {
  const { page: view, calls } = await waitlistPage({ dialogs: [new Error('cancelled')] })
  await view.load()
  await view.doCancel({ id: 1 })
  assert.equal(calls.dialogs.length, 1)
  assert.equal(calls.cancel.length, 0)
  assert.equal(view.cancelling.value, null)
})

test('confirmed waitlist exit calls the API, notifies and reloads the list', async () => {
  const { page: view, calls } = await waitlistPage()
  await view.load()
  await view.doCancel({ id: 2 })
  assert.deepEqual(calls.cancel, [2])
  assert.deepEqual(calls.success, ['已退出历史候补'])
  assert.equal(calls.list, 2, '退出成功后应重新读取')
  assert.equal(view.cancelling.value, null)
})

test('a failed waitlist exit keeps the error and clears the cancelling guard', async () => {
  const { page: view } = await waitlistPage({ cancel: () => Promise.reject(new Error('无权退出')) })
  await view.load()
  await view.doCancel({ id: 3 })
  assert.equal(view.error.value, '无权退出')
  assert.equal(view.cancelling.value, null)
})

test('only one waitlist exit can run at a time', async () => {
  const { page: view, calls } = await waitlistPage()
  await view.load()
  view.cancelling.value = 1
  await view.doCancel({ id: 2 })
  assert.equal(calls.dialogs.length, 0, '已有退出进行中时不弹确认框')
  assert.equal(calls.cancel.length, 0)
})

test('waitlist templates keep the loading, empty and exit-only-for-waiting rules', async () => {
  const { full: source } = await waitlistPage()
  assert.match(source, /正在读取历史候补…/)
  assert.match(source, /当前分类下暂无候补记录/)
  assert.match(source, /重试读取历史记录/)
  assert.match(source, /v-if="row\.status === 'waiting'"/)
})
