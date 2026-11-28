import { computed, ref } from 'vue'
import { validateEvidenceFile } from './evidenceFile.js'

const maxPhotos = 3
const acceptedTypes = ['image/png', 'image/jpeg']

function uploadError(file, failure, uploadStarted) {
  if (!acceptedTypes.includes(file.type)) return '请选择 JPG 或 PNG 图片。'
  if (file.size > 5 * 1024 * 1024 || failure.status === 413) return '照片超过 5MB，请换一张。'
  if (uploadStarted && (failure.status == null || failure.status === 408 || failure.status >= 500)) return ''
  return '这张照片无法上传，请换一张。'
}

export function useEvidenceUploadQueue({
  uploadFile,
  isLocked = () => false,
  isActive = () => true,
  setError = () => {},
  validateFile = validateEvidenceFile,
  newKey = () => crypto.randomUUID(),
  trackExpiry = false,
  now = () => performance.now()
}) {
  const items = ref([])
  const uploading = ref(false)
  const expiredCount = computed(() => items.value.filter(item => item.phase === 'expired').length)
  let alive = true
  let generation = 0
  let expiryTimer
  const current = () => alive && isActive()

  function refreshExpiry() {
    clearTimeout(expiryTimer)
    if (!trackExpiry || !current()) return
    const time = now()
    let nextExpiry = Infinity
    for (const item of items.value) {
      if (item.phase !== 'uploaded' || item.expiresLocallyAt == null) continue
      if (item.expiresLocallyAt <= time) item.phase = 'expired'
      else nextExpiry = Math.min(nextExpiry, item.expiresLocallyAt)
    }
    if (Number.isFinite(nextExpiry)) {
      expiryTimer = setTimeout(refreshExpiry, Math.min(nextExpiry - time, 2_147_483_647))
    }
  }

  async function checkAvailablePhotos(loadContent) {
    const ticket = generation
    const candidates = items.value.filter(item => item.phase === 'uploaded')
    await Promise.all(candidates.map(async item => {
      const id = item.metadata?.id
      if (!id) return
      try {
        await loadContent(id)
      } catch (failure) {
        if (current() && ticket === generation && items.value.includes(item) && item.metadata?.id === id &&
          (failure.status === 404 || failure.status === 410)) {
          item.phase = 'expired'
        }
      }
    }))
    refreshExpiry()
    return expiredCount.value
  }

  async function uploadItem(item) {
    if (!current() || isLocked() || uploading.value || !items.value.includes(item)) return
    const ticket = generation
    const active = () => current() && ticket === generation
    uploading.value = true
    Object.assign(item, { phase: 'uploading', error: '', metadata: null, expiresLocallyAt: null })
    let started = false
    try {
      await validateFile(item.file)
      if (!active()) return
      item.validated = true
      started = true
      const { data: metadata } = await uploadFile(item.file)
      if (!active() || !items.value.includes(item)) return
      if (!metadata?.id || !metadata.display_name || !acceptedTypes.includes(metadata.content_type) ||
        !metadata.size_bytes || !metadata.width || !metadata.height) {
        throw new Error('Invalid evidence upload receipt')
      }
      item.metadata = metadata
      item.phase = 'uploaded'
      // Measure from the upload receipt so a fast browser clock cannot exclude valid photos.
      const lifetime = Date.parse(metadata.expires_at) - Date.parse(metadata.created_at)
      if (trackExpiry && Number.isFinite(lifetime) && lifetime > 0) {
        item.expiresLocallyAt = now() + lifetime
        refreshExpiry()
      }
    } catch (failure) {
      if (active()) {
        item.phase = 'error'
        item.error = uploadError(item.file, failure, started)
      }
    } finally {
      if (active()) uploading.value = false
    }
  }

  async function selectFiles(event, replacement) {
    const selected = Array.from(event.target.files || [])
    event.target.value = ''
    if (!current() || isLocked() || uploading.value || !selected.length) return
    setError('')
    if (replacement) {
      if (!items.value.includes(replacement)) return
      Object.assign(replacement, { file: selected[0], validated: false })
      await uploadItem(replacement)
      return
    }
    if (items.value.length + selected.length > maxPhotos) {
      setError('最多可添加 3 张照片，请少选几张。')
      return
    }
    const keys = selected.map(() => newKey())
    items.value.push(...selected.map((file, index) => ({
      key: keys[index],
      file,
      phase: 'queued',
      validated: false,
      metadata: null,
      error: ''
    })))
    const added = items.value.slice(-selected.length)
    const ticket = generation
    for (const item of added) {
      if (ticket !== generation) return
      await uploadItem(item)
    }
  }

  function removeItem(item) {
    if (!isLocked() && !uploading.value) {
      items.value = items.value.filter(value => value !== item)
      refreshExpiry()
    }
  }

  function reset() {
    generation++
    items.value = []
    uploading.value = false
    clearTimeout(expiryTimer)
  }

  return {
    items, uploading, expiredCount, uploadItem, selectFiles, removeItem, refreshExpiry, checkAvailablePhotos, reset,
    dispose() {
      alive = false
      reset()
    }
  }
}
