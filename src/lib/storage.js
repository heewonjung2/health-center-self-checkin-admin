import { decodeStore, SCHEMA_VERSION } from '../domain/records'
export const STORAGE_KEY = 'hongik-health-registrations-v2'
export const LEGACY_KEY = 'hongik-health-registrations'
export const STORE_EVENT = 'health-records-changed'

export function readStore(storage = localStorage, now = new Date()) {
  try {
    const current = storage.getItem(STORAGE_KEY)
    const legacy = storage.getItem(LEGACY_KEY)
    if (current !== null && legacy !== null)
      throw new Error(
        '이전 버전의 기록이 함께 발견되었습니다. 모든 이전 탭을 닫고 운영 안내의 데이터 충돌 절차를 확인해 주세요. 두 원본 모두 보존했습니다.',
      )
    return decodeStore(current ?? legacy, now)
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : '저장 공간에 접근할 수 없습니다.')
  }
}
// Lock the entire read / modify / write across tabs, never a stale React snapshot.
export async function transact(
  change,
  {
    storage = localStorage,
    locks = navigator.locks,
    now = new Date(),
    notify = () => window.dispatchEvent(new Event(STORE_EVENT)),
  } = {},
) {
  if (!locks?.request)
    throw new Error('안전한 저장을 위해 HTTPS와 최신 Chrome 또는 Edge를 사용해 주세요.')
  return locks.request(STORAGE_KEY, async () => {
    const current = readStore(storage, now)
    const records = change(current.records)
    const next = { schemaVersion: SCHEMA_VERSION, revision: current.revision + 1, records }
    // Validate the complete write before replacing the original.
    next.records = decodeStore(JSON.stringify(next), now).records
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      throw new Error(
        '기기에 저장하지 못했습니다. 입력 내용은 유지됩니다. 저장 공간과 브라우저 설정을 확인해 주세요.',
      )
    }
    if (current.migrated) {
      try {
        storage.removeItem(LEGACY_KEY)
      } catch {
        throw new Error(
          '새 형식 저장은 완료되었지만 이전 저장 공간을 정리하지 못했습니다. 두 원본은 보존되어 있습니다. 관리자에게 문의해 주세요.',
        )
      }
    }
    notify()
    return next
  })
}
export async function maintainStore(options = {}) {
  const current = readStore(options.storage, options.now)
  if (current.migrated || current.expired) return transact((records) => records, options)
  return current
}
