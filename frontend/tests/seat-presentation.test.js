import test from 'node:test'
import assert from 'node:assert/strict'
import { seatPosition, seatType, seatState, getWindowSides } from '../src/components/seat3d/seatPresentation.js'
import { queryRequiredMinutes } from '../src/composables/availabilitySelection.js'

test('seat position is centred against the room grid', () => {
  const room = { seat_rows: 2, seat_cols: 2 }
  assert.deepEqual(seatPosition(room, { row_no: 1, col_no: 1 }), { x: -0.9, z: -0.95 })
  assert.deepEqual(seatPosition(room, { row_no: 2, col_no: 2 }), { x: 0.9, z: 0.95 })
  const odd = seatPosition({ seat_rows: 3, seat_cols: 3 }, { row_no: 2, col_no: 2 })
  assert.deepEqual(odd, { x: 0, z: 0 })
})

test('seat type reflects computer desks before power availability', () => {
  assert.equal(seatType({ zone: 'computer', has_power: false }), '电脑桌')
  assert.equal(seatType({ zone: 'quiet', has_power: true }), '插座桌')
  assert.equal(seatType({ zone: 'regular', has_power: false }), '普通桌')
})

test('seat state handles the continuous-window list returned by availability search', () => {
  const preferences = ['window']
  const base = { status: 'available', id: 1, near_window: true }
  assert.equal(seatState({ ...base, available_windows: [] }, null, preferences), 'no_window')
  assert.equal(seatState({ ...base, available_windows: [{ start: '09:00' }] }, 1, preferences), 'selected')
  assert.equal(seatState({ ...base, available_windows: [{ start: '09:00' }] }, null, preferences), 'preferred')
  assert.equal(seatState({ ...base, near_window: false, available_windows: [{ start: '09:00' }] }, null, preferences), 'available')
})

test('seat state falls back to slot bookability, occupancy, selection and preference', () => {
  const preferences = ['window']
  assert.equal(seatState({ status: 'available', bookable_for_slot: false }, null), 'disabled')
  assert.equal(seatState({ status: 'available', occupied: true }, null), 'occupied')
  assert.equal(seatState({ status: 'available', id: 5 }, 5), 'selected')
  assert.equal(seatState({ status: 'available', near_window: true }, null, preferences), 'preferred')
  assert.equal(seatState({ status: 'available', near_window: false }, null, preferences), 'available')
  assert.equal(seatState({ status: 'maintenance' }, null), 'maintenance')
  assert.equal(seatState({ status: 'disabled' }, null), 'disabled')
})

test('window sides require a complete edge row or column of window seats', () => {
  const room = { seat_rows: 2, seat_cols: 3 }
  const seats = [
    { row_no: 1, col_no: 1, near_window: true },
    { row_no: 1, col_no: 2, near_window: true },
    { row_no: 1, col_no: 3, near_window: true },
    { row_no: 2, col_no: 1, near_window: true },
    { row_no: 2, col_no: 2, near_window: false },
    { row_no: 2, col_no: 3, near_window: true }
  ]
  assert.deepEqual(getWindowSides(room, seats), { top: true, bottom: false, left: true, right: true })
  assert.deepEqual(getWindowSides(room, seats.slice(0, 2)), { top: false, bottom: false, left: false, right: false })
  assert.deepEqual(getWindowSides(null, seats), { top: false, bottom: false, left: false, right: false })
  assert.deepEqual(getWindowSides(room, []), { top: false, bottom: false, left: false, right: false })
})

test('required minutes only accepts decimal integers of at least 30 within range', () => {
  assert.equal(queryRequiredMinutes('exact', '030'), null, '非时长策略不校验输入')
  assert.equal(queryRequiredMinutes('duration', '30'), 30)
  assert.equal(queryRequiredMinutes('duration', '090'), 90)
  assert.equal(queryRequiredMinutes('duration', 2147483647), 2147483647)
  assert.throws(() => queryRequiredMinutes('duration', '29'), /至少30分钟/)
  assert.throws(() => queryRequiredMinutes('duration', '30.5'), /十进制整数/)
  assert.throws(() => queryRequiredMinutes('duration', '-30'), /十进制整数/)
  assert.throws(() => queryRequiredMinutes('duration', '1e3'), /十进制整数/)
  assert.throws(() => queryRequiredMinutes('duration', ' 30 '), /十进制整数/)
  assert.throws(() => queryRequiredMinutes('duration', '2147483648'), /超出可处理的整数范围/)
  assert.throws(() => queryRequiredMinutes('duration', '9007199254740993'), /超出可处理的整数范围/)
})
