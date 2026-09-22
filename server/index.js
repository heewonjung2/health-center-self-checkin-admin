import { readFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { networkInterfaces } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createApp } from './app.js'
import { createAuth } from './auth.js'
import { loadConfig } from './config.js'
import { createStore, openDatabase } from './db.js'

const PURGE_INTERVAL_MS = 60 * 60 * 1000

function makeServer(config, handler) {
  if (!config.secure) return createHttpServer(handler)
  return createHttpsServer(
    {
      cert: readFileSync(config.tlsCert),
      key: readFileSync(config.tlsKey),
      minVersion: 'TLSv1.2',
    },
    handler,
  )
}

export function startServer(config = loadConfig()) {
  const store = createStore(openDatabase(config.databaseFile))
  const auth = createAuth(store, { idleMs: config.sessionIdleMs })
  const server = makeServer(config, createApp({ store, auth, config }))

  const purge = setInterval(() => {
    try {
      const removed = store.purge()
      if (removed) console.log(`[health-center] 보관 기간 경과 기록 ${removed}건 삭제`)
    } catch (error) {
      console.error('[health-center] 보관 기간 정리 실패', error)
    }
  }, PURGE_INTERVAL_MS)
  purge.unref()
  store.purge()
  server.listen(config.port, config.host)
  return { server, store, auth }
}

function addresses(config) {
  const scheme = config.secure ? 'https' : 'http'
  const found = [`${scheme}://127.0.0.1:${config.port}`]
  if (config.host === '127.0.0.1' || config.host === 'localhost' || config.host === '::1') return found

  for (const list of Object.values(networkInterfaces()))
    for (const item of list ?? [])
      if (item.family === 'IPv4' && !item.internal)
        found.push(`${scheme}://${item.address}:${config.port}`)
  return found
}

const launchedDirectly =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url

if (launchedDirectly) {
  try {
    const config = loadConfig()
    const { server } = startServer(config)
    server.on('listening', () => {
      console.log('건강진료센터 접수 서버가 시작되었습니다.')
      console.log(`  기록 파일: ${config.databaseFile}`)
      console.log(`  연결 방식: ${config.secure ? 'HTTPS' : 'HTTP (서버 PC 로컬 전용)'}`)
      for (const address of addresses(config)) console.log(`  접속 주소: ${address}`)
      if (!config.secure)
        console.log('  다른 기기에서 접속하려면 학교 전산 담당자가 발급한 TLS 인증서를 설정하세요.')
    })
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE')
        console.error(
          `포트 ${config.port}를 이미 다른 프로그램이 쓰고 있습니다. HC_PORT로 바꿔 주세요.`,
        )
      else console.error('서버를 시작하지 못했습니다.', error)
      process.exitCode = 1
    })
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.on(signal, () => {
        console.log('서버를 종료합니다.')
        server.close(() => process.exit(0))
      })
  } catch (error) {
    console.error('서버 설정이 올바르지 않습니다.', error.message)
    process.exitCode = 1
  }
}
