const ITERATIONS = 600000
function base64(bytes) {
  return btoa(String.fromCharCode(...bytes))
}
function bytes(value) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
}
async function derive(secret, salt, usage) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveKey', 'deriveBits'],
  )
  const algorithm = { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }
  return usage === 'hash'
    ? crypto.subtle.deriveBits(algorithm, key, 256)
    : crypto.subtle.deriveKey(algorithm, key, { name: 'AES-GCM', length: 256 }, false, usage)
}
export async function hashSecret(secret, salt = crypto.getRandomValues(new Uint8Array(16))) {
  return {
    salt: base64(salt),
    hash: base64(new Uint8Array(await derive(secret, salt, 'hash'))),
    iterations: ITERATIONS,
  }
}
export async function verifySecret(secret, ref) {
  const result = await hashSecret(secret, bytes(ref.salt))
  return result.hash === ref.hash
}
export async function hashPin(pin, salt = crypto.getRandomValues(new Uint8Array(16))) {
  if (!/^\d{6,12}$/.test(pin)) throw new Error('PIN은 숫자 6~12자리로 설정해 주세요.')
  return hashSecret(pin, salt)
}
export async function verifyPin(pin, credential) {
  if (!/^\d{6,12}$/.test(pin)) return false
  return verifySecret(pin, credential)
}
export async function encryptBackup(payload, password) {
  if (password.length < 12 || password.length > 128)
    throw new Error('백업 암호는 12~128자로 입력해 주세요.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await derive(password, salt, ['encrypt'])
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(payload)),
  )
  // Chunk conversion avoids a large spread / call-stack overflow for real backups.
  let binary = ''
  for (let i = 0; i < encrypted.length; i += 8192)
    binary += String.fromCharCode(...encrypted.subarray(i, i + 8192))
  return JSON.stringify({
    format: 'health-center-backup',
    version: 1,
    iterations: ITERATIONS,
    salt: base64(salt),
    iv: base64(iv),
    data: btoa(binary),
  })
}
export async function decryptBackup(raw, password) {
  try {
    const backup = JSON.parse(raw)
    if (
      backup.format !== 'health-center-backup' ||
      backup.version !== 1 ||
      backup.iterations !== ITERATIONS ||
      bytes(backup.salt).length !== 16 ||
      bytes(backup.iv).length !== 12
    )
      throw new Error()
    const key = await derive(password, bytes(backup.salt), ['decrypt'])
    const result = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes(backup.iv) },
      key,
      bytes(backup.data),
    )
    return new TextDecoder().decode(result)
  } catch {
    throw new Error('백업 암호가 다르거나 파일이 손상되었습니다. 현재 기록은 변경하지 않았습니다.')
  }
}
