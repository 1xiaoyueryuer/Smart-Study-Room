export const MISSING_LOCATION = 'missing:'

const LOCATION_VALUE_PREFIX = 'value:'

export function locationValue(value) {
  const normalized = value == null ? '' : String(value).trim()
  return normalized ? `${LOCATION_VALUE_PREFIX}${normalized}` : MISSING_LOCATION
}

export function locationOptions(items, field, missingLabel, format = value => value) {
  const values = [...new Set(items.map(item => locationValue(item[field])))]
  values.sort((left, right) => {
    if (left === MISSING_LOCATION) return 1
    if (right === MISSING_LOCATION) return -1
    return left.slice(LOCATION_VALUE_PREFIX.length).localeCompare(right.slice(LOCATION_VALUE_PREFIX.length), 'zh')
  })
  return values.map(value => ({
    value,
    label: value === MISSING_LOCATION
      ? missingLabel
      : format(value.slice(LOCATION_VALUE_PREFIX.length)),
  }))
}

export function bookingZone(room) {
  return String(room?.name || '').match(/([A-D])区\s*$/i)?.[1].toUpperCase() ?? ''
}

export function findRoomInZone(rooms, zone) {
  if (typeof zone !== 'string' || !/^[A-D]$/i.test(zone)) return null

  const matches = rooms.filter(room => bookingZone(room) === zone.toUpperCase())
  if (!matches.length) return null

  const enabled = matches.filter(room => room.enabled)
  const candidates = enabled.length ? enabled : matches
  const building = locationOptions(candidates, 'building', '')[0].value
  const buildingRooms = candidates.filter(room => locationValue(room.building) === building)
  const floor = locationOptions(buildingRooms, 'floor', '')[0].value
  return buildingRooms.find(room => locationValue(room.floor) === floor)
}
