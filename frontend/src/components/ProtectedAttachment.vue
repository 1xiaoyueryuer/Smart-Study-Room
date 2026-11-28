<script setup>
import { formatCampusDateTime } from '../composables/campusDateTime.js'
import { onBeforeUnmount, ref, watch } from 'vue'
import { getComplaintAttachment } from '../api/complaint'
import SButton from './ui/SButton.vue'
import SDialog from './ui/SDialog.vue'
const props = defineProps({
  attachment: {type:Object,required:true},
  loadContent:Function,
  photoNumber:Number,
  staticPreview:Boolean
})
const url = ref(''), loading = ref(false), error = ref(''), previewOpen = ref(false)
let sequence = 0, alive = true
function release() { if (url.value) URL.revokeObjectURL(url.value); url.value = '' }
async function load() {
  const ticket = ++sequence
  loading.value = true; error.value = ''; previewOpen.value = false; release()
  try { const blob = await (props.loadContent || getComplaintAttachment)(props.attachment.id); if (alive && ticket === sequence) url.value = URL.createObjectURL(blob) }
  catch (failure) { if (alive && ticket === sequence) error.value = failure.message }
  finally { if (alive && ticket === sequence) loading.value = false }
}
async function download() {
  if (!url.value) await load()
  if (!url.value || !alive) return
  const link = document.createElement('a'); link.href = url.value; link.download = props.attachment.display_name; document.body.append(link); link.click(); link.remove()
}
watch(() => [props.attachment.id,props.loadContent], load, {immediate:true})
onBeforeUnmount(() => { alive = false; sequence++; release() })
</script>
<template>
  <article v-if="photoNumber" class="protected-attachment compact-photo">
    <img v-if="staticPreview && url && !error" class="photo-thumbnail" :src="url" :alt="`照片 ${photoNumber}`" @error="error = '照片暂时无法显示'" />
    <SButton v-else-if="url && !error" class="photo-preview" variant="ghost" :aria-label="`预览照片 ${photoNumber}`" @click="previewOpen = true">
      <img :src="url" alt="" @error="error = '照片暂时无法显示'" />
    </SButton>
    <strong>照片 {{ photoNumber }}</strong>
    <p v-if="loading" role="status">正在加载照片…</p>
    <SButton v-else-if="error" size="sm" @click="load">重新加载照片</SButton>
    <SDialog v-model="previewOpen" :title="`照片 ${photoNumber}`" width="720px">
      <img v-if="url" class="photo-full" :src="url" :alt="`照片 ${photoNumber}`" />
    </SDialog>
  </article>
  <article v-else class="protected-attachment">
    <p>{{ attachment.display_name }} · {{ attachment.size_bytes }}字节 · {{ attachment.width }}×{{ attachment.height }}</p>
    <p v-if="attachment.expires_at" class="muted">临时材料有效至{{ formatCampusDateTime(attachment.expires_at) }}；过期或读取失败时请回表单重新选择或上传，不会自动延期。</p>
    <p v-else class="muted">已关联的历史材料。</p>
    <p v-if="loading" role="status">正在鉴权读取照片…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <img v-if="url" :src="url" :alt="attachment.display_name" @error="error='照片无法显示，请重试读取'" />
    <div class="attachment-actions">
      <SButton size="sm" :loading="loading" @click="load">重新读取</SButton>
      <SButton size="sm" :disabled="loading" @click="download">下载材料</SButton>
    </div>
  </article>
</template>
<style scoped>
.protected-attachment {
  display: grid;
  gap: 8px;
  border: 1px solid var(--border);
  padding: 12px;
  border-radius: var(--r-md);
  min-width: 0;
  overflow-wrap: anywhere;
}
.protected-attachment img { width: 100%; max-height: 320px; object-fit: contain; }
.attachment-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.photo-preview { height: auto; width: 100%; padding: 0; }
.photo-preview :deep(.s-btn__content) { width: 100%; }
.photo-preview img, .protected-attachment img.photo-thumbnail { height: 112px; object-fit: cover; display: block; border-radius: var(--r-sm); }
.photo-full { width: 100%; max-height: 68vh; object-fit: contain; display: block; }
</style>
