// Default: weekdays 09:00–17:30 Korea time. Admins can change this in settings.
export const DEFAULT_HOURS = { start: '09:00', end: '17:30', days: [1, 2, 3, 4, 5] }
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
export function validHours(value) {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    TIME.test(value.start) &&
    TIME.test(value.end) &&
    value.start < value.end &&
    Array.isArray(value.days) &&
    value.days.length > 0 &&
    value.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) &&
    new Set(value.days).size === value.days.length
  )
}
export function normalizeHours(value) {
  return {
    start: value.start,
    end: value.end,
    days: [...value.days].sort((a, b) => a - b),
  }
}
// 운영 시간은 서버가 문자열 하나로 들고 있다. 세 기기가 같은 값을 본다.
export function parseHours(raw) {
  if (typeof raw !== 'string') return DEFAULT_HOURS
  try {
    const data = JSON.parse(raw)
    return validHours(data) ? normalizeHours(data) : DEFAULT_HOURS
  } catch {
    return DEFAULT_HOURS
  }
}
export function serializeHours(value) {
  if (!validHours(value))
    throw new Error('운영 시간 설정이 올바르지 않습니다. 시작·종료 시각을 확인해 주세요.')
  return JSON.stringify(normalizeHours(value))
}
function seoulNow(now) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type) => parts.find((p) => p.type === type)?.value ?? ''
  const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { day: days[get('weekday')], time: `${get('hour')}:${get('minute')}` }
}
export function isOpen(hours, now = new Date()) {
  const { day, time } = seoulNow(now)
  return hours.days.includes(day) && time >= hours.start && time < hours.end
}
const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']
export function hoursSummary(hours) {
  const days = hours.days.map((d) => DAY_LABELS[d]).join('·')
  return `${days} ${hours.start}–${hours.end}`
}
