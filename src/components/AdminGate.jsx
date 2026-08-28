import { useState } from 'react'
import Dialog from './Dialog'
import { resetPinWithRecovery, setupPin, unlockPin } from '../lib/auth'
import { copyText } from '../lib/export'
export default function AdminGate({ configured, onClose, onUnlock }) {
  const [phase, setPhase] = useState('auth')
  const [pin, setPin] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [recoveryInput, setRecoveryInput] = useState('')
  const [issuedCode, setIssuedCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const guard = async (fn) => {
    if (busy) return
    setError('')
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      setError(e.message || '처리하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  const submitAuth = (event) => {
    event.preventDefault()
    void guard(async () => {
      await navigator.locks.request('health-admin-auth', async () => {
        if (!configured) {
          if (pin !== confirmation) throw new Error('두 PIN이 일치하지 않습니다.')
          const { recoveryCode } = await setupPin(pin)
          setIssuedCode(recoveryCode)
          setPhase('show')
        } else {
          await unlockPin(pin)
        }
      })
      if (configured) onUnlock()
    })
  }
  const submitRecovery = (event) => {
    event.preventDefault()
    void guard(async () => {
      if (pin !== confirmation) throw new Error('두 PIN이 일치하지 않습니다.')
      const { recoveryCode } = await navigator.locks.request('health-admin-auth', () =>
        resetPinWithRecovery(recoveryInput, pin),
      )
      setIssuedCode(recoveryCode)
      setPhase('show')
    })
  }
  const title =
    phase === 'show'
      ? '복구 코드 보관'
      : phase === 'recover'
        ? '복구 코드로 PIN 재설정'
        : configured
          ? '관리자 화면 잠금 해제'
          : '관리자 최초 설정'
  return (
    <Dialog title={title} onClose={onClose} busy={busy}>
      {phase === 'show' ? (
        <div className="stack">
          <p className="muted">
            아래 <strong>복구 코드</strong>는 PIN을 잊었을 때 이 기기의 잠금을 다시 설정하는 유일한
            수단입니다. 지금 인쇄하거나 담당자 인수인계 문서에 적어{' '}
            <strong>기기와 분리된 안전한 곳</strong>에 보관하세요. 이 화면을 닫으면 다시 표시되지
            않습니다.
          </p>
          <div className="recovery-code" role="group" aria-label="복구 코드">
            <code>{issuedCode}</code>
            <button
              type="button"
              className="button small secondary"
              onClick={() => void copyText(issuedCode)}
            >
              복사
            </button>
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            안전한 곳에 보관했습니다.
          </label>
          <button
            className="button primary"
            disabled={!saved}
            onClick={() => {
              setIssuedCode('')
              onUnlock()
            }}
          >
            완료하고 관리자 화면 열기
          </button>
        </div>
      ) : phase === 'recover' ? (
        <form onSubmit={submitRecovery} className="stack">
          <p className="muted">
            최초 설정 때 발급한 복구 코드를 입력하고 새 PIN을 설정합니다. 새 복구 코드가 다시
            발급됩니다.
          </p>
          <label>
            복구 코드
            <input
              value={recoveryInput}
              onChange={(e) => setRecoveryInput(e.target.value)}
              autoComplete="off"
              spellCheck="false"
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
              required
            />
          </label>
          <label>
            새 관리자 PIN
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              pattern="[0-9]{6,12}"
              minLength={6}
              maxLength={12}
              placeholder="숫자 6~12자리"
              required
            />
          </label>
          <label>
            새 PIN 확인
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              minLength={6}
              maxLength={12}
              required
            />
          </label>
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? '확인 중…' : 'PIN 재설정'}
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setPhase('auth')
              setError('')
            }}
          >
            뒤로
          </button>
        </form>
      ) : (
        <>
          <p className="muted">
            {configured
              ? '담당자만 PIN을 입력해 주세요. 5분간 사용하지 않거나 다른 창으로 이동하면 다시 잠깁니다.'
              : '방문자에게 기기를 제공하기 전에 담당자가 PIN을 설정해 주세요. 초기 PIN은 제공되지 않으며, 설정 직후 복구 코드가 1회 표시됩니다.'}
          </p>
          <form onSubmit={submitAuth} className="stack">
            <label>
              관리자 PIN{' '}
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                minLength={6}
                maxLength={12}
                pattern="[0-9]{6,12}"
                placeholder="숫자 6~12자리"
                required
                autoFocus
              />
            </label>
            {!configured && (
              <label>
                PIN 확인{' '}
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  minLength={6}
                  maxLength={12}
                  required
                />
              </label>
            )}
            {error && (
              <p role="alert" className="error-message">
                {error}
              </p>
            )}
            <button className="button primary" disabled={busy}>
              {busy ? '확인 중…' : configured ? '잠금 해제' : 'PIN 설정하고 시작'}
            </button>
          </form>
          {configured && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setPhase('recover')
                setPin('')
                setConfirmation('')
                setError('')
              }}
            >
              PIN을 잊으셨나요? 복구 코드로 재설정
            </button>
          )}
        </>
      )}
      <p className="privacy-note">
        이 PIN은 화면 접근을 제한하는 보조 잠금입니다. 기록은 이 브라우저에 암호화 없이 저장되며
        기기 접근 권한이 있는 사람에게 완전히 보호되지 않습니다.
      </p>
    </Dialog>
  )
}
