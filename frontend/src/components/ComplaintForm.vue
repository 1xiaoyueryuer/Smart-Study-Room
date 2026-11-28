<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createComplaint, getComplaint, getComplaintAttachment, getComplaintRoomSeats, uploadComplaintAttachment } from '../api/complaint'
import { getRooms } from '../api/room'
import { getReservation, listMyReservations } from '../api/reservation'
import { complaintTypes, complaintStatuses, reservationStatuses, positiveId, complaintNumber, complaintPayload, validateEvidenceFile, serviceKinds, faultTypes, impactScopes, safetyRisks, otherRequestTypes, repairPriority, repairPriorityText } from '../composables/complaintForm.js'
import { checkinDeadlineOf } from '../composables/checkinDeadline.js'
import { complaintVisibilityPayload } from '../composables/complaintVisibility.js'
import EvidenceUploadQueue from './EvidenceUploadQueue.vue'
import {useEvidenceUploadQueue} from '../composables/useEvidenceUploadQueue.js'
import ComplaintRecord from './ComplaintRecord.vue'
import ComplaintVisibilityFields from './ComplaintVisibilityFields.vue'
import SInput from './ui/SInput.vue'
import SSelect from './ui/SSelect.vue'
import SButton from './ui/SButton.vue'
import SBanner from './ui/SBanner.vue'
import SDialog from './ui/SDialog.vue'
import { validRecordPage } from '../composables/recordPage.js'

const recentChoicesQuery = { page: 1, page_size: 5 }
const props = defineProps({ initialType:{type:String,default:'service'}, initialReservationId:{type:[String,Number],default:null} })
const emit = defineEmits(['created'])
const type=ref('service'), description=ref(''), reservationId=ref(null), roomId=ref(null), context=ref(null)
const serviceKind=ref('facility'), repair=ref({faultType:'', impactScope:'', safetyRisk:''}), unsafeArea=ref(''), otherRequestType=ref('')
const customRequestType = ref('')
const customType = '__custom__'
const rooms=ref([]), choices=ref([]), roomsError=ref(''), choicesError=ref(''), contextError=ref(''), contextLoading=ref(false), roomsLoading=ref(false), choicesLoading=ref(false)
const choosingReservation = ref(false)
const reservationFromEntry = computed(() => props.initialReservationId != null && props.initialReservationId !== '')
const useReservation = computed(() => type.value === 'occupation')
const selectedVisibility = ref(null), publicSummary = ref(''), previewOpen = ref(false)
const visibility = computed(() => selectedVisibility.value ?? (useReservation.value ? 'private' : 'campus'))
const previewRoom = computed(() => useReservation.value ? context.value?.room_name : rooms.value.find(room => room.id === roomId.value)?.name)
const roomSeats = ref([]), selectedSeat = ref(null), seatDialog = ref(false)
const seatsLoading = ref(false), seatsError = ref('')
const seatColumns = computed(() => Math.max(1, ...roomSeats.value.map(seat => seat.col_no)))
const submitting=ref(false), uncertain=ref(false), error=ref(''), receipt=ref(null), record=ref(null), reading=ref(false), readError=ref('')
const locked=computed(()=>submitting.value || uncertain.value || !!receipt.value)
defineExpose({targetReadBlocked:computed(()=>submitting.value||uncertain.value||reading.value||uploading.value)})
const typeOptions=Object.entries(complaintTypes).map(([value,label])=>({value,label}))
const serviceKindOptions=Object.entries(serviceKinds).map(([value,label])=>({value,label}))
const faultTypeOptions=faultTypes.map(value=>({value,label:value}))
const impactOptions=impactScopes
const safetyOptions=safetyRisks.map(option=>option.value==='yes'?{...option,label:'存在安全风险'}:option)
const unsafeAreaOptions=[{value:'',label:'请选择区域安全情况'},{value:'no',label:'区域仍可安全使用'},{value:'yes',label:'区域无法安全使用'}]
const otherRequestOptions = [
  ...otherRequestTypes.map(value => ({ value, label: value })),
  { value: customType, label: '填写其他类型' }
]
const priorityPreview=computed(()=>repairPriority({...repair.value,unsafeArea:unsafeArea.value}))
const priorityPreviewText=computed(()=>repairPriorityText(priorityPreview.value).replace(/^\d级 · /, ''))
const pendingCheckin = computed(() => type.value === 'occupation' && context.value?.status === 'pending' ? checkinDeadlineOf(context.value) : null)
const roomOptions=computed(()=>[{value:null,label:'请选择关联空间'},...rooms.value.map(room=>({value:room.id,label:`${room.name} · ${room.building || '楼栋未登记'} · ${room.floor || '楼层未登记'}`}))])
let alive=true, choicesSequence=0, contextSequence=0, readSequence=0, seatSequence=0, scope=0, frozenBody=null, fingerprint=''
const queue=useEvidenceUploadQueue({uploadFile:uploadComplaintAttachment,isLocked:()=>locked.value,isActive:()=>alive,setError:text=>{error.value=text},validateFile:validateEvidenceFile,newKey:()=>crypto.randomUUID(),trackExpiry:true})
const {items,uploading,expiredCount,uploadItem,selectFiles,removeItem}=queue
const currentPhotos = computed(() => items.value.filter(item => item.phase !== 'expired'))
const hasUnfinishedPhotos = computed(() => currentPhotos.value.some(item => item.phase !== 'uploaded'))
async function loadRooms() {roomsLoading.value=true;try{const response=await getRooms();if(alive){rooms.value=response.data;roomsError.value=''}}catch(failure){if(alive)roomsError.value=failure.message}finally{if(alive)roomsLoading.value=false}}
function changeRoom(value) {
  roomId.value = value
  selectedSeat.value = null
  seatSequence++
  seatDialog.value = false
}
async function openSeatDialog() {
  if (!roomId.value || locked.value) return
  const ticket = ++seatSequence
  seatDialog.value = true
  seatsLoading.value = true
  seatsError.value = ''
  roomSeats.value = []
  try {
    const { data } = await getComplaintRoomSeats(roomId.value)
    if (!Array.isArray(data)) throw new Error('座位图暂不可用')
    if (alive && ticket === seatSequence) roomSeats.value = data
  } catch {
    if (alive && ticket === seatSequence) seatsError.value = '暂时无法打开座位图。'
  } finally {
    if (alive && ticket === seatSequence) seatsLoading.value = false
  }
}
function chooseSeat(seat) {
  if (locked.value) return
  selectedSeat.value = seat
  seatDialog.value = false
}
function reservationSlot(row) {
  return `${row.res_date} ${row.start_time.slice(0, 5)}–${row.end_time.slice(0, 5)}`
}
async function loadChoices() {
  if (locked.value || reservationFromEntry.value) return
  const ticket = ++choicesSequence
  choicesLoading.value = true
  choicesError.value = ''
  try {
    const { data } = await listMyReservations(recentChoicesQuery)
    if (!alive || ticket !== choicesSequence) return
    if (!validRecordPage(data, recentChoicesQuery)) throw new Error('预约列表暂时无法加载')
    choices.value = data.items
  } catch {
    if (alive && ticket === choicesSequence) choicesError.value = '暂时无法加载最近预约。'
  } finally {
    if (alive && ticket === choicesSequence) choicesLoading.value = false
  }
}

function changeReservation() {
  choosingReservation.value = true
  void loadChoices()
}

async function selectReservation(value) {
  if(locked.value) return
  const ticket=++contextSequence
  choosingReservation.value = false
  reservationId.value=value;context.value=null;contextError.value='';contextLoading.value=false
  let id
  try{id=positiveId(value)}catch{contextError.value='找不到这笔预约，请从我的预约重新进入。';return}
  if(!id)return
  reservationId.value=id
  contextLoading.value=true
  try{const response=await getReservation(id);if(alive&&ticket===contextSequence){if(response.data?.id!==id)throw new Error('预约上下文返回不完整');context.value=response.data}}
  catch(failure){if(alive&&ticket===contextSequence)contextError.value=failure.status===403?'只能为本人预约发起求助。':failure.status===404?'找不到这笔预约，请从我的预约重新进入。':'暂时无法加载这笔预约。'}
  finally{if(alive&&ticket===contextSequence)contextLoading.value=false}
}
function changeType(value) {
  if (locked.value || reservationFromEntry.value) return
  type.value = value
  void selectReservation(null)
  if (useReservation.value) changeReservation()
  else { choicesSequence++; choicesLoading.value = false }
}
async function refreshCreated() {
  if(!receipt.value)return
  const ticket=++readSequence,id=receipt.value.id
  reading.value=true;readError.value=''
  try{const response=await getComplaint(id);if(alive&&ticket===readSequence){if(response.data?.id!==id||!Array.isArray(response.data?.attachments)||!Array.isArray(response.data?.events))throw new Error('详情返回不完整');record.value=response.data}}
  catch{if(alive&&ticket===readSequence)readError.value='求助已提交，暂时无法加载详情。'}
  finally{if(alive&&ticket===readSequence)reading.value=false}
}
async function submit({ confirmed = false } = {}) {
  if(submitting.value||uploading.value||receipt.value)return
  error.value=''
  if(!uncertain.value){
    try{
      queue.refreshExpiry()
      if(contextLoading.value||contextError.value)throw new Error(contextError.value || '正在加载预约，请稍后提交。')
      const requestType = otherRequestType.value === customType ? customRequestType.value : otherRequestType.value
      const body=complaintPayload({type:type.value,description:description.value,reservationId:useReservation.value?reservationId.value:null,roomId:roomId.value,seatId:selectedSeat.value?.id,items:currentPhotos.value,context:context.value,serviceKind:serviceKind.value,repair:repair.value,unsafeArea:unsafeArea.value,otherRequestType:requestType})
      Object.assign(body, complaintVisibilityPayload(visibility.value, publicSummary.value))
      if (body.visibility === 'campus' && !confirmed) {
        previewOpen.value = true
        return
      }
      const signature=JSON.stringify(body)
      if(!frozenBody||signature!==fingerprint){frozenBody={...body,operation_id:crypto.randomUUID()};fingerprint=signature}
    }catch(failure){error.value=failure.message;return}
  }
  const ticket=scope
  submitting.value=true
  try{
    const response=await createComplaint(JSON.parse(JSON.stringify(frozenBody)))
    if(!alive||ticket!==scope)return
    const value=response.data
    if(!Number.isSafeInteger(value?.id) || value.id<=0 || value.operation_id!==frozenBody.operation_id || !(value.status==='submitted' || (value.replayed===true && Object.hasOwn(complaintStatuses,value.status))) || !Array.isArray(value.attachments) || !Array.isArray(value.events) || value.attachment_count!==frozenBody.attachment_ids.length || value.attachments.length!==frozenBody.attachment_ids.length || value.attachments.some(item=>!frozenBody.attachment_ids.includes(item.id)))throw new Error('提交回执不完整，结果需以原操作ID核对')
    uncertain.value=false;receipt.value=value;record.value=null
    emit('created',value.id)
    await refreshCreated()
  } catch (failure) {
    if (!alive || ticket !== scope) return
    uncertain.value = failure.status == null || failure.status === 408 || failure.status >= 500
    if (uncertain.value) {
      error.value = '暂时无法确认是否已提交。你的文字和图片已保留。'
    } else if ([404, 409].includes(failure.status) && frozenBody.attachment_ids.length) {
      const expired = expiredCount.value
      await queue.checkAvailablePhotos(getComplaintAttachment)
      if (!alive || ticket !== scope) return
      error.value = expiredCount.value > expired ? '有照片已失效，可以重新上传，也可以直接提交其余内容。' : '这次求助未提交，请核对预约和照片后重试。'
    } else {
      error.value = failure.status === 403 && useReservation.value ? '只能为本人预约发起求助。' : failure.message
    }
  }
  finally{if(alive&&ticket===scope)submitting.value=false}
}
function confirmSubmission() {
  if (!previewOpen.value) return
  previewOpen.value = false
  return submit({ confirmed: true })
}
function reset() {if(submitting.value||uncertain.value)return;scope++;readSequence++;receipt.value=null;record.value=null;readError.value='';description.value='';selectedVisibility.value=null;publicSummary.value='';queue.reset();frozenBody=null;fingerprint='';error.value='';applyInitial()}
function applyInitial() {
  if(locked.value)return
  scope++
  choicesSequence++
  choicesLoading.value = false
  seatDialog.value = false
  previewOpen.value = false
  type.value = reservationFromEntry.value ? 'occupation' : props.initialType || 'service'
  void selectReservation(reservationFromEntry.value ? props.initialReservationId : null)
  if (useReservation.value && !reservationFromEntry.value) changeReservation()
}
watch(()=>[props.initialType,props.initialReservationId],applyInitial,{immediate:true})
onMounted(()=>{void loadRooms()})
onBeforeUnmount(()=>{queue.dispose();alive=false;scope++;choicesSequence++;contextSequence++;readSequence++;seatSequence++})
</script>
<template>
  <section class="card complaint-form">
    <template v-if="!receipt"><h3>新建求助</h3>
      <SBanner v-if="error" type="error" :title="error" />
      <form class="fields" @submit.prevent="submit">
        <label v-if="!reservationFromEntry">事项类型<SSelect :model-value="type" :options="typeOptions" :disabled="locked" @update:model-value="changeType" /></label>
        <template v-if="type==='service'">
          <label>具体类型<SSelect v-model="serviceKind" :options="serviceKindOptions" :disabled="locked" /></label>
          <template v-if="serviceKind==='facility'">
            <div class="field-grid">
              <label>故障类型<SSelect v-model="repair.faultType" :options="faultTypeOptions" :disabled="locked" placeholder="请选择故障类型" /></label>
              <label>影响范围<SSelect v-model="repair.impactScope" :options="impactOptions" :disabled="locked" placeholder="请选择实际影响范围" /></label>
            </div>
            <label>安全风险<SSelect v-model="repair.safetyRisk" :options="safetyOptions" :disabled="locked" /></label>
            <label>区域安全使用情况<SSelect v-model="unsafeArea" :options="unsafeAreaOptions" :disabled="locked" /></label>
            <div v-if="priorityPreview" class="priority-preview">
              <div class="priority-head"><span>报修优先级</span><b>{{ priorityPreview }}级</b></div>
              <p>{{ priorityPreviewText }}</p>
            </div>
          </template>
          <template v-else>
            <label>问题类型<SSelect v-model="otherRequestType" :options="otherRequestOptions" :disabled="locked" placeholder="请选择问题类型" /></label>
            <label v-if="otherRequestType === customType">自定义类型<SInput v-model="customRequestType" maxlength="100" :disabled="locked" /></label>
          </template>
        </template>
        <section v-if="useReservation" class="reservation-field" aria-label="关联预约">
          <div class="reservation-heading">
            <span>关联预约</span>
            <RouterLink v-if="!reservationFromEntry || contextError" :to="{ name: 'mine' }" class="form-link">查看我的预约</RouterLink>
          </div>
          <p v-if="contextLoading" role="status">正在加载预约…</p>
          <div v-if="contextError" class="actions">
            <p role="alert">{{ contextError }}</p>
            <SButton size="sm" :disabled="locked" @click="selectReservation(reservationId)">重试</SButton>
          </div>
          <div v-if="context" class="context reservation-context">
            <div>
              <strong>{{ context.room_name }} · 座位 {{ context.seat_no }}</strong>
              <p>{{ reservationSlot(context) }} · {{ reservationStatuses[context.status] || context.status }}</p>
              <p v-if="(roomId && roomId !== context.room_id) || (selectedSeat && selectedSeat.id !== context.seat_id)">地点以这笔预约为准。</p>
            </div>
            <div v-if="!reservationFromEntry" class="actions">
              <SButton size="sm" :disabled="locked || choosingReservation" @click="changeReservation">更换</SButton>
              <SButton size="sm" variant="ghost" :disabled="locked" @click="selectReservation(null)">取消关联</SButton>
            </div>
          </div>
          <div v-if="!reservationFromEntry && choosingReservation" class="reservation-choices">
            <p v-if="choicesLoading" role="status">正在加载最近预约…</p>
            <div v-else-if="choicesError" class="actions">
              <p role="alert">{{ choicesError }}</p>
              <SButton size="sm" :disabled="locked" @click="loadChoices">重试</SButton>
            </div>
            <p v-else-if="!choices.length" class="muted">还没有预约记录。</p>
            <SButton v-for="row in choices" v-else :key="row.id" class="reservation-choice" size="sm" :disabled="locked || row.id === context?.id" @click="selectReservation(row.id)">
              {{ row.room_name }} · {{ row.seat_no }} · {{ reservationSlot(row) }} · {{ reservationStatuses[row.status] || row.status }}
            </SButton>
          </div>
          <SButton v-else-if="!reservationFromEntry && !context && !contextLoading" size="sm" class="reservation-select" :disabled="locked" @click="changeReservation">选择预约</SButton>
        </section>
        <template v-else>
          <label>问题地点<SSelect :model-value="roomId" :options="roomOptions" :disabled="locked" @update:model-value="changeRoom" /></label>
          <p v-if="roomsLoading" role="status">正在加载地点…</p>
          <p v-if="roomsError" role="alert">暂时无法加载地点。 <SButton size="sm" :disabled="locked" @click="loadRooms">重新加载地点</SButton></p>
          <div v-if="roomId" class="actions">
            <span v-if="selectedSeat">座位 {{ selectedSeat.seat_no }}</span>
            <SButton size="sm" :disabled="locked" @click="openSeatDialog">{{ selectedSeat ? '更换座位' : '从座位图选座（选填）' }}</SButton>
            <SButton v-if="selectedSeat" size="sm" variant="ghost" :disabled="locked" @click="chooseSeat(null)">取消座位</SButton>
          </div>
        </template>
        <label>情况说明<SInput v-model="description" type="textarea" :rows="5" required maxlength="2000" :disabled="locked" placeholder="请描述遇到的问题" /></label>
        <p class="muted">{{ description.trim().length }}/2000字</p>
        <ComplaintVisibilityFields :visibility="visibility" v-model:summary="publicSummary" v-model:preview-open="previewOpen"
          :room-name="previewRoom" :disabled="locked" confirm-label="确认公开并提交" @update:visibility="selectedVisibility = $event" @confirm="confirmSubmission" />
        <p v-if="type==='service'&&serviceKind==='other'&&currentPhotos.length" class="muted">移除已选照片后即可提交此类求助。</p>
        <EvidenceUploadQueue v-if="type==='occupation'||serviceKind==='facility'||items.length" :items="items" :disabled="locked" :upload-disabled="type==='service'&&serviceKind==='other'" :uploading="uploading" complaint-privacy @select="selectFiles" @retry="uploadItem" @remove="removeItem" />
        <div class="submit-actions">
          <p v-if="expiredCount" role="status" class="muted">{{ expiredCount }} 张照片已失效</p>
          <SButton type="submit" variant="primary" :loading="submitting" :disabled="uploading || (!uncertain && hasUnfinishedPhotos)">{{ uncertain ? '确认提交结果' : visibility === 'campus' ? '预览并提交' : '提交求助' }}</SButton>
        </div>
      </form>
    </template>
    <template v-else>
      <SBanner type="success" :title="`${complaintNumber(receipt.id)} 已提交，${complaintStatuses[receipt.status] || receipt.status}`" />
      <SBanner v-if="pendingCheckin" type="info" :title="`请于 ${pendingCheckin.text} 前签到`">
        <RouterLink :to="{ name: 'checkin', params: { id: context.id } }">前往签到</RouterLink>
      </SBanner>
      <p v-if="reading" role="status">正在加载详情…</p>
      <SBanner v-if="readError" type="error" :title="readError"><SButton :loading="reading" @click="refreshCreated">重新加载详情</SButton></SBanner>
      <ComplaintRecord :record="record || receipt" compact />
      <div class="actions">
        <RouterLink :to="`/complaints/${receipt.id}`">查看处理进度</RouterLink>
        <SButton :disabled="reading" @click="reset">新建求助</SButton>
      </div>
    </template>
    <SDialog v-model="seatDialog" title="选择问题所在座位" width="640px">
      <p v-if="seatsLoading" role="status">正在加载座位图…</p>
      <SBanner v-else-if="seatsError" type="error" :title="seatsError"><SButton size="sm" @click="openSeatDialog">重试</SButton></SBanner>
      <div v-else-if="roomSeats.length" class="location-map-scroll">
        <div class="location-map" :style="{ '--seat-columns': seatColumns }" aria-label="房间座位图">
          <SButton v-for="seat in roomSeats" :key="seat.id" size="sm" :variant="selectedSeat?.id === seat.id ? 'primary' : 'secondary'"
            :aria-label="`座位 ${seat.seat_no}`" :aria-pressed="selectedSeat?.id === seat.id" :style="{ gridRow: seat.row_no, gridColumn: seat.col_no }" @click="chooseSeat(seat)">{{ seat.seat_no }}</SButton>
        </div>
      </div>
      <p v-else class="muted">该空间没有可选座位。</p>
    </SDialog>
  </section>
</template>
<style scoped>.complaint-form,.fields{display:grid;gap:14px;min-width:0}.fields label{display:grid;gap:7px;font-size:var(--fs-caption)}.fields input[type=file]{max-width:100%;min-width:0}.context,.file-item{padding:12px;background:var(--surface-2);border-radius:var(--r-md);overflow-wrap:anywhere}.actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.field-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.reservation-field,.reservation-choices{display:grid;gap:8px;min-width:0}
.reservation-heading,.reservation-context{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.reservation-heading,.reservation-context p{font-size:var(--fs-caption);color:var(--text-2)}
.reservation-context p{margin:4px 0 0}
.reservation-select{justify-self:start}
.submit-actions{display:grid;gap:6px}
.location-map-scroll{overflow:auto}
.location-map{display:grid;grid-template-columns:repeat(var(--seat-columns),minmax(52px,1fr));gap:8px;padding:4px;min-width:max-content}
.reservation-choice{justify-content:flex-start;text-align:left;white-space:normal;height:auto;min-height:28px;padding-block:5px}
.form-link{color:var(--primary);text-decoration:none;font-weight:600}
.form-link:hover,.form-link:focus-visible{text-decoration:underline}
.priority-preview{padding:14px 16px;border-radius:var(--r-md);background:var(--primary-faint);border:1px solid var(--primary-weak)}
.priority-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;color:var(--text-2);font-size:var(--fs-caption)}
.priority-head b{font-family:var(--font-display);font-size:26px;color:var(--primary);line-height:1}
.priority-preview p{margin-top:6px;color:var(--text-1);font-size:var(--fs-body-sm)}
@media(max-width:620px){.field-grid{grid-template-columns:1fr}}</style>
