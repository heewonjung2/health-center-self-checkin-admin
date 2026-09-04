import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createApp } from './app.js'
import { createAuth } from './auth.js'
import { loadConfig } from './config.js'
import { createStore, openDatabase } from './db.js'

const PURGE_INTERVAL_MS = 60 * 60 * 1000

export function startServer(config = loadConfig()) {
  const store = createStore(openDatabase(config.databaseFile))
  const auth = createAuth(store, { idleMs: config.sessionIdleMs })
  const server = createServer(createApp({ store, auth, config }))
  // 보관 기간이 지난 기록은 서버가 한 시간에 한 번 정리한다.
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

function addresses(port) {
  const found = [`http://localhost:${port}`]
  for (const list of Object.values(networkInterfaces()))
    for (const item of list ?? [])
      if (item.family === 'IPv4' && !item.internal) found.push(`http://${item.address}:${port}`)
  return found
}

// 이 파일을 직접 실행했을 때만 서버를 띄운다(테스트는 startServer만 가져다 쓴다).
// Windows 경로는 역슬래시라 문자열 비교로는 맞출 수 없어 pathToFileURL로 정규화한다.
const launchedDirectly =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url
if (launchedDirectly) {
  const config = loadConfig()
  const { server } = startServer(config)
  server.on('listening', () => {
    console.log('건강진료센터 접수 서버가 시작되었습니다.')
    console.log(`  기록 파일: ${config.databaseFile}`)
    for (const address of addresses(config.port)) console.log(`  접속 주소: ${address}`)
    console.log('  태블릿·근로학생 PC는 위 접속 주소(localhost 아닌 쪽)로 들어가면 됩니다.')
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
}
