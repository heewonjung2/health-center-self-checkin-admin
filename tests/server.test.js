import { createServer } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../server/app.js'
import { createAuth } from '../server/auth.js'
import { createStore, openDatabase } from '../server/db.js'
import { createRegistration, dateKey } from '../src/domain/records.js'

let server
let base
let store
let auth
let cookie

const visitor = {
  studentId: 'c000001',
  name: '테스트학생',
  temperature: '36.5',
  symptom: '감기 - 목감기',
}

async function call(path, { method = 'GET', body, session = false } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(session && cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const setCookie = response.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

beforeEach(async () => {
  cookie = null
  store = createStore(openDatabase(':memory:'))
  auth = createAuth(store, { idleMs: 60000 })
  server = createServer(createApp({ store, auth, config: { staticDir: '/nonexistent' } }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}/api`
})
afterEach(() => new Promise((resolve) => server.close(resolve)))

const unlock = async () => {
  await call('/pin/setup', { method: 'POST', body: { pin: '123456' } })
}

describe('접수 태블릿이 쓰는 공개 경로', () => {
  it('접수하면 접수번호만 돌려주고, 개인정보는 응답에 없다', async () => {
    const created = await call('/registrations', { method: 'POST', body: visitor })
    expect(created.status).toBe(201)
    expect(created.body.queueNumber).toBe(1)
    expect(JSON.stringify(created.body)).not.toContain('테스트학생')
    const queue = await call('/queue')
    expect(queue.body.entries).toEqual([{ queueNumber: 1, status: 'waiting' }])
    expect(JSON.stringify(queue.body)).not.toContain('C000001')
  })
  it('같은 학번으로 진행 중인 접수가 있으면 막는다', async () => {
    await call('/registrations', { method: 'POST', body: visitor })
    const again = await call('/registrations', { method: 'POST', body: visitor })
    expect(again.status).toBe(400)
    expect(again.body.error).toContain('진행 중인 접수')
    expect(store.all()).toHaveLength(1)
  })
  it('체온 없이도 접수되고 잘못된 체온은 거부한다', async () => {
    const created = await call('/registrations', {
      method: 'POST',
      body: { ...visitor, temperature: '', symptom: '소화불량 - 체함' },
    })
    expect(created.status).toBe(201)
    expect(store.all()[0].temperature).toBe(null)
    const invalid = await call('/registrations', {
      method: 'POST',
      body: { ...visitor, studentId: 'c2', temperature: '50' },
    })
    expect(invalid.status).toBe(400)
  })
})

describe('담당자 인증', () => {
  it('로그인 없이는 개인정보가 담긴 경로를 열어 주지 않는다', async () => {
    await call('/registrations', { method: 'POST', body: visitor })
    for (const path of ['/records', '/audit']) {
      const denied = await call(path)
      expect(denied.status).toBe(401)
      expect(JSON.stringify(denied.body)).not.toContain('테스트학생')
    }
  })
  it('최초 PIN 설정은 한 번만 되고 복구 코드를 한 번 보여 준다', async () => {
    const setup = await call('/pin/setup', { method: 'POST', body: { pin: '123456' } })
    expect(setup.status).toBe(201)
    expect(setup.body.recoveryCode).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}$/)
    const again = await call('/pin/setup', { method: 'POST', body: { pin: '654321' } })
    expect(again.status).toBe(400)
  })
  it('PIN이 맞아야 세션이 열리고, 로그아웃하면 다시 막힌다', async () => {
    await unlock()
    expect((await call('/records', { session: true })).status).toBe(200)
    const wrong = await call('/session', { method: 'POST', body: { pin: '000000' } })
    expect(wrong.status).toBe(401)
    await call('/session', { method: 'DELETE', session: true })
    expect((await call('/records', { session: true })).status).toBe(401)
  })
  it('세션이 만료되면 담당자 경로가 다시 잠긴다', async () => {
    let clock = 0
    const shortAuth = createAuth(store, { idleMs: 1000, now: () => clock })
    const shortServer = createServer(
      createApp({ store, auth: shortAuth, config: { staticDir: '/nonexistent' } }),
    )
    await new Promise((resolve) => shortServer.listen(0, '127.0.0.1', resolve))
    const shortBase = `http://127.0.0.1:${shortServer.address().port}/api`
    const setup = await fetch(`${shortBase}/pin/setup`, {
      method: 'POST',
      body: JSON.stringify({ pin: '123456' }),
    })
    const shortCookie = setup.headers.get('set-cookie').split(';')[0]
    const fresh = await fetch(`${shortBase}/records`, { headers: { Cookie: shortCookie } })
    expect(fresh.status).toBe(200)
    clock = 5000
    const expired = await fetch(`${shortBase}/records`, { headers: { Cookie: shortCookie } })
    expect(expired.status).toBe(401)
    await new Promise((resolve) => shortServer.close(resolve))
  })
  it('복구 코드로 PIN을 재설정하면 코드가 새로 발급된다', async () => {
    const setup = await call('/pin/setup', { method: 'POST', body: { pin: '123456' } })
    const reset = await call('/pin/recover', {
      method: 'POST',
      body: { recoveryCode: setup.body.recoveryCode, pin: '654321' },
    })
    expect(reset.status).toBe(200)
    expect(reset.body.recoveryCode).not.toBe(setup.body.recoveryCode)
    expect((await call('/session', { method: 'POST', body: { pin: '654321' } })).status).toBe(200)
  })
})

describe('담당자 기록 조작', () => {
  it('상태 전환과 낙관적 잠금이 서버에서 지켜진다', async () => {
    await unlock()
    await call('/registrations', { method: 'POST', body: visitor })
    const id = store.all()[0].id
    const started = await call(`/records/${id}/start`, {
      method: 'POST',
      body: { expectedVersion: 1 },
      session: true,
    })
    expect(started.status).toBe(200)
    expect(started.body.record.status).toBe('in_progress')
    const stale = await call(`/records/${id}/complete`, {
      method: 'POST',
      body: { expectedVersion: 1 },
      session: true,
    })
    expect(stale.status).toBe(400)
    expect(stale.body.error).toContain('다른 화면에서 변경된 기록')
    expect(store.all()[0].status).toBe('in_progress')
  })
  it('취소는 사유가 있어야 하고 기록에 남는다', async () => {
    await unlock()
    await call('/registrations', { method: 'POST', body: visitor })
    const record = store.all()[0]
    const noReason = await call(`/records/${record.id}/cancel`, {
      method: 'POST',
      body: { expectedVersion: 1, fields: {} },
      session: true,
    })
    expect(noReason.status).toBe(400)
    const cancelled = await call(`/records/${record.id}/cancel`, {
      method: 'POST',
      body: { expectedVersion: 1, fields: { reason: '본인 요청' } },
      session: true,
    })
    expect(cancelled.body.record.status).toBe('cancelled')
    expect(cancelled.body.record.history.at(-1)).toMatchObject({
      action: '접수 취소',
      note: '본인 요청',
    })
  })
  it('감사 기록에 담당자 행위가 남는다', async () => {
    await unlock()
    await call('/registrations', { method: 'POST', body: visitor })
    const audit = await call('/audit', { session: true })
    expect(audit.body.entries.map((entry) => entry.action)).toContain('접수')
    expect(audit.body.entries.map((entry) => entry.action)).toContain('관리자 PIN 최초 설정')
  })
})

describe('기존 기기 기록 이관', () => {
  it('중복은 건너뛰고 접수번호가 겹치면 새 번호를 준다', async () => {
    await unlock()
    const today = dateKey()
    const first = createRegistration([], { ...visitor, studentId: 'c1' }, new Date(), 'old-1')
    const second = createRegistration([first], { ...visitor, studentId: 'c2' }, new Date(), 'old-2')
    await call('/registrations', { method: 'POST', body: { ...visitor, studentId: 'c9' } })
    const result = await call('/import', {
      method: 'POST',
      body: { records: [first, second, first] },
      session: true,
    })
    expect(result.body).toMatchObject({ added: 2, skipped: 1 })
    const numbers = store
      .all()
      .filter((r) => r.date === today)
      .map((r) => r.queueNumber)
    expect(new Set(numbers).size).toBe(numbers.length)
  })
  it('형식이 깨진 기록은 전체를 거부하고 아무것도 남기지 않는다', async () => {
    await unlock()
    const result = await call('/import', {
      method: 'POST',
      body: { records: [{ id: 'broken' }] },
      session: true,
    })
    expect(result.status).toBe(400)
    expect(store.all()).toHaveLength(0)
  })
})

describe('보관 기간', () => {
  it('30일이 지난 기록은 서버가 지운다', async () => {
    const old = createRegistration([], visitor, new Date('2026-01-01T02:00:00Z'), 'old')
    store.apply((records) => [...records, old])
    expect(store.all()).toHaveLength(1)
    expect(store.purge(new Date('2026-09-04T02:00:00Z'))).toBe(1)
    expect(store.all()).toHaveLength(0)
  })
})
