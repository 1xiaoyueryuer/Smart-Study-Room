<script setup>
import { computed, nextTick, ref } from 'vue'
import { usePopover } from './usePopover'
import SInput from './SInput.vue'

const props = defineProps({
  modelValue: { type: [String, Number, Boolean, null], default: null },
  options: { type: Array, default: () => [] },
  labelKey: { type: String, default: '' },
  valueKey: { type: String, default: '' },
  placeholder: { type: String, default: '请选择' },
  clearable: { type: Boolean, default: false },
  searchable: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  size: { type: String, default: 'md' }
})

const emit = defineEmits(['update:modelValue', 'change'])

const triggerRef = ref(null)
const popupRef = ref(null)
const listRef = ref(null)
const searchRef = ref(null)
const search = ref('')
const activeIndex = ref(-1)
const { open, popupStyle, show, hide, toggle } = usePopover(triggerRef, popupRef)

const normalized = computed(() =>
  props.options.map((o) => {
    if (props.labelKey && props.valueKey && typeof o === 'object') {
      return { label: String(o[props.labelKey]), value: o[props.valueKey], raw: o }
    }
    return { label: String(o.label), value: o.value, raw: o }
  })
)

const selected = computed(() => normalized.value.find((o) => o.value === props.modelValue))
const displayed = computed(() => {
  const term = search.value.trim().toLowerCase()
  if (!props.searchable || !term) return normalized.value
  return normalized.value.filter(option => [option.label, option.raw?.searchText]
    .some(value => String(value ?? '').toLowerCase().includes(term)))
})

function updateSearch(value) {
  search.value = value
  activeIndex.value = displayed.value.length ? 0 : -1
}

function prepareOpen() {
  search.value = ''
  activeIndex.value = normalized.value.findIndex(option => option.value === props.modelValue)
  if (props.searchable) nextTick(() => searchRef.value?.querySelector('input')?.focus())
}

function onTriggerKeydown(e) {
  if (props.disabled) return
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
    e.preventDefault()
    if (!open.value) {
      show()
      prepareOpen()
    } else if (e.key === 'ArrowDown') {
      move(1)
    }
    return
  }
  if (e.key === 'Escape' && open.value) {
    e.stopPropagation()
    hide()
  }
}

function onListKeydown(e) {
  if (e.isComposing) return
  if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
  else if (e.key === 'Enter') {
    e.preventDefault()
    const option = displayed.value[activeIndex.value]
    if (option) pick(option)
  } else if (e.key === 'Escape') {
    e.stopPropagation()
    hide()
    triggerRef.value?.focus()
  } else if (e.key === 'Tab') {
    hide()
  }
}

function move(step) {
  if (!displayed.value.length) return
  const max = displayed.value.length - 1
  activeIndex.value = activeIndex.value < 0 && step < 0 ? 0 : Math.min(max, Math.max(0, activeIndex.value + step))
  nextTick(() => {
    const el = listRef.value?.querySelector('.s-select__option.active')
    el?.scrollIntoView({ block: 'nearest' })
  })
}

function onOpen() {
  if (props.disabled) return
  toggle()
  if (open.value) prepareOpen()
}

function pick(option) {
  emit('update:modelValue', option.value)
  emit('change', option.value)
  hide()
  nextTick(() => triggerRef.value?.focus())
}

function clear(e) {
  e.stopPropagation()
  emit('update:modelValue', null)
  emit('change', null)
}
</script>

<template>
  <div class="s-select" :class="[`s-select--${size}`, { 'is-disabled': disabled }]" @keydown="onTriggerKeydown">
    <button
      ref="triggerRef"
      type="button"
      class="s-select__trigger"
      :class="{ 'is-open': open, 'has-value': selected }"
      :disabled="disabled"
      :aria-expanded="open"
      @click="onOpen"
    >
      <span class="s-select__label">{{ selected ? selected.label : placeholder }}</span>
      <span v-if="clearable && selected !== undefined && modelValue !== null && modelValue !== undefined && modelValue !== ''" class="s-select__clear" aria-label="清除选择" @click="clear">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </span>
      <span class="s-select__chevron" :class="{ 'is-open': open }" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </span>
    </button>

    <Teleport to="body">
      <Transition name="s-pop">
        <div v-if="open" ref="popupRef" class="s-select__popup" :style="popupStyle" @keydown="onListKeydown">
          <div v-if="searchable" ref="searchRef" class="s-select__search">
            <SInput :model-value="search" aria-label="搜索选项" placeholder="搜索选项" @update:model-value="updateSearch" />
          </div>
          <div ref="listRef" class="s-select__list" role="listbox" tabindex="-1">
            <button
              v-for="(o, i) in displayed"
              :key="String(o.value)"
              type="button"
              class="s-select__option"
              :class="{ selected: o.value === modelValue, active: i === activeIndex }"
              role="option"
              :aria-selected="o.value === modelValue"
              @mouseenter="activeIndex = i"
              @click="pick(o)"
            >
              <span class="s-select__option-label">{{ o.label }}</span>
              <svg v-if="o.value === modelValue" class="s-select__check" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.2 4.2L19 7" /></svg>
            </button>
            <div v-if="!displayed.length" class="s-select__empty">{{ search.trim() ? '没有匹配的选项' : '暂无选项' }}</div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.s-select {
  width: 100%;
  min-width: 0;
}

.s-select__trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 34px;
  padding: 0 10px 0 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  color: var(--text-1);
  font-size: var(--fs-body);
  text-align: left;
  transition: border-color var(--dur-1) var(--ease), box-shadow var(--dur-1) var(--ease), background var(--dur-1) var(--ease);
}

.s-select--lg .s-select__trigger {
  height: 42px;
  font-size: 14.5px;
}

.s-select__trigger:hover:not(:disabled) {
  border-color: var(--border-strong);
}

.s-select__trigger.is-open {
  border-color: var(--primary);
  box-shadow: var(--ring);
}

.s-select__trigger:not(.has-value) .s-select__label {
  color: var(--text-4);
}

.s-select.is-disabled .s-select__trigger {
  background: var(--surface-3);
  pointer-events: none;
  opacity: .7;
}

.s-select__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.s-select__clear {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  color: var(--text-4);
  flex: 0 0 auto;
  transition: color var(--dur-1) var(--ease), background var(--dur-1) var(--ease);
}

.s-select__clear:hover {
  color: var(--text-2);
  background: var(--surface-3);
}

.s-select__chevron {
  display: grid;
  place-items: center;
  color: var(--text-4);
  flex: 0 0 auto;
  transition: transform var(--dur-2) var(--ease), color var(--dur-1) var(--ease);
}

.s-select__chevron.is-open {
  transform: rotate(180deg);
  color: var(--primary);
}

.s-select__popup {
  z-index: var(--z-popover);
  max-width: min(92vw, 420px);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-3);
  padding: 5px;
}

.s-select__list {
  max-height: 264px;
  overflow-y: auto;
  scrollbar-width: thin;
  display: flex;
  flex-direction: column;
  gap: 1px;
  outline: none;
}

.s-select__search {
  padding: 4px 4px 8px;
}

.s-select__option {
  all: unset;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--r-sm);
  font-size: var(--fs-body-sm);
  color: var(--text-2);
  cursor: pointer;
  transition: background var(--dur-1) var(--ease), color var(--dur-1) var(--ease);
}

.s-select__option.active {
  background: var(--surface-hover);
  color: var(--text-1);
}

.s-select__option.selected {
  color: var(--primary-active);
  font-weight: 600;
}

.s-select__option.selected.active {
  background: var(--primary-faint);
}

.s-select__option-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.s-select__check {
  color: var(--primary);
  flex: 0 0 auto;
}

.s-select__empty {
  padding: 14px 10px;
  text-align: center;
  color: var(--text-4);
  font-size: var(--fs-body-sm);
}

/* 过渡 */
.s-pop-enter-active,
.s-pop-leave-active {
  transition: opacity var(--dur-1) var(--ease), transform var(--dur-2) var(--ease-out);
}

.s-pop-enter-from,
.s-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
