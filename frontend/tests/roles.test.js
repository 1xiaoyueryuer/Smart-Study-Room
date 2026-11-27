import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '../src/stores/auth.js'
import * as statsForm from '../src/composables/statsForm.js'
import {createStatsRefresh} from '../src/composables/statsRefresh.js'
import * as campusDateTime from '../src/composables/campusDateTime.js'
import {statsClock} from './helpers/statsClock.js'

async function auth(role) {
  const values = new Map()
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  setActivePinia(createPinia())
  const store = useAuthStore()
  store.setLogin({ token: 'test-token', user: { role, credit_score: 100 } })
  return store
}
async function sourceModule(source, mocks, extra = {}) {
  const context = vm.createContext({ console, ...extra })
  const module = new vm.SourceTextModule(source, { context })
  await module.link(specifier => {
    assert.ok(specifier in mocks || specifier.endsWith('/checkinDeadline.js') || specifier.endsWith('/campusDateTime.js'), `Unmocked import: ${specifier}`)
    const exports = mocks[specifier] || (specifier.endsWith('/campusDateTime.js') ? campusDateTime : { checkinDeadlineOf: () => null, deadlineLabel: () => '' })
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
    }, { context })
  })
  await module.evaluate()
  return module.namespace
}
async function router(store) {
  let guard, routes
  const source = await readFile(new URL('../src/router/index.js', import.meta.url), 'utf8')
  await sourceModule(source, {
    'vue-router': { createWebHistory: () => ({}), createRouter: config => { routes = config.routes; return { beforeEach: callback => { guard = callback } } } },
    '../stores/auth': { useAuthStore: () => store },
    '../config/branding': { SYSTEM_NAME: 'Test' }
  }, { document: {} })
  return { guard, route: name => routes[1].children.find(item => item.name === name), routeForPath: path => routes[1].children.find(item => item.path === path) }
}
for (const role of ['student', 'staff']) {
  test(`${role} can use the same ordinary routes and retains identity`, async () => {
    const store = await auth(role)
    assert.equal(store.isOrdinary, true)
    assert.equal(store.isAdmin, false)
    assert.equal(store.roleLabel, role === 'staff' ? '教职工' : '学生')
    const navigation = await router(store)
    for (const name of ['home', 'booking', 'mine', 'waitlist', 'notifications', 'complaints', 'complaint-detail', 'profile']) {
      const route = navigation.route(name)
      assert.equal(navigation.guard({ ...route, fullPath: route.path }), undefined)
    }
    assert.equal(navigation.guard(navigation.route('admin')), '/')
    assert.equal(navigation.guard(navigation.route('analytics')), '/')
    assert.equal(navigation.guard(navigation.route('lan')), '/')
    assert.equal(store.isLoggedIn, true)
  })
}
test('administrator has management routes and cannot enter ordinary booking routes', async () => {
  const store = await auth('admin')
  const navigation = await router(store)
  assert.equal(store.isOrdinary, false)
  assert.equal(store.roleLabel, '管理员')
  assert.equal(navigation.guard(navigation.route('admin')), undefined)
  assert.equal(navigation.guard(navigation.route('analytics')), undefined)
  assert.equal(navigation.guard(navigation.route('lan')), undefined)
  assert.equal(navigation.guard(navigation.route('booking')), '/admin')
  assert.equal(navigation.guard(navigation.route('complaints')), '/admin')
  assert.equal(navigation.guard(navigation.route('complaint-detail')), '/admin')
})
test('unknown identity is removed rather than treated as an ordinary user', async () => {
  const store = await auth('unknown')
  const navigation = await router(store)
  assert.equal(navigation.guard(navigation.route('home')).name, 'login')
  assert.equal(store.isLoggedIn, false)
})
for (const role of ['student', 'staff', 'admin']) {
  test(`${role} homepage only requests management statistics for administrator`, async () => {
    const store = await auth(role)
    let mounted, statsCalls = 0
    const clock=statsClock(),cleanup=[]
    const source = (await readFile(new URL('../src/views/HomeView.vue', import.meta.url), 'utf8')).split('<script setup>')[1].split('</script>')[0]
    const mocks = {
      vue: { ref: value => ({ value }), computed: getter => ({ get value() { return getter() } }), onMounted: callback => { mounted = callback }, onUnmounted: fn => cleanup.push(fn) },
      'vue-router': { useRouter: () => ({ push() {} }) },
      '../stores/auth': { useAuthStore: () => store },
      '../stores/notification': { useNotificationStore: () => ({ unread: 0, refresh() {} }) },
      '../api/room': { getRooms: async () => ({ data: [] }), getOpeningWindows: async () => ({ data: { windows: [], closed_reasons: [] } }) },
      '../api/stats': { getOverview: async () => { statsCalls++; return { data: {} } } },
      '../api/reservation': { listMyReservations: async () => ({ data: [] }) },
      '../api/notification': { listNotifications: async () => ({ data: [] }) },
      '../composables/checkinDeadline.js': { checkinDeadlineOf: () => null, deadlineLabel: () => '' },
      '../composables/statsForm.js': statsForm,
      '../composables/statsRefresh.js': {createStatsRefresh:options=>createStatsRefresh({...options,...clock.options})},
      '../api/credit': { getCreditOverview: async () => ({ data: { score: 100 } }) }
    }
    for (const component of ['StudyTips', 'ui/SAnimatedNumber', 'AppIcon', 'ui/SBanner', 'ui/SButton']) mocks[`../components/${component}.vue`] = { default: {} }
    const homepage = await sourceModule(source + '\nexport { shortcuts }', mocks, { setInterval: () => 1, clearInterval() {} })
    await mounted()
    await clock.flush()
    assert.equal(statsCalls, role === 'admin' ? 1 : 0)
    assert.equal(clock.timers.size,role==='admin'?1:0)
    await clock.advance(30000)
    assert.equal(statsCalls,role==='admin'?4:0)
    const navigation = await router(store)
    for (const shortcut of homepage.shortcuts.value) {
      const route = navigation.routeForPath(shortcut.to)
      assert.ok(route, `Shortcut ${shortcut.title} must resolve to an existing route`)
      assert.equal(navigation.guard(route), undefined, `${role} must be able to access ${shortcut.to}`)
    }
    cleanup.forEach(fn=>fn());assert.equal(clock.timers.size,0);assert.equal(clock.listeners.size,0)
  })
}
test('ordinary homepage loads own reservations and recent management cancellations without reading room opening windows', async () => {
  const store = await auth('student')
  const calls = { reservations: [], notifications: [], stats: 0 }
  const slot = { res_date: '2026-11-20', start_time: '19:30:00', end_time: '21:30:00' }
  const source = (await readFile(new URL('../src/views/HomeView.vue', import.meta.url), 'utf8')).split('<script setup>')[1].split('</script>')[0]
  const mocks = {
    vue: { ref: value => ({ value }), computed: getter => ({get value(){return getter()}}), onMounted(){}, onUnmounted(){} },
    'vue-router': { useRouter: () => ({push(){}}) },
    '../stores/auth': { useAuthStore: () => store },
    '../stores/notification': { useNotificationStore: () => ({unread:2,refresh(){}}) },
    '../api/reservation': { listMyReservations: async query => { calls.reservations.push(query); return { data: { items: [{status:'pending',...slot},{status:'checked_in',...slot},{status:'completed',...slot}] } } } },
    '../api/stats': { getOverview: async () => { calls.stats++; return {data:{}} } },
    '../api/notification': { listNotifications: async query => { calls.notifications.push(query); return {data:{items:[{id:1,type:'management_cancelled'},{id:2,type:'system'}]}} } },
    '../composables/statsForm.js': statsForm,
    '../composables/statsRefresh.js': {createStatsRefresh:()=>({refresh(){calls.stats++},select(){},start(){},stop(){}})},
    '../components/StudyTips.vue': {default:{}},
    '../components/ui/SBanner.vue': {default:{}},
    '../components/ui/SButton.vue': {default:{}}
  }
  const page = await sourceModule(source+'\nexport {loadReservations,loadCancellations,reservations,cancellations,activeReservations,pendingCount,checkedInCount,completedCount,zones,statusText,timeText}',mocks)
  // 首页不再展示每间自习室的开放时段：不再引入房间/开放安排接口
  assert.doesNotMatch(source,/getRooms|getOpeningWindows|roomOpeningText|open_time|close_time/)
  await page.loadReservations()
  assert.deepEqual({...calls.reservations[0]},{page:1,page_size:20})
  assert.equal(page.reservations.value.length,3)
  assert.equal(page.activeReservations.value.length,2)
  assert.equal(page.pendingCount.value,1)
  assert.equal(page.checkedInCount.value,1)
  assert.equal(page.completedCount.value,1)
  assert.deepEqual(Array.from(page.zones, zone => zone.name),['A区','B区','C区','D区'])
  assert.equal(page.statusText({status:'pending'}),'待签到')
  assert.equal(page.statusText({status:'checked_in'}),'使用中')
  assert.equal(page.statusText({status:'completed'}),'已结束')
  assert.equal(page.timeText(slot),'2026-11-20 19:30—21:30')
  await page.loadCancellations()
  assert.deepEqual({...calls.notifications[0]},{page:1,page_size:3,type:'management_cancelled'})
  assert.equal(page.cancellations.value.length,1)
  assert.equal(page.cancellations.value[0].id,1)
  assert.equal(calls.stats,0)
})

test('administrator homepage skips personal reservation reads and loads the real stats snapshot instead', async () => {
  const store = await auth('admin')
  const calls = { reservations: 0, notifications: 0, refreshes: [] }
  const source = (await readFile(new URL('../src/views/HomeView.vue', import.meta.url), 'utf8')).split('<script setup>')[1].split('</script>')[0]
  const mocks = {
    vue: { ref: value => ({ value }), computed: getter => ({get value(){return getter()}}), onMounted(){}, onUnmounted(){} },
    'vue-router': { useRouter: () => ({push(){}}) },
    '../stores/auth': { useAuthStore: () => store },
    '../stores/notification': { useNotificationStore: () => ({unread:0,refresh(){}}) },
    '../api/reservation': { listMyReservations: async () => { calls.reservations++; return {data:{items:[]}} } },
    '../api/stats': { getOverview: async () => ({data:{}}) },
    '../api/notification': { listNotifications: async () => { calls.notifications++; return {data:{items:[]}} } },
    '../composables/statsForm.js': statsForm,
    '../composables/statsRefresh.js': {createStatsRefresh:()=>({refresh:key=>calls.refreshes.push(key),select(){},start(){},stop(){}})},
    '../components/StudyTips.vue': {default:{}},
    '../components/ui/SBanner.vue': {default:{}},
    '../components/ui/SButton.vue': {default:{}}
  }
  const page = await sourceModule(source+'\nexport {loadReservations,loadCancellations,loadStats,reservations,cancellations}',mocks)
  await page.loadReservations()
  await page.loadCancellations()
  assert.equal(calls.reservations,0)
  assert.equal(calls.notifications,0)
  assert.equal(page.reservations.value.length,0)
  assert.equal(page.cancellations.value.length,0)
  await page.loadStats()
  assert.deepEqual(calls.refreshes,['overview'])
})
