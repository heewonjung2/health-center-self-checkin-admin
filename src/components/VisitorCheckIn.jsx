import { useEffect, useRef, useState } from 'react'
import {
  ACTIVE,
  SYMPTOMS,
  composeSymptom,
  createRegistration,
  dateKey,
  ordered,
  queueLabel,
} from '../domain/records'
const EMPTY = { studentId: '', name: '', temperature: '', main: '', sub: '', detail: '' }
export default function VisitorCheckIn({
  records,
  mutate,
  disabled,
  onAdmin,
  kiosk = false,
  closed = false,
  hoursText = '',
}) {
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const firstInput = useRef(null)
  const today = dateKey()
  const waiting = ordered(records.filter((r) => r.date === today && ACTIVE.includes(r.status)))
  const set = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setError('')
  }
  useEffect(() => {
    if (!Object.values(form).some(Boolean)) return
    const timer = setTimeout(() => {
      setForm(EMPTY)
      setError('일정 시간 입력이 없어 개인정보를 지웠습니다. 다시 접수해 주세요.')
    }, 90000)
    return () => clearTimeout(timer)
  }, [form])
  useEffect(() => {
    if (!receipt) return
    const timer = setTimeout(() => {
      setReceipt(null)
      firstInput.current?.focus()
    }, 20000)
    return () => clearTimeout(timer)
  }, [receipt])
  const submit = async (event) => {
    event.preventDefault()
    if (inFlight.current || disabled) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      const symptom = composeSymptom(form.main, form.sub, form.detail)
      let created
      await mutate((current) => {
        created = createRegistration(current, { ...form, symptom })
        return [...current, created]
      })
      setForm(EMPTY)
      setReceipt({ queueNumber: created.queueNumber })
    } catch (error) {
      setError(error.message)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  return (
    <main id="main" className="visitor-layout">
      <section className="checkin-card">
        <h1>건강진료센터 셀프 접수 시스템</h1>
        <p className="lead">학번·이름·체온·방문 목적을 입력하면 순서대로 안내해 드립니다.</p>
        {closed ? (
          <div className="receipt closed-notice" role="status">
            <span className="success-icon" aria-hidden="true">
              ⏰
            </span>
            <h2>지금은 운영 시간이 아닙니다</h2>
            {hoursText && <p className="muted">운영 시간: {hoursText}</p>}
            <p className="muted">긴급한 도움이 필요하면 담당자에게 바로 말씀해 주세요.</p>
          </div>
        ) : receipt ? (
          <div className="receipt" role="status">
            <span className="success-icon" aria-hidden="true">
              ✓
            </span>
            <h2>접수가 완료되었습니다</h2>
            <p>나의 접수번호</p>
            <strong>{queueLabel(receipt)}</strong>
            <p className="muted">
              번호를 기억하고 잠시 기다려 주세요.
              <br />
              안내 상황에 따라 순서가 변경될 수 있습니다.
            </p>
            <button className="button primary" onClick={() => setReceipt(null)}>
              다음 방문자 접수
            </button>
          </div>
        ) : (
          <form className="stack checkin-form" onSubmit={submit}>
            <fieldset disabled={busy || disabled} className="plain-fieldset stack">
              <div className="form-row">
                <label>
                  학번 / 직원 번호{' '}
                  <input
                    ref={firstInput}
                    name="studentId"
                    value={form.studentId}
                    onChange={(e) => set('studentId', e.target.value)}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck="false"
                    maxLength={30}
                    placeholder="예: C123456"
                    required
                  />
                </label>
                <label>
                  이름{' '}
                  <input
                    name="visitorName"
                    value={form.name}
                    onChange={(e) => set('name', e.target.value)}
                    autoComplete="off"
                    maxLength={50}
                    placeholder="성명을 입력해 주세요"
                    required
                  />
                </label>
              </div>
              <label className="temperature-field">
                체온 <span className="optional">측정한 값을 입력해 주세요</span>
                <div className="input-unit">
                  <input
                    type="number"
                    name="temperature"
                    inputMode="decimal"
                    step="0.1"
                    min="34"
                    max="42"
                    value={form.temperature}
                    onChange={(e) => set('temperature', e.target.value)}
                    autoComplete="off"
                    placeholder="36.5"
                    required
                  />
                  <span>°C</span>
                </div>
              </label>
              <fieldset className="plain-fieldset">
                <legend>방문 목적</legend>
                <div className="symptom-grid">
                  {Object.keys(SYMPTOMS).map((item) => (
                    <button
                      type="button"
                      key={item}
                      className={`choice ${form.main === item ? 'selected' : ''}`}
                      aria-pressed={form.main === item}
                      onClick={() =>
                        setForm((prev) => ({ ...prev, main: item, sub: '', detail: '' }))
                      }
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </fieldset>
              {form.main && form.main !== '기타' && (
                <fieldset className="plain-fieldset detail-area">
                  <legend>세부 증상</legend>
                  <div className="chip-row">
                    {SYMPTOMS[form.main].map((item) => (
                      <button
                        type="button"
                        key={item}
                        className={`chip ${form.sub === item ? 'selected' : ''}`}
                        aria-pressed={form.sub === item}
                        onClick={() => setForm((prev) => ({ ...prev, sub: item, detail: '' }))}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </fieldset>
              )}
              {(form.main === '기타' || form.sub === '직접입력') && (
                <label>
                  증상 직접 입력{' '}
                  <input
                    value={form.detail}
                    onChange={(e) => set('detail', e.target.value)}
                    maxLength={200}
                    required
                    autoComplete="off"
                    placeholder="불편한 증상을 간단히 알려 주세요"
                  />
                </label>
              )}
              <p className="privacy-note">
                입력 내용은 접수와 담당자 확인에만 사용됩니다. 90초간 입력이 없으면 화면이
                초기화됩니다.
              </p>
              {error && (
                <p className="error-message" role="alert">
                  {error}
                </p>
              )}
              <button type="submit" className="button primary large" disabled={busy || disabled}>
                {busy ? '기기에 저장 중…' : '접수하기 →'}
              </button>
            </fieldset>
          </form>
        )}
      </section>
      <aside className="waiting-panel" aria-label="대기 현황">
        <h2>지금 대기 현황</h2>
        <div className="waiting-total">
          <strong>{waiting.filter((r) => r.status === 'waiting').length}</strong>
          <span>명 대기 중</span>
        </div>
        <p className="muted">개인정보 대신 접수번호로 안내합니다.</p>
        <ol className="waiting-list">
          {waiting.slice(0, 8).map((r) => (
            <li key={r.id}>
              <span className="queue-number">{queueLabel(r)}</span>
              <span className={`status ${r.status}`}>
                {r.status === 'in_progress' ? '진료 중' : '대기 중'}
              </span>
            </li>
          ))}
        </ol>
        {waiting.length === 0 && (
          <div className="empty-state compact">
            <span aria-hidden="true">○</span>
            <p>현재 대기 중인 방문자가 없습니다.</p>
          </div>
        )}
        {waiting.length > 8 && <p className="muted">외 {waiting.length - 8}명</p>}
        {!kiosk && (
          <button className="text-button admin-entry" onClick={onAdmin}>
            담당자 화면
          </button>
        )}
      </aside>
    </main>
  )
}
