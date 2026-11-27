import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { computed, nextTick, ref, watch } from 'vue'
import { activeHeaderPanel } from '../src/composables/headerPanel.js'

const flush = async () => { await nextTick(); await new Promise(resolve => setTimeout(resolve, 0)) }

function gsapMock() {
  const calls = []
  return {
    calls,
    gsap: {
      fromTo: (target, from, to) => { calls.push(['fromTo', target, from, to]); to?.onComplete?.(); return {} },
      to: (target, vars) => { calls.push(['to', target, vars]); vars?.onComplete?.(); return {} },
      from: (target, vars) => { calls.push(['from', target, vars]); return {} },
      killTweensOf: target => calls.push(['killTweensOf', target]),
      set: (target, vars) => calls.push(['set', target, vars]),
      context: fn => {
        fn()
        return { revert: () => calls.push(['context.revert']) }
      },
      matchMedia: () => ({
        add: (query, fn) => { calls.push(['matchMedia', query]); if (!calls.reduced) fn() },
        revert: () => calls.push(['matchMedia.revert'])
      })
    }
  }
}

async function loadMotion({ reduced = false, withMatchMedia = true, elements = [] } = {}) {
  const source = await readFile(new URL('../src/composables/motion.js', import.meta.url), 'utf8')
  const { gsap, calls } = gsapMock()
  if (reduced) calls.reduced = true
  const window = withMatchMedia ? { matchMedia: query => ({ matches: reduced, media: query }) } : {}
  const context = vm.createContext({ console, window, document: { createElement: () => fakeTrack() } })
  const module = new vm.SourceTextModule(source, { context })
  await module.link(specifier => {
    assert.equal(specifier, 'gsap')
    return new vm.SyntheticModule(['gsap'], function () { this.setExport('gsap', gsap) }, { context })
  })
  await module.evaluate()
  return { motion: module.namespace, calls, elements }
}

function fakeElement(children = []) {
  return {
    children,
    querySelectorAll: selector => selector.includes('.card') || selector.includes('tr') ? children : [],
    querySelector: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }),
    scrollLeft: 0,
    scrollTop: 0,
    classList: { add() {} }
  }
}

function fakeTrack() {
  return {
    className: '',
    style: {},
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value },
    prepend(el) { this.prepended = el },
    remove() { this.removed = true }
  }
}

test('page transitions play the normal durations and always finish', async () => {
  const { motion, calls } = await loadMotion()
  let entered = false, left = false
  motion.pageMotion.enter(fakeElement(), () => { entered = true })
  assert.equal(entered, true)
  const enter = calls.find(call => call[0] === 'fromTo')
  assert.ok(enter, '页面进入应创建补间')
  assert.equal(enter[2].opacity, 0)
  assert.equal(enter[3].duration, 0.22)
  assert.equal(enter[3].clearProps, 'opacity')

  motion.pageMotion.leave(fakeElement(), () => { left = true })
  assert.equal(left, true)
  const leave = calls.findLast(call => call[0] === 'to')
  assert.equal(leave[2].duration, 0.1)
})

test('reduced motion keeps the page transition nearly instant instead of animating', async () => {
  const { motion, calls } = await loadMotion({ reduced: true })
  motion.pageMotion.enter(fakeElement(), () => {})
  assert.equal(calls.find(call => call[0] === 'fromTo')[3].duration, 0.06)
  motion.pageMotion.leave(fakeElement(), () => {})
  assert.equal(calls.findLast(call => call[0] === 'to')[2].duration, 0)
})

test('cancelling a page transition kills tweens and drops the inline opacity', async () => {
  const { motion, calls } = await loadMotion()
  const el = fakeElement()
  motion.pageMotion.cancel(el)
  assert.deepEqual(calls.map(call => call[0]), ['killTweensOf', 'set'])
  assert.deepEqual({ ...calls[1][2] }, { clearProps: 'opacity' })
})

test('reveal animates at most seven known blocks when motion is allowed', async () => {
  const { motion, calls } = await loadMotion()
  const children = Array.from({ length: 9 }, () => fakeElement())
  const el = fakeElement(children)
  el.querySelectorAll = () => children
  motion.revealDirective.mounted(el)
  assert.equal(calls[0][0], 'matchMedia')
  assert.equal(calls[0][1], '(prefers-reduced-motion: no-preference)')
  const from = calls.find(call => call[0] === 'from')
  assert.ok(from, '允许动效时应执行入场动画')
  assert.equal(from[1].length, 7)
  assert.equal(from[2].y, 8)
  assert.equal(from[2].opacity, 0)
  motion.revealDirective.unmounted(el)
  assert.equal(calls.at(-1)[0], 'matchMedia.revert')
})

test('reveal does not animate when the reduced-motion branch is taken', async () => {
  const { motion, calls } = await loadMotion({ reduced: true })
  const el = fakeElement()
  motion.revealDirective.mounted(el)
  assert.equal(calls.filter(call => call[0] === 'from').length, 0)
})

test('list motion only animates when the binding value changes', async () => {
  const { motion, calls } = await loadMotion()
  const rows = [fakeElement(), fakeElement()]
  const el = fakeElement(rows)
  el.querySelectorAll = () => rows
  motion.listMotionDirective.mounted(el)
  motion.listMotionDirective.updated(el, { value: 1, oldValue: 0 })
  const from = calls.find(call => call[0] === 'fromTo')
  assert.ok(from)
  assert.equal(from[1].length, 2)
  assert.equal(from[2].opacity, 0.25)
  assert.equal(from[3].duration, 0.18)

  const before = calls.length
  motion.listMotionDirective.updated(el, { value: 1, oldValue: 1 })
  assert.equal(calls.length, before, '绑定值未变化时不应重复播放')
  motion.listMotionDirective.unmounted(el)
})

test('the moving track is created, hidden without an active tab, and cleaned up', async () => {
  const { motion, calls } = await loadMotion()
  const track = fakeTrack()
  const el = fakeElement()
  el.prepend = node => { el.prepended = node }
  el.querySelector = () => null
  const context = vm.createContext({
    console,
    window: { matchMedia: () => ({ matches: false }) },
    document: { createElement: () => track },
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} }
  })
  const source = await readFile(new URL('../src/composables/motion.js', import.meta.url), 'utf8')
  const { gsap } = gsapMock()
  const module = new vm.SourceTextModule(source, { context })
  await module.link(() => new vm.SyntheticModule(['gsap'], function () { this.setExport('gsap', gsap) }, { context }))
  await module.evaluate()
  module.namespace.activeTrackDirective.mounted(el)
  assert.equal(el.prepended, track)
  assert.equal(track.attributes['aria-hidden'], 'true')
  assert.equal(track.style.opacity, '0', '没有激活标签时轨道隐藏')
  module.namespace.activeTrackDirective.unmounted(el)
  assert.equal(track.removed, true)
  assert.ok(calls.every(call => call[0] !== 'to'), '无激活标签时不应移动轨道')
})

let headerIdSeq = 0

async function loadHeaderPanel() {
  const calls = []
  const events = []
  const document = {
    listeners: [],
    addEventListener: (type, fn) => document.listeners.push([type, fn]),
    removeEventListener: (type, fn) => { document.listeners = document.listeners.filter(pair => !(pair[0] === type && pair[1] === fn)) }
  }
  let observer
  const source = (await readFile(new URL('../src/components/HeaderPanel.vue', import.meta.url), 'utf8')).split('<script setup>')[1].split('</script>')[0]
  const mounted = []
  const unmounted = []
  const context = vm.createContext({
    console,
    document,
    ResizeObserver: class { constructor(fn) { observer = this; this.fn = fn } observe() { calls.push('observe') } disconnect() { calls.push('disconnect') } }
  })
  const module = new vm.SourceTextModule(source + '\nexport {toggle,close,open,height,trigger,content,root}', { context })
  await module.link(specifier => {
    const exports = specifier === 'vue'
      ? { ref, computed, watch, useId: () => `panel-${++headerIdSeq}`, onMounted: fn => mounted.push(fn), onUnmounted: fn => unmounted.push(fn) }
      : specifier === './AppIcon.vue'
        ? { default: {} }
        : { activeHeaderPanel }
    assert.ok(exports, `Unmocked import: ${specifier}`)
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
    }, { context })
  })
  const props = { title: '测试面板', icon: 'info', width: 340 }
  context.defineProps = () => props
  context.defineEmits = () => (event, ...args) => events.push([event, ...args])
  context.defineExpose = value => { calls.push(['expose', value]) }
  await module.evaluate()
  const page = module.namespace
  const trigger = { focus: () => calls.push('trigger.focus') }
  page.trigger.value = trigger
  page.content.value = { getBoundingClientRect: () => ({ height: 100 }) }
  page.root.value = { contains: node => node?.inside === true }
  return { page, events, calls, mounted, unmounted, document, observer: () => observer }
}

test('header panel toggles only its own id and is idempotent to close when already closed', async () => {
  activeHeaderPanel.value = null
  const { page } = await loadHeaderPanel()
  page.toggle()
  assert.equal(page.open.value, true)
  page.close()
  assert.equal(page.open.value, false)
  page.close()
  assert.equal(page.open.value, false, '重复关闭保持关闭')
})

test('only one header panel can be expanded at a time', async () => {
  activeHeaderPanel.value = null
  const first = await loadHeaderPanel()
  const second = await loadHeaderPanel()
  first.page.toggle()
  assert.equal(first.page.open.value, true)
  second.page.toggle()
  assert.equal(second.page.open.value, true)
  assert.equal(first.page.open.value, false, '打开第二个面板会收起第一个')
  activeHeaderPanel.value = null
})

test('header panel emits its open state, survives mount, and always closes on unmount', async () => {
  activeHeaderPanel.value = null
  const { page, events, mounted, unmounted, document } = await loadHeaderPanel()
  assert.deepEqual(events[0], ['toggle', false], '初始状态也会同步一次')
  mounted.forEach(fn => fn())
  assert.ok(document.listeners.some(([type]) => type === 'pointerdown'), '挂载后监听页面点击')
  page.toggle()
  await flush()
  assert.deepEqual(events.at(-1), ['toggle', true])
  unmounted.forEach(fn => fn())
  assert.equal(page.open.value, false, '卸载时必须收起')
  assert.equal(document.listeners.filter(([type]) => type === 'pointerdown').length, 0)
})
