import { BrowserQRCodeReader } from '@zxing/browser'
import { DecodeHintType } from '@zxing/library'

export function scanFailure(error) {
  const messages = {
    NotAllowedError: '摄像头权限被拒绝，请允许权限后重试，或上传座位码图片。',
    NotFoundError: '未找到摄像头，请连接设备或上传座位码图片。',
    NotReadableError: '摄像头被占用或无法读取，请关闭其他使用摄像头的程序后重试。',
    OverconstrainedError: '摄像头不支持所需配置，请换设备或上传图片。',
    SecurityError: '当前环境禁止访问摄像头，请使用HTTPS或localhost，或上传图片。'
  }
  return messages[error?.name] || error?.message || '未能识别座位码，请使用清晰、完整的二维码重试。'
}

// 每个页面只管理自己的流与图片URL；generation废弃离页后的异步结果。
export function createSeatScanner({ onCode, onError, onCamera = () => {}, reader = new BrowserQRCodeReader(), pureReader = new BrowserQRCodeReader(new Map([[DecodeHintType.PURE_BARCODE, true]])), mediaDevices = globalThis.navigator?.mediaDevices, urls = globalThis.URL, ImageClass = globalThis.Image } = {}) {
  let generation = 0, stream = null, controls = null, video = null, imageUrl = null, locked = false
  function stopCamera() {
    generation++
    controls?.stop(); controls = null
    stream?.getTracks().forEach(track => track.stop()); stream = null
    if (video) { video.srcObject = null; video = null }
    onCamera(false)
  }
  function releaseImage() { if (imageUrl) { urls.revokeObjectURL(imageUrl); imageUrl = null } }
  function stop() { stopCamera(); releaseImage() }
  async function deliver(text, ticket) {
    if (ticket !== generation || locked) return
    locked = true
    stopCamera()
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
  async function waitForVideoFrame(video) {
    if (!video || typeof video.videoWidth !== 'number') return
    if (video.videoWidth > 0 && video.videoHeight > 0) return
    await new Promise((resolve, reject) => {
      let timer
      const cleanup = () => {
        clearTimeout(timer)
        video.removeEventListener('loadedmetadata', check)
        video.removeEventListener('canplay', check)
        video.removeEventListener('resize', check)
      }
      const check = () => {
        if (video.videoWidth > 0 && video.videoHeight > 0) { cleanup(); resolve() }
      }
      timer = setTimeout(() => {
        cleanup()
        reject(new Error('摄像头画面未就绪，请确认浏览器支持视频预览，或改用上传座位码图片。'))
      }, 5000)
      video.addEventListener('loadedmetadata', check)
      video.addEventListener('canplay', check)
      video.addEventListener('resize', check)
    })
  }
  async function camera(element) {
    if (locked) return
    stop(); const ticket = generation
    if (globalThis.isSecureContext === false || !mediaDevices?.getUserMedia) { onError('摄像头需要 HTTPS 安全环境。手机请使用管理员提供的 https:// 局域网地址；电脑可用 localhost。也可上传二维码图片。'); return }
    onCamera(true)
    try {
      const acquired = await mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      if (ticket !== generation) { acquired.getTracks().forEach(track => track.stop()); return }
      stream = acquired; video = element
      // Some mobile browsers resolve getUserMedia before the preview has metadata;
      // starting ZXing immediately can capture a 0x0 frame and stop with an error.
      if (element) {
        try { element.srcObject = acquired } catch { /* ZXing will try again */ }
        try { element.muted = true; element.playsInline = true; element.setAttribute?.('playsinline', '') } catch { /* older browser */ }
        if (typeof element.play === 'function') { try { await element.play() } catch { /* waitForVideoFrame gives the explicit error */ } }
        await waitForVideoFrame(element)
      }
      const active = await reader.decodeFromStream(acquired, element, (result, error) => {
        if (result) void deliver(result.getText(), ticket)
        else if (error && !['NotFoundException','ChecksumException','FormatException'].includes(error.name) && ticket === generation) { stopCamera(); onError(scanFailure(error)) }
      })
      if (ticket !== generation) active.stop()
      else controls = active
    } catch (error) { if (ticket === generation) { stopCamera(); onError(scanFailure(error)) } }
  }
  return { file, camera, stop }
}
