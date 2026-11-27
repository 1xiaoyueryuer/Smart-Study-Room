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
      <p class="record-source">{{ record.source==='legacy'?'历史剩余效力接管':record.source==='manual'?'管理员独立登记':record.source==='automatic'?'系统累计自动限制':record.source }}</p>
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
    <p v-if="record.legacy_remaining_only" class="record-source">这里只接管当时尚未结束的剩余效力；原处罚开始时刻和原原因未留存。</p>
    <component :is="collapseDetails ? 'details' : 'div'" class="record-details">
      <summary v-if="collapseDetails">限制详情</summary>
      <div class="record-detail-content">
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
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
}
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
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.record-summary > div { display: grid; gap: 3px; }
.record-reason { flex: 1 0 100%; }
.public-reason { white-space: pre-wrap; }
.record-time {
  flex: 1 0 min(100%, 152px);
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
</style>
