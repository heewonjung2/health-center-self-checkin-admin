import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useServer } from '../src/hooks/useServer'
import { api } from '../src/lib/api'

vi.mock('../src/lib/api', () => ({
  api: {
    status: vi.fn(),
    queue: vi.fn(),
    records: vi.fn(),
    openSession: vi.fn(),
  },
  subscribe: () => () => {},
}))

const status = (authenticated = false) => ({
  authenticated,
  pinConfigured: true,
  hours: null,
  today: '2026-09-23',
  revision: 0,
})

beforeEach(() => {
  vi.clearAllMocks()
  api.status.mockResolvedValue(status(false))
  api.queue.mockResolvedValue({ entries: [] })
  api.records.mockResolvedValue({ records: [] })
})

it('PIN 인증 전 갱신이 진행 중이어도 인증 뒤 상태를 다시 받아온다', async () => {
  const { result } = renderHook(() => useServer())
  await waitFor(() => expect(result.current.ready).toBe(true))

  let releaseOldSync
  api.status.mockImplementationOnce(
    () => new Promise((resolve) => (releaseOldSync = () => resolve(status(false)))),
  )
  api.openSession.mockImplementationOnce(async () => {
    api.status.mockResolvedValue(status(true))
    return { authenticated: true }
  })

  let oldSync
  let unlock
  act(() => {
    oldSync = result.current.sync()
  })
  await waitFor(() => expect(api.status).toHaveBeenCalledTimes(2))
  act(() => {
    unlock = result.current.unlock('123456')
  })
  await waitFor(() => expect(api.openSession).toHaveBeenCalledWith('123456'))

  await act(async () => {
    releaseOldSync()
    await oldSync
    await unlock
  })

  expect(result.current.authenticated).toBe(true)
  expect(api.records).toHaveBeenCalledOnce()
})
