import { useState } from 'react'
import { dateKey, queueLabel, timeLabel } from '../domain/records'
import Dialog from './Dialog'
export default function RecordEditor({ record, onClose, onSave }) {
  const [form, setForm] = useState({ ...record, temperature: record.temperature ?? '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))
  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await onSave(form)
      onClose()
    } catch (error) {
      setError(error.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog title={`${queueLabel(record)} · 접수 및 진료 기록`} onClose={onClose} busy={busy} wide>
      <form onSubmit={submit} className="stack">
        <fieldset disabled={busy || record.status === 'cancelled'} className="plain-fieldset stack">
          <div className="form-row">
            <label>
              학번 / 직원 번호
              <input
                value={form.studentId}
                onChange={(e) => set('studentId', e.target.value)}
                required
                maxLength={30}
                autoComplete="off"
              />
            </label>
            <label>
              이름
              <input
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                required
                maxLength={50}
                autoComplete="off"
              />
            </label>
          </div>
          <label>
            체온 (°C)
            <input
              type="number"
              step="0.1"
              min="34"
              max="42"
              value={form.temperature}
              onChange={(e) => set('temperature', e.target.value)}
              required={record.temperature !== null}
              placeholder="기존 기록에 체온이 없으면 비워 둘 수 있습니다"
            />
          </label>
          <label>
            방문 목적
            <input
              value={form.symptom}
              onChange={(e) => set('symptom', e.target.value)}
              required
              maxLength={300}
            />
          </label>
          <label>
            투약 약품
            <input
              value={form.medication}
              onChange={(e) => set('medication', e.target.value)}
              maxLength={300}
              placeholder="담당자가 실제 제공한 약품을 입력해 주세요"
            />
          </label>
          <label>
            처치 / 진료 내용
            <textarea
              value={form.treatment}
              onChange={(e) => set('treatment', e.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="담당자가 확인한 내용을 입력해 주세요"
            />
          </label>
        </fieldset>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        {record.status !== 'cancelled' && (
          <button className="button primary" disabled={busy}>
            {busy ? '저장 중…' : '변경 내용 저장'}
          </button>
        )}
      </form>
      <details className="history">
        <summary>변경 이력 {record.history.length}건</summary>
        <ol>
          {[...record.history].reverse().map((entry, index) => (
            <li key={`${entry.at}-${index}`}>
              <time>
                {dateKey(new Date(entry.at))} {timeLabel(entry.at)}
              </time>
              <span>
                {entry.action}
                {entry.note ? ` · ${entry.note}` : ''}
              </span>
            </li>
          ))}
        </ol>
        <p className="privacy-note">기기 내 참고 이력이며 위변조 방지 감사 로그는 아닙니다.</p>
      </details>
    </Dialog>
  )
}
