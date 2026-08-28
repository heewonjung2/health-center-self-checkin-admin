import { describe, it, expect } from 'vitest'
import {
  createRegistration,
  changeRegistration,
  composeSymptom,
  dateKey,
  decodeStore,
  validDate,
  queueLabel,
  ordered,
  validateFields,
} from '../src/domain/records'
import { mergeBackup } from '../src/domain/backup'
const now = new Date('2026-08-28T01:00:00Z')
const fields = {
  name: '테스트학생',
  studentId: 'c000001',
  temperature: '36.5',
  symptom: '감기 - 목감기',
}
const create = (id = 'one', input = fields) => createRegistration([], input, now, id)
const encode = (records) => JSON.stringify({ schemaVersion: 2, revision: 0, records })
describe('validation and dates', () => {
  it('normalizes IDs and numeric temperature', () => {
    expect(validateFields(fields)).toMatchObject({ studentId: 'C000001', temperature: 36.5 })
  })
  it.each(['', ' ', 'invalid', '33.9', '42.1', '36.55', Infinity, null, undefined])(
    'rejects invalid temperature %s',
    (temperature) => {
      expect(() => create('one', { ...fields, temperature })).toThrow()
    },
  )
  it.each(['34.0', '42.0'])('accepts boundary %s', (temperature) => {
    expect(create('one', { ...fields, temperature }).temperature).toBe(Number(temperature))
  })
  it('requires name, ID and purpose', () => {
    for (const key of ['name', 'studentId', 'symptom'])
      expect(() => create('one', { ...fields, [key]: ' ' })).toThrow()
  })
  it('limits free input lengths', () =>
    expect(() => create('one', { ...fields, name: '가'.repeat(51) })).toThrow())
  it('uses Korean dates across UTC midnight', () =>
    expect(dateKey(new Date('2026-08-27T15:01:00Z'))).toBe('2026-08-28'))
  it('rejects impossible dates', () => {
    expect(validDate('2026-02-30')).toBe(false)
    expect(validDate('2024-02-29')).toBe(true)
  })
  it('requires valid sub-symptoms and direct text', () => {
    expect(composeSymptom('감기', '목감기', '')).toBe('감기 - 목감기')
    expect(composeSymptom('기타', '', '휴식')).toBe('기타 - 휴식')
    expect(() => composeSymptom('감기', '', '')).toThrow()
    expect(() => composeSymptom('감기', '직접입력', '')).toThrow()
  })
})
describe('state transitions and queue', () => {
  it('assigns queue IDs, blocks duplicate active check-in', () => {
    const first = create()
    expect(queueLabel(first)).toBe('001')
    expect(() => createRegistration([first], fields, now, 'two')).toThrow('진행 중')
    expect(
      createRegistration([first], { ...fields, studentId: 'C000002' }, now, 'two').queueNumber,
    ).toBe(2)
  })
  it('runs waiting → in progress → completed → waiting → cancelled → waiting with history', () => {
    let records = [create()]
    for (const [action, status] of [
      ['start', 'in_progress'],
      ['complete', 'completed'],
      ['restore', 'waiting'],
      ['cancel', 'cancelled'],
      ['restore', 'waiting'],
    ]) {
      records = changeRegistration(
        records,
        'one',
        records[0].version,
        action,
        { reason: '테스트 취소' },
        now,
      )
      expect(records[0].status).toBe(status)
    }
    expect(records[0].history).toHaveLength(6)
    expect(records[0].version).toBe(6)
  })
  it('rejects stale edits, illegal transitions and empty cancel reason', () => {
    const records = [create()]
    expect(() => changeRegistration(records, 'one', 0, 'edit', fields, now)).toThrow('다른 화면')
    expect(() => changeRegistration(records, 'one', 1, 'restore', {}, now)).toThrow()
    expect(() => changeRegistration(records, 'one', 1, 'cancel', {}, now)).toThrow('취소 사유')
  })
  it('edits completed records but not cancelled records', () => {
    const done = changeRegistration([create()], 'one', 1, 'complete', {}, now)
    expect(
      changeRegistration(done, 'one', 2, 'edit', { ...fields, treatment: '테스트 기록' }, now)[0]
        .treatment,
    ).toBe('테스트 기록')
    const cancelled = changeRegistration([create()], 'one', 1, 'cancel', { reason: '테스트' }, now)
    expect(() => changeRegistration(cancelled, 'one', 2, 'edit', fields, now)).toThrow()
  })
  it('does not restore past records or create duplicate active IDs', () => {
    const done = changeRegistration([create()], 'one', 1, 'complete', {}, now)
    expect(() =>
      changeRegistration(done, 'one', 2, 'restore', {}, new Date('2026-08-29T01:00:00Z')),
    ).toThrow('당일')
    const second = createRegistration(done, fields, now, 'two')
    expect(() => changeRegistration([...done, second], 'one', 2, 'restore', {}, now)).toThrow(
      '진행 중',
    )
  })
  it('sorts same-time check-ins by assigned queue number', () => {
    const a = create()
    const b = { ...a, id: 'two', queueNumber: 2 }
    expect(ordered([b, a]).map((r) => r.id)).toEqual(['one', 'two'])
  })
})
describe('migration, retention and backup', () => {
  it('migrates existing arrays without temperature, retaining old IDs', () => {
    const old = [
      {
        id: 'old',
        date: '2026-08-28',
        time: '08. 28. 10:00',
        studentId: 'C123456',
        name: '테스트',
        symptom: '두통',
        status: '대기중',
        medication: '',
        treatment: '',
      },
    ]
    expect(decodeStore(JSON.stringify(old), now)).toMatchObject({
      migrated: true,
      records: [
        { id: 'old', temperature: null, status: 'waiting', createdAt: '2026-08-28T01:00:00.000Z' },
      ],
    })
  })
  it('preserves original inclusive 30-day cutoff', () => {
    const current = create()
    const cutoff = { ...current, id: 'cutoff', date: '2026-07-29' }
    const expired = { ...current, id: 'expired', date: '2026-07-28' }
    const result = decodeStore(encode([current, cutoff, expired]), now)
    expect(result.records).toHaveLength(2)
    expect(result.expired).toBe(1)
  })
  it.each(['{broken', '{}', '{"schemaVersion":999,"records":[]}', 'null'])(
    'rejects malformed store %s',
    (raw) => expect(() => decodeStore(raw, now)).toThrow(),
  )
  it('rejects malformed records, duplicate IDs and queue numbers, and future data', () => {
    const r = create()
    expect(() => decodeStore(encode([{ ...r, history: null }]), now)).toThrow()
    expect(() => decodeStore(encode([r, r]), now)).toThrow()
    expect(() => decodeStore(encode([r, { ...r, id: 'two' }]), now)).toThrow('접수번호')
    expect(() => decodeStore(encode([{ ...r, date: '2026-08-29' }]), now)).toThrow('미래 날짜')
  })
  it('merges new backup records and preserves existing data', () => {
    const r = create()
    const other = { ...create('two', { ...fields, studentId: 'C000002' }), status: 'completed' }
    const merged = mergeBackup([r], [r, other])
    expect(merged).toHaveLength(2)
    expect(merged[0]).toEqual(r)
    expect(merged[1].queueNumber).toBe(2)
    expect(mergeBackup(merged, [r, other])).toEqual(merged)
  })
  it('rejects backup conflicts and duplicate active records', () => {
    const r = create()
    expect(() => mergeBackup([r], [{ ...r, name: '다른이름' }])).toThrow('동일 ID')
    expect(() => mergeBackup([r], [{ ...r, id: 'two' }])).toThrow('중복')
  })
})
