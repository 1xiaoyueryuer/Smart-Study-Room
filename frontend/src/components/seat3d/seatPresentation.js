export const zoneName = { quiet: '静音区', regular: '普通区', discussion: '研讨区', computer: '机房区' }
export function seatPosition(room, seat) {
  return { x: (seat.col_no - (room.seat_cols + 1) / 2) * 1.8, z: (seat.row_no - (room.seat_rows + 1) / 2) * 1.9 }
}
export function seatType(s) {
  return s.zone === 'computer' ? '电脑桌' : s.has_power ? '插座桌' : '普通桌'
}

export function seatPreferenceCount(seat, preferences = []) {
  if (!seat || !Array.isArray(preferences)) return 0
  return preferences.reduce((count, preference) => {
    if (preference === 'window' && seat.near_window) return count + 1
    if (preference === 'power' && seat.has_power) return count + 1
    return count
  }, 0)
}

export function matchesSeatPreferences(seat, preferences = []) {
  return Array.isArray(preferences) && preferences.length > 0 && seatPreferenceCount(seat, preferences) === preferences.length
}

export function rankSeatsByPreference(seats, preferences = []) {
  if (!Array.isArray(seats)) return []
  const hasPreferences = Array.isArray(preferences) && preferences.length > 0
  return seats
    .map((seat, index) => ({
      seat,
      index,
      score: seatPreferenceCount(seat, preferences),
      eligible: seat?.status === 'available' && (!Array.isArray(seat.matching_windows) || seat.matching_windows.length > 0),
    }))
    .sort((left, right) => {
      if (!hasPreferences) return left.index - right.index
      if (left.eligible !== right.eligible) return Number(right.eligible) - Number(left.eligible)
      if (left.eligible && left.score !== right.score) return right.score - left.score
      return left.index - right.index
    })
    .map(({ seat }) => seat)
}

export function seatState(s, selectedId, preferences = []) {
  if (s.status !== 'available') return s.status === 'maintenance' ? 'maintenance' : 'disabled'
  if (Array.isArray(s.matching_windows)) {
    if (!s.matching_windows.length) return 'no_window'
    if (s.id === selectedId) return 'selected'
    return matchesSeatPreferences(s, preferences) ? 'preferred' : 'available'
  }
  if (Array.isArray(s.available_windows)) {
    if (!s.available_windows.length) return 'no_window'
    if (s.id === selectedId) return 'selected'
    return matchesSeatPreferences(s, preferences) ? 'preferred' : 'available'
  }
  if (s.bookable_for_slot === false) return 'disabled'
  if (s.occupied) return 'occupied'
  if (s.id === selectedId) return 'selected'
  if (matchesSeatPreferences(s, preferences)) return 'preferred'
  return 'available'
}
export const stateLabels = { available: '符合筛选', preferred: '符合偏好', selected: '已选座位', no_window: '不符合筛选', occupied: '已占用', maintenance: '维护中', disabled: '已停用' }
export const stateColors = { available: '#69bca8', preferred: '#e6c44b', no_window: '#a5aab2', selected: '#5578ee', occupied: '#e3a363', maintenance: '#b19bbd', disabled: '#89929e' }
export function getWindowSides(room, seats) {
  const sides = { top: false, bottom: false, left: false, right: false }
  if (!room || !seats.length) return sides
  const edge = { top: [], bottom: [], left: [], right: [] }
  for (const s of seats) {
    if (s.row_no === 1) edge.top.push(s)
    if (s.row_no === room.seat_rows) edge.bottom.push(s)
    if (s.col_no === 1) edge.left.push(s)
    if (s.col_no === room.seat_cols) edge.right.push(s)
  }
  for (const side of Object.keys(sides)) {
    sides[side] = edge[side].length === (['top', 'bottom'].includes(side) ? room.seat_cols : room.seat_rows) && edge[side].every(s => s.near_window)
  }
  return sides
}
