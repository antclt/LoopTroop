import { useEffect, useRef, useState } from 'react'
import { pingDevBackend } from '@/lib/devApi'
import {
  BACKEND_HEALTH_POLL_MS,
  BACKEND_HEALTH_RECONNECT_GRACE_MS,
} from '@/lib/constants'

/**
 * Polls /api/health every BACKEND_HEALTH_POLL_MS ms.
 * Returns { isOffline: true } only after the backend was successfully reached
 * at least once and a failed probe is confirmed after a short grace delay,
 * preventing false-positive banners during startup and brief proxy stalls.
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
        return
      }

      if (!hasConnectedRef.current) return

      await new Promise(resolve => window.setTimeout(resolve, BACKEND_HEALTH_RECONNECT_GRACE_MS))
      if (cancelled) return

      const confirmedOk = await pingDevBackend()
      if (cancelled) return
      if (confirmedOk) {
        hasConnectedRef.current = true
        setIsOffline(false)
      } else {
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
