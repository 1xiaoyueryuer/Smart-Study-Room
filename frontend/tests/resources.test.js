import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import {  validateSlot, minuteValue, minuteText, serverStartMinute } from '../src/composables/bookingPolicy.js'
import { bookingRestrictionDetails } from '../src/composables/restrictionForm.js'
import { windowKey, validateWindowSlot, queryRequiredMinutes, shortfallText } from '../src/composables/availabilitySelection.js'
import { operationReason } from '../src/components/admin/userForm.js'
import { ref, computed } from 'vue'
import { usePagination } from '../src/composables/usePagination.js'

const room = () => ({ id: 1, name: '测试空间', building: '教学楼', floor: 'B1', location: '东侧', enabled: true, seat_count: 2, capacity: 1, bookable_capacity: 1, seat_rows: 30, seat_cols: 30, version: 3, open_time: '08:00', close_time: '22:00', description: '' })
const seat = () => ({ id: 2, seat_no: 'A1', row_no: 1, col_no: 1, zone: 'regular', status: 'available', has_power: false, near_window: false, occupied: false, bookable_for_slot: true, opening_windows: [{start:'08:00',end:'22:00'}], version: 5 })
async function script(path, mocks, exports, extra = {}) {
  const source = (await readFile(new URL(path, import.meta.url), 'utf8')).split('<script setup>')[1].split('</script>')[0]
  const context = vm.createContext({ defineEmits: () => () => {}, defineExpose() {}, ...extra })
  const module = new vm.SourceTextModule(source + `\nexport { ${exports} }`, { context })
  await module.link(specifier => {
    const values = mocks[specifier] || (specifier.endsWith('.vue') ? { default: {} } : null)
    assert.ok(values, specifier)
    return new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value) }, { context })
  })
  await module.evaluate()
  return module.namespace
}
async function resources(overrides = {}) {
  const effects = { calls: [], summaries: [] }
  const api = {
    createRoom: async data => { effects.calls.push(['createRoom', data]); return { data: room() } },
    updateRoom: async (id, data) => { effects.calls.push(['updateRoom', id, data]); return { data: room() } },
    listRoomSeats: async () => { effects.calls.push(['seats']); return { data: { room: room(), seats: [seat()] } } },
    createSeat: async (id, data) => { effects.calls.push(['createSeat', id, data]); return { data: seat() } },
    updateSeat: async (id, data) => { effects.calls.push(['updateSeat', id, data]); return { data: seat() } },
    deleteRoom: async () => ({}), deleteSeat: async () => ({}), batchGenSeats: async () => ({ data: { created: 1 } }),
    batchGenerateSeatCodes: async data => { effects.calls.push(['batchCodes', data]); return { data: { total_seats: 3, generated: 2, skipped: 1 } } }, ...overrides
  }
  const page = await script('../src/components/admin/ResourceManagement.vue', {
    vue: { ref, computed, onMounted() {} },
    '../../api/room': { getRooms: overrides.getRooms || (async () => { effects.calls.push(['rooms']); return { data: [room()] } }) },
    '../../api/admin': api,
    './userForm.js': { operationReason },
    '../../composables/usePagination': { usePagination },
    '../ui/feedback': { message: { success() {} } }
  }, 'loadRooms, openCreate, openEdit, saveRoom, roomForm, roomDialog, formError, openSeats, editSeat, saveSeat, seatForm, seatDialog, seatRoom, removeResource, deleteForm, saveDelete, deleteDialog, changeConfirm, writeNotice, openBatchCodes, saveBatchCodes, batchCodeReason, batchCodeDialog, batchCodeError', { defineEmits: () => (_, value) => effects.summaries.push(value) })
  page.changeConfirm.value = {run:overrides.confirmChange || (async proposal=>{effects.calls.push(['change',proposal]);return{operation_id:'test-operation',cancelled_count:0}})}
  return { ...page, effects }
}
test('resource summary uses actual seat counts and capacity rather than layout multiplication', async () => {
  const page = await resources()
  await page.loadRooms()
  assert.equal(page.effects.summaries[0].seats, 2)
  assert.equal(page.effects.summaries[0].capacity, 1)
})
test('room editing sends expected version, string B1 floor and explicit public reason', async () => {
  const page = await resources()
  page.openEdit(room())
  page.roomForm.value.reason = '更新公开位置'
  await page.saveRoom()
  const call = page.effects.calls[0]
  assert.equal(call[0], 'change');assert.equal(call[1].change_type,'room.update');assert.equal(call[1].target_id,1)
  assert.equal(call[1].payload.floor, 'B1')
  assert.equal(call[1].payload.version, 3)
  assert.equal(call[1].payload.reason, '更新公开位置')
  assert.equal('open_time' in call[1].payload, false)
  assert.equal('close_time' in call[1].payload, false)
  assert.equal(page.roomDialog.value, false)
  assert.equal(page.writeNotice.value, '资源变更已保存。')
})
test('a recovered resource change reports actual cancellations without technical receipt wording', async () => {
  const page = await resources({ confirmChange: async () => ({ cancelled_count: 2, replayed: true }) })
  await page.openSeats(room())
  page.editSeat(seat())
  page.seatForm.value.reason = '座位停用'
  await page.saveSeat()
  assert.equal(page.writeNotice.value, '资源变更已保存，已取消 2 条受影响的预约。')
})
test('single seat creation uses room version and editing uses seat version; both refresh real resource data', async () => {
  const page = await resources()
  await page.openSeats(room())
  page.editSeat()
  page.seatForm.value.seat_no = 'A2'
  page.seatForm.value.reason = '新增模拟座位'
  await page.saveSeat()
  const created = page.effects.calls.find(call => call[0] === 'createSeat')
  assert.equal(created[2].version, 3)
  assert.ok(page.effects.calls.some(call => call[0] === 'rooms'))
  page.editSeat(seat())
  page.seatForm.value.reason = '更新模拟座位'
  await page.saveSeat()
  assert.equal(page.effects.calls.find(call => call[0] === 'change' && call[1].change_type === 'seat.update')[1].payload.version, 5)
})
test('resource conflict preserves attempted input and instructs refresh rather than silently replacing version', async () => {
  const page = await resources({ confirmChange: async () => { throw { status: 409, message: '版本过期' } } })
  page.openEdit(room())
  page.roomForm.value.name = '希望更新的名称'
  page.roomForm.value.reason = '更新位置'
  await page.saveRoom()
  assert.equal(page.roomDialog.value, true)
  assert.equal(page.roomForm.value.name, '希望更新的名称')
  assert.equal(page.roomForm.value.version, 3)
  assert.match(page.formError.value, /刷新资源/)
})
test('historical resource deletion failure keeps operation reason in dialog', async () => {
  const page = await resources({ deleteSeat: async () => { throw { status: 409, message: '资源有历史记录' } } })
  page.removeResource(seat(), true)
  page.deleteForm.value.reason = '误建座位核查'
  await page.saveDelete()
  assert.equal(page.deleteDialog.value, true)
  assert.equal(page.deleteForm.value.reason, '误建座位核查')
  assert.match(page.formError.value, /历史记录/)
})
test('resource DELETE API retains version and reason in JSON body', async () => {
  const calls = []
  const context = vm.createContext({})
  const module = new vm.SourceTextModule(await readFile(new URL('../src/api/admin.js', import.meta.url), 'utf8'), { context })
  await module.link(() => new vm.SyntheticModule(['default'], function () { this.setExport('default', { delete: (...args) => { calls.push(args) } }) }, { context }))
  await module.evaluate()
  module.namespace.deleteRoom(1, { version: 3, reason: '空间误建' })
  module.namespace.deleteSeat(2, { version: 5, reason: '座位误建' })
  assert.equal(calls[0][0], '/admin/rooms/1')
  assert.equal(calls[0][1].data.version, 3)
  assert.equal(calls[1][1].data.reason, '座位误建')
})

test('cancelled resource preview keeps the room form and reason and never closes it as saved',async()=>{
  const page=await resources({confirmChange:async()=>false})
  page.openEdit(room());page.roomForm.value.reason='工程模拟：取消预览';await page.saveRoom()
  assert.equal(page.roomDialog.value,true);assert.equal(page.roomForm.value.reason,'工程模拟：取消预览');assert.equal(page.effects.calls.length,0)
})
test('acknowledged resource write followed by reload failure is explicit and never retried as a new operation',async()=>{
  let changes=0
  const page=await resources({confirmChange:async()=>{changes++;return{cancelled_count:1}},getRooms:async()=>{throw new Error('读取失败')}})
  page.openEdit(room());page.roomForm.value.reason='工程模拟：资源维护';await page.saveRoom()
  assert.equal(changes,1);assert.equal(page.roomDialog.value,false);assert.equal(page.writeNotice.value,'空间已保存。列表更新失败，请刷新列表。')
})
test('batch seat code API posts the explicit reason to the admin batch endpoint', async () => {
  const calls = []
  const context = vm.createContext({})
  const module = new vm.SourceTextModule(await readFile(new URL('../src/api/admin.js', import.meta.url), 'utf8'), { context })
  await module.link(() => new vm.SyntheticModule(['default'], function () { this.setExport('default', { post: (...args) => { calls.push(args) } }) }, { context }))
  await module.evaluate()
  module.namespace.batchGenerateSeatCodes({ reason: '部署前补齐缺失座位码' })
  assert.equal(calls[0][0], '/admin/seat-codes/batch')
  assert.equal(calls[0][1].reason, '部署前补齐缺失座位码')
})
test('batch seat code generation reports generated and skipped counts from the real batch response', async () => {
  const page = await resources()
  page.openBatchCodes()
  page.batchCodeReason.value = '部署前补齐缺失座位码'
  await page.saveBatchCodes()
  const batchCall = page.effects.calls.find(call => call[0] === 'batchCodes')
  assert.equal(batchCall[0], 'batchCodes')
  assert.equal(batchCall[1].reason, '部署前补齐缺失座位码')
  assert.equal(page.batchCodeDialog.value, false)
  assert.match(page.writeNotice.value, /新生成2个/)
  assert.match(page.writeNotice.value, /跳过1个/)
})
test('batch seat code generation keeps the dialog and reason on blank reason or permission failure', async () => {
  const page = await resources()
  page.openBatchCodes()
  page.batchCodeReason.value = '   '
  await page.saveBatchCodes()
  assert.equal(page.batchCodeDialog.value, true)
  assert.match(page.batchCodeError.value, /操作理由/)
  assert.equal(page.effects.calls.some(call => call[0] === 'batchCodes'), false)

  const denied = await resources({ batchGenerateSeatCodes: async () => { throw { status: 403, message: '需要管理员权限' } } })
  denied.openBatchCodes()
  denied.batchCodeReason.value = '越权批量补齐'
  await denied.saveBatchCodes()
  assert.equal(denied.batchCodeDialog.value, true)
  assert.match(denied.batchCodeError.value, /无资源管理权限/)
  assert.equal(denied.batchCodeReason.value, '越权批量补齐')
})
