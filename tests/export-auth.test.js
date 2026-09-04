import { it, expect } from 'vitest'
import { csvCell, buildCSV } from '../src/lib/export'
import { encryptBackup, decryptBackup } from '../src/lib/crypto'
import { createRegistration } from '../src/domain/records'
it.each([
  '=1+1',
  '+1',
  '-1',
  '@SUM(A1)',
  '  =1',
  '\t=1',
  '\rtext',
  '\ntext',
  '＝1',
  '＋1',
  '－1',
  '＠SUM(A1)',
])('neutralizes risky CSV prefix %s', (value) => expect(csvCell(value)).toMatch(/^"'/))
it('escapes CSV quotes, commas, and newlines', () =>
  expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"'))
it('exports BOM, full local date, status and correct temperature', () => {
  const r = createRegistration(
    [],
    { studentId: 'C001', name: '테스트', temperature: '36.5', symptom: '두통' },
    new Date('2026-08-27T15:30:00Z'),
  )
  const csv = buildCSV([r])
  expect(csv.startsWith('\uFEFF')).toBe(true)
  expect(csv).toContain('"2026-08-28"')
  expect(csv).toContain('"00:30"')
  expect(csv).toContain('"대기 중"')
})
it('encrypts and restores backup, rejecting wrong passwords and tampering', async () => {
  const payload = '{"test":"민감정보 대신 테스트 값"}'
  const encrypted = await encryptBackup(payload, 'test-backup-password')
  expect(encrypted).not.toContain('테스트 값')
  expect(await decryptBackup(encrypted, 'test-backup-password')).toBe(payload)
  await expect(decryptBackup(encrypted, 'wrong-password')).rejects.toThrow()
  const parsed = JSON.parse(encrypted)
  parsed.data = parsed.data.slice(0, -10) + 'AAAAAAAAAA'
  await expect(decryptBackup(JSON.stringify(parsed), 'test-backup-password')).rejects.toThrow()
})
it('refuses short backup passwords', async () =>
  await expect(encryptBackup('{}', 'short')).rejects.toThrow('12'))
