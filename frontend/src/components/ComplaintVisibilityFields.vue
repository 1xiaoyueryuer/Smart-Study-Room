<script setup>
import { computed } from 'vue'
import { publicSummaryLimit, visibilityLabels } from '../composables/complaintVisibility.js'
import ComplaintCampusCard from './ComplaintCampusCard.vue'
import SButton from './ui/SButton.vue'
import SDialog from './ui/SDialog.vue'
import SInput from './ui/SInput.vue'

const props = defineProps({
  visibility: { type: String, required: true },
  summary: { type: String, default: '' },
  previewOpen: Boolean,
  roomName: String,
  status: { type: String, default: 'submitted' },
  disabled: Boolean,
  confirmLabel: { type: String, required: true }
})
const emit = defineEmits(['update:visibility', 'update:summary', 'update:previewOpen', 'confirm'])
const summaryLength = computed(() => Array.from(props.summary.trim()).length)
</script>

<template>
  <fieldset class="visibility-fields">
    <legend>可见范围</legend>
    <div class="visibility-options">
      <SButton v-for="(label, value) in visibilityLabels" :key="value" :variant="visibility === value ? 'primary' : 'secondary'"
        :aria-pressed="visibility === value" :disabled="disabled" @click="emit('update:visibility', value)">{{ label }}</SButton>
    </div>
    <template v-if="visibility === 'campus'">
      <label class="summary-field">
        <span>公开摘要 <small :class="{ 'summary-over-limit': summaryLength > publicSummaryLimit }">{{ summaryLength }}/{{ publicSummaryLimit }} 字</small></span>
        <SInput :model-value="summary" type="textarea" :rows="3" required :disabled="disabled"
          placeholder="简要说明问题，请勿填写姓名、学号或联系方式" @update:model-value="emit('update:summary', $event)" />
      </label>
      <p class="muted">校园用户可见关联空间、公开摘要和处理状态。详细说明与照片仅本人和管理员可见。</p>
      <SDialog :model-value="previewOpen" title="预览校园公开内容" width="520px" @update:model-value="emit('update:previewOpen', $event)">
        <ComplaintCampusCard :room-name="roomName" :summary="summary.trim()" :status="status" />
        <template #footer>
          <SButton @click="emit('update:previewOpen', false)">返回修改</SButton>
          <SButton variant="primary" :disabled="disabled" @click="emit('confirm')">{{ confirmLabel }}</SButton>
        </template>
      </SDialog>
    </template>
  </fieldset>
</template>

<style scoped>
.visibility-fields { display: grid; gap: 10px; min-width: 0; margin: 0; padding: 0; border: 0; }
.visibility-fields legend { margin-bottom: 7px; padding: 0; font-size: var(--fs-caption); }
.visibility-options { display: flex; flex-wrap: wrap; gap: 8px; }
.summary-field { display: grid; gap: 7px; font-size: var(--fs-caption); }
.summary-field > span { display: flex; justify-content: space-between; gap: 12px; }
.summary-field small { color: var(--text-3); font-size: inherit; }
.summary-field .summary-over-limit { color: var(--red-strong); }
.visibility-fields p { margin: 0; }
</style>
