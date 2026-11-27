import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { computed, nextTick, reactive, ref, watch } from 'vue'

const flush = async () => { await nextTick(); await new Promise(resolve => setTimeout(resolve, 0)) }
let idSeq = 0

async function loadDateFilter(overrides = {}) {
  const events = []
  const props = reactive({ modelValue: '', label: '开始日期', disabled: false, ...overrides })
  const source = (await readFile(new URL('../src/components/RecordDateFilter.vue', import.meta.url), 'utf8')).split('<script setup>')[1].split('</script>')[0]
  const context = vm.createContext({ console })
  const module = new vm.SourceTextModule(source + '\nexport {dateValue,error,publishDate}', { context })
  await module.link(specifier => {
    const exports = specifier === 'vue'
      ? { ref, computed, watch, useId: () => `filter-${++idSeq}` }
      : specifier === './ui/SDatePicker.vue'
        ? { default: {} }
        : null
    assert.ok(exports, `Unmocked import: ${specifier}`)
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
    }, { context })
  })
  context.defineProps = () => props
  context.defineEmits = () => (event, ...args) => events.push([event, ...args])
  await module.evaluate()
  return { page: module.namespace, props, events }
}

test('an invalid date already passed by the parent disables the filter before any typing', async () => {
  const { events } = await loadDateFilter({ modelValue: '2026-13-45' })
  assert.deepEqual(events, [['validity-change', false]], '初始非法日期必须在挂载时通知父组件')
})

test('a valid initial date does not send a redundant validity event', async () => {
  const { events } = await loadDateFilter({ modelValue: '2026-11-27' })
  assert.deepEqual(events, [])
})

test('changing the parent value to an invalid date disables the filter', async () => {
  const { props, events } = await loadDateFilter({ modelValue: '2026-11-27' })
  props.modelValue = '2026-13-45'
  await flush()
  assert.deepEqual(events.at(-1), ['validity-change', false])
})

test('clearing an invalid value re-enables the filter', async () => {
  const { props, events } = await loadDateFilter({ modelValue: '2026-13-45' })
  props.modelValue = ''
  await flush()
  assert.deepEqual(events.at(-1), ['validity-change', true])
})
