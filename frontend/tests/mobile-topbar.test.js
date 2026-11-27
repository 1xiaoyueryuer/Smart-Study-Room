import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { computed, nextTick, reactive, ref, watch } from 'vue'

const flush = async () => { await nextTick(); await new Promise(resolve => setTimeout(resolve, 0)) }

async function loadTopbar(overrides = {}) {
  const emits = []
  const closes = []
  const props = reactive({
    sidebarCollapsed: true,
    atTop: true,
    menus: [
      { index: '/', title: '首页', icon: 'home' },
      { index: '/mine', title: '我的预约', icon: 'reservations' },
      { index: '/admin', title: '管理端', icon: 'admin' }
    ],
    currentPath: '/',
    pageTitle: '首页',
    titleProgress: 0,
    ...overrides
  })
  const source = (await readFile(new URL('../src/components/MobileTopbar.vue', import.meta.url), 'utf8')).split('<script setup>')[1].split('</script>')[0]
  const context = vm.createContext({ console })
  const module = new vm.SourceTextModule(source + '\nexport {quickMenus,openSidebar,navigate,closeQuickMenu,isMenuOpen,quickMenu}', { context })
  await module.link(specifier => {
    const exports = specifier === 'vue'
      ? { computed, ref, watch }
      : specifier === './AppIcon.vue' || specifier === './HeaderPanel.vue'
        ? { default: {} }
        : null
    assert.ok(exports, `Unmocked import: ${specifier}`)
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
    }, { context })
  })
  context.defineProps = () => props
  context.defineEmits = () => (event, ...args) => emits.push([event, ...args])
  await module.evaluate()
  const page = module.namespace
  page.quickMenu.value = { close: () => closes.push(true) }
  return { page, props, emits, closes }
}

test('quick navigation hides the page you are already on and follows path changes', async () => {
  const { page, props } = await loadTopbar()
  assert.deepEqual(Array.from(page.quickMenus.value, item => item.index), ['/mine', '/admin'])
  props.currentPath = '/mine'
  await flush()
  assert.deepEqual(Array.from(page.quickMenus.value, item => item.index), ['/', '/admin'])
})

test('opening the sidebar closes the quick menu before emitting', async () => {
  const { page, emits, closes } = await loadTopbar()
  page.openSidebar()
  assert.equal(closes.length, 1)
  assert.deepEqual(emits, [['open-sidebar']])
})

test('navigating closes the quick menu and forwards the target path', async () => {
  const { page, emits, closes } = await loadTopbar()
  page.navigate('/mine')
  assert.equal(closes.length, 1)
  assert.deepEqual(emits, [['navigate', '/mine']])
})

test('a path change collapses the open quick menu', async () => {
  const { page, props, closes } = await loadTopbar()
  page.isMenuOpen.value = true
  props.currentPath = '/admin'
  await flush()
  assert.equal(closes.length, 1, '切到新页面后快捷菜单应收起')
})

test('expanding the sidebar collapses the quick menu while collapsing it does not force another close', async () => {
  const { page, props, closes } = await loadTopbar()
  props.sidebarCollapsed = false
  await flush()
  assert.equal(closes.length, 1, '侧栏展开时收起快捷菜单')
  props.sidebarCollapsed = true
  await flush()
  assert.equal(closes.length, 1, '侧栏收起不需要重复关闭')
})

test('the topbar starts with the quick menu closed and tolerates a missing panel ref', async () => {
  const { page } = await loadTopbar()
  assert.equal(page.isMenuOpen.value, false)
  page.quickMenu.value = null
  assert.doesNotThrow(() => page.closeQuickMenu())
})
