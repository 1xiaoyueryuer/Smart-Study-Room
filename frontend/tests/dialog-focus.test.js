import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { ref, watch, nextTick } from 'vue'

const flush = async () => { await nextTick(); await new Promise(resolve => setTimeout(resolve, 25)) }

async function loadFocus() {
  const source = await readFile(new URL('../src/composables/useDialogFocus.js', import.meta.url), 'utf8')
  const cleanups = []
  const document = { activeElement: null, body: { style: { overflow: 'auto' } } }
  const detail = []
  const context = vm.createContext({ console, document })
  const module = new vm.SourceTextModule(source, { context })
  await module.link(specifier => {
    assert.equal(specifier, 'vue')
    const exports = {
      nextTick,
      watch,
      onUnmounted: fn => cleanups.push(fn)
    }
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
    }, { context })
  })
  await module.evaluate()
  return { useDialogFocus: module.namespace.useDialogFocus, document, cleanups }
}

function focusable(tag, name) {
  return {
    tag,
    name,
    isConnected: true,
    getClientRects: () => [{}],
    closest: () => null,
    focus(options) {
      this.lastFocusOptions = options
      currentDocument.activeElement = this
    }
  }
}

let panelSeq = 0

function panelOf(elements) {
  const panel = {
    name: 'panel',
    id: 'panel-' + (++panelSeq),
    isConnected: true,
    active: null,
    querySelectorAll: () => elements,
    querySelector: selector => (selector.includes('input') ? elements.find(el => el.tag === 'input') || null : null),
    contains: node => node === panel || elements.includes(node),
    focus(options) {
      this.lastFocusOptions = options
      currentDocument.activeElement = this
    },
    getClientRects: () => [{}],
    closest: () => null
  }
  return panel
}

let currentDocument

function setup(useDialogFocus, elements, { open = false } = {}) {
  const document = currentDocument
  const panel = panelOf(elements)
  const isOpen = ref(open)
  const { trap } = useDialogFocus(isOpen, ref(panel))
  return { isOpen, panel, trap, document }
}

function tabEvent(shiftKey = false) {
  return { key: 'Tab', shiftKey, defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
}

test('opening a dialog moves focus into its first input', async () => {
  const { useDialogFocus, document } = await loadFocus()
  currentDocument = document
  const input = focusable('input', '账号')
  const button = focusable('button', '提交')
  const { isOpen, panel } = setup(useDialogFocus, [button, input])
  isOpen.value = true
  await flush()
  assert.equal(document.activeElement, input)
  assert.equal(input.lastFocusOptions?.preventScroll, true)
})

test('a dialog without inputs focuses the first focusable control, and with none the panel itself', async () => {
  const { useDialogFocus, document } = await loadFocus()
  currentDocument = document
  const button = focusable('button', '确定')
  const noInput = setup(useDialogFocus, [button])
  noInput.isOpen.value = true
  await flush()
  assert.equal(document.activeElement, button)

  const empty = setup(useDialogFocus, [])
  empty.isOpen.value = true
  await flush()
  assert.equal(document.activeElement.id, empty.panel.id)
})

test('opening locks page scrolling and closing restores the previous overflow and trigger focus', async () => {
  const { useDialogFocus, document } = await loadFocus()
  currentDocument = document
  const trigger = focusable('button', '打开')
  document.activeElement = trigger
  const input = focusable('input', '工号')
  const { isOpen } = setup(useDialogFocus, [input])
  isOpen.value = true
  await flush()
  assert.equal(document.body.style.overflow, 'hidden')
  assert.equal(document.activeElement, input)

  isOpen.value = false
  await flush()
  assert.equal(document.body.style.overflow, 'auto')
  assert.equal(document.activeElement, trigger, '关闭后焦点回到触发元素')
})

test('Tab from the last control wraps to the first, and Shift+Tab from the first wraps to the last', async () => {
  const { useDialogFocus, document } = await loadFocus()
  currentDocument = document
  const first = focusable('button', '取消')
  const middle = focusable('input', '说明')
  const last = focusable('button', '确定')
  const { isOpen, trap } = setup(useDialogFocus, [first, middle, last])
  isOpen.value = true
  await flush()

  document.activeElement = last
  const forward = tabEvent(false)
  trap(forward)
  assert.equal(forward.defaultPrevented, true)
  assert.equal(document.activeElement, first)

  document.activeElement = first
  const backward = tabEvent(true)
  trap(backward)
  assert.equal(backward.defaultPrevented, true)
  assert.equal(document.activeElement, last)
})

test('Tab inside the dialog in the middle does not intervene, and Tab from outside enters the dialog', async () => {
  const { useDialogFocus, document } = await loadFocus()
  currentDocument = document
  const first = focusable('button', '取消')
  const middle = focusable('input', '说明')
  const last = focusable('button', '确定')
  const { isOpen, trap } = setup(useDialogFocus, [first, middle, last])
  isOpen.value = true
  await flush()

  document.activeElement = middle
  const inside = tabEvent(false)
  trap(inside)
  assert.equal(inside.defaultPrevented, false)

  document.activeElement = focusable('button', '页面按钮')
  const outside = tabEvent(false)
  trap(outside)
  assert.equal(outside.defaultPrevented, true)
  assert.equal(document.activeElement, first)
})

test('Tab in a dialog with no focusable element keeps focus on the panel', async () => {
  const { useDialogFocus, document } = await loadFocus()
  currentDocument = document
  const { isOpen, panel, trap } = setup(useDialogFocus, [])
  isOpen.value = true
  await flush()
  const event = tabEvent(false)
  trap(event)
  assert.equal(event.defaultPrevented, true)
  assert.equal(document.activeElement.id, panel.id)
})

test('only the top dialog traps Tab and owns the scroll lock until both close', async () => {
  const { useDialogFocus, document } = await loadFocus()
  currentDocument = document
  const outerInput = focusable('input', '外层')
  const outer = setup(useDialogFocus, [outerInput])
  outer.isOpen.value = true
  await flush()

  const innerInput = focusable('input', '内层')
  const inner = setup(useDialogFocus, [innerInput])
  inner.isOpen.value = true
  await flush()
  assert.equal(document.activeElement, innerInput)
  assert.equal(document.body.style.overflow, 'hidden')

  const lowerEvent = tabEvent(false)
  outer.trap(lowerEvent)
  assert.equal(lowerEvent.defaultPrevented, false, '非顶层弹窗不接管 Tab')

  inner.isOpen.value = false
  await flush()
  assert.equal(document.body.style.overflow, 'hidden', '内层关闭后外层仍锁滚动')
  const topEvent = tabEvent(false)
  outer.trap(topEvent)
  assert.equal(document.activeElement, outerInput, '内层关闭后焦点回到外层输入框')
  assert.equal(topEvent.defaultPrevented, true, '外层只有一个可聚焦元素时 Tab 在框内循环')

  outer.isOpen.value = false
  await flush()
  assert.equal(document.body.style.overflow, 'auto')
})

test('unmounting releases the scroll lock so the page is not left frozen', async () => {
  const { useDialogFocus, document, cleanups } = await loadFocus()
  currentDocument = document
  const input = focusable('input', '备注')
  const { isOpen } = setup(useDialogFocus, [input])
  isOpen.value = true
  await flush()
  assert.equal(document.body.style.overflow, 'hidden')
  cleanups.forEach(fn => fn())
  assert.equal(document.body.style.overflow, 'auto')
})
