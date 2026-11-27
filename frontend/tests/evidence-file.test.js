import test from 'node:test'
import assert from 'node:assert/strict'
import { validateEvidenceFile } from '../src/composables/evidenceFile.js'
import { useEvidenceUploadQueue } from '../src/composables/useEvidenceUploadQueue.js'

// 前端当前口径：PNG/JPEG、单张 >0 且 ≤5MiB（5 * 1024 * 1024 字节）。
// 任务书要求与后端 spring.servlet.multipart.max-file-size=6MB 的拒绝用例对齐；
// 本文件按当前实现锁定 5MiB 边界，6MB 口径差异待 C 确认后统一，不在此放宽断言。
const MIB = 1024 * 1024

function photo(size = 1024, type = 'image/png', name = 'photo.png') {
  return { name, type, size }
}

function fakeUrls() {
  const created = []
  const revoked = []
  return {
    created,
    revoked,
    urls: {
      createObjectURL: file => {
        created.push(file)
        return `blob:evidence-${created.length}`
      },
      revokeObjectURL: url => revoked.push(url)
    }
  }
}

function imageClass({ width = 800, height = 600, fail = false } = {}) {
  return class FakeImage {
    set src(value) {
      this._src = value
      this.onload = this.onload || null
      this.onerror = this.onerror || null
      queueMicrotask(() => {
        if (fail) {
          if (typeof this.onerror === 'function') this.onerror()
          return
        }
        this.naturalWidth = width
        this.naturalHeight = height
        if (typeof this.onload === 'function') this.onload()
      })
    }
    get src() {
      return this._src
    }
  }
}

test('evidence photos reject any type outside PNG and JPEG before creating a preview URL', async () => {
  const { urls, created } = fakeUrls()
  await assert.rejects(validateEvidenceFile(photo(1024, 'image/gif', 'a.gif'), { urls, ImageClass: imageClass() }), /仅支持PNG或JPEG/)
  await assert.rejects(validateEvidenceFile(photo(1024, 'application/pdf', 'a.pdf'), { urls, ImageClass: imageClass() }), /仅支持PNG或JPEG/)
  assert.equal(created.length, 0, '类型不符时不应发起预览')
})

test('evidence photos accept PNG and JPEG and revoke the preview URL', async () => {
  const png = fakeUrls()
  await validateEvidenceFile(photo(MIB, 'image/png'), { urls: png.urls, ImageClass: imageClass() })
  assert.equal(png.created.length, 1)
  assert.deepEqual(png.revoked, ['blob:evidence-1'])

  const jpeg = fakeUrls()
  await validateEvidenceFile(photo(MIB, 'image/jpeg', 'photo.jpg'), { urls: jpeg.urls, ImageClass: imageClass() })
  assert.equal(jpeg.created.length, 1)
  assert.deepEqual(jpeg.revoked, ['blob:evidence-1'])
})

test('evidence photos reject an empty file', async () => {
  const { urls, created } = fakeUrls()
  await assert.rejects(validateEvidenceFile(photo(0), { urls, ImageClass: imageClass() }), /大于0且不超过5MiB/)
  assert.equal(created.length, 0)
})

test('evidence photo size boundary: exactly 5MiB passes, one byte more is rejected', async () => {
  const atLimit = fakeUrls()
  await validateEvidenceFile(photo(5 * MIB), { urls: atLimit.urls, ImageClass: imageClass() })
  assert.equal(atLimit.created.length, 1)

  const overLimit = fakeUrls()
  await assert.rejects(validateEvidenceFile(photo(5 * MIB + 1), { urls: overLimit.urls, ImageClass: imageClass() }), /不超过5MiB/)
  assert.equal(overLimit.created.length, 0, '超限文件不应生成预览')
})

test('evidence photos reject a side longer than 10000 pixels', async () => {
  const { urls } = fakeUrls()
  await assert.rejects(
    validateEvidenceFile(photo(), { urls, ImageClass: imageClass({ width: 10001, height: 100 }) }),
    /单边不能超过10000像素/
  )
  await assert.rejects(
    validateEvidenceFile(photo(), { urls, ImageClass: imageClass({ width: 100, height: 10001 }) }),
    /单边不能超过10000像素/
  )
})

test('evidence photo dimension boundary: 10000 x 2000 exactly 20MP passes, one more pixel is rejected', async () => {
  const atLimit = fakeUrls()
  await validateEvidenceFile(photo(), { urls: atLimit.urls, ImageClass: imageClass({ width: 10000, height: 2000 }) })

  const overLimit = fakeUrls()
  await assert.rejects(
    validateEvidenceFile(photo(), { urls: overLimit.urls, ImageClass: imageClass({ width: 10000, height: 2001 }) }),
    /总像素不能超过2000万/
  )
})

test('evidence photos reject a zero-sized decode', async () => {
  const { urls } = fakeUrls()
  await assert.rejects(
    validateEvidenceFile(photo(), { urls, ImageClass: imageClass({ width: 0, height: 600 }) }),
    /总像素不能超过2000万/
  )
})

test('evidence photos reject files that cannot be decoded', async () => {
  const { urls } = fakeUrls()
  await assert.rejects(
    validateEvidenceFile(photo(), { urls, ImageClass: imageClass({ fail: true }) }),
    /照片损坏或无法解码/
  )
})

test('evidence photo preview URL is revoked even when decoding fails', async () => {
  const { urls, revoked } = fakeUrls()
  await assert.rejects(validateEvidenceFile(photo(), { urls, ImageClass: imageClass({ fail: true }) }))
  assert.deepEqual(revoked, ['blob:evidence-1'])
})

test('evidence type is decided by MIME type rather than the file name suffix', async () => {
  const renamedPng = fakeUrls()
  await validateEvidenceFile(photo(1024, 'image/png', 'photo.jpg'), { urls: renamedPng.urls, ImageClass: imageClass() })
  const renamedJpeg = fakeUrls()
  await validateEvidenceFile(photo(1024, 'image/jpeg', 'photo.png'), { urls: renamedJpeg.urls, ImageClass: imageClass() })
  const missingMime = fakeUrls()
  await assert.rejects(validateEvidenceFile({ name: 'photo.png', size: 1024 }, { urls: missingMime.urls, ImageClass: imageClass() }), /仅支持PNG或JPEG/)
})

test('upload queue accepts exactly three photos and uploads them in order', async () => {
  const uploaded = []
  const queue = useEvidenceUploadQueue({
    uploadFile: async file => {
      uploaded.push(file.name)
      return { data: { id: uploaded.length, display_name: file.name, content_type: 'image/png', size_bytes: file.size, width: 800, height: 600 } }
    },
    validateFile: async () => {},
    newKey: () => `k-${uploaded.length}-${Math.random()}`
  })
  await queue.selectFiles({ target: { files: [photo(), photo(), photo()] } })
  assert.equal(queue.items.value.length, 3)
  assert.deepEqual(uploaded.length, 3)
  assert.ok(queue.items.value.every(item => item.phase === 'uploaded' && item.metadata?.id))
})

test('upload queue rejects a fourth photo before uploading any of them', async () => {
  const uploaded = []
  const errors = []
  const queue = useEvidenceUploadQueue({
    uploadFile: async file => {
      uploaded.push(file.name)
      return { data: { id: 1, display_name: file.name, content_type: 'image/png', size_bytes: file.size, width: 800, height: 600 } }
    },
    validateFile: async () => {},
    setError: value => errors.push(value),
    newKey: () => `k-${++uploaded.key}`
  })
  await queue.selectFiles({ target: { files: [photo(), photo(), photo(), photo()] } })
  assert.equal(queue.items.value.length, 4)
  assert.equal(uploaded.length, 0)
  assert.ok(queue.items.value.every(item => item.phase === 'error'))
  assert.match(errors.at(-1), /最多3张照片/)
})

test('upload queue keeps the file in error state when the upload receipt is incomplete', async () => {
  const queue = useEvidenceUploadQueue({
    uploadFile: async () => ({ data: { display_name: 'a.png' } }),
    validateFile: async () => {},
    newKey: () => 'k-1'
  })
  await queue.selectFiles({ target: { files: [photo()] } })
  assert.equal(queue.items.value[0].phase, 'error')
  assert.match(queue.items.value[0].error, /上传结果未确认，未取得附件ID/)
})
