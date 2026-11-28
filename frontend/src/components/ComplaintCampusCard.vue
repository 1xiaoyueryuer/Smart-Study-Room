<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { complaintStatuses } from '../composables/complaintForm.js'
import { publicComplaintCategories } from '../composables/complaintVisibility.js'
import ProtectedAttachment from './ProtectedAttachment.vue'

const props = defineProps({
  roomName: String,
  summary: { type: String, required: true },
  status: { type: String, required: true },
  category: String,
  details: String,
  photoIds: { type: Array, default: () => [] },
  loadPhoto: { type: Function, required: true },
  preview: Boolean
})
const card = ref(null)
const photosVisible = ref(props.preview)
let observer

onMounted(() => {
  if (props.preview || !props.photoIds.length) return
  if (typeof IntersectionObserver !== 'function') {
    photosVisible.value = true
    return
  }
  observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return
    photosVisible.value = true
    observer.disconnect()
  }, { rootMargin: '160px' })
  observer.observe(card.value)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <article ref="card" class="campus-card">
    <header>
      <div class="campus-card-location">
        <small v-if="publicComplaintCategories[category]">{{ publicComplaintCategories[category] }}</small>
        <strong>{{ roomName || '未关联空间' }}</strong>
      </div>
      <span class="pill pill-neutral">{{ complaintStatuses[status] }}</span>
    </header>
    <p>{{ summary }}</p>
    <details v-if="details" :open="preview">
      <summary>详细说明</summary>
      <p>{{ details }}</p>
    </details>
    <div v-if="photosVisible && photoIds.length" class="campus-photo-grid" aria-label="公开照片">
      <ProtectedAttachment v-for="(id, index) in photoIds" :key="id" :attachment="{ id }"
        :photo-number="index + 1" :load-content="loadPhoto" :static-preview="preview" />
    </div>
  </article>
</template>

<style scoped>
.campus-card {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--surface-2);
}
.campus-card header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
.campus-card-location { display: grid; gap: 2px; }
.campus-card-location small { color: var(--text-3); font-size: var(--fs-caption); }
.campus-card p { margin: 0; color: var(--text-1); line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
.campus-card details { padding-top: 9px; border-top: 1px solid var(--hairline); }
.campus-card summary { width: fit-content; color: var(--primary-active); cursor: pointer; font-size: var(--fs-caption); font-weight: 600; }
.campus-card details p { margin-top: 8px; }
.campus-photo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 135px), 1fr)); gap: 8px; width: min(100%, 480px); }
</style>
