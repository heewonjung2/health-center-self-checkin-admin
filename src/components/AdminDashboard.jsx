import { useMemo, useState } from 'react'
import {
  STATUS,
  dateKey,
  daySummary,
  ordered,
  queueLabel,
  retentionCutoff,
  timeLabel,
} from '../domain/records'
import { buildCSV, copyText, downloadFile } from '../lib/export'
import Dialog from './Dialog'
import RecordEditor from './RecordEditor'
export default function AdminDashboard({ records, act, notify, disabled, onSettings }) {
  const [date, setDate] = useState(dateKey())
  const [status, setStatus] = useState('all')
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const dayRecords = useMemo(() => ordered(records.filter((r) => r.date === date)), [records, date])
  const summary = useMemo(() => daySummary(dayRecords), [dayRecords])
  const shown = dayRecords.filter(
    (r) =>
      (status === 'all' || r.status === status) &&
      `${r.name} ${r.studentId} ${queueLabel(r)}`
        .toLowerCase()
        .includes(query.toLowerCase().trim()),
  )
  const open = (value) => {
    setError('')
    setReason('')
    setDialog(value)
  }
  // 상태 전환과 버전 충돌 검사는 서버가 한다. 화면은 결과만 받는다.
  const change = (record, action, fields) => act(record, action, fields)
  const copy = async (value) => {
    try {
      await copyText(value)
      notify('복사했습니다. 공용 기기에서는 사용 후 클립보드도 확인해 주세요.')
    } catch {
      notify('복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요.')
    }
  }
  const confirm = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (dialog.action === 'export')
        downloadFile(
          buildCSV(shown),
          `건강진료센터_${date}_${status}.csv`,
          'text/csv;charset=utf-8',
        )
      else await change(dialog.record, dialog.action, { reason })
      notify(
        dialog.action === 'export'
          ? '현재 필터의 기록을 CSV로 내려받았습니다.'
          : '변경 내용을 저장했습니다.',
      )
      setDialog(null)
    } catch (error) {
      setError(error.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <main id="main" className="admin-layout">
      <div className="page-heading">
        <div>
          <div className="eyebrow">CARE DESK</div>
          <h1>접수 현황</h1>
          <p className="lead">접수부터 기록까지, 한눈에 확인하세요.</p>
        </div>
        <button className="button secondary" onClick={onSettings}>
          기기 설정 · 백업
        </button>
      </div>
      <div className="stats-grid">
        {Object.entries(STATUS).map(([key, label]) => (
          <button
            key={key}
            className={`stat-card ${status === key ? 'active' : ''}`}
            onClick={() => setStatus(status === key ? 'all' : key)}
            aria-pressed={status === key}
          >
            <span>
              <i className={`status-dot ${key}`} />
              {label}
            </span>
            <strong>
              {dayRecords.filter((r) => r.status === key).length}
              <small>명</small>
            </strong>
          </button>
        ))}
      </div>
      <section className="day-summary" aria-label={`${date} 일별 요약`}>
        <div className="summary-head">
          <strong>{date} 요약</strong>
          <span className="muted">
            총 {summary.total}건
            {summary.avgTemperature !== null &&
              ` · 평균 체온 ${summary.avgTemperature.toFixed(1)}℃`}
            {summary.fever > 0 && ` · 발열(37.5℃ 이상) ${summary.fever}명`}
          </span>
        </div>
        {summary.purposes.length > 0 ? (
          <ul className="purpose-bars">
            {summary.purposes.map(([name, count]) => (
              <li key={name}>
                <span className="purpose-name">{name}</span>
                <progress value={count} max={summary.total} />
                <span className="purpose-count">{count}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">이 날짜에는 접수 기록이 없습니다.</p>
        )}
      </section>
      <section className="records-panel" aria-label="접수 기록 목록">
        <div className="records-toolbar">
          <div className="filter-row">
            <label className="date-label">
              접수 일자
              <input
                type="date"
                min={retentionCutoff()}
                max={dateKey()}
                value={date}
                onChange={(e) => {
                  if (
                    e.target.value &&
                    e.target.value <= dateKey() &&
                    e.target.value >= retentionCutoff()
                  )
                    setDate(e.target.value)
                }}
              />
            </label>
            <button className="text-button" onClick={() => setDate(dateKey())}>
              오늘
            </button>
            <label className="search-label">
              <span className="sr-only">이름, 학번, 접수번호 검색</span>
              <input
                type="search"
                value={query}
                maxLength={80}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="이름 · 학번 · 접수번호 검색"
                autoComplete="off"
              />
            </label>
          </div>
          <button
            className="button secondary"
            disabled={disabled || shown.length === 0}
            onClick={() => open({ action: 'export' })}
          >
            CSV 내보내기
          </button>
        </div>
        <div className="list-heading">
          <div className="chip-row">
            <button
              className={`chip ${status === 'all' ? 'selected' : ''}`}
              aria-pressed={status === 'all'}
              onClick={() => setStatus('all')}
            >
              전체
            </button>
            {Object.entries(STATUS).map(([key, label]) => (
              <button
                className={`chip ${status === key ? 'selected' : ''}`}
                key={key}
                aria-pressed={status === key}
                onClick={() => setStatus(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="muted">{shown.length}건 · 접수순</span>
        </div>
        {shown.length ? (
          <div className="record-list">
            {shown.map((record) => (
              <article key={record.id} className={`record-card ${record.status}`}>
                <div className="record-primary">
                  <span className="queue-number">{queueLabel(record)}</span>
                  <span className={`status ${record.status}`}>{STATUS[record.status]}</span>
                  <span className="muted record-time">{timeLabel(record.createdAt)}</span>
                </div>
                <div className="record-body">
                  <div className="record-person">
                    <h2>{record.name}</h2>
                    <button
                      className="text-button copy-id"
                      aria-label={`${record.name} 학번·직원번호 복사`}
                      onClick={() => copy(record.studentId)}
                    >
                      {record.studentId} <span aria-hidden="true">⧉</span>
                    </button>
                  </div>
                  <div className="record-purpose">
                    <p>{record.symptom}</p>
                    <span className="muted">
                      체온{' '}
                      {record.temperature === null
                        ? '미기록'
                        : `${record.temperature.toFixed(1)} °C`}
                    </span>
                  </div>
                  <div className="record-treatment">
                    <span className="muted">투약 / 처치</span>
                    <p>
                      {[record.medication, record.treatment].filter(Boolean).join(' · ') ||
                        '아직 기록되지 않았습니다'}
                    </p>
                  </div>
                </div>
                <div className="record-actions">
                  <button
                    className="button small secondary"
                    disabled={disabled}
                    onClick={() => open({ action: 'edit', record })}
                  >
                    기록 {record.status === 'cancelled' ? '보기' : '수정'}
                  </button>
                  <button
                    className="text-button"
                    onClick={() =>
                      copy(
                        `${record.studentId}\t${record.name}\t${record.temperature ?? ''}\t${record.symptom}\t${record.medication}\t${record.treatment}`,
                      )
                    }
                  >
                    전체 복사
                  </button>
                  <span className="spacer" />
                  {record.status === 'waiting' && (
                    <button
                      className="button small secondary"
                      disabled={disabled}
                      onClick={() => open({ action: 'start', record })}
                    >
                      진료 시작
                    </button>
                  )}
                  {['waiting', 'in_progress'].includes(record.status) && (
                    <>
                      <button
                        className="button small danger-ghost"
                        disabled={disabled}
                        onClick={() => open({ action: 'cancel', record })}
                      >
                        접수 취소
                      </button>
                      <button
                        className="button small primary"
                        disabled={disabled}
                        onClick={() => open({ action: 'complete', record })}
                      >
                        진료 완료
                      </button>
                    </>
                  )}
                  {['cancelled', 'completed'].includes(record.status) &&
                    record.date === dateKey() && (
                      <button
                        className="button small secondary"
                        disabled={disabled}
                        onClick={() => open({ action: 'restore', record })}
                      >
                        대기로 복구
                      </button>
                    )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <span aria-hidden="true">▤</span>
            <h2>표시할 접수 내역이 없습니다</h2>
            <p>다른 날짜를 선택하거나 검색 조건을 바꿔 보세요.</p>
            <button
              className="text-button"
              onClick={() => {
                setQuery('')
                setStatus('all')
              }}
            >
              필터 초기화
            </button>
          </div>
        )}
      </section>
      {dialog?.action === 'edit' && (
        <RecordEditor
          record={dialog.record}
          onClose={() => setDialog(null)}
          onSave={async (fields) => {
            await change(dialog.record, 'edit', fields)
            notify('기록을 수정했습니다.')
          }}
        />
      )}
      {dialog && dialog.action !== 'edit' && (
        <Dialog
          title={
            dialog.action === 'export'
              ? 'CSV 내보내기 확인'
              : `${queueLabel(dialog.record)} · ${{ start: '진료 시작', complete: '진료 완료', cancel: '접수 취소', restore: '대기로 복구' }[dialog.action]}`
          }
          onClose={() => setDialog(null)}
          busy={busy}
        >
          <form onSubmit={confirm} className="stack">
            {dialog.action === 'export' ? (
              <>
                <p>
                  {date} · {status === 'all' ? '전체 상태' : STATUS[status]} · 현재 검색 결과{' '}
                  {shown.length}건을 내보냅니다.
                </p>
                <p className="warning-note">
                  이 파일에는 개인정보와 진료 내용이 암호화 없이 포함됩니다. 승인된 위치에만
                  보관하고 불필요한 사본은 삭제하세요. CSV를 다시 저장한 뒤 열 때에는 수식 보호가
                  유지되지 않을 수 있습니다.
                </p>
                <label className="checkbox-label">
                  <input type="checkbox" required />
                  개인정보가 포함된 파일임을 확인했습니다.
                </label>
              </>
            ) : (
              <>
                <p>{dialog.record.name}님의 접수 상태를 변경합니다. 변경 이력이 남습니다.</p>
                {dialog.action === 'cancel' && (
                  <label>
                    취소 사유
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      required
                      maxLength={160}
                      placeholder="예: 중복 접수, 방문 취소"
                    />
                  </label>
                )}
                {dialog.action === 'complete' &&
                  !dialog.record.treatment &&
                  !dialog.record.medication && (
                    <p className="warning-note">
                      투약·처치 내용이 비어 있습니다. 기록이 필요하면 먼저 ‘기록 수정’에서 입력해
                      주세요.
                    </p>
                  )}
              </>
            )}
            {error && (
              <p role="alert" className="error-message">
                {error}
              </p>
            )}
            <button className="button primary" disabled={busy || disabled}>
              {busy ? '처리 중…' : '확인'}
            </button>
          </form>
        </Dialog>
      )}
    </main>
  )
}
