import { useEffect, useRef } from 'react'
import { RECOVERY_RELOAD_MIN_ACTIVE_MS } from '@/lib/constants'
import { requestRecoveryReload } from '@/lib/recoveryReload'

export function useRecoveryAutoReload(source: string, active: boolean): void {
  const wasActiveRef = useRef(active)
  const activeSinceRef = useRef<number | null>(active ? Date.now() : null)

  useEffect(() => {
    if (active && !wasActiveRef.current) {
      activeSinceRef.current = Date.now()
    }

    if (wasActiveRef.current && !active) {
      const activeSince = activeSinceRef.current
      const activeDuration = activeSince === null
        ? RECOVERY_RELOAD_MIN_ACTIVE_MS
        : Date.now() - activeSince
      if (activeDuration >= RECOVERY_RELOAD_MIN_ACTIVE_MS) {
        requestRecoveryReload(source)
      }
      activeSinceRef.current = null
    }

    wasActiveRef.current = active
  }, [active, source])
}
