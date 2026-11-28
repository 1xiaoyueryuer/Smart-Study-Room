<script setup>
import { formatCampusDateTime } from '../composables/campusDateTime.js'
import { computed } from 'vue'
const props = defineProps({ record: { type: Object, default: null } })
const originLabels = { seat_code: '座位码签到', legacy: '历史记录', demo_seed: '演示记录（未实际到场）' }
const reasonLabels = { admin_resource_change: '资源管理取消', early_checkout: '提前签退', auto_end: '到期自动结束', temp_leave_timeout: '旧暂离流程结束（历史）', legacy_unclassified: '历史结束，具体方式未记录', demo_completed: '演示模拟结束' }
const durationText = computed(() => {
  const raw = props.record?.duration_seconds
  if (typeof raw !== 'number' && (typeof raw !== 'string' || !raw.trim())) return '时长未登记'
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) return '时长未登记'
  if (value > 0 && value < 1) return '不足 1 秒'
  const seconds = Math.floor(value)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds / 60) % 60
  const parts = []
  if (hours) parts.push(`${hours} 小时`)
  if (minutes) parts.push(`${minutes} 分钟`)
  if (seconds % 60 || !parts.length) parts.push(`${seconds % 60} 秒`)
  return parts.join(' ')
})
</script>
<template>
  <div class="usage-record">
    <template v-if="record">
      <div>签到：{{ record.checkin_at ? formatCampusDateTime(record.checkin_at) : '未登记' }}</div>
      <div>使用结束：{{ record.ended_at ? formatCampusDateTime(record.ended_at) : '尚未结束' }}</div>
      <div v-if="record.ended_at">结束原因：{{ reasonLabels[record.end_reason] || record.end_reason || '未登记' }}</div>
      <div>使用时长：{{ durationText }}<span v-if="!record.ended_at && record.observed_at">（截至 {{ formatCampusDateTime(record.observed_at) }}）</span></div>
      <div>记录来源：{{ record.origin==='admin_correction'?'管理员核实补签':originLabels[record.origin] || '未登记' }}</div>
      <template v-if="record.correction">
        <div>补签办理时间：{{ formatCampusDateTime(record.correction.operated_at) }} · {{ record.correction.actor_display_name }}</div>
        <div>补签说明：{{ record.correction.reason }}</div>
      </template>
      <details v-if="record.settled_at">
        <summary>查看结算时间</summary>
        <div>{{ formatCampusDateTime(record.settled_at) }}</div>
      </details>
    </template>
    <span v-else>尚无使用记录</span>
  </div>
</template>
<style scoped>
.usage-record{display:grid;gap:5px;font-size:var(--fs-caption);color:var(--text-2);overflow-wrap:anywhere;min-width:0}
</style>
