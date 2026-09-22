import { useCallback, useEffect, useRef, useState } from 'react'
import { isOpen, hoursSummary, parseHours } from './lib/schedule'
import { useServer } from './hooks/useServer'
import VisitorCheckIn from './components/VisitorCheckIn'
import AdminGate from './components/AdminGate'
import AdminDashboard from './components/AdminDashboard'
import SettingsPanel from './components/SettingsPanel'
import './App.css'
// 담당자 화면은 5분 손을 떼면 잠긴다. 서버 세션도 같은 시간에 만료된다.
const IDLE_MS = 5 * 60 * 1000
function kioskMode() {
  return new URLSearchParams(window.location.search).get('kiosk') === '1'
}
export default function App() {
  const kiosk = kioskMode()
  const data = useServer()
  const [gate, setGate] = useState(false)
  const [settings, setSettings] = useState(false)
  const [toast, setToast] = useState('')
  const [, setClock] = useState(0)
  const lastActivity = useRef(0)
  const toastTimer = useRef(null)
  const brandTaps = useRef({ count: 0, at: 0 })
  const admin = data.authenticated
  const hours = parseHours(data.hours)
  const open = isOpen(hours, new Date())
  const notify = useCallback((message) => {
    clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = setTimeout(() => setToast(''), 6000)
  }, [])
  const lock = useCallback(async () => {
    setGate(false)
    setSettings(false)
    await data.lock()
  }, [data])
  useEffect(() => () => clearTimeout(toastTimer.current), [])
  // Re-check the operating-hours boundary without a full reload.
  useEffect(() => {
    const timer = setInterval(() => setClock((n) => n + 1), 30000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!admin) return
    const activity = () => {
      lastActivity.current = Date.now()
    }
    const hide = () => {
      if (document.visibilityState === 'hidden') void lock()
    }
    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current >= IDLE_MS) {
        void lock()
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
    if (admin || !data.online) return
    const now = Date.now()
    const state = brandTaps.current
    state.count = now - state.at < 2000 ? state.count + 1 : 1
    state.at = now
    if (state.count >= 5) {
      state.count = 0
      setGate(true)
    }
  }
  const unlocked = () => {
    lastActivity.current = Date.now()
    setGate(false)
  }
  const blocked = !data.online || !data.ready
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
            <button className="button small secondary" onClick={() => void lock()}>
              잠그고 접수 화면으로
            </button>
          )}
        </div>
      </header>
      {data.ready && !data.online && (
        <div className="banner error-message" role="alert">
          {data.error}{' '}
          <button className="text-button" onClick={() => void data.sync()}>
            다시 연결
          </button>
        </div>
      )}
      {data.online && data.error && (
        <div className="banner error-message" role="alert">
          {data.error}{' '}
          <button className="text-button" onClick={() => void data.sync()}>
            다시 확인
          </button>
        </div>
      )}
      {data.ready && data.online && !data.pinConfigured && !kiosk && (
        <div className="banner setup-banner">
          담당자의 최초 설정이 필요합니다.{' '}
          <button className="text-button" onClick={() => setGate(true)}>
            관리자 PIN 설정
          </button>
        </div>
      )}
      {data.ready && data.online && !data.pinConfigured && kiosk && (
        <div className="banner setup-banner">
          담당자 최초 설정이 필요합니다. 서버 PC에서 <code>?kiosk=1</code>을 뺀 주소로 열어 PIN을
          설정해 주세요.
        </div>
      )}
      {admin ? (
        <AdminDashboard
          records={data.records}
          act={data.act}
          notify={notify}
          disabled={blocked}
          onSettings={() => setSettings(true)}
        />
      ) : (
        <VisitorCheckIn
          waiting={data.entries}
          register={data.register}
          disabled={blocked || !data.pinConfigured}
          kiosk={kiosk}
          closed={!open}
          hoursText={hoursSummary(hours)}
          onAdmin={() => {
            if (data.online) setGate(true)
          }}
        />
      )}
      <footer className="app-footer">
        <span>홍익대학교 건강진료센터</span>
        <span>보건실 서버에 저장 · 세 기기가 같은 기록을 봅니다</span>
      </footer>
      {gate && (
        <AdminGate
          configured={data.pinConfigured}
          onClose={() => setGate(false)}
          onUnlock={unlocked}
          unlock={data.unlock}
          setupPin={data.setupPin}
          recoverPin={data.recoverPin}
        />
      )}
      {admin && settings && (
        <SettingsPanel
          onClose={() => setSettings(false)}
          onLock={() => void lock()}
          records={data.records}
          hours={hours}
          importRecords={data.importRecords}
          sync={data.sync}
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
