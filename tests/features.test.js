import { describe, it, expect } from 'vitest'
import { createRegistration, daySummary } from '../src/domain/records'
import {
  DEFAULT_HOURS,
  hoursSummary,
  isOpen,
  readHours,
  validHours,
  writeHours,
} from '../src/lib/schedule'
import {
  generateRecoveryCode,
  normalizeRecoveryCode,
  readCredential,
  regenerateRecoveryCode,
  resetPinWithRecovery,
  setupPin,
  unlockPin,
} from '../src/lib/auth'
const now = new Date('2026-08-28T01:00:00Z')
const base = { name: '학생', studentId: 'c1', temperature: '36.5', symptom: '감기 - 목감기' }
const rec = (over = {}) =>
  createRegistration([], { ...base, ...over }, now, Math.random().toString(36))
describe('daily summary', () => {
  it('counts status, purposes, fever and average temperature', () => {
    const records = [
      rec({ studentId: 'a', temperature: '38.0' }),
      rec({ studentId: 'b', symptom: '두통 - 편두통', temperature: '36.4' }),
      rec({ studentId: 'c', symptom: '감기 - 코감기', temperature: '37.6' }),
    ]
    const s = daySummary(records)
    expect(s.total).toBe(3)
    expect(s.byStatus.waiting).toBe(3)
    expect(s.fever).toBe(2)
    expect(s.avgTemperature).toBe(37.3)
    expect(s.purposes[0]).toEqual(['감기', 2])
  })
  it('handles an empty day', () => {
    const s = daySummary([])
    expect(s).toMatchObject({ total: 0, fever: 0, avgTemperature: null, purposes: [] })
  })
})
describe('operating hours', () => {
  it('validates shape and ordering', () => {
    expect(validHours(DEFAULT_HOURS)).toBe(true)
    expect(validHours({ start: '18:00', end: '09:00', days: [1] })).toBe(false)
    expect(validHours({ start: '9:00', end: '17:00', days: [1] })).toBe(false)
    expect(validHours({ start: '09:00', end: '17:00', days: [7] })).toBe(false)
    expect(validHours({ start: '09:00', end: '17:00', days: [] })).toBe(false)
  })
  it('is open only inside configured days and window (Asia/Seoul)', () => {
    const hours = { start: '09:00', end: '17:30', days: [1, 2, 3, 4, 5] }
    // 2026-08-28 is a Friday. 05:00Z = 14:00 KST -> open.
    expect(isOpen(hours, new Date('2026-08-28T05:00:00Z'))).toBe(true)
    // 23:00Z Fri = 08:00 KST Sat -> closed (weekend + before start).
    expect(isOpen(hours, new Date('2026-08-28T23:00:00Z'))).toBe(false)
    // 00:00Z Fri = 09:00 KST Fri -> open at boundary.
    expect(isOpen(hours, new Date('2026-08-28T00:00:00Z'))).toBe(true)
    // 08:30Z Fri = 17:30 KST -> closed at end boundary (exclusive).
    expect(isOpen(hours, new Date('2026-08-28T08:30:00Z'))).toBe(false)
  })
  it('reads defaults, persists and reloads custom hours', () => {
    expect(readHours()).toEqual(DEFAULT_HOURS)
    writeHours({ start: '10:00', end: '16:00', days: [3, 1] })
    expect(readHours()).toEqual({ start: '10:00', end: '16:00', days: [1, 3] })
    expect(() => writeHours({ start: 'x', end: 'y', days: [1] })).toThrow()
    localStorage.setItem('hongik-health-hours-v1', '{bad')
    expect(readHours()).toEqual(DEFAULT_HOURS)
  })
  it('formats a human summary', () => {
    expect(hoursSummary({ start: '09:00', end: '17:30', days: [1, 2, 3, 4, 5] })).toBe(
      '월·화·수·목·금 09:00–17:30',
    )
  })
})
describe('admin recovery code', () => {
  it('generates a 20-char grouped code and normalizes input', () => {
    const code = generateRecoveryCode()
    expect(code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}$/)
    expect(normalizeRecoveryCode(code.toLowerCase().replace(/-/g, ' '))).toBe(
      code.replace(/-/g, ''),
    )
  })
  it('issues a recovery code on setup and stores only its hash', async () => {
    const { recoveryCode } = await setupPin('123456')
    expect(recoveryCode).toMatch(/-/)
    const stored = JSON.stringify(readCredential())
    expect(stored).not.toContain(normalizeRecoveryCode(recoveryCode))
    expect(readCredential().recoveryHash).toBeTruthy()
  })
  it('resets the PIN with a valid recovery code and rotates the code', async () => {
    const { recoveryCode } = await setupPin('123456')
    await expect(resetPinWithRecovery('WRONG-CODE-HERE-XXXX0', '654321')).rejects.toThrow()
    const { recoveryCode: next } = await resetPinWithRecovery(recoveryCode, '654321')
    expect(next).not.toBe(recoveryCode)
    expect(await unlockPin('654321')).toBe(true)
    // The old code no longer works.
    await expect(resetPinWithRecovery(recoveryCode, '111111')).rejects.toThrow()
  })
  it('reissues a recovery code only with the current PIN', async () => {
    const { recoveryCode } = await setupPin('123456')
    await expect(regenerateRecoveryCode('000000')).rejects.toThrow('현재 PIN')
    const { recoveryCode: next } = await regenerateRecoveryCode('123456')
    expect(next).not.toBe(recoveryCode)
    await expect(resetPinWithRecovery(recoveryCode, '222222')).rejects.toThrow()
    await resetPinWithRecovery(next, '222222')
    expect(await unlockPin('222222')).toBe(true)
  })
})
