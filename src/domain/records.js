export const SCHEMA_VERSION = 2
export const RETENTION_DAYS = 30
export const SYMPTOMS = {
  두통: ['편두통', '긴장성 두통', '어지럼증', '직접입력'],
  소화불량: ['체함', '복통', '메스꺼움/구토', '직접입력'],
  감기: ['목감기', '코감기', '몸살/발열', '직접입력'],
  '외상/상처': ['찰과상(까짐)', '타박상(멍)', '화상', '직접입력'],
  생리통: ['복통', '요통', '직접입력'],
  기타: ['직접입력'],
}
export const STATUS = {
  waiting: '대기 중',
  in_progress: '진료 중',
  completed: '완료',
  cancelled: '취소',
}
export const ACTIVE = ['waiting', 'in_progress']
const LEGACY_STATUS = { 대기중: 'waiting', 진료완료: 'completed' }
const ACTIONS = [
  '접수',
  '기존 기록 이관',
  '수정',
  '진료 시작',
  '진료 완료',
  '접수 취소',
  '대기로 복구',
]

export function dateKey(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(now)
}
export function validDate(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  )
}
export function retentionCutoff(now = new Date()) {
  const date = new Date(`${dateKey(now)}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - RETENTION_DAYS)
  return date.toISOString().slice(0, 10)
}
export function withinRetention(record, now = new Date()) {
  // Preserve the original inclusive date-based boundary during migration.
  return record.date >= retentionCutoff(now) && record.date <= dateKey(now)
}
export function timeLabel(value) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value))
}
export function queueLabel(record) {
  return String(record.queueNumber).padStart(3, '0')
}
export const FEVER_THRESHOLD = 37.5
export function daySummary(records) {
  const byStatus = { waiting: 0, in_progress: 0, completed: 0, cancelled: 0 }
  const byPurpose = {}
  const temps = []
  let fever = 0
  for (const r of records) {
    byStatus[r.status] += 1
    const main = r.symptom.split(' - ')[0] || '기타'
    byPurpose[main] = (byPurpose[main] ?? 0) + 1
    if (typeof r.temperature === 'number') {
      temps.push(r.temperature)
      if (r.temperature >= FEVER_THRESHOLD) fever += 1
    }
  }
  return {
    total: records.length,
    byStatus,
    purposes: Object.entries(byPurpose).sort((a, b) => b[1] - a[1]),
    fever,
    avgTemperature: temps.length
      ? Math.round((temps.reduce((sum, t) => sum + t, 0) / temps.length) * 10) / 10
      : null,
  }
}
export function ordered(records) {
  return [...records].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.queueNumber - b.queueNumber,
  )
}
function text(value, label, max, required = false) {
  if (typeof value !== 'string') throw new Error(`${label} 형식이 올바르지 않습니다.`)
  const result = value.trim()
  if ((required && !result) || result.length > max)
    throw new Error(`${label}: ${required ? '1' : '0'}~${max}자로 입력해 주세요.`)
  return result
}
export function validateFields(input, { legacy = false } = {}) {
  const studentId = text(input.studentId, '학번/직원번호', 30, true).toUpperCase()
  const name = text(input.name, '이름', 50, true)
  const symptom = text(input.symptom, '방문 목적', 300, true)
  let temperature = input.temperature
  if (legacy && (temperature === undefined || temperature === '' || temperature === null))
    temperature = null
  else {
    if (temperature === '' || temperature === null || temperature === undefined)
      throw new Error('체온을 입력해 주세요.')
    temperature = Number(temperature)
    if (
      !Number.isFinite(temperature) ||
      temperature < 34 ||
      temperature > 42 ||
      Math.abs(temperature * 10 - Math.round(temperature * 10)) > 0.00001
    ) {
      throw new Error('체온은 34.0~42.0도, 소수 첫째 자리까지 입력해 주세요.')
    }
  }
  return {
    studentId,
    name,
    symptom,
    temperature,
    medication: text(input.medication ?? '', '투약 약품', 300),
    treatment: text(input.treatment ?? '', '처치/진료 내용', 2000),
  }
}
export function composeSymptom(main, sub, detail) {
  if (!Object.hasOwn(SYMPTOMS, main)) throw new Error('방문 목적을 선택해 주세요.')
  const subs = (Array.isArray(sub) ? sub : [sub]).filter(Boolean)
  if (main !== '기타' && (!subs.length || subs.some((item) => !SYMPTOMS[main].includes(item))))
    throw new Error('세부 증상을 선택해 주세요.')
  const parts =
    main === '기타'
      ? [text(detail, '세부 증상', 200, true)]
      : subs.map((item) => (item === '직접입력' ? text(detail, '세부 증상', 200, true) : item))
  return `${main} - ${parts.join(', ')}`
}
function assertNoDuplicate(records, input, exceptId, date) {
  if (
    records.some(
      (r) =>
        r.id !== exceptId &&
        r.date === date &&
        r.studentId.toUpperCase() === input.studentId.toUpperCase() &&
        ACTIVE.includes(r.status),
    )
  ) {
    throw new Error('같은 학번/직원번호로 진행 중인 접수가 있습니다. 담당자에게 확인해 주세요.')
  }
}
export function createRegistration(records, input, now = new Date(), id = crypto.randomUUID()) {
  const fields = validateFields(input)
  const date = dateKey(now)
  assertNoDuplicate(records, fields, null, date)
  const at = now.toISOString()
  const queueNumber =
    records.reduce((max, r) => (r.date === date ? Math.max(max, r.queueNumber) : max), 0) + 1
  return {
    ...fields,
    id,
    date,
    queueNumber,
    createdAt: at,
    updatedAt: at,
    version: 1,
    status: 'waiting',
    history: [{ at, action: '접수' }],
  }
}
export function changeRegistration(
  records,
  id,
  expectedVersion,
  action,
  fields = {},
  now = new Date(),
) {
  const record = records.find((r) => r.id === id)
  if (!record) throw new Error('기록을 찾을 수 없습니다. 목록을 새로 확인해 주세요.')
  if (record.version !== expectedVersion)
    throw new Error(
      '다른 화면에서 변경된 기록입니다. 새로 열린 기록을 확인하고 다시 저장해 주세요.',
    )
  const at = now.toISOString()
  const next = { ...record, updatedAt: at, version: record.version + 1 }
  let label
  let note = ''
  if (action === 'edit') {
    if (record.status === 'cancelled') throw new Error('취소 기록은 복구 후 수정할 수 있습니다.')
    Object.assign(next, validateFields(fields, { legacy: record.temperature === null }))
    if (ACTIVE.includes(record.status)) assertNoDuplicate(records, next, id, record.date)
    label = '수정'
  } else if (action === 'start' && record.status === 'waiting') {
    next.status = 'in_progress'
    label = '진료 시작'
  } else if (action === 'complete' && ACTIVE.includes(record.status)) {
    next.status = 'completed'
    label = '진료 완료'
  } else if (action === 'cancel' && ACTIVE.includes(record.status)) {
    note = text(fields.reason ?? '', '취소 사유', 160, true)
    next.status = 'cancelled'
    label = '접수 취소'
  } else if (action === 'restore' && ['cancelled', 'completed'].includes(record.status)) {
    if (record.date !== dateKey(now)) throw new Error('당일 기록만 대기 상태로 복구할 수 있습니다.')
    assertNoDuplicate(records, record, id, record.date)
    next.status = 'waiting'
    label = '대기로 복구'
  } else throw new Error('현재 상태에서는 실행할 수 없는 작업입니다.')
  next.history = [...record.history, { at, action: label, ...(note ? { note } : {}) }]
  return records.map((r) => (r.id === id ? next : r))
}
function iso(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}
export function validateRecord(r) {
  if (
    !r ||
    typeof r !== 'object' ||
    typeof r.id !== 'string' ||
    !r.id ||
    r.id.length > 100 ||
    !validDate(r.date) ||
    !Object.hasOwn(STATUS, r.status) ||
    !Number.isSafeInteger(r.queueNumber) ||
    r.queueNumber < 1 ||
    !Number.isSafeInteger(r.version) ||
    r.version < 1 ||
    !iso(r.createdAt) ||
    !iso(r.updatedAt) ||
    !Array.isArray(r.history) ||
    r.history.length < 1 ||
    r.history.some(
      (h) =>
        !h ||
        !iso(h.at) ||
        !ACTIONS.includes(h.action) ||
        (h.note !== undefined && (typeof h.note !== 'string' || h.note.length > 160)),
    )
  ) {
    throw new Error('저장 기록의 형식이 올바르지 않습니다. 원본을 덮어쓰지 않았습니다.')
  }
  return {
    id: r.id,
    date: r.date,
    queueNumber: r.queueNumber,
    version: r.version,
    status: r.status,
    createdAt: new Date(r.createdAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString(),
    ...validateFields(r, { legacy: true }),
    history: r.history.map((h) => ({
      at: h.at,
      action: h.action,
      ...(h.note ? { note: h.note } : {}),
    })),
  }
}
function migrateLegacy(records) {
  const counts = {}
  return [...records].reverse().map((r, index) => {
    if (!r || !validDate(r.date) || !LEGACY_STATUS[r.status])
      throw new Error('기존 기록을 변환할 수 없습니다. 원본을 보존했습니다.')
    const match = String(r.time ?? '').match(/(\d{1,2}):(\d{2})(?!.*\d+:\d+)/)
    const hour = match ? Number(match[1]) : 0
    const minute = match ? Number(match[2]) : 0
    if (hour > 24 || minute > 59) throw new Error('기존 기록의 접수 시간을 확인해 주세요.')
    const at = new Date(
      `${r.date}T${String(hour % 24).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+09:00`,
    ).toISOString()
    counts[r.date] = (counts[r.date] ?? 0) + 1
    return validateRecord({
      ...r,
      id: r.id || `legacy-${r.date}-${index}`,
      status: LEGACY_STATUS[r.status],
      queueNumber: counts[r.date],
      version: 1,
      createdAt: at,
      updatedAt: at,
      history: [{ at, action: '기존 기록 이관' }],
    })
  })
}
export function decodeStore(raw, now = new Date()) {
  if (raw === null)
    return { schemaVersion: SCHEMA_VERSION, revision: 0, records: [], migrated: false, expired: 0 }
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error(
      '저장 데이터가 손상되었습니다. 원본은 그대로 보존됩니다. 관리자에게 문의해 주세요.',
    )
  }
  const migrated = Array.isArray(data)
  if (
    !migrated &&
    (!data ||
      data.schemaVersion !== SCHEMA_VERSION ||
      !Array.isArray(data.records) ||
      !Number.isSafeInteger(data.revision) ||
      data.revision < 0)
  ) {
    throw new Error('지원하지 않는 저장 형식입니다. 다른 버전의 앱이 열려 있는지 확인해 주세요.')
  }
  const records = migrated ? migrateLegacy(data) : data.records.map(validateRecord)
  if (new Set(records.map((r) => r.id)).size !== records.length)
    throw new Error('중복된 기록 ID가 있습니다. 원본을 보존했습니다.')
  if (records.some((r) => r.date > dateKey(now)))
    throw new Error('미래 날짜의 기록이 있습니다. 기기 날짜를 확인해 주세요. 원본을 보존했습니다.')
  if (new Set(records.map((r) => `${r.date}/${r.queueNumber}`)).size !== records.length)
    throw new Error('중복된 접수번호가 있습니다. 원본을 보존했습니다.')
  const retained = records.filter((r) => withinRetention(r, now))
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: migrated ? 0 : data.revision,
    records: retained,
    migrated,
    expired: records.length - retained.length,
  }
}
