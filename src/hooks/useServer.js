import { useCallback, useEffect, useRef, useState } from 'react'
import { api, subscribe } from '../lib/api'

const EMPTY = {
  ready: false,
  online: false,
  error: '',
  pinConfigured: false,
  authenticated: false,
  hours: null,
  today: '',
  revision: 0,
  // 방문자 화면이 보는 것 — 접수번호와 상태뿐이다.
  entries: [],
  // 담당자 화면이 보는 것 — 로그인한 동안에만 채워진다.
  records: [],
}

export function useServer() {
  const [state, setState] = useState(EMPTY)
  const inFlight = useRef(false)

  const sync = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const status = await api.status()
      const queue = await api.queue()
      // 인증이 풀렸는데도 기록을 들고 있으면 화면에 개인정보가 남는다. 반드시 비운다.
      const records = status.authenticated ? (await api.records()).records : []
      setState({
        ...EMPTY,
        ...status,
        ready: true,
        online: true,
        error: '',
        entries: queue.entries,
        records,
      })
    } catch (error) {
      setState((prev) => ({
        ...prev,
        ready: true,
        online: !error.offline,
        error: error.message,
        // 서버와 끊긴 동안 이전 기록을 계속 띄우지 않는다.
        records: error.offline ? [] : prev.records,
        entries: error.offline ? [] : prev.entries,
      }))
    } finally {
      inFlight.current = false
    }
  }, [])

  useEffect(() => {
    void sync()
    const unsubscribe = subscribe(() => {
      void sync()
    })
    // 서버가 잠깐 꺼졌다 켜지는 경우까지 잡으려고 주기 확인도 함께 둔다.
    const timer = setInterval(() => void sync(), 30000)
    return () => {
      unsubscribe()
      clearInterval(timer)
    }
  }, [sync])

  const run = useCallback(
    async (task) => {
      const result = await task()
      await sync()
      return result
    },
    [sync],
  )

  return {
    ...state,
    sync,
    register: (input) => run(() => api.register(input)),
    unlock: (pin) => run(() => api.openSession(pin)),
    setupPin: (pin) => run(() => api.setupPin(pin)),
    recoverPin: (code, pin) => run(() => api.recoverPin(code, pin)),
    lock: () => run(() => api.closeSession().catch(() => {})),
    act: (record, action, fields) => run(() => api.act(record.id, action, record.version, fields)),
    importRecords: (records) => run(() => api.importRecords(records)),
  }
}
