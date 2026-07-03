import { useCallback, useEffect, useState } from 'react'
import { persistedState } from '../lib/persisted-state'

/** Where a window's *default* position anchors when no persisted position
 *  exists — resolved against the stage in `defaultPos`. A persisted position
 *  (saved the first time the window is shown) always wins, so this only governs
 *  a window's very first appearance on a fresh layout. */
export type WindowAnchor = 'top-right' | 'bottom-right' | 'top-center'

export interface WindowDef {
  id: string
  title: string
  pos: { x: number; y: number }
  width: number
  /** Optional pixel height. Undefined = auto-size (body content drives). */
  height?: number
  z: number
  open: boolean
  /** Anchor for the default (no-persisted) start position — see WindowAnchor. */
  anchor: WindowAnchor
  /** Extra pixels the default position sits BELOW the anchor-derived Y
   *  (e.g. Properties hangs 36px under the top-right corner). */
  anchorOffsetY?: number
  /** Bumped by `resetWindow` so a MOUNTED FloatingWindow re-syncs its local
   *  drag/resize state to the reset pos/size (children stay mounted — no
   *  remount). Session-only; never persisted. */
  resetRev?: number
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
    | 'graphics'
    | 'paint'
    | 'exits'
    | 'validation'
}

// Start positions are driven by each window's `anchor` (resolved against the
// stage in `defaultPos`), not the `pos` below — `pos` is only a fallback for
// headless/no-`window` contexts. Every panel except Properties and Find opens
// at least 600px wide (a shared minimum for legibility); heights are tuned to
// content. The user resizes from there.
const INITIAL_WINDOWS: WindowDef[] = [
  {
    id: 'tiles',
    title: 'Tiles',
    pos: { x: 24, y: 24 },
    // Map16 gallery is 256×256 source pixels; the shared 600px minimum shows
    // it at ~2.3×. User can drag the SE corner to resize.
    width: 600,
    height: 580,
    z: 1,
    // Closed by default; reopen from the toolbar. Properties is the only
    // panel shown on a fresh launch.
    open: false,
    anchor: 'top-center',
    kind: 'tiles'
  },
  {
    id: 'palette',
    title: 'Palette',
    pos: { x: 24, y: 24 },
    width: 400,
    z: 1,
    // Closed by default; reopen from the toolbar.
    open: false,
    anchor: 'top-center',
    kind: 'palette'
  },
  {
    id: 'props',
    title: 'Properties',
    // Anchored to the top-right corner, dropped 36px below it (see `anchor` /
    // `anchorOffsetY` / `defaultPos`).
    pos: { x: 24, y: 24 },
    width: 300,
    z: 2,
    open: true,
    anchor: 'top-right',
    anchorOffsetY: 36,
    kind: 'props'
  },
  {
    id: 'header',
    title: 'Level Header',
    // Level-wide header fields — closed by default; reopen from the toolbar.
    // Auto-height (the fields lay out two-up per section, so ~8 rows).
    // Width holds two [label value] pairs side by side (see se-props__list--2col).
    pos: { x: 320, y: 80 },
    width: 600,
    z: 8,
    open: false,
    anchor: 'top-center',
    kind: 'header'
  },
  {
    id: 'strings',
    title: 'Strings',
    // Secondary tool — closed by default; reopen from the toolbar (grouped with
    // Tiles/Palette). Tall enough to show the level-name list.
    pos: { x: 600, y: 24 },
    width: 600,
    height: 560,
    z: 3,
    open: false,
    anchor: 'top-center',
    kind: 'strings'
  },
  {
    id: 'world-map',
    title: 'World Map',
    // World-map entrance editor — spawn / progression per slot. Closed by
    // default; reopen from the toolbar. Tall enough for the per-world slot list.
    pos: { x: 640, y: 48 },
    width: 600,
    height: 580,
    z: 3,
    open: false,
    anchor: 'top-center',
    kind: 'world-map'
  },
  {
    id: 'picker',
    title: 'Place',
    pos: { x: 620, y: 600 },
    width: 600,
    height: 420,
    z: 4,
    open: false,
    anchor: 'top-center',
    kind: 'picker'
  },
  {
    id: 'exits',
    title: 'Exits Map',
    // Screen-exit minimap + the root cluster's warp network (§B2). Closed by
    // default; reopen from the toolbar. Sized for the 16×8 grid + a few rooms.
    pos: { x: 660, y: 72 },
    width: 600,
    height: 520,
    z: 3,
    open: false,
    anchor: 'top-center',
    kind: 'exits'
  },
  {
    id: 'finder',
    title: 'Find object',
    pos: { x: 660, y: 640 },
    width: 300,
    z: 5,
    open: false,
    anchor: 'bottom-right',
    kind: 'finder'
  },
  {
    id: 'patches',
    title: 'Patches',
    pos: { x: 700, y: 60 },
    width: 600,
    height: 520,
    z: 6,
    open: false,
    anchor: 'top-center',
    kind: 'patches'
  },
  {
    id: 'banks',
    title: 'Level Banks',
    // Read-only byte-budget overview — closed by default; reopen from the
    // toolbar. Tall + scrollable: one section per level-data bank pool.
    pos: { x: 740, y: 100 },
    width: 600,
    height: 540,
    z: 7,
    open: false,
    anchor: 'top-center',
    kind: 'banks'
  },
  {
    id: 'validation',
    title: 'Validation',
    // Static playability lints — closed by default; reopen from the toolbar.
    pos: { x: 780, y: 140 },
    width: 560,
    height: 520,
    z: 8,
    open: false,
    anchor: 'top-center',
    kind: 'validation'
  },
  {
    id: 'graphics',
    title: 'Graphics',
    // PNG export/import for external editing — closed by default; reopen from
    // the toolbar.
    pos: { x: 760, y: 120 },
    width: 600,
    // A default height (not auto-size) so the body's overflow scrolls instead of
    // the whole window growing when the log / changed-graphics list gets long.
    height: 560,
    z: 8,
    open: false,
    anchor: 'top-center',
    kind: 'graphics'
  },
  // Paint Surface window — hidden from the UI for now (kept for later). Body is
  // panels/PaintPanel.tsx, rendered by App.tsx's w.kind === 'paint' branch. The
  // 'paint' member stays in WindowDef.kind above so that branch still type-checks.
  // Uncomment to re-enable (with the App.tsx TOOLS + PANEL_TOGGLES 'paint' entries).
  // {
  //   id: 'paint',
  //   title: 'Paint Surface',
  //   pos: { x: 620, y: 560 },
  //   width: 600,
  //   z: 7,
  //   open: false,
  //   anchor: 'top-center',
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

/** Margin from the stage edges for anchored (top-right / bottom-right) and
 *  clamped windows. */
const EDGE_MARGIN = 12

/** The auto-height Find panel renders at a near-constant height (counter +
 *  current line — no result list), so a fixed estimate is enough to anchor its
 *  bottom edge near the stage bottom. */
const FINDER_HEIGHT_ESTIMATE = 160

/**
 * Usable bounds for floating windows. Their positioned ancestor (offsetParent)
 * is `.se-stage`, which sits BELOW the toolbar in the app's `auto 1fr` grid, so
 * window coordinates are stage-relative — and the stage is shorter than the
 * viewport by the toolbar's height. Measuring the stage (instead of
 * `window.innerHeight`) is what keeps a bottom-anchored window's bottom edge on
 * the stage rather than the toolbar's height below it. Falls back to the
 * viewport before the stage is mounted (the first render).
 */
function stageBounds(): { width: number; height: number } {
  if (typeof document !== 'undefined') {
    const stage = document.querySelector('.se-stage')
    if (stage) {
      const r = stage.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) return { width: r.width, height: r.height }
    }
  }
  return {
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 720
  }
}

/**
 * Compute a window's default start position from the stage (the windows'
 * positioned ancestor) per its `anchor`: Properties hugs the top-right, Find
 * the bottom-right, everything else is horizontally centered at the stage top
 * (EDGE_MARGIN below the canvas's top edge). Falls back to the template `pos`
 * when there's no `window` (headless test contexts). Used when no persisted
 * position exists for the window, and by resetWindow.
 */
function defaultPos(w: WindowDef): { x: number; y: number } {
  if (typeof window === 'undefined') return w.pos
  const { width: W, height: H } = stageBounds()
  const right = Math.max(EDGE_MARGIN, W - w.width - EDGE_MARGIN)
  const dy = w.anchorOffsetY ?? 0 // per-window extra drop below the anchor
  switch (w.anchor) {
    case 'top-right':
      return { x: right, y: EDGE_MARGIN + dy }
    case 'bottom-right': {
      const h = w.height ?? FINDER_HEIGHT_ESTIMATE
      return { x: right, y: Math.max(EDGE_MARGIN, H - h - EDGE_MARGIN) + dy }
    }
    case 'top-center':
    default:
      return {
        x: Math.max(EDGE_MARGIN, Math.round((W - w.width) / 2)),
        y: EDGE_MARGIN + dy
      }
  }
}

/**
 * Merge persisted overrides into the defaults. When a window has no persisted
 * position (fresh layout), its start position is derived from its `anchor`
 * against the stage (`defaultPos`). Runs once at hook init.
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
    return { ...w, pos: defaultPos(w) }
  })
}

/**
 * Clamp a window fully within the stage when it's (re)opened. Window
 * coordinates are stage-relative (see stageBounds), so clamping against the
 * viewport would be off by the toolbar's height. A window already inside the
 * stage is returned unchanged; one left off an edge — saved on a
 * since-disconnected larger monitor, or pushed below the stage — is pulled back
 * so its whole frame (title bar + body) is reachable. This is also what brings
 * a bottom-anchored Find panel up to the stage bottom on open. Auto-height
 * bodies use a height estimate.
 */
function onscreenPos(w: WindowDef): { x: number; y: number } {
  if (typeof window === 'undefined') return w.pos
  const { width: W, height: H } = stageBounds()
  const ww = w.width
  const wh = w.height ?? FINDER_HEIGHT_ESTIMATE
  const x = Math.min(Math.max(w.pos.x, EDGE_MARGIN), Math.max(EDGE_MARGIN, W - ww - EDGE_MARGIN))
  const y = Math.min(Math.max(w.pos.y, EDGE_MARGIN), Math.max(EDGE_MARGIN, H - wh - EDGE_MARGIN))
  return x === w.pos.x && y === w.pos.y ? w.pos : { x, y }
}

export interface FloatingWindowsApi {
  windows: WindowDef[]
  focusWindow: (id: string) => void
  closeWindow: (id: string) => void
  openWindow: (kind: WindowDef['kind']) => void
  commitWindowPos: (id: string, pos: { x: number; y: number }) => void
  commitWindowSize: (id: string, size: { width: number; height: number }) => void
  /** Restore a window's default position + size (the "Reset Size & Position"
   *  context-menu action on panel buttons and window bars). */
  resetWindow: (id: string) => void
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

  const resetWindow = useCallback((id: string) => {
    setWindows((ws) =>
      ws.map((w) => {
        if (w.id !== id) return w
        const t = INITIAL_WINDOWS.find((tw) => tw.id === id)
        if (!t) return w
        // Back to the template defaults: the anchor-derived start position
        // (resolved against the CURRENT stage size) + the template width/height
        // (height undefined = auto-size again). Open/z state is untouched;
        // persistence follows via the windows effect, so a closed panel's reset
        // sticks for its next open too. resetRev tells a mounted FloatingWindow
        // to re-sync (see WindowDef.resetRev).
        return {
          ...w,
          pos: defaultPos(t),
          width: t.width,
          height: t.height,
          resetRev: (w.resetRev ?? 0) + 1
        }
      })
    )
  }, [])

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
    commitWindowSize,
    resetWindow
  }
}
