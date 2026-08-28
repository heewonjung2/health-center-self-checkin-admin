import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { webcrypto } from 'node:crypto'
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '')
}
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open')
}
beforeEach(() => {
  localStorage.clear()
  let queue = Promise.resolve()
  Object.defineProperty(navigator, 'locks', {
    value: {
      request: (_name, callback) => {
        const next = queue.then(callback)
        queue = next.catch(() => {})
        return next
      },
    },
    configurable: true,
  })
})
afterEach(() => {
  cleanup()
  localStorage.clear()
})
