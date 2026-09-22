import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { ordered, retentionCutoff, validateRecord, withinRetention } from '../src/domain/records.js'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  queue_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS records_date ON records(date);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
`

export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  // WAL: 접수 태블릿이 쓰는 동안에도 담당자 화면 조회가 막히지 않는다.
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}

export function createStore(db) {
  const selectAll = db.prepare('SELECT data FROM records ORDER BY date, queue_number')
  const upsert = db.prepare(`
    INSERT INTO records (id, date, queue_number, status, version, created_at, updated_at, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      date = excluded.date, queue_number = excluded.queue_number, status = excluded.status,
      version = excluded.version, created_at = excluded.created_at,
      updated_at = excluded.updated_at, data = excluded.data
  `)
  const removeRecord = db.prepare('DELETE FROM records WHERE id = ?')
  const readMeta = db.prepare('SELECT value FROM meta WHERE key = ?')
  const writeMeta = db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )
  const writeAudit = db.prepare('INSERT INTO audit (at, actor, action, detail) VALUES (?, ?, ?, ?)')
  const readAudit = db.prepare(
    'SELECT at, actor, action, detail FROM audit ORDER BY id DESC LIMIT ?',
  )

  const all = () => selectAll.all().map((row) => JSON.parse(row.data))
  const meta = (key, fallback = null) => readMeta.get(key)?.value ?? fallback
  const revision = () => Number(meta('revision', '0'))

  // 도메인 규칙(중복 접수, 상태 전환, 접수번호)은 전부 src/domain/records.js에 있다.
  // 서버는 그 순수 함수를 그대로 돌리고 결과만 저장한다 — 규칙이 두 벌로 갈라지지 않게.
  function apply(change, { actor = 'kiosk', action = '', detail = '', now = new Date() } = {}) {
    const run = db.prepare('BEGIN IMMEDIATE')
    run.run()
    try {
      const before = all()
      // 도메인 규칙 위반(중복 접수, 잘못된 체온, 버전 충돌 …)은 방문자·담당자에게 그대로
      // 보여 줄 수 있는 문구다. 서버 내부 오류와 구분하려고 표시해 둔다.
      let next
      try {
        next = change(before).map((record) => validateRecord(record))
      } catch (error) {
        error.userFacing = true
        throw error
      }
      const seen = new Set()
      for (const record of next) {
        if (seen.has(record.id)) throw new Error('같은 기록이 두 번 저장될 수 없습니다.')
        seen.add(record.id)
        const previous = before.find((r) => r.id === record.id)
        if (previous && JSON.stringify(previous) === JSON.stringify(record)) continue
        upsert.run(
          record.id,
          record.date,
          record.queueNumber,
          record.status,
          record.version,
          record.createdAt,
          record.updatedAt,
          JSON.stringify(record),
        )
      }
      for (const record of before) if (!seen.has(record.id)) removeRecord.run(record.id)
      const nextRevision = revision() + 1
      writeMeta.run('revision', String(nextRevision))
      if (action) writeAudit.run(now.toISOString(), actor, action, detail)
      db.exec('COMMIT')
      return { records: ordered(next), revision: nextRevision }
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  return {
    all,
    revision,
    apply,
    // 보관 기간(30일)이 지난 기록은 서버가 지운다. 기기별로 따로 지우던 것을 한 곳으로 모은 것.
    purge(now = new Date()) {
      const expired = all().filter((record) => !withinRetention(record, now))
      if (!expired.length) return 0
      apply((records) => records.filter((record) => withinRetention(record, now)), {
        actor: 'system',
        action: '보관 기간 경과 삭제',
        detail: `${expired.length}건 (${retentionCutoff(now)} 이전)`,
        now,
      })
      return expired.length
    },
    setting: (key, fallback = null) => meta(`setting:${key}`, fallback),
    saveSetting: (key, value) => writeMeta.run(`setting:${key}`, value),
    secret: (key) => meta(`secret:${key}`),
    saveSecret: (key, value) => writeMeta.run(`secret:${key}`, value),
    log: (actor, action, detail = '', now = new Date()) =>
      writeAudit.run(now.toISOString(), actor, action, detail),
    auditTrail: (limit = 200) => readAudit.all(limit),
  }
}
