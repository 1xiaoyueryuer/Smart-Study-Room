import test from 'node:test'
import assert from 'node:assert/strict'
import { compile } from '@vue/compiler-dom'
import * as vue from 'vue'
import { readFile } from 'node:fs/promises'

function textOf(node) {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node.children != null) return textOf(node.children)
  return ''
}

function findDateTime(node) {
  if (node == null || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findDateTime(child)
      if (found) return found
    }
    return null
  }
  if (node.props?.datetime) return node.props.datetime
  return node.children == null ? null : findDateTime(node.children)
}

async function renderSummary(props) {
  const source = await readFile(new URL('../src/components/BookingConfirmationSummary.vue', import.meta.url), 'utf8')
  const template = source.split('<template>')[1].split('</template>')[0]
  const { code } = compile(template, { mode: 'function' })
  const render = new Function('Vue', code)(vue)
  const vnode = render(props)
  return { vnode, text: textOf(vnode).replace(/\s+/g, ' ').trim() }
}

test('the confirmation summary shows the room, seat, date, time range and sign-in reminder', async () => {
  const { text } = await renderSummary({
    roomName: '1F-A区', seatNo: 'A-01', date: '2026-11-28', start: '09:00', end: '11:00', minutes: 120
  })
  assert.match(text, /自习室 ?1F-A区/)
  assert.match(text, /座位 ?A-01/)
  assert.match(text, /预约时段/)
  assert.match(text, /2026-11-28/)
  assert.match(text, /09:00–11:00/)
  assert.match(text, /120 分钟/)
  assert.match(text, /请在预约开始后 15 分钟内扫码签到/)
})

test('the duration text follows the actual minutes instead of a fixed value', async () => {
  const short = await renderSummary({ roomName: '2F-B区', seatNo: 'B-09', date: '2026-11-29', start: '13:30', end: '14:00', minutes: 30 })
  assert.match(short.text, /13:30–14:00/)
  assert.match(short.text, /30 分钟/)
  assert.doesNotMatch(short.text, /120 分钟/)
})

test('the date is exposed as a machine-readable time element', async () => {
  const { vnode } = await renderSummary({ roomName: '3F-C区', seatNo: 'C-12', date: '2026-12-01', start: '19:00', end: '21:00', minutes: 120 })
  assert.equal(findDateTime(vnode), '2026-12-01')
})
