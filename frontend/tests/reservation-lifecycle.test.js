import {recordTestImport} from './record-fixtures.js'
import * as reviewManagement from '../src/composables/reviewManagement.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { ref, computed, reactive, watch, nextTick } from 'vue'
async function script(file, mocks, exports, extra={}) {
  const source=(await readFile(new URL(file,import.meta.url),'utf8')).split('<script setup>')[1].split('</script>')[0]
  const context=vm.createContext({defineExpose(){},defineProps:()=>({autoLoad:false}),...extra})
  const module=new vm.SourceTextModule(source+`\nexport {${exports}}`,{context})
  await module.link(specifier=>{
    const values=recordTestImport(specifier,mocks[specifier])||(specifier.endsWith('/reviewManagement.js')?reviewManagement:null)||(specifier.endsWith('.vue')?{default:{}}:null)
    assert.ok(values,specifier)
    return new vm.SyntheticModule(Object.keys(values),function(){for(const[key,value]of Object.entries(values))this.setExport(key,value)},{context})
  })
  await module.evaluate()
  return module.namespace
}
const waiting=(allowed_actions=['cancel'])=>({id:10,status:'pending',allowed_actions,res_date:'2026-11-01',start_time:'09:00',end_time:'10:00'})
async function mine(overrides={}) {
  const calls=[],confirmations=[]
  const api={listMyReservations:async()=>{calls.push('mine');return{data:[waiting([])]}},...Object.fromEntries(['cancel','abandon','checkin','leave','return','checkout'].map(key=>[`${key}Reservation`,async id=>{calls.push(key);return{data:{id}}}])),...overrides}
  const page=await script('../src/views/MyReservationsView.vue',{
    vue:{ref,computed,onMounted(){},onBeforeUnmount(){}},
    'vue-router':{useRoute:()=>({query:{}}),useRouter:()=>({push:async location=>{calls.push(location)}})},
    '../composables/usePagination':{usePagination:items=>({page:ref(1),pages:computed(()=>1),pageItems:items})},
    '../components/ui/feedback':{message:{success(){}},confirmDialog:overrides.confirmDialog|| (async text=>{confirmations.push(text)})},
    '../api/reservation':api,
    '../composables/checkinDeadline.js':{checkinDeadlineOf:()=>null,deadlineLabel:()=>''}
  },'list,loading,error,actionError,actionResult,actionResultId,busyId,actionsOf,doAction,readActionResult,refreshAll,terminationLabels,snapshot,requestOccupationHelp,showReviewEntry')
  return{...page,calls,confirmations}
}
test('reservation buttons use only server allowed_actions, never infer cancel or abandon from pending',async()=>{
  const page=await mine()
  assert.deepEqual(Array.from(page.actionsOf(waiting(['cancel'])),item=>item.key),['cancel'])
  assert.deepEqual(Array.from(page.actionsOf(waiting(['checkin','abandon'])),item=>item.key),['checkin','abandon'])
  assert.equal(page.actionsOf({status:'pending'}).length,0)
  assert.equal(page.actionsOf(waiting(['not_implemented'])).length,0)
})
test('the review entry appears after actual use ends, including automatic completion', async () => {
  const page = await mine()
  const usage = { checkin_at: '09:00', ended_at: '09:30', settled_at: '09:30' }
  assert.equal(page.showReviewEntry({ status: 'completed', termination_reason: 'auto_end', usage_record: usage }), true)
  assert.equal(page.showReviewEntry({ status: 'cancelled', termination_reason: 'admin_resource_change', usage_record: usage }), true)
  assert.equal(page.showReviewEntry({ status: 'checked_in', usage_record: { checkin_at: '09:00' } }), false)
  assert.equal(page.showReviewEntry({ status: 'unused_ended', usage_record: null }), false)
  assert.equal(page.showReviewEntry({ status: 'completed', usage_record: { ...usage, settled_at: null } }), false)
})
test('before-start cancellation and after-start abandonment have distinct truthful confirmations and refresh both sources',async()=>{
  const cancellation=await mine()
  await cancellation.doAction(waiting(['cancel']),'cancel')
  assert.match(cancellation.confirmations[0],/开始前取消不扣信用分/)
  assert.deepEqual(cancellation.calls,['cancel','mine'])
  const abandonment=await mine()
  await abandonment.doAction(waiting(['abandon']),'abandon')
  assert.match(abandonment.confirmations[0],/登记一次违规，扣 10 分/)
  assert.deepEqual(abandonment.calls,['abandon','mine'])
})
test('action in-flight guard includes confirmation dialog and prevents duplicate abandonment',async()=>{
  let release
  const page=await mine({confirmDialog:()=>new Promise(resolve=>{release=resolve})})
  const first=page.doAction(waiting(['abandon']),'abandon')
  assert.equal(page.busyId.value,10)
  await page.doAction(waiting(['abandon']),'abandon')
  release();await first
  assert.equal(page.calls.filter(key=>key==='abandon').length,1)
  assert.equal(page.busyId.value,null)
})
test('committed deadline 409 is explained and actual no_show state plus independent records are re-read',async()=>{
  const page=await mine({abandonReservation:async()=>{throw{status:409,message:'已超时',details:{reservation_id:10,status:'unused_ended',termination_reason:'no_show'}}},listMyReservations:async()=>({data:[{id:10,status:'unused_ended',termination_reason:'no_show',allowed_actions:[]}]})})
  await page.doAction(waiting(['abandon']),'abandon')
  assert.match(page.actionError.value,/超时未签到结束，记一次违规/)
  assert.equal(page.list.value[0].status,'unused_ended')
  assert.equal(page.actionsOf(page.list.value[0]).length,0)

})
test('failed reservation refresh stays visible and still refreshes independent violation source',async()=>{
  const page=await mine({listMyReservations:async()=>{throw new Error('预约查询失败')}})
  await page.refreshAll()
  assert.equal(page.error.value,'预约查询失败')
  assert.deepEqual(page.calls,[])
  await page.doAction(waiting(['cancel']),'cancel')
  assert.equal(page.calls.includes('cancel'),false)
})
test('an unconfirmed cancellation can be checked again without repeating the request', async () => {
  let cancellationCalls = 0
  let detailCalls = 0
  const row = { ...waiting([]), status: 'cancelled' }
  const page = await mine({
    cancelReservation: async () => {
      cancellationCalls++
      throw { status: null }
    },
    getReservation: async () => {
      if (++detailCalls === 1) throw { status: null }
      return { data: row }
    },
    listMyReservations: async () => ({ data: [] })
  })
  await page.doAction(waiting(['cancel']), 'cancel')
  assert.equal(page.actionResultId.value, 10)
  assert.equal(page.actionResult.value, '')

  await page.readActionResult()
  assert.equal(page.actionResultId.value, null)
  assert.equal(page.actionError.value, '')
  assert.match(page.actionResult.value, /已取消/)
  assert.equal(cancellationCalls, 1)
  assert.equal(detailCalls, 2)
})
test('legacy terminal state is explained without fabricating an independent violation count',async()=>{
  const page=await mine()
  page.list.value=[{id:10,status:'unused_ended',legacy_status:'violation',termination_reason:'legacy_violation',allowed_actions:[]}]
  assert.match(page.terminationLabels.legacy_violation,/不另计违规/)
  assert.equal(page.snapshot.value,null)
  const source=await readFile(new URL('../src/views/MyReservationsView.vue',import.meta.url),'utf8')
  assert.match(source,/截止时间前扫描座位二维码/)
  assert.doesNotMatch(source,/今日待签到|kpi-label">违约记录/)
})
async function violations(loader) {
  return script('../src/components/ViolationsPanel.vue',{
    vue:{ref,computed,onMounted(){},onBeforeUnmount(){},watch(){},nextTick:async()=>{}},'vue-router':{useRoute:()=>({query:{}})},'../api/violation':{listMyViolations:loader,getMyViolation:async()=>{throw new Error('无关联目标')}}
  },'items,error,loading,loaded,snapshot,refresh')
}
test('independent effective count uses record status and preserves revoked records',async()=>{
  const page=await violations(async()=>({data:[{id:1,status:'active',type:'no_show'},{id:2,status:'revoked',type:'abandon'}]}))
  await page.refresh()
  assert.equal(page.items.value.length,2)
  assert.deepEqual(Array.from(page.items.value,row=>row.status),['active','revoked']);assert.equal(page.snapshot.value.total,2)
})
test('violation failure is separate from empty data and can recover through actual retry',async()=>{
  let fail=true
  const page=await violations(async()=>{if(fail)throw new Error('违规读取失败');return{data:[]}})
  assert.equal(page.loaded.value,false)
  await page.refresh()
  assert.equal(page.error.value,'违规读取失败')
  assert.equal(page.loaded.value,false)
  fail=false;await page.refresh()
  assert.equal(page.error.value,'')
  assert.equal(page.items.value.length,0)
  assert.equal(page.loaded.value,true)
  const source=await readFile(new URL('../src/components/ViolationsPanel.vue',import.meta.url),'utf8')
  assert.match(source,/v-else-if="error"/)
  assert.match(source,/v-else-if="!loaded"/)
  assert.match(source,/等待加载违规记录/)
  assert.match(source,/没有符合筛选条件的违规记录/)
})
test('profile displays current credit and restoration separately from server booking eligibility',async()=>{
  for(const file of ['ProfileView','HomeView','LoginView','MyReservationsView']){
    const source=await readFile(new URL(`../src/views/${file}.vue`,import.meta.url),'utf8')
    assert.doesNotMatch(source,/履约加分|违约扣分|低于 60|可正常预约|按期履约 \+1|不足 30 分钟的取消将扣除/)
    if(file==='ProfileView'){
      assert.doesNotMatch(source,/overview\.legacy_ban_active === true/);assert.match(source,/<RestrictionsPanel/)
      assert.match(source,/当前信誉分/)
      assert.match(source,/当前预计恢复满分时间/)
      assert.doesNotMatch(source,/new Date\(until\)|scoreColor/)
    }
  }
})

test('profile reloads authoritative credit and booking eligibility at the server-provided recovery time', async () => {
  let mounted, unmount, refreshCallback, refreshDelay
  let creditReads = 0
  let eligibilityReads = 0
  const data = {
    score: 90,
    server_now: '2026-11-26T12:00:00+08:00',
    reset_at: '2026-11-27T12:00:00+08:00',
    violation_count: 1,
    deduction_per_violation: 10,
    logs: [{ id: 1, delta: -10 }],
    historical_logs: [{ id: 1, delta: 1 }]
  }
  const profile = await script('../src/views/ProfileView.vue', {
    vue: { ref, computed, watch, onMounted: callback => { mounted = callback }, onBeforeUnmount: callback => { unmount = callback } },
    'vue-router': { useRoute: () => ({ fullPath: '/profile', hash: '' }) },
    '../api/auth': { fetchProfile: async () => ({ data: {} }), updateProfile() {}, changePassword() {} },
    '../api/credit': { getCreditOverview: async () => ({ data: ++creditReads === 1 ? data : { ...data, score: 100, reset_at: null } }) },
    '../stores/auth': { useAuthStore: () => ({ isOrdinary: true, setUser() {} }) },
    '../stores/avatar': { useAvatarStore: () => ({ load() {} }) },
    '../components/admin/userForm.js': { contactPayload() {} },
    '../components/ui/feedback': { message: {} },
    '../composables/usePagination': { usePagination: items => ({ page: ref(1), pages: ref(1), pageItems: items }) }
  }, 'overview,creditLogs,restrictionsPanel', {
    setTimeout(callback, delay) { refreshCallback = callback; refreshDelay = delay; return 1 },
    clearTimeout() { refreshCallback = undefined }
  })
  profile.restrictionsPanel.value = { refresh() { eligibilityReads++ } }
  await mounted()
  assert.equal(profile.overview.value.score, 90)
  assert.deepEqual(Array.from(profile.creditLogs.value, row => row.recordKey), ['current:1', 'historical:1'])
  assert.equal(refreshDelay, 24 * 60 * 60 * 1000)
  refreshCallback()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(creditReads, 2)
  assert.equal(eligibilityReads, 1)
  assert.equal(profile.overview.value.score, 100)
  assert.equal(refreshCallback, undefined)
  unmount()
})

test('profile reacts only to a changed current score previously seen by the same account', async t => {
  const auth = { isOrdinary: true, user: { id: 1 }, setUser() {} }
  const scores = new Map()
  let response = { score: 90 }
  let failed = false
  async function openProfile(route = { fullPath: '/profile', hash: '' }) {
    return script('../src/views/ProfileView.vue', {
      vue: { ref, computed, watch, onMounted() {}, onBeforeUnmount() {} },
      'vue-router': { useRoute: () => route },
      '../api/auth': { fetchProfile() {}, updateProfile() {}, changePassword() {} },
      '../api/credit': {
        async getCreditOverview() {
          if (failed) throw new Error('读取失败')
          return { data: response }
        }
      },
      '../stores/auth': { useAuthStore: () => auth },
      '../stores/avatar': { useAvatarStore: () => ({ load() {} }) },
      '../components/admin/userForm.js': { contactPayload() {} },
      '../components/ui/feedback': { message: {} },
      '../composables/usePagination': { usePagination: items => ({ page: ref(1), pages: ref(1), pageItems: items }) }
    }, 'loadCredit, creditChange, creditError, profileTab, mountedProfileTabs, selectProfileTab', {
      sessionStorage: {
        getItem: key => scores.get(key) ?? null,
        setItem: (key, value) => scores.set(key, value)
      },
      setTimeout() { return 1 },
      clearTimeout() {}
    })
  }

  const firstVisit = await openProfile()
  await firstVisit.loadCredit()
  assert.equal(firstVisit.creditChange.value, 0)
  response = { score: 65, history_only: true }
  await firstVisit.loadCredit()
  assert.equal(firstVisit.creditChange.value, 0)
  response = { score: 80 }
  await firstVisit.loadCredit()
  assert.equal(firstVisit.creditChange.value, -10)
  await firstVisit.loadCredit()
  assert.equal(firstVisit.creditChange.value, 0)

  const returnVisit = await openProfile()
  failed = true
  await returnVisit.loadCredit()
  assert.equal(returnVisit.creditError.value, '读取失败')
  assert.equal(returnVisit.creditChange.value, 0)
  failed = false
  response = { score: 100 }
  await returnVisit.loadCredit()
  assert.equal(returnVisit.creditChange.value, 20)

  auth.user = { id: 2 }
  response = { score: 0 }
  const anotherAccount = await openProfile()
  await anotherAccount.loadCredit()
  assert.equal(anotherAccount.creditChange.value, 0)
  response = { score: 25 }
  await anotherAccount.loadCredit(false)
  assert.equal(anotherAccount.creditChange.value, 0)
  response = { score: 35 }
  await anotherAccount.loadCredit()
  assert.equal(anotherAccount.creditChange.value, 10)

  await t.test('a direct link opens the violations tab on arrival and when the linked record changes', async () => {
    const route = reactive({ fullPath: '/profile?violation_id=5#violations', hash: '#violations' })
    const profile = await openProfile(route)
    assert.equal(profile.profileTab.value, 'violations')
    assert.equal(profile.mountedProfileTabs.value.has('violations'), true)
    profile.selectProfileTab('credit')
    route.fullPath = '/profile?violation_id=6#violations'
    await nextTick()
    assert.equal(profile.profileTab.value, 'violations')
  })
})

test('an older mine response cannot restore pending actions after a newer deadline refresh',async()=>{
  const pending=[]
  const page=await mine({listMyReservations:()=>new Promise(resolve=>pending.push(resolve))})
  const older=page.refreshAll(),latest=page.refreshAll()
  pending[1]({data:[{id:10,status:'unused_ended',termination_reason:'no_show',allowed_actions:[]}]})
  await latest
  pending[0]({data:[waiting(['abandon'])]})
  await older
  assert.equal(page.list.value[0].status,'unused_ended')
  assert.equal(page.actionsOf(page.list.value[0]).length,0)
})

test('deferred violation panel stays uninitialized rather than claiming zero before its first response',async()=>{
  let release
  const page=await violations(()=>new Promise(resolve=>{release=resolve}))
  assert.equal(page.loaded.value,false)
  assert.equal(page.loading.value,false)
  const request=page.refresh()
  assert.equal(page.loading.value,true)
  assert.equal(page.loaded.value,false)
  release({data:[]})
  await request
  assert.equal(page.loaded.value,true)
  assert.equal(page.loading.value,false)
  assert.equal(page.items.value.length,0)
})

test('only current checkout action is available and confirmation prevents duplicate early checkout before real refresh',async()=>{
  let release
  const page=await mine({confirmDialog:text=>{assert.match(text,/座位会立即释放/);assert.match(text,/签退不扣分/);return new Promise(resolve=>{release=resolve})},listMyReservations:async()=>({data:[{id:10,status:'completed',termination_reason:'early_checkout',allowed_actions:[],usage_record:{id:1,checkin_at:'2026-10-30T08:00:00',ended_at:'2026-10-30T08:01:00.5',duration_seconds:60.5,origin:'seat_code'}}]})})
  assert.deepEqual(Array.from(page.actionsOf({allowed_actions:['leave','return','checkout']}),action=>action.key),['checkout'])
  const attempt=page.doAction({id:10,status:'checked_in',allowed_actions:['checkout']},'checkout')
  await page.doAction({id:10,status:'checked_in',allowed_actions:['checkout']},'checkout')
  release();await attempt
  assert.equal(page.calls.filter(item=>item==='checkout').length,1)
  assert.equal(page.list.value[0].usage_record.duration_seconds,60.5)
  assert.equal(page.actionsOf(page.list.value[0]).length,0)
})
test('auto-end conflict explains committed end and displays re-read usage; failed reload never claims fresh usage',async()=>{
  const page=await mine({checkoutReservation:async()=>{throw{status:409,details:{status:'completed'},message:'已到期'}},listMyReservations:async()=>({data:[{id:10,status:'completed',allowed_actions:[],usage_record:{duration_seconds:3600.125,end_reason:'auto_end'}}]})})
  await page.doAction({id:10,allowed_actions:['checkout']},'checkout')
  assert.match(page.actionError.value,/预约已结束/);assert.equal(page.list.value[0].usage_record.end_reason,'auto_end')
  const failed=await mine({listMyReservations:async()=>{throw new Error('使用记录刷新失败')}})
  await failed.doAction({id:10,allowed_actions:['checkout']},'checkout');assert.equal(failed.error.value,'使用记录刷新失败')
})
test('late usage list response cannot restore earlier running duration after final settlement',async()=>{
  const pending=[]
  const page=await mine({listMyReservations:()=>new Promise(resolve=>pending.push(resolve))})
  const old=page.refreshAll(),latest=page.refreshAll()
  pending[1]({data:[{id:10,status:'completed',allowed_actions:[],usage_record:{duration_seconds:3600.125,end_reason:'auto_end'}}]});await latest
  pending[0]({data:[{id:10,status:'checked_in',allowed_actions:['checkout'],usage_record:{duration_seconds:120.25,ended_at:null}}]});await old
  assert.equal(page.list.value[0].usage_record.duration_seconds,3600.125);assert.equal(page.list.value[0].status,'completed')
})
test('current UI removes temporary leave navigation and adapters while retaining explicit historical explanation',async()=>{
  const mineSource=await readFile(new URL('../src/views/MyReservationsView.vue',import.meta.url),'utf8')
  assert.doesNotMatch(mineSource,/key: 'temp_leave'|leave:\{key|return:\{key|leaveReservation|returnReservation|临离开/)
  assert.match(mineSource,/UsageRecordSummary :record="row.usage_record"/)
  assert.match(mineSource,/暂离时间/);assert.match(mineSource,/已结束/)
  const api=await readFile(new URL('../src/api/reservation.js',import.meta.url),'utf8');assert.doesNotMatch(api,/leaveReservation|returnReservation/)
  const home=await readFile(new URL('../src/views/HomeView.vue',import.meta.url),'utf8');assert.doesNotMatch(home,/临时离开/)
})

test('managed cancellation exposes immutable public reason and preserves usage even though reservation is cancelled',async()=>{
  const source=await readFile(new URL('../src/views/MyReservationsView.vue',import.meta.url),'utf8')
  assert.match(source,/admin_resource_change:'因自习室调整取消，不扣分'/);assert.match(source,/取消原因：\{\{ row.termination_note \}\}/)
  assert.match(source,/<UsageRecordSummary :record="row.usage_record"/);assert.doesNotMatch(source,/coordination\.note|room\.resource_reason/)
})

test('all historical reservation rows can open occupation help without invoking lifecycle actions',async()=>{
  const page=await mine()
  for(const status of ['pending','checked_in','completed','cancelled','unused_ended']) await page.requestOccupationHelp({id:42,status,allowed_actions:[]})
  assert.equal(page.calls.length,5)
  assert.equal(page.calls.every(item=>item.name==='complaints'&&item.query.reservation_id==='42'&&item.query.type==='occupation'),true)
})
