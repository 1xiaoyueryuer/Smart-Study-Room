import request from './request'

// 信誉分、恢复时间和流水由服务端计算。
export function getCreditOverview() {
  return request.get('/credit')
}
