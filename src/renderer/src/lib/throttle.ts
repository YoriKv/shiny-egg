import { useCallback, useEffect, useRef } from 'react'

/**
 * Leading+trailing throttle as a stable callback. The returned function fires
 * `fn` immediately on the first call after an idle gap, then at most once per
 * `delayMs` while calls keep coming, and always delivers the *final* value a
 * trailing `delayMs` after the last call. Used by the reorder slider so a
 * continuous drag re-renders (and commits one undo step) at most once per
 * window instead of once per slider tick.
 *
 * The cleanup flushes nothing (a pending trailing call is dropped on unmount) —
 * callers that must not lose the final value commit it directly on release.
 */
export function useThrottledCallback<T>(
  fn: (value: T) => void,
  delayMs: number
): (value: T) => void {
  const fnRef = useRef(fn)
  fnRef.current = fn
  const lastRun = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<{ value: T } | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  return useCallback(
    (value: T) => {
      const now = Date.now()
      const remaining = delayMs - (now - lastRun.current)
      if (remaining <= 0) {
        lastRun.current = now
        if (timer.current) {
          clearTimeout(timer.current)
          timer.current = null
        }
        pending.current = null
        fnRef.current(value)
      } else {
        pending.current = { value }
        if (!timer.current) {
          timer.current = setTimeout(() => {
            lastRun.current = Date.now()
            timer.current = null
            const p = pending.current
            pending.current = null
            if (p) fnRef.current(p.value)
          }, remaining)
        }
      }
    },
    [delayMs]
  )
}
