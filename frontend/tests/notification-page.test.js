import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import * as vue from 'vue'
import * as recordPage from '../src/composables/recordPage.js'
import * as notificationPage from '../src/composables/notificationPage.js'
import * as campusDateTime from '../src/composables/campusDateTime.js'
import {hasCompletedReviewUsage,reviewNotificationTarget,reviewReservationParam} from '../src/composables/reviewManagement.js'
const scope=()=>({isLoggedIn:true,isOrdinary:true,user:{id:1,role:'student'},token:'test-token'})
const item=(id=1,extra={})=>({id,type:'reservation_success',is_read:false,title:'工程模拟消息',content:'本人业务消息正文',created_at:'2026-10-30T20:00+08:00',reservation_id:id+10,...extra})
const defaultCounts={total:350,unread:7,by_type:{reservation_success:300,legacy_unknown:50}}
const response=(query,items=[item()],counts=defaultCounts,total=counts.total)=>({items,total,page:query.page,page_size:query.page_size,server_now:'2026-10-30T20:00+08:00',counts})
async function moduleFor(source,mocks,extra={}){const context=vm.createContext({defineExpose(){},...extra}),module=new vm.SourceTextModule(source,{context});await module.link(specifier=>{const values=mocks[specifier]||(specifier.endsWith('.vue')?{default:{}}:null);assert.ok(values,specifier);return new vm.SyntheticModule(Object.keys(values),function(){for(const[k,v]of Object.entries(values))this.setExport(k,v)},{context})});await module.evaluate();return module.namespace}
async function badge(api){const auth=scope(),watchers=[];const m=await moduleFor(await readFile(new URL('../src/stores/notification.js',import.meta.url),'utf8'),{pinia:{defineStore:(name,setup)=>setup},vue:{ref:vue.ref,watch:(getter,cb)=>watchers.push(cb)},'../api/notification':{unreadCount:api},'./auth':{useAuthStore:()=>auth}});return {...m.useNotificationStore(),auth,watchers}}
async function page(overrides={}){
 const auth=scope(),cleanup=[],mounted=[],calls=[]
 const store={
  unread:0,hasValue:false,error:'',
  refresh:async()=>{calls.push(['badgeGET']);return true},
  beginUpdate:()=>({}),
  acceptUnread:count=>{store.unread=count;store.hasValue=true;return true}
 }
 const fetchPage=overrides.listNotifications??(async query=>({data:response(query)}))
 const api={
  markRead:async id=>{calls.push(['read',id]);return{data:{id,marked:1,unread_count:6}}},
  markAllRead:async()=>{calls.push(['all']);return{data:{marked:7,unread_count:1}}},
  ...overrides,
  listNotifications:query=>{calls.push(['page',structuredClone(query)]);return fetchPage(query)}
 }
 const source=(await readFile(new URL('../src/views/NotificationsView.vue',import.meta.url),'utf8')).split('<script setup>')[1].split('</script>')[0]
 const m=await moduleFor(source+'\nexport {pager,list,snapshot,error,loading,buckets,markingId,markingAll,actionError,writeNotice,selectCategory,category,onMarkRead,onMarkAll,refreshMessages,visibleItems,unreadCount,typeMeta,turnPage,selected,currentCategoryLoaded}',{
  vue:{...vue,onMounted:fn=>mounted.push(fn),onBeforeUnmount:fn=>cleanup.push(fn)},
  '../api/notification':api,
  '../stores/notification':{useNotificationStore:()=>store},
  '../stores/auth':{useAuthStore:()=>auth},
  '../composables/recordPage.js':recordPage,
  '../composables/reviewManagement.js':{reviewNotificationTarget},
  '../composables/notificationPage.js':notificationPage,
  '../composables/campusDateTime.js':campusDateTime
 })
 return {...m,auth,store,calls,cleanup,mounted}
}
test('badge latest request wins and corrupt/network responses preserve the last confirmed count',async()=>{
 const pending=[],b=await badge(()=>new Promise((resolve,reject)=>pending.push({resolve,reject})));const first=b.refresh(),second=b.refresh();pending[1].resolve({data:{count:8}});await second;pending[0].resolve({data:{count:99}});await first;assert.equal(b.unread.value,8)
 const corrupt=b.refresh();pending[2].resolve({data:{count:'0'}});await corrupt;assert.equal(b.unread.value,8);assert.match(b.error.value,/不完整/);const failed=b.refresh();pending[3].reject(new Error('503'));await failed;assert.equal(b.unread.value,8);assert.equal(b.hasValue.value,true);assert.match(b.error.value,/503/)
 const recovery=b.refresh();pending[4].resolve({data:{count:3}});await recovery;assert.equal(b.unread.value,3);assert.equal(b.error.value,'')
})
test('badge authentication changes invalidate old response and mutation receipt authority is never overwritten by earlier poll',async()=>{
 const pending=[],b=await badge(()=>new Promise(resolve=>pending.push(resolve)));const poll=b.refresh(),ticket=b.beginUpdate();b.acceptUnread(2,ticket);pending[0]({data:{count:5}});await poll;assert.equal(b.unread.value,2);assert.equal(b.loading.value,false)
 const old=b.refresh();b.auth.user={id:2,role:'student'};b.auth.token='other-token';b.watchers[0]();assert.equal(b.hasValue.value,false);pending[1]({data:{count:100}});await old;assert.equal(b.unread.value,0);assert.equal(b.hasValue.value,false)
 const next=b.refresh();pending[2]({data:{count:4}});await next;assert.equal(b.unread.value,4)
})
test('message categories and page turns send the same server filter and retain account-wide counts',async()=>{
 const p=await page({listNotifications:async query=>({
  data:response(query,[item(query.page)],defaultCounts,query.types?300:350)
 })})
 await p.pager.refresh()
 assert.equal(p.snapshot.value.total,350)
 assert.equal(await p.selectCategory('reservation'),true)
 const query=p.calls.at(-1)[1]
 assert.equal(query.page,1)
 assert.ok(query.types.split(',').includes('reservation_success'))
 assert.ok(query.types.split(',').includes('management_cancelled'))
 assert.equal(p.snapshot.value.total,300)
 assert.equal(await p.turnPage(2),true)
 assert.deepEqual(p.calls.at(-1),['page',{...query,page:2}])
 assert.equal(p.visibleItems.value[0].id,2)
 assert.equal(p.buckets.value.all,350)
 assert.equal(p.buckets.value.legacy_unknown,50)
 assert.equal(p.unreadCount.value,7)
 assert.equal(p.store.unread,7)
})
test('feedback includes acceptance, repair priority and progress notices',async()=>{
 const feedbackTypes=['complaint_initial_arrangement','complaint_priority_assessed','complaint_service_progress']
 const notices=feedbackTypes.map((type,index)=>item(index+1,{type,complaint_id:20}))
 const counts={total:13,unread:7,by_type:{reservation_success:10,...Object.fromEntries(feedbackTypes.map(type=>[type,1]))}}
 const p=await page({listNotifications:async query=>({
  data:response(query,query.types?notices:Array.from({length:10},(_,index)=>item(index+4)),counts,query.types?3:13)
 })})
 await p.pager.refresh()
 assert.ok(p.visibleItems.value.every(notice=>notice.type==='reservation_success'))
 assert.equal(await p.selectCategory('feedback'),true)
 const types=p.calls.at(-1)[1].types.split(',')
 assert.deepEqual(p.visibleItems.value.map(notice=>notice.type),feedbackTypes)
 for(const type of feedbackTypes) {
  assert.ok(types.includes(type))
  assert.ok(p.typeMeta[type]?.text)
 }
})
test('retry loads the failed category on page one while keeping the old page out of view',async()=>{
 let attempts=0
 const feedback=item(2,{type:'complaint_feedback',complaint_id:20})
 const counts={total:350,unread:7,by_type:{reservation_success:299,legacy_unknown:50,complaint_feedback:1}}
 const p=await page({listNotifications:async query=>{
  if(query.types&&++attempts===1) throw new Error('connection lost')
  return {data:response(query,query.types?[feedback]:[item()],counts,query.types?1:350)}
 }})
 await p.pager.refresh()
 await p.turnPage(2)
 assert.equal(await p.selectCategory('feedback'),false)
 assert.match(p.error.value,/connection lost/)
 assert.equal(p.currentCategoryLoaded.value,false)
 assert.equal(p.visibleItems.value.length,0)
 const failedQuery=p.calls.at(-1)[1]
 await p.refreshMessages()
 assert.deepEqual(p.calls.at(-2),['page',failedQuery])
 assert.equal(failedQuery.page,1)
 assert.ok(failedQuery.types.split(',').includes('complaint_feedback'))
 assert.equal(p.error.value,'')
 assert.equal(p.currentCategoryLoaded.value,true)
 assert.equal(p.visibleItems.value[0].id,feedback.id)
})
test('marking the only unread message on the last page returns to the previous page and keeps its detail open',async()=>{
 const notices=Array.from({length:11},(_,index)=>item(index+1))
 const unread=notices.at(-1)
 let markedId=null
 const p=await page({
  markRead:async id=>{markedId=id;return{data:{id,marked:1,unread_count:10}}},
  listNotifications:async query=>{
   const remaining=notices.filter(notice=>notice.id!==markedId)
   const counts={total:11,unread:remaining.length,by_type:{reservation_success:11}}
   const offset=(query.page-1)*query.page_size
   return{data:response(query,remaining.slice(offset,offset+query.page_size),counts,remaining.length)}
  }
 })
 assert.equal(await p.selectCategory('unread'),true)
 assert.deepEqual(p.calls.at(-1),['page',{page:1,page_size:10,is_read:'false'}])
 assert.equal(await p.turnPage(2),true)
 assert.equal(p.visibleItems.value.length,1)
 assert.equal(p.selected.value.id,unread.id)
 await p.onMarkRead(p.visibleItems.value[0])
 assert.deepEqual(p.calls.filter(([kind])=>kind==='page').slice(-2),[
  ['page',{page:2,page_size:10,is_read:'false'}],
  ['page',{page:1,page_size:10,is_read:'false'}]
 ])
 assert.equal(p.snapshot.value.page,1)
 assert.equal(p.visibleItems.value.length,10)
 assert.equal(p.unreadCount.value,10)
 assert.equal(p.selected.value.id,unread.id)
 assert.equal(p.selected.value.is_read,true)
})
test('legacy feedback and corrected check-in text use campus time and user-facing labels',()=>{
 const feedback={type:'complaint_feedback',content:'请查看处理结果及依据，确认截止为2026-12-05T08:53:34.853536Z；截止前可确认或提出异议。'}
 assert.equal(notificationPage.notificationContent(feedback),'请查看处理结果，并在截止前确认或提出异议。\n确认截止：2026-12-05 16:53:34')
 const repair={type:'complaint_service_progress',content:'维修已交接，交接时间2026-12-05T16:53:34.853536+08:00。'}
 assert.equal(notificationPage.notificationContent(repair),'维修已交接，交接时间2026-12-05 16:53:34。')
 const checkin={type:'reservation_corrected_checkin',content:'预约#355已补签。公开依据：已核对现场。。业务签到：2026-11-28T16:15+08:00；实际操作：2026-11-28T16:19:30.192661+08:00。这是管理员核实自报记录。'}
 assert.equal(notificationPage.notificationContent(checkin),'你的预约已补签。\n签到时间：2026-11-28 16:15:00\n补签说明：已核对现场。')
})
test('checking read status after an interrupted write fetches the list without writing again', async () => {
 let writes = 0
 const p = await page({
  markRead: async () => { writes++; throw new Error('connection lost') },
  listNotifications: async query => ({ data: response(query, [item(1, {is_read: writes > 0})]) })
 })
 await p.pager.refresh()
 await p.onMarkRead(p.list.value[0])
 assert.match(p.actionError.value, /无法确认.*已读状态/)
 assert.equal(p.list.value[0].is_read, false)
 await p.refreshMessages()
 assert.equal(p.actionError.value, '')
 assert.equal(p.list.value[0].is_read, true)
 assert.equal(writes, 1)
})
test('restriction notice formats persisted ISO deadlines as campus time to seconds and preserves actual effects',async()=>{
 const notice={...item(),type:'restriction_started',content:'系统已按对应的违规规则暂停新预约。\n公开原因：\n15天内累计两条有效违规，暂停新预约15天\n原定截止：2026-12-14T10:45:32.869980+08:00\n当前已取消仍有效待签到预约0条，使用中预约可继续至原定结束。'}
 assert.deepEqual(notificationPage.restrictionNoticeOf(notice),{reason:'15天内累计两条有效违规，暂停新预约15天',deadline:'2026-12-14 10:45:32',cancelledPendingCount:0})
 assert.equal(notificationPage.restrictionNoticeOf({...notice,content:notice.content.replace('预约0条','预约2条')}).cancelledPendingCount,2)
 assert.equal(notificationPage.restrictionNoticeOf({...notice,type:'restriction_released'}),null)
 assert.equal(notificationPage.restrictionNoticeOf({...notice,content:'损坏的限制通知'}),null)
 assert.equal(notificationPage.notificationContent({...notice,content:'历史限制截止：2026-12-14T10:45:32.869980+08'}),'历史限制截止：2026-12-14 10:45:32')
 assert.equal(notificationPage.notificationContent({...notice,type:'system',content:'系统记录：2026-12-14T10:45:32.869980+08'}),'系统记录：2026-12-14T10:45:32.869980+08')
 const source=await readFile(new URL('../src/views/NotificationsView.vue',import.meta.url),'utf8')
 assert.match(source,/需要取消预约或提交申诉时/);assert.match(source,/较早的消息如果没有相关事项入口/);assert.match(source,/@click="refreshMessages\(\)">检查已读状态/)
 assert.match(source,/v-if="selectedRestrictionNotice"/);assert.match(source,/限制截止时间/);assert.doesNotMatch(source,/无可靠关联的历史消息不根据正文猜测目标|数量汇总覆盖本人的全部消息/)
})
test('typed business targets cannot be guessed from body or fabricated derived IDs',()=>{
 assert.equal(notificationPage.reservationTarget(item()).query.reservation_id,'11');assert.equal(notificationPage.reservationTarget({type:'reservation_success',content:'预约#99',business_type:'reservation',business_id:99}),null);assert.equal(notificationPage.appealTarget({type:'appeal_reviewed',content:'申诉#3'}),null);assert.equal(notificationPage.complaintTarget({type:'complaint_feedback',complaint_id:'8'}),null)
 assert.equal(notificationPage.complaintTarget({type:'complaint_priority_assessed',complaint_id:88}),'/complaints/88');assert.equal(notificationPage.complaintTarget({type:'complaint_initial_arrangement',complaint_id:89}),'/complaints/89');assert.equal(notificationPage.complaintTarget({type:'complaint_service_progress',complaint_id:90}),'/complaints/90');const both={type:'restriction_cancelled',reservation_id:70,restriction_id:90};assert.equal(notificationPage.reservationTarget(both).query.reservation_id,'70');assert.equal(notificationPage.restrictionTarget(both).query.restriction_id,90);assert.equal(notificationPage.hasNotificationTarget({type:'legacy_unknown',content:'预约#1'},reviewNotificationTarget),false)
 assert.equal(notificationPage.validNotificationCounts({total:3,unread:1,by_type:{system:2,legacy_unknown:1}}),true);assert.equal(notificationPage.validNotificationCounts({total:3,unread:1,by_type:{system:2}}),false)
 assert.deepEqual(notificationPage.adminWorkTarget({type:'admin_complaint_returned',complaint_id:81}),{path:'/admin',query:{complaint_id:'81'}})
 assert.deepEqual(notificationPage.adminWorkTarget({type:'admin_appeal_submitted',appeal_id:4}),{path:'/admin',query:{appeal_id:'4'}})
 assert.equal(notificationPage.adminWorkTarget({type:'admin_complaint_urgent',content:'工单81',business_id:81}),null)
})
test('reservation and review deep links read independent owner records',async()=>{
 const mounted=[],calls=[],route={query:{reservation_id:'99',review_reservation_id:'70'}},source=(await readFile(new URL('../src/views/MyReservationsView.vue',import.meta.url),'utf8')).split('<script setup>')[1].split('</script>')[0]
 const m=await moduleFor(source+'\nexport {reviewEditor,linkedReservation,linkedError,refreshAll}',{vue:{...vue,watch(){},onMounted:fn=>mounted.push(fn),onBeforeUnmount(){}},'vue-router':{useRoute:()=>route,useRouter:()=>({push(){}})},'../composables/reviewManagement.js':{hasCompletedReviewUsage,reviewReservationParam},'../composables/checkinDeadline.js':{checkinDeadlineOf:()=>null,deadlineLabel:()=>''},'../composables/recordPage.js':recordPage,'../components/ui/feedback':{message:{success(){}},confirmDialog:async()=>{}},'../api/reservation':{listMyReservations:async query=>({data:{items:[{id:1,status:'pending'}],total:45,page:query.page,page_size:10,server_now:'2026-10-30T20:00+08:00'}}),getReservation:async id=>{calls.push(['single',id]);return{data:{id,status:'completed',allowed_actions:[],usage_record:{id:2}}}},cancelReservation:async()=>{},abandonReservation:async()=>{},checkoutReservation:async()=>{}},'../composables/campusDateTime.js':campusDateTime});m.reviewEditor.value={open:async id=>calls.push(['review',id])};await mounted[0]();assert.equal(m.linkedReservation.value.id,99);assert.deepEqual(calls,[['single',99],['review',70]])
})
