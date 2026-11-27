import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { complaintPayload, repairPriority } from '../src/composables/complaintForm.js'
import { appealPayload, reviewIntent } from '../src/composables/appealForm.js'
import { correctionIntent } from '../src/composables/checkinCorrection.js'
import { statsQuery } from '../src/composables/statsForm.js'

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

// 前后端字段契约：按 Requests.java 与各控制器/服务允许的字段逐项对齐。

const backend = new URL('../../backend/src/main/java/cn/studyroom/', import.meta.url)
const backendSource = async file => readFile(new URL(file, backend), 'utf8')

async function recordHeader(name) {
  const source = await backendSource('Requests.java')
  const match = source.match(new RegExp(`record ${name}\\(([\\s\\S]*?)\\)\\s*\\{`))
  assert.ok(match, `Requests.java 中找不到 record ${name}`)
  return match[1]
}

async function controller(file, pattern) {
  const source = await backendSource(file)
  const match = source.match(pattern)
  assert.ok(match, `${file} 中找不到约定内容`)
  return match[1]
}

function names(fields) {
  return new Set(Object.keys(fields))
}

function assertKeysAccepted(header, payload, label) {
  for (const key of Object.keys(payload)) {
    assert.match(header, new RegExp(`@JsonProperty\\("${key}"\\)|\\b${key}\\b`), `${label} 的字段 ${key} 未被后端接收`)
  }
}

test('facility repair payload uses only fields accepted by Requests.Complaint', async () => {
  const payload = complaintPayload({
    type: 'service',
    description: '台灯不亮',
    roomId: 1,
    items: [],
    serviceKind: 'facility',
    repair: { faultType: '照明/电气', impactScope: 'one_seat', safetyRisk: 'none' },
    unsafeArea: 'no'
  })
  const header = await recordHeader('Complaint')
  assertKeysAccepted(header, payload, '设施报修')
  for (const key of ['type', 'description', 'attachment_ids', 'room_id', 'service_kind', 'fault_type', 'impact_scope', 'safety_risk', 'unsafe_area']) {
    assert.ok(key in payload, `设施报修应提交 ${key}`)
  }
  assert.match(header, /@NotBlank @Size\(max=2000\) String description/, '描述仍为必填')
  assert.match(header, /@JsonProperty\("attachment_ids"\)/)
})

test('occupation payload never carries room or repair fields', async () => {
  const payload = complaintPayload({
    type: 'occupation',
    description: '座位被占用',
    items: [],
    reservationId: 5,
    context: { id: 5, status: 'checked_in' }
  })
  const header = await recordHeader('Complaint')
  assertKeysAccepted(header, payload, '预约与座位')
  assert.deepEqual(names(payload), new Set(['type', 'description', 'attachment_ids', 'reservation_id']))
  assert.match(header, /@JsonProperty\("reservation_id"\)/)
})

test('other service payload maps its topic to the backend service_topic field', async () => {
  const payload = complaintPayload({
    type: 'service',
    description: '走廊太吵',
    roomId: 2,
    items: [],
    serviceKind: 'other',
    otherRequestType: '噪音秩序'
  })
  const header = await recordHeader('Complaint')
  assertKeysAccepted(header, payload, '其他服务')
  assert.equal(payload.service_kind, 'other_service')
  assert.equal(payload.service_topic, '噪音秩序')
  assert.match(header, /@JsonProperty\("service_topic"\)/)
  assert.doesNotMatch(header, /@NotBlank @Size\(max=2000\)[^,]*serviceKind/, 'service_kind 仍是可选字段')
})

test('appeal payload plus operation_id matches every Requests.Appeal field', async () => {
  const payload = { ...appealPayload('申诉说明', []), operation_id: 'op-1' }
  const header = await recordHeader('Appeal')
  assertKeysAccepted(header, payload, '申诉')
  assert.deepEqual(names(payload), new Set(['description', 'attachment_ids', 'operation_id']))
  assert.match(header, /@JsonProperty\("operation_id"\)/)
  assert.match(header, /@JsonProperty\("attachment_ids"\)/)
})

test('appeal review intent carries the version and confirmation fields the backend expects', async () => {
  const intent = reviewIntent({ decision: 'approved', reason: '公开理由', verification_note: '私有依据', facts_confirmed: true }, 7)
  const payload = { ...intent, impact_hash: 'hash', operation_id: 'op-2' }
  const header = await recordHeader('AppealReviewConfirm')
  assertKeysAccepted(header, payload, '申诉审核')
  assert.equal(payload.version, 7)
  assert.equal(payload.facts_confirmed, true)
  for (const key of ['decision', 'reason', 'verification_note', 'impact_hash', 'operation_id']) {
    assert.ok(key in payload, `申诉审核应提交 ${key}`)
  }
})

test('complaint feedback and complaint response bodies use the backend JSON names', async () => {
  const feedback = { version: 3, operation_id: 'op-3', result: '已维修', basis: '现场确认' }
  const feedbackHeader = await recordHeader('ComplaintFeedback')
  assertKeysAccepted(feedbackHeader, feedback, '投诉回复')
  assert.match(feedbackHeader, /@JsonProperty\("operation_id"\)/)
  assert.match(feedbackHeader, /String result,String basis/)

  const response = { version: 3, operation_id: 'op-4', description: '异议说明' }
  const responseHeader = await recordHeader('ComplaintResponse')
  assertKeysAccepted(responseHeader, response, '投诉异议')
  assert.match(responseHeader, /@JsonProperty\("operation_id"\)/)
})

test('check-in correction intent adds exactly the keys the controller requires', async () => {
  const intent = correctionIntent({ checkin_at: '2026-11-27T09:00:00+08:00', reason: '公开理由', verification_note: '私有依据', facts_confirmed: true })
  const payload = { ...intent, operation_id: 'op-5' }
  const required = await controller(
    'CheckinCorrectionController.java',
    /body\.keySet\(\)\.equals\(Set\.of\(([^)]*)\)\)/
  )
  const requiredKeys = new Set(required.split(',').map(item => item.trim().replaceAll('"', '')))
  assert.deepEqual(names(payload), requiredKeys, '补签提交字段必须与控制器允许的集合完全一致')
  assert.equal(payload.facts_confirmed, true)
})

test('stats query never sends a key outside room_id and date', async () => {
  const allowed = await controller('StatsService.java', /Set\.of\(([^)]*)\)\.containsAll\(parameters\.keySet\(\)\)/)
  const allowedKeys = new Set(allowed.split(',').map(item => item.trim().replaceAll('"', '')))
  assert.deepEqual(allowedKeys, new Set(['room_id', 'date']))
  for (const input of [{}, { room_id: 2 }, { date: '2026-11-27' }, { room_id: 2, date: '2026-11-27' }]) {
    const query = statsQuery(input)
    assert.ok(Object.keys(query).every(key => allowedKeys.has(key)), `统计查询不得包含未授权参数：${Object.keys(query).join(',')}`)
  }
})

test('the complaint form still attaches operation_id because the backend requires it', async () => {
  const header = await recordHeader('Complaint')
  assert.match(header, /@JsonProperty\("operation_id"\) @NotBlank String operationId/)
  const form = await readFile(new URL('../src/components/ComplaintForm.vue', import.meta.url), 'utf8')
  assert.match(form, /operation_id:\s*crypto\.randomUUID\(\)/, '前端提交前必须生成操作ID')
})
