<script setup>
import {ref,onBeforeUnmount} from 'vue'
import request from '../../api/request'
import {correctionIntent,validCorrectionDetail,validCorrectionReceipt} from '../../composables/checkinCorrection.js'
import UsageRecordSummary from '../UsageRecordSummary.vue'
import SInput from '../ui/SInput.vue'
import SButton from '../ui/SButton.vue'
import SDialog from '../ui/SDialog.vue'
import SBanner from '../ui/SBanner.vue'
const id=ref(''),detail=ref(null),busy=ref(false),error=ref(''),success=ref(''),dialog=ref(false),pending=ref(null),stale=ref(false)
const blank=now=>({checkin_at:now,reason:'',verification_note:'',facts_confirmed:false})
const form=ref(blank('')),drafts=new Map();let alive=true,sequence=0,selected=null
onBeforeUnmount(()=>{alive=false;sequence++;drafts.clear()})
function remember(){if(selected!==null)drafts.set(selected,JSON.parse(JSON.stringify(form.value)))}
async function load(){if(busy.value||pending.value)return;const target=Number(id.value);if(!Number.isSafeInteger(target)||target<1){error.value='请输入正整数预约编号';return}remember();const ticket=++sequence;selected=target;busy.value=true;error.value='';success.value='';detail.value=null;stale.value=false
 try{const {data}=await request.get(`/admin/reservations/${target}/checkin-correction`,{silent:true});if(!alive||ticket!==sequence)return;if(!validCorrectionDetail(data,target))throw new Error('管理预约详情不完整');detail.value=data;form.value=drafts.has(target)?JSON.parse(JSON.stringify(drafts.get(target))):blank(data.server_now)}
 catch(e){if(alive&&ticket===sequence)error.value=e.message}finally{if(alive&&ticket===sequence)busy.value=false}}
function preview(){error.value='';if(!detail.value?.can_correct||stale.value||busy.value||pending.value)return;try{correctionIntent(form.value);dialog.value=true}catch(e){error.value=e.message}}
async function submit(){if(busy.value)return;if(!pending.value){if(!detail.value?.can_correct||stale.value||!dialog.value)return;try{pending.value={id:detail.value.reservation.id,body:{...correctionIntent(form.value),operation_id:crypto.randomUUID()}}}catch(e){error.value=e.message;return}}const frozen=pending.value;const ticket=sequence;busy.value=true;error.value=''
 try{const {data}=await request.post(`/admin/reservations/${frozen.id}/correct-checkin`,frozen.body,{silent:true,timeout:120000});if(!alive||ticket!==sequence)return;if(!validCorrectionReceipt(data,frozen))throw new Error('回执不完整，请保持原请求核对');detail.value=data;pending.value=null;dialog.value=false;drafts.delete(frozen.id);form.value=blank('');success.value=`预约#${frozen.id}补签已保存；以真实使用记录为准。`}
 catch(e){if(!alive||ticket!==sequence)return;error.value=e.message;if(e.status>=400&&e.status<500){remember();pending.value=null;dialog.value=false;stale.value=true}}
 finally{if(alive&&ticket===sequence)busy.value=false}}
async function openReservation(value){if(busy.value||pending.value)return;id.value=String(value);await load()}
defineExpose({openReservation})
</script>
<template><section class="card correction"><h3>核实补签</h3><p>按预约编号查询；符合条件的待签到预约可补签。</p><form class="correction-query" @submit.prevent="load"><label>预约编号<SInput v-model="id" :disabled="busy||!!pending" inputmode="numeric" /></label><SButton type="submit" :disabled="busy||!!pending">查询管理详情</SButton></form><SBanner v-if="error" type="error" :title="error"/><SBanner v-if="success" type="success" :title="success"/>
<template v-if="detail"><h4>预约#{{detail.reservation.id}} · {{detail.reservation.username}} · {{detail.reservation.room_name}} / {{detail.reservation.seat_no}}</h4><p>{{detail.reservation.res_date}} {{detail.reservation.start_time}}—{{detail.reservation.end_time}} · {{detail.reservation.status}}</p><p>服务端核对：{{detail.server_now}}；原签到截止：{{detail.deadline}}</p><UsageRecordSummary :record="detail.reservation.usage_record"/><p v-if="detail.management_correction" class="reason">私有核实依据：{{detail.management_correction.correction_note}}</p><p v-if="!detail.can_correct">{{detail.blocked_reason}}</p>
<form v-else @submit.prevent="preview"><p v-if="stale">请求被拒绝，请重新查询。</p><label>签到时刻<SInput v-model="form.checkin_at" :disabled="busy||!!pending"/></label><label>公开补签理由<SInput v-model="form.reason" type="textarea" maxlength="1000" :disabled="busy||!!pending"/></label><label>私有核实依据<SInput v-model="form.verification_note" type="textarea" maxlength="2000" :disabled="busy||!!pending"/></label><label><span><input v-model="form.facts_confirmed" type="checkbox" :disabled="busy||!!pending"/>已核实事实与预约权利（自报）</span></label><SButton type="submit" :disabled="busy||!!pending||stale">核对补签内容</SButton></form></template>
<SDialog v-model="dialog" title="确认核实补签" :show-close="!busy&&!pending" :close-on-click-modal="!busy&&!pending" :close-on-escape="!busy&&!pending"><p>预约#{{pending?.id||detail?.reservation.id}}；业务签到：{{pending?.body.checkin_at||form.checkin_at}}</p><p class="reason">公开理由：{{pending?.body.reason||form.reason}}</p><p class="reason">私有核实依据：{{pending?.body.verification_note||form.verification_note}}</p><p>服务端记录时间，提交时重新校验；自报不等于现场核验。</p><p v-if="pending">结果待核对，可用原操作重试。</p><SBanner v-if="error" type="error" :title="error"/><template #footer><SButton v-if="!pending" :disabled="busy" @click="dialog=false">返回草稿</SButton><SButton variant="primary" :disabled="busy" @click="submit">{{pending?'按原请求核对':'确认补签'}}</SButton></template></SDialog></section></template>
<style scoped>.correction .correction-query{display:flex;align-items:flex-end;gap:12px}.correction .correction-query label{flex:1;min-width:0}.correction,.correction form,.correction label{display:grid;gap:12px;min-width:0;overflow-wrap:anywhere}.reason{white-space:pre-wrap}</style>
