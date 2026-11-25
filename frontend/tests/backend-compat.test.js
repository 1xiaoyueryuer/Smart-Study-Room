import test from 'node:test'
import assert from 'node:assert/strict'
import { complaintPayload, repairPriority } from '../src/composables/complaintForm.js'

test('repair form auto-grades by impact and safety without mapping rules', () => {
  const input = { type: 'service', description: '实际报修情况', roomId: 8, items: [], serviceKind: 'facility', repair: { faultType: '灯具', impactScope: 'one_seat', safetyRisk: 'none' }, unsafeArea: 'no' }
  const payload = complaintPayload(input)
  assert.equal(payload.service_kind, 'facility_repair')
  assert.equal(payload.unsafe_area, false)
  assert.match(payload.description, /系统自动分级：3级/)
  assert.equal(repairPriority({ impactScope: 'one_seat', safetyRisk: 'none', unsafeArea: 'no' }), 3)
  assert.equal(repairPriority({ impactScope: 'minor', safetyRisk: 'none', unsafeArea: 'no' }), 1)
  assert.equal(repairPriority({ impactScope: 'multiple', safetyRisk: 'none', unsafeArea: 'no' }), 4)
})

test('either safety condition forces level five and sends explicit booleans', () => {
  const value = complaintPayload({ type: 'service', description: '安全风险事实', roomId: 9, items: [], serviceKind: 'facility', repair: { faultType: '插座', impactScope: 'one_seat', safetyRisk: 'none' }, unsafeArea: 'yes' })
  assert.equal(value.safety_risk, false)
  assert.equal(value.unsafe_area, true)
  assert.match(value.description, /系统自动分级：5级/)
  assert.equal(repairPriority({ impactScope: 'one_seat', safetyRisk: 'yes', unsafeArea: 'no' }), 5)
})

test('other-service alias maps to the backend service topic contract', () => {
  const value = complaintPayload({ type: 'service', description: '卫生问题', roomId: 4, items: [], serviceKind: 'other', otherRequestType: '环境卫生' })
  assert.equal(value.service_kind, 'other_service')
  assert.equal(value.service_topic, '环境卫生')
  assert.equal(value.room_id, 4)
  assert.deepEqual(value.attachment_ids, [])
})
