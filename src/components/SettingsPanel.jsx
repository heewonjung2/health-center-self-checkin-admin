import { useEffect, useRef, useState } from 'react'
import { dateKey } from '../domain/records'
import { api } from '../lib/api'
import { copyText, downloadFile } from '../lib/export'
import { DEFAULT_HOURS, hoursSummary, serializeHours } from '../lib/schedule'
import { readStore } from '../lib/storage'
import Dialog from './Dialog'
const DAY_OPTIONS = [
  [1, '월'],
  [2, '화'],
  [3, '수'],
  [4, '목'],
  [5, '금'],
  [6, '토'],
  [0, '일'],
]
export default function SettingsPanel({
  onClose,
  onLock,
  hours: savedHours,
  importRecords,
  sync,
  notify,
  disabled,
}) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [restorePassword, setRestorePassword] = useState('')
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [newPinConfirmation, setNewPinConfirmation] = useState('')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [recoveryPin, setRecoveryPin] = useState('')
  const [newRecovery, setNewRecovery] = useState('')
  const [hours, setHours] = useState(savedHours ?? DEFAULT_HOURS)
  const [migration, setMigration] = useState(null)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const assertActive = () => {
    if (!active.current || document.visibilityState === 'hidden')
      throw new Error('관리자 화면이 잠겼습니다. 다시 시도해 주세요.')
  }
  const run = async (action) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (error) {
      setError(error.message || '작업을 완료하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  // 백업 암·복호화는 서버가 한다. 태블릿·근로학생 PC는 http로 붙어 있어
  // 브라우저 암호화 기능을 쓸 수 없기 때문이다.
  const backup = (e) => {
    e.preventDefault()
    void run(async () => {
      if (password !== confirmation) throw new Error('백업 암호와 확인 값이 일치하지 않습니다.')
      const { file: encrypted } = await api.backup(password)
      assertActive()
      downloadFile(encrypted, `건강진료센터_${dateKey()}.health-backup.json`, 'application/json')
      setPassword('')
      setConfirmation('')
      notify('암호화 백업을 내려받았습니다. 암호는 파일과 별도로 보관하세요.')
    })
  }
  const restore = (e) => {
    e.preventDefault()
    void run(async () => {
      if (!file || file.size > 10 * 1024 * 1024)
        throw new Error('10MB 이하의 암호화 백업 파일을 선택해 주세요.')
      const { restored } = await api.restore(restorePassword, await file.text())
      assertActive()
      setRestorePassword('')
      setPreview({ restored })
      await sync()
      notify(`백업에서 새 기록 ${restored}건을 복원했습니다. 기존 기록은 덮어쓰지 않았습니다.`)
    })
  }
  // 서버를 쓰기 전에 이 브라우저에만 쌓여 있던 기록을 한 번 올린다.
  const migrate = () =>
    run(async () => {
      const local = readStore().records
      if (!local.length) throw new Error('이 기기에 올릴 기존 기록이 없습니다.')
      const result = await importRecords(local)
      setMigration(result)
      notify(`기존 기록 ${result.added}건을 서버로 옮겼습니다. (중복 ${result.skipped}건 제외)`)
    })
  const changePin = (e) => {
    e.preventDefault()
    void run(async () => {
      if (newPin !== newPinConfirmation) throw new Error('새 PIN과 확인 값이 일치하지 않습니다.')
      assertActive()
      await api.changePin(currentPin, newPin)
      notify('PIN을 변경했습니다. 복구 코드는 그대로 유지됩니다. 새 PIN으로 다시 해제해 주세요.')
      onLock()
    })
  }
  const reissueRecovery = (e) => {
    e.preventDefault()
    void run(async () => {
      const { recoveryCode } = await api.reissueRecoveryCode(recoveryPin)
      assertActive()
      setRecoveryPin('')
      setNewRecovery(recoveryCode)
      notify('새 복구 코드를 발급했습니다. 이전 코드는 더 이상 사용할 수 없습니다.')
    })
  }
  const saveHours = (e) => {
    e.preventDefault()
    void run(async () => {
      await api.saveHours(serializeHours(hours))
      await sync()
      notify(`운영 시간을 저장했습니다. (${hoursSummary(hours)})`)
    })
  }
  const toggleDay = (day) =>
    setHours((prev) => ({
      ...prev,
      days: prev.days.includes(day)
        ? prev.days.filter((d) => d !== day)
        : [...prev.days, day].sort((a, b) => a - b),
    }))
  return (
    <Dialog title="설정 및 백업" onClose={onClose} busy={busy} wide>
      <div className="stack">
        <div className="warning-note">
          <strong>기록은 보건실 서버 PC에 저장됩니다</strong>
          <p>
            세 기기가 같은 기록을 봅니다. 서버 PC가 꺼져 있으면 접수도 멈춥니다. 기록 파일 자체는
            암호화되지 않으므로 서버 PC는 학교가 승인한 기기여야 하고, 잠금 화면을 걸어 두세요.
          </p>
        </div>
        <section className="settings-section">
          <h3>이 기기의 기존 기록 서버로 옮기기</h3>
          <p className="muted">
            서버를 쓰기 전에 이 브라우저에만 쌓여 있던 접수 기록을 서버로 한 번 올립니다. 이미
            서버에 있는 기록은 건너뛰고, 접수번호가 겹치면 새 번호를 줍니다. 기기마다 한 번씩
            실행하면 됩니다.
          </p>
          <button className="button secondary" onClick={migrate} disabled={busy || disabled}>
            이 기기의 기존 기록 올리기
          </button>
          {migration && (
            <p className="muted">
              옮긴 기록 {migration.added}건 · 이미 있어 건너뛴 기록 {migration.skipped}건
            </p>
          )}
        </section>
        <section>
          <h3>암호화 백업 · 복원</h3>
          <p className="muted">
            백업 파일은 AES-GCM으로 암호화합니다. 암호를 잊으면 복구할 수 없습니다. 보관 기한이 지난
            기록은 복원하지 않습니다.
          </p>
          <form onSubmit={backup} className="stack">
            <label>
              백업 암호
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setPreview(null)
                }}
                minLength={12}
                maxLength={128}
                required
                placeholder="12자 이상, 관리자 PIN과 별도로 설정"
              />
            </label>
            <label>
              백업 암호 확인
              <input
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                minLength={12}
                maxLength={128}
                required
              />
            </label>
            <button className="button secondary" disabled={busy}>
              암호화 백업 내려받기
            </button>
          </form>
          <p className="muted restore-intro">
            브라우저 데이터 삭제·기기 교체 등으로 기록이 사라졌을 때, 이전에 ‘암호화 백업
            내려받기’로 저장해 둔 <code>.health-backup.json</code> 파일과 그때 정한 백업 암호로
            복원합니다. 백업에 있는 기록 중 <strong>현재 없는 것만 추가</strong>하며 기존 기록은
            덮어쓰지 않습니다.
          </p>
          <form onSubmit={restore} className="stack restore-form">
            <label>
              복원할 백업 파일 (이 앱에서 내려받은 .health-backup.json)
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null)
                  setPreview(null)
                }}
                required
              />
            </label>
            <label>
              복원 파일의 암호 (백업할 때 정한 암호)
              <input
                type="password"
                value={restorePassword}
                onChange={(e) => {
                  setRestorePassword(e.target.value)
                  setPreview(null)
                }}
                autoComplete="off"
                minLength={12}
                maxLength={128}
                required
              />
            </label>
            <p className="muted">
              새 기록만 추가합니다. 동일 ID의 내용이 다르면 복원을 중단하고, 접수번호 충돌은 새
              번호로 조정합니다.
            </p>
            <button
              className="button secondary"
              disabled={busy || disabled || !file || !restorePassword}
            >
              백업에서 복원
            </button>
          </form>
          {preview && <p className="backup-preview">복원한 기록 {preview.restored}건</p>}
        </section>
        <section className="settings-section">
          <h3>관리자 PIN 변경</h3>
          <form onSubmit={changePin} className="stack">
            <label>
              현재 PIN
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value)}
                required
                minLength={6}
                maxLength={12}
              />
            </label>
            <label>
              새 PIN
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
                required
                pattern="[0-9]{6,12}"
                minLength={6}
                maxLength={12}
              />
            </label>
            <label>
              새 PIN 확인
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={newPinConfirmation}
                onChange={(e) => setNewPinConfirmation(e.target.value)}
                required
                pattern="[0-9]{6,12}"
                minLength={6}
                maxLength={12}
              />
            </label>
            <button className="button secondary" disabled={busy}>
              PIN 변경 후 잠그기
            </button>
          </form>
        </section>
        <section className="settings-section">
          <h3>복구 코드 재발급</h3>
          <p className="muted">
            복구 코드는 PIN을 잊었을 때 잠금을 다시 설정하는 유일한 수단입니다. 분실했거나 노출이
            의심되면 재발급하세요. 재발급하면 이전 코드는 즉시 무효화됩니다.
          </p>
          <form onSubmit={reissueRecovery} className="stack">
            <label>
              현재 PIN
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={recoveryPin}
                onChange={(e) => setRecoveryPin(e.target.value)}
                required
                minLength={6}
                maxLength={12}
              />
            </label>
            <button className="button secondary" disabled={busy}>
              새 복구 코드 발급
            </button>
          </form>
          {newRecovery && (
            <div className="recovery-code" role="group" aria-label="새 복구 코드">
              <code>{newRecovery}</code>
              <button
                type="button"
                className="button small secondary"
                onClick={() => void copyText(newRecovery)}
              >
                복사
              </button>
            </div>
          )}
          {newRecovery && (
            <p className="warning-note">
              이 코드는 지금만 표시됩니다. 인쇄하거나 인수인계 문서에 적어 기기와 분리해 보관하세요.
            </p>
          )}
        </section>
        <section className="settings-section">
          <h3>운영 시간</h3>
          <p className="muted">
            운영 시간 밖에는 방문자 화면에 안내 문구가 표시되고 접수가 막힙니다. 담당자 화면은
            영향을 받지 않습니다. 현재: {hoursSummary(savedHours ?? DEFAULT_HOURS)}
          </p>
          <form onSubmit={saveHours} className="stack">
            <div className="form-row">
              <label>
                시작
                <input
                  type="time"
                  value={hours.start}
                  onChange={(e) => setHours((p) => ({ ...p, start: e.target.value }))}
                  required
                />
              </label>
              <label>
                종료
                <input
                  type="time"
                  value={hours.end}
                  onChange={(e) => setHours((p) => ({ ...p, end: e.target.value }))}
                  required
                />
              </label>
            </div>
            <fieldset className="plain-fieldset">
              <legend>운영 요일</legend>
              <div className="chip-row">
                {DAY_OPTIONS.map(([day, label]) => (
                  <button
                    type="button"
                    key={day}
                    className={`chip ${hours.days.includes(day) ? 'selected' : ''}`}
                    aria-pressed={hours.days.includes(day)}
                    onClick={() => toggleDay(day)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="settings-actions">
              <button className="button secondary" disabled={busy}>
                운영 시간 저장
              </button>
              <button type="button" className="text-button" onClick={() => setHours(DEFAULT_HOURS)}>
                기본값(평일 09:00–17:30)
              </button>
            </div>
          </form>
        </section>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <p className="privacy-note">
          기존 방식과 동일하게 한국 시간 기준 30일 전 날짜까지 보관합니다. 시작 시와 실행 중 1분마다
          정리하며, 앱이 닫혀 있으면 자동 삭제는 실행되지 않습니다. 최초 PIN 설정·분실 대응·기록
          복구는 README의 운영 안내를 확인하세요.
        </p>
      </div>
    </Dialog>
  )
}
