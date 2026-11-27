<script setup>
import { formatCampusDateTime } from '../composables/campusDateTime.js'
import { restrictionStatuses } from '../composables/restrictionForm.js'
defineProps({
  record: { type: Object, required: true },
  collapseDetails: Boolean
})
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
    <header class="record-heading">
      <h4>限制 #{{ record.id }}</h4>
      <span class="record-status" :class="{ 'record-status--active': record.status === 'active' }">
        {{ restrictionStatuses[record.status] || record.status }}
      </span>
      <p class="record-source">{{ record.source==='legacy'?'历史限制（仅保留剩余期限）':record.source==='manual'?'管理员设置':record.source==='automatic'?'按违规次数自动暂停预约':record.source }}</p>
    </header>
    <dl class="record-summary">
      <div class="record-reason">
        <dt>公开原因</dt>
        <dd class="public-reason">{{ record.reason }}</dd>
      </div>
      <div class="record-time">
        <dt>{{ record.legacy_remaining_only ? '剩余效力接管起点' : '生效起点' }}</dt>
        <dd>{{ formatCampusDateTime(record.starts_at) }}</dd>
      </div>
      <div class="record-time">
        <dt>截止时间</dt>
        <dd>{{ formatCampusDateTime(record.ends_at) }}</dd>
      </div>
    </dl>
    <p v-if="record.legacy_remaining_only" class="record-source">这里只保留当时尚未结束的限制期限；原开始时间和原因未记录。</p>
    <component :is="collapseDetails ? 'details' : 'div'" class="record-details">
      <summary v-if="collapseDetails">限制详情</summary>
      <div class="record-detail-content">
        <p>记录时间：{{ formatCampusDateTime(record.created_at) }}；{{ record.creator_display_name || (record.source==='automatic'?'系统自动记录':record.source==='legacy'?'历史记录':'未注明记录人') }}。</p>
        <section v-if="record.source==='automatic'" class="automatic-evaluation">
          <h5>触发限制的违规记录</h5>
          <template v-if="record.automatic_evaluation">
            <p>限制判定时间：{{ formatCampusDateTime(record.automatic_evaluation.evaluated_at) }}</p>
            <p>核对的违规时间范围：{{ formatCampusDateTime(record.automatic_evaluation.window_start) }} — {{ formatCampusDateTime(record.automatic_evaluation.window_end) }}<span v-if="record.automatic_evaluation.window_start_inclusive===true && record.automatic_evaluation.window_end_inclusive===true">（起止时刻均计入）</span>。</p>
            <p>
              触发条件：{{ record.automatic_evaluation.threshold }} 次有效违规；暂停新预约 {{ record.automatic_evaluation.duration_hours }} 小时<span v-if="record.automatic_evaluation.duration_hours === 168">（7天）</span><span v-else-if="record.automatic_evaluation.duration_hours === 360">（15天）</span>。
            </p>
          </template>
          <p v-if="!completeEvaluation(record.automatic_evaluation)" role="alert">限制记录信息不完整，请刷新后重试。</p>
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
        </section>
        <p v-if="record.effects_applied_at">预约调整时间：{{ formatCampusDateTime(record.effects_applied_at) }}。</p>
        <template v-if="record.released_at">
          <p class="public-reason">单条解除：{{ formatCampusDateTime(record.released_at) }} · {{ record.releaser_display_name || '解除人未提供' }}；公开解除原因：{{ record.release_reason }}</p>
          <p>已取消的预约仍保持取消。能否新预约以服务端核对的当前资格为准。</p>
        </template>
        <p>通知时间：{{ record.notified_at ? formatCampusDateTime(record.notified_at) : '未记录' }}<span v-if="record.release_notified_at">；解除通知：{{ formatCampusDateTime(record.release_notified_at) }}</span>。</p>
      </div>
    </component>
  </article>
</template>
<style scoped>
.restriction-record {
  display: grid;
  gap: 12px;
  min-width: 0;
  padding: 14px;
  overflow-wrap: anywhere;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--surface-2);
}
.record-heading {
  display: grid;
  grid-template-columns: max-content max-content;
  justify-content: start;
  align-items: center;
  gap: 6px 10px;
}
.record-heading h4 { font-size: 18px; }
.record-heading .record-source { grid-column: 1 / -1; }
.restriction-record :is(h4, h5, p, dl, dd) { margin: 0; }
.record-status {
  padding: 2px 8px;
  border-radius: var(--r-full);
  background: var(--surface-3);
  color: var(--text-2);
  font-size: var(--fs-caption);
  font-weight: 600;
}
.record-status--active {
  background: var(--amber-weak);
  color: var(--amber-strong);
}
.record-source,
.record-summary dt {
  color: var(--text-2);
  font-size: var(--fs-caption);
}
.record-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.record-summary > div { display: grid; gap: 3px; }
.record-reason { grid-column: 1 / -1; }
.public-reason { white-space: pre-wrap; }
.record-time {
  min-width: 0;
  padding: 7px 10px;
  border-radius: var(--r-sm);
  background: var(--surface-3);
  font-variant-numeric: tabular-nums;
}
.record-details { border-top: 1px solid var(--border); }
.record-details > summary {
  width: fit-content;
  padding-top: 8px;
  color: var(--primary);
  font-weight: 600;
  cursor: pointer;
}
.record-detail-content {
  display: grid;
  gap: 10px;
  padding-top: 10px;
  color: var(--text-2);
}
.automatic-evaluation {
  display: grid;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.automatic-evaluation ol {
  display: grid;
  gap: 10px;
  margin: 0;
  padding-inline-start: 22px;
}
.automatic-evaluation li {
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--surface);
}
@media (max-width: 560px) {
  .record-summary { grid-template-columns: minmax(0, 1fr); }
  .record-reason { grid-column: auto; }
}
</style>
