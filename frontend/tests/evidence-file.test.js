import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as vue from 'vue'
import * as ssr from 'vue/server-renderer'
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

test('upload queue preserves existing photos when another selection would exceed three', async () => {
  const uploaded = []
  const errors = []
  const queue = useEvidenceUploadQueue({
    uploadFile: async file => {
      uploaded.push(file.name)
      return { data: { id: 1, display_name: file.name, content_type: 'image/png', size_bytes: file.size, width: 800, height: 600 } }
    },
    validateFile: async () => {},
    setError: value => errors.push(value),
    newKey: () => 'k-1'
  })
  await queue.selectFiles({ target: { files: [photo()] } })
  await queue.selectFiles({ target: { files: [photo(), photo(), photo()] } })
  assert.equal(queue.items.value.length, 1)
  assert.equal(uploaded.length, 1)
  assert.equal(queue.items.value[0].phase, 'uploaded')
  assert.equal(errors.at(-1), '最多可添加 3 张照片，请少选几张。')
})

test('upload queue keeps the file in error state when the upload receipt is incomplete', async () => {
  const queue = useEvidenceUploadQueue({
    uploadFile: async () => ({ data: { display_name: 'a.png' } }),
    validateFile: async () => {},
    newKey: () => 'k-1'
  })
  await queue.selectFiles({ target: { files: [photo()] } })
  assert.equal(queue.items.value[0].phase, 'error')
  assert.equal(queue.items.value[0].validated, true)
  assert.equal(queue.items.value[0].metadata, null)
})

test('upload queue replaces a failed photo in place and clears its validation message', async () => {
  const queue = useEvidenceUploadQueue({
    uploadFile: async file => ({ data: {
      id: 2, display_name: file.name, content_type: 'image/png', size_bytes: file.size, width: 800, height: 600
    } }),
    validateFile: async file => {
      if (file.type !== 'image/png') throw new Error('图片类型无效')
    },
    newKey: () => 'original-position'
  })
  await queue.selectFiles({ target: { files: [photo(100, 'application/pdf', 'a.pdf')] } })
  const item = queue.items.value[0]
  assert.equal(item.phase, 'error')
  assert.equal(item.error, '请选择 JPG 或 PNG 图片。')
  await queue.selectFiles({ target: { files: [photo()] } }, item)
  assert.deepEqual(queue.items.value.map(entry => entry.key), ['original-position'])
  assert.equal(item.phase, 'uploaded')
  assert.equal(item.error, '')
  assert.equal(item.metadata.id, 2)
})

test('complaint queue marks unavailable photos individually and allows an in-place reupload', async t => {
  let time = 0
  let uploadCount = 0
  let key = 0
  const queue = useEvidenceUploadQueue({
    uploadFile: async file => ({ data: {
      id: ++uploadCount,
      display_name: file.name,
      content_type: 'image/png',
      size_bytes: file.size,
      width: 800,
      height: 600,
      created_at: '2026-11-28T08:00:00+08:00',
      expires_at: '2026-11-29T08:00:00+08:00'
    } }),
    validateFile: async () => {},
    newKey: () => `k-${++key}`,
    now: () => time,
    trackExpiry: true
  })
  t.after(queue.dispose)
  await queue.selectFiles({ target: { files: [photo()] } })
  time += 1000
  await queue.selectFiles({ target: { files: [photo()] } })
  assert.equal(queue.expiredCount.value, 0)

  await queue.checkAvailablePhotos(async id => {
    throw { status: id === 1 ? 410 : 503 }
  })
  assert.equal(queue.expiredCount.value, 1)
  assert.deepEqual(queue.items.value.map(item => item.phase), ['expired', 'uploaded'])

  await queue.uploadItem(queue.items.value[0])
  assert.equal(queue.expiredCount.value, 0)
  assert.equal(queue.items.value[0].metadata.id, 3)

  time = 86401000
  queue.refreshExpiry()
  assert.equal(queue.expiredCount.value, 2)
})

test('photo card shows a preview and recovery actions without exposing attachment internals', async () => {
  const source = await readFile(new URL('../src/components/EvidenceUploadQueue.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const compiled = compileScript(descriptor, {
    id: 'evidence-queue-test',
    inlineTemplate: true,
    templateOptions: { ssr: true }
  })
  const button = {
    setup(_, { slots }) {
      return () => vue.h('button', slots.default?.())
    }
  }
  const context = vm.createContext({ Blob, URL: fakeUrls().urls })
  const module = new vm.SourceTextModule(compiled.content, { context })
  await module.link(specifier => {
    const values = ({
      vue,
      'vue/server-renderer': ssr,
      './ui/SButton.vue': { default: button },
      './ui/SDialog.vue': { default: { render: () => null } }
    })[specifier]
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [name, value] of Object.entries(values)) this.setExport(name, value)
    }, { context })
  })
  await module.evaluate()
  const file = Object.assign(new Blob(['png'], { type: 'image/png' }), { name: 'ORIGINAL_FILENAME.png' })
  const props = { items: [{
    key: 'photo',
    phase: 'expired',
    file,
    validated: true,
    metadata: { display_name: 'material-identifier.png', size_bytes: 123456, width: 987, height: 654, expires_at: '2099-01-01' }
  }] }
  const html = await ssr.renderToString(vue.createSSRApp(module.namespace.default, props))
  assert.match(html, /预览照片 1/)
  assert.match(html, /<img src="blob:evidence-1"/)
  assert.match(html, /已失效/)
  assert.match(html, /重新上传/)
  assert.match(html, /移除/)
  assert.match(html, /JPG \/ PNG，单张 ≤ 5MB/)
  assert.match(html, /<input [^>]*hidden/)
  assert.doesNotMatch(html, /ORIGINAL_FILENAME|material-identifier|123456|987[×x]654|2099-01-01|下载|重新读取|有效至|字节/)
})
