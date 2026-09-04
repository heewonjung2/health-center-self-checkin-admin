import { createServer } from 'node:http'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../src/App'
import VisitorCheckIn from '../src/components/VisitorCheckIn'
import { createApp } from '../server/app.js'
import { createAuth } from '../server/auth.js'
import { createStore, openDatabase } from '../server/db.js'

// 화면 테스트는 진짜 서버를 띄우고 그 앞에 붙인다. fetch만 그 서버로 돌려 주면
// 화면 → API → 도메인 규칙 → SQLite 저장까지 실제 경로가 그대로 돈다.
let server
let store
let cookie
const realFetch = globalThis.fetch

beforeEach(async () => {
  cookie = ''
  store = createStore(openDatabase(':memory:'))
  const auth = createAuth(store, { idleMs: 60000 })
  server = createServer(createApp({ store, auth, config: { staticDir: '/nonexistent' } }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  globalThis.fetch = async (path, init = {}) => {
    const response = await realFetch(`${origin}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) },
    })
    const issued = response.headers.get('set-cookie')
    if (issued) cookie = issued.split(';')[0]
    return response
  }
})
afterEach(async () => {
  globalThis.fetch = realFetch
  window.history.replaceState({}, '', '/')
  await new Promise((resolve) => server.close(resolve))
})

const visitor = {
  studentId: 'C000001',
  name: '테스트학생',
  temperature: '36.5',
  symptom: '감기 - 목감기',
}
const seed = (input = visitor) =>
  fetch('/api/registrations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

async function fillVisitor(user) {
  await user.type(screen.getByLabelText('학번 / 직원 번호'), 'C000001')
  await user.type(screen.getByLabelText('이름'), '테스트학생')
  await user.click(screen.getByRole('button', { name: '감기', exact: true }))
  await user.click(screen.getByRole('button', { name: '목감기', exact: true }))
  await user.type(screen.getByRole('spinbutton'), '36.5')
}
// 서버 상태(연결·최초 설정 여부)를 받아오기 전에는 접수 폼이 잠겨 있다.
// 그 잠금이 풀리는 것을 준비 완료 신호로 쓴다.
async function waitForReady() {
  await waitFor(() => expect(screen.getByRole('button', { name: '접수하기 →' })).toBeEnabled())
}
async function openAdmin(user, pin = '123456') {
  render(<App />)
  await screen.findByRole('button', { name: '담당자 화면' })
  await waitForReady()
  await user.click(screen.getByRole('button', { name: '담당자 화면' }))
  await user.type(screen.getByLabelText('관리자 PIN'), pin)
  await user.click(screen.getByRole('button', { name: '잠금 해제', exact: true }))
  return screen.findByRole('heading', { name: '접수 현황' })
}
const setupPin = (pin = '123456') =>
  fetch('/api/pin/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  }).then(() => {
    // 최초 설정은 세션 쿠키까지 주므로, 잠긴 상태에서 시작하려면 다시 잠근다.
    cookie = ''
  })

it('대기 목록에는 접수번호만 나오고 이름·학번은 나오지 않는다', async () => {
  await seed()
  render(<App />)
  expect(await screen.findByText('001')).toBeInTheDocument()
  expect(screen.queryByText('테스트학생')).not.toBeInTheDocument()
  expect(screen.queryByText('C000001')).not.toBeInTheDocument()
})

it('접수가 서버에 저장된 뒤에만 접수번호를 안내하고 입력을 지운다', async () => {
  await setupPin()
  const user = userEvent.setup()
  render(<App />)
  await waitForReady()
  await fillVisitor(user)
  await user.click(screen.getByRole('button', { name: '접수하기 →' }))
  expect(await screen.findByText('접수가 완료되었습니다')).toBeInTheDocument()
  expect(store.all()).toHaveLength(1)
  expect(store.all()[0]).toMatchObject({ name: '테스트학생', queueNumber: 1, status: 'waiting' })
  await user.click(screen.getByRole('button', { name: '다음 방문자 접수' }))
  expect(screen.getByLabelText('이름')).toHaveValue('')
})

it('두통·감기일 때만 체온을 묻고, 체온 없이도 접수된다', async () => {
  await setupPin()
  const user = userEvent.setup()
  render(<App />)
  await waitForReady()
  await user.type(screen.getByLabelText('학번 / 직원 번호'), 'C000001')
  await user.type(screen.getByLabelText('이름'), '테스트학생')
  await user.click(screen.getByRole('button', { name: '소화불량', exact: true }))
  await user.click(screen.getByRole('button', { name: '체함', exact: true }))
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '감기', exact: true }))
  expect(screen.getByRole('spinbutton')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '목감기', exact: true }))
  await user.click(screen.getByRole('button', { name: '접수하기 →' }))
  expect(await screen.findByText('접수가 완료되었습니다')).toBeInTheDocument()
  expect(store.all()[0].temperature).toBe(null)
})

it('서버가 거절하면 입력을 지우지 않고 사유를 보여 준다', async () => {
  await setupPin()
  await seed()
  const user = userEvent.setup()
  render(<App />)
  await waitForReady()
  await fillVisitor(user)
  await user.click(screen.getByRole('button', { name: '접수하기 →' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('진행 중인 접수')
  expect(screen.getByLabelText('이름')).toHaveValue('테스트학생')
  expect(screen.queryByText('접수가 완료되었습니다')).not.toBeInTheDocument()
})

it('90초 동안 입력이 없으면 개인정보를 지운다', () => {
  vi.useFakeTimers()
  try {
    render(<VisitorCheckIn waiting={[]} register={vi.fn()} onAdmin={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '테스트학생' } })
    act(() => vi.advanceTimersByTime(90001))
    expect(screen.getByLabelText('이름')).toHaveValue('')
  } finally {
    vi.useRealTimers()
  }
})

it('키오스크 모드에서는 담당자 버튼을 감춘다', () => {
  render(<VisitorCheckIn waiting={[]} register={vi.fn()} onAdmin={vi.fn()} kiosk />)
  expect(screen.queryByRole('button', { name: '담당자 화면' })).not.toBeInTheDocument()
})

it('PIN을 풀기 전에는 담당자 기록이 화면에 올라오지 않는다', async () => {
  await setupPin()
  await seed()
  render(<App />)
  await screen.findByText('001')
  expect(screen.queryByRole('heading', { name: '접수 현황' })).not.toBeInTheDocument()
  expect(screen.queryByText('테스트학생')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '담당자 화면' }))
  expect(await screen.findByRole('dialog')).toHaveTextContent('잠금 해제')
  expect(screen.queryByText('테스트학생')).not.toBeInTheDocument()
})

it('PIN을 풀면 담당자 화면이 열리고, 잠그면 기록이 화면에서 사라진다', async () => {
  await setupPin()
  await seed()
  const user = userEvent.setup()
  await openAdmin(user)
  expect(await screen.findByText('테스트학생')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '잠그고 접수 화면으로' }))
  await waitFor(() => expect(screen.queryByText('테스트학생')).not.toBeInTheDocument())
})

it('5분 동안 조작이 없으면 담당자 화면이 잠긴다', async () => {
  await setupPin()
  const user = userEvent.setup()
  await openAdmin(user)
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 301000)
  await waitFor(
    () => expect(screen.queryByRole('heading', { name: '접수 현황' })).not.toBeInTheDocument(),
    { timeout: 2500 },
  )
})

it('최초 설정에서 복구 코드를 한 번 보여 주고 담당자 화면으로 들어간다', async () => {
  window.history.replaceState({}, '', '/')
  const user = userEvent.setup()
  render(<App />)
  await user.click(await screen.findByRole('button', { name: '관리자 PIN 설정' }))
  await user.type(screen.getByLabelText('관리자 PIN'), '123456')
  await user.type(screen.getByLabelText('PIN 확인'), '123456')
  await user.click(screen.getByRole('button', { name: 'PIN 설정하고 시작' }))
  const code = await screen.findByRole('group', { name: '복구 코드' })
  expect(code.textContent).toMatch(/[0-9A-Z]{5}(-[0-9A-Z]{5}){3}/)
  await user.click(screen.getByLabelText('안전한 곳에 보관했습니다.'))
  await user.click(screen.getByRole('button', { name: '완료하고 관리자 화면 열기' }))
  expect(await screen.findByRole('heading', { name: '접수 현황' })).toBeInTheDocument()
})

it('키오스크 모드에서 로고 5회 탭으로 담당자 화면을 연다', async () => {
  await setupPin()
  window.history.replaceState({}, '', '/?kiosk=1')
  const user = userEvent.setup()
  const { container } = render(<App />)
  await waitForReady()
  expect(screen.queryByRole('button', { name: '담당자 화면' })).not.toBeInTheDocument()
  const logo = container.querySelector('.brand-mark')
  for (let i = 0; i < 5; i++) await user.click(logo)
  expect(await screen.findByRole('dialog')).toHaveTextContent('잠금 해제')
})

it('담당자 화면에서 취소하려면 사유가 있어야 한다', async () => {
  await setupPin()
  await seed()
  const user = userEvent.setup()
  await openAdmin(user)
  await screen.findByText('테스트학생')
  await user.click(screen.getByRole('button', { name: '접수 취소' }))
  const dialog = await screen.findByRole('dialog')
  // 사유 없이 확인을 눌러도 넘어가지 않는다(입력 자체가 필수, 서버도 한 번 더 막는다).
  await user.click(within(dialog).getByRole('button', { name: '확인' }))
  expect(within(dialog).getByLabelText(/취소 사유/)).toBeRequired()
  expect(store.all()[0].status).toBe('waiting')
  await user.type(within(dialog).getByLabelText(/취소 사유/), '본인 요청')
  await user.click(within(dialog).getByRole('button', { name: '확인' }))
  await waitFor(() => expect(store.all()[0].status).toBe('cancelled'))
})
