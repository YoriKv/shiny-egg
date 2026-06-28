// Poll whether the managed EmuHawk subprocess is running + connected, for
// enabling emulator-only actions (e.g. the Palette panel's "Sync to Emulator"
// button). `bizhawk.isRunning()` is a cheap main-side state check (no emulator
// round-trip), and the running state changes out-of-band (Launch / Stop / a
// crash or harness disconnect), so a light poll is the simplest reliable signal.
// Polls only while a consumer is mounted.

import { useEffect, useState } from 'react'

const POLL_MS = 1500

export function useEmulatorRunning(): boolean {
  const [running, setRunning] = useState(false)
  useEffect(() => {
    let alive = true
    const check = (): void => {
      void window.shinyEgg.bizhawk
        .isRunning()
        .then((r) => {
          if (alive) setRunning(r)
        })
        .catch(() => {
          if (alive) setRunning(false)
        })
    }
    check()
    const id = setInterval(check, POLL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  return running
}
