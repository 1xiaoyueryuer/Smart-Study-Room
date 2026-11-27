import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { requestError } from '../src/api/requestError.js'
import { createRecordPager, recordQuery } from '../src/composables/recordPage.js'
import { formatCampusDateTime } from '../src/composables/campusDateTime.js'

async function interceptorHarness(token = '') {
  const effects = { notices: [], routes: [], logouts: 0 }
  const storage = new Map(token ? [['token', token]] : [])
  let rejectResponse
  let requestConfig
  const instance = { interceptors: {
    request: { use(fn) { requestConfig = fn } },
    response: { use(ok, fail) { rejectResponse = fail; effects.success = ok } }
  } }
  const mocks = {
    axios: { default: { create: () => instance } },
    './requestError.js': { requestError },
    '../components/ui/feedback': { message: { error: value => effects.notices.push(value) } },
    '../router': { default: { currentRoute: { value: { fullPath: '/mine' } }, push: route => effects.routes.push(route) } },
    '../stores/auth': { useAuthStore: () => ({ logout() { effects.logouts++; storage.delete('token') } }) }
  }
  const localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) }
  const context = vm.createContext({ localStorage, Promise, Blob })
  const source = await readFile(new URL('../src/api/request.js', import.meta.url), 'utf8')
  const module = new vm.SourceTextModule(source, { context })
  await module.link(specifier => {
    const exports = mocks[specifier]
    assert.ok(exports, `Unmocked import: ${specifier}`)
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
    }, { context })
  })
  await module.evaluate()
  return { effects, storage, localStorage, rejectResponse, requestConfig }
}

function envelope(items, query, total = items.length) {
  return { items, total, page: query.page, page_size: query.page_size, server_now: '2026-11-27T10:00:00+08:00' }
}

test('a 500 response keeps the HTTP status and the server message', () => {
  const failure = requestError({ response: { status: 500, data: { message: '服务暂时不可用' } } })
  assert.equal(failure.status, 500)
  assert.equal(failure.message, '服务暂时不可用')
  assert.equal(failure.code, null)
  assert.ok(failure instanceof Error)
})

test('a timeout has no HTTP status and keeps the transport code for retry decisions', () => {
  const failure = requestError({ code: 'ECONNABORTED', message: 'timeout of 10000ms exceeded' })
  assert.equal(failure.status, null)
  assert.equal(failure.code, 'ECONNABORTED')
  assert.equal(failure.message, 'timeout of 10000ms exceeded')
})

test('a network failure without a response falls back to a readable message', () => {
  const failure = requestError({ message: '' })
  assert.equal(failure.status, null)
  assert.equal(failure.message, '网络异常，请稍后重试')
})

test('a 409 conflict keeps the business code and details for the page to explain', () => {
  const failure = requestError({ response: { status: 409, data: { code: 'complaint_stale', message: '状态已变化', details: { version: 3 } } } })
  assert.equal(failure.status, 409)
  assert.equal(failure.code, 'complaint_stale')
  assert.deepEqual({ ...failure.details }, { version: 3 })
})

test('a 500 keeps the user on the page with an error notice and no logout', async () => {
  const { effects, rejectResponse, localStorage } = await interceptorHarness('live-token')
  await assert.rejects(rejectResponse({ response: { status: 500, data: { message: '服务暂时不可用' } }, config: {} }), error => error.status === 500)
  assert.deepEqual(effects.notices, ['服务暂时不可用'])
  assert.equal(effects.logouts, 0)
  assert.deepEqual(effects.routes, [])
  assert.equal(localStorage.getItem('token'), 'live-token', '刷新类失败不能清掉会话')
})

test('silent requests keep their error out of the global notice', async () => {
  const { effects, rejectResponse } = await interceptorHarness()
  await assert.rejects(rejectResponse({ response: { status: 500, data: { message: '内部错误' } }, config: { silent: true } }), error => error.status === 500)
  assert.deepEqual(effects.notices, [])
})

test('a 403 shows the permission message and never logs the user out', async () => {
  const { effects, rejectResponse } = await interceptorHarness('live-token')
  await assert.rejects(rejectResponse({ response: { status: 403, data: { code: 'FORBIDDEN', message: '无座位码管理权限' } }, config: {} }), error => error.status === 403)
  assert.deepEqual(effects.notices, ['无座位码管理权限'])
  assert.equal(effects.logouts, 0)
  assert.deepEqual(effects.routes, [])
})

test('a 401 logs out once per token, so a new session can expire again', async () => {
  const { effects, rejectResponse, storage, localStorage } = await interceptorHarness('token-a')
  await assert.rejects(rejectResponse({ response: { status: 401, data: { message: '过期' } }, config: {} }))
  assert.equal(effects.logouts, 1)
  assert.equal(effects.routes.length, 1)
  assert.equal(effects.routes[0].name, 'login')
  assert.equal(effects.routes[0].query.redirect, '/mine')

  localStorage.setItem('token', 'token-b')
  await assert.rejects(rejectResponse({ response: { status: 401, data: { message: '过期' } }, config: {} }))
  assert.equal(effects.logouts, 2, '换新令牌后过期仍需再次登出')
})

test('a 401 marked skipAuthHandling leaves the session for the caller to manage', async () => {
  const { effects, rejectResponse } = await interceptorHarness('live-token')
  await assert.rejects(rejectResponse({ response: { status: 401, data: { message: '口令错误' } }, config: { skipAuthHandling: true } }), error => error.status === 401)
  assert.equal(effects.logouts, 0)
  assert.deepEqual(effects.routes, [])
})

test('a complaint pager beyond the last page keeps the server total instead of inventing rows', async () => {
  const fetcher = async query => ({ data: envelope([], query, 45) })
  const pager = createRecordPager(fetcher)
  await pager.load(1)
  assert.equal(pager.items.value.length, 0)
  assert.equal(pager.loaded.value, true)
  await pager.turn(4)
  assert.equal(pager.items.value.length, 0)
  assert.equal(pager.snapshot.value.total, 45)
  assert.equal(pager.snapshot.value.page, 4)
  assert.equal(pager.error.value, '')
  pager.dispose()
})

test('page parameters below one are rejected instead of requesting a negative page', async () => {
  assert.throws(() => recordQuery({}, 0), /页码须为正整数/)
  assert.throws(() => recordQuery({}, 1.5), /页码须为正整数/)
  const pager = createRecordPager(async query => ({ data: envelope([], query) }))
  await pager.load(0)
  assert.match(pager.error.value, /页码须为正整数/)
  pager.dispose()
})

test('a server-side 500 while turning pages keeps the previous rows visible', async () => {
  let fail = false
  const rows = [{ id: 1 }, { id: 2 }]
  const pager = createRecordPager(async query => {
    if (fail) throw new Error('服务暂时不可用')
    return { data: envelope(rows, query, 20) }
  })
  await pager.load(1)
  assert.equal(pager.items.value.length, 2)
  fail = true
  await pager.turn(2)
  assert.equal(pager.error.value, '服务暂时不可用')
  assert.equal(pager.items.value.length, 2, '翻页失败不能清空已显示的数据')
  assert.equal(pager.loading.value, false)
  pager.dispose()
})

test('campus time crosses the date boundary when a UTC timestamp belongs to the next campus day', () => {
  assert.equal(formatCampusDateTime('2026-11-27T16:30:00Z'), '2026-11-28 00:30:00')
  assert.equal(formatCampusDateTime('2026-11-27T15:59:59Z'), '2026-11-27 23:59:59')
})
