import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { it, expect, vi } from 'vitest'
import App from '../src/App'
import VisitorCheckIn from '../src/components/VisitorCheckIn'
import AdminDashboard from '../src/components/AdminDashboard'
import { createRegistration } from '../src/domain/records'
import { setupPin } from '../src/lib/auth'
const fields = {
  name: '테스트학생',
  studentId: 'C000001',
  temperature: '36.5',
  symptom: '감기 - 목감기',
}
async function fillVisitor(user) {
  await user.type(screen.getByLabelText('학번 / 직원 번호'), 'C000001')
  await user.type(screen.getByLabelText('이름'), '테스트학생')
  await user.type(screen.getByRole('spinbutton'), '36.5')
  await user.click(screen.getByRole('button', { name: '감기', exact: true }))
  await user.click(screen.getByRole('button', { name: '목감기', exact: true }))
}
it('shows queue numbers but no names or student IDs in visitor waiting list', () => {
  render(
    <VisitorCheckIn
      records={[createRegistration([], fields)]}
      mutate={vi.fn()}
      onAdmin={vi.fn()}
    />,
  )
  expect(screen.getByText('001')).toBeInTheDocument()
  expect(screen.queryByText('테스트학생')).not.toBeInTheDocument()
  expect(screen.queryByText('C000001')).not.toBeInTheDocument()
})
it('shows success only after persistence, resets personal input', async () => {
  const user = userEvent.setup()
  const mutate = vi.fn(async (change) => change([]))
  render(<VisitorCheckIn records={[]} mutate={mutate} onAdmin={vi.fn()} />)
  await fillVisitor(user)
  await user.click(screen.getByRole('button', { name: '접수하기 →' }))
  expect(await screen.findByText('접수가 완료되었습니다')).toBeInTheDocument()
  expect(mutate).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: '다음 방문자 접수' }))
  expect(screen.getByLabelText('이름')).toHaveValue('')
})
it('preserves form input and shows error on storage failure', async () => {
  const user = userEvent.setup()
  render(
    <VisitorCheckIn
      records={[]}
      mutate={vi.fn().mockRejectedValue(new Error('저장 실패 테스트'))}
      onAdmin={vi.fn()}
    />,
  )
  await fillVisitor(user)
  await user.click(screen.getByRole('button', { name: '접수하기 →' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('저장 실패 테스트')
  expect(screen.getByLabelText('이름')).toHaveValue('테스트학생')
  expect(screen.queryByText('접수가 완료되었습니다')).not.toBeInTheDocument()
})
it('clears abandoned visitor input after 90 seconds', () => {
  vi.useFakeTimers()
  try {
    render(<VisitorCheckIn records={[]} mutate={vi.fn()} onAdmin={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '테스트학생' } })
    act(() => vi.advanceTimersByTime(90001))
    expect(screen.getByLabelText('이름')).toHaveValue('')
  } finally {
    vi.useRealTimers()
  }
})
it('does not mount administrator records without PIN unlock', async () => {
  await setupPin('123456')
  render(<App />)
  expect(screen.queryByRole('heading', { name: '접수 현황' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '담당자 화면' }))
  expect(await screen.findByRole('dialog')).toHaveTextContent('잠금 해제')
  expect(screen.queryByRole('heading', { name: '접수 현황' })).not.toBeInTheDocument()
})
it('unlocks and relocks admin after five minutes idle', async () => {
  await setupPin('123456')
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByRole('button', { name: '담당자 화면' }))
  await user.type(screen.getByLabelText('관리자 PIN'), '123456')
  await user.click(screen.getByRole('button', { name: '잠금 해제', exact: true }))
  expect(await screen.findByRole('heading', { name: '접수 현황' })).toBeInTheDocument()
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 301000)
  await waitFor(
    () => expect(screen.queryByRole('heading', { name: '접수 현황' })).not.toBeInTheDocument(),
    { timeout: 2500 },
  )
})
it('hides the staff entry in kiosk mode', () => {
  render(<VisitorCheckIn records={[]} mutate={vi.fn()} onAdmin={vi.fn()} kiosk />)
  expect(screen.queryByRole('button', { name: '담당자 화면' })).not.toBeInTheDocument()
})
it('opens the admin gate from the hidden logo gesture in kiosk mode', async () => {
  await setupPin('123456')
  window.history.pushState({}, '', '/?kiosk=1')
  const user = userEvent.setup()
  const { container } = render(<App />)
  expect(screen.queryByRole('button', { name: '담당자 화면' })).not.toBeInTheDocument()
  const logo = container.querySelector('.brand-mark')
  for (let i = 0; i < 5; i++) await user.click(logo)
  expect(await screen.findByRole('dialog')).toHaveTextContent('잠금 해제')
  window.history.pushState({}, '', '/')
})
it('blocks check-in and shows a notice outside operating hours', () => {
  render(
    <VisitorCheckIn
      records={[]}
      mutate={vi.fn()}
      onAdmin={vi.fn()}
      closed
      hoursText="월·화·수·목·금 09:00–17:30"
    />,
  )
  expect(screen.getByText('지금은 운영 시간이 아닙니다')).toBeInTheDocument()
  expect(screen.getByText(/09:00–17:30/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '접수하기 →' })).not.toBeInTheDocument()
})
it('shows the recovery code once on first PIN setup, then opens admin', async () => {
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByRole('button', { name: '관리자 PIN 설정' }))
  const dialog = screen.getByRole('dialog')
  await user.type(within(dialog).getByLabelText('관리자 PIN'), '135790')
  await user.type(within(dialog).getByLabelText('PIN 확인'), '135790')
  await user.click(within(dialog).getByRole('button', { name: 'PIN 설정하고 시작' }))
  expect(await screen.findByText('복구 코드 보관')).toBeInTheDocument()
  await user.click(screen.getByLabelText('안전한 곳에 보관했습니다.'))
  await user.click(screen.getByRole('button', { name: '완료하고 관리자 화면 열기' }))
  expect(await screen.findByRole('heading', { name: '접수 현황' })).toBeInTheDocument()
})
it('filters admin records and requires a cancellation reason', async () => {
  const user = userEvent.setup()
  const record = createRegistration([], fields)
  const mutate = vi.fn(async (change) => change([record]))
  render(
    <AdminDashboard records={[record]} mutate={mutate} notify={vi.fn()} onSettings={vi.fn()} />,
  )
  await user.type(screen.getByRole('searchbox'), '없음')
  expect(screen.getByText('표시할 접수 내역이 없습니다')).toBeInTheDocument()
  await user.clear(screen.getByRole('searchbox'))
  await user.click(screen.getByRole('button', { name: '접수 취소', exact: true }))
  const dialog = screen.getByRole('dialog')
  await user.type(within(dialog).getByLabelText('취소 사유'), '방문 취소')
  await user.click(within(dialog).getByRole('button', { name: '확인', exact: true }))
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
})
