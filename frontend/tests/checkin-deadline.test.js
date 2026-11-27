import test from 'node:test'
import assert from 'node:assert/strict'
import { checkinDeadlineOf, deadlineLabel, serverNowMs } from '../src/composables/checkinDeadline.js'

test('check-in deadlines use the full campus date-time format', () => {
  const deadline = checkinDeadlineOf({
    res_date: '2026-11-26',
    start_time: '09:00',
    checkin_deadline: '2026-11-26T01:15:00Z',
  })
  assert.equal(deadline.text, '2026-11-26 09:15:00')
  assert.equal(deadlineLabel(deadline), '2026-11-26 09:15:00')
})

test('the derived deadline preserves date rollover and minute precision', () => {
  const deadline = checkinDeadlineOf({ res_date: '2026-11-26', start_time: '23:55' })
  assert.equal(deadline.text, '2026-11-27 00:10:00')
  assert.equal(deadline.baseText, '2026-11-27 00:10:00')
})

test('legacy time-only deadlines use the reservation date and full campus format', () => {
  const deadline = checkinDeadlineOf({ res_date: '2026-11-26', checkin_deadline: '9:15' })
  assert.equal(deadline.text, '2026-11-26 09:15:00')
  assert.equal(deadlineLabel(deadline), '2026-11-26 09:15:00')
  assert.equal(checkinDeadlineOf({ checkin_deadline: '9:15' }), null)
  assert.equal(deadlineLabel('9:15'), '—')
})

test('server now milliseconds come only from a parseable server timestamp', () => {
  assert.equal(serverNowMs({ server_now: '2026-11-27T10:00:00+08:00' }), Date.parse('2026-11-27T10:00:00+08:00'))
  assert.equal(serverNowMs({}), null)
  assert.equal(serverNowMs(null), null)
  assert.equal(serverNowMs({ server_now: 'not-a-time' }), null)
})
