// 보건실 PC에서 도는 서버와 이야기하는 유일한 통로.
// 화면은 여기를 통해서만 기록을 읽고 쓴다 — 기기 저장소에는 아무것도 남기지 않는다.
const OFFLINE = '보건실 서버에 연결할 수 없습니다. 서버 PC가 켜져 있는지 확인해 주세요.'

async function request(path, { method = 'GET', body } = {}) {
  let response
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw Object.assign(new Error(OFFLINE), { offline: true })
  }
  let payload = {}
  try {
    payload = await response.json()
  } catch {
    payload = {}
  }
  if (!response.ok)
    throw Object.assign(new Error(payload.error ?? '서버가 요청을 처리하지 못했습니다.'), {
      status: response.status,
    })
  return payload
}

export const api = {
  status: () => request('/status'),
  queue: (date) => request(`/queue${date ? `?date=${date}` : ''}`),
  register: (input) => request('/registrations', { method: 'POST', body: input }),
  records: () => request('/records'),
  act: (id, action, expectedVersion, fields = {}) =>
    request(`/records/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      body: { expectedVersion, fields },
    }),
  openSession: (pin) => request('/session', { method: 'POST', body: { pin } }),
  closeSession: () => request('/session', { method: 'DELETE' }),
  setupPin: (pin) => request('/pin/setup', { method: 'POST', body: { pin } }),
  changePin: (currentPin, pin) =>
    request('/pin/change', { method: 'POST', body: { currentPin, pin } }),
  recoverPin: (recoveryCode, pin) =>
    request('/pin/recover', { method: 'POST', body: { recoveryCode, pin } }),
  reissueRecoveryCode: (currentPin) =>
    request('/pin/recovery-code', { method: 'POST', body: { currentPin } }),
  importRecords: (records) => request('/import', { method: 'POST', body: { records } }),
  audit: () => request('/audit'),
  saveHours: (hours) => request('/hours', { method: 'PUT', body: { hours } }),
  backup: (password) => request('/backup', { method: 'POST', body: { password } }),
  restore: (password, payload) =>
    request('/restore', { method: 'POST', body: { password, payload } }),
}

// 다른 기기에서 접수·처리가 일어나면 서버가 알려 준다. 끊기면 브라우저가 알아서 다시 붙는다.
export function subscribe(onChange) {
  if (typeof EventSource !== 'function') return () => {}
  const source = new EventSource('/api/events')
  source.addEventListener('change', (event) => {
    try {
      onChange(JSON.parse(event.data).revision)
    } catch {
      onChange(null)
    }
  })
  return () => source.close()
}
