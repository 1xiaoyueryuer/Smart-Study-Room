import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { createRenderer, defineComponent, h, ref, watch, nextTick } from 'vue'
import { useServiceTargetClock as realClock } from '../src/composables/useServiceTargetClock.js'

const flush = async () => { await nextTick(); await new Promise(resolve => setTimeout(resolve, 0)) }

async function loadClock() {
  const source = await readFile(new URL('../src/composables/useServiceTargetClock.js', import.meta.url), 'utf8')
  const mounted = []
  const unmounted = []
  const context = vm.createContext({ console, Date })
  const module = new vm.SourceTextModule(source, { context })
  await module.link(specifier => {
    assert.equal(specifier, 'vue')
    const exports = {
      ref,
      watch,
      onMounted: fn => mounted.push(fn),
      onBeforeUnmount: fn => unmounted.push(fn)
    }
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
    }, { context })
  })
  await module.evaluate()
  return { clock: module.namespace, mounted, unmounted }
}

function runningTarget(overrides = {}) {
  return {
    id: 1,
    server_now: '2026-11-27T10:00:00+08:00',
    service_target: {
      kind: 'acceptance',
      status: 'running',
      remaining_seconds: 5,
      due_at: '2026-11-27T10:00:05+08:00',
      basis: 'open_at_submission',
      room_version: 1,
      calculated_at: '2026-11-27T09:00:00+08:00',
      ...overrides
    }
  }
}

function setup({ records, blocked = false, onDue = async () => {}, start = 1000 } = {}) {
  let now = start
  const scheduled = []
  const cancelled = []
  const monotonic = () => now
  const advance = seconds => { now += seconds * 1000 }
  const schedule = (fn, ms) => {
    scheduled.push({ fn, ms })
    return scheduled.length
  }
  const cancel = id => cancelled.push(id)
  return { records, blocked: ref(blocked), onDue, schedule, cancel, scheduled, cancelled, advance, monotonic }
}

async function startClock({ useServiceTargetClock }, options) {
  const state = setup(options)
  const clock = useServiceTargetClock({
    records: state.records,
    blocked: state.blocked,
    onDue: state.onDue,
    monotonic: state.monotonic,
    schedule: state.schedule,
    cancel: state.cancel
  })
  return { ...state, clock }
}

test('progress anchors on first read and counts down with monotonic time only', async () => {
  const { clock } = await loadClock()
  const state = await startClock({ useServiceTargetClock: clock.useServiceTargetClock }, { records: ref([runningTarget()]) })
  const record = state.records.value[0]
  assert.deepEqual({ ...state.clock.progress(record) }, { remaining_seconds: 5, awaiting_check: false, overdue_seconds: null })
  state.advance(2)
  assert.equal(state.clock.progress(record).remaining_seconds, 3)
  state.advance(10)
  const late = state.clock.progress(record)
  assert.equal(late.remaining_seconds, 0)
  assert.equal(late.awaiting_check, true)
})

test('repeated progress reads do not reset the anchor', async () => {
  const { clock } = await loadClock()
  const state = await startClock({ useServiceTargetClock: clock.useServiceTargetClock }, { records: ref([runningTarget()]) })
  const record = state.records.value[0]
  assert.equal(state.clock.progress(record).remaining_seconds, 5)
  state.advance(1)
  assert.equal(state.clock.progress(record).remaining_seconds, 4)
  assert.equal(state.clock.progress(record).remaining_seconds, 4)
})

test('the one-second timer triggers onDue exactly once per target once it is due', async () => {
  const { clock, mounted } = await loadClock()
  const requested = []
  const state = setup({ records: ref([runningTarget({ remaining_seconds: 1 })]), onDue: async due => requested.push(due.map(item => item.id)) })
  const targetClock = clock.useServiceTargetClock({
    records: state.records,
    blocked: state.blocked,
    onDue: state.onDue,
    monotonic: state.monotonic,
    schedule: state.schedule,
    cancel: state.cancel
  })
  mounted.forEach(fn => fn())
  assert.equal(state.scheduled.length, 1, '有进行中的目标时应创建 1 秒计时器')
  assert.equal(state.scheduled[0].ms, 1000)
  state.advance(2)
  state.scheduled[0].fn()
  await flush()
  assert.deepEqual(requested, [[1]])
  state.scheduled[0].fn()
  await flush()
  assert.deepEqual(requested, [[1]], '同一目标只请求一次核实')
  assert.ok(targetClock.progress(state.records.value[0]).awaiting_check)
})

test('blocked pages never auto-refresh even when a target is due', async () => {
  const { clock, mounted } = await loadClock()
  const requested = []
  const state = setup({ records: ref([runningTarget({ remaining_seconds: 1 })]), onDue: async due => requested.push(due) })
  state.blocked.value = true
  clock.useServiceTargetClock({
    records: state.records,
    blocked: state.blocked,
    onDue: state.onDue,
    monotonic: state.monotonic,
    schedule: state.schedule,
    cancel: state.cancel
  })
  mounted.forEach(fn => fn())
  state.advance(2)
  state.scheduled[0].fn()
  await flush()
  assert.deepEqual(requested, [], '页面忙时不得自动请求核实')
})

test('a failing onDue is swallowed and a later target can still be checked', async () => {
  const { clock, mounted } = await loadClock()
  const attempts = []
  let fail = true
  const state = setup({
    records: ref([runningTarget({ remaining_seconds: 1 })]),
    onDue: async due => {
      attempts.push(due.map(item => item.id))
      if (fail) throw new Error('网络失败')
    }
  })
  clock.useServiceTargetClock({
    records: state.records,
    blocked: state.blocked,
    onDue: state.onDue,
    monotonic: state.monotonic,
    schedule: state.schedule,
    cancel: state.cancel
  })
  mounted.forEach(fn => fn())
  state.advance(2)
  state.scheduled[0].fn()
  await flush()
  assert.deepEqual(attempts, [[1]])
  fail = false
  state.records.value = [
    state.records.value[0],
    { ...runningTarget({ remaining_seconds: 1 }), id: 2 }
  ]
  await flush()
  state.advance(2)
  state.scheduled[0].fn()
  await flush()
  assert.deepEqual(attempts.at(-1), [2], '失败后其它到期目标仍可核实，且已请求的 1 不重复')
})

test('the timer only exists while a running or overdue target is on the page', async () => {
  const { clock, mounted } = await loadClock()
  const records = ref([runningTarget()])
  const state = setup({ records })
  clock.useServiceTargetClock({
    records,
    blocked: state.blocked,
    onDue: state.onDue,
    monotonic: state.monotonic,
    schedule: state.schedule,
    cancel: state.cancel
  })
  mounted.forEach(fn => fn())
  assert.equal(state.scheduled.length, 1)
  records.value = [runningTarget({ status: 'completed' })]
  await flush()
  assert.deepEqual(state.cancelled, [1], '目标结束后停止计时')
  records.value = [runningTarget({ status: 'overdue', due_at: '2026-11-27T09:58:00+08:00' })]
  await flush()
  assert.equal(state.scheduled.length, 2, '出现超时目标后重新启动计时')
})

test('unmount stops the timer and ignores late ticks', async () => {
  const { clock, mounted, unmounted } = await loadClock()
  const requested = []
  const state = setup({ records: ref([runningTarget({ remaining_seconds: 1 })]), onDue: async due => requested.push(due) })
  clock.useServiceTargetClock({
    records: state.records,
    blocked: state.blocked,
    onDue: state.onDue,
    monotonic: state.monotonic,
    schedule: state.schedule,
    cancel: state.cancel
  })
  mounted.forEach(fn => fn())
  unmounted.forEach(fn => fn())
  assert.deepEqual(state.cancelled, [1])
  state.advance(2)
  state.scheduled[0].fn()
  await flush()
  assert.deepEqual(requested, [], '卸载后迟到的 tick 不得请求核实')
})

test('overdue targets report growing overdue seconds instead of a remaining countdown', async () => {
  const { clock } = await loadClock()
  const state = await startClock(
    { useServiceTargetClock: clock.useServiceTargetClock },
    { records: ref([runningTarget({ status: 'overdue', remaining_seconds: null, due_at: '2026-11-27T09:59:00+08:00' })]) }
  )
  const record = state.records.value[0]
  const atRead = state.clock.progress(record)
  assert.equal(atRead.remaining_seconds, null)
  assert.equal(atRead.awaiting_check, false)
  assert.equal(atRead.overdue_seconds, 60)
  state.advance(30)
  assert.equal(state.clock.progress(record).overdue_seconds, 90)
})

test('open-hours targets do not invent an overdue duration', async () => {
  const { clock } = await loadClock()
  const state = await startClock(
    { useServiceTargetClock: clock.useServiceTargetClock },
    { records: ref([runningTarget({ status: 'overdue', remaining_seconds: null, basis: 'service_open_hours_24', due_at: '2026-11-27T09:59:00+08:00' })]) }
  )
  assert.equal(state.clock.progress(state.records.value[0]).overdue_seconds, null)
})

test('a mounted page owns exactly one timer and releases it on unmount', async () => {
  const requested = []
  let now = 1000
  const scheduled = []
  const cancelled = []
  const records = ref([runningTarget({ remaining_seconds: 1 })])
  const noop = () => {}
  const renderer = createRenderer({
    insert: noop, remove: noop, createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    setText: noop, setElementText: noop, parentNode: () => null, nextSibling: () => null,
    patchProp: noop, setScopeId: noop
  })
  const App = defineComponent({
    setup() {
      realClock({
        records,
        blocked: ref(false),
        onDue: async due => requested.push(due.map(item => item.id)),
        monotonic: () => now,
        schedule: (fn, ms) => { scheduled.push({ fn, ms }); return scheduled.length },
        cancel: id => cancelled.push(id)
      })
      return () => h('div')
    }
  })
  const app = renderer.createApp(App)
  app.mount({})
  await flush()
  assert.equal(scheduled.length, 1, '挂载后启动 1 秒计时')
  assert.equal(scheduled[0].ms, 1000)
  now += 2000
  scheduled[0].fn()
  await flush()
  assert.deepEqual(requested, [[1]])
  app.unmount()
  await flush()
  assert.deepEqual(cancelled, [1], '卸载后释放计时器')
  now += 2000
  scheduled[0].fn()
  await flush()
  assert.deepEqual(requested, [[1]], '卸载后迟到的 tick 不再核实')
})
