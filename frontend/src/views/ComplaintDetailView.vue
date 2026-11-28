<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { getCampusComplaintPhoto, getComplaint, withdrawComplaint, confirmComplaintFeedback, objectComplaintFeedback, updateComplaintVisibility } from '../api/complaint'
import { useServiceTargetClock } from '../composables/useServiceTargetClock.js'
import { ownerComplaintActions } from '../composables/complaintForm.js'
import { complaintVisibilityPayload, visibilityLabels } from '../composables/complaintVisibility.js'
import { confirmDialog } from '../components/ui/feedback'
import ComplaintRecord from '../components/ComplaintRecord.vue'
import ComplaintCampusCard from '../components/ComplaintCampusCard.vue'
import ComplaintVisibilityFields from '../components/ComplaintVisibilityFields.vue'
import SButton from '../components/ui/SButton.vue'
import SInput from '../components/ui/SInput.vue'
import SBanner from '../components/ui/SBanner.vue'
const props=defineProps({id:{type:[String,Number],required:true}})
const record=ref(null),loading=ref(false),error=ref(''),description=ref(''),submitting=ref(false),unknown=ref(false),readPending=ref(false),pending=ref(null),actionError=ref(''),writeNotice=ref('')
const visibilityDraft = ref(null), visibilityPreview = ref(false), visibilityError = ref('')
const actions=computed(()=>ownerComplaintActions(record.value)),busy=computed(()=>submitting.value||unknown.value||readPending.value)
const currentVisibility = computed(() => record.value?.status === 'withdrawn' ? 'private' : record.value?.visibility || 'private')
const publicationCategory = computed(() => record.value?.type === 'occupation' ? 'occupation' : record.value?.service_kind)
const publicationRoom = computed(() => record.value?.room_name ?? record.value?.context_snapshot?.room_name)
const actionLabels={withdraw:'撤回投诉',confirm:'接受回复并结案',object:'提交异议'}
const actionResults={withdraw:'投诉已撤回。',confirm:'已接受回复，投诉已结案。',object:'异议已提交，将重新处理。'}
const actionApis={withdraw:withdrawComplaint,confirm:confirmComplaintFeedback,object:objectComplaintFeedback}
let sequence=0,scope=0,alive=true
const targetClock=useServiceTargetClock({records:computed(()=>record.value?[record.value]:[]),blocked:computed(()=>busy.value||loading.value),onDue:()=>load({preserve:true})})
async function load({afterWrite=false,allowDuringWrite=false,preserve=false}={}){if((submitting.value||unknown.value)&&!afterWrite&&!allowDuringWrite)return false;const ticket=++sequence,id=props.id;loading.value=true;error.value='';if(!afterWrite&&!preserve)record.value=null
  try{const response=await getComplaint(id);if(alive&&ticket===sequence){if(String(response.data?.id)!==String(id)||!Array.isArray(response.data?.attachments)||!Array.isArray(response.data?.events))throw new Error('详情返回不完整');record.value=response.data;if(afterWrite){if(pending.value?.action==='object')description.value='';pending.value=null;readPending.value=false}return true}}
  catch(failure){if(alive&&ticket===sequence)error.value=afterWrite?'暂时无法加载处理进度。':failure.message;return false}
  finally{if(alive&&ticket===sequence)loading.value=false}
}
async function sendPending(){const operation=JSON.parse(JSON.stringify(pending.value)),ticket=scope;actionError.value=''
  try{const response=await actionApis[operation.action](operation.id,operation.body);if(!alive||ticket!==scope)return;const value=response.data
    if(value?.operation_id!==operation.body.operation_id||!Number.isInteger(value.event_id)||String(value.complaint?.id)!==String(operation.id)||!Array.isArray(value.complaint?.events))throw new Error('操作回执不完整，请以原操作ID核对')
    unknown.value=false;readPending.value=true;record.value=value.complaint;writeNotice.value=actionResults[operation.action]
    await load({afterWrite:true})
  }catch(failure){if(!alive||ticket!==scope)return;unknown.value=failure.status==null||failure.status===408||failure.status>=500
    const autoClosed = failure.status === 409 && failure.details?.closure_type === 'auto_closed'
    actionError.value = unknown.value ? '暂时无法确认操作结果。'
      : autoClosed ? '确认期限已过，投诉已自动结案。'
      : failure.status === 409 ? '投诉状态已变化，请查看最新进度。'
      : failure.message
    if (!unknown.value && failure.status === 409) await load({ allowDuringWrite: true })
  }
}
async function act(action){if(busy.value||loading.value||error.value||!actions.value.includes(action)||!record.value)return
  const body={version:record.value.version,operation_id:crypto.randomUUID()}
  if(action==='object'){const text=description.value.trim();if(!text||text.length>2000){actionError.value='请填写1至2000字的异议说明';return}body.description=text}
  pending.value={id:record.value.id,action,body,feedback_id:record.value.current_feedback?.id,deadline:record.value.current_feedback?.deadline};const ticket=scope;submitting.value=true;actionError.value='';writeNotice.value=''
  try{try{await confirmDialog(action==='withdraw'?'撤回这条投诉？':action==='confirm'?'接受这次回复并结束投诉？':'提交异议后，工作人员会重新处理这条投诉。',actionLabels[action],{type:'warning'})}catch{return}
    if(alive&&ticket===scope)await sendPending()
  }finally{if(alive&&ticket===scope)submitting.value=false}
}
async function retryUnknown(){if(!unknown.value||submitting.value||!pending.value)return;submitting.value=true;try{await sendPending()}finally{if(alive)submitting.value=false}}
async function refresh() {
  if (submitting.value || unknown.value) return
  const read = await load({ afterWrite: readPending.value, preserve: !!visibilityDraft.value })
  if (read && visibilityDraft.value && visibilityError.value) visibilityDraft.value.version = record.value.version
  return read
}
function editVisibility() {
  if (!record.value || record.value.status === 'withdrawn' || busy.value || loading.value || error.value) return
  visibilityError.value = ''
  visibilityDraft.value = {
    version: record.value.version,
    visibility: record.value.visibility || 'private',
    summary: record.value.public_summary || '',
    details: record.value.public_details || '',
    photoIds: [...(record.value.public_attachment_ids || [])]
  }
}
function cancelVisibility() {
  visibilityDraft.value = null
  visibilityPreview.value = false
  visibilityError.value = ''
}
async function saveVisibility({ confirmed = false } = {}) {
  if (!visibilityDraft.value || !record.value || record.value.status === 'withdrawn' || busy.value || loading.value || error.value) return
  visibilityError.value = ''
  const draft = visibilityDraft.value
  let fields
  try {
    fields = complaintVisibilityPayload(draft.visibility, draft.summary, draft.details, draft.photoIds)
  } catch (failure) {
    visibilityError.value = failure.message
    return
  }
  if (fields.visibility === 'campus' && !confirmed) {
    visibilityPreview.value = true
    return
  }
  const id = record.value.id
  const ticket = scope
  const current = () => alive && ticket === scope
  const matches = value => {
    const photoIds = value?.public_attachment_ids ?? []
    return String(value?.id) === String(id) && value.visibility === fields.visibility &&
      value.public_summary === fields.public_summary && (value.public_details ?? null) === fields.public_details &&
      Array.isArray(photoIds) && photoIds.length === fields.public_attachment_ids.length &&
      fields.public_attachment_ids.every(id => photoIds.includes(id))
  }
  const saved = () => {
    cancelVisibility()
    writeNotice.value = '可见范围已保存。'
  }
  submitting.value = true
  writeNotice.value = ''
  try {
    const { data } = await updateComplaintVisibility(id, { version: draft.version, ...fields })
    if (!current()) return
    if (!matches(data) || !Number.isSafeInteger(data.version) || !Array.isArray(data.attachments) || !Array.isArray(data.events)) {
      throw new Error('暂时无法确认可见范围是否已保存。')
    }
    record.value = data
    saved()
  } catch (failure) {
    if (!current()) return
    const conflict = failure.status === 409
    if (conflict || failure.status == null || failure.status === 408 || failure.status >= 500) {
      const read = await load({ allowDuringWrite: true, preserve: true })
      if (!current()) return
      if (read && record.value.status === 'withdrawn') {
        cancelVisibility()
        actionError.value = '这条求助已撤回。'
        return
      }
      if (read && matches(record.value)) {
        saved()
        return
      }
      if (read) draft.version = record.value.version
      visibilityError.value = read
        ? '请核对当前可见范围，再保存你的修改。'
        : '暂时无法确认可见范围是否已保存，草稿已保留。'
    } else {
      visibilityError.value = failure.message
    }
  } finally {
    if (current()) submitting.value = false
  }
}
function confirmVisibility() {
  if (!visibilityPreview.value) return
  visibilityPreview.value = false
  return saveVisibility({ confirmed: true })
}
watch(()=>props.id,()=>{scope++;sequence++;record.value=null;pending.value=null;submitting.value=false;unknown.value=false;readPending.value=false;description.value='';actionError.value='';writeNotice.value='';cancelVisibility();void load()},{immediate:true})
onBeforeUnmount(()=>{alive=false;sequence++;scope++})
</script>
<template>
  <div class="page-view complaint-detail">
    <header class="view-heading" data-page-title>
      <h1>求助与投诉详情</h1>
      <RouterLink to="/complaints">返回投诉列表</RouterLink>
    </header>
    <section class="card">
      <p v-if="loading" role="status">正在查看处理进度…</p>
      <SBanner v-if="error" type="error" :title="error">
        <SButton :disabled="submitting || unknown" @click="refresh">{{ readPending ? '查看最新进度' : '重新加载详情' }}</SButton>
      </SBanner>
      <SBanner v-if="actionError" :type="unknown ? 'warning' : 'error'" :title="actionError">
        <SButton v-if="unknown" :loading="submitting" @click="retryUnknown">重试上次操作</SButton>
      </SBanner>
      <SBanner v-if="writeNotice" type="success" :title="writeNotice" />
      <ComplaintRecord v-if="record && !loading" :record="record" :target-progress="targetClock.progress(record)" compact />
      <section v-if="record && !loading" class="owner-visibility" aria-label="可见范围">
        <div class="visibility-heading">
          <div><h3>可见范围</h3><p class="muted">{{ visibilityLabels[currentVisibility] }}</p></div>
          <SButton v-if="!visibilityDraft && record.status !== 'withdrawn'" size="sm" :disabled="busy || !!error" @click="editVisibility">修改可见范围</SButton>
        </div>
        <ComplaintCampusCard v-if="!visibilityDraft && currentVisibility === 'campus' && record.public_summary"
          :key="`published:${record.version}`" :room-name="publicationRoom" :category="publicationCategory" :status="record.status"
          :summary="record.public_summary" :details="record.public_details" :photo-ids="record.public_attachment_ids" :load-photo="getCampusComplaintPhoto" />
        <form v-if="visibilityDraft && record.status !== 'withdrawn'" class="owner-visibility" @submit.prevent="saveVisibility">
          <SBanner v-if="visibilityError" type="error" :title="visibilityError" />
          <ComplaintVisibilityFields v-model:visibility="visibilityDraft.visibility" v-model:summary="visibilityDraft.summary"
            v-model:details="visibilityDraft.details" v-model:selected-photo-ids="visibilityDraft.photoIds"
            v-model:preview-open="visibilityPreview" :room-name="publicationRoom" :category="publicationCategory" :status="record.status" :photos="record.attachments"
            :disabled="busy || !!error" confirm-label="确认公开并保存" @confirm="confirmVisibility" />
          <div class="row-actions">
            <SButton type="submit" variant="primary" :loading="submitting" :disabled="busy || !!error">{{ visibilityDraft.visibility === 'campus' ? '预览并保存' : '保存' }}</SButton>
            <SButton :disabled="busy" @click="cancelVisibility">取消</SButton>
          </div>
        </form>
      </section>
      <section v-if="record && !loading && !error && actions.length" class="owner-actions">
        <SButton v-if="actions.includes('withdraw')" :disabled="busy" @click="act('withdraw')">{{ actionLabels.withdraw }}</SButton>
        <SButton v-if="actions.includes('confirm')" variant="primary" :disabled="busy" @click="act('confirm')">{{ actionLabels.confirm }}</SButton>
        <template v-if="actions.includes('object')">
          <label>异议说明<SInput v-model="description" type="textarea" maxlength="2000" :rows="4" :disabled="busy" placeholder="请说明哪里还需要处理，最多 2000 字" /></label>
          <SButton :disabled="busy" @click="act('object')">{{ actionLabels.object }}</SButton>
        </template>
      </section>
      <div v-if="record && !error && !unknown && !loading">
        <SButton size="sm" :disabled="submitting" @click="refresh">查看最新进度</SButton>
      </div>
    </section>
  </div>
</template>
<style scoped>
.complaint-detail { max-width: 1100px; }
.complaint-detail > .card, .owner-actions { display: grid; justify-items: start; gap: 16px; min-width: 0; }
.owner-actions { width: 100%; }
.owner-actions label { display: grid; gap: 8px; width: 100%; }
.owner-visibility { display: grid; gap: 12px; min-width: 0; width: 100%; }
.visibility-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
.visibility-heading p { margin: 4px 0 0; }
</style>
