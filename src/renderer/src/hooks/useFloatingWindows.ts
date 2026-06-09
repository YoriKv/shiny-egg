import { useCallback, useEffect, useState } from 'react'
import { persistedState } from '../lib/persisted-state'

export interface WindowDef {
  id: string
  title: string
  pos: { x: number; y: number }
  width: number
  /** Optional pixel height. Undefined = auto-size (body content drives). */
  height?: number
  z: number
  open: boolean
  kind:
    | 'tiles'
    | 'props'
    | 'header'
    | 'palette'
    | 'strings'
    | 'world-map'
    | 'picker'
    | 'finder'
    | 'patches'
    | 'banks'
    | 'paint'
}

const INITIAL_WINDOWS: WindowDef[] = [
  {
    id: 'tiles',
    title: 'Tiles',
    pos: { x: 24, y: 24 },
    // Map16 gallery is 256×256 source pixels; default to a 2×-ish view so
    // cells are immediately legible. User can drag the SE corner to resize.
    width: 540,
    height: 580,
    z: 1,
    // Closed by default; reopen from the toolbar. Properties is the only
    // panel shown on a fresh launch.
    open: false,
    kind: 'tiles'
  },
  {
    id: 'palette',
    title: 'Palette',
    // Starts just below Tiles. Width matches the 16×14px swatch grid.
    pos: { x: 24, y: 620 },
    width: 244,
    z: 1,
    // Closed by default; reopen from the toolbar.
    open: false,
    kind: 'palette'
  },
  {
    id: 'props',
    title: 'Properties',
    // x is recomputed on first load (no persisted state) to anchor right
    pos: { x: 0, y: 24 },
    width: 260,
    z: 2,
    open: true,
    kind: 'props'
  },
  {
    id: 'header',
    title: 'Level Header',
    // Level-wide header fields — closed by default; reopen from the toolbar.
    // Auto-height (the fields lay out two-up per section, so ~8 rows).
    // Width holds two [label value] pairs side by side (see se-props__list--2col).
    pos: { x: 320, y: 80 },
    width: 480,
    z: 8,
    open: false,
    kind: 'header'
  },
  {
    id: 'strings',
    title: 'Strings',
    // Secondary tool — closed by default; reopen from the toolbar (grouped with
    // Tiles/Palette). Tall enough to show the level-name list.
    pos: { x: 600, y: 24 },
    width: 440,
    height: 560,
    z: 3,
    open: false,
    kind: 'strings'
  },
  {
    id: 'world-map',
    title: 'World Map',
    // World-map entrance editor — spawn / progression per slot. Closed by
    // default; reopen from the toolbar. Tall enough for the per-world slot list.
    pos: { x: 640, y: 48 },
    width: 460,
    height: 580,
    z: 3,
    open: false,
    kind: 'world-map'
  },
  {
    id: 'picker',
    title: 'Place',
    pos: { x: 620, y: 600 },
    width: 320,
    height: 420,
    z: 4,
    open: false,
    kind: 'picker'
  },
  {
    id: 'finder',
    title: 'Find object',
    pos: { x: 660, y: 640 },
    width: 300,
    z: 5,
    open: false,
    kind: 'finder'
  },
  {
    id: 'patches',
    title: 'Patches',
    pos: { x: 700, y: 60 },
    width: 380,
    height: 520,
    z: 6,
    open: false,
    kind: 'patches'
  },
  {
    id: 'banks',
    title: 'Level Banks',
    // Read-only byte-budget overview — closed by default; reopen from the
    // toolbar. Tall + scrollable: one section per level-data bank pool.
    pos: { x: 740, y: 100 },
    width: 340,
    height: 540,
    z: 7,
    open: false,
    kind: 'banks'
  },
  // Paint Surface window — hidden from the UI for now (kept for later). Body is
  // panels/PaintPanel.tsx, rendered by App.tsx's w.kind === 'paint' branch. The
  // 'paint' member stays in WindowDef.kind above so that branch still type-checks.
  // Uncomment to re-enable (with the App.tsx TOOLS + PANEL_TOGGLES 'paint' entries).
  // {
  //   id: 'paint',
  //   title: 'Paint Surface',
  //   pos: { x: 620, y: 560 },
  //   width: 280,
  //   z: 7,
  //   open: false,
  //   kind: 'paint'
  // }
]

// ── Floating-window persistence ───────────────────────────────────────────
// Only pos + size + open are saved; z-index is session state and resets on
// launch. `size` is optional — missing = use the window's default width/
// auto-height. Backward-compatible with v1 persisted blobs.

interface PersistedWindow {
  pos: { x: number; y: number }
  size?: { width: number; height: number }
  open: boolean
}

const windowsStore = persistedState<Record<string, PersistedWindow>>(
  'shinyEgg.windows.v1',
  {}
)

function persistWindows(windows: WindowDef[]): void {
  const data: Record<string, PersistedWindow> = {}
  for (const w of windows) {
    const entry: PersistedWindow = { pos: w.pos, open: w.open }
    if (w.height != null) entry.size = { width: w.width, height: w.height }
    data[w.id] = entry
  }
  windowsStore.save(data)
}

/**
 * Merge persisted overrides into the defaults, and compute the right-anchored
 * default for the Properties panel if no persisted position exists for it.
 * Runs once at hook init.
 */
function resolveInitialWindows(): WindowDef[] {
  const persisted = windowsStore.load()
  return INITIAL_WINDOWS.map((w) => {
    const p = persisted[w.id]
    if (p) {
      const merged: WindowDef = { ...w, pos: p.pos, open: p.open }
      if (p.size) {
        merged.width = p.size.width
        merged.height = p.size.height
      }
      return merged
    }
    if (w.kind === 'props' && typeof window !== 'undefined') {
      return { ...w, pos: { x: window.innerWidth - w.width - 24, y: 24 } }
    }
    return w
  })
}

/**
 * Pull a window back on-screen if its (persisted) position leaves it **>90%
 * off-screen** — e.g. saved on a since-disconnected larger monitor. Returns the
 * current position unchanged when ≥10% of the window is visible. Otherwise clamps
 * the top-left into the viewport (small margin; keeps the title bar reachable).
 * Auto-height bodies use a height estimate just to judge visibility.
 */
function onscreenPos(w: WindowDef): { x: number; y: number } {
  if (typeof window === 'undefined') return w.pos
  const W = window.innerWidth
  const H = window.innerHeight
  const ww = w.width
  const wh = w.height ?? 200
  const visX = Math.max(0, Math.min(w.pos.x + ww, W) - Math.max(w.pos.x, 0))
  const visY = Math.max(0, Math.min(w.pos.y + wh, H) - Math.max(w.pos.y, 0))
  if (ww > 0 && wh > 0 && (visX * visY) / (ww * wh) >= 0.1) return w.pos
  const margin = 8
  return {
    x: Math.max(margin, Math.min(w.pos.x, W - ww - margin)),
    y: Math.max(margin, Math.min(w.pos.y, H - 40))
  }
}

export interface FloatingWindowsApi {
  windows: WindowDef[]
  focusWindow: (id: string) => void
  closeWindow: (id: string) => void
  openWindow: (kind: WindowDef['kind']) => void
  commitWindowPos: (id: string, pos: { x: number; y: number }) => void
  commitWindowSize: (id: string, size: { width: number; height: number }) => void
}

/**
 * Owns the floating tool windows: their positions/sizes/open state, z-ordering,
 * and localStorage persistence. The `z` of a focused/opened window is derived
 * from the current max so two focus calls in one tick can't collide on the same
 * value (the old separate zCounter read its value from a stale closure).
 */
export function useFloatingWindows(): FloatingWindowsApi {
  const [windows, setWindows] = useState<WindowDef[]>(resolveInitialWindows)

  // Persist on every windows change. Cheap (single localStorage write).
  useEffect(() => {
    persistWindows(windows)
  }, [windows])

  const focusWindow = useCallback((id: string) => {
    setWindows((ws) => {
      const nextZ = ws.reduce((m, w) => Math.max(m, w.z), 0) + 1
      return ws.map((w) => (w.id === id ? { ...w, z: nextZ } : w))
    })
  }, [])

  const closeWindow = useCallback((id: string) => {
    setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, open: false } : w)))
  }, [])

  const commitWindowPos = useCallback(
    (id: string, pos: { x: number; y: number }) => {
      setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, pos } : w)))
    },
    []
  )

  const commitWindowSize = useCallback(
    (id: string, size: { width: number; height: number }) => {
      setWindows((ws) =>
        ws.map((w) =>
          w.id === id ? { ...w, width: size.width, height: size.height } : w
        )
      )
    },
    []
  )

  const openWindow = useCallback((kind: WindowDef['kind']) => {
    setWindows((ws) => {
      const nextZ = ws.reduce((m, w) => Math.max(m, w.z), 0) + 1
      // On open, reset a position that's drifted >90% off-screen back into view.
      return ws.map((w) =>
        w.kind === kind ? { ...w, open: true, z: nextZ, pos: onscreenPos(w) } : w
      )
    })
  }, [])

  return {
    windows,
    focusWindow,
    closeWindow,
    openWindow,
    commitWindowPos,
    commitWindowSize
  }
}
