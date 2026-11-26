// 只将服务端政策转换为表单输入；最终资格、开放和冲突仍由提交接口复核。
export function minuteValue(value, end = false) {
  if (end && value === '24:00') return 1440
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value || '')) throw new Error('时间须为HH:mm，开始不可24:00，结束可24:00')
  return Number(value.slice(0,2)) * 60 + Number(value.slice(3,5))
}
export function minuteText(value) {
  return `${String(Math.floor(value / 60)).padStart(2,'0')}:${String(value % 60).padStart(2,'0')}`
}
export function serverStartMinute(policy) {
  const match = policy.server_now?.match(/T([01][0-9]|2[0-3]):([0-5][0-9])(?::([0-5][0-9])(?:\.([0-9]+))?)?\+08:00$/)
  if (!match || policy.campus_zone !== 'Asia/Shanghai') throw new Error('服务端校园时间格式无效，请重新读取预约政策')
  return Number(match[1]) * 60 + Number(match[2]) + ((Number(match[3] || 0) > 0 || /[1-9]/.test(match[4] || '')) ? 1 : 0)
}
export function validateSlot(policy, date, start, end) {
  if (!policy || !policy.dates.includes(date)) throw new Error(`预约日期${date || '未选择'}已无效，请刷新政策并从服务端日期中选择`)
  const begin = minuteValue(start), finish = minuteValue(end,true)
  if (finish - begin < policy.min_duration_minutes) throw new Error(`预约至少${policy.min_duration_minutes}分钟，结束须晚于开始且不可跨预约日期`)
  if (date === policy.campus_today && begin < serverStartMinute(policy)) throw new Error('起点早于当前服务端时刻，请调整开始时间后重新查询')
  return finish - begin
}

export function validateOpeningWindow(windows, start, minutes) {
  if (!Array.isArray(windows) || !windows.length || !Number.isSafeInteger(minutes) || minutes < 1) return minuteValue(start) + minutes
  const begin = minuteValue(start), finish = begin + minutes
  const covered = windows.some(window => begin >= minuteValue(window.start) && finish <= minuteValue(window.end, true))
  if (!covered) {
    const ranges = windows.map(window => `${window.start}–${window.end}`).join('、')
    throw new Error(`结束时间 ${minuteText(finish)} 超出该空间开放时段 ${ranges}，请缩短学习时长或调整开始时间`)
  }
  return finish
}

export function validateAvailabilitySnapshot(date, start, minutes, snapshot) {
  if (!snapshot || snapshot.campus_zone !== 'Asia/Shanghai' || typeof snapshot.server_now !== 'string' || typeof snapshot.campus_today !== 'string' || !snapshot.room || !Array.isArray(snapshot.room.opening_windows)) {
    throw new Error('连续空档响应缺少当前服务端时刻或空间开放信息，请重新查询')
  }
  const currentMinute = serverStartMinute(snapshot)
  if (date === snapshot.campus_today && minuteValue(start) < currentMinute) {
    throw new Error(`开始时间不能早于当前服务端时刻 ${minuteText(currentMinute)}，请调整后重新查询`)
  }
  validateOpeningWindow(snapshot.room.opening_windows, start, minutes)
}
