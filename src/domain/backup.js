import { ACTIVE, decodeStore } from './records'
export function mergeBackup(current, imported) {
  const result = [...current]
  const byId = new Map(current.map((r) => [r.id, r]))
  for (const record of imported) {
    const existing = byId.get(record.id)
    if (existing) {
      // A previous restore may have reassigned the local queue number.
      const { queueNumber: _existingQueue, ...existingContent } = existing
      const { queueNumber: _backupQueue, ...backupContent } = record
      if (JSON.stringify(existingContent) !== JSON.stringify(backupContent))
        throw new Error(
          '현재 기록과 내용이 다른 동일 ID가 있습니다. 덮어쓰지 않았습니다. 관리자에게 확인해 주세요.',
        )
      continue
    }
    if (
      ACTIVE.includes(record.status) &&
      result.some(
        (r) =>
          r.date === record.date && r.studentId === record.studentId && ACTIVE.includes(r.status),
      )
    )
      throw new Error(
        '복원할 자료에 중복된 진행 중 접수가 있습니다. 현재 기록은 변경하지 않았습니다.',
      )
    const sameDay = result.filter((r) => r.date === record.date)
    const queueNumber = sameDay.some((r) => r.queueNumber === record.queueNumber)
      ? Math.max(...sameDay.map((r) => r.queueNumber)) + 1
      : record.queueNumber
    const added = { ...record, queueNumber }
    result.push(added)
    byId.set(added.id, added)
  }
  return result
}
export function inspectBackup(raw, now = new Date()) {
  return decodeStore(raw, now)
}
