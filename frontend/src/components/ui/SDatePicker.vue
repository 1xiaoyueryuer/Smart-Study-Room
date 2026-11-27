<script setup>
import { Transition, computed, ref, watch } from 'vue'
import { formatCampusDateTime } from '../../composables/campusDateTime.js'
import SDialog from './SDialog.vue'
import { usePopover } from './usePopover'

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '选择日期' },
  disabledDate: { type: Function, default: null },
  disabled: Boolean,
  dialogTitle: { type: String, default: '' }
})

const emit = defineEmits(['update:modelValue', 'change'])

const triggerRef = ref(null)
const popupRef = ref(null)
const { open, popupStyle, hide, toggle } = usePopover(triggerRef, popupRef)
const dialogOpen = ref(false)
const calendarOpen = computed(() => props.dialogTitle ? dialogOpen.value : open.value)
const calendarContainer = computed(() => props.dialogTitle ? {
  modelValue: dialogOpen.value,
  title: props.dialogTitle,
  width: 'min(320px, calc(100vw - 48px))',
  'onUpdate:modelValue': value => { dialogOpen.value = value }
} : { name: 's-pop' })

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

function parseISO(v) {
  const d = v ? new Date(`${v}T00:00:00`) : null
  return d && !Number.isNaN(d.getTime()) ? d : todayDate()
}

function toISO(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${String(d.getFullYear()).padStart(4, '0')}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function todayDate() {
  const now = new Date()
  if (!props.dialogTitle) return now
  const campusDay = formatCampusDateTime(now.toISOString()).slice(0, 10)
  return new Date(`${campusDay}T00:00:00`)
}

const viewDate = ref(parseISO(props.modelValue))

watch(() => props.modelValue, (v) => {
  viewDate.value = parseISO(v)
})

const viewLabel = computed(() => `${viewDate.value.getFullYear()} 年 ${viewDate.value.getMonth() + 1} 月`)
const previousMonthBlocked = computed(() => viewDate.value.getFullYear() === 1 && viewDate.value.getMonth() === 0)
const nextMonthBlocked = computed(() => viewDate.value.getFullYear() === 9999 && viewDate.value.getMonth() === 11)

const cells = computed(() => {
  const m = viewDate.value.getMonth()
  const first = new Date(viewDate.value)
  first.setDate(1)
  // 周一为一周起点
  const offset = (first.getDay() + 6) % 7
  const todayISO = toISO(todayDate())

  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(first)
    d.setDate(1 - offset + i)
    const iso = toISO(d)
    return {
      date: d,
      iso,
      day: d.getDate(),
      inMonth: d.getMonth() === m,
      isToday: iso === todayISO,
      isSelected: iso === props.modelValue,
      disabled: d.getFullYear() < 1 || d.getFullYear() > 9999 || props.disabledDate?.(d) === true
    }
  })
})

function moveMonth(step) {
  const d = new Date(viewDate.value)
  d.setMonth(d.getMonth() + step, 1)
  viewDate.value = d
}

function select(value) {
  emit('update:modelValue', value)
  emit('change', value)
  dialogOpen.value = false
  hide()
}

function pick(cell) {
  if (!cell.disabled) select(cell.iso)
}

function pickToday() {
  const today = todayDate()
  if (props.disabledDate?.(today) === true) return
  viewDate.value = today
  select(toISO(today))
}

function openCalendar() {
  if (!props.dialogTitle) {
    toggle()
    return
  }
  viewDate.value = parseISO(props.modelValue)
  dialogOpen.value = true
}

function onTriggerKeydown(e) {
  if (e.key === 'Escape' && open.value) {
    e.stopPropagation()
    hide()
  }
}
</script>

<template>
  <div class="s-date" :class="{ 's-date--dialog': dialogTitle }" @keydown="onTriggerKeydown">
    <button
      ref="triggerRef"
      type="button"
      class="s-date__trigger"
      :class="{ 'is-open': calendarOpen, 'has-value': modelValue }"
      :aria-expanded="calendarOpen"
      :aria-label="dialogTitle ? `选择${dialogTitle}` : undefined"
      :aria-haspopup="dialogTitle ? 'dialog' : undefined"
      :disabled="disabled"
      @keydown.enter.stop
      @click="openCalendar"
    >
      <span class="s-date__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
          <path d="M8 3v4M16 3v4M3.5 10.5h17" />
        </svg>
      </span>
      <span v-if="!dialogTitle" class="s-date__label">{{ modelValue || placeholder }}</span>
      <span v-if="!dialogTitle" class="s-date__chevron" :class="{ 'is-open': open }" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </span>
    </button>

    <Teleport to="body" :disabled="Boolean(dialogTitle)">
      <component :is="dialogTitle ? SDialog : Transition" v-bind="calendarContainer">
        <div v-if="calendarOpen" ref="popupRef" :class="{ 's-date__popup': !dialogTitle }" :style="dialogTitle ? undefined : popupStyle">
          <div class="s-date__head">
            <button type="button" class="s-date__nav" aria-label="上个月" :disabled="previousMonthBlocked" @click="moveMonth(-1)">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7" /></svg>
            </button>
            <span class="s-date__month">{{ viewLabel }}</span>
            <button type="button" class="s-date__nav" aria-label="下个月" :disabled="nextMonthBlocked" @click="moveMonth(1)">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7" /></svg>
            </button>
          </div>

          <div class="s-date__week">
            <span v-for="w in WEEKDAYS" :key="w">{{ w }}</span>
          </div>

          <div class="s-date__grid">
            <button
              v-for="c in cells"
              :key="c.iso"
              type="button"
              class="s-date__cell"
              :class="{
                'out-month': !c.inMonth,
                today: c.isToday,
                selected: c.isSelected,
                disabled: c.disabled
              }"
              :disabled="c.disabled"
              :aria-label="c.iso"
              :aria-pressed="c.isSelected"
              @click="pick(c)"
            >
              {{ c.day }}
            </button>
          </div>

          <div class="s-date__foot">
            <span class="s-date__today-hint">今天 {{ toISO(todayDate()) }}</span>
            <div class="s-date__foot-actions">
              <button v-if="dialogTitle" type="button" class="s-date__today-btn" @click="select('')">清空</button>
              <button type="button" class="s-date__today-btn" @click="pickToday">跳到今天</button>
            </div>
          </div>
        </div>
      </component>
    </Teleport>
  </div>
</template>

<style scoped>
.s-date {
  width: 100%;
  min-width: 0;
}

.s-date--dialog {
  width: auto;
  flex: none;
}

.s-date--dialog .s-date__trigger {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
}

.s-date__trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 34px;
  padding: 0 10px 0 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  font-size: var(--fs-body);
  font-variant-numeric: tabular-nums;
  text-align: left;
  transition: border-color var(--dur-1) var(--ease), box-shadow var(--dur-1) var(--ease);
}

.s-date__trigger:hover {
  border-color: var(--border-strong);
}

.s-date__trigger.is-open {
  border-color: var(--primary);
  box-shadow: var(--ring);
}

.s-date__trigger:not(.has-value) .s-date__label {
  color: var(--text-4);
  font-variant-numeric: normal;
}

.s-date__icon {
  display: grid;
  place-items: center;
  color: var(--text-4);
  flex: 0 0 auto;
}

.s-date__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-1);
}

.s-date__chevron {
  display: grid;
  place-items: center;
  color: var(--text-4);
  flex: 0 0 auto;
  transition: transform var(--dur-2) var(--ease);
}

.s-date__chevron.is-open {
  transform: rotate(180deg);
}

.s-date__popup {
  z-index: var(--z-popover);
  width: 272px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-3);
  padding: 14px;
}

.s-date__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.s-date__month {
  font-size: var(--fs-body-sm);
  font-weight: 600;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}

.s-date__nav {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-3);
  transition: background var(--dur-1) var(--ease), color var(--dur-1) var(--ease);
}

.s-date__nav:hover {
  background: var(--surface-3);
  color: var(--text-1);
}

.s-date__nav:disabled {
  opacity: .45;
}

.s-date__week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  margin-bottom: 4px;
}

.s-date__week span {
  text-align: center;
  font-size: 11px;
  color: var(--text-4);
  line-height: 24px;
}

.s-date__grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.s-date__cell {
  all: unset;
  display: grid;
  place-items: center;
  height: 28px;
  border-radius: var(--r-sm);
  font-size: var(--fs-caption);
  font-variant-numeric: tabular-nums;
  color: var(--text-2);
  cursor: pointer;
  transition: background var(--dur-1) var(--ease), color var(--dur-1) var(--ease);
}

.s-date__cell:hover:not(.disabled) {
  background: var(--surface-hover);
  color: var(--text-1);
}

.s-date__cell:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: -2px;
}

.s-date__cell.out-month {
  color: var(--text-4);
  opacity: .55;
}

.s-date__cell.today {
  color: var(--primary-active);
  font-weight: 700;
  box-shadow: inset 0 0 0 1px var(--primary-weak);
}

.s-date__cell.selected {
  background: var(--primary);
  color: var(--text-inverse);
  font-weight: 600;
}

.s-date__cell.selected.today {
  box-shadow: none;
}

.s-date__cell.disabled {
  color: var(--text-4);
  opacity: .38;
  cursor: not-allowed;
  text-decoration: line-through;
}

.s-date__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--hairline);
}

.s-date__foot-actions {
  display: flex;
  gap: 4px;
}

.s-date__today-hint {
  font-size: 11px;
  color: var(--text-4);
  font-variant-numeric: tabular-nums;
}

.s-date__today-btn {
  border: 0;
  background: transparent;
  color: var(--primary);
  font-size: var(--fs-caption);
  font-weight: 500;
  padding: 3px 8px;
  border-radius: var(--r-sm);
  transition: background var(--dur-1) var(--ease);
}

.s-date__today-btn:hover {
  background: var(--primary-faint);
}

/* 过渡（与 SSelect 一致） */
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
