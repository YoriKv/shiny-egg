import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type JSX } from 'react'
import type {
  BgRegionRect,
  ExtractFreshness,
  ExtractionState,
  FindInstanceKind,
  LevelData,
  LevelObject,
  LevelSprite,
  OverlayDriftReport,
  ProjectBackupResult,
  ProjectSummary,
  TestInventory
} from '../../preload/api'
import { Canvas } from './Canvas'
import {
  INITIAL_LEVEL_STATE,
  isDirty,
  levelReducer
} from './canvas/level-reducer'
import { objectSizeMode } from './data/object-record'
import { useObjectPropertyTable } from './hooks/useObjectPropertyTable'
import { useLevelKeyboardShortcuts } from './hooks/useLevelKeyboardShortcuts'
import { BlockerBar } from './BlockerBar'
import { isBlocked, gates, poolSummary, type Blocker } from './lib/level-blockers'
import { useLevelBlockers } from './hooks/useLevelBlockers'
import { LevelMenu } from './LevelMenu'
import { SubLevelMenu } from './SubLevelMenu'
import { RomMenu } from './RomMenu'
import { BizHawkMenu, clampInventory } from './BizHawkMenu'
import { PanelGroupMenu } from './PanelGroupMenu'
import { ProjectMenu } from './ProjectMenu'
import { useEditDocument, useEditSession } from './edit-session/EditSession'
import type { DocHistory } from './edit-session/useOverlayDocument'
import { DiscardChangesModal } from './DiscardChangesModal'
import { OverlayUpgradeModal } from './OverlayUpgradeModal'
import { FloatingWindow } from './FloatingWindow'
import { panelHelp } from './panel-help'
import { LayerToggles } from './toolbar/LayerToggles'
import { PropertiesBody } from './panels/PropertiesPanel'
import { HeaderBody } from './panels/HeaderPanel'
import { PaletteBody } from './panels/PalettePanel'
import { usePaletteEditor } from './edit-session/usePaletteEditor'
import { TilesBody } from './panels/TilesPanel'
import { StringsBody, useMessagePtrTableEditor, useStringsEditor } from './panels/StringsPanel'
import { useWorldMapEditor } from './edit-session/useWorldMapEditor'
import { WorldMapBody } from './panels/WorldMapPanel'
import { PickerBody } from './panels/PickerPanel'
import { ExitsBody } from './panels/ExitsPanel'
import { PaintBody } from './panels/PaintPanel'
import { usePaintTool } from './hooks/usePaintTool'
import { ObjectFinderBody } from './panels/ObjectFinderBody'
import { BanksBody } from './panels/BanksPanel'
import { GraphicsBody } from './panels/GraphicsPanel'
import { PatchesBody } from './panels/PatchesBody'
import { useSubLevelBFS } from './hooks/useSubLevelBFS'
import { useFloatingWindows, type WindowDef } from './hooks/useFloatingWindows'
import { useLevelTileUsage } from './hooks/useLevelTileUsage'
import { influenceBlockIds, useSelectedObjectInfluence } from './hooks/useSelectedObjectInfluence'
import { useUnifiedHistory } from './hooks/useUnifiedHistory'
import { useEmulatorActions } from './hooks/useEmulatorActions'
import { useLevelNavigation } from './hooks/useLevelNavigation'
import { getAllLevels, refreshLevelsCatalog, useLevelsCatalog } from './data/levels'
import { persistedState } from './lib/persisted-state'
import type { IncomingExit, LayerVisibility, PlacementItem, Selection } from './types'
import { nextGridMode } from './types'

type Operation = 'extract' | 'build' | null

interface ToolDef {
  id: string
  label: string
  hotkey: string
  path: string
  /** Extra tooltip text appended after the hotkey (e.g. multi-select hints). */
  hint?: string
}

// A small, recognizable tool set. More tools can be added when they're real.
const TOOLS: ToolDef[] = [
  {
    id: 'select',
    label: 'Select',
    hotkey: 'Q',
    path: 'M3 2 L3 13 L6.5 10 L8 14 L9.5 13 L8 9.5 L12 9 Z',
    hint: 'Shift-drag a box or Shift-click to multi-select'
  },
  {
    id: 'place',
    label: 'Place',
    hotkey: 'W',
    path: 'M3 13 L11 5 L13 7 L5 15 Z M9 3 L11 5'
  },
  // Paint tool — hidden from the UI for now (kept for later). The
  // implementation is left intact: canvas/draw/paint.ts, panels/PaintPanel.tsx,
  // the on*Paint*/refitPaint handlers + paint* state below, the Canvas paint
  // props/logic, and the w.kind === 'paint' render branch. To re-enable, also
  // uncomment the 'paint' PANEL_TOGGLES entry and the 'paint' INITIAL_WINDOWS
  // entry in useFloatingWindows.ts.
  // {
  //   id: 'paint',
  //   label: 'Paint Surface',
  //   hotkey: 'T',
  //   // A stepped surface line under a brush — the height-painting tool.
  //   path: 'M2 14 L5 14 L5 11 L9 11 L9 8 L13 8 M11 2 L14 5 L9 10',
  //   hint: 'Drag to paint cell-corner heights; Shift-drag to erase'
  // },
  {
    id: 'erase',
    label: 'Erase',
    hotkey: 'E',
    path: 'M4 14 L14 14 M4 12 L11 5 L14 8 L7 15 L4 12'
  },
  {
    id: 'spawn',
    label: 'Set Spawn (Test Level)',
    hotkey: 'R / Middle Click',
    // Abstract Yoshi egg (outline + two spot rings) — matches the egg marker
    // drawn on the canvas by drawTestSpawnGlyph.
    path:
      'M8 2 C11 2 12.6 5.5 12.6 9 C12.6 12.4 10.5 14 8 14 C5.5 14 3.4 12.4 3.4 9 C3.4 5.5 5 2 8 2 Z ' +
      'M6.3 6.6 m -1.4 0 a 1.4 1.4 0 1 0 2.8 0 a 1.4 1.4 0 1 0 -2.8 0 ' +
      'M9.6 10 m -1.7 0 a 1.7 1.7 0 1 0 3.4 0 a 1.7 1.7 0 1 0 -3.4 0'
  }
]

// Single-key tool shortcuts (lower-cased) → tool id, derived from TOOLS so the
// tooltip and the keyboard handler can never drift apart.
const TOOL_HOTKEYS: Record<string, string> = Object.fromEntries(
  TOOLS.map((t) => [t.hotkey.toLowerCase(), t.id])
)

// ── Layer visibility ──────────────────────────────────────────────────────

const DEFAULT_LAYERS: LayerVisibility = {
  bg1: true,
  bg2: true,
  bg3: true,
  // Backdrop default on — was implicitly bundled with bg3 before this
  // split. persistedState's shallow merge picks up the default for
  // existing v2 storage payloads that pre-date the field.
  backdrop: true,
  sprites: true,
  exits: true,
  // Collision overlay defaults off — it's a debug / level-design aid, not
  // part of the level's visual identity. Power users toggle it via the
  // layers panel; the default-off keeps the editor's first-launch screen
  // looking clean.
  collision: false,
  // Object outlines default on — they were previously bundled into `bg1`
  // so existing users expect them visible by default. persistedState's
  // shallow merge with defaults means storage payloads from before this
  // field existed pick up the `true` default automatically.
  bg1Outlines: true,
  // Sprite outlines default on — the sprite analog of `bg1Outlines`. The
  // shallow merge with defaults means existing v2 storage payloads (which
  // pre-date this field) pick up the `true` default automatically, so no
  // version bump is needed.
  spriteOutlines: true,
  // Background grid defaults to its lightest mode (per-screen lines) —
  // preserves the previous always-drawn screen grid. `grid` is a 3-state
  // GridMode now ('off' | 'screen' | 'tile'), so the storage key is bumped to
  // v3: a pre-existing boolean `grid: true` from a v2 payload would otherwise
  // shallow-merge in and break the off/screen/tile comparisons.
  grid: 'screen'
}

// v3 bumped from v2 when `grid` went boolean → 3-state GridMode (v2 itself
// bumped from v1 when foreground/background split into bg1/bg2/bg3).
const layersStore = persistedState<LayerVisibility>(
  'shinyEgg.layers.v3',
  DEFAULT_LAYERS
)

// Test Level inventory (the eggs/keys steppers by the Test Level button) —
// which items Yoshi enters the level holding. Persisted so the choice sticks
// across sessions; defaults to a vanilla empty-handed boot. v2 bumped from v1
// when the 'none'|'all-eggs'|'eggs-and-key' preset became { eggs, keys } counts.
const testInventoryStore = persistedState<TestInventory>(
  'shinyEgg.testInventory.v2',
  { eggs: 0, keys: 0 }
)

// Panel-toggle buttons (toolbar row 2, right-aligned). Each opens its floating
// window; disabled (grayed) while that window is already open.
const PANEL_TOGGLES = [
  { kind: 'props', label: 'Properties', title: 'Properties' },
  { kind: 'picker', label: 'Place', title: 'Place panel' },
  // { kind: 'paint', label: 'Paint', title: 'Paint surface' }, // hidden — see TOOLS note
  { kind: 'finder', label: 'Find', title: 'Object finder' },
  { kind: 'graphics', label: 'Graphics', title: 'Export/import graphics as PNGs' },
  { kind: 'tiles', label: 'Tiles', title: 'Tiles' },
  { kind: 'palette', label: 'Palette', title: 'Palette' },
  { kind: 'exits', label: 'Exits Map', title: 'Exits map + warp network' },
  { kind: 'header', label: 'Level Header', title: 'Level header' },
  { kind: 'strings', label: 'Strings', title: 'Strings' },
  { kind: 'world-map', label: 'World Map', title: 'World-map entrances' },
  { kind: 'banks', label: 'Level Banks', title: 'Bank byte budgets' },
  { kind: 'patches', label: 'Patches', title: 'Custom patches' }
] as const
type PanelKind = (typeof PANEL_TOGGLES)[number]['kind']
// Panel toggles collapsed behind toolbar "panel group" dropdowns instead of
// inline buttons: the ROM-global panels (cart-wide data, not the loaded level)
// under "Global Panels", and the art panels under "Graphics Panels". Everything
// else stays an inline toggle button.
const GLOBAL_PANEL_KINDS = new Set<string>(['strings', 'world-map', 'banks', 'patches'])
const GRAPHICS_PANEL_KINDS = new Set<string>(['graphics', 'tiles', 'palette'])

// Resolve a finder jump's (kind, id, cell) to the loaded level's matching
// object/sprite as a Selection, by editor-session uid — so the jump can land
// with the entity selected (its Properties shown). Matched by id + cell, the
// same id+position the finder searched and focused; the first hit wins if two
// identical entities are stacked on one cell (rare, and either is fine).
function selectionForFinderJump(
  level: LevelData,
  select: { kind: FindInstanceKind; id: number },
  x: number,
  y: number
): Selection | null {
  if (select.kind === 'sprite') {
    const s = level.sprites.find((sp) => sp.num === select.id && sp.x === x && sp.y === y)
    return s?.uid != null ? { kind: 'sprite', uid: s.uid } : null
  }
  const o = level.objects.find(
    (ob) =>
      ob.x === x &&
      ob.y === y &&
      (select.kind === 'ext' ? ob.num === 0 && ob.exnum === select.id : ob.num === select.id)
  )
  return o?.uid != null ? { kind: 'object', uid: o.uid } : null
}

export default function App(): JSX.Element {
  const [state, setState] = useState<ExtractionState | null>(null)
  // Out-of-date-extract verdict (stale levels.json etc.) — refreshed with the
  // extraction state; RomMenu shows a re-extract prompt when stale.
  const [extractFreshness, setExtractFreshness] = useState<ExtractFreshness | null>(null)
  const [project, setProject] = useState<ProjectSummary | null>(null)
  // Bumped to force every overlay-backed panel to re-read from disk without a
  // project switch — e.g. after a ROM import rewrites the overlay in place.
  const [projectRev, setProjectRev] = useState(0)
  // Outdated-overlay checker: drift found on the active project's launch (null =
  // none / dismissed). Drives the OverlayUpgradeModal.
  const [overlayDrift, setOverlayDrift] = useState<OverlayDriftReport | null>(null)
  const [running, setRunning] = useState<Operation>(null)
  const [log, setLog] = useState<string[]>([])
  const [activeTool, setActiveTool] = useState<string>('select')
  // Graphics "Region" tab → BG1: while `pickingRegion`, a shift-drag marquee on the
  // canvas captures `bg1RegionRect` (the area to export) instead of selecting.
  const [pickingRegion, setPickingRegion] = useState(false)
  const [bg1RegionRect, setBg1RegionRect] = useState<BgRegionRect | null>(null)
  // Per-session Test Level spawn override (the "Set Spawn" tool / middle-click).
  // In CELL coords + the level it was placed in; in-memory only (never saved to
  // the ROM, gone on reload). Tied to a level so it only shows / applies on the
  // level it was set for; setting a new one replaces any prior.
  const [testSpawn, setTestSpawn] = useState<{ levelRecordId: number; x: number; y: number } | null>(
    null
  )
  // Test Level inventory (the eggs/keys steppers) — persisted, applied on the
  // next Test Level boot. Defaults to empty-handed (vanilla behaviour). Clamped
  // on load so a stale/corrupt payload can't exceed the 6-slot egg trail.
  const [testInventory, setTestInventory] = useState<TestInventory>(() =>
    clampInventory(testInventoryStore.load())
  )
  const handleTestInventoryChange = useCallback((inv: TestInventory) => {
    const next = clampInventory(inv)
    setTestInventory(next)
    testInventoryStore.save(next)
  }, [])
  // selectedLevelRecordId = the level currently loaded in the canvas (may change
  // via exit jumps or sub-level dropdown picks). rootLevelRecordId = the user's
  // last main-dropdown pick — anchors the BFS that discovers sub-rooms.
  const [selectedLevelRecordId, setSelectedLevelRecordId] = useState<number | null>(null)
  const [rootLevelRecordId, setRootLevelRecordId] = useState<number | null>(null)
  // Bumped after a successful level save / ROM import so the warp-graph walk
  // re-reads disk (cross-level incoming markers + the Exits panel refresh).
  const [warpGraphRefresh, setWarpGraphRefresh] = useState(0)
  const { subLevels, loading: subLevelsLoading, incomingByLevel, edges: warpEdges } =
    useSubLevelBFS(rootLevelRecordId, warpGraphRefresh)

  // Canvas selection — an ARRAY so a multi-select (objects + sprites) is just a
  // length > 1 selection. Single-entity behaviours (move/resize/arrow-nudge,
  // links, per-entity Properties) act on `primarySelection` (the sole element
  // when exactly one is selected; null while multi); exits/incoming/spawn are
  // always single. Selection is App state — it never feeds the render-layer IPC
  // effects (useLevelRenderLayers keys on LevelData slices), so changing it only
  // repaints the canvas locally, never re-decodes.
  const [selection, setSelection] = useState<Selection[]>([])
  const primarySelection = selection.length === 1 ? selection[0]! : null
  // Cart standard-object property table → each object's resizable axes
  // (`sizeMode`). Used to gate the Shift+Arrow keyboard resize so it never edits
  // a dimension the object doesn't encode. Cached singleton (shared with Canvas);
  // null until fetched → `objectSizeMode` is permissively 'wh' meanwhile.
  const propTable = useObjectPropertyTable()
  // In-memory cut/copy/paste buffer (objects + sprites only). A ref — paste reads
  // it imperatively and nothing renders from it; it survives across levels in a
  // session.
  const clipboardRef = useRef<{ objects: LevelObject[]; sprites: LevelSprite[] } | null>(null)
  // Live canvas viewport pixel size, mirrored by Canvas (like cameraRef). Read
  // imperatively by paste to keep an off-screen target on-screen.
  const viewportRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 })
  // Entity armed in the Add-picker for click-to-place. `placing` (a derived
  // bool passed to Canvas) gates the canvas place gesture.
  const [placement, setPlacement] = useState<PlacementItem | null>(null)
  const {
    windows,
    focusWindow,
    closeWindow,
    openWindow,
    commitWindowPos,
    commitWindowSize
  } = useFloatingWindows()
  const [layers, setLayers] = useState<LayerVisibility>(layersStore.load)
  // Level state lives in App so the Save button (toolbar) can read
  // dirty + dispatch `saved`. Canvas reads `level` and `dispatchLevel`
  // through props.
  const [levelState, dispatchLevel] = useReducer(levelReducer, INITIAL_LEVEL_STATE)
  // Live overlay (task: exit↔entrance marker sync): the loaded level's OWN warp
  // exits replace its on-disk contributions in the incoming map, so placing an
  // exit or editing destX/destY/destLevel moves/creates/removes the matching
  // entrance marker in the same commit — no stale "incoming entry" visuals.
  const liveIncomingByLevel = useMemo(() => {
    const lvl = levelState.level
    if (!lvl || lvl.empty || lvl.special) return incomingByLevel
    const out = new Map<number, IncomingExit[]>()
    for (const [dest, list] of incomingByLevel) {
      const kept = list.filter((i) => i.sourceLevelRecordId !== lvl.recordId)
      if (kept.length > 0) out.set(dest, kept)
    }
    for (const e of lvl.exits) {
      if (e.variant !== 'warp') continue
      const list = out.get(e.destLevelRecordId) ?? []
      list.push({
        sourceLevelRecordId: lvl.recordId,
        sourceScreenIndex: e.screenIndex,
        destX: e.destX,
        destY: e.destY,
        entranceType: e.entranceType
      })
      out.set(e.destLevelRecordId, list)
    }
    return out
  }, [incomingByLevel, levelState.level])
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState<boolean>(false)
  const dirty = isDirty(levelState)
  // Bumped by a Banks-panel migrate / de-couple toggle so the byte-budget gate
  // re-fetches — migrating a bank-mate out reclaims room, so a "N over budget"
  // banner for the open level may now clear (see onLayoutChange).
  const [layoutVersion, setLayoutVersion] = useState<number>(0)
  // Save / build blockers — one extensible list (lib/level-blockers.ts). The
  // BlockerBar renders them; Save + Test consult them by scope. The byte-budget
  // contributor (task #14) is async (per-pool IPC), folded in by the hook.
  const { blockers, budget } = useLevelBlockers(levelState.level, saveError, layoutVersion)
  const poolLabel = useMemo(() => poolSummary(budget), [budget])
  const saveBlocked = isBlocked(blockers, 'save')

  // Tiles + Palette panels: the level's shared Map16 usage (fetched only while a
  // consuming panel is open) and the selected object's blocks/palette rows — the
  // selection ↔ panel linkage. `selectedObjectRows` maps the object's block IDs
  // to BG palette rows via the usage block→rows table.
  const tilePanelsOpen = windows.some(
    (w) => w.open && (w.kind === 'tiles' || w.kind === 'palette')
  )
  const tileUsage = useLevelTileUsage(levelState.level, tilePanelsOpen)
  const selectedObjectInfluence = useSelectedObjectInfluence(levelState.level, primarySelection)
  const selectedObjectBlockIds = useMemo(
    () => influenceBlockIds(selectedObjectInfluence),
    [selectedObjectInfluence]
  )
  const selectedObjectRows = useMemo(() => {
    if (!selectedObjectBlockIds || !tileUsage) return null
    const rows = new Set<number>()
    for (const blk of tileUsage.blocks) {
      if (selectedObjectBlockIds.has(blk.id)) blk.paletteRows.forEach((r) => rows.add(r))
    }
    return rows
  }, [selectedObjectBlockIds, tileUsage])

  // The level's CGRAM is a function of only the palette-relevant header fields:
  // BG color (0), the BG1/BG2/BG3/sprite palette rows (2/4/6/8), and level mode
  // (9) — the inputs to `paletteHeaderFromLevel`. Keying the Palette panel's live
  // refresh on just these re-skins the swatch grid when one is edited, without
  // re-fetching CGRAM on every object/sprite edit.
  const paletteHeaderVersion = useMemo(() => {
    const h = levelState.level?.header
    return h ? [0, 2, 4, 6, 8, 9].map((i) => h[i] ?? 0).join(',') : ''
  }, [levelState.level])

  // Unsaved-changes guards. Switching levels / following an exit discards the
  // current level's edits, so hold the navigation behind a confirm modal when
  // the level is dirty (project switches have their own guard in ProjectMenu;
  // this is level-scoped — a level switch doesn't touch string edits). Separately
  // mirror the app-wide dirty flag to main so it can confirm before the window
  // closes (quit guard).
  const { anyDirty, saveAll } = useEditSession()
  useEffect(() => {
    window.shinyEgg.setUnsavedChanges(anyDirty)
  }, [anyDirty])
  // Reset-level confirm dialog (delete the level's overlay → reload from base).
  // Plain-click opens an informational modal (resetInfoOpen); the destructive
  // confirm dialog (confirmReset) only opens on a deliberate shift-click.
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetInfoOpen, setResetInfoOpen] = useState(false)
  // Tracks whether any saveLevel has happened since the last successful build.
  // Used by the BizHawk "Test Level" chain to skip rebuilds when nothing has
  // changed on disk. Kept in a ref (the async chain needs a synchronous
  // read-after-write without a stale closure) and mirrored to state (so the
  // status bar's "rebuild to refresh" note reacts).
  const needsBuildRef = useRef<boolean>(false)
  const [needsBuild, setNeedsBuildState] = useState<boolean>(false)
  const setNeedsBuild = useCallback((v: boolean) => {
    needsBuildRef.current = v
    setNeedsBuildState(v)
  }, [])
  // Bumped on every successful build so the canvas layers + palette panel re-fetch
  // from the freshly-built ROM (asm edits — palette, strings — only reach the
  // rendered pixels through a rebuild, and nothing else in their render deps
  // changes, so without this the canvas keeps the pre-build colours).
  const [renderRefresh, setRenderRefresh] = useState(0)
  const bumpRenderRefresh = useCallback(() => setRenderRefresh((v) => v + 1), [])
  const markBuildClean = useCallback(() => {
    setNeedsBuild(false)
    bumpRenderRefresh()
  }, [setNeedsBuild, bumpRenderRefresh])
  // Any ROM-affecting save (level data, asm edits like strings) leaves the built
  // ROM stale, so Test Level / Launch must rebuild before booting. asm-editing
  // tools call this on a successful save — the convention for all future asm
  // edits, which (unlike level data) don't render live and only reach the editor
  // through a rebuild.
  const markRomDirty = useCallback(() => setNeedsBuild(true), [setNeedsBuild])
  // A graphics edit (PNG import / BG region / reset) both marks the build dirty
  // AND previews live: main mirrors saveGfxEdit into the gfx-live cache, so a
  // render refresh repaints the canvas with the edit without a rebuild — the gfx
  // twin of the palette draft (which previews via paletteOverride).
  const onGfxEdited = useCallback(() => {
    markRomDirty()
    bumpRenderRefresh()
  }, [markRomDirty, bumpRenderRefresh])
  // A Banks-panel free-space migrate / de-couple toggle changes the build layout
  // (mark dirty) AND the per-level byte budget of every bank-mate (bump the
  // layout version so the budget gate re-fetches and stale "N over" banners clear).
  const onLayoutChange = useCallback(() => {
    markRomDirty()
    setLayoutVersion((v) => v + 1)
  }, [markRomDirty])
  // Bumped to ask the ROM menu to open its log popover — e.g. when a build
  // fails during Test Level / Launch so the asar error is visible.
  const [logOpenSignal, setLogOpenSignal] = useState<number>(0)
  const openLog = useCallback(() => setLogOpenSignal((n) => n + 1), [])

  // Canvas background colour (the area behind/around the level) — an app-wide
  // setting, defaulting to black. Loaded once from settings.json; the toolbar
  // swatch persists + previews it. Applied as the `--se-canvas-bg` CSS var that
  // `.se-canvas` reads (the canvas clears to transparent, so this CSS background
  // shows through — see scene.ts).
  const DEFAULT_CANVAS_BG = '#000000'
  const [canvasBg, setCanvasBg] = useState(DEFAULT_CANVAS_BG)
  useEffect(() => {
    void window.shinyEgg.settings.get().then((s) => {
      if (s.canvasBackgroundColor) setCanvasBg(s.canvasBackgroundColor)
    })
  }, [])
  useEffect(() => {
    document.documentElement.style.setProperty('--se-canvas-bg', canvasBg)
  }, [canvasBg])
  const onCanvasBgChange = useCallback((color: string) => {
    setCanvasBg(color)
    void window.shinyEgg.settings.set({ canvasBackgroundColor: color })
  }, [])

  // Activate a toolbar tool — shared by the tool buttons and the Q/W/E/R
  // hotkeys. The Place tool also pops the Place panel so an entity can be armed.
  const selectTool = useCallback(
    (id: string) => {
      setActiveTool(id)
      if (id === 'place') openWindow('picker')
      if (id === 'paint') openWindow('paint')
    },
    [openWindow]
  )

  // Object-finder seed: shift-clicking an entry in the Place panel populates the
  // Object Finder with that entity's kind + id and opens it (instead of arming
  // it for placement). The nonce lets shift-clicking the same row re-seed.
  const [finderSeed, setFinderSeed] = useState<{
    kind: FindInstanceKind
    id: number
    nonce: number
  } | null>(null)
  const onFindObject = useCallback(
    (kind: FindInstanceKind, id: number) => {
      setFinderSeed((prev) => ({ kind, id, nonce: (prev?.nonce ?? 0) + 1 }))
      openWindow('finder')
    },
    [openWindow]
  )

  // Place panel → arm an item + switch to the Place tool. Clicking the canvas
  // then calls onPlaceAt, which appends the entity and selects it.
  const onPickPlacement = useCallback((item: PlacementItem) => {
    setPlacement(item)
    setActiveTool('place')
  }, [])
  // Drop out of the Place tool back to Select so the toolbar button de-highlights
  // (Escape clears the armed placement too — see useLevelKeyboardShortcuts).
  const cancelPlacement = useCallback(() => setActiveTool('select'), [])
  const onPlaceAt = useCallback(
    (cx: number, cy: number) => {
      if (!placement) return
      const newUid = levelState.nextUid
      if (placement.kind === 'object') {
        dispatchLevel({
          type: 'addObject',
          template: {
            num: placement.num,
            exnum: placement.exnum,
            x: cx,
            y: cy,
            w: placement.w,
            h: placement.h
          }
        })
        setSelection([{ kind: 'object', uid: newUid }])
      } else if (placement.kind === 'sprite') {
        dispatchLevel({ type: 'addSprite', template: { num: placement.num, x: cx, y: cy } })
        setSelection([{ kind: 'sprite', uid: newUid }])
      } else {
        // Exit: per-screen singleton on the clicked cell's screen. If the screen
        // already has one, select it instead of silently no-opping; otherwise add
        // a self-warp to the clicked cell and select the new exit.
        const lvl = levelState.level
        if (!lvl) return
        const screen = ((cy >> 4) << 4) | (cx >> 4)
        const existing = lvl.exits.find((e) => e.screenIndex === screen)
        if (existing) {
          setSelection([{ kind: 'exit', uid: existing.uid! }])
          return
        }
        dispatchLevel({
          type: 'addExit',
          screenIndex: screen,
          dest: { levelRecordId: lvl.recordId, x: cx, y: cy }
        })
        setSelection([{ kind: 'exit', uid: newUid }])
      }
    },
    [placement, levelState.nextUid, levelState.level]
  )

  // Surface-paint tool (dormant in v1 — see usePaintTool). Self-contained hook so
  // the ~90 lines of paint state/effects/callbacks don't live in App.
  const paint = usePaintTool(selectedLevelRecordId, levelState, dispatchLevel)

  // Set Spawn tool / middle-click → stash a session-only Test Level spawn
  // override at the clicked cell, tagged with the level it belongs to. Clearing
  // is its own callback (Canvas decides set-vs-clear by hit-testing the marker).
  const onSetTestSpawn = useCallback(
    (cellX: number, cellY: number) => {
      if (selectedLevelRecordId === null) return
      setTestSpawn({ levelRecordId: selectedLevelRecordId, x: cellX, y: cellY })
    },
    [selectedLevelRecordId]
  )
  const onClearTestSpawn = useCallback(() => setTestSpawn(null), [])

  // Persist the current level's edits. Resolves true on success (or when
  // there's nothing to save). Shared by the toolbar Save button and the
  // project-switch unsaved-changes prompt.
  const saveCurrent = useCallback(async (): Promise<boolean> => {
    if (!levelState.level) return true
    setSaveError(null)
    try {
      const result = await window.shinyEgg.editor.saveResource(
        { kind: 'level', recordId: levelState.level.recordId },
        levelState.level
      )
      if (result.ok) {
        dispatchLevel({ type: 'saved' })
        setNeedsBuild(true)
        // Saved exits are now on disk — re-walk the warp graph so OTHER levels'
        // incoming markers + the Exits panel reflect them.
        setWarpGraphRefresh((n) => n + 1)
        return true
      }
      setSaveError(result.error)
      return false
    } catch (err) {
      setSaveError((err as Error).message)
      return false
    }
  }, [levelState.level, setNeedsBuild])

  // Save every dirty document (level + string tables) — the toolbar Save button
  // and the Ctrl+S shortcut. Each document's save marks the build dirty as needed.
  const onSaveAll = useCallback(async () => {
    if (!anyDirty || isSaving) return
    setIsSaving(true)
    try {
      await saveAll()
    } finally {
      setIsSaving(false)
    }
  }, [anyDirty, isSaving, saveAll])

  // Shared log sink for the emulator buttons + ROM popover.
  const appendLog = useCallback((line: string) => setLog((l) => [...l, line]), [])

  // Unified, most-recent-first edit history (loaded-level reducer commits
  // interleaved with cross-level incoming-marker edits) + the optimistic
  // incoming-marker patch layer. See hooks/useUnifiedHistory.
  const {
    incoming,
    canUndo,
    canRedo,
    globalUndo,
    globalRedo,
    onMoveIncoming,
    onSetIncomingEntrance,
    recordDocEdit,
    registerDocApplier,
    unregisterDocApplier
  } = useUnifiedHistory({
      commits: levelState.commits,
      selectedLevelRecordId,
      rootLevelRecordId,
      incomingByLevel: liveIncomingByLevel,
      dispatchLevel,
      appendLog,
      setNeedsBuild,
      setSelection
    })

  // Incoming-marker drag: when the marker's SOURCE is the level being edited
  // (a self-warp), route the dest change through the reducer — the cross-level
  // path writes the source level on DISK, which would silently diverge from
  // the unsaved in-memory copy. Other sources keep the disk path.
  const onMoveIncomingLive = useCallback(
    async (inc: IncomingExit, destX: number, destY: number) => {
      const lvl = levelState.level
      if (lvl && inc.sourceLevelRecordId === lvl.recordId) {
        const exit = lvl.exits.find(
          (e) => e.variant === 'warp' && e.screenIndex === inc.sourceScreenIndex
        )
        if (exit) {
          dispatchLevel({ type: 'setExitFields', uid: exit.uid!, patch: { destX, destY } })
          setSelection([{ kind: 'incoming', incoming: { ...inc, destX, destY } }])
          return
        }
      }
      await onMoveIncoming(inc, destX, destY)
    },
    [levelState.level, onMoveIncoming]
  )

  // Incoming-marker entrance commit (Properties dropdown): the entrance-type twin
  // of onMoveIncomingLive. Same self-warp guard — when the marker's SOURCE is the
  // level being edited, route through the reducer (the cross-level disk path would
  // diverge from the unsaved in-memory copy); other sources take the disk path.
  const onSetIncomingEntranceLive = useCallback(
    async (inc: IncomingExit, entranceType: number) => {
      const lvl = levelState.level
      if (lvl && inc.sourceLevelRecordId === lvl.recordId) {
        const exit = lvl.exits.find(
          (e) => e.variant === 'warp' && e.screenIndex === inc.sourceScreenIndex
        )
        if (exit) {
          dispatchLevel({ type: 'setExitFields', uid: exit.uid!, patch: { entranceType } })
          setSelection([{ kind: 'incoming', incoming: { ...inc, entranceType } }])
          return
        }
      }
      await onSetIncomingEntrance(inc, entranceType)
    },
    [levelState.level, onSetIncomingEntrance]
  )

  // Reset the current level: delete its overlay (discard saved + unsaved edits)
  // and reload the pristine base into the editor. Flags a rebuild only when an
  // overlay actually existed (the built ROM was carrying the old data).
  const onResetLevel = useCallback(async () => {
    const lvl = levelState.level
    if (!lvl || lvl.empty || lvl.special) return
    setConfirmReset(false)
    try {
      const r = await window.shinyEgg.editor.resetLevel(lvl.recordId)
      if (!r.ok) {
        appendLog(`Reset level 0x${lvl.recordId.toString(16)}: failed — ${r.error}`)
        return
      }
      const data = await window.shinyEgg.editor.loadResource({ kind: 'level', recordId: lvl.recordId })
      dispatchLevel({ type: 'load', data })
      setSelection([])
      if (r.removed) setNeedsBuild(true)
    } catch (err) {
      appendLog(`Reset level 0x${lvl.recordId.toString(16)}: failed — ${(err as Error).message}`)
    }
  }, [levelState.level, appendLog, setNeedsBuild])

  // After a ROM import wrote overlays: a rebuild is needed; refresh the catalog so
  // imported level names show in the dropdown (now overlay-aware), and reload the
  // currently-loaded level since it may have just been overwritten.
  const onRomImported = useCallback(async () => {
    setNeedsBuild(true)
    setWarpGraphRefresh((n) => n + 1)
    // Reload the whole project so every panel reflects the freshly-written overlay:
    // bump the reload scope (strings/messages/palette/world-map/patches re-read from
    // disk), refresh the overlay-aware dropdown names, and reload the open level below.
    setProjectRev((r) => r + 1)
    void refreshLevelsCatalog()
    const lvl = levelState.level
    if (!lvl || lvl.empty || lvl.special) return
    try {
      const data = await window.shinyEgg.editor.loadResource({ kind: 'level', recordId: lvl.recordId })
      dispatchLevel({ type: 'load', data })
      setSelection([])
    } catch (err) {
      appendLog(`Reload after import failed — ${(err as Error).message}`)
    }
  }, [levelState.level, appendLog, setNeedsBuild])

  // ── Outdated-overlay upgrade (research task 2) ────────────────────────────
  // Back up = duplicate the project (a restore point); upgrade = re-splice the
  // chosen overlay files' edited regions onto the fresh base. Both proxy to the
  // main-side current project.
  const onOverlayBackup = useCallback(async (): Promise<ProjectBackupResult> => {
    const id = project?.id
    if (!id) return { ok: false, error: 'No active project.' }
    return window.shinyEgg.projects.backup(id)
  }, [project?.id])

  const onOverlayUpgrade = useCallback(
    async (files: string[]): Promise<void> => {
      const id = project?.id
      if (!id) return
      const r = await window.shinyEgg.projects.upgradeOverlays(id, files)
      // Any rewritten file: reload the overlay-backed panels from disk (projectRev),
      // refresh the overlay-aware level names, and force a rebuild before launch.
      if (r.upgraded.length > 0) {
        setProjectRev((rev) => rev + 1)
        void refreshLevelsCatalog()
        setNeedsBuild(true)
      }
      if (!r.ok) throw new Error(r.error) // modal surfaces it + stays open
      setOverlayDrift(null) // fully applied — close
    },
    [project?.id, refreshLevelsCatalog, setNeedsBuild]
  )

  // Level navigation: forward entry points (dropdown / sub-room / object-finder
  // jump) + back/forward history, the unsaved-changes discard modal, reverse
  // parent-resolution, and the camera/focus channel into Canvas. The two record-
  // id states stay in App (read across the tree); the hook owns the rest. See
  // hooks/useLevelNavigation.
  const {
    navigateTo,
    requestNav,
    selectRootLevel,
    jumpToInstance,
    focusCell,
    onBack,
    onForward,
    canBack,
    canForward,
    clearLevelSelection,
    resolvingRoot,
    cameraRef,
    focusReq,
    cameraReq,
    pendingNav,
    navSaving,
    navError,
    onNavSave,
    onNavDiscard,
    onNavCancel
  } = useLevelNavigation({
    dirty,
    saveCurrent,
    selectedLevelRecordId,
    setSelectedLevelRecordId,
    setRootLevelRecordId
  })

  // Banks-panel level removal: the build layout + the catalog both changed, and
  // the open/root level may no longer exist — refresh, then bail to the first
  // surviving catalog level. The jump routes through the normal nav guard.
  const onLevelsRemoved = useCallback(
    (removedIds: number[]) => {
      onLayoutChange()
      void refreshLevelsCatalog().then(() => {
        const gone =
          (selectedLevelRecordId != null && removedIds.includes(selectedLevelRecordId)) ||
          (rootLevelRecordId != null && removedIds.includes(rootLevelRecordId))
        if (!gone) return
        const fallback = getAllLevels().find((l) => l.recordId != null)?.recordId
        if (fallback != null) selectRootLevel(fallback)
        else clearLevelSelection()
      })
    },
    [onLayoutChange, selectedLevelRecordId, rootLevelRecordId, selectRootLevel, clearLevelSelection]
  )

  // Finder jump → select the matched entity once its level is loaded, so the
  // Properties panel shows it. Cross-level jumps wait for the load effect to
  // swap `levelState.level` in (Canvas clears selection on load first, so this
  // wins); same-level Prev/Next re-fire on the bumped nonce. The nonce ref
  // consumes each request exactly once, so unrelated re-renders (edits) don't
  // re-select.
  const finderSelectNonceRef = useRef(-1)
  useEffect(() => {
    const fr = focusReq
    if (!fr?.select || finderSelectNonceRef.current === fr.nonce) return
    const level = levelState.level
    if (!level || level.recordId !== fr.levelRecordId) return
    finderSelectNonceRef.current = fr.nonce
    const sel = selectionForFinderJump(level, fr.select, fr.x, fr.y)
    if (sel) setSelection([sel])
  }, [focusReq, levelState.level])

  // Register the level editor with the central session so the project menu's
  // "Save all" + the unsaved-changes prompt see its dirty state. Discard
  // reverts the level to its on-disk baseline (`base`).
  useEditDocument('level', {
    dirty,
    save: saveCurrent,
    discard: () => {
      dispatchLevel({ type: 'load', data: levelState.base })
      setSelection([])
    }
  })

  // String tables live in the framework asm. Owned here (not in the floating
  // window) so edits + EditSession registration survive the window being closed
  // and tab switches; reload when the project changes. One hook call per table.
  const projectId = project?.id ?? null
  // Reload scope for the overlay-backed panels (strings, messages, palette,
  // patches): changes on a project switch (id changes) AND on a ROM import
  // (projectRev bumps), so they re-read the freshly-written overlay. Passed in
  // place of the bare projectId — those consumers use it only as a reload key /
  // effect trigger, never for IPC (which reads the active project main-side).
  const projectScope = projectId === null ? null : `${projectId}#${projectRev}`
  // Shared overlay-document history channel (strings now, palette next) — a
  // stable handle so each document can record undo steps + register its applier.
  const docHistory = useMemo<DocHistory>(
    () => ({ recordDocEdit, registerDocApplier, unregisterDocApplier }),
    [recordDocEdit, registerDocApplier, unregisterDocApplier]
  )
  // Saving level names OR a world-map edit also refreshes the (overlay-aware)
  // catalog so the dropdown reflects the new names / a tile remap (entrance byte
  // +0) without a rebuild. Message text doesn't affect the catalog (uses bare
  // markRomDirty).
  const markRomDirtyAndRefreshCatalog = useCallback(() => {
    markRomDirty()
    void refreshLevelsCatalog()
  }, [markRomDirty])
  const levelNameStrings = useStringsEditor('level-name-strings', 'Level Names', projectScope, markRomDirtyAndRefreshCatalog, docHistory)
  const messageStrings = useStringsEditor('message-box-text', 'Message Text', projectScope, markRomDirty, docHistory)
  const messagePtrs = useMessagePtrTableEditor('message-box-text-ptrs', 'Message Pointers', projectScope, markRomDirty, docHistory)
  // Palette colour-edit document — its `draft` is fed to the canvas as a live
  // render override; its Save (or the global Save / Test Level) persists the
  // delta to the overlay before a build.
  const paletteEditor = usePaletteEditor(projectScope, markRomDirty, docHistory)
  // World-map entrance-table document — spawn / progression edits per world-map
  // slot. Spawn X/Y previews live via the canvas marker (read from this draft);
  // other fields verify in Test Level (asm edit → markRomDirty). Its save shares
  // markRomDirtyAndRefreshCatalog: a tile remap (entrance byte +0) must refresh
  // the catalog (the baked levels.json mapping can't — the main-side recordId
  // overlay + this refresh are the only path; see levelRecordOverrides).
  const worldMapEditor = useWorldMapEditor(projectScope, markRomDirtyAndRefreshCatalog, docHistory)
  // Per-line "jump" in the World Map panel: load a level (spawn / checkpoint
  // re-entry record) and focus the camera at the cell. Reuses the finder-jump
  // primitive (anchors the owning translevel, loads, focuses).
  const onWorldMapJump = useCallback(
    (recordId: number, x: number, y: number) => jumpToInstance({ levelRecordId: recordId, x, y }),
    [jumpToInstance]
  )
  // Live spawn cell for the loaded level from the entrance-table draft — drives
  // the canvas marker override + the Properties spawn fields (so a spawn edit
  // moves the marker live). Null when the level has no world-map entrance.
  // Memoised on the draft + level so its object identity is stable across
  // unrelated renders (spawnFor builds a fresh object) — else the canvas would
  // redraw every render.
  const worldMapModel = worldMapEditor.model
  const worldMapSpawn = useMemo(
    () => (selectedLevelRecordId !== null ? worldMapEditor.spawnFor(selectedLevelRecordId) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- spawnFor is keyed on worldMapModel
    [worldMapModel, selectedLevelRecordId]
  )
  const onSpawnCommit = useCallback(
    (x: number, y: number) => {
      if (selectedLevelRecordId !== null) worldMapEditor.commitSpawn(selectedLevelRecordId, x, y)
    },
    [worldMapEditor, selectedLevelRecordId]
  )

  // Closing the Palette / Strings window prompts to save or discard that editor's
  // unsaved draft — their state lives here (survives close), so closing would
  // otherwise silently keep the edits. Other windows close immediately.
  const [pendingClose, setPendingClose] = useState<{ id: string; kind: WindowDef['kind'] } | null>(
    null
  )
  const [closeSaving, setCloseSaving] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)
  const closeDocs = useCallback(
    (
      kind: WindowDef['kind']
    ): Array<{ dirty: boolean; save: () => Promise<boolean>; discard: () => void }> =>
      kind === 'palette'
        ? [paletteEditor]
        : kind === 'strings'
          ? [levelNameStrings, messageStrings, messagePtrs]
          : kind === 'world-map'
            ? [worldMapEditor]
            : [],
    [paletteEditor, levelNameStrings, messageStrings, messagePtrs, worldMapEditor]
  )
  const requestCloseWindow = useCallback(
    (w: WindowDef): void => {
      if (closeDocs(w.kind).some((d) => d.dirty)) setPendingClose({ id: w.id, kind: w.kind })
      else closeWindow(w.id)
    },
    [closeDocs, closeWindow]
  )
  // Toggle a panel's floating window open/closed — the shared action behind both
  // the inline panel-toggle buttons and the Global Panels menu. Closing routes
  // through requestCloseWindow so a dirty overlay doc prompts to save first.
  const togglePanel = useCallback(
    (kind: PanelKind): void => {
      const win = windows.find((w) => w.kind === kind)
      if (win?.open) requestCloseWindow(win)
      else openWindow(kind)
    },
    [windows, openWindow, requestCloseWindow]
  )
  // Build the PanelGroupMenu entries for a set of window kinds — current open
  // state + a bound toggle for each, in PANEL_TOGGLES order.
  const groupPanels = useCallback(
    (kinds: ReadonlySet<string>) =>
      PANEL_TOGGLES.filter((p) => kinds.has(p.kind)).map((p) => ({
        kind: p.kind,
        label: p.label,
        title: p.title,
        open: windows.find((w) => w.kind === p.kind)?.open ?? false,
        onToggle: () => togglePanel(p.kind)
      })),
    [windows, togglePanel]
  )
  const onCloseSave = useCallback(async (): Promise<void> => {
    if (!pendingClose) return
    setCloseSaving(true)
    setCloseError(null)
    try {
      for (const d of closeDocs(pendingClose.kind)) {
        if (d.dirty && !(await d.save())) {
          setCloseError('Save failed — fix the error and try again.')
          return
        }
      }
      closeWindow(pendingClose.id)
      setPendingClose(null)
    } finally {
      setCloseSaving(false)
    }
  }, [pendingClose, closeDocs, closeWindow])
  const onCloseDiscard = useCallback((): void => {
    if (!pendingClose) return
    closeDocs(pendingClose.kind).forEach((d) => d.dirty && d.discard())
    closeWindow(pendingClose.id)
    setPendingClose(null)
  }, [pendingClose, closeDocs, closeWindow])
  const onCloseCancel = useCallback(() => setPendingClose(null), [])

  // Launch / Test Level orchestration (save → build → boot EmuHawk, with the
  // catalog / sub-room warp-chain / orphan-room boot paths + the Set-Spawn
  // override). See hooks/useEmulatorActions.
  const { emuBusy, handleLaunch, handleTestLevel } = useEmulatorActions({
    anyDirty,
    saveAll,
    needsBuildRef,
    setNeedsBuild,
    onBuilt: markBuildClean,
    openLog,
    blockers,
    selectedLevelRecordId,
    rootLevelRecordId,
    testSpawn,
    testInventory,
    appendLog
  })

  // Resolved EmuHawk.exe path, or null until BizHawk is located. Drives the
  // toolbar's Launch / Test Level vs "Locate BizHawk" choice. In dev the main
  // process resolves a `../bizhawk/EmuHawk.exe` fallback, so this is usually
  // non-null without any action.
  const [bizhawkExe, setBizhawkExe] = useState<string | null>(null)
  useEffect(() => {
    void window.shinyEgg.bizhawk.getExe().then(setBizhawkExe)
  }, [])
  // "Locate BizHawk": pick EmuHawk.exe (persisted main-side) and flip the toolbar
  // to Launch / Test Level. Surfaces a rejected pick (wrong file) to the log.
  const onLocateBizhawk = useCallback(async () => {
    try {
      const r = await window.shinyEgg.bizhawk.locate()
      if (r.ok && r.path) setBizhawkExe(r.path)
      else if (r.error) appendLog(`Locate BizHawk: ${r.error}`)
    } catch (err) {
      appendLog(`Locate BizHawk: ${(err as Error).message}`)
    }
  }, [appendLog])


  // Subscribe App to catalog mutations so a post-extract refresh propagates
  // re-renders down to every getLevel()-reading child (Canvas, SubLevelMenu,
  // PropertiesPanel, etc.) without each having to subscribe separately.
  useLevelsCatalog()

  // One-shot: try to pull the cart-derived catalog at boot. Silent no-op if
  // no extraction has happened yet — the catalog stays empty until extract.
  useEffect(() => {
    void refreshLevelsCatalog()
  }, [])

  // Resolve the current project on launch (reopens the last one, or creates
  // the default `new-shiny-00` if none exists yet).
  useEffect(() => {
    void window.shinyEgg.projects.ensureCurrent().then(setProject)
  }, [])

  // On each project launch / switch, check its overlay `.asm` files for drift
  // against the current editor base (out-of-region changes, or editable regions
  // added later). If any, raise the upgrade modal. Re-prompts on the next launch
  // until resolved (dismiss sets it to null without persisting a "skip").
  useEffect(() => {
    const id = project?.id
    if (!id) return
    let cancelled = false
    void window.shinyEgg.projects
      .checkOverlays(id)
      .then((r) => {
        if (!cancelled && r.files.length > 0) setOverlayDrift(r)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [project?.id])

  useEffect(() => {
    layersStore.save(layers)
  }, [layers])

  const toggleLayer = useCallback((key: keyof LayerVisibility) => {
    // The grid is a 3-state cycle (off → screen → tile → off), not a boolean —
    // advance it through GridMode. Every other layer is a plain on/off flip.
    if (key === 'grid') {
      setLayers((l) => ({ ...l, grid: nextGridMode(l.grid) }))
      return
    }
    setLayers((l) => ({ ...l, [key]: !l[key] }))
  }, [])

  // Global editor keyboard shortcuts. Ignored while typing in a field (Strings /
  // Properties inputs — so the browser's own Ctrl+C/X/V keep working there).
  // Undo/redo + Escape always apply. With a selection: Delete removes, Ctrl+D
  // duplicates, and Ctrl+C/X/V copy/cut/paste — each operates on the WHOLE
  // selection (multi-select groups included) via ONE batched reducer commit, so
  // a group edit is a single undo step + one render re-decode (never N). Arrows
  // nudge a single object/sprite (Shift = one screen) or move a single exit.
  useLevelKeyboardShortcuts({
    levelState,
    dispatchLevel,
    selection,
    primarySelection,
    setSelection,
    setPlacement,
    cancelPlacement,
    globalUndo,
    globalRedo,
    propTable,
    clipboardRef,
    cameraRef,
    viewportRef
  })

  // App-wide shortcuts: Ctrl/Cmd+S = Save all, Ctrl/Cmd+R = Test Level. Handled
  // in their own listener (not the level-edit one) and ALWAYS preventDefault'd —
  // even while focused in a text field — so the browser's Save dialog never
  // opens and, critically, Ctrl+R never reloads the renderer. Plain Ctrl only
  // (Ctrl+Shift+R stays the dev hard-reload).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 's') {
        e.preventDefault()
        void onSaveAll()
      } else if (k === 'r') {
        e.preventDefault()
        handleTestLevel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSaveAll, handleTestLevel])

  // Plain-key shortcuts: Q/W/E/R pick the toolbar tools (Select / Place / Erase /
  // Set Spawn) — see TOOL_HOTKEYS — and G toggles the grid overlay (cycling its
  // off → screen → tile modes, same as the toolbar button). Plain keys only:
  // ignored while typing in a field and whenever a modifier is held, so Ctrl+R
  // (Test Level) etc. still win.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return
      }
      const k = e.key.toLowerCase()
      if (k === 'g') {
        e.preventDefault()
        toggleLayer('grid')
        return
      }
      const id = TOOL_HOTKEYS[k]
      if (!id) return
      e.preventDefault()
      selectTool(id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectTool, toggleLayer])

  // Project change from the toolbar Project menu. On an actual switch (new /
  // open / delete) clear the level selection so the canvas drops back to "pick
  // a level" and reloads from the now-current project — independent of whether
  // edits were saved or discarded. An in-place rename (switched=false) leaves
  // the current level alone.
  const onProjectChange = useCallback(
    (p: ProjectSummary, switched: boolean) => {
      setProject(p)
      if (switched) {
        // The level set belongs to the old project — clear the selection + nav trail.
        clearLevelSelection()
        // The catalog's level names are overlay-aware (project-dependent), so the
        // dropdown must re-derive them for the now-active project's overlay.
        void refreshLevelsCatalog()
        // Each project builds to its own dir; we don't track per-project build
        // freshness, so force the next Launch/Test Level to rebuild the now-
        // active project (cheap — the build-tree merge is incremental). Also
        // guarantees a fresh/just-created project gets a ROM before launch.
        setNeedsBuild(true)
      }
    },
    [setNeedsBuild, clearLevelSelection]
  )

  const refreshState = useCallback(async () => {
    setState(await window.shinyEgg.getExtractionState())
    setExtractFreshness(await window.shinyEgg.getExtractFreshness())
  }, [])

  useEffect(() => {
    void refreshState()
    return window.shinyEgg.onFrameworkProgress((msg) => {
      setLog((l) => [...l, msg])
    })
  }, [refreshState])

  const hasAssets = state !== null

  return (
    <div className="se">
      <header className="se-toolbar">
        <div className="se-toolbar__row se-toolbar__row--primary">
        <ProjectMenu
          current={project}
          onChange={onProjectChange}
          onImported={(removedVanillaIds) => {
            void onRomImported()
            // The import's optional "remove all vanilla levels" pass also changed
            // the catalog/layout — reuse the Banks-panel removal handling (marks
            // dirty, refreshes, navigates away if the open level was removed).
            if (removedVanillaIds && removedVanillaIds.length > 0) {
              onLevelsRemoved(removedVanillaIds)
            }
          }}
        />

        <div className="se-toolbar__levels">
          <LevelMenu selectedId={rootLevelRecordId} onSelect={selectRootLevel} />
          <SubLevelMenu
            rootLevelRecordId={rootLevelRecordId}
            currentLevelRecordId={selectedLevelRecordId}
            subLevels={subLevels}
            loading={subLevelsLoading}
            onSelect={(id) => requestNav(() => navigateTo(rootLevelRecordId, id))}
          />
          {resolvingRoot && (
            <span className="se-toolbar__hint" title="Reverse-searching for the catalog level that owns this room">
              finding parent…
            </span>
          )}
        </div>

        <nav className="se-toolbar__tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`se-tool${activeTool === t.id ? ' is-active' : ''}`}
              onClick={() => selectTool(t.id)}
              title={`${t.label}  (${t.hotkey})${t.hint ? `  ·  ${t.hint}` : ''}`}
            >
              <svg viewBox="0 0 16 16" width="16" height="16">
                <path
                  d={t.path}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ))}
          <span className="se-toolbar__divider" />
          <label className="se-toolbar__bgcolor" title="Canvas background color">
            <input
              type="color"
              value={canvasBg}
              onChange={(e) => onCanvasBgChange(e.target.value)}
            />
          </label>
          <span className="se-toolbar__divider" />
          <LayerToggles layers={layers} onToggle={toggleLayer} />
        </nav>

        <div className="se-toolbar__right">
          <RomMenu
            state={state}
            setState={setState}
            freshness={extractFreshness}
            refreshState={refreshState}
            log={log}
            setLog={setLog}
            running={running}
            setRunning={setRunning}
            onBuildSuccess={markBuildClean}
            onBuildFailure={markRomDirty}
            requestOpen={logOpenSignal}
          />
        </div>
        </div>

        <div className="se-toolbar__row se-toolbar__row--secondary">
          <div className="se-toolbar__row-left">
            <button
              type="button"
              className="se-tool"
              onClick={onBack}
              disabled={!canBack}
              title="Back  (Alt+←, mouse back)"
            >
              <svg viewBox="0 0 16 16" width="16" height="16">
                <path d="M10 3 L5 8 L10 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              className="se-tool"
              onClick={onForward}
              disabled={!canForward}
              title="Forward  (Alt+→, mouse forward)"
            >
              <svg viewBox="0 0 16 16" width="16" height="16">
                <path d="M6 3 L11 8 L6 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <span className="se-toolbar__divider" />
            <button
              type="button"
              className="se-tool"
              onClick={globalUndo}
              disabled={!canUndo}
              title="Undo  (Ctrl+Z)"
            >
              <svg viewBox="0 0 16 16" width="16" height="16">
                <path
                  d="M4 7 h6 a3 3 0 0 1 0 6 H7 M4 7 l3 -3 M4 7 l3 3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              type="button"
              className="se-tool"
              onClick={globalRedo}
              disabled={!canRedo}
              title="Redo  (Ctrl+Shift+Z)"
            >
              <svg viewBox="0 0 16 16" width="16" height="16">
                <path
                  d="M12 7 h-6 a3 3 0 0 0 0 6 H9 M12 7 l-3 -3 M12 7 l-3 3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              type="button"
              className={`se-tool se-tool--save${anyDirty ? ' is-dirty' : ''}`}
              onClick={() => void onSaveAll()}
              disabled={!anyDirty || isSaving || saveBlocked}
              title={
                saveBlocked
                  ? `Can't save — ${blockers.filter((b) => b.scope === 'save' && gates(b)).map((b) => b.message).join('; ')}`
                  : anyDirty
                    ? 'Save all  (Ctrl+S)'
                    : 'No unsaved changes  (Ctrl+S)'
              }
            >
              {isSaving ? 'Saving…' : anyDirty ? 'Save*' : 'Save'}
            </button>
            <button
              type="button"
              className="se-tool se-tool--reset"
              onClick={(e) => (e.shiftKey ? setConfirmReset(true) : setResetInfoOpen(true))}
              disabled={
                isSaving ||
                !levelState.level ||
                levelState.level.empty ||
                levelState.level.special
              }
              title="Reset level — discard all changes (saved + unsaved) and reload from the base cart. Shift-click to reset."
            >
              Reset
            </button>
            <BizHawkMenu
              selectedLevelRecordId={selectedLevelRecordId}
              busy={emuBusy}
              located={bizhawkExe !== null}
              onLocate={onLocateBizhawk}
              onLaunch={handleLaunch}
              onTestLevel={handleTestLevel}
              testInventory={testInventory}
              onTestInventoryChange={handleTestInventoryChange}
            />
          </div>
          <div className="se-toolbar__row-right">
            {PANEL_TOGGLES.filter(
              (p) => !GLOBAL_PANEL_KINDS.has(p.kind) && !GRAPHICS_PANEL_KINDS.has(p.kind)
            ).map((p) => {
              const open = windows.find((w) => w.kind === p.kind)?.open ?? false
              return (
                <button
                  key={p.kind}
                  type="button"
                  className={`se-tool se-tool--reopen${open ? ' is-open' : ''}`}
                  onClick={() => togglePanel(p.kind)}
                  title={open ? `Close ${p.title}` : `Open ${p.title}`}
                >
                  {p.label}
                </button>
              )
            })}
            <PanelGroupMenu label="Graphics Panels" panels={groupPanels(GRAPHICS_PANEL_KINDS)} />
            <PanelGroupMenu label="Global Panels" panels={groupPanels(GLOBAL_PANEL_KINDS)} />
          </div>
        </div>
      </header>

      <main className="se-stage">
        <Canvas
          hasAssets={hasAssets}
          selectedLevelRecordId={selectedLevelRecordId}
          selection={selection}
          onSelect={setSelection}
          onJumpToLevel={(id) => requestNav(() => navigateTo(rootLevelRecordId, id))}
          layers={layers}
          incoming={incoming}
          onMoveIncoming={onMoveIncomingLive}
          levelState={levelState}
          dispatchLevel={dispatchLevel}
          needsBuild={needsBuild}
          poolLabel={poolLabel}
          focusRequest={focusReq}
          cameraRef={cameraRef}
          viewportRef={viewportRef}
          cameraRequest={cameraReq}
          placing={activeTool === 'place' && placement !== null}
          onPlaceAt={onPlaceAt}
          regionPickMode={pickingRegion}
          onRegionPicked={(rect) => {
            setBg1RegionRect(rect)
            setPickingRegion(false)
          }}
          eraseTool={activeTool === 'erase'}
          spawnTool={activeTool === 'spawn'}
          paintTool={activeTool === 'paint' && levelState.level !== null}
          paintHeights={paint.heights}
          onPaintStroke={paint.onStroke}
          testSpawn={
            testSpawn && testSpawn.levelRecordId === selectedLevelRecordId
              ? { x: testSpawn.x, y: testSpawn.y }
              : null
          }
          onSetTestSpawn={onSetTestSpawn}
          onClearTestSpawn={onClearTestSpawn}
          spawnOverride={worldMapSpawn}
          onSpawnCommit={onSpawnCommit}
          paletteOverride={paletteEditor.draft}
          renderRefresh={renderRefresh}
          canvasBackground={canvasBg}
        />
        {/* Rendered after the canvas (so it sits above the level visuals) but with
            auto z-index, so the positive-z floating panels stay above it. Shows the
            byte-budget blockers. (Palette + graphics edits preview live on the
            canvas — gfx via the persisted live cache, palette via the draft — so
            there's no "visuals out of date" banner; Test Level / Launch rebuild.) */}
        <BlockerBar
          blockers={blockers}
          onDismiss={(id) => {
            if (id === 'io-error') setSaveError(null)
          }}
        />
        {windows
          .filter((w) => w.open)
          .map((w) => (
            <FloatingWindow
              key={w.id}
              title={w.title}
              initialPos={w.pos}
              width={w.width}
              initialHeight={w.height}
              zIndex={w.z}
              onFocus={() => focusWindow(w.id)}
              onClose={() => requestCloseWindow(w)}
              onPositionCommit={(pos) => commitWindowPos(w.id, pos)}
              onSizeCommit={(size) => commitWindowSize(w.id, size)}
              help={panelHelp(w.kind)}
            >
              {w.kind === 'tiles' ? (
                <TilesBody
                  level={levelState.level}
                  selectedLevelRecordId={selectedLevelRecordId}
                  usage={tileUsage}
                  highlightBlockIds={selectedObjectBlockIds}
                />
              ) : w.kind === 'palette' ? (
                <PaletteBody
                  selectedLevelRecordId={selectedLevelRecordId}
                  paletteRowsUsed={tileUsage?.paletteRowsUsed ?? null}
                  highlightRows={selectedObjectRows}
                  editor={paletteEditor}
                  renderRefresh={renderRefresh}
                  override={levelState.level}
                  headerVersion={paletteHeaderVersion}
                />
              ) : w.kind === 'strings' ? (
                <StringsBody
                  tabs={[
                    { kind: 'strings', editor: levelNameStrings },
                    { kind: 'strings', editor: messageStrings },
                    { kind: 'ptr-table', editor: messagePtrs }
                  ]}
                />
              ) : w.kind === 'world-map' ? (
                <WorldMapBody editor={worldMapEditor} onJump={onWorldMapJump} />
              ) : w.kind === 'picker' ? (
                <PickerBody
                  armed={placement}
                  level={levelState.level}
                  onPick={onPickPlacement}
                  onFind={onFindObject}
                  renderRefresh={renderRefresh}
                />
              ) : w.kind === 'paint' ? (
                <PaintBody
                  tileset={paint.tileset}
                  onTileset={paint.onTileset}
                  fillDepth={paint.fillDepth}
                  onFillDepth={paint.onFillDepth}
                  pointCount={paint.heights.size}
                  onClear={paint.onClear}
                  levelTileset={levelState.level?.header?.[1] ?? null}
                />
              ) : w.kind === 'header' ? (
                <HeaderBody level={levelState.level} dispatchLevel={dispatchLevel} />
              ) : w.kind === 'exits' ? (
                <ExitsBody
                  level={levelState.level}
                  selection={selection}
                  subLevels={subLevels}
                  edges={warpEdges}
                  loading={subLevelsLoading}
                  onSelectExit={(uid) => {
                    setSelection([{ kind: 'exit', uid }])
                    openWindow('props')
                  }}
                  onSelectIncoming={(inc) => {
                    setSelection([{ kind: 'incoming', incoming: inc }])
                    openWindow('props')
                  }}
                  onJump={focusCell}
                />
              ) : w.kind === 'finder' ? (
                <ObjectFinderBody
                  onJump={jumpToInstance}
                  currentLevelRecordId={selectedLevelRecordId}
                  projectScope={projectScope}
                  seed={finderSeed}
                />
              ) : w.kind === 'patches' ? (
                <PatchesBody projectId={projectScope} onMutated={markRomDirty} />
              ) : w.kind === 'banks' ? (
                <BanksBody
                  level={levelState.level}
                  currentLevelRecordId={selectedLevelRecordId}
                  onJump={selectRootLevel}
                  onLayoutChange={onLayoutChange}
                  onLevelsRemoved={onLevelsRemoved}
                />
              ) : w.kind === 'graphics' ? (
                <GraphicsBody
                  level={levelState.level}
                  onMutated={onGfxEdited}
                  bg1RegionRect={bg1RegionRect}
                  pickingRegion={pickingRegion}
                  onStartRegionPick={() => setPickingRegion(true)}
                  onClearRegion={() => setBg1RegionRect(null)}
                />

              ) : (
                <PropertiesBody
                  selection={selection}
                  level={levelState.level}
                  currentLevelRecordId={selectedLevelRecordId}
                  rootLevelRecordId={rootLevelRecordId}
                  selectedObjectInfluence={selectedObjectInfluence}
                  dispatchLevel={dispatchLevel}
                  worldMapSpawn={worldMapSpawn}
                  onSpawnCommit={onSpawnCommit}
                  onIncomingEntranceCommit={onSetIncomingEntranceLive}
                />
              )}
            </FloatingWindow>
          ))}
        <DiscardChangesModal
          open={pendingNav !== null}
          title="Unsaved changes"
          body="You have unsaved edits to this level. Switching will discard them."
          saving={navSaving}
          error={navError}
          onSave={() => void onNavSave()}
          onDiscard={onNavDiscard}
          onCancel={onNavCancel}
        />
        <DiscardChangesModal
          open={confirmReset}
          title="Reset level"
          body="Discard all changes to this level — both saved and unsaved — and reload it from the original cart data? This can't be undone."
          confirmLabel="Reset"
          danger
          onDiscard={() => void onResetLevel()}
          onCancel={() => setConfirmReset(false)}
        />
        {resetInfoOpen && (
          <div className="se-modal-backdrop" onMouseDown={() => setResetInfoOpen(false)}>
            <div className="se-modal" onMouseDown={(e) => e.stopPropagation()}>
              <h3 className="se-modal__title">Reset level</h3>
              <p className="se-modal__body">
                Resetting deletes all of your changes to this level — both saved and
                unsaved — and restores it to the base cart&rsquo;s original data. This
                can&rsquo;t be undone. If you&rsquo;re sure, hold Shift and click Reset.
              </p>
              <div className="se-modal__actions">
                <button
                  type="button"
                  className="se-btn"
                  onClick={() => setResetInfoOpen(false)}
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        )}
        <DiscardChangesModal
          open={pendingClose !== null}
          title="Unsaved changes"
          body={
            pendingClose?.kind === 'palette'
              ? 'This Palette window has unsaved colour edits. Save them, or discard and close?'
              : pendingClose?.kind === 'world-map'
                ? 'This World Map window has unsaved entrance edits. Save them, or discard and close?'
                : 'This Strings window has unsaved edits. Save them, or discard and close?'
          }
          saving={closeSaving}
          error={closeError}
          onSave={() => void onCloseSave()}
          onDiscard={onCloseDiscard}
          onCancel={onCloseCancel}
        />
        {overlayDrift && (
          <OverlayUpgradeModal
            report={overlayDrift}
            onBackup={onOverlayBackup}
            onUpgrade={onOverlayUpgrade}
            onDismiss={() => setOverlayDrift(null)}
          />
        )}
      </main>

      {/* Hard block while a Launch / Test Level chain (save → build → launch →
          load) is in flight — the editor can't accept edits mid-launch. The
          backdrop covers the whole app and swallows clicks; the latest log line
          gives live feedback during a slow build. */}
      {emuBusy && (
        <div className="se-emu-overlay">
          <div className="se-emu-overlay__card">
            <div className="se-emu-overlay__spinner" />
            <div className="se-emu-overlay__title">Launching emulator…</div>
            {log.length > 0 && (
              <div className="se-emu-overlay__status">{log[log.length - 1]}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
