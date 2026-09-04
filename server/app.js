import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import {
  ACTIVE,
  SCHEMA_VERSION,
  changeRegistration,
  createRegistration,
  dateKey,
  ordered,
  validDate,
  validateRecord,
} from '../src/domain/records.js'
import { inspectBackup, mergeBackup } from '../src/domain/backup.js'
import { decryptBackup, encryptBackup } from '../src/lib/crypto.js'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}
const COOKIE = 'hc_session'
const MAX_BODY = 512 * 1024
const SESSION_COOKIE_MAX_AGE = 43200
const ACTIONS = new Set(['edit', 'start', 'complete', 'cancel', 'restore'])
const fail = (message, status = 400) => Object.assign(new Error(message), { status })

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
}

function readCookie(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}
async function readBody(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw fail('요청이 너무 큽니다.', 413)
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw fail('요청 형식이 올바르지 않습니다.')
  }
}
// 대기 화면은 접수번호와 상태만 본다. 이름·학번은 담당자 로그인 뒤에만 나간다.
const publicEntry = (record) => ({ queueNumber: record.queueNumber, status: record.status })

export function createApp({ store, auth, config, now = () => new Date() }) {
  const listeners = new Set()
  const broadcast = (revision) => {
    for (const res of listeners)
      res.write(`event: change\ndata: ${JSON.stringify({ revision })}\n\n`)
  }
  const attempts = new Map()
  function throttle(ip) {
    const record = attempts.get(ip) ?? { count: 0, until: 0 }
    if (record.until > Date.now()) throw fail('잠시 후 다시 시도해 주세요.', 429)
    record.count += 1
    if (record.count > 20) Object.assign(record, { count: 0, until: Date.now() + 60000 })
    attempts.set(ip, record)
  }

  function send(res, status, payload, headers = {}) {
    res.writeHead(status, {
      ...securityHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    })
    res.end(JSON.stringify(payload))
  }
  const cookieHeader = (token, maxAge) =>
    `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}`

  function requireSession(req) {
    const token = readCookie(req.headers.cookie, COOKIE)
    if (!token || !auth.touch(token))
      throw fail('담당자 인증이 필요합니다. 다시 잠금을 해제해 주세요.', 401)
    return token
  }
  function mutate(change, options) {
    const result = store.apply(change, options)
    broadcast(result.revision)
    return result
  }

  async function api(req, res, url) {
    const path = url.pathname.replace(/^\/api/, '')
    const method = req.method
    const ip = req.socket.remoteAddress ?? 'unknown'
    const today = dateKey(now())
    const date = url.searchParams.get('date') ?? today
    if (!validDate(date)) throw fail('날짜 형식이 올바르지 않습니다.')

    if (path === '/status' && method === 'GET') {
      const token = readCookie(req.headers.cookie, COOKIE)
      return send(res, 200, {
        pinConfigured: auth.configured(),
        authenticated: Boolean(token && auth.touch(token)),
        revision: store.revision(),
        today,
        hours: store.setting('hours'),
      })
    }
    // 접수 태블릿이 쓰는 두 경로만 로그인 없이 열려 있다.
    if (path === '/queue' && method === 'GET') {
      const entries = ordered(
        store.all().filter((r) => r.date === date && ACTIVE.includes(r.status)),
      ).map(publicEntry)
      return send(res, 200, { date, revision: store.revision(), entries })
    }
    if (path === '/registrations' && method === 'POST') {
      const input = await readBody(req)
      let created
      const result = mutate(
        (records) => {
          created = createRegistration(records, input, now())
          return [...records, created]
        },
        { actor: 'kiosk', action: '접수', now: now() },
      )
      return send(res, 201, { queueNumber: created.queueNumber, revision: result.revision })
    }
    if (path === '/events' && method === 'GET') {
      res.writeHead(200, {
        ...securityHeaders,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      })
      res.write(`event: change\ndata: ${JSON.stringify({ revision: store.revision() })}\n\n`)
      listeners.add(res)
      const beat = setInterval(() => res.write(': keep-alive\n\n'), 25000)
      req.on('close', () => {
        clearInterval(beat)
        listeners.delete(res)
      })
      return undefined
    }

    if (path === '/session' && method === 'POST') {
      throttle(ip)
      const { pin } = await readBody(req)
      const token = auth.unlock(pin)
      store.log('admin', '담당자 화면 잠금 해제', ip, now())
      return send(
        res,
        200,
        { authenticated: true },
        { 'Set-Cookie': cookieHeader(token, SESSION_COOKIE_MAX_AGE) },
      )
    }
    if (path === '/session' && method === 'DELETE') {
      const token = readCookie(req.headers.cookie, COOKIE)
      if (token) auth.end(token)
      return send(res, 200, { authenticated: false }, { 'Set-Cookie': cookieHeader('', 0) })
    }
    if (path === '/pin/setup' && method === 'POST') {
      throttle(ip)
      const { pin } = await readBody(req)
      const { recoveryCode, token } = auth.setupPin(pin)
      store.log('admin', '관리자 PIN 최초 설정', ip, now())
      return send(
        res,
        201,
        { recoveryCode },
        { 'Set-Cookie': cookieHeader(token, SESSION_COOKIE_MAX_AGE) },
      )
    }
    if (path === '/pin/recover' && method === 'POST') {
      throttle(ip)
      const { recoveryCode, pin } = await readBody(req)
      const issued = auth.resetWithRecovery(recoveryCode, pin)
      store.log('admin', '복구 코드로 PIN 재설정', ip, now())
      return send(
        res,
        200,
        { recoveryCode: issued.recoveryCode },
        { 'Set-Cookie': cookieHeader(issued.token, SESSION_COOKIE_MAX_AGE) },
      )
    }
    if (path === '/pin/change' && method === 'POST') {
      requireSession(req)
      const { currentPin, pin } = await readBody(req)
      auth.changePin(currentPin, pin)
      store.log('admin', '관리자 PIN 변경', ip, now())
      return send(res, 200, { ok: true })
    }
    if (path === '/pin/recovery-code' && method === 'POST') {
      requireSession(req)
      const { currentPin } = await readBody(req)
      const recoveryCode = auth.regenerateRecoveryCode(currentPin)
      store.log('admin', '복구 코드 재발급', ip, now())
      return send(res, 200, { recoveryCode })
    }

    requireSession(req)
    if (path === '/records' && method === 'GET') {
      return send(res, 200, { revision: store.revision(), records: ordered(store.all()) })
    }
    const action = path.match(/^\/records\/([^/]+)\/([a-z]+)$/)
    if (action && method === 'POST') {
      const [, id, name] = action
      if (!ACTIONS.has(name)) throw fail('알 수 없는 작업입니다.', 404)
      const { expectedVersion, fields = {} } = await readBody(req)
      const result = mutate(
        (records) => changeRegistration(records, id, expectedVersion, name, fields, now()),
        { actor: 'admin', action: `기록 ${name}`, detail: id, now: now() },
      )
      return send(res, 200, {
        revision: result.revision,
        record: result.records.find((r) => r.id === id),
      })
    }
    // 기기마다 브라우저에 남아 있던 기존 기록을 서버로 한 번 올리는 경로.
    if (path === '/import' && method === 'POST') {
      const { records: incoming } = await readBody(req)
      if (!Array.isArray(incoming)) throw fail('이관할 기록 목록이 필요합니다.')
      let added = 0
      let skipped = 0
      const result = mutate(
        (records) => {
          const next = [...records]
          for (const raw of incoming) {
            const record = validateRecord(raw)
            const duplicate = next.some(
              (r) =>
                r.id === record.id ||
                (r.date === record.date &&
                  r.studentId === record.studentId &&
                  r.createdAt === record.createdAt),
            )
            if (duplicate) {
              skipped += 1
              continue
            }
            const taken = new Set(
              next.filter((r) => r.date === record.date).map((r) => r.queueNumber),
            )
            let queueNumber = record.queueNumber
            while (taken.has(queueNumber)) queueNumber += 1
            next.push({ ...record, queueNumber })
            added += 1
          }
          return next
        },
        {
          actor: 'admin',
          action: '기존 기록 이관',
          detail: `${incoming.length}건 요청`,
          now: now(),
        },
      )
      return send(res, 200, { added, skipped, revision: result.revision })
    }
    // 백업 암·복호화는 서버에서 한다. 태블릿·근로학생 PC는 http로 붙어 있어
    // 브라우저 암호화 기능(crypto.subtle)을 쓸 수 없기 때문이다.
    if (path === '/backup' && method === 'POST') {
      const { password } = await readBody(req)
      const payload = JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        revision: store.revision(),
        records: ordered(store.all()),
      })
      let file
      try {
        file = await encryptBackup(payload, String(password ?? ''))
      } catch (error) {
        throw fail(error.message)
      }
      store.log('admin', '백업 내려받기', '', now())
      return send(res, 200, { file })
    }
    if (path === '/restore' && method === 'POST') {
      const { password, payload } = await readBody(req)
      let imported
      try {
        imported = inspectBackup(await decryptBackup(String(payload ?? ''), String(password ?? '')))
      } catch (error) {
        throw fail(error.message)
      }
      const result = mutate((records) => mergeBackup(records, imported.records), {
        actor: 'admin',
        action: '백업 복원',
        detail: `${imported.records.length}건`,
        now: now(),
      })
      return send(res, 200, { restored: imported.records.length, revision: result.revision })
    }
    if (path === '/hours' && method === 'PUT') {
      const { hours } = await readBody(req)
      if (typeof hours !== 'string' || hours.length > 2000)
        throw fail('운영 시간 형식이 올바르지 않습니다.')
      store.saveSetting('hours', hours)
      store.log('admin', '운영 시간 변경', hours, now())
      return send(res, 200, { hours })
    }
    if (path === '/audit' && method === 'GET') {
      return send(res, 200, { entries: store.auditTrail(200) })
    }
    throw fail('요청한 경로를 찾을 수 없습니다.', 404)
  }

  function serveStatic(req, res, url) {
    const dir = config.staticDir
    if (!existsSync(dir)) {
      res.writeHead(503, { ...securityHeaders, 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('화면 파일이 없습니다. 서버 PC에서 npm run build를 먼저 실행해 주세요.')
    }
    const requested = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[\\/])+/, '')
    let file = join(dir, requested)
    if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory())
      file = join(dir, 'index.html')
    res.writeHead(200, {
      ...securityHeaders,
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': file.includes(`${join(dir, 'assets')}`)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    })
    createReadStream(file).pipe(res)
    return undefined
  }

  return async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url)
      if (req.method !== 'GET' && req.method !== 'HEAD')
        throw fail('허용되지 않은 요청입니다.', 405)
      return serveStatic(req, res, url)
    } catch (error) {
      const status = error?.status ?? (error?.userFacing ? 400 : 500)
      if (status === 500) console.error('[health-center]', error)
      if (res.headersSent) return res.end()
      return send(res, status, {
        error:
          status === 500
            ? '서버에서 처리하지 못했습니다. 담당자에게 문의해 주세요.'
            : error.message,
      })
    }
  }
}
