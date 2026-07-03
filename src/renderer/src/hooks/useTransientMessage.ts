import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A self-dismissing status message — the small "toast" idiom shared by the app's
 * transient panel notices (the Palette panel's sync result, the Place tool's
 * "pick an object" prompt). `show(msg)` displays the message and (re-)arms the
 * auto-dismiss timer; `dismiss()` clears it early (e.g. a click-to-dismiss).
 *
 * `show` re-arms even when called with the SAME text (each call bumps an internal
 * sequence so the timer effect re-runs) — so re-triggering a still-visible toast
 * keeps it up for the full `timeoutMs` again instead of letting the old timer run
 * out. `timeoutMs <= 0` disables auto-dismiss (manual/click dismissal only).
 *
 * `show` / `dismiss` are stable across renders, so callers can list them in
 * effect / callback dependency arrays without churn.
 */
export function useTransientMessage(timeoutMs = 4000): {
  message: string | null
  show: (msg: string) => void
  dismiss: () => void
} {
  // The text plus a monotonic seq so an identical-text re-show still changes
  // identity and re-runs the auto-dismiss effect (re-arming the timer).
  const [state, setState] = useState<{ text: string; seq: number } | null>(null)
  const seqRef = useRef(0)

  const show = useCallback((msg: string) => {
    seqRef.current += 1
    setState({ text: msg, seq: seqRef.current })
  }, [])
  const dismiss = useCallback(() => setState(null), [])

  useEffect(() => {
    if (!state || timeoutMs <= 0) return
    const t = setTimeout(() => setState(null), timeoutMs)
    return () => clearTimeout(t)
  }, [state, timeoutMs])

  return { message: state?.text ?? null, show, dismiss }
}
