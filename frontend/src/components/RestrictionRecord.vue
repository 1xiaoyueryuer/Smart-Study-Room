<script setup>
import { formatCampusDateTime } from '../composables/campusDateTime.js'
import { restrictionStatuses } from '../composables/restrictionForm.js'
defineProps({record:{type:Object,required:true}})
const violationTypeLabels={abandon:'开始后主动放弃',no_show:'超时未签到',occupation_refusal:'核实拒不配合占座'}
function completeEvaluation(value) {
  if (!value) return false
  const { threshold, duration_hours, source_violations: sources } = value
  const validPolicy = value.policy_version === 'credit_round_v1'
    ? threshold === 2 && duration_hours === 360
    : threshold === 3 && duration_hours === 168
  const validTime = time => typeof time === 'string' && time.length > 0
  return validPolicy &&
    value.window_start_inclusive === true && value.window_end_inclusive === true &&
    [value.evaluated_at, value.window_start, value.window_end].every(validTime) &&
    Array.isArray(sources) && sources.length === threshold &&
    new Set(sources.map(item => item?.id)).size === threshold &&
    sources.every(item => item && Number.isSafeInteger(item.id) && item.id > 0 &&
      ['active', 'revoked'].includes(item.status) && validTime(item.occurred_at) && validTime(item.registered_at))
}
</script>
<template>
  <article class="restriction-record">
    <h4>限制#{{ record.id }} · {{ restrictionStatuses[record.status] || record.status }} · {{ record.source==='legacy'?'历史剩余效力接管':record.source==='manual'?'管理员独立登记':record.source==='automatic'?'系统累计自动限制':record.source }}</h4>
    <p class="public-reason">公开原因：{{ record.reason }}</p>
    <p>{{ record.legacy_remaining_only?'剩余效力接管起点':'生效起点' }}：{{ formatCampusDateTime(record.starts_at) }}；截止：{{ formatCampusDateTime(record.ends_at) }}（Asia/Shanghai）。</p>
    <p v-if="record.legacy_remaining_only">这里只接管当时尚未结束的剩余效力；原处罚开始时刻和原原因未留存。</p>
    <p>登记：{{ formatCampusDateTime(record.created_at) }}；{{ record.creator_display_name || (record.source==='automatic'?'系统累计评估':record.source==='legacy'?'历史余效接管，无原登记人依据':'登记人未提供') }}。</p>
    <section v-if="record.source==='automatic'" class="automatic-evaluation">
      <h5>本次累计评估记录</h5>
      <template v-if="record.automatic_evaluation">
        <p>本次评估时刻：{{ formatCampusDateTime(record.automatic_evaluation.evaluated_at) }}</p>
        <p>{{ record.automatic_evaluation.policy_version === 'credit_round_v1' ? '本轮判定区间' : '当时滚动窗口' }}：{{ formatCampusDateTime(record.automatic_evaluation.window_start) }} — {{ formatCampusDateTime(record.automatic_evaluation.window_end) }}<span v-if="record.automatic_evaluation.window_start_inclusive===true && record.automatic_evaluation.window_end_inclusive===true">（两端均含）</span>。</p>
        <p>
          本次触发门槛：{{ record.automatic_evaluation.threshold }} 条；限制时长：{{ record.automatic_evaluation.duration_hours }}小时<span v-if="record.automatic_evaluation.duration_hours === 168">（7×24小时）</span><span v-else-if="record.automatic_evaluation.duration_hours === 360">（15×24小时）</span>。
        </p>
      </template>
      <p v-if="!completeEvaluation(record.automatic_evaluation)" role="alert">本次评估记录或触发来源未完整返回，请刷新核对。</p>
      <ol v-if="Array.isArray(record.automatic_evaluation?.source_violations)">
        <li v-for="(item, index) in record.automatic_evaluation.source_violations" :key="item?.id || 'missing-' + index">
          <template v-if="item">
            <p>违规#{{ item.id }} · {{ violationTypeLabels[item.type] || item.type }} · {{ item.source==='manual'?'管理员核实后登记':item.source==='automatic'?'系统自动事件':item.source }} · 当前{{ item.status==='revoked'?'已撤销':item.status==='active'?'有效':item.status }}</p>
            <p>事实发生：{{ formatCampusDateTime(item.occurred_at) }}；原登记：{{ formatCampusDateTime(item.registered_at) }}</p>
            <p class="public-reason">公开事实依据：{{ item.reason }}</p>
            <p v-if="item.source==='manual'">关联预约涉及他人，不公开编号</p>
            <p v-else-if="item.reservation_id">本人预约#{{ item.reservation_id }}</p>
          </template>
          <p v-else>来源记录缺失，请刷新核对。</p>
        </li>
      </ol>
      <p>本次触发的来源关联永久保留。各条违规显示当前状态。</p>
    </section>
    <p v-if="record.effects_applied_at">预约处理实际执行：{{ formatCampusDateTime(record.effects_applied_at) }}。</p>
    <template v-if="record.released_at">
      <p class="public-reason">单条解除：{{ formatCampusDateTime(record.released_at) }} · {{ record.releaser_display_name || '解除人未提供' }}；公开解除原因：{{ record.release_reason }}</p>
      <p>已取消的预约仍保持取消。能否新预约以服务端核对的当前资格为准。</p>
    </template>
    <p>站内通知：{{ record.notified_at ? formatCampusDateTime(record.notified_at) : '未留存可靠通知生成时间' }}<span v-if="record.release_notified_at">；解除通知：{{ formatCampusDateTime(record.release_notified_at) }}</span>。</p>
  </article>
</template>
<style scoped>.restriction-record{display:grid;gap:8px;min-width:0;overflow-wrap:anywhere;padding:12px;border:1px solid var(--border);border-radius:var(--r-md);background:var(--surface-2)}.restriction-record h4,.restriction-record p{margin:0}.public-reason{white-space:pre-wrap}.automatic-evaluation{display:grid;gap:8px;padding-top:8px;border-top:1px solid var(--border)}.automatic-evaluation ol{margin:0;padding-left:22px;display:grid;gap:10px}.automatic-evaluation li{min-width:0}</style>
