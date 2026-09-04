import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'

const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const RECOVERY_LENGTH = 20
const MAX_FAILURES = 5
const LOCK_MS = 60 * 1000
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

export function generateRecoveryCode() {
  const chars = Array.from(randomBytes(RECOVERY_LENGTH), (b) => RECOVERY_ALPHABET[b & 31])
  return [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join('')).join('-')
}
export function normalizeRecoveryCode(code) {
  return String(code ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
}
function hash(secret, salt = randomBytes(16)) {
  return `${salt.toString('base64')}:${scryptSync(secret, salt, 64, SCRYPT).toString('base64')}`
}
function verify(secret, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false
  const [salt, expected] = stored.split(':')
  const actual = scryptSync(secret, Buffer.from(salt, 'base64'), 64, SCRYPT)
  const target = Buffer.from(expected, 'base64')
  return actual.length === target.length && timingSafeEqual(actual, target)
}
export function assertPinFormat(pin) {
  if (typeof pin !== 'string' || !/^\d{6,12}$/.test(pin))
    throw Object.assign(new Error('PIN은 숫자 6~12자리로 설정해 주세요.'), { status: 400 })
}
const fail = (message, status = 400) => Object.assign(new Error(message), { status })

// 담당자 인증은 서버에만 있다. 같은 학교 네트워크에 있는 누구든 API를 직접 부를 수 있으므로,
// 기기(브라우저) 쪽 PIN 확인만으로는 개인정보를 지킬 수 없다.
export function createAuth(store, { idleMs = 5 * 60 * 1000, now = () => Date.now() } = {}) {
  const sessions = new Map()
  const state = () => JSON.parse(store.secret('admin') ?? 'null')
  const save = (value) => store.saveSecret('admin', JSON.stringify(value))

  function issueSession() {
    const token = `${randomUUID()}${randomBytes(24).toString('base64url')}`
    sessions.set(token, now() + idleMs)
    return token
  }
  return {
    configured: () => Boolean(state()),
    sessionCount: () => sessions.size,
    setupPin(pin) {
      if (state()) throw fail('이미 PIN이 설정되었습니다. 설정된 PIN으로 잠금을 해제해 주세요.')
      assertPinFormat(pin)
      const recoveryCode = generateRecoveryCode()
      save({
        pin: hash(pin),
        recovery: hash(normalizeRecoveryCode(recoveryCode)),
        failures: 0,
        lockUntil: 0,
      })
      return { recoveryCode, token: issueSession() }
    },
    unlock(pin) {
      const current = state()
      if (!current) throw fail('관리자가 먼저 PIN을 설정해 주세요.')
      if (current.lockUntil > now()) throw fail('5회 이상 실패하여 1분간 잠겼습니다.', 429)
      if (!verify(String(pin ?? ''), current.pin)) {
        const failures = current.failures + 1
        const locked = failures >= MAX_FAILURES
        save({
          ...current,
          failures: locked ? 0 : failures,
          lockUntil: locked ? now() + LOCK_MS : 0,
        })
        throw fail(locked ? '5회 이상 실패하여 1분간 잠겼습니다.' : 'PIN이 일치하지 않습니다.', 401)
      }
      save({ ...current, failures: 0, lockUntil: 0 })
      return issueSession()
    },
    changePin(currentPin, newPin) {
      const current = state()
      if (!current) throw fail('설정된 관리자 PIN이 없습니다. 최초 설정을 진행해 주세요.')
      if (!verify(String(currentPin ?? ''), current.pin))
        throw fail('현재 PIN이 일치하지 않습니다.', 401)
      assertPinFormat(newPin)
      save({ ...current, pin: hash(newPin), failures: 0, lockUntil: 0 })
    },
    resetWithRecovery(code, newPin) {
      const current = state()
      if (!current) throw fail('설정된 관리자 PIN이 없습니다. 최초 설정을 진행해 주세요.')
      if (!verify(normalizeRecoveryCode(code), current.recovery))
        throw fail('복구 코드가 일치하지 않습니다.', 401)
      assertPinFormat(newPin)
      const recoveryCode = generateRecoveryCode()
      save({
        pin: hash(newPin),
        recovery: hash(normalizeRecoveryCode(recoveryCode)),
        failures: 0,
        lockUntil: 0,
      })
      sessions.clear()
      return { recoveryCode, token: issueSession() }
    },
    regenerateRecoveryCode(currentPin) {
      const current = state()
      if (!current) throw fail('설정된 관리자 PIN이 없습니다.')
      if (!verify(String(currentPin ?? ''), current.pin))
        throw fail('현재 PIN이 일치하지 않습니다.', 401)
      const recoveryCode = generateRecoveryCode()
      save({ ...current, recovery: hash(normalizeRecoveryCode(recoveryCode)) })
      return recoveryCode
    },
    // 요청이 올 때마다 만료를 미룬다 — 담당자가 화면을 쓰는 동안에는 안 잠기고,
    // 5분 손을 떼면 잠기는 기존 동작과 같다.
    touch(token) {
      const expires = sessions.get(token)
      if (!expires) return false
      if (expires <= now()) {
        sessions.delete(token)
        return false
      }
      sessions.set(token, now() + idleMs)
      return true
    },
    end(token) {
      sessions.delete(token)
    },
  }
}
