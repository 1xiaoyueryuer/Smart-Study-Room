<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { getComplaint, withdrawComplaint, confirmComplaintFeedback, objectComplaintFeedback } from '../api/complaint'
import { useServiceTargetClock } from '../composables/useServiceTargetClock.js'
import { ownerComplaintActions } from '../composables/complaintForm.js'
import { confirmDialog } from '../components/ui/feedback'
import ComplaintRecord from '../components/ComplaintRecord.vue'
import SButton from '../components/ui/SButton.vue'
import SInput from '../components/ui/SInput.vue'
import SBanner from '../components/ui/SBanner.vue'
const props=defineProps({id:{type:[String,Number],required:true}})
const record=ref(null),loading=ref(false),error=ref(''),description=ref(''),submitting=ref(false),unknown=ref(false),readPending=ref(false),pending=ref(null),actionError=ref(''),writeNotice=ref('')
const actions=computed(()=>ownerComplaintActions(record.value)),busy=computed(()=>submitting.value||unknown.value||readPending.value)
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
function refresh(){if(submitting.value||unknown.value)return;return load({afterWrite:readPending.value})}
watch(()=>props.id,()=>{scope++;sequence++;record.value=null;pending.value=null;submitting.value=false;unknown.value=false;readPending.value=false;description.value='';actionError.value='';writeNotice.value='';void load()},{immediate:true})
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
</style>
