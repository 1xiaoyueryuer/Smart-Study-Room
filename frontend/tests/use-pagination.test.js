import test from 'node:test'
import assert from 'node:assert/strict'
import { nextTick, ref } from 'vue'
import { usePagination } from '../src/composables/usePagination.js'

test('pagination clamps the page when rows shrink and resets on filter change', async () => {
  const items = ref(Array.from({ length: 25 }, (_, index) => index))
  const filter = ref('all')
  const { page, pages, pageItems } = usePagination(items, filter)
  assert.equal(pages.value, 3)
  page.value = 3
  assert.deepEqual([...pageItems.value.slice(0, 3)], [20, 21, 22])
  items.value = items.value.slice(0, 5)
  await nextTick()
  assert.equal(pages.value, 1)
  assert.equal(page.value, 1, '行数减少后页码自动夹紧')
  items.value = Array.from({ length: 25 }, (_, index) => index)
  page.value = 2
  filter.value = 'other'
  await nextTick()
  assert.equal(page.value, 1, '切换筛选回到第一页')
})

test('pagination keeps an empty list on page one with no rows', () => {
  const { page, pages, pageItems } = usePagination(ref([]))
  assert.equal(page.value, 1)
  assert.equal(pages.value, 1)
  assert.deepEqual(pageItems.value, [])
})
