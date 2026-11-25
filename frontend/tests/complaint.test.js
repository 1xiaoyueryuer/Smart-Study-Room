import test from 'node:test'
import assert from 'node:assert/strict'
import { complaintPayload, repairPriority, complaintDisplayType, serviceKinds, serviceTopics, validateEvidenceFile, serviceProgressPayload } from '../src/composables/complaintForm.js'

const base = { description: '工程模拟说明', items: [], context: null }

test('service complaints require a room and never bind a reservation', () => {
  const payload = complaintPayload({ ...base, type: 'service', serviceKind: 'other', otherRequestType: '环境卫生', roomId: 1 })
  assert.equal(payload.type, 'service')
  assert.equal(payload.service_kind, 'other_service')
  assert.equal(payload.service_topic, '环境卫生')
  assert.equal(payload.room_id, 1)
  assert.equal('reservation_id' in payload, false)
  assert.throws(() => complaintPayload({ ...base, type: 'service', serviceKind: 'other', otherRequestType: '环境卫生', roomId: null }), /必须选择所属空间/)
  assert.throws(() => complaintPayload({ ...base, type: 'service', serviceKind: 'other', otherRequestType: '环境卫生', roomId: 1, reservationId: 5 }), /不关联预约/)
})

test('occupation complaints require the caller-owned reservation context', () => {
  const payload = complaintPayload({ ...base, type: 'occupation', reservationId: 5, context: { id: 5, status: 'cancelled' } })
  assert.equal(payload.type, 'occupation')
  assert.equal(payload.reservation_id, 5)
  assert.equal('room_id' in payload, false)
  assert.throws(() => complaintPayload({ ...base, type: 'occupation' }), /必须关联本人预约/)
  assert.throws(() => complaintPayload({ ...base, type: 'occupation', reservationId: 5, context: { id: 6 } }), /尚未核对成功/)
})

test('facility repair carries fault facts but no client-invented priority', () => {
  const payload = complaintPayload({ ...base, type: 'service', serviceKind: 'facility', roomId: 1, repair: { faultType: ' 照明/电气 ', impactScope: 'one_seat', safetyRisk: 'none' }, unsafeArea: 'no' })
  assert.equal(payload.service_kind, 'facility_repair')
  assert.equal(payload.fault_type, '照明/电气')
  assert.equal(payload.impact_scope, 'one_seat')
  assert.equal(payload.safety_risk, false)
  assert.equal(payload.unsafe_area, false)
  assert.equal('initial_priority' in payload, false)
  assert.equal('priority' in payload, false)
  assert.match(payload.description, /系统自动分级：3级/)
})

test('system auto grading maps impact scope and safety to 1-5', () => {
  assert.equal(repairPriority({ impactScope: 'minor', safetyRisk: 'none', unsafeArea: 'no' }), 1)
  assert.equal(repairPriority({ impactScope: 'inconvenient', safetyRisk: 'none', unsafeArea: 'no' }), 2)
  assert.equal(repairPriority({ impactScope: 'one_seat', safetyRisk: 'none', unsafeArea: 'no' }), 3)
  assert.equal(repairPriority({ impactScope: 'multiple', safetyRisk: 'none', unsafeArea: 'no' }), 4)
  assert.equal(repairPriority({ impactScope: 'one_seat', safetyRisk: 'yes', unsafeArea: 'no' }), 5)
  assert.equal(repairPriority({ impactScope: 'minor', safetyRisk: 'none', unsafeArea: 'yes' }), 5)
})

test('facility repair requires fault, impact, safety and area safety fields', () => {
  const repair = { faultType: '照明/电气', impactScope: 'one_seat', safetyRisk: 'none' }
  assert.throws(() => complaintPayload({ ...base, type: 'service', serviceKind: 'facility', roomId: 1, repair: { ...repair, impactScope: '' }, unsafeArea: 'no' }), /设施报修字段/)
  assert.throws(() => complaintPayload({ ...base, type: 'service', serviceKind: 'facility', roomId: 1, repair: { ...repair, safetyRisk: '' }, unsafeArea: 'no' }), /设施报修字段/)
  assert.throws(() => complaintPayload({ ...base, type: 'service', serviceKind: 'facility', roomId: 1, repair, unsafeArea: null }), /设施报修字段/)
})

test('other service rejects repair photos and unknown service kinds', () => {
  const item = { phase: 'uploaded', metadata: { id: '00000000-0000-4000-8000-000000000001' } }
  assert.throws(() => complaintPayload({ ...base, type: 'service', serviceKind: 'other', otherRequestType: '环境卫生', roomId: 1, items: [item] }), /不接收设施报修现场照片/)
  assert.throws(() => complaintPayload({ ...base, type: 'service', serviceKind: 'unknown', roomId: 1 }), /请选择具体服务类型/)
})

test('description length and service type dictionaries stay bounded', () => {
  assert.throws(() => complaintPayload({ ...base, description: ' ', type: 'service', serviceKind: 'other', otherRequestType: '环境卫生', roomId: 1 }), /1至2000/)
  assert.throws(() => complaintPayload({ ...base, description: '字'.repeat(2001), type: 'service', serviceKind: 'other', otherRequestType: '环境卫生', roomId: 1 }), /1至2000/)
  assert.match(serviceKinds.facility, /设施报修/)
  assert.match(serviceKinds.other, /其他服务问题/)
  assert.equal(serviceTopics['环境卫生'], '环境卫生')
})

test('historical service complaints without subtype remain explicit', () => {
  assert.equal(complaintDisplayType({ type: 'service', service_kind: null }), '历史服务问题（类别未留存）')
  assert.equal(complaintDisplayType({ type: 'service', service_kind: 'facility_repair' }), '设施报修')
  assert.equal(complaintDisplayType({ type: 'occupation' }), '预约与座位问题')
})

test('evidence validation enforces byte and pixel bounds and always releases inspection URLs', async () => {
  const revoked = [], urls = { createObjectURL: () => 'blob:local', revokeObjectURL: url => revoked.push(url) }
  class Image { naturalWidth = 5000; naturalHeight = 4000; set src(value) { queueMicrotask(() => this.onload()) } }
  await validateEvidenceFile({ type: 'image/png', size: 100 }, { urls, ImageClass: Image })
  assert.equal(revoked.length, 1)
  class TooLarge extends Image { naturalWidth = 10001 }
  await assert.rejects(validateEvidenceFile({ type: 'image/jpeg', size: 100 }, { urls, ImageClass: TooLarge }), /10000/)
  await assert.rejects(validateEvidenceFile({ type: 'image/webp', size: 100 }, { urls, ImageClass: Image }), /PNG或JPEG/)
  await assert.rejects(validateEvidenceFile({ type: 'image/png', size: 5 * 1024 * 1024 + 1 }, { urls, ImageClass: Image }), /5MiB/)
})

test('repair handoff payload remains structured with explicit offset and bounds', () => {
  const payload = serviceProgressPayload({ stage: 'handoff', maintenance_channel: '后勤报修平台', handed_off_at: '2026-11-20T09:10', public_note: '已转交现有渠道' })
  assert.equal(payload.stage, 'handoff')
  assert.equal(payload.handed_off_at, '2026-11-20T09:10:00+08:00')
  assert.throws(() => serviceProgressPayload({ stage: 'unknown', maintenance_channel: 'x', handed_off_at: '2026-11-20T09:10', public_note: 'x' }), /进度类型/)
})
