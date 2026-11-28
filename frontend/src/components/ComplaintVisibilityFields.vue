<script setup>
import { computed } from 'vue'
import { getComplaintAttachment } from '../api/complaint'
import { publicDetailsLimit, publicSummaryLimit, visibilityLabels } from '../composables/complaintVisibility.js'
import ComplaintCampusCard from './ComplaintCampusCard.vue'
import ProtectedAttachment from './ProtectedAttachment.vue'
import SButton from './ui/SButton.vue'
import SCheckbox from './ui/SCheckbox.vue'
import SDialog from './ui/SDialog.vue'
import SInput from './ui/SInput.vue'

const props = defineProps({
  visibility: { type: String, required: true },
  summary: { type: String, default: '' },
  details: { type: String, default: '' },
  selectedPhotoIds: { type: Array, default: () => [] },
  photos: { type: Array, default: () => [] },
  previewOpen: Boolean,
  roomName: String,
  category: String,
  status: { type: String, default: 'submitted' },
  disabled: Boolean,
  confirmLabel: { type: String, required: true }
})
const emit = defineEmits(['update:visibility', 'update:summary', 'update:details', 'update:selectedPhotoIds', 'update:previewOpen', 'confirm'])
const summaryLength = computed(() => Array.from(props.summary.trim()).length)
const detailsLength = computed(() => Array.from(props.details.trim()).length)
const previewPhotoIds = computed(() => props.photos.length
  ? props.photos.map(photo => photo.id).filter(id => props.selectedPhotoIds.includes(id))
  : props.selectedPhotoIds)
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
      <label class="summary-field">
        <span>公开详情（选填） <small :class="{ 'summary-over-limit': detailsLength > publicDetailsLimit }">{{ detailsLength }}/{{ publicDetailsLimit }} 字</small></span>
        <SInput :model-value="details" type="textarea" :rows="3" :disabled="disabled"
          placeholder="可补充位置、遇到的问题和对使用的影响" @update:model-value="emit('update:details', $event)" />
      </label>
      <p class="muted">校园用户可见此处填写的内容和你勾选的照片。请确认文字和照片中没有个人信息。</p>
      <div v-if="photos.length" class="publication-photos">
        <div v-for="(attachment, index) in photos" :key="attachment.id" class="publication-photo">
          <ProtectedAttachment :attachment="attachment" :photo-number="index + 1" />
          <SCheckbox :model-value="selectedPhotoIds.includes(attachment.id)" :disabled="disabled"
            @update:model-value="emit('update:selectedPhotoIds', $event ? [...selectedPhotoIds, attachment.id] : selectedPhotoIds.filter(id => id !== attachment.id))">
            公开照片 {{ index + 1 }}
          </SCheckbox>
        </div>
      </div>
      <SDialog :model-value="previewOpen" title="预览校园公开内容" width="520px" @update:model-value="emit('update:previewOpen', $event)">
        <ComplaintCampusCard :room-name="roomName" :summary="summary.trim()" :status="status"
          :category="category" :details="details.trim()" :photo-ids="previewPhotoIds" :load-photo="getComplaintAttachment" preview />
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
.publication-photos { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 135px), 1fr)); gap: 8px; width: min(100%, 480px); }
.publication-photo { display: grid; gap: 5px; }
</style>
