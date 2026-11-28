<script setup>
import { complaintStatuses } from '../composables/complaintForm.js'

defineProps({
  roomName: String,
  summary: { type: String, required: true },
  status: { type: String, required: true }
})
</script>

<template>
  <article class="campus-card">
    <header>
      <strong>{{ roomName || '未关联空间' }}</strong>
      <span class="pill pill-neutral">{{ complaintStatuses[status] }}</span>
    </header>
    <p>{{ summary }}</p>
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
.campus-card p { margin: 0; color: var(--text-1); line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
