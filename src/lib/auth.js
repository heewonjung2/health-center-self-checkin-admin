import { hashPin, hashSecret, verifyPin, verifySecret } from './crypto'
export const AUTH_KEY = 'hongik-health-admin-lock-v1'
export const IDLE_MS = 5 * 60 * 1000
// Crockford base32 without ambiguous letters (no I L O U).
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const RECOVERY_LENGTH = 20
export function generateRecoveryCode() {
  const random = crypto.getRandomValues(new Uint8Array(RECOVERY_LENGTH))
  const chars = Array.from(random, (b) => RECOVERY_ALPHABET[b & 31])
  return [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join('')).join('-')
}
export function normalizeRecoveryCode(code) {
  return String(code ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
}
const B64_SALT = /^[A-Za-z0-9+/]{22}==$/
const B64_HASH = /^[A-Za-z0-9+/]{43}=$/
export function readCredential(storage = localStorage) {
  const raw = storage.getItem(AUTH_KEY)
  if (raw === null) return null
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error('관리자 잠금 설정이 손상되었습니다. 운영 안내의 복구 절차를 확인해 주세요.')
  }
  if (
    !data ||
    !B64_SALT.test(data.salt) ||
    !B64_HASH.test(data.hash) ||
    data.iterations !== 600000 ||
    !Number.isSafeInteger(data.failures) ||
    data.failures < 0 ||
    !Number.isFinite(data.lockUntil) ||
    (data.recoverySalt !== undefined && !B64_SALT.test(data.recoverySalt)) ||
    (data.recoveryHash !== undefined && !B64_HASH.test(data.recoveryHash))
  )
    throw new Error('관리자 잠금 설정을 읽을 수 없습니다. 자동 초기화하지 않습니다.')
  return data
}
async function buildCredential(pin) {
  const pinHash = await hashPin(pin)
  const recoveryCode = generateRecoveryCode()
  const recovery = await hashSecret(normalizeRecoveryCode(recoveryCode))
  return {
    credential: {
      ...pinHash,
      failures: 0,
      lockUntil: 0,
      recoverySalt: recovery.salt,
      recoveryHash: recovery.hash,
    },
    recoveryCode,
  }
}
export async function setupPin(pin, storage = localStorage) {
  if (readCredential(storage))
    throw new Error('이미 PIN이 설정되었습니다. 설정된 PIN으로 잠금을 해제해 주세요.')
  const { credential, recoveryCode } = await buildCredential(pin)
  storage.setItem(AUTH_KEY, JSON.stringify(credential))
  return { recoveryCode }
}
export async function unlockPin(pin, storage = localStorage, now = Date.now()) {
  const credential = readCredential(storage)
  if (!credential) throw new Error('관리자가 먼저 PIN을 설정해 주세요.')
  if (credential.lockUntil > now)
    throw new Error(`${Math.ceil((credential.lockUntil - now) / 1000)}초 후 다시 시도해 주세요.`)
  if (!(await verifyPin(pin, credential))) {
    credential.failures += 1
    credential.lockUntil = credential.failures >= 5 ? now + 60000 : 0
    storage.setItem(AUTH_KEY, JSON.stringify(credential))
    throw new Error(
      credential.lockUntil ? '5회 이상 실패하여 1분간 잠겼습니다.' : 'PIN이 일치하지 않습니다.',
    )
  }
  storage.setItem(AUTH_KEY, JSON.stringify({ ...credential, failures: 0, lockUntil: 0 }))
  return true
}
async function verifyRecovery(credential, code) {
  const normalized = normalizeRecoveryCode(code)
  return (
    normalized.length === RECOVERY_LENGTH &&
    Boolean(credential.recoverySalt) &&
    (await verifySecret(normalized, {
      salt: credential.recoverySalt,
      hash: credential.recoveryHash,
    }))
  )
}
export async function resetPinWithRecovery(code, newPin, storage = localStorage) {
  const credential = readCredential(storage)
  if (!credential) throw new Error('설정된 관리자 PIN이 없습니다. 최초 설정을 진행해 주세요.')
  if (!credential.recoverySalt || !credential.recoveryHash)
    throw new Error(
      '이 기기에는 복구 코드가 없습니다. 운영 안내의 잠금 초기화 절차를 확인해 주세요.',
    )
  if (!(await verifyRecovery(credential, code)))
    throw new Error('복구 코드가 일치하지 않습니다. 대소문자와 하이픈 위치를 확인해 주세요.')
  const { credential: next, recoveryCode } = await buildCredential(newPin)
  storage.setItem(AUTH_KEY, JSON.stringify(next))
  return { recoveryCode }
}
export async function regenerateRecoveryCode(currentPin, storage = localStorage) {
  const credential = readCredential(storage)
  if (!credential) throw new Error('설정된 관리자 PIN이 없습니다.')
  if (!(await verifyPin(currentPin, credential))) throw new Error('현재 PIN이 일치하지 않습니다.')
  const recoveryCode = generateRecoveryCode()
  const recovery = await hashSecret(normalizeRecoveryCode(recoveryCode))
  storage.setItem(
    AUTH_KEY,
    JSON.stringify({
      ...credential,
      failures: 0,
      lockUntil: 0,
      recoverySalt: recovery.salt,
      recoveryHash: recovery.hash,
    }),
  )
  return { recoveryCode }
}
