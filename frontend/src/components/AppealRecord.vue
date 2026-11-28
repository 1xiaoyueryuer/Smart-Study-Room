<script setup>
import { formatCampusDateTime } from '../composables/campusDateTime.js'
import AppealRecalculationSummary from './AppealRecalculationSummary.vue'
import RestrictionRecord from './RestrictionRecord.vue'
import {eligibilityText} from '../composables/restrictionForm.js'
import ProtectedAttachment from './ProtectedAttachment.vue'
import {getAppealAttachment} from '../api/appeal'
import {violationLabels,appealStatuses} from '../composables/appealForm.js'
defineProps({record:{type:Object,required:true}})
</script>
<template>
  <section class="appeal-record">
    <h3>申诉 #{{ record.id }} · {{ appealStatuses[record.status] || record.status }}</h3>
    <p>提交时间 {{ formatCampusDateTime(record.submitted_at) }}</p>
    <p class="text">{{ record.description }}</p>
    <p v-if="!record.review && record.status === 'submitted'">正在等待审核。审核期间，已有的预约限制仍然有效。</p>

    <section v-if="record.review" class="record-group">
      <h4>审核结果</h4>
      <p class="text">{{ record.review.reason }}</p>
      <p>{{ formatCampusDateTime(record.review.reviewed_at) }} · {{ record.review.reviewer_display_name }}</p>
      <p>{{ ({ revoked: '这条违规已撤销', already_revoked: '这条违规此前已撤销', unchanged: '这条违规的状态保持原样' })[record.review.violation_action] || record.review.violation_action }}</p>
    </section>
    <section v-if="record.current_eligibility" class="record-group">
      <h4>当前能否预约</h4>
      <p>{{ record.current_eligibility.can_book ? '可以预约新座位。' : eligibilityText(record.current_eligibility) }}</p>
      <RestrictionRecord v-for="item in record.current_eligibility.active_restrictions" :key="item.id" :record="item" />
    </section>

    <details class="record-group">
      <summary>违规记录与原申诉期限</summary>
      <div class="record-details">
        <p>违规 #{{ record.violation_id }} · {{ violationLabels[record.violation_snapshot.type] || record.violation_snapshot.type }} · {{ record.violation_snapshot.source === 'manual' ? '管理员登记' : '系统登记' }} · 提交时{{ record.violation_snapshot.status === 'active' ? '有效' : record.violation_snapshot.status === 'revoked' ? '已撤销' : record.violation_snapshot.status }}</p>
        <p>发生时间 {{ formatCampusDateTime(record.violation_snapshot.occurred_at) }}</p>
        <p>登记时间 {{ formatCampusDateTime(record.violation_snapshot.registered_at) }}</p>
        <p class="text">{{ record.violation_snapshot.reason }}</p>
        <p v-if="record.violation_snapshot.source !== 'manual' && record.violation_snapshot.reservation_id">关联预约 #{{ record.violation_snapshot.reservation_id }}</p>
        <p>原通知时间 {{ formatCampusDateTime(record.notification_basis.notified_at) }}</p>
        <p>原申诉截止 {{ formatCampusDateTime(record.notification_basis.deadline) }}</p>
      </div>
    </details>
    <details v-if="record.attachments.length" class="record-group">
      <summary>申诉照片（{{ record.attachments.length }} 张）</summary>
      <div class="attachments record-details">
        <ProtectedAttachment v-for="attachment in record.attachments" :key="attachment.id" :attachment="attachment" :load-content="getAppealAttachment" />
      </div>
    </details>
    <details v-if="record.review?.automatic_recalculations?.length" class="record-group">
      <summary>预约限制调整详情</summary>
      <div class="record-details">
        <AppealRecalculationSummary :items="record.review.automatic_recalculations" />
      </div>
    </details>
    <details class="record-group">
      <summary>处理记录</summary>
      <ul class="record-details">
        <li v-for="event in record.events" :key="`${event.type}:${event.id}`">
          {{ event.type === 'submitted' ? '已提交' : appealStatuses[event.type] || event.type }} · {{ formatCampusDateTime(event.occurred_at) }}<template v-if="event.actor_display_name"> · {{ event.actor_display_name }}</template>
          <p v-if="event.reason" class="text">{{ event.reason }}</p>
        </li>
      </ul>
    </details>
  </section>
</template>
<style scoped>
.appeal-record { display: grid; gap: 12px; min-width: 0; overflow-wrap: anywhere; }
.appeal-record h3, .appeal-record h4, .appeal-record p { margin: 0; }
.text { white-space: pre-wrap; }
.record-group { padding: 12px; background: var(--surface-2); border-radius: var(--r-md); }
section.record-group, .record-details { display: grid; gap: 8px; }
.record-group summary { cursor: pointer; font-weight: 600; }
.record-details { margin-top: 10px; }
.attachments { grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); }
</style>
