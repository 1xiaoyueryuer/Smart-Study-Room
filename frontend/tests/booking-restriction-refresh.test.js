import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { h, ref, computed, watch } from 'vue'
import * as restrictionForm from '../src/composables/restrictionForm.js'
import * as availabilitySelection from '../src/composables/availabilitySelection.js'
import * as bookingLocation from '../src/composables/bookingLocation.js'
import * as bookingPolicy from '../src/composables/bookingPolicy.js'
import * as seatPresentation from '../src/components/seat3d/seatPresentation.js'
import { statsClock } from './helpers/statsClock.js'

async function openBooking() {
  const clock = statsClock()
  const document = clock.options.documentRef
  Object.defineProperty(document, 'hidden', { get: () => document.visibilityState === 'hidden' })
  const lifecycle = {}
  const activeRestrictions = [{ reason: '15天内累计两次违规', ends_at: '2026-12-13T10:00:00+08:00', violations: [] }]
  let eligibilityCalls = 0
  let bookable = false
  const doubles = {
    vue: {
      h, ref, computed, watch,
      onMounted: callback => { lifecycle.mount = callback },
      onBeforeUnmount: callback => { lifecycle.unmount = callback },
    },
    'vue-router': { useRoute: () => ({ query: {} }), onBeforeRouteUpdate() {} },
    '../components/seat3d/seatPresentation': seatPresentation,
    '../components/ui/feedback': { message: {}, confirmDialog() {} },
    '../api/room': { getRooms: async () => ({ data: [] }) },
    '../api/reservation': {
      getBookingPolicy: async () => ({
        data: { dates: ['2026-11-28'], campus_today: '2026-11-28', min_duration_minutes: 30, campus_zone: 'Asia/Shanghai', server_now: '2026-11-28T10:00:00+08:00' }
      }),
      createReservation() {}
    },
    '../api/availability': { getAvailability() {} },
    '../api/restriction': {
      async getBookingEligibility() {
        eligibilityCalls++
        return { data: {
          can_book: bookable,
          blocked_by: bookable ? null : 'restrictions',
          active_restrictions: bookable ? [] : activeRestrictions,
          server_now: '2026-11-28T10:00:00+08:00'
        } }
      }
    },
    '../composables/availabilitySelection.js': availabilitySelection,
    '../composables/bookingLocation.js': bookingLocation,
    '../composables/restrictionForm.js': restrictionForm,
    '../composables/bookingPolicy.js': bookingPolicy,
  }
  const context = vm.createContext({
    document, setTimeout, clearTimeout,
    setInterval: clock.options.setIntervalFn,
    clearInterval: clock.options.clearIntervalFn,
  })
  const file = await readFile(new URL('../src/views/BookingView.vue', import.meta.url), 'utf8')
  const source = file.split('<script setup>')[1].split('</script>')[0]
  const module = new vm.SourceTextModule(source + '\nexport { restricted, activeRestrictions, readOnlyBrowse }', { context })
  await module.link(specifier => {
    const values = specifier.endsWith('.vue') ? { default: {} } : doubles[specifier]
    assert.ok(values, specifier)
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value)
    }, { context })
  })
  await module.evaluate()
  await lifecycle.mount()
  await clock.flush()
  return {
    page: module.namespace, clock, lifecycle,
    calls: () => eligibilityCalls,
    liftRestriction: () => { bookable = true },
  }
}

test('a visible booking view picks up removal of the final restriction at nine seconds', async () => {
  const { page, clock, lifecycle, calls, liftRestriction } = await openBooking()
  try {
    assert.equal(page.restricted.value, true)
    assert.equal(page.activeRestrictions.value.length, 1)
    assert.equal(page.readOnlyBrowse.value, true)
    assert.equal(calls(), 1)
    liftRestriction()
    await clock.advance(8999)
    assert.equal(page.restricted.value, true)
    assert.equal(calls(), 1)
    await clock.advance(1)
    assert.equal(page.restricted.value, false)
    assert.equal(page.activeRestrictions.value.length, 0)
    assert.equal(calls(), 2)
    assert.equal(clock.timers.size, 0)
  } finally { lifecycle.unmount() }
})

test('a hidden booking view waits and rechecks immediately when visible again', async () => {
  const { page, clock, lifecycle, calls, liftRestriction } = await openBooking()
  try {
    await clock.visibility('hidden')
    liftRestriction()
    await clock.advance(18000)
    assert.equal(calls(), 1)
    assert.equal(page.restricted.value, true)
    await clock.visibility('visible')
    assert.equal(calls(), 2)
    assert.equal(page.restricted.value, false)
  } finally { lifecycle.unmount() }
  assert.equal(clock.listeners.size, 0)
  assert.equal(clock.timers.size, 0)
})
