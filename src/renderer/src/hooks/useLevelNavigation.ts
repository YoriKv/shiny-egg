import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { FindInstanceKind } from '../../../preload/api'
import { INITIAL_VIEW, type View } from '../canvas/view'
import { useNavHistory, type NavEntry } from './useNavHistory'
import { formatLevelId, getAllLevels, getLevel, isRemovedRecord } from '../data/levels'
import { findOwningTranslevel } from '../lib/warp-graph'

/** Refusal message when a navigation targets a removed record (shared by the
 *  forward guard in navigateTo and the back/forward guard in applyNavEntry). */
const removedRoomNotice = (id: number): string =>
  `Room ${formatLevelId(id)} was removed — restore it in Level Banks to open it.`

/** Camera-focus request for the object finder (Canvas re-focuses on nonce bump). */
export interface FocusRequest {
  levelRecordId: number
  x: number
  y: number
  zoom?: number
  /** When set, App selects the matching object/sprite once the level has loaded
   *  (so the finder jump lands on the entity with its Properties shown). The
   *  kind+id disambiguate; the cell is pinned by the `x`/`y` above. */
  select?: { kind: FindInstanceKind; id: number }
  nonce: number
}

/** Camera restore request for back/forward (Canvas applies the saved view). */
export interface CameraRequest {
  levelRecordId: number
  view: View
  nonce: number
}

export interface LevelNavigationParams {
  /** Whether the loaded level has unsaved edits (gates the discard-changes modal). */
  dirty: boolean
  /** Persist the current level — used by the discard modal's Save. */
  saveCurrent: () => Promise<boolean>
  /** The currently loaded record — lets `focusCell` pan in place (camera-only,
   *  no nav record / discard prompt) instead of a full jump. */
  selectedLevelRecordId: number | null
  setSelectedLevelRecordId: Dispatch<SetStateAction<number | null>>
  setRootLevelRecordId: Dispatch<SetStateAction<number | null>>
}

export interface LevelNavigationApi {
  /** Forward-navigation entry point: record history + set the level ids. Returns
   *  false (and navigates nowhere) if `selected` is a removed record. */
  navigateTo: (root: number | null, selected: number | null) => boolean
  /** Run `action` now, or hold it behind the discard modal when the level is dirty. */
  requestNav: (action: () => void) => void
  /** Main-dropdown / "Go to room": anchor the owning translevel + load the record. */
  selectRootLevel: (id: number) => void
  /** Object-finder jump: anchor owner, load level, focus the cell, and (when
   *  `select` is given) select the matching entity once it loads. */
  jumpToInstance: (
    inst: { levelRecordId: number; x: number; y: number },
    select?: { kind: FindInstanceKind; id: number }
  ) => void
  onBack: () => void
  onForward: () => void
  canBack: boolean
  canForward: boolean
  /** Camera-only pan for the loaded level; full jump for any other. */
  focusCell: (levelRecordId: number, x: number, y: number, zoom?: number) => void
  /** Clear the level selection + nav trail (on a project switch). */
  clearLevelSelection: () => void
  /** True while a reverse parent-search is in flight (drives a "finding parent…" hint). */
  resolvingRoot: boolean
  /** Transient message when a navigation was refused because the target record
   *  is removed (auto-clears; `dismissNavNotice` clears it early). Null = none. */
  navNotice: string | null
  dismissNavNotice: () => void
  /** Live-view mirror written by Canvas; read on navigate-away to snapshot the camera. */
  cameraRef: RefObject<View>
  focusReq: FocusRequest | null
  cameraReq: CameraRequest | null
  // Discard-changes modal state + handlers.
  pendingNav: (() => void) | null
  navSaving: boolean
  navError: string | null
  onNavSave: () => Promise<void>
  onNavDiscard: () => void
  onNavCancel: () => void
}

/**
 * Level navigation controller: the forward entry points (dropdown pick, sub-room
 * select, object-finder jump) and back/forward history, the unsaved-changes
 * discard modal that gates every level switch, the reverse parent-resolution for
 * directly-opened sub-rooms, and the camera/focus request channel into Canvas.
 *
 * The two central record-id states stay in App (read across the whole tree and
 * needed before this hook in the render order); this hook receives their setters
 * and owns everything else navigation-related.
 */
export function useLevelNavigation({
  dirty,
  saveCurrent,
  selectedLevelRecordId,
  setSelectedLevelRecordId,
  setRootLevelRecordId
}: LevelNavigationParams): LevelNavigationApi {
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null)
  const [navSaving, setNavSaving] = useState(false)
  const [navError, setNavError] = useState<string | null>(null)
  // Removed-record refusal notice (auto-clears). Set by the central guard in
  // navigateTo and the back/forward guard in applyNavEntry; App surfaces it as a
  // toolbar hint. Declared up here so applyNavEntry (defined below) can set it.
  const [navNotice, setNavNotice] = useState<string | null>(null)
  const dismissNavNotice = useCallback(() => setNavNotice(null), [])
  useEffect(() => {
    if (navNotice === null) return
    const t = window.setTimeout(() => setNavNotice(null), 6000)
    return () => window.clearTimeout(t)
  }, [navNotice])
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const selectedRef = useRef(selectedLevelRecordId)
  selectedRef.current = selectedLevelRecordId
  // Camera-focus request for the debug object finder: bump the nonce so Canvas
  // re-focuses even when re-jumping to the same cell.
  const [focusReq, setFocusReq] = useState<FocusRequest | null>(null)
  const focusNonceRef = useRef(0)
  // Navigation history (back/forward). The camera lives in Canvas; it mirrors the
  // live view into `cameraRef` (snapshot-on-navigate-away) and honours
  // `cameraReq` (restore on back/forward). See hooks/useNavHistory.
  const cameraRef = useRef<View>(INITIAL_VIEW)
  const [cameraReq, setCameraReq] = useState<CameraRequest | null>(null)
  const cameraNonceRef = useRef(0)
  const readCamera = useCallback((): View => cameraRef.current, [])
  const applyNavEntry = useCallback((e: NavEntry) => {
    // A history entry can point at a level removed after it was recorded — refuse
    // it like any forward nav (the index still advanced; pressing again skips on).
    if (e.selectedLevelRecordId != null && isRemovedRecord(e.selectedLevelRecordId)) {
      setNavNotice(removedRoomNotice(e.selectedLevelRecordId))
      return
    }
    setNavNotice(null)
    setRootLevelRecordId(e.rootLevelRecordId)
    setSelectedLevelRecordId(e.selectedLevelRecordId)
    if (e.selectedLevelRecordId != null) {
      setCameraReq({ levelRecordId: e.selectedLevelRecordId, view: e.view, nonce: ++cameraNonceRef.current })
    }
  }, [setRootLevelRecordId, setSelectedLevelRecordId])
  const nav = useNavHistory({ readCamera, applyEntry: applyNavEntry })
  // Run `action` now, or hold it behind the discard-changes modal when the level
  // has unsaved edits.
  const requestNav = useCallback((action: () => void) => {
    if (dirtyRef.current) {
      setNavError(null)
      setPendingNav(() => action)
    } else {
      action()
    }
  }, [])

  // Discard-changes modal handlers (held navigation in `pendingNav`). Save
  // persists the level first, then runs the navigation; Discard runs it straight
  // away (the level reload drops the edits); Cancel keeps the user put.
  const onNavCancel = useCallback(() => {
    setPendingNav(null)
    setNavError(null)
  }, [])
  const onNavDiscard = useCallback(() => {
    const action = pendingNav
    setPendingNav(null)
    setNavError(null)
    action?.()
  }, [pendingNav])
  const onNavSave = useCallback(async () => {
    if (!pendingNav || navSaving) return
    setNavSaving(true)
    const ok = await saveCurrent()
    setNavSaving(false)
    if (ok) {
      const action = pendingNav
      setPendingNav(null)
      action?.()
    } else {
      setNavError('Save failed — your changes were not switched.')
    }
  }, [pendingNav, navSaving, saveCurrent])

  // Single forward-navigation entry point: record the move in history (which
  // snapshots the camera we're leaving), then set the level ids. Every user-
  // initiated level switch routes through this so history capture lives in one
  // place. NOT used by back/forward restore (that sets ids directly).
  //
  // This is also the ONE place that refuses to OPEN a removed record: removed
  // levels are dropped from the ROM at the next build, so editing one would be
  // silently discarded. Guarding here covers every forward entry point at once —
  // the Go-to-room field, the sub-room dropdown, the object finder, warp-exit
  // double-clicks, the warp-network panel, and Banks jumps. (Back/forward and
  // project-switch clears don't route through here, by design.)
  const navigateTo = useCallback(
    (root: number | null, selected: number | null): boolean => {
      if (selected != null && isRemovedRecord(selected)) {
        setNavNotice(removedRoomNotice(selected))
        return false
      }
      setNavNotice(null)
      nav.record(root, selected)
      setRootLevelRecordId(root)
      setSelectedLevelRecordId(selected)
      return true
    },
    [nav, setRootLevelRecordId, setSelectedLevelRecordId]
  )

  // Resolve the discovery anchor (root) for a record the user opened directly.
  // A catalog translevel anchors itself; a sub-room re-anchors on the catalog
  // level that OWNS it (whose warp graph reaches it / whose SubLevelMenu lists
  // it), found by reverse search — so "Go to room 0x4A" lands you under 3-1
  // rather than making 0x4A its own degenerate root. Falls back to the record
  // itself for true orphans (no owning translevel). Async: the reverse search
  // loads sibling rooms' exits over IPC.
  const resolveAnchorRoot = useCallback(async (id: number): Promise<number> => {
    if (getLevel(id)?.translevelId != null) return id
    const roots = getAllLevels()
      .map((l) => (l.translevelId != null ? l.recordId : null))
      .filter((r): r is number => r != null)
    const owner = await findOwningTranslevel(id, roots, { shouldExpand: (x) => !getLevel(x) })
    return owner ?? id
  }, [])

  // True while resolveAnchorRoot's reverse search is in flight (Go-to-room /
  // object-finder jump into a sub-room) — drives a small "finding parent…" hint.
  const [resolvingRoot, setResolvingRoot] = useState(false)

  // Main-dropdown pick / "Go to room": anchor the owning translevel root AND
  // load the chosen record. Catalog levels take the fast path (no search);
  // sub-rooms reverse-resolve their parent first. Distinct from sub-level
  // navigation (which only moves selectedLevelRecordId).
  const selectRootLevel = useCallback(
    (id: number) => {
      requestNav(() => {
        if (getLevel(id)?.translevelId != null) {
          navigateTo(id, id)
          return
        }
        setResolvingRoot(true)
        void resolveAnchorRoot(id)
          .then((root) => navigateTo(root, id))
          .finally(() => setResolvingRoot(false))
      })
    },
    [requestNav, navigateTo, resolveAnchorRoot]
  )

  // Debug object-finder jump: anchor the instance's OWNING translevel as root
  // (so discovery works), load its level, and focus its cell. Guarded like any
  // nav; reverse-resolves the parent for sub-room instances.
  const jumpToInstance = useCallback(
    (
      inst: { levelRecordId: number; x: number; y: number; zoom?: number },
      select?: { kind: FindInstanceKind; id: number }
    ) => {
      requestNav(() => {
        const focus = (root: number): void => {
          // Refused (removed record) ⇒ don't issue a focus for a level that
          // won't load (it would strand a pending-focus in Canvas).
          if (!navigateTo(root, inst.levelRecordId)) return
          setFocusReq({
            levelRecordId: inst.levelRecordId,
            x: inst.x,
            y: inst.y,
            // Default: zoom in 2× more than the standard jump (which holds zoom
            // at 1) so a located object is easy to pick out. Callers that pan
            // for orientation rather than inspection (focusCell) override it.
            zoom: inst.zoom ?? 2,
            select,
            nonce: ++focusNonceRef.current
          })
        }
        if (getLevel(inst.levelRecordId)?.translevelId != null) {
          focus(inst.levelRecordId)
          return
        }
        setResolvingRoot(true)
        void resolveAnchorRoot(inst.levelRecordId)
          .then(focus)
          .finally(() => setResolvingRoot(false))
      })
    },
    [requestNav, navigateTo, resolveAnchorRoot]
  )

  // Back/forward navigation (toolbar buttons · mouse thumb buttons · Alt+←/→).
  // Guarded like any level switch — a dirty level prompts the discard modal.
  const onBack = useCallback(() => requestNav(() => nav.back()), [requestNav, nav])
  const onForward = useCallback(() => requestNav(() => nav.forward()), [requestNav, nav])

  // Mouse thumb buttons (back=3 / forward=4) + Alt+←/→. preventDefault so the
  // browser/OS doesn't also navigate. Works regardless of focus.
  useEffect(() => {
    const onMouse = (e: MouseEvent): void => {
      if (e.button === 3) { e.preventDefault(); onBack() }
      else if (e.button === 4) { e.preventDefault(); onForward() }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); onBack() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); onForward() }
    }
    window.addEventListener('mousedown', onMouse)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onMouse)
      window.removeEventListener('keydown', onKey)
    }
  }, [onBack, onForward])

  // Project switch: drop the level selection so the canvas falls back to "pick a
  // level", and clear the nav trail (it belonged to the old project).
  const clearLevelSelection = useCallback(() => {
    setRootLevelRecordId(null)
    setSelectedLevelRecordId(null)
    nav.clear()
  }, [nav, setRootLevelRecordId, setSelectedLevelRecordId])

  /** Pan/zoom to a cell. Same level ⇒ camera-only (no history entry, no
   *  unsaved-changes prompt — Canvas pans in place via focusReq); another
   *  level ⇒ the full nav-recorded, dirty-guarded `jumpToInstance`. The warp-
   *  network panel's click-to-scroll. Both paths land at the SAME zoom
   *  (default 1 — orientation pans, not the finder's 2× inspection zoom). */
  const focusCell = useCallback(
    (levelRecordId: number, x: number, y: number, zoom = 1) => {
      if (levelRecordId === selectedRef.current) {
        setFocusReq({ levelRecordId, x, y, zoom, nonce: ++focusNonceRef.current })
        return
      }
      jumpToInstance({ levelRecordId, x, y, zoom })
    },
    [jumpToInstance]
  )

  return {
    navigateTo,
    requestNav,
    selectRootLevel,
    jumpToInstance,
    focusCell,
    onBack,
    onForward,
    canBack: nav.canBack,
    canForward: nav.canForward,
    clearLevelSelection,
    resolvingRoot,
    navNotice,
    dismissNavNotice,
    cameraRef,
    focusReq,
    cameraReq,
    pendingNav,
    navSaving,
    navError,
    onNavSave,
    onNavDiscard,
    onNavCancel
  }
}
