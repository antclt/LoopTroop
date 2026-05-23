import { useEffect, useRef } from 'react'
import { requestRecoveryReload } from '@/lib/recoveryReload'

export function useRecoveryAutoReload(source: string, active: boolean): void {
  const wasActiveRef = useRef(active)

  useEffect(() => {
    if (wasActiveRef.current && !active) {
      requestRecoveryReload(source)
    }
    wasActiveRef.current = active
  }, [active, source])
}
