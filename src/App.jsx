import { useCallback, useEffect, useRef, useState } from 'react'
import { AUTH_KEY, IDLE_MS, readCredential } from './lib/auth'
import { isOpen, readHours, hoursSummary } from './lib/schedule'
import { useRecords } from './hooks/useRecords'
import VisitorCheckIn from './components/VisitorCheckIn'
import AdminGate from './components/AdminGate'
import AdminDashboard from './components/AdminDashboard'
import SettingsPanel from './components/SettingsPanel'
import './App.css'
function authState() {
  try {
    return { configured: Boolean(readCredential()), error: '' }
  } catch (error) {
    return { configured: false, error: error.message }
  }
}
function kioskMode() {
  return new URLSearchParams(window.location.search).get('kiosk') === '1'
}
export default function App() {
  const kiosk = kioskMode()
  const data = useRecords()
  const [auth, setAuth] = useState(authState)
  const [admin, setAdmin] = useState(false)
  const [gate, setGate] = useState(false)
  const [settings, setSettings] = useState(false)
  const [toast, setToast] = useState('')
  const [, setClock] = useState(0)
  const lastActivity = useRef(0)
  const adminAccess = useRef(false)
  const toastTimer = useRef(null)
  const brandTaps = useRef({ count: 0, at: 0 })
  const supported = Boolean(globalThis.crypto?.subtle && navigator.locks?.request)
  const hours = readHours()
  const open = isOpen(hours, new Date())
  const notify = useCallback((message) => {
    clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = setTimeout(() => setToast(''), 6000)
  }, [])
  const lock = useCallback(() => {
    adminAccess.current = false
    setAdmin(false)
    setGate(false)
    setSettings(false)
    setAuth(authState())
  }, [])
  useEffect(() => () => clearTimeout(toastTimer.current), [])
  // Re-check the operating-hours boundary without a full reload.
  useEffect(() => {
    const timer = setInterval(() => setClock((n) => n + 1), 30000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    const sync = (e) => {
      if (e.key === AUTH_KEY || e.key === null) lock()
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [lock])
  useEffect(() => {
    if (!admin) return
    const activity = () => {
      lastActivity.current = Date.now()
    }
    const hide = () => {
      if (document.visibilityState === 'hidden') lock()
    }
    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current >= IDLE_MS) {
        lock()
        notify('관리자 화면이 자동으로 잠겼습니다.')
      }
    }, 1000)
    for (const event of ['pointerdown', 'keydown', 'scroll'])
      window.addEventListener(event, activity, { passive: true })
    document.addEventListener('visibilitychange', hide)
    return () => {
      clearInterval(timer)
      for (const event of ['pointerdown', 'keydown', 'scroll'])
        window.removeEventListener(event, activity)
      document.removeEventListener('visibilitychange', hide)
    }
  }, [admin, lock, notify])
  // Hidden entry point for locked-down kiosks: 5 quick taps on the logo opens the gate.
  const brandTap = () => {
    if (admin || !supported || auth.error) return
    const now = Date.now()
    const state = brandTaps.current
    state.count = now - state.at < 2000 ? state.count + 1 : 1
    state.at = now
    if (state.count >= 5) {
      state.count = 0
      setGate(true)
    }
  }
  const unlock = () => {
    if (document.visibilityState === 'hidden') return
    lastActivity.current = Date.now()
    adminAccess.current = true
    setAuth(authState())
    setGate(false)
    setAdmin(true)
  }
  const adminMutate = (change) =>
    data.mutate((current) => {
      if (
        !adminAccess.current ||
        Date.now() - lastActivity.current >= IDLE_MS ||
        document.visibilityState === 'hidden'
      )
        throw new Error('관리자 화면이 잠겼습니다. 다시 잠금을 해제해 주세요.')
      return change(current)
    })
  const blocked = !supported || Boolean(data.error || auth.error)
  return (
    <div className={`app ${admin ? 'admin-mode' : 'visitor-mode'}`}>
      <a href="#main" className="skip-link">
        본문으로 이동
      </a>
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" onClick={brandTap}>
            H<span>+</span>
          </span>
          <div>
            <strong>홍익대학교 건강진료센터</strong>
            <span>HEALTH &amp; WELLNESS CENTER</span>
          </div>
        </div>
        <div className="header-actions">
          <span className="mode-label">
            <i />
            {admin ? '담당자 모드' : '방문자 셀프 접수'}
          </span>
          {admin && (
            <button className="button small secondary" onClick={lock}>
              잠그고 접수 화면으로
            </button>
          )}
        </div>
      </header>
      {!supported && (
        <div className="banner error-message" role="alert">
          안전한 저장 기능을 사용할 수 없습니다. HTTPS 주소와 최신 Chrome 또는 Edge에서 열어 주세요.
        </div>
      )}
      {auth.error && (
        <div className="banner error-message" role="alert">
          {auth.error}
        </div>
      )}
      {data.error && (
        <div className="banner error-message" role="alert">
          {data.error}{' '}
          <button className="text-button" onClick={data.refresh}>
            다시 확인
          </button>
        </div>
      )}
      {!auth.configured && !auth.error && supported && !kiosk && (
        <div className="banner setup-banner">
          담당자의 최초 기기 설정이 필요합니다.{' '}
          <button className="text-button" onClick={() => setGate(true)}>
            관리자 PIN 설정
          </button>
        </div>
      )}
      {!auth.configured && !auth.error && supported && kiosk && (
        <div className="banner setup-banner">
          담당자 최초 설정이 필요합니다. 주소창에서 <code>?kiosk=1</code>을 뺀 관리자 화면으로 열어
          PIN을 설정해 주세요.
        </div>
      )}
      {admin ? (
        <AdminDashboard
          records={data.records}
          mutate={adminMutate}
          notify={notify}
          disabled={blocked}
          onSettings={() => setSettings(true)}
        />
      ) : (
        <VisitorCheckIn
          records={data.error ? [] : data.records}
          mutate={data.mutate}
          disabled={blocked || !auth.configured}
          kiosk={kiosk}
          closed={!open}
          hoursText={hoursSummary(hours)}
          onAdmin={() => {
            if (supported && !auth.error) setGate(true)
          }}
        />
      )}
      <footer className="app-footer">
        <span>홍익대학교 건강진료센터</span>
        <span>기기 내 저장 · 다른 기기와 동기화되지 않음</span>
      </footer>
      {gate && (
        <AdminGate configured={auth.configured} onClose={() => setGate(false)} onUnlock={unlock} />
      )}
      {admin && settings && (
        <SettingsPanel
          onClose={() => setSettings(false)}
          onLock={lock}
          mutate={adminMutate}
          notify={notify}
          disabled={blocked}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}
