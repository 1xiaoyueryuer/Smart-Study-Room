<script setup>
import { formatCampusDateTime } from '../../composables/campusDateTime.js'
import {computed,h,onBeforeUnmount,onMounted,ref} from 'vue'
import {listUsers} from '../../api/admin'
import {listAdminRestrictions,getAdminRestriction,createRestriction,releaseRestriction} from '../../api/restriction'
import {restrictionStatuses,restrictionPayload,validEligibility,offsetInstant} from '../../composables/restrictionForm.js'
import {confirmDialog} from '../ui/feedback'
import RestrictionRecord from '../RestrictionRecord.vue'
import SButton from '../ui/SButton.vue'
import SDialog from '../ui/SDialog.vue'
import SInput from '../ui/SInput.vue'
import SSelect from '../ui/SSelect.vue'
import SBanner from '../ui/SBanner.vue'
import SEmpty from '../ui/SEmpty.vue'
import {recordQuery,validRecordPage,recordFields} from '../../composables/recordPage.js'
import RecordFilters from '../RecordFilters.vue'
import RecordPageControls from '../RecordPageControls.vue'
const snapshot=ref(null),snapshotQuery=ref(null),fields=recordFields('restriction',true)
const users=ref([]),usersError=ref(''),items=ref([]),loaded=ref(false),loading=ref(false),error=ref(''),filters=ref({user_id:null,status:null}),applied=ref(null)
const blank=()=>({reason:'',verification_note:'',facts_confirmed:false})
const form=ref({...blank(),user_id:null,ends_at:''}),releaseForm=ref(blank()),selected=ref(null),submitting=ref(false),unknown=ref(false),readPending=ref(false),pending=ref(null),actionError=ref(''),receipt=ref(null)
const selectedDetails=ref(null),detailLoading=ref(false);let selectionSequence=0
const busy=computed(()=>submitting.value||unknown.value||readPending.value||detailLoading.value)
function closeDetail(){if(busy.value)return;selected.value=null;selectedDetails.value=null;releaseForm.value=blank();actionError.value=''}
const userOptions=computed(()=>[{value:null,label:'明确选择普通用户'},...users.value.filter(user=>['student','staff'].includes(user.role)).map(user=>({value:user.id,label:`#${user.id} ${user.real_name} / ${user.username} / ${user.campus_id||'校园编号未登记'}${user.status==='active'?'':'（已停用）'}`}))])
const filterUserOptions=computed(()=>[{value:null,label:'全部账号记录（含历史余效）'},...users.value.map(user=>({value:user.id,label:`#${user.id} ${user.real_name} / ${user.username}${user.role==='admin'?'（管理员历史记录）':''}`}))])
const copy=value=>JSON.parse(JSON.stringify(value));let alive=true,sequence=0
async function loadUsers(){usersError.value='';try{const response=await listUsers();if(alive)users.value=response.data}catch(failure){if(alive)usersError.value=failure.message}}
async function loadList({afterWrite=false,useApplied=true,allowDuringWrite=false,page}={}){
  if((submitting.value||unknown.value)&&!afterWrite&&!allowDuringWrite)return false
  const ticket=++sequence,source=useApplied&&applied.value?applied.value:filters.value;let query;try{query=recordQuery(source,useApplied?page||snapshot.value?.page||1:1)}catch(e){error.value=e.message;return false}
  loading.value=true;error.value=''
  try{const response=await listAdminRestrictions(query);if(!alive||ticket!==sequence)return false;if(!validRecordPage(response.data,query))throw new Error('管理限制分页返回不完整');items.value=response.data.items;applied.value=copy(source);snapshot.value=response.data;snapshotQuery.value={...query};loaded.value=true
    if(selected.value)selected.value=items.value.find(item=>item.id===selected.value.id)||{...selected.value,unverified:true}
    if(afterWrite){if(pending.value?.action==='create')form.value={...blank(),user_id:form.value.user_id,ends_at:''};else releaseForm.value=blank();readPending.value=false;pending.value=null}return true
  }catch(failure){if(alive&&ticket===sequence)error.value=afterWrite?'操作已保存。列表更新失败，请刷新列表。':failure.message;return false}
  finally{if(alive&&ticket===sequence)loading.value=false}
}
async function choose(record,{keepDraft=false}={}){if(busy.value)return;const ticket=++selectionSequence;selected.value={...record,unverified:true};selectedDetails.value=null;if(!keepDraft)releaseForm.value=blank();actionError.value='';detailLoading.value=true;try{const {data}=await getAdminRestriction(record.id);if(!alive||ticket!==selectionSequence)return;if(data?.id!==record.id||!Number.isSafeInteger(data.subject?.id))throw new Error('管理限制详情不完整');selected.value=data;selectedDetails.value=data}catch(e){if(alive&&ticket===selectionSequence)actionError.value=e.message}finally{if(alive&&ticket===selectionSequence)detailLoading.value=false}}
function validReceipt(value,operation){
  const record=value?.restriction,effects=value?.effects
  return value?.operation_id===operation.body.operation_id&&Number.isSafeInteger(record?.id)&&record.id>0&&record.subject?.id===operation.user_id&&Number.isInteger(record.version)&&['active','expired','released'].includes(record.status)&&validEligibility(value.eligibility)&&Array.isArray(effects?.cancelled_pending)&&Number.isSafeInteger(effects.settled_unused_count)&&effects.settled_unused_count>=0&&Number.isSafeInteger(effects.continued_checked_in_count)&&effects.continued_checked_in_count>=0&&effects.cancelled_pending.every(row=>Number.isSafeInteger(row.reservation_id)&&row.reservation_id>0&&row.status==='cancelled'&&row.termination_reason==='admin_restriction')&&(operation.action==='create'?record.source==='manual'&&offsetInstant(record.starts_at)!==null&&record.reason===operation.body.reason&&offsetInstant(record.ends_at)!==null&&offsetInstant(record.ends_at)===offsetInstant(operation.body.ends_at)&&Number.isSafeInteger(record.notification_id)&&record.notification_id>0&&offsetInstant(record.notified_at)!==null:record.id===operation.id&&record.status==='released'&&offsetInstant(record.released_at)!==null&&record.release_reason===operation.body.reason&&Number.isSafeInteger(record.release_notification_id)&&record.release_notification_id>0&&offsetInstant(record.release_notified_at)!==null)
}
async function sendPending(){const operation=copy(pending.value);actionError.value=''
  try{const response=await (operation.action==='create'?createRestriction(operation.body):releaseRestriction(operation.id,operation.body));if(!alive)return
    if(!validReceipt(response.data,operation))throw new Error('暂时无法确认操作结果')
    receipt.value=response.data;unknown.value=false;readPending.value=true;await loadList({afterWrite:true,useApplied:true})
  }catch(failure){if(!alive)return;unknown.value=failure.status==null||failure.status===408||failure.status>=500
    actionError.value=unknown.value?'暂时无法确认结果。可以重试确认本次操作，已填写的内容会保留。':failure.message
    if(!unknown.value&&failure.status===409){actionError.value=actionError.value.replace(/[。.!！?？]+$/u,'')+'。请核对更新后的记录，已填写的内容会保留。';await loadList({useApplied:true,allowDuringWrite:true})}
  }
}
async function act(action){if(busy.value||loading.value)return
  let payload,user,record
  try{if(action==='create'){payload=restrictionPayload(form.value);user=users.value.find(item=>item.id===payload.user_id&&['student','staff'].includes(item.role));if(!user)throw new Error('请先读取并明确选择真实普通账号')}else{record=selected.value;if(!record||record.status!=='active'||record.unverified)return;payload={...restrictionPayload(releaseForm.value,true),version:record.version};user=record.subject}}
  catch(failure){actionError.value=failure.message;return}
  pending.value={action,id:record?.id||null,user_id:user.id,body:{...payload,operation_id:crypto.randomUUID()}};submitting.value=true;actionError.value='';receipt.value=null
  const operation=copy(pending.value)
  const creating = action === 'create'
  const summary = h('div', [
    h('p', `${user.real_name || user.username} · ${user.campus_id || user.username}`),
    h('p', creating
      ? `暂停新预约，立即生效，截止 ${formatCampusDateTime(payload.ends_at)}。`
      : '解除当前这条预约限制。该账号的其他限制仍然有效。'),
    h('p', creating
      ? '仍可签到的预约会被取消，使用中的预约继续。'
      : '已取消的预约需要重新预约。'),
    h('p', `公开原因：${payload.reason}`),
    h('details', [
      h('summary', '查看核实依据和处理规则'),
      h('p', `私有核实依据：${payload.verification_note}`),
      h('p', creating
        ? '已过签到期限的预约按原规则结算。因本次限制取消的预约不会新增违规。'
        : '解除全部限制后，如累计违规达到限制条件，系统可能立即开始新的预约限制。')
    ])
  ])
  try{try{await confirmDialog(summary,creating?'确认暂停预约':'确认解除限制',{type:'warning',confirmButtonText:creating?'暂停预约':'解除限制'})}catch{return}
    if(alive&&pending.value?.body.operation_id===operation.body.operation_id)await sendPending()
  }finally{if(alive)submitting.value=false}
}
async function retryUnknown(){if(!unknown.value||submitting.value||!pending.value)return;submitting.value=true;try{await sendPending()}finally{if(alive)submitting.value=false}}
function refresh(){return loadList({afterWrite:readPending.value,useApplied:true})}
onMounted(()=>{void loadUsers();void loadList()});onBeforeUnmount(()=>{alive=false;sequence++;selectionSequence++})
defineExpose({loadList:refresh})
</script>
<template><section class="restriction-management"><section class="card"><div class="card-title-row"><h3>预约限制管理</h3><SButton size="sm" :loading="loading" @click="refresh">刷新</SButton></div><RecordFilters v-model="filters" :fields="fields" :disabled="busy||loading" @apply="loadList({useApplied:false})"/><p v-if="loading" role="status">正在读取真实限制列表…</p><SBanner v-if="error" type="error" :title="error"><SButton :disabled="submitting||unknown" @click="refresh">{{readPending?'重试读取已保存结果':'重试查询'}}</SButton></SBanner><div class="record-box"><div v-if="loaded" class="records"><section v-for="record in items" :key="record.id"><p>账号#{{record.subject.id}} {{record.subject.real_name}} / {{record.subject.username}} · {{record.subject.role==='staff'?'教职工':record.subject.role==='student'?'学生':'管理员'}} · {{record.subject.status==='active'?'启用':'停用'}}；记录版本{{record.version}}</p><RestrictionRecord :record="record" /><SButton size="sm" :disabled="busy" @click="choose(record)">查看管理详情/选择解除</SButton></section></div><SEmpty v-if="loaded&&!loading&&!error&&!items.length" description="当前条件暂无限制记录"/><p v-else-if="!loaded&&!loading&&!error">尚未读取限制列表。</p></div><RecordPageControls :snapshot="snapshot" :query="snapshotQuery" :fields="fields" :disabled="busy||loading" @page="loadList({page:$event})"/></section>
<SBanner v-if="usersError" type="error" :title="usersError"><SButton :disabled="busy" @click="loadUsers">重试账号选项</SButton></SBanner>
<SBanner v-if="actionError" type="error" :title="actionError" />
<div v-if="unknown">
  <SButton :loading="submitting" @click="retryUnknown">重试确认本次操作</SButton>
  <details><summary>查看操作编号</summary>{{pending?.body.operation_id}}</details>
</div>
<section v-if="receipt" class="card write-receipt">
  <h4>{{receipt.restriction.status === 'released' ? '预约限制已解除' : '预约限制已保存'}}</h4>
  <p>{{receipt.eligibility.can_book ? '操作完成时，该账号可以预约。' : '操作完成时，该账号暂不能预约。'}}</p>
  <p v-if="receipt.effects.cancelled_pending.length">已取消 {{receipt.effects.cancelled_pending.length}} 条待签到预约。</p>
  <p v-if="receipt.effects.settled_unused_count">已结算 {{receipt.effects.settled_unused_count}} 条未使用的预约。</p>
  <p v-if="receipt.effects.continued_checked_in_count">{{receipt.effects.continued_checked_in_count}} 条使用中的预约可以继续。</p>
  <ul v-if="receipt.effects.cancelled_pending.length"><li v-for="row in receipt.effects.cancelled_pending" :key="row.reservation_id">预约 #{{row.reservation_id}} · {{ formatCampusDateTime(row.ended_at) }} · {{row.termination_note}}</li></ul>
  <p v-if="receipt.eligibility.active_restrictions.length">操作完成时，此账号有 {{receipt.eligibility.active_restrictions.length}} 条生效中的限制。</p>
  <RestrictionRecord v-for="record in receipt.eligibility.active_restrictions" :key="record.id" :record="record" />
</section>
<form class="card write-form" @submit.prevent="act('create')"><h4>新增预约限制</h4><label>校园账号<SSelect v-model="form.user_id" :options="userOptions" :disabled="busy" searchable /></label><label>截止时刻<SInput v-model="form.ends_at" type="datetime-local" step="0.000001" :disabled="busy" required /></label><label>公开原因<SInput v-model="form.reason" type="textarea" maxlength="1000" :disabled="busy" required /></label><label>核实依据（仅管理员可见）<SInput v-model="form.verification_note" type="textarea" maxlength="2000" :disabled="busy" required placeholder="填写核实依据" /></label><label><span><input v-model="form.facts_confirmed" type="checkbox" :disabled="busy" /> 我已核实相关情况</span></label><SButton type="submit" variant="primary" :disabled="busy||loading" :loading="submitting&&pending?.action==='create'">核对并新增限制</SButton></form>
<SDialog :model-value="!!selected" :title="selected?`限制#${selected.id}详情`:'限制详情'" width="760px" :show-close="!busy" :close-on-click-modal="!busy" :close-on-escape="!busy" @update:model-value="value=>{if(!value)closeDetail()}"><section v-if="selected" class="restriction-detail"><p v-if="detailLoading">正在读取私有管理依据…</p><template v-if="selectedDetails"><p class="private-note">私有核实依据：{{selectedDetails.verification_note||'原记录未留存'}}</p><p class="private-note">解除私有核实依据：{{selectedDetails.release_verification_note||'原记录未留存'}}</p></template></section><form v-if="selected" class="write-form" @submit.prevent="act('release')"><h4>仅解除限制#{{selected.id}} · {{restrictionStatuses[selected.status]}}</h4><RestrictionRecord :record="selected" /><p v-if="selected.unverified">记录不在当前页，请重新选择。</p><p>其他限制仍保留；新预约资格以服务端为准。</p><label>公开解除原因<SInput v-model="releaseForm.reason" type="textarea" maxlength="1000" :disabled="busy||selected.unverified||selected.status!=='active'" required /></label><label>私有核实依据<SInput v-model="releaseForm.verification_note" type="textarea" maxlength="2000" :disabled="busy||selected.unverified||selected.status!=='active'" required /></label><label><span><input v-model="releaseForm.facts_confirmed" type="checkbox" :disabled="busy||selected.unverified||selected.status!=='active'" /> 我已核实相关情况</span></label><SButton type="submit" :disabled="busy||loading||selected.unverified||selected.status!=='active'" :loading="submitting&&pending?.action==='release'">核对并仅解除此条</SButton></form><template #footer><SButton :disabled="busy" @click="choose(selected,{keepDraft:true})">重新读取</SButton><SButton :disabled="busy" @click="closeDetail">关闭</SButton></template></SDialog></section></template>
<style scoped>.record-box{margin-top:20px}
.record-box{border:1px solid var(--border);border-radius:var(--r-lg);padding:18px;display:grid;gap:16px;min-height:120px;min-width:0}.restriction-management,.write-form,.records{display:grid;gap:18px;min-width:0}.write-form label,.filter-fields label{display:grid;gap:8px}.filter-fields{display:flex;flex-wrap:wrap;gap:16px;align-items:end}.filter-fields label{flex:1;min-width:160px}.private-note{white-space:pre-wrap;overflow-wrap:anywhere;padding:10px;background:var(--surface-2)}.write-receipt{overflow-wrap:anywhere}</style>
