import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const context = vm.createContext({ setTimeout, clearTimeout })
const scannerModule = new vm.SourceTextModule(
  await readFile(new URL('../src/composables/seatScanner.js', import.meta.url), 'utf8'),
  { context },
)
await scannerModule.link((specifier) => {
  if (specifier === '@zxing/browser') {
    return new vm.SyntheticModule(['BrowserQRCodeReader'], function () {
      this.setExport('BrowserQRCodeReader', class {})
    }, { context })
  }
  if (specifier === '@zxing/library') {
    return new vm.SyntheticModule(['DecodeHintType'], function () {
      this.setExport('DecodeHintType', {})
    }, { context })
  }
  return null
})
await scannerModule.evaluate()
const { createSeatScanner } = scannerModule.namespace

test('camera waits for real video metadata before starting decode', async () => {
  let decodeStarted = false
  const listeners = {}
  const video = {
    srcObject: null,
    videoWidth: 0,
    videoHeight: 0,
    muted: false,
    playsInline: false,
    play: async () => {},
    setAttribute() {},
    addEventListener(name, handler) { listeners[name] = handler },
    removeEventListener(name) { delete listeners[name] },
  }
  setTimeout(() => {
    video.videoWidth = 640
    video.videoHeight = 480
    listeners.loadedmetadata?.()
  }, 10)
  const scanner = createSeatScanner({
    onCode: async () => {},
    onError: error => { throw error },
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) },
    reader: {
      decodeFromStream: async () => {
        decodeStarted = true
        assert.equal(video.videoWidth, 640)
        assert.equal(video.videoHeight, 480)
        return { stop() {} }
      },
    },
    urls: { createObjectURL: () => '', revokeObjectURL: () => {} },
    ImageClass: class {},
  })
  await scanner.camera(video)
  assert.equal(decodeStarted, true)
})
