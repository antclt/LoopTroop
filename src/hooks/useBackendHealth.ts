import { useEffect, useRef, useState } from 'react'
import { pingDevBackend } from '@/lib/devApi'
import { BACKEND_HEALTH_POLL_MS } from '@/lib/constants'

/**
 * Polls /api/health every BACKEND_HEALTH_POLL_MS ms.
 * Returns { isOffline: true } only after the backend was successfully reached
 * at least once, preventing a false-positive banner during initial startup.
 */
export function useBackendHealth(): { isOffline: boolean } {
  const [isOffline, setIsOffline] = useState(false)
  const hasConnectedRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    async function check() {
      const ok = await pingDevBackend()
      if (cancelled) return
      if (ok) {
        hasConnectedRef.current = true
        setIsOffline(false)
      } else if (hasConnectedRef.current) {
        setIsOffline(true)
      }
    }

    void check()
    const id = window.setInterval(() => { void check() }, BACKEND_HEALTH_POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  return { isOffline }
}
