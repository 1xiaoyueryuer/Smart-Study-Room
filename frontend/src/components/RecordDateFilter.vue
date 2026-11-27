<script setup>
import { computed, ref, useId, watch } from 'vue'
import SDatePicker from './ui/SDatePicker.vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  label: { type: String, required: true },
  disabled: Boolean
})
const emit = defineEmits(['update:modelValue', 'validity-change'])

const parts = [
  { label: '年', length: 4 },
  { label: '月', length: 2 },
  { label: '日', length: 2 }
]
const labelId = useId()
const errorId = useId()
const draft = ref(splitDate(props.modelValue))

function splitDate(value) {
  const [year = '', month = '', day = ''] = value.split('-')
  return [year, month, day]
}

const dateValue = computed(() => {
  const [year, month, day] = draft.value
  if (!year && !month && !day) return ''
  if (year.length !== 4 || Number(year) === 0 || !month || !day) return null

  const value = [year, month.padStart(2, '0'), day.padStart(2, '0')].join('-')
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null
})
const error = computed(() => {
  if (dateValue.value !== null) return ''
  if (draft.value[0].length !== 4 || draft.value.some(part => !part)) return '请填写四位年份及月、日'
  return '请输入有效日期'
})

function publishDate() {
  emit('validity-change', !error.value)
  if (dateValue.value !== null) emit('update:modelValue', dateValue.value)
}

function updatePart(index, length, event) {
  const input = event.target
  const value = input.value.normalize('NFKC').replace(/\D/g, '').slice(0, length)
  if (input.value !== value) input.value = value
  draft.value[index] = value
  publishDate()
}

function chooseDate(value) {
  draft.value = splitDate(value)
  publishDate()
}

watch(() => props.modelValue, value => {
  if (value === dateValue.value) return
  draft.value = splitDate(value)
  emit('validity-change', !error.value)
}, { immediate: true })
</script>

<template>
  <div class="record-date-filter">
    <div :id="labelId">{{ label }}</div>
    <div class="record-date-filter__parts" role="group" :aria-labelledby="labelId">
      <label v-for="(part, index) in parts" :key="part.label" class="record-date-filter__part">
        <input
          type="text"
          inputmode="numeric"
          autocomplete="off"
          class="record-date-filter__input"
          :aria-label="`${label}${part.label}`"
          :aria-invalid="error ? true : undefined"
          :aria-describedby="error ? errorId : undefined"
          :value="draft[index]"
          :maxlength="part.length"
          :disabled="disabled"
          @input="updatePart(index, part.length, $event)"
        />
        <span>{{ part.label }}</span>
      </label>
      <SDatePicker :model-value="modelValue" :dialog-title="label" :disabled="disabled" @change="chooseDate"/>
    </div>
    <p v-if="error" :id="errorId" class="record-date-filter__error">{{ error }}</p>
  </div>
</template>

<style scoped>
.record-date-filter {
  position: relative;
}

.record-date-filter__parts {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) repeat(2, minmax(0, 1fr)) auto;
  align-items: center;
  gap: 6px;
}

.record-date-filter__part {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  white-space: nowrap;
}

.record-date-filter__input {
  width: 100%;
  min-width: 0;
  height: 36px;
  padding: 0 3px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--text-1);
  text-align: center;
  font-variant-numeric: tabular-nums;
  transition: border-color var(--dur-1) var(--ease), box-shadow var(--dur-1) var(--ease);
}

.record-date-filter__input:hover:not(:disabled) {
  border-color: var(--border-strong);
}

.record-date-filter__input:focus-visible {
  outline: none;
  border-color: var(--primary);
  box-shadow: var(--ring);
}

.record-date-filter__input:disabled {
  background: var(--surface-3);
  opacity: .7;
}

.record-date-filter__error {
  position: absolute;
  inset-block-start: 100%;
  line-height: 1.25;
  color: var(--red-strong);
  font-size: var(--fs-caption);
}
</style>
