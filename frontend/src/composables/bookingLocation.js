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
