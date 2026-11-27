<script setup>
import { formatCampusDateTime } from '../composables/campusDateTime.js'
import {violationLabels} from '../composables/appealForm.js'
defineProps({items:{type:Array,required:true},preview:{type:Boolean,default:false}})
const outcomes={released:'本次已解除原有效批次',retained:'原批次保留',expired_recorded:'原批次已到期，仅记录重算',released_recorded:'原批次已解除，仅记录重算'}
const previewOutcomes={released:'将解除原有效批次',retained:'将保留原批次',expired_recorded:'原批次已到期，将仅记录重算',released_recorded:'原批次已解除，将仅记录重算'}
const state=value=>({active:'有效',revoked:'已撤销',expired:'已到期',released:'已解除'})[value]||value
function completeSources(item) {
  const sources = item.source_violations
  if (!Array.isArray(sources)) return false
  const validIds = sources.every(source => Number.isSafeInteger(source?.id) && source.id > 0) &&
    new Set(sources.map(source => source.id)).size === sources.length
  if (item.policy_version === 'credit_round_v1') {
    return validIds && item.threshold === 2 && sources.length >= item.threshold
  }
  return validIds && item.threshold === 3 && sources.length === item.threshold
}
</script>
<template>
  <section class="recalculation-summary">
    <p v-if="!items.length">本次无关联原自动限制批次需要重算。</p>
    <article v-for="item in items" :key="item.restriction_id">
      <h4>原自动批次#{{ item.restriction_id }} · {{ (preview ? previewOutcomes : outcomes)[item.outcome] || item.outcome }}</h4>
      <p>本次处置前{{ state(item.status_before) }} → {{ preview ? '预计处置后' : '处置后' }}{{ state(item.status_after) }}；{{ item.policy_version === 'credit_round_v1' ? '本轮有效违规' : '原条件下有效来源' }}{{ item.valid_count_before }} → {{ item.valid_count_after }}条，阈值{{ item.threshold }}条。</p>
      <p>原评估：{{ formatCampusDateTime(item.evaluated_at) }}；原窗口：{{ formatCampusDateTime(item.window_start) }} — {{ formatCampusDateTime(item.window_end) }}；原限制：{{ formatCampusDateTime(item.starts_at) }} — {{ formatCampusDateTime(item.ends_at) }}（Asia/Shanghai）。</p>
      <p v-if="item.policy_version === 'credit_round_v1'">本轮重算包含停约期间登记的违规，保留限制时沿用原截止时刻。</p>
      <p v-if="!completeSources(item)" role="alert">重算来源数据不完整，请刷新核对。</p>
      <ol v-if="Array.isArray(item.source_violations)">
        <li v-for="(source, index) in item.source_violations" :key="source?.id || 'missing-' + index">
          <template v-if="source">
            <p>违规#{{ source.id }} · {{ violationLabels[source.type] || source.type }} · 审核前{{ state(source.status) }} → {{ preview ? '预计审核后' : '审核后' }}{{ state(source.status_after) }}</p>
            <p>发生{{ formatCampusDateTime(source.occurred_at) }}；登记{{ formatCampusDateTime(source.registered_at) }}</p>
            <p class="reason">公开事实依据：{{ source.reason }}</p>
            <p v-if="source.source==='manual'">关联预约涉及他人，不公开编号</p>
            <p v-else-if="source.reservation_id">本人预约#{{ source.reservation_id }}</p>
          </template>
          <p v-else>来源记录缺失，请刷新核对。</p>
        </li>
      </ol>
    </article>
    <p v-if="items.length">已结束的预约和使用记录保留原状态。</p>
  </section>
</template>
<style scoped>.recalculation-summary,.recalculation-summary article{display:grid;gap:9px;min-width:0;overflow-wrap:anywhere}.recalculation-summary article{padding:12px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--r-md)}.recalculation-summary ol{display:grid;gap:8px;padding-left:22px}.reason{white-space:pre-wrap}</style>
