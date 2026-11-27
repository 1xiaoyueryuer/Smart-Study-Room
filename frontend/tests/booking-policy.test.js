import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { minuteValue, minuteText, normalizeStartTime, parseLearningDuration, serverStartMinute, validateSlot, validateOpeningWindow, validateAvailabilitySnapshot } from '../src/composables/bookingPolicy.js'
import { activeBookingRestrictions, isBookingRestricted } from '../src/composables/restrictionForm.js'
import { windowKey, validateWindowSlot, shortfallText } from '../src/composables/availabilitySelection.js'

const policy = { campus_today: '2026-11-20', dates: ['2026-11-20', '2026-11-21', '2026-11-22'], campus_zone: 'Asia/Shanghai', server_now: '2026-11-20T19:00:00+08:00', min_duration_minutes: 30 }

test('minute values preserve 24:00 as the right-open end boundary', () => {
  assert.equal(minuteValue('08:00'), 480)
  assert.equal(minuteValue('24:00', true), 1440)
  assert.throws(() => minuteValue('24:00'), /24:00/)
  assert.equal(minuteText(1440), '24:00')
  assert.equal(minuteText(8 * 60 + 5), '08:05')
})

test('booking start input accepts hour-only and single-digit hour forms', () => {
  assert.equal(normalizeStartTime('9'), '09:00')
  assert.equal(normalizeStartTime('9:00'), '09:00')
  assert.equal(normalizeStartTime('09:00'), '09:00')
  assert.equal(normalizeStartTime(' 8:05 '), '08:05')
  assert.equal(normalizeStartTime('7'), '07:00')
  assert.throws(() => normalizeStartTime('9:60'), /有效的24小时制/)
  assert.throws(() => normalizeStartTime('9:'), /有效的24小时制/)
  assert.throws(() => normalizeStartTime('24:00'), /有效的24小时制/)
})

test('typed learning duration respects the same limits as the picker', () => {
  const parse = value => parseLearningDuration(value, 30, 840)
  assert.equal(parse('0:30'), 30)
  assert.equal(parse('1'), 60)
  assert.equal(parse('1：30'), 90)
  assert.equal(parse('14:00'), 840)
  assert.throws(() => parse(''), /有效的学习时长/)
  assert.throws(() => parse('1:60'), /有效的学习时长/)
  assert.throws(() => parse('00:29'), /00:30–14:00/)
  assert.throws(() => parse('14:01'), /00:30–14:00/)
})

test('date range is D, D+1 and D+2 only', () => {
  assert.equal(validateSlot(policy, '2026-11-20', '19:30', '20:30'), 60)
  assert.equal(validateSlot(policy, '2026-11-21', '08:00', '09:00'), 60)
  assert.equal(validateSlot(policy, '2026-11-22', '08:00', '09:00'), 60)
  assert.throws(() => validateSlot(policy, '2026-11-23', '08:00', '09:00'), /日期/)
})

test('a booking is at least 30 minutes and may be longer than four hours', () => {
  assert.throws(() => validateSlot(policy, '2026-11-21', '08:00', '08:29'), /至少30分钟/)
  assert.equal(validateSlot(policy, '2026-11-21', '08:00', '08:30'), 30)
  assert.equal(validateSlot(policy, '2026-11-21', '08:00', '12:01'), 241)
  assert.equal(validateSlot(policy, '2026-11-21', '08:00', '24:00'), 960)
})

test('the selected start cannot be before the current server time on today', () => {
  assert.equal(serverStartMinute(policy), 19 * 60)
  assert.throws(() => validateSlot(policy, '2026-11-20', '18:59', '19:59'), /早于当前服务端时刻/)
  assert.equal(validateSlot(policy, '2026-11-20', '19:00', '20:00'), 60)
})

test('booking restriction state uses preloaded eligibility, prefers a real failure, and ignores other block reasons', () => {
  assert.deepEqual(activeBookingRestrictions({can_book: true}, null), [])
  assert.equal(isBookingRestricted({can_book: true}, null), false)
  const records = [{id: 1, source: 'automatic'}]
  assert.equal(isBookingRestricted({can_book: false, blocked_by: 'restrictions', active_restrictions: records}, null), true)
  assert.deepEqual(activeBookingRestrictions({can_book: false, blocked_by: 'restrictions', active_restrictions: records}, null), records)
  assert.deepEqual(activeBookingRestrictions({can_book: false, blocked_by: 'role', active_restrictions: records}, null), [])
  const failureRecords = [{id: 2, source: 'manual'}]
  assert.deepEqual(activeBookingRestrictions({can_book: false, blocked_by: 'restrictions', active_restrictions: records}, {active_restrictions: failureRecords}), failureRecords)
})

test('opening window check explains an end that exceeds closing time instead of only showing no slots', () => {
  const windows = [{start: '08:00', end: '22:00'}]
  assert.equal(validateOpeningWindow(windows, '19:30', 120), 21 * 60 + 30)
  assert.throws(() => validateOpeningWindow(windows, '21:30', 60), /结束时间 22:30 超出该空间开放时段 08:00–22:00/)
  assert.throws(() => validateOpeningWindow([{start: '08:00', end: '12:00'}, {start: '13:00', end: '17:00'}], '11:30', 60), /结束时间 12:30 超出/)
})

test('window identity and actual selection stay inside the same continuous gap', () => {
  const window = { room_id: 1, seat_id: 2, available_start: '18:30', available_end: '22:00' }
  assert.equal(windowKey(window), '1:2:18:30:22:00')
  assert.equal(validateWindowSlot(policy, '2026-11-20', '19:00', '20:00', window), 60)
  assert.throws(() => validateWindowSlot(policy, '2026-11-20', '21:30', '22:30', window), /连续空档/)
  assert.equal(shortfallText(120, '19:00', '19:30'), '本次30分钟，短于找座时输入的120分钟')
})

test('BookingView uses fixed start + duration + optional preference and no strategy selector', async () => {
  const source = await readFile(new URL('../src/views/BookingView.vue', import.meta.url), 'utf8')
  assert.match(source, /座位偏好（可选）/)
  assert.match(source, /靠窗/)
  assert.match(source, /插座/)
  assert.match(source, /suggested_start === query\.startTime/)
  assert.match(source, /suggested_end === requestedEnd/)
  assert.match(source, /serverStartMinute\(value\)/)
  assert.match(source, /validateAvailabilitySnapshot\(query\.date/)
  assert.match(source, /restrictionFailure\.value = null/)
  assert.match(source, /getBookingEligibility/)
  assert.match(source, /activeRestrictions/)
  assert.match(source, /restricted \|\| !policy/)
  assert.doesNotMatch(source, /找座方案/)
  assert.doesNotMatch(source, /strategyOptions/)
  assert.match(source, /normalizeStartTime\(searchStart\.value\)/)
  assert.match(source, /inputmode="text" maxlength="5" placeholder="9、9:00 或 09:00"/)
  assert.match(source, /openingHour = 8, lastStartHour = 22/)
  assert.match(source, /startMinute < openingHour \* 60 \|\| startMinute > lastStartHour \* 60/)
  assert.doesNotMatch(source, /formatCampusDateTime\(window\.(?:available|suggested)_/)
})

test('availability snapshot supplies the current server time and room opening schedule', () => {
  const snapshot = {
    campus_zone: 'Asia/Shanghai',
    campus_today: '2026-11-20',
    server_now: '2026-11-20T19:00:00+08:00',
    room: { opening_windows: [{ start: '08:00', end: '22:00' }] },
  }
  assert.doesNotThrow(() => validateAvailabilitySnapshot('2026-11-20', '19:00', 60, snapshot))
  assert.throws(() => validateAvailabilitySnapshot('2026-11-20', '18:59', 60, snapshot), /当前服务端时刻 19:00/)
  assert.throws(() => validateAvailabilitySnapshot('2026-11-20', '21:30', 60, snapshot), /超出该空间开放时段/)
  assert.throws(() => validateAvailabilitySnapshot('2026-11-21', '19:00', 60, { ...snapshot, server_now: '2026-11-20T19:00:00' }), /时间格式无效/)
  assert.throws(() => validateAvailabilitySnapshot('2026-11-21', '19:00', 60, { ...snapshot, room: {} }), /缺少当前服务端时刻或空间开放信息/)
})
