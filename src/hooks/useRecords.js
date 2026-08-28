import { useCallback, useEffect, useState } from 'react'
import {
  maintainStore,
  readStore,
  LEGACY_KEY,
  STORAGE_KEY,
  STORE_EVENT,
  transact,
} from '../lib/storage'
function snapshot() {
  try {
    return { ...readStore(), error: '' }
  } catch (error) {
    return { records: [], revision: 0, error: error.message }
  }
}
export function useRecords() {
  const [state, setState] = useState(snapshot)
  const refresh = useCallback(() => setState(snapshot()), [])
  useEffect(() => {
    const maintain = () =>
      maintainStore()
        .then(refresh)
        .catch((error) => setState((prev) => ({ ...prev, error: error.message })))
    const onStorage = (event) => {
      if (event.key === STORAGE_KEY || event.key === LEGACY_KEY || event.key === null) refresh()
    }
    void maintain()
    window.addEventListener('storage', onStorage)
    window.addEventListener(STORE_EVENT, refresh)
    const timer = setInterval(maintain, 60000)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(STORE_EVENT, refresh)
      clearInterval(timer)
    }
  }, [refresh])
  const mutate = useCallback(async (change) => {
    const next = await transact(change)
    setState({ ...next, error: '' })
    return next
  }, [])
  return { ...state, refresh, mutate }
}
