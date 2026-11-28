<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { listAdminComplaints, getAdminComplaint, acceptComplaint, recordComplaintVerification, feedbackComplaint, recordComplaintServiceProgress } from '../../api/complaint'
import { registerEventViolation } from '../../api/violation'
import { listUsers } from '../../api/admin'
import { getRooms } from '../../api/room'
import { complaintStatuses, verificationOutcomes, reservationStatuses, complaintDisplayType, complaintNumber, positiveId, verificationPayload, feedbackPayload, serviceProgressPayload } from '../../composables/complaintForm.js'
import { confirmDialog } from '../ui/feedback'
import { useServiceTargetClock } from '../../composables/useServiceTargetClock.js'
import ServiceTargetSummary from '../ServiceTargetSummary.vue'
import ComplaintRecord from '../ComplaintRecord.vue'
import UsageRecordSummary from '../UsageRecordSummary.vue'
import SSelect from '../ui/SSelect.vue'
import SInput from '../ui/SInput.vue'
import SButton from '../ui/SButton.vue'
import SBanner from '../ui/SBanner.vue'
import SDialog from '../ui/SDialog.vue'
import {recordQuery,validRecordPage,recordFields} from '../../composables/recordPage.js'
import RecordFilters from '../RecordFilters.vue'
import RecordPageControls from '../RecordPageControls.vue'
import {formatCampusDateTime} from '../../composables/campusDateTime.js'
const scopeOptions=[{value:'',label:'全部类型'},{value:'occupation',label:'预约与座位问题'},{value:'facility_repair',label:'设施报修'},{value:'other_service',label:'其他服务问题'}]
const emit = defineEmits(['refreshed'])
const baseFields=recordFields('complaint',false)
const snapshot=ref(null),snapshotQuery=ref(null),fields=computed(()=>baseFields.map(field=>{
  if(field.key==='type')return {key:'scope',label:'诉求类型',options:scopeOptions}
  if(field.key==='room_id')return {...field,label:'自习室',options:roomOptions.value}
  return field
}))
const defaultFilters=()=>({status:null,scope:'',room_id:null,priority:null})
const filters=ref(defaultFilters()),appliedFilters=ref(null),items=ref([]),loaded=ref(false),listLoading=ref(false),listError=ref('')
const repairScope=computed(()=>filters.value.scope==='facility_repair')
const appliedSummary=computed(()=>{if(!appliedFilters.value)return '';const value=appliedFilters.value;const scope=scopeOptions.find(option=>option.value===value.scope)?.label||'全部类型';const room=roomOptions.value.find(option=>option.value===value.room_id)?.label;return `已应用：${scope} / ${complaintStatuses[value.status]||'全部状态'} / ${room||(value.room_id?'所选自习室':'全部自习室')}${value.priority?' / '+value.priority+'级':''}`})
function setLevel(level){if(listLoading.value)return;filters.value={...filters.value,priority:level};void loadList(false)}
watch(()=>filters.value.scope,(scope)=>{if(scope!=='facility_repair'&&filters.value.priority!==null)filters.value={...filters.value,priority:null}})
const selectedId=ref(null),detail=ref(null),detailLoading=ref(false),detailError=ref(''),users=ref([]),rooms=ref([]),optionsError=ref('')
const sourceEventId=ref(null)
const submitting=ref(false),unknown=ref(false),readPending=ref(false),actionError=ref(''),writeNotice=ref(''),pending=ref(null)
const busy=computed(()=>submitting.value||unknown.value||readPending.value)
const blank=()=>({outcome:'',occurred_at:'',public_note:'',private_note:'',subject_user_id:null,identity_confirmed:false,identity_basis:'',facts_confirmed:false,valid_reservation_confirmed:false})
const form=ref(blank()),feedbackForm=ref({result:'',basis:''}),triageForm=ref({initialArrangement:''}),repairProgressForm=ref({stage:'handoff',maintenance_channel:'',handed_off_at:'',public_note:''}),violationReasons=ref({})
const repairHandoff=computed(()=>detail.value?.admin_events?.find(event=>event.type==='service_progress'&&event.service_progress_stage==='handoff')||null)
const outcomeOptions=computed(()=>Object.entries(verificationOutcomes).filter(([value])=>detail.value?.type==='occupation'?value!=='service_verified':!['cooperated','verified_refusal'].includes(value)).map(([value,label])=>({value,label})))
const occupancy=computed(()=>['cooperated','verified_refusal'].includes(form.value.outcome))
const subjectOptions=computed(()=>[{value:null,label:'身份未知，不关联账号'},...users.value.filter(user=>!occupancy.value||user.id!==detail.value?.reporter?.id).map(user=>({value:user.id,label:`#${user.id} ${user.real_name} · ${user.username} · ${user.campus_id || '校园编号未登记'}${user.status==='active'?'':'（账号已禁用，仍可核实身份）'}`}))])
const roomOptions=computed(()=>[{value:'',label:'全部自习室'},...rooms.value.map(room=>({value:room.id,label:room.name}))])
let alive=true,listSequence=0,detailSequence=0,scope=0
const copy=value=>JSON.parse(JSON.stringify(value))
function explicitInstant(value){
  const match=typeof value==='string'&&value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?([+-]\d{2}:\d{2})$/)
  if(!match)return null
  const whole=Date.parse(`${match[1]}:${match[2]||'00'}${match[4]}`)
  return Number.isFinite(whole)?BigInt(whole)*1000000n+BigInt((match[3]||'').padEnd(9,'0')):null
}
const targetClock=useServiceTargetClock({records:computed(()=>[...items.value,...(detail.value?[detail.value]:[])]),blocked:computed(()=>busy.value||listLoading.value||detailLoading.value),onDue:()=>Promise.all([loadList(true),selectedId.value?readDetail(selectedId.value):Promise.resolve()])})
async function loadOptions(){optionsError.value='';try{const [accounts,resources]=await Promise.all([listUsers(),getRooms()]);if(alive){users.value=accounts.data;rooms.value=resources.data}}catch(failure){if(alive)optionsError.value=failure.message}}
async function loadList(force=true,next){if(busy.value&&force!==true)return false;const ticket=++listSequence,source=force===false?filters.value:appliedFilters.value||filters.value;const backend={...source},scope=backend.scope;delete backend.scope;if(scope==='occupation')backend.type='occupation';else if(scope==='facility_repair'){backend.type='service';backend.service_kind='facility_repair'}else if(scope==='other_service'){backend.type='service';backend.service_kind='other_service'}if(scope!=='facility_repair')delete backend.priority;let query;try{query=recordQuery(backend,force===false?1:next||snapshot.value?.page||1)}catch(e){listError.value=e.message;return false}listLoading.value=true;listError.value='';try{const {data}=await listAdminComplaints(query);if(!alive||ticket!==listSequence)return false;if(!validRecordPage(data,query))throw new Error('管理投诉分页返回不完整');items.value=data.items;appliedFilters.value={...source};snapshot.value=data;snapshotQuery.value={...query};loaded.value=true;emit('refreshed');return true}catch(failure){if(alive&&ticket===listSequence)listError.value=failure.message;return false}finally{if(alive&&ticket===listSequence)listLoading.value=false}}
async function readDetail(id,{afterWrite=false}={}){const ticket=++detailSequence;detailLoading.value=true;detailError.value=''
  try{const response=await getAdminComplaint(id);if(!alive||ticket!==detailSequence)return false;const value=response.data;if(value?.id!==id||!Array.isArray(value.admin_events)||!Number.isInteger(value.version))throw new Error('管理详情返回不完整');detail.value=value
    if(afterWrite){readPending.value=false;if(pending.value?.action==='verification')form.value=blank();if(pending.value?.action==='feedback')feedbackForm.value={result:'',basis:''};if(pending.value?.action==='accept')triageForm.value={initialArrangement:''};if(['accept','service_progress'].includes(pending.value?.action)&&value?.service_kind==='facility_repair')repairProgressForm.value=serviceProgressDraft(value);if(pending.value?.action==='violation')delete violationReasons.value[pending.value.event_id];pending.value=null}return true
  }catch(failure){if(alive&&ticket===detailSequence)detailError.value=(afterWrite?'操作已保存，详情读取失败，请重试读取，不要重复写入：':'')+failure.message;return false}
  finally{if(alive&&ticket===detailSequence)detailLoading.value=false}
}
function serviceProgressDraft(value){const handoff=value?.admin_events?.find(event=>event.type==='service_progress'&&event.service_progress_stage==='handoff');return handoff?{stage:'progress',maintenance_channel:handoff.maintenance_channel,handed_off_at:String(handoff.handoff_at||'').replace(/(?:Z|[+-]\d{2}:\d{2})$/,''),public_note:''}:{stage:'handoff',maintenance_channel:'',handed_off_at:'',public_note:''}}
async function openDetail(id, eventId=null){
  if(busy.value)return
  scope++;selectedId.value=id;sourceEventId.value=eventId;detail.value=null;form.value=blank();feedbackForm.value={result:'',basis:''};triageForm.value={initialArrangement:''};repairProgressForm.value=serviceProgressDraft(null);violationReasons.value={};actionError.value='';writeNotice.value='';pending.value=null
  const result=await readDetail(id)
  if(result&&detail.value?.service_kind==='facility_repair')repairProgressForm.value=serviceProgressDraft(detail.value)
  if(result&&eventId){
    await nextTick()
    if(alive&&selectedId.value===id&&sourceEventId.value===eventId){
      document.getElementById(`complaint-source-event-${eventId}`)?.scrollIntoView({block:'nearest'})
    }
  }
  return result
}
function changeOutcome(value){if(busy.value)return;form.value.outcome=value
  if(value==='identity_pending'){form.value.subject_user_id=null;form.value.identity_confirmed=false}
  if(['cooperated','verified_refusal'].includes(value)&&form.value.subject_user_id===detail.value?.reporter?.id){form.value.subject_user_id=null;form.value.identity_confirmed=false}
}
function changeSubject(value){if(busy.value)return;form.value.subject_user_id=value;form.value.identity_confirmed=false;form.value.identity_basis=''}
async function sendPending(){actionError.value='';const operation=copy(pending.value),ticket=scope
  try{const response=await (operation.action==='violation'?registerEventViolation(operation.event_id,operation.body):({accept:acceptComplaint,verification:recordComplaintVerification,feedback:feedbackComplaint,service_progress:recordComplaintServiceProgress})[operation.action](operation.id,operation.body))
    if(!alive||ticket!==scope)return
    const value=response.data
    if(operation.action==='violation'){
      const violation=value?.violation
      if(value?.operation_id!==operation.body.operation_id||!Number.isSafeInteger(violation?.id)||violation.id<=0||violation.source_event_id!==operation.event_id||violation.user_id!==operation.fact.user_id||violation.reservation_id!==operation.fact.reservation_id||violation.type!=='occupation_refusal'||violation.source!=='manual'||violation.reason!==operation.body.reason||explicitInstant(violation.occurred_at)===null||explicitInstant(violation.occurred_at)!==explicitInstant(operation.fact.occurred_at)||!Number.isSafeInteger(violation.notification_id)||violation.notification_id<=0||explicitInstant(violation.notified_at)===null)throw new Error('违规登记回执不完整，请以原操作ID核对')
      unknown.value=false;readPending.value=true
      writeNotice.value=`违规#${violation.id}已登记${value.replayed?'（原操作幂等回执）':''}，请核对刷新后的登记状态；服务端将按累计规则和当前有效限制统一评估，以实际限制记录与资格为准。`
    }else{
      if(value?.operation_id!==operation.body.operation_id||!Number.isInteger(value.event_id)||value.event_id<=0||value.complaint?.id!==operation.id||!Number.isInteger(value.complaint.version)||!Array.isArray(value.complaint.admin_events))throw new Error('写入回执不完整，请以原操作ID核对')
      unknown.value=false;readPending.value=true;detail.value=value.complaint
      const actionNote=operation.action==='service_progress'?'维修进度为管理员自报，不代表外部维修或现场结果已经核验。':operation.action==='verification'?'核实内容为管理员自报；配合纠正提醒不计违规。':'受理不代表维修完成。'
      writeNotice.value=`${operation.action==='service_progress'?'维修交接/公开进度':'操作'}已保存${value.replayed?'（原操作幂等回执）':''}，事件#${value.event_id}；当前${complaintStatuses[value.complaint.status] || value.complaint.status}。${actionNote}`
    }
    await Promise.all([readDetail(operation.id,{afterWrite:true}),loadList(true)])
    if(alive&&ticket===scope&&listError.value)emit('refreshed')
  }catch(failure){if(!alive||ticket!==scope)return;unknown.value=failure.status==null||failure.status===408||failure.status>=500
    actionError.value=unknown.value?(operation.action==='violation'?'写入结果尚未确认，原事件、公开依据和操作ID已锁定；请主动以同一操作ID重试核对，不要另建操作。':'写入结果尚未确认，原动作、版本、内容和操作ID已锁定；请主动以同一操作ID重试核对，不要另建操作。'):failure.message
    if(!unknown.value&&failure.status===409){
      if(operation.action==='violation'){
        const existing=failure.details?.existing_violation_id
        actionError.value=actionError.value.replace(/[。.!！?？]+$/u,'')+(Number.isSafeInteger(existing)&&existing>0?`；已有违规#${existing}`:'')+'。已请求刷新真实登记状态，公开依据草稿保留；请勿重复登记同一事实。'
      }else actionError.value+='。请查看刷新后的真实进度和版本，本次未重复执行；核实草稿保留。'
      await Promise.all([readDetail(operation.id),loadList(true)])
    }
  }
}
async function act(action){if(busy.value||detailLoading.value||detailError.value||!detail.value)return
  if((action==='accept'&&detail.value.status!=='submitted')||(action==='verification'&&detail.value.status!=='processing')||(action==='service_progress'&&(detail.value.status!=='processing'||detail.value.service_kind!=='facility_repair'))||(action==='feedback'&&(detail.value.status!=='processing'||!detail.value.admin_allowed_actions?.includes('feedback'))))return
  let payload={}
  try{if(action==='verification')payload=verificationPayload(form.value,detail.value);if(action==='feedback')payload=feedbackPayload(feedbackForm.value);if(action==='accept'&&['facility_repair','other_service'].includes(detail.value.service_kind)){const initial_arrangement=triageForm.value.initialArrangement.trim();if(!initial_arrangement||initial_arrangement.length>1000)throw new Error('服务问题受理时须填写1至1000字的公开初步安排');payload={initial_arrangement}}if(action==='service_progress')payload=serviceProgressPayload(repairProgressForm.value)}catch(failure){actionError.value=failure.message;return}
  pending.value={id:detail.value.id,action,body:{...payload,version:detail.value.version,operation_id:crypto.randomUUID()}}
  const ticket=scope;submitting.value=true;actionError.value=''
  try{try{await confirmDialog(action==='accept'?'确认受理并开始核查？首受理人与公开初步安排将留痕；受理不代表维修完成。':action==='feedback'?'确认发出本次正式反馈？结果与依据将公开给投诉人，并从本次反馈起给予7×24小时确认期；请勿复制私有身份或核实资料。':action==='service_progress'?'确认追加维修交接/公开进度？这记录管理员自报，不代表系统核验了外部维修或现场结果。':'确认追加这条核实记录？已有事件不会被覆盖；本次不登记违规或处罚。','确认管理操作',{type:'warning'})}catch{return}
    if(alive&&ticket===scope)await sendPending()
  }finally{if(alive&&ticket===scope)submitting.value=false}
}
async function actViolation(event){
  if(busy.value||detailLoading.value||detailError.value||!detail.value||event.outcome!=='verified_refusal'||event.violation_registration?.eligible!==true||event.violation_registration.existing_violation)return
  const reason=String(violationReasons.value[event.id]||'').trim()
  if(!reason||reason.length>1000){actionError.value='请独立填写1至1000字面向被登记者的公开事实依据，不要复制私有核实资料';return}
  pending.value={id:detail.value.id,action:'violation',event_id:event.id,body:{operation_id:crypto.randomUUID(),reason},fact:{user_id:event.subject?.id,reservation_id:detail.value.reservation_id,occurred_at:event.occurred_at}}
  const operation=copy(pending.value),ticket=scope;submitting.value=true;actionError.value='';writeNotice.value=''
  try{try{await confirmDialog(`被登记者：#${event.subject?.id} ${event.subject?.real_name} / ${event.subject?.username}。原预约：#${detail.value.reservation_id}，${detail.value.context_snapshot?.room_name||''} / ${detail.value.context_snapshot?.seat_no||''}。事实发生：${event.occurred_at}。公开事实依据：\n${operation.body.reason}\n\n确认从该不可改核实事件登记拒不配合占座违规？事实由管理员据实核实记录，登记后由服务端按累计规则和当前有效限制统一评估，以实际限制记录与资格为准。`,'确认独立登记违规',{type:'warning'})}catch{return}
    if(alive&&ticket===scope)await sendPending()
  }finally{if(alive&&ticket===scope)submitting.value=false}
}
async function retryUnknown(){if(!unknown.value||submitting.value||!pending.value)return;submitting.value=true;try{await sendPending()}finally{if(alive)submitting.value=false}}
function refreshDetail(){if(submitting.value||unknown.value||!selectedId.value)return;return readDetail(selectedId.value,{afterWrite:readPending.value})}
function closeDetail(){if(busy.value)return;detailSequence++;selectedId.value=null;sourceEventId.value=null;detail.value=null;detailError.value='';detailLoading.value=false;actionError.value='';writeNotice.value='';pending.value=null}
onMounted(()=>{void loadOptions();void loadList()})
onBeforeUnmount(()=>{alive=false;scope++;listSequence++;detailSequence++})
defineExpose({loadList,openDetail})
</script>
<template>
  <section class="complaint-management">
    <section class="card"><div class="card-title-row"><h3>投诉与报修</h3><SButton size="sm" :loading="listLoading" :disabled="busy" @click="loadList(true)">刷新工单</SButton></div>
      <div v-if="repairScope" class="level-tabs" role="tablist" aria-label="报修级别">
        <button v-for="level in [null,1,2,3,4,5]" :key="String(level)" type="button" :class="{active:filters.priority===level}" :aria-selected="filters.priority===level" @click="setLevel(level)">{{ level ? level+'级' : '全部' }}</button>
      </div>
      <RecordFilters v-model="filters" :fields="fields" :disabled="busy||listLoading" @apply="loadList(false)"/>
      <SBanner v-if="optionsError" type="warning" title="自习室和校园账号选项加载失败"><SButton size="sm" @click="loadOptions">重试加载选项</SButton></SBanner>
      <p v-if="appliedFilters" class="muted">{{ appliedSummary }}</p>
      <p v-if="listLoading" role="status">正在读取管理列表…</p><SBanner v-if="listError" type="error" :title="listError" /><p v-if="!loaded&&!listLoading&&!listError">尚未读取管理列表。</p><p v-if="loaded&&!listLoading&&!listError&&!items.length">当前条件暂无记录</p>
      <p v-if="loaded&&listError">下列保留上次成功读取的列表快照，不代表本次筛选或当前状态，请重试核对。</p><div v-if="loaded&&!listLoading" class="table-wrap"><div class="table-scroll" tabindex="0" aria-label="管理投诉列表，可横向滚动"><table class="table management-table"><thead><tr><th>工单编号</th><th>类型</th><th>状态</th><th>提交时间</th><th>申请人</th><th>服务目标</th><th>详情</th></tr></thead><tbody><tr v-for="item in items" :key="item.id"><td>{{ complaintNumber(item.id) }}</td><td>{{ complaintDisplayType(item) }}<template v-if="item.service_kind==='facility_repair' && item.initial_priority"> · {{ item.initial_priority }}级</template></td><td>{{ complaintStatuses[item.status] || item.status }}</td><td>{{ formatCampusDateTime(item.submitted_at) }}</td><td>{{ item.reporter?.real_name || item.reporter?.username || '未提供' }}<div class="cell-dim">{{ item.reporter?.campus_id || item.reporter?.username || '' }}</div></td><td><ServiceTargetSummary :record="item" :progress="targetClock.progress(item)" compact /></td><td><SButton size="sm" :disabled="busy" @click="openDetail(item.id)">打开详情</SButton></td></tr></tbody></table></div></div>
      <RecordPageControls :snapshot="snapshot" :query="snapshotQuery" :fields="fields" :disabled="busy||listLoading" @page="loadList(true,$event)"/>
    </section>
    <SDialog :model-value="!!selectedId" :title="selectedId?`管理详情 · ${complaintNumber(selectedId)}`:'管理详情'" width="1000px" :show-close="!busy" :close-on-click-modal="!busy" :close-on-escape="!busy" @update:model-value="value=>{if(!value)closeDetail()}">
      <div class="detail-stack"><p v-if="detailLoading" role="status">正在读取管理详情及当前关联…</p><SBanner v-if="detailError" type="error" :title="detailError" /><SBanner v-if="writeNotice" type="info" :title="writeNotice" /><SBanner v-if="actionError" type="error" :title="actionError" />
      <div v-if="unknown" class="unknown"><p>原操作ID：{{ pending?.body.operation_id }}</p><SButton :loading="submitting" @click="retryUnknown">以原操作ID重试核对</SButton></div>
      <template v-if="detail"><section class="detail-section"><h4>概要</h4><p>记录版本 {{ detail.version }}。投诉人：{{ detail.reporter?.real_name }} · {{ detail.reporter?.campus_id || detail.reporter?.username || '校园编号未登记' }}。</p><ComplaintRecord :record="detail" :target-progress="targetClock.progress(detail)" compact management />
        <section v-if="detail.current_context?.reservation" class="current-context"><h5>当前关联预约</h5><p>读取时刻：{{ formatCampusDateTime(detail.current_context?.observed_at) }}。当前提示不代表事发时状态。</p><p>{{ detail.current_context.reservation.room_name }} / {{ detail.current_context.reservation.seat_no }} / {{ detail.current_context.reservation.date }} {{ detail.current_context.reservation.start_time }}—{{ detail.current_context.reservation.end_time }} · 当前{{ reservationStatuses[detail.current_context.reservation.status] || detail.current_context.reservation.status }}</p><p>签到截止：{{ formatCampusDateTime(detail.current_context.reservation.checkin_deadline) }}；是否已过：{{ detail.current_context.reservation.deadline_passed===true?'是':detail.current_context.reservation.deadline_passed===false?'否':'未提供' }}；原结束是否已过：{{ detail.current_context.reservation.scheduled_end_passed===true?'是':detail.current_context.reservation.scheduled_end_passed===false?'否':'未提供' }}</p><p>当前剩余资源合法：{{ detail.current_context.reservation.remaining_resource_legal===true?'是':detail.current_context.reservation.remaining_resource_legal===false?'否':'未提供' }}；{{ detail.current_context.reservation.closed_reasons?.join('；') }}</p><p>当前位置：{{ detail.current_context.reservation.building || '楼栋未登记' }} · {{ detail.current_context.reservation.floor || '楼层未登记' }} · {{ detail.current_context.reservation.location || '位置未登记' }}；剩余核对起点：{{ detail.current_context.reservation.remaining_start || '未提供' }}。当前开放：{{ detail.current_context.reservation.opening_windows?.length ? detail.current_context.reservation.opening_windows.map(window=>window.start+'—'+window.end).join('、') : '无开放窗口' }}。</p><UsageRecordSummary :record="detail.current_context.reservation.usage_record" /></section></section><section class="detail-section"><h4>当前处理</h4><p v-if="!['submitted','processing'].includes(detail.status)" class="muted">当前记录没有可执行的处理动作。</p><section v-if="detail.status==='submitted' && ['facility_repair','other_service'].includes(detail.service_kind)" class="triage-form"><h4>服务问题受理记录</h4><p>初步安排会公开展示给投诉人，不代表维修完成。</p><label>公开初步安排<SInput v-model="triageForm.initialArrangement" type="textarea" maxlength="1000" :disabled="busy" placeholder="例如：先核对现场，再联系现有维修渠道" /></label></section>
        <SButton v-if="detail.status==='submitted'" variant="primary" :disabled="busy||detailLoading||!!detailError" :loading="submitting" @click="act('accept')">受理并开始核查</SButton>
        <form v-if="detail.status==='processing' && detail.service_kind==='facility_repair'" class="verification-form" @submit.prevent="act('service_progress')"><h4>{{ repairHandoff ? '追加维修进度' : '记录维修渠道交接' }}</h4><p>只记录现有维修渠道、交接时间和公开进度；不自动派单、不新增维修账号、不承诺修复期限。首次交接后渠道和交接时刻固定，后续只追加该渠道的公开进度。</p><label>进度类型<SSelect v-model="repairProgressForm.stage" :options="[{value:'handoff',label:'首次交接维修渠道'},{value:'progress',label:'追加公开进度'}]" :disabled="busy||!!repairHandoff" /></label><label>现有维修渠道<SInput v-model="repairProgressForm.maintenance_channel" maxlength="150" :disabled="busy||!!repairHandoff" placeholder="例如：后勤报修平台、物业维修电话" /></label><label>交接时间（Asia/Shanghai）<SInput v-model="repairProgressForm.handed_off_at" type="datetime-local" step="0.000001" :disabled="busy||!!repairHandoff" /></label><label>公开维修进度<SInput v-model="repairProgressForm.public_note" type="textarea" maxlength="1000" :disabled="busy" placeholder="只填写可公开的进度，不填私有核实信息" /></label><SButton type="submit" variant="primary" :disabled="busy||detailLoading||!!detailError" :loading="submitting">保存维修进度</SButton></form>
        <form v-if="detail.status==='processing' && detail.admin_allowed_actions?.includes('feedback')" class="verification-form formal-feedback" @submit.prevent="act('feedback')"><h4>发出正式反馈</h4><p>以下结果与依据将对投诉人公开，与管理私有核实记录分开。发出后等待本人确认或异议，确认期为本次反馈起7×24小时；待确认期间不能直接覆盖。</p><label>公开反馈结果<SInput v-model="feedbackForm.result" type="textarea" maxlength="2000" :disabled="busy" required /></label><label>公开反馈依据（勿复制私有身份或核实资料）<SInput v-model="feedbackForm.basis" type="textarea" maxlength="2000" :disabled="busy" required /></label><SButton type="submit" variant="primary" :disabled="busy||detailLoading||!!detailError" :loading="submitting">发出正式反馈并等待确认</SButton></form>
        <form v-if="detail.status==='processing'" class="verification-form" @submit.prevent="act('verification')"><h4>追加核实事件（不是反馈结案）</h4><p>管理员据实自报，不代表系统核验现场。</p><label>核实结果<SSelect :model-value="form.outcome" :options="outcomeOptions" :disabled="busy" @update:model-value="changeOutcome" /></label><label>事实发生时刻（Asia/Shanghai）<SInput v-model="form.occurred_at" type="datetime-local" step="0.000001" :disabled="busy" required /></label><label>公开进度<SInput v-model="form.public_note" type="textarea" maxlength="1000" :disabled="busy" required /></label><label>私有核实说明<SInput v-model="form.private_note" type="textarea" maxlength="2000" :disabled="busy" required placeholder="填写核实依据" /></label><label><span><input v-model="form.facts_confirmed" type="checkbox" :disabled="busy" /> 已核实所述事实（自报）</span></label><label v-if="occupancy"><span><input v-model="form.valid_reservation_confirmed" type="checkbox" :disabled="busy" /> 事发时存在有效预约使用权</span></label>
          <SBanner v-if="optionsError" type="error" :title="optionsError"><SButton size="sm" :disabled="busy" @click="loadOptions">重试账号和空间选项</SButton></SBanner><label v-if="form.outcome!=='identity_pending'">{{ form.outcome==='verified_refusal'?'已核实主体账号（本结果必填，不得是投诉人）':'已核实主体账号（可未知，不默认投诉人）' }}<SSelect :model-value="form.subject_user_id" :options="subjectOptions" :disabled="busy" @update:model-value="changeSubject" /></label><template v-if="form.subject_user_id"><label><span><input v-model="form.identity_confirmed" type="checkbox" :disabled="busy" /> 管理员自报已核实该账号对应的身份</span></label><label>身份核实依据（仅管理可见）<SInput v-model="form.identity_basis" type="textarea" maxlength="1000" :disabled="busy" required /></label></template><p>配合纠正仅生成提醒，不计违规；其他分支也不会在本次操作自动记违规或处罚。私有依据不发送给投诉人。</p><SButton type="submit" variant="primary" :disabled="busy||detailLoading||!!detailError" :loading="submitting">追加核实记录</SButton></form>
</section><details class="event-log" :open="sourceEventId ? true : undefined"><summary>事件记录（{{ detail.admin_events.length }}）</summary><section class="event-log-body"><p v-if="!detail.admin_events.length">尚无管理事件。</p><article v-for="event in detail.admin_events" :id="`complaint-source-event-${event.id}`" :key="event.id" class="private-event" :class="{ 'source-event': sourceEventId === event.id }"><p>{{ ({submitted:'本人提交',accepted:'受理与初步安排',verification:'核实',feedback:'正式反馈',service_progress:event.service_progress_stage==='handoff'?'维修渠道交接':'维修进度',withdrawn:'本人撤回',confirmed:'本人确认反馈',objected:'本人提出异议',auto_closed:'系统自动结案'})[event.type] || event.type }} · {{ event.source==='system'?'系统':event.actor_display_name || '记录人未提供' }} · 登记{{ formatCampusDateTime(event.created_at) }} · 发生{{ event.occurred_at ? formatCampusDateTime(event.occurred_at) : '未提供' }}</p><p v-if="event.initial_arrangement">初步安排（公开）：{{ event.initial_arrangement }}</p><p v-if="event.service_progress_stage">维修渠道：{{ event.maintenance_channel }}；交接时间：{{ formatCampusDateTime(event.handoff_at) }}；公开进度：{{ event.public_note }}</p><p v-if="event.outcome">结果：{{ verificationOutcomes[event.outcome] || event.outcome }}</p><p>核实对象：{{ event.subject ? '#'+event.subject.id+' '+event.subject.real_name+' / '+event.subject.username : '未知或未关联账号' }}</p><p v-if="event.private_note">私有事实：{{ event.private_note }}</p><p v-if="event.identity_basis">身份依据（管理员自报）：{{ event.identity_basis }}</p><p>身份自报确认：{{ event.identity_confirmed===true?'是':event.identity_confirmed===false?'否':'未记录' }}；事实自报确认：{{ event.facts_confirmed===true?'是':event.facts_confirmed===false?'否':'未记录' }}；发生时有效预约权利自报确认：{{ event.valid_reservation_confirmed===true?'是':event.valid_reservation_confirmed===false?'否':'未记录' }}。</p><section v-if="event.outcome==='verified_refusal'" class="violation-registration"><h5>独立违规登记</h5><template v-if="event.violation_registration?.existing_violation"><p>已有违规#{{ event.violation_registration.existing_violation.id }} · {{ event.violation_registration.existing_violation.status==='revoked'?'已撤销（仍保留同一事实登记历史，不可重登）':'已登记' }} · 登记{{ formatCampusDateTime(event.violation_registration.existing_violation.registered_at) }} · {{ event.violation_registration.existing_violation.registrant_display_name || '登记人未提供' }}。</p><p v-if="violationReasons[event.id]?.trim()" class="preserved-public-draft">本次未提交的公开依据草稿：<span>{{ violationReasons[event.id] }}</span></p></template><template v-else-if="event.violation_registration?.eligible"><p>被登记者：#{{ event.subject?.id }} {{ event.subject?.real_name }} / {{ event.subject?.username }}；原预约#{{ detail.reservation_id }}；事实发生{{ formatCampusDateTime(event.occurred_at) }}。主体和事实固定取自此核实事件。</p><label>面向被登记者的公开事实依据<SInput v-model="violationReasons[event.id]" type="textarea" maxlength="1000" :disabled="busy" placeholder="独立填写1至1000字；勿复制管理私有记录、身份依据或投诉人资料" /></label><SButton variant="danger" size="sm" :disabled="busy||detailLoading||!!detailError" :loading="submitting&&pending?.event_id===event.id" @click="actViolation(event)">从此核实事件登记违规</SButton></template><p v-else>{{ event.violation_registration?.ineligible_reason || '尚未读取本事件的登记资格，请刷新详情核对' }}</p></section></article></section>
        </details>      </template>
      </div>
      <template #footer>
        <SButton :loading="detailLoading" :disabled="submitting||unknown" @click="refreshDetail">{{ readPending?'重试读取已保存结果':'刷新详情' }}</SButton>
        <SButton :disabled="busy" @click="closeDetail">关闭</SButton>
      </template>
    </SDialog>
  </section>
</template>
<style scoped>.complaint-management,.management-detail,.verification-form,.triage-form{display:grid;gap:18px;min-width:0}.complaint-management>.card{display:grid;gap:16px}.complaint-management>.card>h3{margin:0}.complaint-management>.card>.card-title-row{margin:0}.detail-stack{display:grid;gap:20px;min-width:0}.detail-stack>p{margin:0}.filter-fields{display:flex;flex-wrap:wrap;gap:16px;align-items:end}.filter-fields label{min-width:130px;flex:1}.verification-form label,.triage-form label,.filter-fields label{display:grid;gap:8px;font-size:var(--fs-caption)}.management-table{min-width:1040px}.management-table th,.management-table td{padding-left:12px;padding-right:12px}.management-table th:nth-child(1){width:11%}.management-table th:nth-child(2){width:12%}.management-table th:nth-child(3){width:8%}.management-table th:nth-child(4){width:14%}.management-table th:nth-child(5){width:13%}.management-table th:nth-child(6){width:29%}.management-table th:nth-child(7){width:13%}.current-context,.private-event,.triage-form{padding:14px;background:var(--surface-2);border-radius:var(--r-md);overflow-wrap:anywhere}.private-event{margin:14px 0}.source-event{border:2px solid var(--primary)}.violation-registration{display:grid;gap:12px;margin-top:14px;padding-top:14px;border-top:1px solid var(--border)}.violation-registration label{display:grid;gap:8px}.preserved-public-draft{white-space:pre-wrap;user-select:text}.unknown{overflow-wrap:anywhere}.current-context{display:grid;gap:10px}.detail-section{display:grid;gap:16px;min-width:0}.detail-section>h4{margin:0;font-size:15px}.event-log{background:var(--surface-2);border:1px solid var(--border);border-radius:var(--r-md);padding:14px}.event-log>summary{cursor:pointer;font-weight:600;color:var(--text-1);list-style:none}.event-log>summary::-webkit-details-marker{display:none}.event-log>summary::before{content:"▸ ";color:var(--primary)}.event-log[open]>summary::before{content:"▾ "}.event-log-body{display:grid;gap:14px;padding-top:14px}.current-context h5{margin:0;font-size:13px;color:var(--text-2)}.level-tabs{display:flex;gap:10px;flex-wrap:wrap}.level-tabs button{all:unset;padding:7px 16px;border:1px solid var(--border);border-radius:999px;font-size:var(--fs-body-sm);color:var(--text-2);cursor:pointer}.level-tabs button:hover{border-color:var(--border-strong)}.level-tabs button.active{border-color:var(--primary);background:var(--primary-faint);color:var(--primary-active);font-weight:600}</style>
