<script setup>
import { formatCampusDateTime } from '../composables/campusDateTime.js'
import {computed,onBeforeUnmount,ref,watch} from 'vue'
import {useRoute} from 'vue-router'
import {getAppealEligibility,createAppeal,getAppeal,uploadAppealAttachment} from '../api/appeal'
import {appealBlockedText,appealPayload,validAppealDetail,validAppealEligibility,violationLabels,appealStatuses} from '../composables/appealForm.js'
import {offsetInstant} from '../composables/restrictionForm.js'
import {positiveId} from '../composables/complaintForm.js'
import {useEvidenceUploadQueue} from '../composables/useEvidenceUploadQueue.js'
import EvidenceUploadQueue from '../components/EvidenceUploadQueue.vue'
import AppealRecord from '../components/AppealRecord.vue'
import SInput from '../components/ui/SInput.vue'
import SButton from '../components/ui/SButton.vue'
import SBanner from '../components/ui/SBanner.vue'
const route=useRoute(),violation=ref(null),eligibility=ref(null),loading=ref(false),loadError=ref(''),description=ref(''),submitting=ref(false),unknown=ref(false),error=ref(''),receipt=ref(null),record=ref(null),reading=ref(false),readError=ref('')
const locked=computed(()=>submitting.value||unknown.value||!!receipt.value),canSubmit=computed(()=>!!eligibility.value?.can_submit&&!loading.value&&!loadError.value)
let alive=true,scope=0,sequence=0,readSequence=0,violationId=null,frozen=null,frozenBasis=null,fingerprint=''
const queue=useEvidenceUploadQueue({uploadFile:uploadAppealAttachment,isLocked:()=>locked.value||!canSubmit.value,isActive:()=>alive,setError:text=>{error.value=text}})
const {items,uploading,uploadItem,selectFiles,removeItem}=queue
async function loadEligibility(){if(locked.value)return;const ticket=++sequence,id=violationId;loading.value=true;loadError.value='';if(!id){loading.value=false;loadError.value='请先选择要申诉的违规记录。';return}
  try{const response=await getAppealEligibility(id);if(!alive||ticket!==sequence)return;if(!validAppealEligibility(response.data,id))throw new Error('暂时无法查看能否申诉。');violation.value=response.data.violation;eligibility.value=response.data.eligibility}
  catch(failure){if(alive&&ticket===sequence)loadError.value=failure.message}
  finally{if(alive&&ticket===sequence)loading.value=false}
}
async function refreshCreated(){if(!receipt.value)return;const ticket=++readSequence,id=receipt.value.id;reading.value=true;readError.value=''
  try{const response=await getAppeal(id);if(!alive||ticket!==readSequence)return;if(!validAppealDetail(response.data)||response.data.id!==id)throw new Error('申诉详情返回不完整');record.value=response.data}
  catch(failure){if(alive&&ticket===readSequence)readError.value='申诉已保存，暂时无法加载进度。'}
  finally{if(alive&&ticket===readSequence)reading.value=false}
}
async function submit(){if(submitting.value||uploading.value||receipt.value||(!unknown.value&&!canSubmit.value))return;error.value=''
  if(!unknown.value){try{const body=appealPayload(description.value,items.value),signature=JSON.stringify(body);if(!frozen||fingerprint!==signature){frozen={...body,operation_id:crypto.randomUUID()};frozenBasis={id:eligibility.value.notification_id,notified_at:eligibility.value.notified_at,deadline:eligibility.value.deadline};fingerprint=signature}}catch(failure){error.value=failure.message;return}}
  const ticket=scope,id=violationId,body=JSON.parse(JSON.stringify(frozen));submitting.value=true
  try{const response=await createAppeal(id,body);if(!alive||ticket!==scope)return;const value=response.data,detail=value?.appeal
    if(value?.operation_id!==body.operation_id||!validAppealDetail(detail)||detail.violation_id!==id||!(detail.status==='submitted'||(value.replayed===true&&['approved','rejected'].includes(detail.status)))||detail.notification_basis.id!==frozenBasis?.id||offsetInstant(detail.notification_basis.notified_at)!==offsetInstant(frozenBasis.notified_at)||offsetInstant(detail.notification_basis.deadline)!==offsetInstant(frozenBasis.deadline)||detail.description!==body.description||detail.attachments.length!==body.attachment_ids.length||new Set(detail.attachments.map(item=>item.id)).size!==body.attachment_ids.length||detail.attachments.some(item=>!body.attachment_ids.includes(item.id)))throw new Error('申诉回执不完整，请以原操作ID核对')
    unknown.value=false;receipt.value=detail;record.value=null;await refreshCreated()
  }catch(failure){if(!alive||ticket!==scope)return;unknown.value=failure.status==null||failure.status===408||failure.status>=500
    error.value=unknown.value?'暂时无法确认申诉是否已提交。':failure.message
    if (!unknown.value && failure.status === 409) {
      if (failure.details?.code === 'appeal_pending' && Number.isSafeInteger(failure.details.existing_appeal?.id)) {
        eligibility.value = { ...eligibility.value, can_submit: false, blocked_by: 'pending', existing_appeal: failure.details.existing_appeal }
      } else if (failure.details?.code === 'appeal_not_eligible' && typeof failure.details.eligibility?.can_submit === 'boolean') {
        eligibility.value = failure.details.eligibility
      }
      error.value = eligibility.value?.can_submit ? '申诉未提交，你填写的内容已保留。' : ''
    }
  }finally{if(alive&&ticket===scope)submitting.value=false}
}
watch(()=>route.query.violation_id,()=>{scope++;sequence++;readSequence++;queue.reset();violation.value=null;eligibility.value=null;receipt.value=null;record.value=null;description.value='';error.value='';readError.value='';unknown.value=false;submitting.value=false;reading.value=false;frozen=null;frozenBasis=null;fingerprint='';try{violationId=positiveId(route.query.violation_id)}catch(failure){violationId=null}void loadEligibility()},{immediate:true})
onBeforeUnmount(()=>{alive=false;scope++;sequence++;readSequence++;queue.dispose()})
</script>
<template>
  <div class="page-view appeal-create">
    <header class="view-heading" data-page-title>
      <h1>违规申诉</h1>
      <RouterLink v-if="!violation || receipt" class="appeal-link" to="/profile#violations">返回违规记录</RouterLink>
    </header>
    <section class="card">
      <p v-if="loading" role="status">正在加载申诉信息…</p>
      <SBanner v-if="loadError" type="error" :title="loadError">
        <SButton v-if="violationId" size="sm" :loading="loading" :disabled="locked" @click="loadEligibility">重新加载申诉信息</SButton>
      </SBanner>
      <section v-if="violation && !receipt" class="appeal-violation">
        <div class="appeal-violation-heading">
          <h2>{{ violationLabels[violation.type] || violation.type }}</h2>
          <RouterLink class="appeal-link" :to="{ name: 'profile', query: { violation_id: violation.id }, hash: '#violations' }">
            查看这条违规
          </RouterLink>
        </div>
        <p class="muted">{{ formatCampusDateTime(violation.occurred_at) }}</p>
        <p v-if="violation.reason && violation.reason !== '签到期限到达仍未签到'" class="text">{{ violation.reason }}</p>
        <p v-if="eligibility?.blocked_by === 'before_notification' && eligibility.notified_at">
          <strong>申诉开放时间</strong> {{ formatCampusDateTime(eligibility.notified_at) }}
        </p>
        <p v-if="eligibility?.deadline"><strong>申诉截止</strong> {{ formatCampusDateTime(eligibility.deadline) }}</p>
        <SBanner v-if="eligibility && !eligibility.can_submit && !loadError" type="warning" :title="appealBlockedText[eligibility.blocked_by] || '当前无法提交申诉。'">
          <RouterLink v-if="eligibility.existing_appeal?.id" :to="`/appeals/${eligibility.existing_appeal.id}`">查看申诉进度</RouterLink>
        </SBanner>
      </section>
      <SBanner v-if="error" :type="unknown ? 'warning' : 'error'" :title="error">
        <SButton v-if="unknown" size="sm" :loading="submitting" @click="submit">重试上次提交</SButton>
      </SBanner>
      <form v-if="violation && !receipt && (canSubmit || unknown || description || items.length)" class="appeal-fields" @submit.prevent="submit">
        <label>申诉说明<SInput v-model="description" type="textarea" :rows="5" maxlength="2000" :disabled="locked || !canSubmit" placeholder="说明你希望核查的情况，最多 2000 字" /></label>
        <EvidenceUploadQueue :items="items" :disabled="locked || !canSubmit" :uploading="uploading" @select="selectFiles" @retry="uploadItem" @remove="removeItem" />
        <p v-if="!canSubmit && !unknown && (description || items.length)" class="muted">你填写的说明和选择的照片仍可查看。</p>
        <div v-if="canSubmit && !unknown">
          <SButton type="submit" variant="primary" :loading="submitting" :disabled="uploading">提交申诉</SButton>
        </div>
      </form>
      <section v-if="receipt" class="appeal-violation">
        <SBanner type="success" :title="`申诉已提交 · ${appealStatuses[record?.status || receipt.status] || '已受理'}`">
          <RouterLink :to="`/appeals/${receipt.id}`">查看申诉进度</RouterLink>
        </SBanner>
        <SBanner v-if="readError" type="warning" :title="readError">
          <SButton size="sm" :loading="reading" @click="refreshCreated">重新加载进度</SButton>
        </SBanner>
        <AppealRecord v-if="record" :record="record" />
      </section>
    </section>
  </div>
</template>
<style scoped>
.appeal-create { max-width: 1100px; }
.appeal-create > .card, .appeal-fields, .appeal-violation { display: grid; gap: 16px; min-width: 0; }
.appeal-fields label { display: grid; gap: 7px; }
.appeal-violation-heading { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 8px 16px; }
.appeal-violation h2 { margin: 0; font-size: var(--fs-h3, 20px); }
.appeal-link { color: inherit; text-decoration: underline; text-underline-offset: 3px; }
.text { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
