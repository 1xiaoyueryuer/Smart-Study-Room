import request from './request'

// 局域网接入与共享看板：只读查询，不新增预约入口。
export const getLanInfo = () => request.get('/lan/info', { silent: true })
export const listLanDevices = () => request.get('/lan/devices', { silent: true })
export const getLanBoard = (date, start, end) => request.get('/lan/board', { params: { date, start, end }, silent: true })
export const getLanQr = () => request.get('/lan/qr.png', { responseType: 'blob', silent: true })
