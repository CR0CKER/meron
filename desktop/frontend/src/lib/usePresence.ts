import { useEffect, useRef, useState } from 'react'

export type PresencePhase = 'closed' | 'entering' | 'open' | 'exiting'

function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Mount/unmount phases for an element that animates in and out. `entering` and
 * `exiting` each last `ms`, so the caller can keep the element mounted while its
 * close animation plays. Timers rather than `animationend`: a phase can never
 * get stuck when no animation runs (reduced motion, a hidden window). What is
 * already open at mount starts settled — only changes animate.
 */
export function usePresence(open: boolean, ms: number): PresencePhase {
  const [phase, setPhase] = useState<PresencePhase>(open ? 'open' : 'closed')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (timer.current) clearTimeout(timer.current)
    if (prefersReducedMotion()) {
      setPhase(open ? 'open' : 'closed')
      return
    }
    setPhase(open ? 'entering' : 'exiting')
    timer.current = setTimeout(() => setPhase(open ? 'open' : 'closed'), ms)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [open, ms])

  return phase
}
