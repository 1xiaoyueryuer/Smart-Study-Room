// 局域网看板的时间选项与默认值：与预约规则一致，按整30分钟、08:00—24:00。
export function buildTimes(from, to, step) {
  const times = []
  for (let minute = from; minute <= to; minute += step) times.push(timeText(minute))
  return times
}

export function minuteOf(text) {
  const [hour, minute] = String(text).split(':').map(Number)
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return NaN
  return hour * 60 + minute
}

export function timeText(minutes) {
  if (minutes === 1440) return '24:00'
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export const START_TIMES = buildTimes(480, 1410, 30)
export const END_TIMES = buildTimes(510, 1440, 30)

/** 默认看板窗口：校园今天，开始时间向上取整到下一个30分钟，优先近两小时。 */
export function defaultBoardWindow(serverNow, dates) {
  const date = dates?.[0] || (serverNow ? String(serverNow).slice(0, 10) : '')
  let start = 14 * 60
  if (serverNow) {
    const minute = minuteOf(String(serverNow).slice(11, 16))
    if (Number.isInteger(minute)) start = Math.ceil(Math.max(minute, 480) / 30) * 30
  }
  start = Math.min(Math.max(start, 480), 1290)
  return { date, start: timeText(start), end: timeText(Math.min(start + 120, 1440)) }
}

export function adjustEnd(start, end) {
  const startMinute = minuteOf(start)
  const endMinute = minuteOf(end)
  if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute) || endMinute > startMinute) return end
  return timeText(Math.min(startMinute + 30, 1440))
}

export function accessLabel(access) {
  return { loopback: '本机', lan: '局域网', other: '非局域网', unknown: '未知' }[access] || '未知'
}

export function roleLabel(role) {
  return { student: '学生', staff: '教职工', admin: '管理员' }[role] || role || '未知'
}

export function activeLabel(seconds) {
  const value = Number(seconds)
  if (!Number.isFinite(value) || value < 0) return '未知'
  if (value < 60) return `${Math.floor(value)}秒前`
  return `${Math.floor(value / 60)}分钟前`
}
