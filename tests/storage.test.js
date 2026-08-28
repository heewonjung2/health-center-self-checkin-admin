import { it, expect } from 'vitest'
import { readStore, LEGACY_KEY, STORAGE_KEY, transact, maintainStore } from '../src/lib/storage'
import { createRegistration, changeRegistration } from '../src/domain/records'
const fields = {
  name: '테스트',
  studentId: 'C000001',
  temperature: '36.5',
  symptom: '두통 - 편두통',
}
it('persists before reporting success', async () => {
  const result = await transact((records) => [...records, createRegistration(records, fields)])
  expect(readStore().records).toHaveLength(1)
  expect(result.revision).toBe(1)
})
it('does not overwrite corrupted storage', async () => {
  localStorage.setItem(STORAGE_KEY, '{broken')
  await expect(transact((records) => records)).rejects.toThrow()
  expect(localStorage.getItem(STORAGE_KEY)).toBe('{broken')
})
it('reports quota failure without successful mutation', async () => {
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError')
    },
  }
  await expect(
    transact((records) => [...records, createRegistration(records, fields)], { storage }),
  ).rejects.toThrow('저장하지 못했습니다')
})
it('serializes concurrent creates without losing either record', async () => {
  await Promise.all([
    transact((records) => [...records, createRegistration(records, fields)]),
    transact((records) => [
      ...records,
      createRegistration(records, { ...fields, studentId: 'C000002' }),
    ]),
  ])
  const state = readStore()
  expect(state.records).toHaveLength(2)
  expect(state.records.map((r) => r.queueNumber)).toEqual([1, 2])
})
it('blocks duplicate double submits under the lock', async () => {
  const results = await Promise.allSettled([
    transact((r) => [...r, createRegistration(r, fields)]),
    transact((r) => [...r, createRegistration(r, fields)]),
  ])
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  expect(readStore().records).toHaveLength(1)
})
it('rejects stale concurrent edits', async () => {
  await transact((r) => [...r, createRegistration(r, fields)])
  const r = readStore().records[0]
  await transact((records) => changeRegistration(records, r.id, r.version, 'start'))
  await expect(
    transact((records) => changeRegistration(records, r.id, r.version, 'complete')),
  ).rejects.toThrow('다른 화면')
})
it('does not write without Web Locks', async () => {
  await expect(transact((records) => records, { locks: null })).rejects.toThrow('HTTPS')
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
})
it('does not write on every idle maintenance pass', async () => {
  expect((await maintainStore()).revision).toBe(0)
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
})
it('migrates legacy key only after successful v2 write', async () => {
  const old = [
    {
      ...fields,
      id: 'legacy',
      date: '2026-08-28',
      time: '08. 28. 10:00',
      status: '대기중',
      medication: '',
      treatment: '',
    },
  ]
  localStorage.setItem(LEGACY_KEY, JSON.stringify(old))
  await maintainStore({ now: new Date('2026-08-28T01:00:00Z') })
  expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).records[0].id).toBe('legacy')
})
it('blocks writes if an old app recreates legacy data', async () => {
  await transact((records) => records)
  localStorage.setItem(LEGACY_KEY, '[]')
  await expect(transact((records) => records)).rejects.toThrow('이전 버전')
  expect(localStorage.getItem(LEGACY_KEY)).toBe('[]')
})
