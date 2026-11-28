<script setup>
import { formatCampusDateTime } from '../../composables/campusDateTime.js'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { listRoomSeats, listUsers } from '../../api/admin'
import { getRooms } from '../../api/room'
import {listAdminReservations,getAdminReservation} from '../../api/reservation'
import {listAdminViolations} from '../../api/violation'
import {createRecordPager,recordFields} from '../../composables/recordPage.js'
import {reservationStatuses} from '../../composables/complaintForm.js'
import {violationLabels} from '../../composables/appealForm.js'
import RecordFilters from '../RecordFilters.vue'
import RecordPageControls from '../RecordPageControls.vue'
import UsageRecordSummary from '../UsageRecordSummary.vue'
import SButton from '../ui/SButton.vue'
import SBanner from '../ui/SBanner.vue'
import SEmpty from '../ui/SEmpty.vue'
import SDialog from '../ui/SDialog.vue'
const props=defineProps({kind:{type:String,required:true}}),emit=defineEmits(['correct'])
const reservation=props.kind==='reservation',baseFields=recordFields(props.kind,true),pager=createRecordPager(reservation?listAdminReservations:listAdminViolations,{initial:reservation?{record_type:'reservation'}:{}})
const violationStatuses={active:'有效',revoked:'已撤销'}
const {items,filters,snapshot,snapshotQuery,loading,error}=pager,detail=ref(null),detailError=ref(''),selected=ref(null),detailLoading=ref(false);let alive=true,ticket=0
const roomOptions = ref([])
const seatOptions = ref([])
const userOptions = ref([])
const optionErrors = ref({})
const seatsLoading = ref(false)
let optionTicket = 0
let seatTicket = 0
const fields = computed(() => baseFields.map(field => {
  if (field.key === 'user_id') return {
    ...field, label: '校园账号', options: [{ value: '', label: '全部账号' }, ...userOptions.value], searchable: true
  }
  if (field.key === 'room_id') return {
    ...field, label: '自习室', options: [{ value: '', label: '全部自习室' }, ...roomOptions.value]
  }
  if (field.key === 'seat_no') return {
    ...field, label: '座位', disabled: !filters.value.room_id || seatsLoading.value,
    options: [{ value: '', label: filters.value.room_id ? '全部座位' : '请先选择自习室' }, ...seatOptions.value],
    searchable: true
  }
  return field
}))

async function loadFilterOptions() {
  const request = ++optionTicket
  optionErrors.value = {}
  const [users, rooms] = await Promise.allSettled([listUsers(), reservation ? getRooms() : []])
  if (!alive || request !== optionTicket) return
  if (users.status === 'fulfilled') userOptions.value = users.value.data.map(user => ({
    value: user.id,
    label: [user.real_name, user.campus_id || user.username].filter(Boolean).join(' · '),
    searchText: user.username
  }))
  else optionErrors.value.users = '校园账号选项加载失败'
  if (reservation) {
    if (rooms.status === 'fulfilled') roomOptions.value = rooms.value.data.map(room => ({ value: room.id, label: room.name }))
    else optionErrors.value.rooms = '自习室选项加载失败'
  }
}

async function loadSeats(roomId = filters.value.room_id) {
  const request = ++seatTicket
  seatOptions.value = []
  optionErrors.value.seats = ''
  seatsLoading.value = Boolean(roomId)
  if (!roomId) return
  try {
    const { data } = await listRoomSeats(roomId)
    if (!alive || request !== seatTicket) return
    seatOptions.value = data.seats.map(seat => ({ value: seat.seat_no, label: seat.seat_no }))
  } catch {
    if (alive && request === seatTicket) optionErrors.value.seats = '座位选项加载失败'
  } finally {
    if (alive && request === seatTicket) seatsLoading.value = false
  }
}
if (reservation) watch(() => filters.value.room_id, roomId => {
  filters.value = { ...filters.value, seat_no: '' }
  void loadSeats(roomId)
})

async function open(id){const current=++ticket;selected.value=id;detailLoading.value=true;detailError.value='';detail.value=null;try{const {data}=await getAdminReservation(id);if(!alive||current!==ticket)return;if(data?.reservation?.id!==id)throw new Error('管理预约详情不完整');detail.value=data}catch(e){if(alive&&current===ticket)detailError.value=e.message}finally{if(alive&&current===ticket)detailLoading.value=false}}
function closeDetail(){ticket++;selected.value=null;detail.value=null;detailError.value='';detailLoading.value=false}
function startCorrection(){if(!detail.value?.can_correct)return;const id=selected.value;closeDetail();emit('correct',id)}
onMounted(() => { void pager.refresh(); void loadFilterOptions() })
onBeforeUnmount(()=>{alive=false;ticket++;pager.dispose()})
defineExpose({refresh:pager.refresh,open})
</script>
<template>
  <section class="admin-records">
    <section class="card">
      <div class="card-title-row"><h3>{{reservation?'预约与使用记录':'违规记录'}}</h3><SButton size="sm" :loading="loading" @click="pager.refresh()">刷新</SButton></div>
      <RecordFilters v-model="filters" :fields="fields" :disabled="loading" @apply="pager.apply"/>
      <SBanner v-if="optionErrors.rooms || optionErrors.users" type="warning" :title="[optionErrors.rooms, optionErrors.users].filter(Boolean).join('，')">
        <SButton size="sm" @click="loadFilterOptions">重试加载选项</SButton>
      </SBanner>
      <SBanner v-if="optionErrors.seats" type="warning" :title="optionErrors.seats">
        <SButton size="sm" @click="loadSeats()">重试加载座位</SButton>
      </SBanner>
      <SBanner v-if="error" type="error" :title="error"/>
      <p v-if="loading">正在读取真实记录…</p>
      <div class="record-box">
        <article v-for="item in items" :key="item.id">
          <template v-if="reservation">
            <h4>预约#{{item.id}} · {{item.real_name||item.username}} / {{item.username}}</h4>
            <p>{{item.res_date}} {{item.start_time}}—{{item.end_time}} · {{item.room_name}} / {{item.seat_no}} · {{reservationStatuses[item.status]||item.status}}</p>
            <UsageRecordSummary :record="item.usage_record"/>
            <SButton @click="open(item.id)">查看预约详情</SButton>
          </template>
          <template v-else>
            <h4>违规#{{item.id}} · {{violationLabels[item.type]||item.type}} · {{violationStatuses[item.status]||item.status}}</h4>
            <p>主体#{{item.subject?.id}} {{item.subject?.real_name||item.subject?.username}} / {{item.subject?.username}} / {{item.subject?.campus_id||'校园编号未登记'}}</p>
            <p>发生：{{ formatCampusDateTime(item.occurred_at) }}；登记：{{ formatCampusDateTime(item.registered_at) }}</p>
            <p class="content">{{item.reason}}</p>
            <p v-if="item.revocation">撤销：{{item.revocation.reason}} · {{ formatCampusDateTime(item.revocation.revoked_at) }}</p>
          </template>
        </article>
        <SEmpty v-if="snapshot&&!items.length&&!loading&&!error" description="该次查询无记录"/>
        <p v-else-if="!snapshot&&!loading&&!error">尚未读取记录。</p>
      </div>
      <RecordPageControls :snapshot="snapshot" :query="snapshotQuery" :fields="fields" :disabled="loading" @page="pager.turn"/>
    </section>
    <SDialog :model-value="!!selected" :title="selected?`管理预约#${selected}`:'管理预约'" width="720px" @update:model-value="value=>{if(!value)closeDetail()}">
      <SBanner v-if="detailError" type="error" :title="detailError"/>
      <p v-if="detailLoading">正在读取单条…</p>
      <template v-if="detail">
        <p>{{detail.reservation.room_name}} / {{detail.reservation.seat_no}} · {{reservationStatuses[detail.reservation.status]||detail.reservation.status}}</p>
        <p>{{detail.reservation.res_date}} {{detail.reservation.start_time}}—{{detail.reservation.end_time}}</p>
        <UsageRecordSummary :record="detail.reservation.usage_record"/>
        <p v-if="detail.can_correct">签到截止 {{ formatCampusDateTime(detail.deadline) }}，可核实补签。</p>
        <p v-else-if="detail.blocked_reason">{{ detail.blocked_reason }}</p>
      </template>
      <template #footer>
        <SButton @click="closeDetail">关闭</SButton>
        <SButton v-if="detail?.can_correct" variant="primary" @click="startCorrection">核实补签</SButton>
      </template>
    </SDialog>
  </section>
</template>
<style scoped>
.admin-records,.admin-records .card{display:grid;gap:18px;min-width:0;overflow-wrap:anywhere}
.record-box{border:1px solid var(--border);border-radius:var(--r-lg);padding:18px;display:grid;gap:16px;min-height:120px}
.admin-records article{display:grid;gap:14px;padding-bottom:16px;border-bottom:1px solid var(--hairline)}
.admin-records article:last-of-type{border-bottom:none;padding-bottom:0}
.content{white-space:pre-wrap}
</style>
