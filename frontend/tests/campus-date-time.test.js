import test from 'node:test'
import assert from 'node:assert/strict'
import { formatCampusDateTime } from '../src/composables/campusDateTime.js'

test('campus timestamps display in Asia/Shanghai without ISO details', () => {
  assert.equal(formatCampusDateTime('2026-11-26T11:32:49.890123+08:00'), '2026-11-26 11:32:49')
  assert.equal(formatCampusDateTime('2026-11-26T03:32:49Z'), '2026-11-26 11:32:49')
  assert.equal(formatCampusDateTime('2026-11-26T04:32:49-07:00'), '2026-11-26 19:32:49')
})

test('offset-free backend timestamps are interpreted as campus-local values', () => {
  assert.equal(formatCampusDateTime('2026-11-26 11:32:49'), '2026-11-26 11:32:49')
  assert.equal(formatCampusDateTime('2026-11-26T11:32:49.123456'), '2026-11-26 11:32:49')
})

test('missing and invalid timestamps do not leak unformatted values', () => {
  assert.equal(formatCampusDateTime(''), '—')
  assert.equal(formatCampusDateTime(null), '—')
  assert.equal(formatCampusDateTime('not-a-timestamp'), '—')
})
