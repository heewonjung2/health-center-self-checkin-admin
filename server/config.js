import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
const here = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(here, '..')
// 보건실 PC 한 대에서 돌아가는 전제. 값은 모두 환경 변수로 덮어쓸 수 있다.
export function loadConfig(env = process.env) {
  return {
    port: Number(env.HC_PORT ?? 8080),
    host: env.HC_HOST ?? '0.0.0.0',
    // 기록 파일. 백업은 이 파일(과 -wal, -shm)을 복사하면 된다.
    databaseFile: env.HC_DB ?? join(ROOT, 'data', 'health-center.sqlite'),
    staticDir: env.HC_STATIC ?? join(ROOT, 'dist'),
    // 세션은 담당자 화면 기준 5분 무활동이면 만료된다(기존 화면 잠금과 동일).
    sessionIdleMs: Number(env.HC_SESSION_IDLE_MS ?? 5 * 60 * 1000),
    // 접수 태블릿처럼 개인정보를 읽지 않는 요청은 로그인 없이 허용한다.
    trustProxy: env.HC_TRUST_PROXY === '1',
  }
}
