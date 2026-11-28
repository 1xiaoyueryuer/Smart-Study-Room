<script setup>
import {ref,onMounted,onBeforeUnmount} from 'vue'
import {listAuditEvents,getAuditEvent} from '../../api/audit'
import {createRecordPager} from '../../composables/recordPage.js'
import {offsetInstant} from '../../composables/restrictionForm.js'
import {formatCampusDateTime} from '../../composables/campusDateTime.js'
import RecordFilters from '../RecordFilters.vue'
import RecordPageControls from '../RecordPageControls.vue'
import SButton from '../ui/SButton.vue'
import SBanner from '../ui/SBanner.vue'
import SDialog from '../ui/SDialog.vue'

const actionNames = {
  'user.create': '创建校园账号', 'user.update': '维护校园账号', 'user.identity.normalize': '整理模拟校园账号',
  'user.import': '批量导入校园账号', 'user.contacts.update': '更新联系方式', 'user.password.change': '修改密码',
  'reservation.create': '创建预约', 'reservation.cancel': '开始前取消预约', 'reservation.unused_end': '登记未使用结束',
  'reservation.checkin': '座位码签到', 'reservation.correct_checkin': '核实补签', 'reservation.complete': '使用结束结算',
  'reservation.admin_cancel': '因场地调整取消预约', 'reservation.restriction_cancel': '因预约限制取消预约',
  'violation.register': '登记违规', 'violation.register_manual': '人工登记违规', 'violation.revoke': '撤销违规',
  'restriction.create': '登记限制', 'restriction.automatic_create': '自动生成预约限制', 'restriction.apply': '落实预约限制',
  'restriction.release': '解除预约限制', 'restriction.recalculate': '重新核算预约限制',
  'appeal.submit': '提交申诉', 'appeal.review': '审核申诉',
  'review.create': '发布评价', 'review.update': '修改评价', 'review.reply': '回复评价', 'review.hide': '隐藏评价',
  'room.create': '新增自习室', 'room.update': '修改自习室', 'room.delete': '删除自习室', 'room.seats.batch': '批量生成座位',
  'seat.create': '新增座位', 'seat.update': '修改座位', 'seat.delete': '删除座位',
  'opening.update': '更新开放安排', 'opening.exception.delete': '移除特殊日期安排',
  'unavailability.create': '新增停用时段', 'unavailability.update': '修改停用时段', 'unavailability.cancel': '取消停用时段',
  'seat_code.generate': '生成座位码', 'seat_code.batch_generate': '批量生成座位码',
  'seat_code.rotate': '更换座位码', 'seat_code.status': '调整座位码状态', 'resource_change.confirm': '确认资源变更',
  'complaint.submit': '提交求助或投诉', 'complaint.accept': '受理工单', 'complaint.service_progress': '更新工单进度',
  'complaint.verify': '记录工单核实结果', 'complaint.feedback': '发送处理反馈', 'complaint.visibility_change': '修改工单可见范围',
  'complaint.withdraw': '撤回工单', 'complaint.confirm': '确认处理结果', 'complaint.object': '退回工单重新核查',
  'complaint.target_overdue': '记录工单超时', 'complaint.auto_close': '工单自动结案',
  'complaint_attachment.upload': '上传工单照片', 'appeal_attachment.upload': '上传申诉材料',
  'evidence_attachment.cleanup': '清理临时材料'
}
const objectNames = {
  user: '校园账号', room: '自习室', seat: '座位', reservation: '预约', violation: '违规',
  restriction: '预约限制', appeal: '申诉', complaint: '求助与投诉', review: '使用评价',
  opening_schedule: '开放安排', seat_code: '座位码', user_batch: '账号导入', resource_unavailability: '停用时段',
  resource_change_operation: '资源变更', complaint_attachment: '工单照片', appeal_attachment: '申诉材料',
  temporary_material_batch: '临时材料'
}
const choices = (label, names) => [{value:'',label}, ...Object.entries(names).map(([value,label]) => ({value,label}))]
const fields = [
  {key:'date_from',label:'开始日期',type:'date'}, {key:'date_to',label:'结束日期',type:'date'},
  {key:'actor_search',label:'操作者（账号或姓名）'},
  {key:'object_type',label:'操作对象',options:choices('全部对象',objectNames)}, {key:'object_id',label:'对象编号'},
  {key:'action',label:'操作',options:choices('全部操作',actionNames)}
]
const actionText = value => Object.hasOwn(actionNames,value) ? actionNames[value] : '其他操作'
const objectText = value => Object.hasOwn(objectNames,value) ? objectNames[value] : '其他对象'
function actorText(item){return item.actor_id===null?'系统':item.actor_username||`账号 #${item.actor_id}`}
function validRedaction(value){return value&&['omitted_fields','truncated_values','redacted_values','omitted_items'].every(key=>Number.isSafeInteger(value[key])&&value[key]>=0)&&typeof value.notice==='string'&&!!value.notice}
function validMeta(value){return Number.isSafeInteger(value?.id)&&value.id>0&&(value.actor_id===null||Number.isSafeInteger(value.actor_id)&&value.actor_id>0)&&(value.actor_username===null||typeof value.actor_username==='string')&&validRedaction(value.redaction)&&typeof value.action==='string'&&typeof value.object_type==='string'&&typeof value.object_id==='string'&&typeof value.reason==='string'&&offsetInstant(value.occurred_at)!==null}
function safeObject(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)}
function queryForAudit(query){const result={...query};if(result.actor_id!==undefined){const text=String(result.actor_id);if(!/^[1-9]\d*$/.test(text)||!Number.isSafeInteger(Number(text)))throw new Error('操作者账号编号须为正整数');result.actor_id=Number(text)}return result}
const pager=createRecordPager(async query=>{const {data}=await listAuditEvents(queryForAudit(query));if(!Array.isArray(data?.items)||!data.items.every(validMeta))throw new Error('审计列表元数据不完整，请重试');return{data}})
const {items,loading,error,filters,snapshot,snapshotQuery}=pager
const selected=ref(null),detail=ref(null),detailLoading=ref(false),detailError=ref('');let alive=true,sequence=0
async function open(id,refresh=false){if(!Number.isSafeInteger(id)||id<1){detailError.value='审计编号须为正整数';return}if(!refresh&&selected.value===id){selected.value=null;detail.value=null;detailError.value='';sequence++;return}const ticket=++sequence;selected.value=id;detail.value=null;detailLoading.value=true;detailError.value='';try{const {data}=await getAuditEvent(id);if(!alive||ticket!==sequence)return;if(!validMeta(data)||data.id!==id||!safeObject(data.before_values)||!safeObject(data.after_values))throw new Error('审计详情安全投影不完整，请重试读取');detail.value=data}catch(e){if(alive&&ticket===sequence)detailError.value=e.message}finally{if(alive&&ticket===sequence)detailLoading.value=false}}
function closeDetail(){selected.value=null;detail.value=null;detailError.value='';sequence++}
function pretty(value){
  return JSON.stringify(value,(key,entry)=>{
    if (!/(?:_at|_deadline|_until|_now)$/.test(key) || typeof entry!=='string' ||
        !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(entry)) return entry
    const time = formatCampusDateTime(entry)
    return time==='—' ? entry : time
  },2)
}
onMounted(()=>pager.refresh());onBeforeUnmount(()=>{alive=false;sequence++;pager.dispose()});defineExpose({refresh:pager.refresh})
</script>
<template>
  <section class="audit-query">
    <section class="card">
      <h3>管理操作记录</h3>
      <RecordFilters v-model="filters" :fields="fields" :disabled="loading" split-dates @apply="pager.apply"/>
      <SBanner v-if="error" type="error" :title="error"/>
      <p v-if="loading" role="status">正在读取操作记录…</p>
      <p v-if="snapshot && !items.length && !loading && !error">没有符合条件的操作记录。</p>
      <article v-for="item in items" :key="item.id" class="audit-item">
        <header class="audit-item-head">
          <h4>{{ actionText(item.action) }}</h4>
          <b>{{ formatCampusDateTime(item.occurred_at) }}</b>
        </header>
        <div class="audit-meta">
          <p><span>操作者</span>{{ actorText(item) }}</p>
          <p><span>操作对象</span>{{ objectText(item.object_type) }} · {{ item.object_id }}</p>
        </div>
        <SButton size="sm" @click="open(item.id)">查看详情</SButton>
        <p v-if="item.reason" class="audit-reason"><b>操作理由</b>{{ item.reason }}</p>
      </article>
      <RecordPageControls :snapshot="snapshot" :query="snapshotQuery" :fields="fields" :disabled="loading" @page="pager.turn"/>
    </section>
    <SDialog :model-value="!!selected" title="操作详情" width="900px" @update:model-value="value => { if (!value) closeDetail() }">
      <p v-if="detailLoading" role="status">正在读取详情…</p>
      <SBanner v-if="detailError" type="error" :title="detailError"/>
      <div v-if="detail" class="audit-detail">
        <div class="audit-meta">
          <p><span>操作</span>{{ actionText(detail.action) }}</p>
          <p><span>操作者</span>{{ actorText(detail) }}</p>
          <p><span>操作时间</span>{{ formatCampusDateTime(detail.occurred_at) }}</p>
          <p><span>操作对象</span>{{ objectText(detail.object_type) }} · {{ detail.object_id }}</p>
        </div>
        <p v-if="detail.reason" class="audit-reason"><b>操作理由</b>{{ detail.reason }}</p>
        <details class="audit-redaction">
          <summary>查看变更记录</summary>
          <div class="audit-values-grid">
            <section><h4>操作前</h4><pre class="audit-values">{{ pretty(detail.before_values) }}</pre></section>
            <section><h4>操作后</h4><pre class="audit-values">{{ pretty(detail.after_values) }}</pre></section>
          </div>
          <p>记录编号 {{ detail.id }} · 操作 {{ detail.action }} · 对象 {{ detail.object_type }}</p>
          <p>省略字段{{ detail.redaction.omitted_fields }} · 截断值{{ detail.redaction.truncated_values }} · 脱敏值{{ detail.redaction.redacted_values }} · 省略数组项{{ detail.redaction.omitted_items }}</p>
          <p>{{ detail.redaction.notice }}</p>
        </details>
      </div>
    </SDialog>
  </section>
</template>
<style scoped>.audit-query,.audit-query .card,.audit-detail{display:grid;gap:16px;min-width:0;overflow-wrap:anywhere}.audit-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px 18px;align-items:start;padding:16px;border:1px solid var(--border-strong);border-radius:var(--r-lg);background:var(--surface-2)}.audit-item-head{grid-column:1/-1;display:flex;align-items:baseline;justify-content:space-between;gap:14px;flex-wrap:wrap}.audit-item-head h4,.audit-item-head b{margin:0}.audit-item-head b{color:var(--text-2);font-size:var(--fs-caption)}.audit-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:8px 18px;min-width:0}.audit-meta p{display:grid;gap:3px;margin:0;overflow-wrap:anywhere}.audit-meta span{font-size:var(--fs-caption);color:var(--text-3)}.audit-reason{grid-column:1/-1;display:grid;gap:5px;margin:0;padding:10px 12px;background:var(--surface);border-radius:var(--r-md);white-space:pre-wrap;overflow-wrap:anywhere}.audit-redaction{grid-column:1/-1;color:var(--text-3);font-size:var(--fs-caption)}.audit-redaction summary{cursor:pointer}.audit-redaction p{margin:8px 0 0;overflow-wrap:anywhere}.audit-values-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.audit-values-grid section{min-width:0}.audit-values{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;max-width:100%;font-size:var(--fs-caption);padding:12px;background:var(--surface-2);border-radius:var(--r-md)}@media(max-width:680px){.audit-item{grid-template-columns:1fr}.audit-item-head,.audit-reason,.audit-redaction{grid-column:auto}.audit-values-grid{grid-template-columns:1fr}}</style>
