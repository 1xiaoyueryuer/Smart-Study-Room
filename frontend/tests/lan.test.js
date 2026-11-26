import test from 'node:test'
import assert from 'node:assert/strict'
import {
  START_TIMES, END_TIMES, defaultBoardWindow, adjustEnd, timeText, minuteOf,
  accessLabel, roleLabel, activeLabel
} from '../src/composables/lanBoard.js'

test('看板时间选项与预约规则一致：整30分钟、08:00起、24:00可作结束', () => {
  assert.equal(START_TIMES[0], '08:00')
  assert.equal(START_TIMES.at(-1), '23:30')
  assert.equal(END_TIMES[0], '08:30')
  assert.equal(END_TIMES.at(-1), '24:00')
  assert.equal(START_TIMES.length, 32)
  assert.equal(END_TIMES.length, 32)
  assert.equal(timeText(1440), '24:00')
  assert.equal(minuteOf('24:00'), 1440)
})

test('默认看板窗口从当前时刻向上取整并优先近两小时', () => {
  assert.deepEqual(defaultBoardWindow('2026-11-26T14:24:31+08:00', ['2026-11-26', '2026-11-27', '2026-11-28']), {
    date: '2026-11-26', start: '14:30', end: '16:30'
  })
  assert.deepEqual(defaultBoardWindow('2026-11-26T07:10:00+08:00', ['2026-11-26']), {
    date: '2026-11-26', start: '08:00', end: '10:00'
  })
  assert.deepEqual(defaultBoardWindow('2026-11-26T21:40:00+08:00', ['2026-11-26']), {
    date: '2026-11-26', start: '21:30', end: '23:30'
  })
  assert.deepEqual(defaultBoardWindow('2026-11-26T14:00:00+08:00', ['2026-11-27']), {
    date: '2026-11-27', start: '14:00', end: '16:00'
  })
})

test('结束时间不晚于开始时间时自动顺延30分钟', () => {
  assert.equal(adjustEnd('14:00', '14:00'), '14:30')
  assert.equal(adjustEnd('14:00', '13:30'), '14:30')
  assert.equal(adjustEnd('14:00', '16:00'), '16:00')
  assert.equal(adjustEnd('23:30', '24:00'), '24:00')
})

test('接入方式、身份与活跃时间的展示文案', () => {
  assert.equal(accessLabel('loopback'), '本机')
  assert.equal(accessLabel('lan'), '局域网')
  assert.equal(accessLabel('other'), '非局域网')
  assert.equal(accessLabel('unknown'), '未知')
  assert.equal(roleLabel('student'), '学生')
  assert.equal(roleLabel('staff'), '教职工')
  assert.equal(roleLabel('admin'), '管理员')
  assert.equal(roleLabel('guest'), 'guest')
  assert.equal(activeLabel(12), '12秒前')
  assert.equal(activeLabel(125), '2分钟前')
  assert.equal(activeLabel(-1), '未知')
  assert.equal(activeLabel('abc'), '未知')
})
