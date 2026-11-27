<script setup>
import { computed, ref } from 'vue'
import RecordDateFilter from './RecordDateFilter.vue'
import SButton from './ui/SButton.vue'
import SInput from './ui/SInput.vue'
import SSelect from './ui/SSelect.vue'

const props = defineProps({
  modelValue: { type: Object, required: true },
  fields: { type: Array, required: true },
  disabled: Boolean,
  splitDates: Boolean
})
const emit = defineEmits(['update:modelValue', 'apply'])
const dateValidity = ref({})
const hasInvalidDate = computed(() =>
  props.splitDates && props.fields.some(field => field.type === 'date' && dateValidity.value[field.key] === false)
)

function change(key, value) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

function apply() {
  if (!props.disabled && !hasInvalidDate.value) emit('apply')
}
</script>

<template>
  <div
    class="record-filters"
    :class="{ 'record-filters--invalid-date': hasInvalidDate }"
    role="group"
    @keydown.enter.stop.prevent="apply"
  >
    <template v-for="field in fields" :key="field.key">
      <RecordDateFilter
        v-if="splitDates && field.type === 'date'"
        class="record-filter record-filter--date"
        :model-value="modelValue[field.key] ?? ''"
        :label="field.label"
        :disabled="disabled"
        @validity-change="dateValidity[field.key] = $event"
        @update:model-value="change(field.key, $event)"
      />
      <label v-else class="record-filter">
        {{ field.label }}
        <SSelect
          v-if="field.options"
          :model-value="modelValue[field.key] ?? ''"
          :options="field.options"
          :disabled="disabled"
          @update:model-value="change(field.key, $event)"
        />
        <SInput
          v-else
          :model-value="modelValue[field.key] ?? ''"
          :type="field.type || 'text'"
          :disabled="disabled"
          @update:model-value="change(field.key, $event)"
        />
      </label>
    </template>
    <SButton class="apply-filter" type="button" :disabled="disabled || hasInvalidDate" @click="apply">应用筛选</SButton>
  </div>
</template>

<style scoped>
.record-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: end;
  min-width: 0;
}

.record-filters--invalid-date {
  row-gap: 26px;
  padding-bottom: 16px;
}

.record-filter {
  display: grid;
  gap: 8px;
  flex: 1 1 140px;
  min-width: 0;
  max-width: 200px;
}

.record-filter--date {
  flex-basis: 218px;
  max-width: 244px;
}

.record-filters .apply-filter {
  margin-left: auto;
}
</style>
