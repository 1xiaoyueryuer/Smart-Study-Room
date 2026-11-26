import QrScanner from 'qr-scanner'
import { BrowserQRCodeReader } from '@zxing/browser'
import { DecodeHintType } from '@zxing/library'

export function scanFailure(error) {
  const name = typeof error === 'object' ? error?.name : ''
  const messages = {
    NotAllowedError: '摄像头权限被拒绝，请允许权限后重试，或上传座位码图片。',
    NotFoundError: '未找到摄像头，请连接设备或上传座位码图片。',
    NotReadableError: '摄像头被占用或无法读取，请关闭其他使用摄像头的程序后重试。',
    OverconstrainedError: '摄像头不支持所需配置，请换设备或上传图片。',
    SecurityError: '当前环境禁止访问摄像头，请使用HTTPS或localhost，或上传图片。',
    NotSupportedError: '当前浏览器或内嵌页面不支持摄像头扫码，请改用系统浏览器或上传图片。'
  }
  if (name && messages[name]) return messages[name]
  const message = typeof error === 'string' ? error : error?.message
  if (message && /permission|denied|not allowed|not supported|not found|camera/i.test(message)) {
    return '摄像头不可用：' + message + '。请检查浏览器权限，或上传座位码图片。'
  }
  return message || '未能识别座位码，请使用清晰、完整的二维码重试。'
}

// 摄像头扫描使用 GitHub 上的 Nimiq qr-scanner：移动端优先 BarcodeDetector，
// 回退到 WebWorker + ZXing，并负责 video 的播放、元数据和移动端兼容处理。
// 文件上传仍沿用既有 ZXing 解码、尺寸和座位码格式校验。
export function createSeatScanner({ onCode, onError, onCamera = () => {}, reader = new BrowserQRCodeReader(), pureReader = new BrowserQRCodeReader(new Map([[DecodeHintType.PURE_BARCODE, true]])), urls = globalThis.URL, ImageClass = globalThis.Image, QrScannerClass = QrScanner } = {}) {
  let generation = 0, qrScanner = null, imageUrl = null, locked = false
  function destroyCamera() {
    generation++
    const active = qrScanner
    qrScanner = null
    try { active?.destroy?.() } catch { /* scanner may already be destroyed */ }
    onCamera(false)
  }
  function releaseImage() { if (imageUrl) { urls.revokeObjectURL(imageUrl); imageUrl = null } }
  function stop() { destroyCamera(); releaseImage() }
  async function deliver(text, ticket) {
    if (ticket !== generation || locked) return
    locked = true
    destroyCamera()
    releaseImage()
    try { await onCode(text) } finally { locked = false }
  }
  async function file(file) {
    if (locked) return
    stop(); const ticket = generation
    if (!file || !['image/png','image/jpeg','image/webp'].includes(file.type)) { onError('请选择PNG、JPEG或WebP二维码图片。'); return }
    if (file.size > 5 * 1024 * 1024) { onError('图片不能超过5MiB。'); return }
    const url = imageUrl = urls.createObjectURL(file)
    try {
      await new Promise((resolve, reject) => {
        const image = new ImageClass()
        image.onload = () => image.naturalWidth > 0 && image.naturalHeight > 0 && image.naturalWidth <= 4096 && image.naturalHeight <= 4096 ? resolve() : reject(new Error('图片边长必须在1至4096像素之间。'))
        image.onerror = () => reject(new Error('图片损坏或无法读取，请重新选择。'))
        image.src = url
      })
      if (ticket !== generation) return
      let result
      try { result = await reader.decodeFromImageUrl(url) }
      catch (primaryError) {
        if (ticket !== generation) return
        // Generated clean PNGs can defeat the generic finder-pattern detector.
        // Retry the same image pixels with ZXing's pure-barcode extraction only.
        try { result = await pureReader.decodeFromImageUrl(url) }
        catch { throw primaryError }
      }
      if (ticket !== generation) return
      const text = result.getText()
      if (!/^studyroom-seat:v1:[A-Za-z0-9_-]{43}$/.test(text)) throw new Error('座位码格式错误，请选择真实座位码图片。')
      await deliver(text, ticket)
    } catch (error) { if (ticket === generation) onError('图片中未能识别有效二维码：' + scanFailure(error)) }
    finally { if (imageUrl === url) releaseImage() }
  }
  async function camera(element) {
    if (locked || !element) return
    stop(); const ticket = generation
    if (globalThis.isSecureContext === false) { onError('摄像头需要 HTTPS 安全环境。手机请使用管理员提供的 https:// 局域网地址；电脑可用 localhost。也可上传二维码图片。'); return }
    onCamera(true)
    let scanner = null
    try {
      scanner = new QrScannerClass(element, result => {
        if (ticket !== generation) return
        const text = typeof result === 'string' ? result : result?.data
        if (text) void deliver(text, ticket)
      }, {
        preferredCamera: 'environment',
        maxScansPerSecond: 10,
        highlightScanRegion: false,
        highlightCode: false,
        returnDetailedScanResult: true
      })
      qrScanner = scanner
      await scanner.start()
      if (ticket !== generation) {
        if (qrScanner === scanner) { qrScanner = null; scanner.destroy?.() }
        return
      }
    } catch (error) {
      if (ticket === generation) { destroyCamera(); onError(scanFailure(error)) }
    }
  }
  return { file, camera, stop }
}
