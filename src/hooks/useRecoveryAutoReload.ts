import { useEffect, useRef } from 'react'
import { RECOVERY_RELOAD_MIN_ACTIVE_MS } from '@/lib/constants'
import { requestRecoveryReload } from '@/lib/recoveryReload'

export function useRecoveryAutoReload(source: string, active: boolean): void {
  const wasActiveRef = useRef(active)
  const activeSinceRef = useRef<number | null>(active ? Date.now() : null)
  const pageInactiveRef = useRef(typeof document !== 'undefined' && document.visibilityState === 'hidden')
  const interruptedEpisodeRef = useRef(pageInactiveRef.current)

  useEffect(() => {
    const markPageInactive = () => {
      pageInactiveRef.current = true
      if (wasActiveRef.current) interruptedEpisodeRef.current = true
    }
    const markPageActive = () => {
      pageInactiveRef.current = false
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') markPageInactive()
      else markPageActive()
    }

    window.addEventListener('blur', markPageInactive)
    window.addEventListener('focus', markPageActive)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('blur', markPageInactive)
      window.removeEventListener('focus', markPageActive)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (active && !wasActiveRef.current) {
      activeSinceRef.current = Date.now()
      interruptedEpisodeRef.current = pageInactiveRef.current
    }

    if (wasActiveRef.current && !active) {
      const activeSince = activeSinceRef.current
      const activeDuration = activeSince === null
        ? RECOVERY_RELOAD_MIN_ACTIVE_MS
        : Date.now() - activeSince
      if (activeDuration >= RECOVERY_RELOAD_MIN_ACTIVE_MS && !interruptedEpisodeRef.current) {
        requestRecoveryReload(source)
      }
      activeSinceRef.current = null
      interruptedEpisodeRef.current = false
    }

    wasActiveRef.current = active
  }, [active, source])
}
