import { STATUS, queueLabel, timeLabel } from '../domain/records'
export function csvCell(value) {
  let cell = String(value ?? '')
  // Prefix dangerous leading characters (including whitespace/full-width forms).
  // This is a spreadsheet-viewing export, not a lossless round-trip format.
  // eslint-disable-next-line no-control-regex -- deliberate CSV formula-prefix detection
  if (/^[\s\u0000-\u001f]*[=+\-@＝＋－＠]/u.test(cell) || /^[\t\r\n]/.test(cell)) cell = `'${cell}`
  return `"${cell.replaceAll('"', '""')}"`
}
export function buildCSV(records) {
  const header = [
    '접수일자',
    '접수번호',
    '접수시간',
    '학번/직원번호',
    '이름',
    '체온',
    '방문목적',
    '투약약품',
    '처치/진료내용',
    '상태',
  ]
  return (
    '\uFEFF' +
    [
      header,
      ...records.map((r) => [
        r.date,
        queueLabel(r),
        timeLabel(r.createdAt),
        r.studentId,
        r.name,
        r.temperature ?? '',
        r.symptom,
        r.medication,
        r.treatment,
        STATUS[r.status],
      ]),
    ]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n') +
    '\r\n'
  )
}
export function downloadFile(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export async function copyText(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value)
  const element = document.createElement('textarea')
  element.value = value
  element.className = 'clipboard-fallback'
  element.setAttribute('aria-hidden', 'true')
  document.body.appendChild(element)
  element.select()
  try {
    if (!document.execCommand('copy')) throw new Error('복사에 실패했습니다.')
  } finally {
    element.remove()
  }
}
