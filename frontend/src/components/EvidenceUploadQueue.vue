<script setup>
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import SButton from './ui/SButton.vue'
import SDialog from './ui/SDialog.vue'

const props = defineProps({
  items: { type: Array, required: true },
  disabled: Boolean,
  uploading: Boolean,
  uploadDisabled: Boolean,
  complaintPrivacy: Boolean,
  campusPhotoSelection: Boolean
})
const emit = defineEmits(['select', 'retry', 'remove'])
const input = ref(null)
const replacement = shallowRef(null)
const previewKey = ref(null)
const thumbnails = shallowRef(new Map())
const previewIndex = computed(() => props.items.findIndex(item => item.key === previewKey.value))
const previewUrl = computed(() => thumbnails.value.get(previewKey.value)?.url)
const statuses = {
  queued: '上传中',
  uploading: '上传中',
  uploaded: '已上传',
  error: '上传失败',
  expired: '已失效'
}

watch(() => props.items.map(({ key, file, validated }) => ({ key, file, validated })), entries => {
  const previous = thumbnails.value
  const next = new Map()
  for (const { key, file, validated } of entries) {
    if (!validated || typeof Blob === 'undefined' || !(file instanceof Blob)) continue
    const existing = previous.get(key)
    next.set(key, existing?.file === file ? existing : { file, url: URL.createObjectURL(file) })
  }
  for (const [key, image] of previous) {
    if (next.get(key) !== image) URL.revokeObjectURL(image.url)
  }
  thumbnails.value = next
  if (!next.has(previewKey.value)) previewKey.value = null
}, { immediate: true })

onBeforeUnmount(() => {
  for (const image of thumbnails.value.values()) URL.revokeObjectURL(image.url)
})

function openPicker(item = null) {
  replacement.value = item
  input.value.multiple = !item
  input.value.click()
}

function select(event) {
  emit('select', event, replacement.value)
  replacement.value = null
}

function replaceOrRetry(item) {
  if (item.phase === 'expired' || (item.phase === 'error' && item.validated && !item.error)) {
    emit('retry', item)
    return
  }
  openPicker(item)
}
</script>

<template>
  <section class="evidence-queue">
    <div class="evidence-heading">
      <h3>可选照片（最多 3 张）</h3>
      <span class="muted">{{ campusPhotoSelection ? '所选公开照片对校园用户可见' : complaintPrivacy ? '仅你和受理管理员可见' : '仅你和管理员可见' }}</span>
    </div>
    <input
      ref="input"
      type="file"
      accept="image/png,image/jpeg"
      hidden
      :disabled="disabled || uploading || uploadDisabled"
      @change="select"
    />
    <div class="evidence-grid">
      <article v-for="(item, index) in items" :key="item.key" class="photo-card">
        <SButton
          v-if="thumbnails.has(item.key)"
          class="photo-thumb"
          variant="ghost"
          :aria-label="`预览照片 ${index + 1}`"
          @click="previewKey = item.key"
        >
          <img :src="thumbnails.get(item.key).url" alt="" />
        </SButton>
        <div v-else class="photo-thumb photo-thumb--empty" aria-hidden="true"></div>
        <div class="photo-caption">
          <strong>照片 {{ index + 1 }}</strong>
          <span class="photo-status" :data-phase="item.phase" role="status">{{ statuses[item.phase] }}</span>
        </div>
        <p v-if="item.error" class="photo-error" role="alert">{{ item.error }}</p>
        <slot name="photo-visibility" :item="item" :index="index" />
        <div class="photo-actions">
          <SButton
            v-if="item.phase === 'uploaded' || item.phase === 'error' || item.phase === 'expired'"
            size="sm"
            variant="ghost"
            :disabled="disabled || uploading || uploadDisabled"
            @click="replaceOrRetry(item)"
          >{{ item.phase === 'uploaded' ? '替换' : '重新上传' }}</SButton>
          <SButton size="sm" variant="ghost" :disabled="disabled || uploading" @click="emit('remove', item)">移除</SButton>
        </div>
      </article>
      <SButton
        v-if="items.length < 3 && !uploadDisabled"
        class="photo-add"
        :disabled="disabled || uploading"
        @click="openPicker()"
      ><span aria-hidden="true">＋</span>添加照片</SButton>
    </div>
    <p class="muted photo-formats">JPG / PNG，单张 ≤ 5MB</p>
    <SDialog
      :model-value="Boolean(previewUrl)"
      :title="`照片 ${previewIndex + 1}`"
      width="720px"
      @close="previewKey = null"
    >
      <img v-if="previewUrl" class="photo-preview" :src="previewUrl" :alt="`照片 ${previewIndex + 1}`" />
    </SDialog>
  </section>
</template>

<style scoped>
.evidence-queue {
  display: grid;
  min-width: 0;
  gap: 10px;
}

.evidence-heading,
.photo-caption,
.photo-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 10px;
}

.evidence-heading,
.photo-caption {
  justify-content: space-between;
}

.evidence-heading h3 {
  margin: 0;
  font-size: 14px;
}

.evidence-heading .muted,
.photo-formats {
  margin: 0;
  font-size: 12px;
}

.evidence-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 138px), 1fr));
  align-items: start;
  max-width: 600px;
  gap: 10px;
}

.photo-card {
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--surface-2);
}

.photo-thumb.s-btn,
.photo-thumb--empty {
  width: 100%;
  height: auto;
  aspect-ratio: 4 / 3;
  padding: 0;
  overflow: hidden;
  border-radius: var(--r-sm);
  background: var(--surface-3);
}

.photo-thumb :deep(.s-btn__content),
.photo-thumb img {
  display: block;
  width: 100%;
  height: 100%;
}

.photo-thumb img {
  object-fit: cover;
}

.photo-caption {
  margin: 6px 0 2px;
  font-size: 12px;
}

.photo-status {
  color: var(--text-3);
}

.photo-status[data-phase='uploaded'] {
  color: var(--green-strong);
}

.photo-status[data-phase='error'],
.photo-error {
  color: var(--red-strong);
}

.photo-status[data-phase='expired'] {
  color: var(--amber-strong);
}

.photo-error {
  margin: 2px 0 4px;
  font-size: 12px;
}

.photo-actions {
  justify-content: flex-end;
  gap: 2px;
}

.photo-add.s-btn {
  height: auto;
  min-height: 70px;
  border-style: dashed;
}

.photo-add:first-child {
  justify-self: start;
  min-height: 42px;
}

.photo-preview {
  display: block;
  width: 100%;
  max-height: 68vh;
  object-fit: contain;
}
</style>
