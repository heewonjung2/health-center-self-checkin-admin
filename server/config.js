import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(here, '..')

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

function positiveNumber(value, name) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} 값이 올바르지 않습니다.`)
  return parsed
}

// 기본 실행은 서버 PC 안에서만 접근 가능한 HTTP다.
// LAN에 바인딩하려면 인증서와 개인 키를 함께 지정해 HTTPS로 실행해야 한다.
export function loadConfig(env = process.env) {
  const host = env.HC_HOST ?? '127.0.0.1'
  const tlsCert = env.HC_TLS_CERT ? resolve(env.HC_TLS_CERT) : null
  const tlsKey = env.HC_TLS_KEY ? resolve(env.HC_TLS_KEY) : null

  if (Boolean(tlsCert) !== Boolean(tlsKey))
    throw new Error('HC_TLS_CERT와 HC_TLS_KEY는 반드시 함께 지정해야 합니다.')

  if (!LOOPBACK_HOSTS.has(host) && (!tlsCert || !tlsKey))
    throw new Error(
      'LAN 전체에 평문 HTTP로 노출할 수 없습니다. HC_TLS_CERT와 HC_TLS_KEY를 지정해 HTTPS로 실행하세요.',
    )

  const port = positiveNumber(env.HC_PORT ?? 8080, 'HC_PORT')
  if (!Number.isInteger(port) || port > 65535) throw new Error('HC_PORT 값이 올바르지 않습니다.')

  return {
    port,
    host,
    tlsCert,
    tlsKey,
    secure: Boolean(tlsCert && tlsKey),
    databaseFile: env.HC_DB ?? join(ROOT, 'data', 'health-center.sqlite'),
    staticDir: env.HC_STATIC ?? join(ROOT, 'dist'),
    sessionIdleMs: positiveNumber(env.HC_SESSION_IDLE_MS ?? 5 * 60 * 1000, 'HC_SESSION_IDLE_MS'),
    trustProxy: env.HC_TRUST_PROXY === '1',
  }
}
