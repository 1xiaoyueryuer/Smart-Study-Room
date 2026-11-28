<script setup>
import { computed, ref, watch } from 'vue'
import { getAppealEligibility } from '../api/appeal'
import { validAppealEligibility, violationLabels } from '../composables/appealForm.js'
import { formatCampusDateTime } from '../composables/campusDateTime.js'
import SBanner from './ui/SBanner.vue'

const props = defineProps({
  records: { type: Array, required: true },
  checkedAt: { type: String, default: '' }
})
const expanded = ref(false)
const appealStatus = ref({})
const violations = computed(() => {
  const unique = new Map()
  for (const record of props.records) {
    for (const item of record.violations || record.automatic_evaluation?.source_violations || []) {
      if (Number.isSafeInteger(item?.id) && item.id > 0) unique.set(item.id, item)
    }
  }
  return [...unique.values()].sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
})
const visibleViolations = computed(() => violations.value.slice(0, 3))
const latestEnd = computed(() => props.records.reduce((latest, { ends_at }) =>
  Number.isFinite(Date.parse(ends_at)) && (!latest || Date.parse(ends_at) > Date.parse(latest)) ? ends_at : latest, ''))
const violationList = { name: 'profile', hash: '#violations' }
const publicReasons = computed(() => [...new Set(props.records.map(record =>
  record.reason?.trim().replace(/有效违规/g, '违规')).filter(Boolean))])
const summaryReason = computed(() => {
  if (publicReasons.value.length !== 1) return ''
  const [reason] = publicReasons.value
  const characters = [...reason]
  return characters.length <= 25 ? reason : `${characters.slice(0, 24).join('')}…`
})
const showFullReasons = computed(() => publicReasons.value.some(reason => reason !== summaryReason.value))

function minute(value) {
  const formatted = formatCampusDateTime(value)
  return formatted === '—' ? formatted : formatted.slice(5, 16)
}

function appealLabel(item) {
  const status = appealStatus.value[item.id]
  if (status === undefined) return '正在查询申诉状态…'
  if (status === null) return '暂时无法查询申诉状态'
  if (status.can_submit) return '可申诉'
  return ({
    pending: '审核中',
    revoked: '违规已撤销',
    deadline_passed: '申诉已截止',
    before_notification: '申诉尚未开放'
  })[status.blocked_by] || '当前无法申诉'
}

watch([expanded, () => visibleViolations.value.map(item => item.id).join(','), () => props.checkedAt],
  async ([open], _, onCleanup) => {
    if (!open) return
    let current = true
    onCleanup(() => { current = false })
    const statuses = await Promise.all(visibleViolations.value.map(async ({ id }) => {
      try {
        const { data } = await getAppealEligibility(id)
        return [id, validAppealEligibility(data, id) ? data.eligibility : null]
      } catch {
        return [id, null]
      }
    }))
    if (current) appealStatus.value = Object.fromEntries(statuses)
  })
</script>

<template>
  <SBanner type="warning" :title="latestEnd ? `你在 ${minute(latestEnd)} 前不能预约新座位` : '你暂时不能预约新座位'">
    <div class="restriction-notice">
      <p v-if="summaryReason">{{ summaryReason }}</p>
      <p v-if="records.length > 1">共 {{ records.length }} 条限制</p>
      <div class="restriction-actions"><RouterLink :to="violationList">查看违规记录</RouterLink></div>
      <details v-if="visibleViolations.length || showFullReasons" @toggle="expanded = $event.target.open">
        <summary>查看限制详情</summary>
        <ul v-if="expanded && showFullReasons">
          <li v-for="reason in publicReasons" :key="reason">{{ reason }}</li>
        </ul>
        <ul v-if="expanded && visibleViolations.length" class="restriction-violations">
          <li v-for="item in visibleViolations" :key="item.id">
            <span>{{ violationLabels[item.type] || '违规记录' }} · {{ minute(item.occurred_at) }}</span>
            <span>{{ appealLabel(item) }}</span>
            <RouterLink v-if="appealStatus[item.id]?.can_submit" :to="{ path: '/appeals/new', query: { violation_id: item.id } }">申诉</RouterLink>
            <RouterLink v-else-if="appealStatus[item.id]?.existing_appeal?.id" :to="`/appeals/${appealStatus[item.id].existing_appeal.id}`">查看进度</RouterLink>
          </li>
        </ul>
        <RouterLink v-if="expanded && violations.length > visibleViolations.length" :to="violationList">查看全部违规</RouterLink>
      </details>
    </div>
  </SBanner>
</template>

<style scoped>
.restriction-notice { display: grid; gap: 4px; }
.restriction-notice p, .restriction-notice ul { margin: 0; }
.restriction-notice summary { cursor: pointer; }
.restriction-notice a { color: inherit; font-weight: 600; text-underline-offset: 3px; }
.restriction-violations { padding: 5px 0 0; list-style: none; }
.restriction-violations li { display: flex; flex-wrap: wrap; gap: 2px 12px; }
</style>
