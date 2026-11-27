import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { findRoomInZone, locationOptions, locationValue, MISSING_LOCATION } from '../src/composables/bookingLocation.js'
import { matchesSeatPreferences, rankSeatsByPreference, seatState, stateColors } from '../src/components/seat3d/seatPresentation.js'

test('location filters preserve spaces with missing building or floor metadata', () => {
  const rooms = [
    { building: '图书馆', floor: '2', name: '2F-A区' },
    { building: '图书馆', floor: null, name: '未登记楼层空间' },
    { building: null, floor: '1', name: '未登记楼栋空间' },
  ]
  assert.equal(locationValue(undefined), MISSING_LOCATION)
  assert.deepEqual(locationOptions(rooms, 'building', '楼栋未登记'), [
    { value: 'value:图书馆', label: '图书馆' },
    { value: MISSING_LOCATION, label: '楼栋未登记' },
  ])
  assert.deepEqual(locationOptions(rooms.slice(0, 2), 'floor', '楼层未登记'), [
    { value: 'value:2', label: '2' },
    { value: MISSING_LOCATION, label: '楼层未登记' },
  ])
})

test('home zone links resolve to the matching room across floors', () => {
  const rooms = ['3', '2', '1'].flatMap(floor => ['A', 'B', 'C', 'D'].map(zone => ({
    building: '图书馆',
    floor,
    name: `${floor}F-${zone}区`,
    enabled: floor !== '1' || zone !== 'B',
  })))

  assert.equal(findRoomInZone(rooms, 'A').name, '1F-A区')
  assert.equal(findRoomInZone(rooms, 'B').name, '2F-B区')
  assert.equal(findRoomInZone(rooms, 'C').name, '1F-C区')
  assert.equal(findRoomInZone(rooms, 'D').name, '1F-D区')
  assert.equal(findRoomInZone(rooms.filter(room => room.name.endsWith('A区')), 'B'), null)
  assert.equal(findRoomInZone(rooms, ['A', 'D']), null)
})

test('3D preference ranking keeps eligible seats first and ranks them stably', () => {
  const seats = [
    { id: 1, status: 'available', matching_windows: [{}], near_window: false, has_power: true },
    { id: 2, status: 'available', matching_windows: [{}], near_window: true, has_power: true },
    { id: 3, status: 'available', matching_windows: [{}], near_window: true, has_power: false },
    { id: 4, status: 'available', matching_windows: [], near_window: true, has_power: true },
  ]
  assert.deepEqual(rankSeatsByPreference(seats, ['window', 'power']).map(seat => seat.id), [2, 1, 3, 4])
  assert.equal(matchesSeatPreferences(seats[1], ['window', 'power']), true)
  assert.equal(seatState(seats[1], null, ['window', 'power']), 'preferred')
  assert.notEqual(stateColors.preferred, stateColors.available)
  assert.equal(seatState(seats[1], 2, ['window', 'power']), 'selected')
  assert.equal(seatState(seats[3], null, ['window', 'power']), 'no_window')
})

test('3D read-only browsing shows all-day availability while preserving unavailable states', () => {
  const available = { id: 1, status: 'available', matching_windows: [], all_windows: [{}] }
  const unavailable = { id: 2, status: 'maintenance', matching_windows: [], all_windows: [{}] }

  assert.equal(seatState(available, null), 'no_window')
  assert.equal(seatState(available, null, [], true), 'available')
  assert.equal(seatState(unavailable, null, [], true), 'maintenance')
})

test('3D selector exposes preference ordering without obsolete time-segment controls', async () => {
  const source = await readFile(new URL('../src/components/seat3d/SeatExplorer.vue', import.meta.url), 'utf8')
  const scene = await readFile(new URL('../src/components/seat3d/SeatScene.vue', import.meta.url), 'utf8')
  assert.match(source, /rankSeatsByPreference\(props\.seats, props\.preferences\)/)
  assert.match(source, /matchesSeatPreferences\(s, preferences\)/)
  assert.match(source, /:preferences="preferences"/)
  assert.match(scene, /model\.updateSelection\(props\.selectedId, props\.preferences, props\.browsingOnly\)/)
  assert.match(scene, /props\.selectionEnabled && seat\?\.status === 'available'/)
  assert.match(scene, /props\.selectionEnabled && !props\.blocked/)
  assert.doesNotMatch(source, /explorer-slot|select-window|explorer-selection/)
})
