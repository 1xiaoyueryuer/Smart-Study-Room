<script setup>
import SAnimatedNumber from '../components/ui/SAnimatedNumber.vue'
import { h, ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { onBeforeRouteUpdate, useRoute } from 'vue-router'
import SeatExplorer from '../components/seat3d/SeatExplorer.vue'
import SeatPlanDesk from '../components/SeatPlanDesk.vue'
import BookingConfirmationSummary from '../components/BookingConfirmationSummary.vue'
import { seatType, zoneName, getWindowSides, seatPreferenceCount, matchesSeatPreferences } from '../components/seat3d/seatPresentation'
import { message, confirmDialog } from '../components/ui/feedback'
import { getRooms } from '../api/room'
import { createReservation, getBookingPolicy } from '../api/reservation'
import { getAvailability } from '../api/availability'
import { getBookingEligibility } from '../api/restriction'
import { windowKey, validateWindowSlot, shortfallText, buildBrowseWindowRows } from '../composables/availabilitySelection.js'
import { MISSING_LOCATION, locationValue, locationOptions, bookingZone, findRoomInZone } from '../composables/bookingLocation.js'
import { bookingRestrictionDetails, activeBookingRestrictions, isBookingRestricted, validEligibility } from '../composables/restrictionForm.js'
import BookingRestrictionNotice from '../components/BookingRestrictionNotice.vue'
import SButton from '../components/ui/SButton.vue'
import SDialog from '../components/ui/SDialog.vue'
import RoomReviewsView from './RoomReviewsView.vue'
import SSelect from '../components/ui/SSelect.vue'
import STag from '../components/ui/STag.vue'
import SInput from '../components/ui/SInput.vue'
import SBanner from '../components/ui/SBanner.vue'
import { minuteValue, minuteText, normalizeStartTime, parseLearningDuration, serverStartMinute, validateAvailabilitySnapshot } from '../composables/bookingPolicy.js'

// ---- 条件区状态 ----
const route = useRoute()
const rooms = ref([])
const roomsLoading = ref(false)
const roomsError = ref('')
const zoneNotice = ref('')
let roomsLoaded = false
function floorLabel(value) { if (!value) return ''; return /^[0-9]+$/.test(String(value)) ? `${value}层` : String(value) }
function zoneLabel(room) {
  const zone = bookingZone(room)
  return zone ? `${zone}区` : (room?.name || '区域')
}
const selectedBuilding = ref('')
const selectedFloor = ref('')
const buildingOptions = computed(() => {
  const options = locationOptions(rooms.value, 'building', '楼栋未登记', value => value)
  return options.length ? options : [{ value: '', label: '全部空间' }]
})
const floorOptions = computed(() => {
  const buildingRooms = rooms.value.filter(room => locationValue(room.building) === selectedBuilding.value)
  return locationOptions(buildingRooms, 'floor', '楼层未登记', floorLabel)
})
const zoneRooms = computed(() => rooms.value.filter(room =>
  locationValue(room.building) === selectedBuilding.value && locationValue(room.floor) === selectedFloor.value
))
const zoneOptions = computed(() => zoneRooms.value.map(room => ({ value: room.id, label: locationValue(room.floor) === MISSING_LOCATION ? room.name : zoneLabel(room) })))
function selectLocation(zone) {
  zoneNotice.value = ''
  const target = findRoomInZone(rooms.value, zone)
  if (target) {
    selectedBuilding.value = locationValue(target.building)
    selectedFloor.value = locationValue(target.floor)
    setRoom(target.id)
    return
  }

  if (!buildingOptions.value.some(option => option.value === selectedBuilding.value)) selectedBuilding.value = buildingOptions.value[0]?.value ?? ''
  if (!floorOptions.value.some(option => option.value === selectedFloor.value)) selectedFloor.value = floorOptions.value[0]?.value ?? ''
  if (zone !== undefined) {
    const label = typeof zone === 'string' && /^[A-D]$/i.test(zone) ? `${zone.toUpperCase()}区` : '链接中的区域'
    zoneNotice.value = `未找到${label}，请选择其他区域。`
    setRoom(null)
  } else if (!zoneRooms.value.some(room => room.id === roomId.value)) {
    setRoom(zoneRooms.value[0]?.id ?? null)
  }
}
function pickBuilding(value) {
  if (submitting.value || selectedBuilding.value === value) return
  selectedBuilding.value = value
  selectedFloor.value = floorOptions.value[0]?.value ?? ''
  const first = zoneRooms.value[0]
  return pickRoom(first?.id ?? null)
}
function pickFloor(value) {
  if (submitting.value || selectedFloor.value === value) return
  selectedFloor.value = value
  const first = zoneRooms.value[0]
  return pickRoom(first?.id ?? null)
}
const roomId = ref(null)
const selectedRoom = computed(() => zoneRooms.value.find(item => item.id === roomId.value))
const showRoomReviews = ref(false)
const strategy = ref('duration'), durationInput = ref(''), searchStart = ref(''), queryDirty = ref(true)
const hasSearchInputs = computed(() => Boolean(searchStart.value.trim() && durationInput.value.trim()))
// 座位偏好是时间与时长满足后的次级排序条件，不隐藏任何可约座位。
const preferences = ref([])
const preferenceOptions = [{value:'window',label:'靠窗'},{value:'power',label:'插座'}]
function togglePreference(value) {
  if (submitting.value) return
  preferences.value = preferences.value.includes(value) ? preferences.value.filter(item => item !== value) : [...preferences.value, value]
}
function isPreferredSeat(seat) { return matchesSeatPreferences(seat, preferences.value) }
const seatById = computed(() => new Map(seats.value.map(seat => [seat.id, seat])))
const browseWindows = computed(() => buildBrowseWindowRows(seats.value, room.value?.enabled))
const readOnlyBrowse = computed(() => restricted.value || queryDirty.value || !filterApplied.value)
const rankedResults = computed(() => {
  if (!preferences.value.length) return results.value
  return [...results.value].sort((left, right) => seatPreferenceCount(seatById.value.get(right.seat_id), preferences.value) - seatPreferenceCount(seatById.value.get(left.seat_id), preferences.value))
})
const shortfall = computed(() => shortfallText(availability.value?.learning_minutes, start.value, end.value))
const date = ref(''), start = ref(''), end = ref('')
const timePart = value => String(value).padStart(2, '0')
const openingHour = 8, lastStartHour = 22
const hourOptions = Array.from({ length: lastStartHour - openingHour + 1 }, (_, index) => timePart(index + openingHour))
const minuteOptions = Array.from({ length: 60 }, (_, index) => timePart(index))
const minLearningDuration = 30
const maxDurationHours = lastStartHour - openingHour
const maxLearningDuration = maxDurationHours * 60
const durationHourOptions = Array.from({ length: maxDurationHours + 1 }, (_, index) => timePart(index))
const durationHour = ref(''), durationMinute = ref('')
const lastDurationHour = timePart(maxDurationHours)
const durationMinuteOptions = computed(() => {
  if (durationHour.value === '00') return minuteOptions.slice(minLearningDuration)
  if (durationHour.value === lastDurationHour) return minuteOptions.slice(0, 1)
  return minuteOptions
})
const timePicker = ref(null), timeToggle = ref(null)
const durationPicker = ref(null), durationToggle = ref(null)
const openTimeMenu = ref('')
const pickerHour = ref(''), pickerMinute = ref('')
const pickerMinutes = computed(() => pickerHour.value === '22' ? ['00'] : minuteOptions)
const selectedWindow = ref(null), results = ref([]), availability = ref(null), presentation = ref('map')
const filterApplied = ref(false)
let alive = true, policyRequest = 0, roomsRequest = 0
let seatSearchTimer
const policy = ref(null), policyLoading = ref(false), policyError = ref(''), inputError = ref(''), bookingError = ref(''), restrictionFailure = ref(null)
const checkBookingResult = ref(false)
const eligibility = ref(null), eligibilityLoading = ref(false), eligibilityError = ref('')
const activeRestrictions = computed(() => activeBookingRestrictions(eligibility.value, restrictionFailure.value))
const restricted = computed(() => isBookingRestricted(eligibility.value, restrictionFailure.value))
const eligibilityCheckedAt = computed(() => restrictionFailure.value?.server_now || eligibility.value?.server_now)
let eligibilityTimer, checkingEligibility = false
async function loadEligibility({ background = false } = {}) {
  if (!alive || checkingEligibility) return
  checkingEligibility = true
  if (!background) {
    eligibilityLoading.value = true
    eligibilityError.value = ''
  }
  try {
    const { data } = await getBookingEligibility()
    if (!validEligibility(data)) throw new Error('预约状态返回不完整')
    if (alive) { eligibility.value = data; restrictionFailure.value = null; eligibilityError.value = '' }
  }
  catch { if (alive && !background) eligibilityError.value = '暂时查不到你的预约资格。' }
  finally {
    checkingEligibility = false
    if (alive) {
      eligibilityLoading.value = false
      if (queryDirty.value && hasSearchInputs.value && roomId.value && !restricted.value) queueSeatSearch()
    }
  }
}
function recheckRestriction() {
  if (restricted.value && !submitting.value && !document.hidden) void loadEligibility({ background: true })
}
watch(restricted, blocked => {
  clearInterval(eligibilityTimer)
  if (blocked) {
    clearSelection()
    queryDirty.value = true
    eligibilityTimer = setInterval(recheckRestriction, 9000)
  }
})
const dateSelectOptions = computed(() => (policy.value?.dates || []).map(value => {
  const label = dateLabel(value)
  return { value, label: [label.top, label.sub].filter(Boolean).join(' ') }
}))
function setRoom(id) {
  if (roomId.value === id) return
  roomId.value = id
  show3D.value = false
  showRoomReviews.value = false
  room.value = null
  seats.value = []
  invalidateQuery()
}
function pickRoom(id) {
  if (submitting.value || roomId.value === id) return
  zoneNotice.value = ''
  setRoom(id)
  return refreshSeatMap()
}
function pickDate(value) {
  if (submitting.value || date.value === value) return
  date.value = value
  invalidateQuery()
  return refreshSeatMap()
}
function dateLabel(value) {
  const today = policy.value?.campus_today
  const index = (policy.value?.dates || []).indexOf(value)
  const weekday = new Date(value + 'T00:00:00Z').getUTCDay()
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][weekday] || ''
  const sub = value ? value.slice(5).replace('-', '/') + ' ' + week : ''
  if (!today) return { top: sub, sub: '' }
  if (value === today) return { top: '今天', sub }
  if (index === 1) return { top: '明天', sub }
  if (index === 2) return { top: '后天', sub }
  return { top: week, sub }
}
async function loadPolicy(initialize = false) {
  const ticket = ++policyRequest
  policyLoading.value = true
  policyError.value = ''
  try {
    const response = await getBookingPolicy()
    if (!alive || ticket !== policyRequest) return false
    const value = response.data
    if (!value || !Array.isArray(value.dates) || !value.dates.includes(value.campus_today) || value.min_duration_minutes !== 30) throw new Error('预约政策返回不完整')
    serverStartMinute(value)
    policy.value = value
    if (initialize) {
      date.value = value.campus_today; clearSelection()
    }
    return true
  } catch {
    if (!alive || ticket !== policyRequest) return false
    policy.value = null
    policyError.value = '暂时无法加载可约日期。'
    return false
  } finally { if (alive && ticket === policyRequest) policyLoading.value = false }
}

async function refreshPolicy() {
  if (submitting.value || policyLoading.value) return
  if (!await loadPolicy(!date.value)) return
  if (!policy.value.dates.includes(date.value)) {
    date.value = policy.value.campus_today
    invalidateQuery()
    message.info('原日期已不能预约，已切换到今天。')
  }
  if (!rooms.value.length) await loadRooms()
  else await refreshSeatMap(true)
}

// ---- 平面图 ----
const room = ref(null)
const seats = ref([])
const loading = ref(false)
const selected = ref(null)
function invalidateQuery() {
  clearTimeout(seatSearchTimer)
  mapRequest++; queryDirty.value = true; loading.value = false
  clearSelection(); results.value = []; availability.value = null; hoverTip.value = null
  inputError.value = ''; mapError.value = false; mapErrorText.value = ''
}

function refreshSeatMap(preserveSelection = false) {
  clearTimeout(seatSearchTimer)
  if (!roomId.value || !date.value || !policy.value) return
  if (!hasSearchInputs.value || eligibilityLoading.value || restricted.value) return loadInitialLayout()
  return loadAvailability(preserveSelection)
}

function queueSeatSearch() {
  clearTimeout(seatSearchTimer)
  seatSearchTimer = setTimeout(() => {
    if (!submitting.value && !eligibilityLoading.value && !restricted.value) void refreshSeatMap()
  }, 350)
}

function changeSearchInput(field, value) {
  if (submitting.value || field.value === value) return
  const hadSearchInputs = hasSearchInputs.value
  field.value = value
  if (!hadSearchInputs && !hasSearchInputs.value) return
  invalidateQuery()
  if (hasSearchInputs.value) queueSeatSearch()
  else void refreshSeatMap()
}
function changeDuration(value) { changeSearchInput(durationInput, value) }
function changeSearchStart(value) { changeSearchInput(searchStart, value) }
function applyPickedDuration() {
  if (durationHour.value === lastDurationHour) durationMinute.value = '00'
  else if (durationMinute.value && !durationMinuteOptions.value.includes(durationMinute.value)) {
    durationMinute.value = durationMinuteOptions.value[0]
  }
  if (durationHour.value && durationMinute.value) changeDuration(`${durationHour.value}:${durationMinute.value}`)
}
function normalizeDurationInput() {
  if (!durationInput.value.trim()) return
  try { durationInput.value = minuteText(parseLearningDuration(durationInput.value, minLearningDuration, maxLearningDuration)) }
  catch { /* 保留原输入，供用户按提示修改。 */ }
}
function normalizeSearchStart() {
  if (!searchStart.value.trim()) return
  try { searchStart.value = normalizeStartTime(searchStart.value) }
  catch { /* 保留原输入，供用户按提示修改。 */ }
}
function toggleTimeMenu() {
  if (submitting.value || !policy.value) return
  if (openTimeMenu.value === 'start') {
    openTimeMenu.value = ''
    return
  }
  pickerHour.value = ''
  pickerMinute.value = ''
  try {
    const [hour, minute] = normalizeStartTime(searchStart.value).split(':')
    if (hourOptions.includes(hour) && (hour !== '22' || minute === '00')) {
      pickerHour.value = hour
      pickerMinute.value = minute
    }
  } catch { /* 未填完整时由用户选择小时和分钟。 */ }
  openTimeMenu.value = 'start'
}
function toggleDurationMenu() {
  if (submitting.value || !policy.value) return
  if (openTimeMenu.value === 'duration') {
    openTimeMenu.value = ''
    return
  }
  durationHour.value = ''
  durationMinute.value = ''
  try {
    const minutes = parseLearningDuration(durationInput.value, minLearningDuration, maxLearningDuration)
    const [hour, minute] = minuteText(minutes).split(':')
    durationHour.value = hour
    durationMinute.value = minute
  } catch { /* 未填完整时由用户选择小时和分钟。 */ }
  openTimeMenu.value = 'duration'
}
function applyPickedTime() {
  if (pickerHour.value === '22') pickerMinute.value = '00'
  if (pickerHour.value && pickerMinute.value) changeSearchStart(`${pickerHour.value}:${pickerMinute.value}`)
}
function closeTimeMenuOnOutside(event) {
  if (!openTimeMenu.value) return
  const picker = openTimeMenu.value === 'start' ? timePicker : durationPicker
  if (!picker.value?.contains(event.target)) openTimeMenu.value = ''
}
function closeTimeMenuOnKey(event) {
  if (event.key !== 'Escape' || !openTimeMenu.value) return
  const isStart = openTimeMenu.value === 'start'
  const picker = isStart ? timePicker : durationPicker
  const toggle = isStart ? timeToggle : durationToggle
  openTimeMenu.value = ''
  if (picker.value?.contains(event.target)) toggle.value?.focus()
}
function currentQueryMatches(query) {
  if (roomId.value !== query.room_id || date.value !== query.date || strategy.value !== query.strategy) return false
  try {
    const { startTime, learningMinutes } = validateSearchCriteria()
    return startTime === query.filter_start_time && learningMinutes === query.learning_minutes
  } catch {
    return false
  }
}
function clearSelection() { selected.value = null; selectedWindow.value = null; start.value = ''; end.value = '' }
function hasWindows(seat) {
  const windows = filterApplied.value && !queryDirty.value ? seat?.matching_windows : seat?.all_windows
  return Array.isArray(windows) && windows.length > 0
}
function chooseWindow(window) {
  if (queryDirty.value || loading.value || mapError.value || submitting.value || eligibilityLoading.value || restricted.value || !room.value?.enabled) return
  const seat = seats.value.find(item => item.id === window.seat_id && item.status === 'available')
  const actual = seat?.matching_windows?.find(item => windowKey(item) === windowKey(window))
  if (!actual) return
  selected.value = seat; selectedWindow.value = actual; inputError.value = ''
  start.value = actual.suggested_start; end.value = actual.suggested_end
}
function showWindows(windows) { return windows?.length ? windows.map(window => `${window.start}–${window.end}`).join('、') : '无开放时段' }
function validateSearchCriteria() {
  const startTime = normalizeStartTime(searchStart.value)
  const startMinute = minuteValue(startTime)
  if (startMinute < openingHour * 60 || startMinute > lastStartHour * 60) throw new Error('开始时间须在08:00—22:00之间')
  const learningMinutes = parseLearningDuration(durationInput.value, minLearningDuration, maxLearningDuration)
  return { startTime, learningMinutes }
}

const seatCard = ref(null)
const explorer = ref(null)
const show3D = ref(false)
const submitting = ref(false)
const mapError = ref(false)
const mapErrorText = ref('')
let mapRequest = 0
function open3D() {
  if (submitting.value || !room.value || loading.value || mapError.value || !seats.value.length) return
  hoverTip.value = null
  show3D.value = true
}

async function loadRooms() {
  const ticket = ++roomsRequest
  roomsLoading.value = true
  roomsError.value = ''
  try {
    const response = await getRooms()
    if (!alive || ticket !== roomsRequest) return
    rooms.value = response.data
    selectLocation(!roomsLoaded || zoneNotice.value ? route.query.zone : undefined)
    roomsLoaded = true
    await refreshSeatMap()
  } catch { if (alive && ticket === roomsRequest) roomsError.value = '暂时无法加载自习室。' }
  finally { if (alive && ticket === roomsRequest) roomsLoading.value = false }
}
async function loadInitialLayout() {
  const requestId = ++mapRequest
  if (!roomId.value || !date.value) return
  loading.value = true; queryDirty.value = true; mapError.value = false; mapErrorText.value = ''
  try {
    if (!policy.value?.dates.includes(date.value)) throw new Error('这一天已不能预约。')
    const response = await getAvailability(roomId.value, date.value, 'earliest')
    if (!alive || requestId !== mapRequest) return
    const value = response.data
    if (roomId.value !== value?.room?.id || date.value !== value?.date || !Array.isArray(value?.seats) || value.seats.some(seat => !Array.isArray(seat.all_windows))) throw new Error('暂时无法显示座位图。')
    filterApplied.value = false; room.value = value.room; seats.value = value.seats; results.value = []; availability.value = value
  } catch {
    if (alive && requestId === mapRequest) { mapError.value = true; mapErrorText.value = '暂时无法显示座位图。' }
  } finally { if (alive && requestId === mapRequest) loading.value = false }
}

async function loadAvailability(preserveSelection = false) {
  if (eligibilityLoading.value || restricted.value) return
  const requestId = ++mapRequest
  const query = { roomId: roomId.value, date: date.value, strategy: strategy.value, requiredMinutes: null }
  let criteria
  try { criteria = validateSearchCriteria(); inputError.value = '' }
  catch (failure) {
    inputError.value = failure.message
    loading.value = false
    queryDirty.value = true
    clearSelection()
    return
  }
  const previous = preserveSelection === true && selectedWindow.value ? { key: windowKey(selectedWindow.value), start: start.value, end: end.value } : null
  clearSelection(); results.value = []; hoverTip.value = null
  if (!query.roomId || !query.date) { loading.value = false; return }
  loading.value = true; queryDirty.value = true; mapError.value = false; mapErrorText.value = ''; inputError.value = ''
  try {
    if (!policy.value?.dates.includes(query.date)) throw new Error('这一天已不能预约。')
    query.requiredMinutes = query.strategy === 'duration' ? criteria.learningMinutes : null
    query.learningMinutes = criteria.learningMinutes; query.startTime = criteria.startTime
    const response = await getAvailability(query.roomId, query.date, query.strategy, query.requiredMinutes, query.startTime, query.learningMinutes)
    if (!alive || requestId !== mapRequest || !currentQueryMatches({room_id:query.roomId,date:query.date,strategy:query.strategy,filter_start_time:query.startTime,learning_minutes:query.learningMinutes})) return
    const value = response.data
    if (!value || value.room?.id !== query.roomId || value.date !== query.date || value.strategy !== query.strategy || value.required_minutes !== query.requiredMinutes || value.learning_minutes !== query.learningMinutes || value.start_time !== query.startTime || value.campus_zone !== 'Asia/Shanghai' || !value.server_now || !value.computed_at || !Array.isArray(value.seats) || !Array.isArray(value.results) || value.seats.some(seat => !Array.isArray(seat.available_windows) || !Array.isArray(seat.all_windows) || !Array.isArray(seat.matching_windows))) throw new Error('连续空档响应不完整，请重新查询')
    try { validateAvailabilitySnapshot(query.date, criteria.startTime, criteria.learningMinutes, value) }
    catch (failure) {
      room.value = value.room; seats.value = value.seats; results.value = []; availability.value = value
      filterApplied.value = false; clearSelection()
      inputError.value = failure.message.replace('当前服务端时刻', '当前时间').replace('请调整后重新查询', '请选择更晚的开始时间')
      queryDirty.value = true; mapError.value = false; mapErrorText.value = ''
      return
    }
    const windows = value.seats.flatMap(seat => seat.matching_windows)
    const keys = new Set(windows.map(windowKey))
    const byKey = new Map(windows.map(window => [windowKey(window), window]))
    if (windows.length !== value.results.length || keys.size !== windows.length || value.results.some(window => !keys.has(windowKey(window)) || ['duration_minutes','wait_minutes','seat_no','row_no','col_no','suggested_start','suggested_end'].some(key => window[key] !== byKey.get(windowKey(window))[key])) || value.seats.some(seat => seat.all_windows.some(window => window.seat_id !== seat.id || window.room_id !== query.roomId || minuteValue(window.available_end,true) - minuteValue(window.available_start) !== window.duration_minutes || !Number.isInteger(window.wait_minutes) || window.wait_minutes < 0) || seat.matching_windows.some(window => window.seat_id !== seat.id || window.room_id !== query.roomId || window.duration_minutes < query.learningMinutes || minuteValue(window.suggested_start) < minuteValue(query.startTime) || minuteValue(window.suggested_end,true) - minuteValue(window.suggested_start) !== query.learningMinutes || minuteValue(window.suggested_end,true) > minuteValue(window.available_end,true)))) throw new Error('图与列表空档数据不一致，请重新查询')
    // 本页流程要求严格从所选开始时间起连续满足学习时长；后端“可稍晚开始”的候选不进入可选集合。
    const requestedEnd = minuteText(minuteValue(query.startTime) + query.learningMinutes)
    for (const seat of value.seats) seat.matching_windows = seat.matching_windows.filter(window => window.suggested_start === query.startTime && window.suggested_end === requestedEnd)
    value.results = value.results.filter(window => window.suggested_start === query.startTime && window.suggested_end === requestedEnd)
    queryDirty.value = false; filterApplied.value = true; room.value = value.room; seats.value = value.seats; results.value = value.results; availability.value = value
    if (previous) {
      const window = results.value.find(item => windowKey(item) === previous.key)
      if (window && room.value.enabled) {
        selected.value = seats.value.find(item => item.id === window.seat_id && item.status === 'available') || null
        if (selected.value) { selectedWindow.value = window; start.value = previous.start; end.value = previous.end }
      }
      if (!selectedWindow.value) message.info('原座位在这段时间已不可选，请换个座位。')
    }
  } catch {
    if (alive && requestId === mapRequest) { mapError.value = true; mapErrorText.value = '暂时查不到可用座位。'; clearSelection(); if (previous) { start.value = previous.start; end.value = previous.end } }
  } finally { if (alive && requestId === mapRequest) loading.value = false }
}

// 行列网格（座位区）
const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${room.value?.seat_cols || 8}, minmax(76px, 1fr))`,
  gap: '10px'
}))

// 房间框架（墙/窗包裹座位区），最小宽度保证小容器可横向滚动
const frameStyle = computed(() => {
  const cols = room.value?.seat_cols || 8
  const contentMin = cols * 76 + (cols - 1) * 10 + 24 + 36
  return { minWidth: `${Math.max(480, contentMin)}px` }
})

// 靠窗方位：某条边只有当其全部座位连续靠窗时才判定为窗（避免角落座位误判两条边）
const windowSides = computed(() => getWindowSides(room.value, seats.value))

// 靠窗座位旁的窗条方向：仅在该侧边确认为窗时渲染
function nearWindowSide(s) {
  const sides = windowSides.value
  const rows = room.value?.seat_rows || 0
  const cols = room.value?.seat_cols || 0
  if (sides.right && s.col_no === cols) return 'seat-near-window-right'
  if (sides.left && s.col_no === 1) return 'seat-near-window-left'
  if (sides.top && s.row_no === 1) return 'seat-near-window-top'
  if (sides.bottom && s.row_no === rows) return 'seat-near-window-bottom'
  return ''
}

function seatClass(s) {
  let cls
  if (!room.value?.enabled || s.status !== 'available') cls = 'seat seat-disabled'
  else if (!hasWindows(s)) cls = 'seat seat-filtered-out'
  else if (selected.value?.id === s.id) cls = 'seat seat-selected'
  else cls = 'seat seat-free'
  if (!queryDirty.value && isPreferredSeat(s) && s.status === 'available' && hasWindows(s)) cls += ' seat-preferred'
  if (s.near_window) {
    const side = nearWindowSide(s)
    if (side) cls += ' ' + side
  }
  return cls
}

function seatTip(s) {
  const free = s.all_windows || s.available_windows || []
  const conflict = filterApplied.value && !queryDirty.value && s.status === 'available' && !hasWindows(s) ? ' · 所选时段已有预约或不连续' : ''
  return `${s.seat_no} · ${seatType(s)} · ${zoneName[s.zone] || s.zone}${s.near_window ? ' · 靠窗' : ''}${s.has_power ? ' · 插座' : ''} · ${s.row_no}行${s.col_no}列${s.resource_reason ? ' · 原因：' + s.resource_reason : ''}${s.closed_reasons?.length ? ' · ' + s.closed_reasons.join('；') : ''} · ${free.length ? `全部空闲时段：${free.map(item => `${item.available_start}–${item.available_end}`).join('、')}` : '无空闲时段'}${s.status !== 'available' ? ' · ' + (s.status === 'maintenance' ? '维护中' : '停用') : ''}${conflict}`
}

// 座位悬浮提示（共享单例，fixed 定位避免被滚动容器裁剪）
const hoverTip = ref(null)
function onGridOver(e) {
  const seatEl = e.target.closest('.seat')
  if (!seatEl) return
  const s = seats.value.find((x) => String(x.id) === seatEl.dataset.id)
  if (!s) return
  const rect = seatEl.getBoundingClientRect()
  hoverTip.value = {
    text: seatTip(s),
    x: Math.min(Math.max(rect.left + rect.width / 2, 90), window.innerWidth - 90),
    y: rect.top
  }
}
function onGridLeave() {
  hoverTip.value = null
}

function onSeatClick(s) {
  if (queryDirty.value || loading.value || mapError.value || submitting.value || eligibilityLoading.value || restricted.value) return
  if (!room.value?.enabled) { message.info(`空间已停用：${room.value?.resource_reason || '请查看资源说明'}`); return }
  if (s.status !== 'available') {
    message.info(`${s.status === 'maintenance' ? '该座位维护中' : '该座位已停用'}：${s.resource_reason || '未提供原因'}`)
    return
  }
  if (!hasWindows(s)) { message.info((s.closed_reasons || []).join('；') || '该座位在所选日期无满足条件的连续空档'); return }
  if (selected.value?.id !== s.id) clearSelection()
  selected.value = s
  const first = s.matching_windows?.[0] || s.available_windows?.[0]
  if (first) chooseWindow(first)
}

async function confirmBooking() {
  const selectedSeat = selected.value
  if (eligibilityLoading.value || restricted.value || queryDirty.value || !policy.value || !room.value?.enabled || !selectedSeat || submitting.value || loading.value || mapError.value || !selectedWindow.value || selectedSeat.status !== 'available' || !hasWindows(selectedSeat)) return
  if (selectedWindow.value.seat_id !== selectedSeat.id || selectedWindow.value.room_id !== room.value.id) {
    checkBookingResult.value = false
    bookingError.value = '这个座位已不能预约，请重新选座。'
    return
  }
  const { startTime, learningMinutes } = validateSearchCriteria()
  const attempt = {room_id:room.value.id, seat_id:selectedSeat.id, date:date.value, start_time:start.value, end_time:end.value, filter_start_time:startTime, learning_minutes:learningMinutes, room_name:room.value.name, seat_no:selectedSeat.seat_no, window:{...selectedWindow.value}, computed_at:availability.value?.computed_at, strategy:availability.value?.strategy, required_minutes:availability.value?.required_minutes}
  submitting.value = true
  bookingError.value = ''; restrictionFailure.value = null
  checkBookingResult.value = false
  let reservationRequested = false
  try {
    try {
      const minutes = validateWindowSlot(policy.value,attempt.date,attempt.start_time,attempt.end_time,attempt.window)
      await confirmDialog(h(BookingConfirmationSummary, {
        roomName: attempt.room_name,
        seatNo: attempt.seat_no,
        date: attempt.date,
        start: attempt.start_time,
        end: attempt.end_time,
        minutes
      }), '预约确认', { confirmButtonText: '确认预约', cancelButtonText: '再想想' })
    } catch (failure) {
      if (failure?.message) bookingError.value = failure.message
      return
    }
    if (!alive || !await loadPolicy(false)) return
    validateWindowSlot(policy.value,attempt.date,attempt.start_time,attempt.end_time,attempt.window)
    reservationRequested = true
    const response = await createReservation({ seat_id:attempt.seat_id,date:attempt.date,start_time:attempt.start_time,end_time:attempt.end_time })
    if (!alive) return
    message.success(`预约成功：${response.data.room_name} ${response.data.seat_no}`)
    clearSelection()
    if (currentQueryMatches({room_id:attempt.room_id,date:attempt.date,strategy:attempt.strategy,filter_start_time:attempt.filter_start_time,learning_minutes:attempt.learning_minutes})) await loadAvailability()
    explorer.value?.close()
  } catch (failure) {
    if (!alive) return
    restrictionFailure.value = bookingRestrictionDetails(failure)
    const outcomeUnknown = reservationRequested && (failure.status == null || failure.status === 408 || failure.status >= 500)
    const ownConflict = failure.status === 409 && failure.message === '您在同一时段已有其他预约'
    checkBookingResult.value = outcomeUnknown || ownConflict
    bookingError.value = restrictionFailure.value ? '' : outcomeUnknown ? '暂时无法确认预约结果。请先查看我的预约。' : failure.message
    if (outcomeUnknown) clearSelection()
    if (currentQueryMatches({room_id:attempt.room_id,date:attempt.date,strategy:attempt.strategy,filter_start_time:attempt.filter_start_time,learning_minutes:attempt.learning_minutes})) await loadAvailability(!outcomeUnknown)
  } finally { if (alive) submitting.value = false }
}

// 统计右栏实时数据
const seatStats = computed(() => {
  const total = seats.value.length
  const down = seats.value.filter(seat => !room.value?.enabled || seat.status !== 'available').length
  const free = seats.value.filter(seat => room.value?.enabled && seat.status === 'available' && hasWindows(seat)).length
  return { total, free, occ: total - down - free, down }
})
onBeforeUnmount(() => {
  alive = false; mapRequest++; policyRequest++; roomsRequest++; hoverTip.value = null
  clearInterval(eligibilityTimer)
  document.removeEventListener('visibilitychange', recheckRestriction)
  clearTimeout(seatSearchTimer)
  document.removeEventListener('pointerdown', closeTimeMenuOnOutside)
  document.removeEventListener('keydown', closeTimeMenuOnKey)
})

onBeforeRouteUpdate(to => {
  if (submitting.value && to.query.zone !== route.query.zone) return false
})
watch(() => route.query.zone, zone => {
  if (!roomsLoaded) return
  selectLocation(zone)
  void refreshSeatMap()
})

onMounted(async () => {
  document.addEventListener('visibilitychange', recheckRestriction)
  document.addEventListener('pointerdown', closeTimeMenuOnOutside)
  document.addEventListener('keydown', closeTimeMenuOnKey)
  void loadEligibility()
  if (await loadPolicy(true)) await loadRooms()
})
</script>

<template>
  <div v-reveal class="page-view">
    <header class="view-heading" data-page-title>
      <h1>座位预约</h1>
    </header>
    <BookingRestrictionNotice v-if="restricted" :records="activeRestrictions" :checked-at="eligibilityCheckedAt" />

    <section v-if="policy" class="booking-top">
      <div class="picker-row">
        <div class="picker-field">
          <span class="picker-label">图书馆</span>
          <SSelect :model-value="selectedBuilding" :options="buildingOptions" size="lg" placeholder="请选择图书馆" :disabled="submitting || roomsLoading" @update:model-value="pickBuilding" />
        </div>
        <div class="picker-field">
          <span class="picker-label">楼层</span>
          <SSelect :model-value="selectedFloor" :options="floorOptions" size="lg" placeholder="请选择楼层" :disabled="submitting || roomsLoading" @update:model-value="pickFloor" />
        </div>
        <div class="picker-field">
          <span class="picker-label">区域</span>
          <SSelect :model-value="roomId" :options="zoneOptions" size="lg" placeholder="请选择区域" :disabled="submitting || roomsLoading" @update:model-value="pickRoom" />
        </div>
        <div class="picker-field">
          <span class="picker-label">预约日期</span>
          <SSelect :model-value="date" :options="dateSelectOptions" size="lg" placeholder="请选择日期" :disabled="submitting" @update:model-value="pickDate" />
        </div>
      </div>
    </section>

    <!-- 预约条件、紧凑信息条、座位图 -->
    <div class="split booking-split">
    <!-- 筛选与统计操作区 -->
    <div class="split-left">
      <section class="card responsive-compact">
        <div class="card-title-row">
          <h3>预约条件</h3>
        </div>
        <p v-if="policyLoading" role="status">正在加载可约日期…</p>
        <SBanner v-if="policyError" type="error" :title="policyError"><SButton size="sm" :disabled="submitting || policyLoading" @click="refreshPolicy">重新加载日期</SButton></SBanner>
        <SBanner v-if="inputError" type="error" :title="inputError" />
        <p v-if="roomsLoading" role="status">正在加载自习室…</p>
        <SBanner v-if="roomsError" type="error" :title="roomsError"><SButton size="sm" :disabled="submitting || roomsLoading" @click="loadRooms">重新加载自习室</SButton></SBanner>
        <div class="filter-group">
          <div class="filter-row">
            <label for="booking-start-time">开始时间（08:00—22:00，24小时制）</label>
            <div ref="timePicker" class="time-picker">
              <SInput id="booking-start-time" :model-value="searchStart" inputmode="text" maxlength="5" placeholder="9、9:00 或 09:00" :disabled="submitting || !policy" @update:model-value="changeSearchStart" @focus="openTimeMenu = ''" @blur="normalizeSearchStart" />
              <button ref="timeToggle" class="time-picker__toggle" type="button" :disabled="submitting || !policy" :aria-expanded="openTimeMenu === 'start'" aria-label="展开开始时间选项" aria-controls="booking-start-time-options" @click="toggleTimeMenu">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
              </button>
              <div v-if="openTimeMenu === 'start'" id="booking-start-time-options" class="time-picker__menu" role="group" aria-label="开始时间选项">
                <label class="time-picker__part">小时
                  <select v-model="pickerHour" @change="applyPickedTime">
                    <option disabled value="">请选择</option>
                    <option v-for="hour in hourOptions" :key="hour" :value="hour">{{ hour }}</option>
                  </select>
                </label>
                <label class="time-picker__part">分钟
                  <select v-model="pickerMinute" :disabled="!pickerHour" @change="applyPickedTime">
                    <option disabled value="">请选择</option>
                    <option v-for="minute in pickerMinutes" :key="minute" :value="minute">{{ minute }}</option>
                  </select>
                </label>
              </div>
            </div>
          </div>
          <div class="filter-row">
            <label for="booking-duration">学习时长</label>
            <div ref="durationPicker" class="time-picker">
              <SInput
                id="booking-duration"
                :model-value="durationInput"
                inputmode="text"
                maxlength="5"
                placeholder="例如 01:30"
                :disabled="submitting || !policy"
                @update:model-value="changeDuration"
                @focus="openTimeMenu = ''"
                @blur="normalizeDurationInput"
              />
              <button
                ref="durationToggle"
                class="time-picker__toggle"
                type="button"
                :disabled="submitting || !policy"
                :aria-expanded="openTimeMenu === 'duration'"
                aria-label="展开学习时长选项"
                aria-controls="booking-duration-options"
                @click="toggleDurationMenu"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
              </button>
              <div v-if="openTimeMenu === 'duration'" id="booking-duration-options" class="time-picker__menu" role="group" aria-label="学习时长选项">
                <label class="time-picker__part">小时
                  <select v-model="durationHour" :disabled="submitting" @change="applyPickedDuration">
                    <option disabled value="">请选择</option>
                    <option v-for="hour in durationHourOptions" :key="hour" :value="hour">{{ hour }}</option>
                  </select>
                </label>
                <label class="time-picker__part">分钟
                  <select v-model="durationMinute" :disabled="!durationHour || submitting" @change="applyPickedDuration">
                    <option v-if="!durationMinute" disabled value="">请选择</option>
                    <option v-for="minute in durationMinuteOptions" :key="minute" :value="minute">{{ minute }}</option>
                  </select>
                </label>
              </div>
            </div>
          </div>
          <div class="filter-row">
            <label>座位偏好（可选）</label>
            <div class="pref-chips" role="group" aria-label="座位偏好">
              <button v-for="option in preferenceOptions" :key="option.value" type="button" class="pref-chip" :class="{ active: preferences.includes(option.value) }" :aria-pressed="preferences.includes(option.value)" :disabled="submitting || !policy" @click="togglePreference(option.value)">{{ option.label }}</button>
              <button v-if="preferences.length" type="button" class="pref-chip pref-chip--clear" :disabled="submitting" @click="preferences = []">不限</button>
            </div>
          </div>
          <SBanner v-if="shortfall" type="warning" :title="shortfall" />
        </div>
        <!-- 提交预约固定在卡片底部（与参考图一致） -->
        <div class="panel-submit">
          <SButton variant="primary" :disabled="eligibilityLoading || restricted || !policy || policyLoading || !room?.enabled || !selected || !selectedWindow || loading || mapError || queryDirty" :loading="submitting" :aria-describedby="restricted ? 'booking-disabled-reason' : undefined" @click="confirmBooking">提交预约</SButton>
          <p v-if="restricted" id="booking-disabled-reason" class="booking-disabled-reason">预约暂停期间无法提交。</p>
        </div>
      </section>
      <SBanner v-if="bookingError && !restricted" type="error" :title="bookingError">
        <RouterLink v-if="checkBookingResult" :to="{ name: 'mine' }">查看我的预约</RouterLink>
      </SBanner>
      <SBanner v-if="eligibilityError" type="warning" :title="eligibilityError"><SButton size="sm" :disabled="eligibilityLoading" @click="loadEligibility">重新检查</SButton></SBanner>
    </div>

    <!-- 右栏：座位平面图 -->
    <div class="split-right">
      <section ref="seatCard" class="card seat-card">
        <div class="card-title-row">
          <div class="seat-heading">
            <div class="seat-space">
              <div class="seat-room-heading">
                <h3>{{ selectedRoom?.name || '选择座位' }}</h3>
                <SButton v-if="selectedRoom" size="sm" variant="soft" aria-haspopup="dialog" @click="showRoomReviews = true">查看评价</SButton>
              </div>
              <span v-if="room" class="room-brief">开放 {{ showWindows(room.opening_windows) }}</span>
            </div>
            <div class="row-actions">
              <SButton size="sm" :variant="presentation === 'map' ? 'primary' : 'secondary'" @click="presentation='map'">平面图</SButton>
              <SButton size="sm" :disabled="submitting || !room || loading || mapError || !seats.length" aria-label="打开 3D 座位浏览" @click="open3D">3D</SButton>
              <SButton size="sm" :variant="presentation === 'list' ? 'primary' : 'secondary'" @click="presentation='list'">空档列表</SButton>
              <SButton size="sm" :disabled="submitting || !roomId || !policy || loading" @click="refreshSeatMap(true)">刷新</SButton>
            </div>
          </div>
        </div>

        <SBanner v-if="zoneNotice" type="warning" :title="zoneNotice" />
        <SBanner v-if="room?.closed_reasons?.length" type="warning" :title="room.closed_reasons.join('；')" />
        <SBanner v-if="room && !room.enabled" type="warning" title="这间自习室暂不可预约。">{{ room.resource_reason }}</SBanner>
        <SBanner v-if="mapError && !inputError" type="error" :title="mapErrorText || '暂时查不到可用座位。'"><SButton size="sm" :disabled="submitting || policyLoading" @click="refreshPolicy">重新查座</SButton></SBanner>
        <p v-if="!loading && !mapError && !readOnlyBrowse && availability && !results.length" role="status">这个时段没有可约座位，试试其他时间或自习室。</p>
        <p v-if="loading" role="status">正在查找座位…</p>
        <p v-else-if="roomId && date && !hasSearchInputs && !restricted && !mapError" role="status">填写开始时间和学习时长后即可选座。</p>
        <p v-if="presentation === 'list' && room && !loading && !mapError && readOnlyBrowse && !browseWindows.length" role="status">这间自习室当天没有空档。</p>
        <div v-if="presentation === 'list' && !loading && !mapError && (readOnlyBrowse ? browseWindows.length : results.length)" class="table-wrap">
          <div class="table-scroll" tabindex="0" aria-label="空档列表，可左右滑动">
            <table class="table availability-table">
              <thead>
                <tr>
                  <th v-if="!readOnlyBrowse">顺序</th>
                  <th>座位</th>
                  <th>位置</th>
                  <th>空档时间</th>
                  <th>连续时长</th>
                  <th v-if="readOnlyBrowse">状态</th>
                  <th v-else>选择</th>
                </tr>
              </thead>
              <tbody v-if="readOnlyBrowse">
                <tr v-for="window in browseWindows" :key="windowKey(window)">
                  <td>{{ window.seat_no }}</td>
                  <td>{{ window.row_no }}行{{ window.col_no }}列</td>
                  <td>{{ window.available_start }}–{{ window.available_end }}</td>
                  <td>{{ window.duration_minutes }}分钟</td>
                  <td>当天有空档</td>
                </tr>
              </tbody>
              <tbody v-else>
                <tr v-for="(window, index) in rankedResults" :key="windowKey(window)" :class="{ 'earliest-row': index === 0, 'chosen-row': windowKey(window) === windowKey(selectedWindow) }">
                  <td>{{ index + 1 }}</td>
                  <td>{{ window.seat_no }}<STag v-if="index === 0">首选</STag><STag v-if="isPreferredSeat(seatById.get(window.seat_id))" type="warning">偏好</STag></td>
                  <td>{{ window.row_no }}行{{ window.col_no }}列</td>
                  <td>{{ window.available_start }}–{{ window.available_end }}</td>
                  <td>{{ window.duration_minutes }}分钟<div>建议{{ window.suggested_start }}–{{ window.suggested_end }}</div></td>
                  <td><SButton size="sm" :disabled="submitting || restricted" @click="chooseWindow(window)">选择该片段</SButton></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div v-if="presentation === 'map'" class="responsive-scroll" tabindex="0" aria-label="座位平面图，可左右滑动">
        <div v-loading="loading" class="seat-grid-wrap" @mouseover="onGridOver" @mouseleave="onGridLeave">
          <div v-if="!room" class="empty-tip muted">请先选择自习室和日期</div>
          <div v-else :style="frameStyle" class="room-frame">
            <!-- 顶部：窗或墙 -->
            <div class="wall wall-top" :class="{ window: windowSides.top }" aria-hidden="true"></div>
            <!-- 左：窗或墙 -->
            <div class="wall wall-left" :class="{ window: windowSides.left }" aria-hidden="true"></div>
            <!-- 座位网格 -->
            <div :style="gridStyle" class="seat-grid">
              <button
                v-for="s in seats"
                :key="s.id"
                :class="seatClass(s)"
                :data-id="s.id"
                type="button"
                :style="{ gridRow: s.row_no, gridColumn: s.col_no }"
                :aria-label="seatTip(s)"
                :aria-pressed="selected?.id === s.id"
                 :aria-disabled="eligibilityLoading || restricted || !room?.enabled || !hasWindows(s) || s.status !== 'available' || loading || submitting || queryDirty"
                 :disabled="eligibilityLoading || restricted || !room?.enabled || !hasWindows(s) || s.status !== 'available' || loading || submitting || queryDirty"
                @click="onSeatClick(s)"
              >
                <SeatPlanDesk :computer="s.zone === 'computer'" :power="s.has_power" />
                <span class="seat-no">{{ s.seat_no }}<span v-if="!queryDirty && rankedResults[0]?.seat_id === s.id"> · 首选</span></span><span v-if="!queryDirty && s.matching_windows?.length && isPreferredSeat(s)" class="seat-preference">偏好</span>
              </button>
            </div>
            <!-- 右：窗或墙 -->
            <div class="wall wall-right" :class="{ window: windowSides.right }" aria-hidden="true"></div>
            <!-- 底部：窗或墙（有门时底部为墙） -->
            <div class="wall wall-bottom" :class="{ window: windowSides.bottom }">
              <template v-if="!windowSides.bottom">
                <span class="wall-seg" aria-hidden="true"></span>
                <span class="door" aria-hidden="true"></span>
                <span class="wall-seg" aria-hidden="true"></span>
              </template>
            </div>
          </div>
        </div>
        </div>
      </section>

    </div>
  </div>

  <SDialog v-model="showRoomReviews" :title="selectedRoom ? `${selectedRoom.name} · 空间评价` : '空间评价'" width="560px">
    <RoomReviewsView v-if="selectedRoom" :key="selectedRoom.id" :room-id="selectedRoom.id" />
  </SDialog>
  <SeatExplorer v-if="show3D" ref="explorer" :origin="seatCard" :room="room" :seats="seats" :preferences="preferences" :selected-id="selected?.id" :selected-window="selectedWindow" :date="date" :start="start" :end="end" :loading="loading" :submitting="submitting" :browsing-only="readOnlyBrowse" :submit-error="restricted ? '' : bookingError || policyError" :restriction-records="activeRestrictions" :eligibility-checked-at="eligibilityCheckedAt" :policy-ready="!!policy && !policyLoading && !queryDirty" :check-booking-result="checkBookingResult" :shortfall="shortfall" @select="onSeatClick" @submit="confirmBooking" @closed="show3D = false" />

  <!-- 座位悬浮提示 -->
  <Teleport to="body">
    <div
      v-if="hoverTip"
      class="seat-hover-tip"
      :style="{ left: `${hoverTip.x}px`, top: `${hoverTip.y}px` }"
      aria-hidden="true"
    >
      {{ hoverTip.text }}
    </div>
  </Teleport>


  </div>
</template>

<style scoped>
.booking-disabled-reason { margin: 5px 0 0; font-size: var(--fs-caption); color: var(--text-2); }
/* 背景层是 z-index:0 的定位元素，正文块同样进入定位层以绘制在其上 */
.view-heading,
.booking-top,
.booking-split {
  position: relative;
}
/* 左列：浅色磨砂卡片（含提交预约），约 80% 白色 + 模糊，深色文字 */
.booking-split .split-left .card.responsive-compact {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  border-color: rgba(255, 255, 255, .55);
  background: rgba(255, 255, 255, .72);
  backdrop-filter: blur(18px);
  color: #2c3833;
}
.booking-split .split-left .card.responsive-compact .card-title-row h3 { color: #1e2a26; }
/* 座位偏好标签：字体样式与「学习时长（分钟）」一致（同字号/字重/颜色/字距） */
.booking-split .split-left .card.responsive-compact .filter-row > label {
  font-size: inherit;
  font-weight: inherit;
  letter-spacing: inherit;
  color: inherit;
}
.booking-split .split-left .card.responsive-compact .filter-row { color: #3a4642; }
.booking-split .split-left .card.responsive-compact p[role='status'] { color: #5c6862; }
.booking-split .split-left .card.responsive-compact .card-title-row { margin-bottom: 4px; }
/* 恢复「预约条件」标题：全局 workspace.css 会隐藏左列首卡的标题行 */
.booking-split .split-left > .card:first-child .card-title-row { display: flex; }
/* 提交预约固定在卡片底部 */
.booking-split .split-left .panel-submit { margin-top: auto; padding-top: 32px; }
.booking-split .split-left .panel-submit :deep(.s-btn) { width: 100%; }
.booking-split{grid-template-columns:360px minmax(0,1fr);align-items:stretch}
.booking-split .filter-group{display:grid;grid-template-columns:1fr;gap:14px}
.booking-split .split-left{display:flex;flex-direction:column;gap:14px;min-width:0}
.time-range{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:10px;align-items:end}
.time-range label{display:grid;gap:6px;font-size:var(--fs-caption)}
.time-sep{padding-bottom:10px;color:var(--text-3);font-size:var(--fs-body-sm)}
.time-duration{margin:0;color:var(--text-2);font-size:var(--fs-body-sm)}
.time-picker{position:relative;display:flex;align-items:center;gap:8px;width:100%}
.time-picker :deep(.s-input){flex:1;min-width:0}
.time-picker__toggle{display:grid;place-items:center;flex:0 0 38px;width:38px;height:34px;padding:0;border:0;border-radius:var(--r-md);background:transparent;color:#4f5b55;cursor:pointer;transition:background var(--dur-1) var(--ease),border-color var(--dur-1) var(--ease),color var(--dur-1) var(--ease)}
.time-picker__toggle:hover:not(:disabled){background:var(--primary-faint);border-color:var(--primary);color:var(--primary)}
.time-picker__toggle:disabled{opacity:.55;cursor:not-allowed}
.time-picker__toggle svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.time-picker__menu {
  position: absolute;
  z-index: var(--z-popover);
  inset: calc(100% + 6px) 0 auto;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--surface);
  box-shadow: var(--shadow-2);
}
.time-picker__part { display: grid; gap: 5px; min-width: 0; color: var(--text-2); }
.time-picker__part select {
  width: 100%;
  min-height: 36px;
  padding-inline: 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--surface-2);
  color: var(--text-1);
  font: inherit;
  font-variant-numeric: tabular-nums;
}
.time-picker__part select:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
.time-picker__part select:disabled { opacity: .55; }
.more-filters{border-top:1px solid var(--hairline);padding-top:10px;display:grid;gap:10px}
.more-filters summary{cursor:pointer;color:var(--text-3);font-size:var(--fs-caption);list-style:none}
.more-filters summary::-webkit-details-marker{display:none}
.more-filters summary::before{content:'＋ ';color:var(--primary)}
.more-filters[open] summary::before{content:'－ '}
.pref-chips{display:flex;gap:8px;flex-wrap:wrap}
.pref-chip{padding:7px 16px;border:1px solid var(--border);border-radius:999px;background:var(--surface);color:var(--text-2);font:inherit;font-size:var(--fs-body-sm);cursor:pointer;transition:border-color var(--dur-1) var(--ease),background var(--dur-1) var(--ease),color var(--dur-1) var(--ease)}
.pref-chip:hover:not(:disabled){border-color:var(--border-strong)}
.pref-chip.active{border-color:var(--amber-strong);background:var(--amber-weak, var(--primary-faint));color:var(--amber-strong);font-weight:600}
.pref-chip:disabled{opacity:.55;cursor:not-allowed}
.pref-chip--clear{border-style:dashed;color:var(--text-3)}
.seat-free.seat-preferred{box-shadow:inset 0 0 0 2px var(--amber-strong),0 2px 3px #0000000a}
.room-brief { color: var(--text-3); font-size: var(--fs-caption); overflow-wrap: anywhere; }
@media(max-width:1100px){.booking-split{grid-template-columns:minmax(0,1fr)}}
/* 顶部功能行：白磨砂卡（与左侧「预约条件」一致） */
.booking-top{display:block;margin-bottom:20px;padding:18px 20px 20px;border:1px solid rgba(255,255,255,.55);border-radius:var(--r-xl);background:rgba(255,255,255,.72);backdrop-filter:blur(18px)}
.picker-row{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,.7fr) minmax(0,.7fr) minmax(0,1.2fr);gap:14px;align-items:end}
.picker-field{display:grid;gap:6px;min-width:0}
.picker-label{font-size:var(--fs-caption);color:#3a4642}
@media(max-width:1000px){.picker-row{grid-template-columns:1fr 1fr}}
@media(max-width:640px){.picker-row{grid-template-columns:1fr}}
.shortfall-warning{color:var(--amber-strong)}.availability-table{min-width:680px}.earliest-row{background:var(--primary-weak)}.chosen-row{outline:1px solid var(--primary)}.seat-preference{font-size:11px;color:var(--text-2)}
.resource-summary { font-size:var(--fs-caption); color:var(--text-3); line-height:1.7; overflow-wrap:anywhere; margin-bottom:12px; }
.seat-card .seat-heading { width: 100%; display: flex; align-items: center; gap: 10px 16px; flex-wrap: wrap; }
.seat-space { display: grid; gap: 3px; min-width: 0; overflow-wrap: anywhere; }
.seat-room-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; }
/* 自习室选择器 + 示意卡片：与标题相邻、整体靠左 */
.seat-head-tools {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
  margin-inline-end: auto; /* 把右侧空间推给 3D 按钮，本组自身靠左 */
}
/* 示意卡片：单行概要 */
.room-chip {
  min-width: 0;
  max-width: min(360px, 46vw);
  padding: 5px 12px;
  background: var(--surface-2);
  border: 1px solid var(--hairline);
  border-radius: 999px;
  box-shadow: inset 0 1px 0 #ffffff0a;
}
.room-chip__meta {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-caption);
  color: var(--text-4);
  line-height: 1.5;
}
.room-select { flex: 0 0 150px; width: 150px; }
@media (max-width: 720px) {
  .seat-head-tools { margin-inline-end: 0; }
  .room-chip { flex: 1 1 auto; max-width: 100%; }
  .room-select { flex: 0 0 150px; }
}


/* 时段选择并排 */
.time-pair {
  display: grid;
  grid-template-columns: 1fr 20px 1fr;
  gap: 6px;
  align-items: center;
}
.time-pair .arrow {
  text-align: center;
  color: var(--text-4);
}

.booking-summary {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) minmax(320px, 1.15fr) max-content;
  align-items: center;
  gap: 16px;
  padding: 14px 18px;
}
.booking-counts { min-width: 0; }
.booking-counts .kpi-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0; }
.booking-counts .kpi { padding: 6px 10px; }
.booking-counts .kpi-num { font-size: 24px; }
.booking-counts .kpi-label { font-size: 12px; white-space: nowrap; }
.booking-legends { display: grid; gap: 12px; min-width: 0; padding-inline: 16px; border-inline: 1px solid var(--border); }
.booking-legends .legend { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; padding: 0; border: 0; margin: 0; }
.booking-legends .legend-item { gap: 5px; white-space: nowrap; font-size: 12px; }
.booking-actions { display: flex; flex-direction: column; align-items: stretch; justify-content: center; align-self: stretch; gap: 8px; margin: 0; padding: 0; }
.booking-actions :deep(.s-btn) { margin: 0; }
@media (max-width: 1024px) {
  .booking-summary { grid-template-columns: minmax(0, 1fr); gap: 14px; }
  .booking-legends { width: 100%; padding: 14px 0; border-inline: 0; border-block: 1px solid var(--border); }
  .booking-actions { width: 100%; flex-direction: row; align-items: center; }
  .booking-actions :deep(.s-btn) { flex: 1; min-width: 0; }
}
@media (max-width: 420px) {
  .booking-counts .kpi { padding-inline: 4px; }
  .booking-counts .kpi-num { font-size: 22px; }
  .booking-counts .kpi-label, .booking-legends .legend-item { font-size: 11px; }
  .booking-legends .legend { gap: 6px; }
  .booking-legends .dot { width: 11px; height: 11px; flex-shrink: 0; }
}


.legend {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px 12px;
  padding-top: 12px;
  border-top: 1px solid var(--hairline);
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-caption);
  color: var(--text-3);
}
.dot {
  width: 15px;
  height: 15px;
  border-radius: 5px;
  display: inline-block;
  border: 1px solid transparent;
}
.dot-free     { background: var(--seat-free-bg); border-color: var(--seat-free-border); }
.dot-selected { background: var(--primary); }
.dot-occupied { background: var(--seat-occupied-bg); border-color: var(--seat-occupied-border); }
.dot-disabled { background: var(--surface-3); border-color: var(--border); }

/* 桌型 / 窗户 图例 */
.type-ico {
  width: 16px;
  height: 16px;
  display: inline-grid;
  place-items: center;
  color: var(--text-3);
  flex: 0 0 auto;
}
.type-ico--window {
  background:
    linear-gradient(180deg, var(--window-glass-hi), transparent 60%),
    repeating-linear-gradient(90deg, var(--window-frame) 0 2px, var(--window-glass) 2px 8px);
  border: 1px solid var(--window-frame);
  border-radius: 3px;
}
.legend--status {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--hairline);
}

/* 座位图 */
.seat-card {
  min-height: 0;
  /* 选座卡片：与左侧「预约条件」一致的白磨砂卡 */
  border-color: rgba(255, 255, 255, .55);
  background: rgba(255, 255, 255, .72);
  backdrop-filter: blur(18px);
}
.seat-card .seat-heading h3,
.seat-card .card-title-row h3 { color: #1e2a26; }
.seat-card .room-brief { color: #5c6862; }
.seat-card p[role='status'] { color: #5c6862; }
.booking-split > .split-right { align-self: start; }
.booking-split > .split-right > .seat-card:first-child { flex: 0 0 auto; }
.seat-grid-wrap {
  margin-top: 8px;
  padding: 12px;
  background: var(--surface-2);
  border: 1px solid var(--hairline);
  border-radius: var(--r-lg);
  min-height: 0;
  display: grid;
  place-items: start stretch;
}
.empty-tip {
  padding: 60px 0;
  font-size: var(--fs-body);
}
/* 房间框架：墙 + 窗 + 门 包裹座位区 */
.room-frame {
  width: 100%;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) 18px;
  grid-template-rows: 18px auto 18px;
  border-radius: var(--r-lg);
  overflow: hidden;
}
.wall { background: linear-gradient(135deg, #ffffff12, #00000010), var(--wall-solid); box-shadow: inset 0 1px 0 #ffffff12, inset 0 -2px 3px #0002; }
.wall-top { grid-column: 1 / -1; grid-row: 1; }
.wall-left { grid-column: 1; grid-row: 2; }
.wall-right { grid-column: 3; grid-row: 2; }
.wall-bottom {
  grid-column: 1 / -1;
  grid-row: 3;
  display: flex;
  align-items: stretch;
}
.wall-seg { flex: 1 1 auto; }

/* 窗户：水平墙（顶/底）竖窗棂，竖直墙（左/右）横窗棂 */
.wall-top.window,
.wall-bottom.window {
  background:
    linear-gradient(180deg, var(--window-glass-hi), transparent 60%),
    repeating-linear-gradient(90deg, var(--window-frame) 0 3px, var(--window-glass) 3px 22px);
}
.wall-left.window,
.wall-right.window {
  background:
    linear-gradient(90deg, var(--window-glass-hi), transparent 60%),
    repeating-linear-gradient(180deg, var(--window-frame) 0 3px, var(--window-glass) 3px 22px);
}
.wall.window { box-shadow: inset 0 0 0 1px var(--window-frame), inset 3px 0 8px #d0f3ff22, 0 0 12px #95d5ff15; }

/* 门：底墙中间开口 */
.door {
  flex: 0 0 46px;
  position: relative;
  background: var(--door);
  border: 2px solid var(--door-frame);
  border-bottom: none;
  border-radius: 6px 6px 0 0;
}
.door::after {
  content: '';
  position: absolute;
  right: 7px;
  top: 6px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--door-frame);
}

/* 座位区 */
.seat-grid {
  grid-column: 2;
  grid-row: 2;
  min-width: 0;
  display: grid;
  padding: 12px;
  background: linear-gradient(125deg, #d5e6ef0c, transparent 65%), repeating-linear-gradient(0deg, transparent 0 43px, #87999d12 43px 44px), repeating-linear-gradient(90deg, transparent 0 87px, #87999d12 87px 88px), var(--room-floor);
  box-shadow: inset 0 2px 8px #00000012;
}
.seat {
  min-height: 62px;
  min-width: 0;
  padding: 6px 3px;
  appearance: none;
  font-family: inherit;
  border-radius: var(--r-md);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  font-variant-numeric: tabular-nums;
  letter-spacing: .02em;
  cursor: pointer;
  position: relative;
  transition: transform var(--dur-1) var(--ease), box-shadow var(--dur-1) var(--ease),
    background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease);
  user-select: none;
  border: 1px solid transparent;
}
.seat:hover {
  transform: translateY(-1px);
}
.seat:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; z-index: 1; }
.seat[aria-disabled='true']:hover { transform: none; }
.seat-no {
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  opacity: 1;
}
.seat-no::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; box-shadow: 0 0 5px currentColor; }
/* 靠窗座位：桌面靠窗一侧淡蓝窗条（方向随数据） */
.seat-near-window-right::after,
.seat-near-window-left::after {
  content: '';
  position: absolute;
  top: 7px;
  bottom: 7px;
  width: 3px;
  border-radius: 2px;
  background: var(--window-frame);
}
.seat-near-window-right::after { right: 3px; }
.seat-near-window-left::after { left: 3px; }
.seat-near-window-top::after,
.seat-near-window-bottom::after {
  content: '';
  position: absolute;
  left: 7px;
  right: 7px;
  height: 3px;
  border-radius: 2px;
  background: var(--window-frame);
}
.seat-near-window-top::after { top: 3px; }
.seat-near-window-bottom::after { bottom: 3px; }
.seat-free {
  background: linear-gradient(145deg, #ffffff09, transparent), color-mix(in srgb, var(--seat-free-bg) 55%, transparent);
  color: var(--seat-free-color);
  border-color: var(--seat-free-border);
  box-shadow: inset 0 1px 0 #ffffff0c, 0 2px 3px #0000000a;
}
.seat-free:hover {
  background: var(--seat-free-hover-bg);
  border-color: var(--seat-free-hover-border);
}
.seat-selected {
  background: linear-gradient(135deg, #ffffff22, transparent), var(--primary);
  color: #fff;
  border-color: var(--primary-active);
  box-shadow: 0 0 0 3px var(--primary-ring), 0 4px 12px rgba(59, 102, 218, .32);
}
.seat-occupied {
  background: var(--seat-occupied-bg);
  color: var(--seat-occupied-color);
  border-color: var(--seat-occupied-border);
  cursor: not-allowed;
}
.seat-disabled {
  background:
    repeating-linear-gradient(135deg, var(--surface-3) 0 5px, var(--seat-disabled-stripe) 5px 9px);
  color: var(--text-4);
  border-color: var(--border);
  cursor: not-allowed;
  text-decoration: line-through;
  text-decoration-color: var(--text-4);
}
.seat.seat-filtered-out,
.seat:disabled.seat-filtered-out {
  background: color-mix(in srgb, var(--surface-3) 82%, var(--text-4) 18%);
  color: var(--text-4);
  border-color: var(--border);
  filter: grayscale(1);
  opacity: .68;
  cursor: not-allowed;
  box-shadow: none;
  text-decoration: none;
}
.seat.seat-filtered-out :deep(.plan-desk) { filter: grayscale(1) saturate(.15); opacity: .55; }
.seat-disabled :deep(.plan-desk), .seat-occupied :deep(.plan-desk) { filter: saturate(.4) brightness(.85); }
@media (prefers-reduced-motion: reduce) { .seat { transition: none; }.seat:hover { transform: none; } }

/* 座位悬浮提示 */
.seat-hover-tip {
  position: fixed;
  z-index: var(--z-popover);
  transform: translate(-50%, calc(-100% - 10px));
  background: var(--seat-tip-bg);
  color: var(--seat-tip-text);
  font-size: var(--fs-caption);
  padding: 5px 10px;
  border-radius: var(--r-sm);
  pointer-events: none;
  white-space: nowrap;
  box-shadow: var(--shadow-2);
}

.seat-hover-tip::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -4px;
  width: 8px;
  height: 8px;
  transform: translateX(-50%) rotate(45deg);
  background: var(--seat-tip-bg);
}

@media (max-width: 720px) {
  .seat-grid-wrap { padding: 10px; min-width: max-content; }
  .seat-grid { padding: 8px; }
  .seat { border-radius: var(--r-sm); font-size: 10px; }
  .seat-card { overflow: hidden; }
}
</style>
