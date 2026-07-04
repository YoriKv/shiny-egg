import {Fragment, useCallback, useEffect, useRef, useState, type JSX} from 'react'
import type {AsepriteInfo, BgRegionLayer, BgRegionRect, BgRegionFormat, GfxExportTrack, GfxEditChange, GfxEditEntry, GfxFileRole, LevelData, M1ExportFile} from '../../../preload/api'
import {DiscardChangesModal} from '../DiscardChangesModal'
import {headerFromLevel} from './TilesPanel'
import {getSprite} from '../data/obj-metadata'
import {persistedState} from '../lib/persisted-state'
import {YychrTab} from './YychrTab'
import {M1teMapsTab} from './M1teMapsTab'
// The "Map16 Blocks" tab is removed from the UI for now: its structural edits (reassigning a
// block's quadrant tiles / palette / flip) don't live-preview on the canvas — only a rebuild
// shows them — and BG1 *pixel* edits already preview via the BG1-area editor. The implementation
// is kept intact — `panels/Map16Panel.tsx` (`Map16Body`), the `editor.*Map16Block` IPC, and
// `src/main/map16-edits.ts` all still work. To re-expose it, restore this import and add a
// 'map16' member to `PanelTab` + a third `se-tab` button + render branch (the panel has a
// tab strip again — Extract / Import and YY-CHR):
// import {Map16Body} from './Map16Panel'

/** Sprite id → friendly name for every sprite num (0..0x1FF) — NAMES the exported
 *  metasprite PNGs (does not limit the set; getSprite returns a fallback name for
 *  unknown nums). */
const allSpriteNames = (): Record<number, string> => {
    const names: Record<number, string> = {}
    for (let n = 0; n < 0x200; n++) names[n] = getSprite(n).name
    return names
}

const sizeLabel = (bytes: number): string =>
    bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`

/** The unit noun for a change's kind (CHR pixels = tiles, tilemap = cells, raw = bytes). */
const changeUnit = (kind: GfxEditChange['kind'], n: number): string =>
    kind === 'tilemap' ? (n === 1 ? 'cell' : 'cells') : kind === 'raw' ? 'bytes' : (n === 1 ? 'tile' : 'tiles')

/** Compact inline badge of what an edited file changed vs base — e.g. "14 tiles", "3 cells",
 *  "320 bytes". The exact, pipeline-recorded count (never a guess). */
const changeBadge = (c: GfxEditChange): string => `${c.changedUnits} ${changeUnit(c.kind, c.changedUnits)}`

/** Full sentence for the expand — e.g. "14 of 256 tiles repainted" / "3 of 1024 cells
 *  re-placed" / "320 of 8192 bytes changed". */
const changeSentence = (c: GfxEditChange): string => {
    const verb = c.kind === 'tilemap' ? 're-placed' : c.kind === 'raw' ? 'changed' : 'repainted'
    return `${c.changedUnits} of ${c.totalUnits} ${changeUnit(c.kind, c.totalUnits)} ${verb}`
}

/** Last path segment of a folder, for a compact list label (full path in title). */
const folderName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/** Versioned localStorage key for the "Auto-Open Exports" preference (default on). */
const AUTO_OPEN_KEY = 'shinyEgg.autoOpenExports.v1'

/** The panel's tabs: the extract/import body, and the per-project YY-CHR sheet
 *  browser (YychrTab.tsx). Active tab persisted per the localStorage convention. */
type PanelTab = 'extract' | 'yychr' | 'm1te'
const TAB_STORE = persistedState<{ tab: PanelTab }>('shinyEgg.graphicsPanel.v1', {tab: 'extract'})

/** What the export dropdown writes. `worldmap`/`systemscreens`/`metasprites` are
 *  gfx-export tracks (worldmap + systemscreens are the two halves of the old `screens`
 *  track); BG1/2/3 are the positioned-region export. Aseprite is available for the BG
 *  regions, the two screen tracks (the title logo + island assemble as real tilemaps,
 *  the maps as layered tilemaps), and metasprites. */
type ExportTarget = 'worldmap' | 'systemscreens' | 'bosses' | 'fonts' | 'metasprites' | 'bg1' | 'bg2' | 'bg3'
// `metasprites` is intentionally omitted from the dropdown for now (export removed from
// the UI). The implementation is kept — engine `sprite-metasprite.ts`, the
// `tracks:['metasprites']` exportGfxPngs path, and the import auto-detect all still work;
// re-add `{value:'metasprites', label:'Metasprites'}` here to expose it again.
const TARGETS: { value: ExportTarget; label: string }[] = [
    {value: 'bg1', label: 'BG1 area'},
    {value: 'bg2', label: 'BG2'},
    {value: 'bg3', label: 'BG3'},
    {value: 'worldmap', label: 'World Map'},
    {value: 'systemscreens', label: 'Boot/Story/Title Screens'},
    {value: 'bosses', label: 'Bosses'},
    {value: 'fonts', label: 'Message Font / Pictures'}
]
// (The whole-cart YY-CHR export moved off this dropdown to the panel's YY-CHR tab —
// it now targets the project's fixed yychr folder; see YychrTab.tsx. Legacy
// dialog-exported yychr folders still import via the generic folder import below.)
const isRegionTarget = (t: ExportTarget): boolean => t === 'bg1' || t === 'bg2' || t === 'bg3'
const regionLayerOf = (t: ExportTarget): BgRegionLayer => (t === 'bg1' ? 1 : t === 'bg2' ? 2 : 3)
// The two screen tracks (world map + boot/story/title) — cart-static graphics, so they
// export with no level loaded (unlike the BG regions + metasprites, which need the level).
const isScreenTarget = (t: ExportTarget): boolean => t === 'worldmap' || t === 'systemscreens'
// Cart-static targets that need NO level loaded (the screen tracks, the Bosses arena, and
// the Bank09 1bpp message font / pictures, which are raw global graphics).
const isLevelIndependent = (t: ExportTarget): boolean => isScreenTarget(t) || t === 'bosses' || t === 'fonts'
// Targets whose Aseprite output goes through the gfx-png export (the screen tracks =
// assembled tilemaps + single-image icons/scenery; metasprites = single-image-with-palette
// projects; fonts = the 1bpp message font / pictures as a single-image 2-color project —
// not a tilemap, since they're 8×12 unique glyphs / a flat bitmap, not 8×8 CHR). The BG
// regions use the separate exportBgRegion path.
const isAsepriteGfxTarget = (t: ExportTarget): boolean => isScreenTarget(t) || t === 'bosses' || t === 'metasprites' || t === 'fonts'
const gfxTracksOf = (t: ExportTarget): GfxExportTrack[] =>
    t === 'metasprites' ? ['metasprites'] : t === 'worldmap' ? ['worldmap'] : t === 'bosses' ? ['bosses'] : t === 'fonts' ? ['fonts'] : ['systemscreens']

interface Props {
    /** The level currently loaded in the canvas — its palette colors the export. */
    level: LevelData | null
    /** Active-project reload key (`${projectId}#${projectRev}`). Changes on a project
     *  switch / ROM import — re-fetches the per-project exported-folders + changed-graphics
     *  lists so the panel never shows the previous project's extracts. */
    projectScope: string | null
    /** Called after an import or reset changes files (mark the build dirty). */
    onMutated: () => void
    /** Called after an import wrote master-palette colors (e.g. a recolor from M1TE), so
     *  the app reloads its palette draft and the canvas live-preview reflects the import. */
    onPaletteImported: () => void
    /** Count of edited master-palette colors (the App-level palette draft). Shown as a
     *  "Changed graphics" entry so palette imports/edits are visible + resettable here too. */
    paletteEditCount: number
    /** Reset every palette color to vanilla (clears the draft → live preview repaints). */
    onResetPalette: () => void
    /** BG1 area: the rectangle picked on the canvas (null until shift-dragged). */
    bg1RegionRect: BgRegionRect | null
    /** True while the canvas is armed to capture a BG1 area shift-drag. */
    pickingRegion: boolean
    /** Arm the canvas to capture the next shift-drag as the BG1 area. */
    onStartRegionPick: () => void
    /** Clear the captured BG1 area. */
    onClearRegion: () => void
}

/**
 * The Graphics panel: a unified export/import surface over both the full PNG
 * graphics export (faithful sheets, metasprites, metatiles, animations, screens)
 * and the positioned BG-region export (BG1 area / BG2 / BG3, PNG or Aseprite
 * tilemap). A dropdown picks what's exported; Import auto-detects everything in a
 * folder. Below: the exported-folders list, the changed-graphics reset list, and
 * the panel log (the latest extract / import / reset outcome). (Map16 block editing was a
 * separate tab — removed from the UI for now; see the note at the top of this file.)
 */
export function GraphicsBody({
    level, projectScope, onMutated, onPaletteImported, paletteEditCount, onResetPalette, bg1RegionRect, pickingRegion, onStartRegionPick, onClearRegion
}: Props): JSX.Element {
    const [busy, setBusy] = useState(false)
    const [edits, setEdits] = useState<GfxEditEntry[]>([])
    // Per changed-file expandable "what this maps back to" detail (keyed by file).
    const [detail, setDetail] = useState<Record<string, GfxFileRole | 'loading'>>({})
    // A pending reset confirmation: a single file, or 'all'. null = no dialog.
    const [pendingReset, setPendingReset] = useState<GfxEditEntry | 'all' | 'palette' | null>(null)
    const [resetBusy, setResetBusy] = useState(false)
    const [resetError, setResetError] = useState<string | null>(null)
    // Active panel tab: 'extract' = the export/import body, 'yychr' = the
    // per-project YY-CHR browser. (A restored Map16 tab would slot back in here —
    // see the top-of-file note.)
    const [tab, setTab] = useState<PanelTab>(() => TAB_STORE.load().tab)
    const pickTab = (t: PanelTab): void => {
        setTab(t)
        TAB_STORE.save({tab: t})
    }
    // What the export dropdown targets, + the output format (PNG vs Aseprite — applies
    // to the BG regions and the screens; ignored by other tracks). Format defaults to
    // Aseprite once a tilemap-capable Aseprite is located (see the effect below); starts
    // at PNG so the first paint (before the async probe) is valid.
    const [target, setTarget] = useState<ExportTarget>('bg1')
    const [exportFormat, setExportFormat] = useState<BgRegionFormat>('png')
    // True once the user has picked a format by hand — suppresses the Aseprite auto-default
    // so it never overrides an explicit choice.
    const formatTouched = useRef(false)
    const pickFormat = (f: BgRegionFormat): void => { formatTouched.current = true; setExportFormat(f) }
    // Folders this project has exported to, + the panel log (latest extract / import / reset).
    const [folders, setFolders] = useState<string[]>([])
    // Exported .M1 session files per folder (clickable → open in M1TE), keyed by folder dir.
    const [m1Files, setM1Files] = useState<Record<string, M1ExportFile[]>>({})
    const [panelLog, setPanelLog] = useState<{ dir: string; lines: string[]; errors: string[]; warnings: string[] } | null>(null)
    // Located Aseprite + its probed version (for opening exported .aseprite projects,
    // and gating the tilemap-export option below).
    const [asepriteInfo, setAsepriteInfo] = useState<AsepriteInfo | null>(null)
    const [asepriteError, setAsepriteError] = useState<string | null>(null)
    // Located YY-CHR (settings-only — portable app), for the YY-CHR tab's
    // per-sheet Open buttons.
    const [yychrExe, setYychrExe] = useState<string | null>(null)
    const [yychrError, setYychrError] = useState<string | null>(null)
    const asepritePath = asepriteInfo?.path ?? null
    // The located Aseprite is POSITIVELY too old for tilemap `.aseprite` files (needs
    // 1.3+). Only fires on a parsed pre-1.3 version — not-located or an unknown version
    // leaves tilemap export available (the file still exports; the user may open it
    // elsewhere or on a newer Aseprite).
    const tilemapTooOld = !!asepriteInfo && asepriteInfo.version !== null && !asepriteInfo.supportsTilemap
    // "Auto-Open Exports": open a single-file region export in Aseprite (persisted; default on).
    const [autoOpen, setAutoOpen] = useState<boolean>(() => {
        try { return localStorage.getItem(AUTO_OPEN_KEY) !== 'false' } catch { return true }
    })
    const toggleAutoOpen = (v: boolean): void => {
        setAutoOpen(v)
        try { localStorage.setItem(AUTO_OPEN_KEY, v ? 'true' : 'false') } catch { /* ignore */ }
    }
    const header = headerFromLevel(level)
    const isRegion = isRegionTarget(target)
    // Aseprite output is available for the BG regions and the screens (assembled
    // tilemaps); other tracks stay PNG.
    const asepriteOk = isRegion || isAsepriteGfxTarget(target)
    // M1TE2 ".M1" session export — any BG layer, the World Map, or the system screens. BG2/BG3
    // map 1:1 to M1TE2's tilemap/CHR/palette; BG1 area exports an 8×8 tilemap synthesized from
    // its Map16 cells (pixel + palette only). World Map exports the overworld (one .M1 per world,
    // BG1+BG2+BG3) + a combined icons .M1 (all per-level icons in level order + marker +
    // castle). Boot/Story/Title exports the tilemap-based screens (title logo, island, storybook
    // scene) as one .M1 each. BG1 needs a selected area (the export gates on it). M1TE is bundled.
    const m1te2Ok = isRegion || target === 'worldmap' || target === 'systemscreens'
    // The format that will actually be USED for the current target — drives BOTH the radio
    // selection and the export call, so exactly one radio is checked even when a stale
    // selection lingers (e.g. an 'm1te2' pick after switching to a target that can't do it, or
    // an 'aseprite' pick once the located Aseprite is found too old). Falls back to PNG.
    const effectiveFormat: BgRegionFormat =
        m1te2Ok && exportFormat === 'm1te2' ? 'm1te2'
            : asepriteOk && !tilemapTooOld && (exportFormat === 'aseprite' || exportFormat === 'aseprite-layout') ? exportFormat
                : 'png'
    // Aseprite export is PIXEL editing only: `aseprite` = the 8×8-CHR pixel tilemap (the
    // foundational pixel unit; a shared CHR is one tile). The 16×16-word PLACEMENT export
    // (`aseprite-layout`, BG2/BG3) is still supported by the backend but has NO UI for now —
    // re-add a layout radio here (gated to BG2/BG3) to expose it. See research/graphics-editing.

    const refreshEdits = useCallback(async (): Promise<void> => {
        try { setEdits(await window.shinyEgg.editor.listGfxEdits()) } catch { setEdits([]) }
        setDetail({}) // edits changed → invalidate any open "what changed" details
    }, [])

    const toggleDetail = async (file: string): Promise<void> => {
        if (detail[file] !== undefined) {
            setDetail((d) => { const n = {...d}; delete n[file]; return n })
            return
        }
        setDetail((d) => ({...d, [file]: 'loading'}))
        try {
            const r = await window.shinyEgg.editor.gfxFileRole(file)
            setDetail((d) => ({...d, [file]: r}))
        } catch {
            setDetail((d) => ({...d, [file]: {roles: []}}))
        }
    }

    const detailText = (d: GfxFileRole): string =>
        d.roles.length ? `Maps to: ${d.roles.join(', ')}` : 'Couldn’t determine what this file maps to.'
    const refreshFolders = useCallback(async (): Promise<void> => {
        try {
            const dirs = await window.shinyEgg.editor.listRegionExports()
            setFolders(dirs)
            // Each folder's exported .M1 sessions (clickable to open in M1TE),
            // fetched in parallel. (YY-CHR sheets live in the YY-CHR tab's fixed
            // project folder now — no per-folder yychr detection here.)
            const entries = await Promise.all(
                dirs.map(async (dir) => [dir, await window.shinyEgg.editor.listM1Files(dir)] as const)
            )
            setM1Files(Object.fromEntries(entries))
        } catch {
            setFolders([])
            setM1Files({})
        }
    }, [])

    // Aseprite + YY-CHR are global settings (project-independent) — probe once on mount.
    useEffect(() => {
        window.shinyEgg.editor.getAsepriteExe().then(setAsepriteInfo).catch(() => setAsepriteInfo(null))
        window.shinyEgg.editor.getYychrExe().then(setYychrExe).catch(() => setYychrExe(null))
    }, [])

    // The exported-folders + changed-graphics lists are per-project. Re-fetch when the
    // project changes (switch / ROM import bumps projectScope) so the panel never shows
    // the previous project's extracts; clear the now-stale panel log too.
    useEffect(() => {
        void refreshEdits()
        void refreshFolders()
        setPanelLog(null)
    }, [projectScope, refreshEdits, refreshFolders])

    // A pre-1.3 Aseprite can't open tilemap exports — fall the format back to PNG so a
    // stale 'aseprite' selection can't reach the export call (the radio is disabled too).
    // M1TE2 doesn't use Aseprite, so its selection is left alone.
    useEffect(() => {
        if (tilemapTooOld && (exportFormat === 'aseprite' || exportFormat === 'aseprite-layout')) setExportFormat('png')
    }, [tilemapTooOld, exportFormat])

    // M1TE2 export is BG2/BG3 only — drop a stale 'm1te2' selection when the target moves
    // off the BG layers (so it can't reach the export call for BG1 / screens / metasprites).
    useEffect(() => {
        if (exportFormat === 'm1te2' && !m1te2Ok) setExportFormat('png')
    }, [m1te2Ok, exportFormat])

    // Pick the best default export format for the current target, until the user picks one by
    // hand (formatTouched). Prefer M1TE2 wherever it's offered — it's bundled (no external app)
    // and a single self-contained .M1 — then a located, tilemap-capable Aseprite, else PNG.
    // Re-runs on target change (m1te2Ok) and when the async Aseprite probe lands.
    useEffect(() => {
        if (formatTouched.current) return
        if (m1te2Ok) setExportFormat('m1te2')
        else if (asepriteOk && asepritePath && !tilemapTooOld) setExportFormat('aseprite')
        else setExportFormat('png')
    }, [m1te2Ok, asepriteOk, asepritePath, tilemapTooOld])

    const onLocateAseprite = async (): Promise<void> => {
        setAsepriteError(null)
        const r = await window.shinyEgg.editor.locateAseprite()
        // Re-probe the newly-picked exe (version → tilemap gate), not just the path.
        if (r.ok && r.path) setAsepriteInfo(await window.shinyEgg.editor.getAsepriteExe())
        else if (r.error) setAsepriteError(r.error)
    }

    const onLocateYychr = async (): Promise<string | null> => {
        setYychrError(null)
        const r = await window.shinyEgg.editor.locateYychr()
        if (r.ok && r.path) { setYychrExe(r.path); return r.path }
        if (r.error) setYychrError(r.error)
        return null
    }

    // Open one exported sheet in YY-CHR; locate the exe first if it isn't yet.
    const onOpenYychr = async (dir: string, file: string): Promise<void> => {
        if (!yychrExe && !(await onLocateYychr())) return
        if (!(await window.shinyEgg.editor.openInYychr(dir, file))) {
            setYychrError('Couldn’t open YY-CHR — re-locate the executable?')
        }
    }

    const onExport = async (): Promise<void> => {
        // The screen tracks are non-level-dependent — exportable with no level loaded;
        // every other target needs the loaded level's header + palette.
        if (!isLevelIndependent(target) && (!header || !level)) return
        if (target === 'bg1' && !bg1RegionRect) { setPanelLog({ dir: '', lines: [], errors: [], warnings: ['Select an area on the canvas first (shift-drag).'] }); return }
        setBusy(true)
        setPanelLog(null)
        // A pre-1.3 Aseprite can't open tilemaps; never emit them (belt-and-braces with
        // the disabled radio + the coercion effect). M1TE2 isn't gated by the Aseprite version.
        // `effectiveFormat` already resolves m1te2/aseprite/png for the current target.
        const fmt: BgRegionFormat = effectiveFormat
        if (isRegion) {
            // isRegion ⇒ a BG layer (never a screen track), so the guard above ensured header+level.
            const r = await window.shinyEgg.editor.exportBgRegion(header!, {
                layer: regionLayerOf(target),
                rect: target === 'bg1' ? (bg1RegionRect ?? undefined) : undefined,
                level: level!,
                format: fmt
            })
            setBusy(false)
            if ('canceled' in r) return
            if (r.ok) {
                setPanelLog({ dir: '', lines: [`Extracted ${r.file} (${r.cells} editable cells) to ${folderName(r.dir)}`], errors: [], warnings: r.warning ? [r.warning] : [] })
                await refreshFolders()
                // Auto-open the export in its editor: M1TE for a .M1 (bundled — always
                // available, opened straight to this BG layer); Aseprite otherwise (PNG /
                // .aseprite), when located. The .M1 isn't an Aseprite file, so the two are
                // mutually exclusive.
                if (autoOpen) {
                    if (fmt === 'm1te2') void window.shinyEgg.editor.openInM1te(r.dir, r.file, regionLayerOf(target))
                    else if (asepritePath) void window.shinyEgg.editor.openInAseprite(r.dir, r.file)
                }
            } else setPanelLog({ dir: '', lines: [], errors: [`Extract failed: ${r.error}`], warnings: [] })
            return
        }
        // Screens + metasprites export PNG or Aseprite; the World Map can also export M1TE2
        // (`.M1` sessions — its files appear in the per-folder "open in M1TE" list below).
        // The island's Aseprite is a COMBINED tilemap (pixels + placement + added tiles).
        const gfxFmt: 'png' | 'aseprite' | 'm1te2' =
            (target === 'worldmap' || target === 'systemscreens') && fmt === 'm1te2' ? 'm1te2'
                : isAsepriteGfxTarget(target) && fmt !== 'png' ? 'aseprite'
                    : 'png'
        const r = await window.shinyEgg.editor.exportGfxPngs(header, {
            tracks: gfxTracksOf(target),
            spriteNames: allSpriteNames(),
            format: gfxFmt
        })
        setBusy(false)
        if ('canceled' in r) return
        if (r.ok) {
            const unit = gfxFmt === 'png' ? 'PNG' : 'file'
            setPanelLog({ dir: '', lines: [`Extracted ${r.count} ${unit}${r.count === 1 ? '' : 's'} to ${folderName(r.dir)}`], errors: [], warnings: [] })
            await refreshFolders()
        } else setPanelLog({ dir: '', lines: [], errors: [`Extract failed: ${r.error}`], warnings: [] })
    }

    // Shared display for an import result (per-folder button or the ad-hoc dialog).
    const applyImportResult = async (
        r: Awaited<ReturnType<typeof window.shinyEgg.editor.importGraphics>>
    ): Promise<void> => {
        if ('canceled' in r) return
        if (!r.ok) { setPanelLog({dir: '', lines: [], errors: [r.error], warnings: []}); return }
        if (r.changed > 0) onMutated()
        // Palette recolors were persisted behind the edit-session's back — tell the app to
        // reload its palette draft so the canvas live-preview shows the imported colors.
        if (r.paletteChanged > 0) onPaletteImported()
        setPanelLog({dir: r.dir, lines: r.log, errors: r.errors, warnings: r.warnings})
        await refreshEdits()
        await refreshFolders()
    }
    // Run an import (folder-dialog or a tracked folder), gating busy + clearing the log.
    const runImport = async (
        fetch: () => ReturnType<typeof window.shinyEgg.editor.importGraphics>
    ): Promise<void> => {
        setBusy(true); setPanelLog(null)
        try { await applyImportResult(await fetch()) } finally { setBusy(false) }
    }
    const onImportDialog = (): Promise<void> => runImport(() => window.shinyEgg.editor.importGraphics())
    const onImportFolder = (dir: string): Promise<void> => runImport(() => window.shinyEgg.editor.importGraphicsFolder(dir))
    const onRemoveFolder = async (dir: string): Promise<void> => {
        setFolders(await window.shinyEgg.editor.removeRegionExport(dir))
    }

    const doReset = async (): Promise<void> => {
        if (!pendingReset) return
        const which = pendingReset
        // Palette colors live in a separate overlay (the App-level palette draft), not the
        // gfx-file list — resetting them clears the draft, which repaints the live preview.
        if (which === 'palette') {
            onResetPalette()
            setPendingReset(null)
            // Report into the panel log (the unified extract / import / reset log) so a later import clears it.
            setPanelLog({ dir: '', lines: ['Reset palette colors to vanilla.'], errors: [], warnings: [] })
            return
        }
        const targets = which === 'all' ? edits : [which]
        setResetBusy(true)
        setResetError(null)
        let removed = 0
        const errors: string[] = []
        for (const e of targets) {
            const r = await window.shinyEgg.editor.resetGfxEditFile(e.file)
            if (r.ok) { if (r.removed) removed++ }
            else errors.push(`${e.label}: ${r.error ?? 'failed'}`)
        }
        setResetBusy(false)
        if (errors.length) { setResetError(errors.join('; ')); return }
        // "Reset all" also clears the palette (it's a graphics change too) so the canvas
        // reverts the imported/edited colors, not just the CHR.
        const resetPalette = which === 'all' && paletteEditCount > 0
        if (resetPalette) onResetPalette()
        setPendingReset(null)
        if (removed > 0) onMutated()
        // Report into the panel log (the unified extract / import / reset log) so a later import clears it.
        setPanelLog({ dir: '', lines: [`Reset ${removed} file${removed === 1 ? '' : 's'}${resetPalette ? ' + palette colors' : ''} to vanilla.`], errors: [], warnings: [] })
        await refreshEdits()
    }

    const resetTitle =
        pendingReset === 'all' ? 'Reset all graphics' : pendingReset === 'palette' ? 'Reset palette colors' : 'Reset graphics file'
    const resetBody =
        pendingReset === 'all'
            ? `Reset all ${edits.length} changed graphics file${edits.length === 1 ? '' : 's'}${paletteEditCount > 0 ? ' + the palette colors' : ''} back to vanilla? ` +
            'Your imported edits will be discarded. Rebuild to apply.'
            : pendingReset === 'palette'
                ? `Reset all ${paletteEditCount} edited palette color${paletteEditCount === 1 ? '' : 's'} back to vanilla? Your imported / edited colors will be discarded.`
                : pendingReset
                    ? `Reset “${pendingReset.label}” back to vanilla? Your imported edits to this file will be discarded. Rebuild to apply.`
                    : ''

    return (
        <div className="se-graphics">
            <div className="se-graphics__aseprite">
                {asepritePath ? (
                    <span
                        className="se-graphics__aseprite-status"
                        title={`${asepritePath}\n(click to change)`}
                        onClick={() => void onLocateAseprite()}
                    >
                        Aseprite: <code>{asepritePath.split(/[\\/]/).slice(-2).join('/')}</code>
                    </span>
                ) : (
                    <button
                        className="se-banks__act"
                        onClick={() => void onLocateAseprite()}
                        title="Pick the Aseprite executable, for opening exported .aseprite projects"
                    >
                        Locate Aseprite…
                    </button>
                )}
                {(asepritePath || effectiveFormat === 'm1te2') && (
                    <label
                        className="se-graphics__radio"
                        title={
                            effectiveFormat === 'm1te2'
                                ? 'After extracting, open the .M1 in M1TE automatically (straight to this BG layer)'
                                : 'After extracting a single region file, open it in Aseprite automatically'
                        }
                    >
                        <input type="checkbox" checked={autoOpen} onChange={(e) => toggleAutoOpen(e.target.checked)} />
                        Auto-Open Extracts
                    </label>
                )}
                {asepriteError && <span className="se-graphics__log-error">⚠ {asepriteError}</span>}
            </div>
            <div className="se-graphics__aseprite">
                {yychrExe ? (
                    <span
                        className="se-graphics__aseprite-status"
                        title={`${yychrExe}\n(click to change)`}
                        onClick={() => void onLocateYychr()}
                    >
                        YY-CHR: <code>{yychrExe.split(/[\\/]/).slice(-2).join('/')}</code>
                    </span>
                ) : (
                    <button
                        className="se-banks__act"
                        onClick={() => void onLocateYychr()}
                        title="Pick the YY-CHR executable, for opening exported tile sheets"
                    >
                        Locate YY-CHR…
                    </button>
                )}
                {yychrError && <span className="se-graphics__log-error">⚠ {yychrError}</span>}
            </div>

            {/* Three tabs: the extract/import body, the per-project YY-CHR sheet browser,
                and the per-project M1TE map browser. (A restored Map16 tab — see the
                top-of-file note — would be a fourth `se-tab` + branch here.) */}
            <div className="se-tabs se-graphics__tabs">
                <button
                    className={`se-tab${tab === 'extract' ? ' is-active' : ''}`}
                    onClick={() => pickTab('extract')}
                >
                    Extract / Import
                </button>
                <button
                    className={`se-tab${tab === 'yychr' ? ' is-active' : ''}`}
                    onClick={() => pickTab('yychr')}
                >
                    YY-CHR Graphics
                </button>
                <button
                    className={`se-tab${tab === 'm1te' ? ' is-active' : ''}`}
                    onClick={() => pickTab('m1te')}
                >
                    M1TE Maps
                </button>
            </div>
            {tab === 'yychr' ? (
                // Remounted per project (key) so browser state never leaks across a switch.
                <YychrTab
                    key={projectScope ?? ''}
                    yychrExe={yychrExe}
                    onOpenYychr={onOpenYychr}
                    onMutated={onMutated}
                    onImported={refreshEdits}
                />
            ) : tab === 'm1te' ? (
                <M1teMapsTab
                    key={projectScope ?? ''}
                    onMutated={onMutated}
                    onImported={refreshEdits}
                />
            ) : (
            <div className="se-graphics__region">
                <p className="se-graphics__desc">
                    Extract the level’s graphics to a folder, edit them in any image editor (or
                    Aseprite), then import the folder back — only changed tiles are saved.
                    Pick <strong>what</strong> to extract below; <code>BG1 area</code> extracts the
                    rectangle you select on the canvas, the other <code>BG</code> layers the whole
                    tilemap, <code>World Map</code> the overworld map graphics,{' '}
                    <code>Boot/Story/Title Screens</code> the boot / title / storybook graphics, and{' '}
                    <code>Message Font / Pictures</code> the message font + message-box pictures.
                    The <code>BG</code> layers and the <code>World Map</code> can also extract an{' '}
                    <code>M1TE2</code> session (each BG layer as one <code>.M1</code>;
                    the World Map as one <code>.M1</code> per world + a combined icons file). Import auto-detects everything in the folder.
                </p>

                <div className="se-graphics__row">
                    <span className="se-graphics__status">Extract:</span>
                    <select
                        className="se-input se-graphics__select"
                        value={target}
                        onChange={(e) => setTarget(e.target.value as ExportTarget)}
                    >
                        {TARGETS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                </div>

                {target === 'bg1' && (
                    <div className="se-graphics__row">
                        <button
                            className={`se-banks__act${pickingRegion ? ' is-active' : ''}`}
                            onClick={onStartRegionPick}
                            disabled={!header}
                            title="Then shift-drag a rectangle on the canvas"
                        >
                            {pickingRegion ? 'Shift-drag on canvas…' : 'Select area…'}
                        </button>
                        {bg1RegionRect && (
                            <>
                                <span className="se-graphics__status">
                                    {bg1RegionRect.cols}×{bg1RegionRect.rows} cells at ({bg1RegionRect.col0},{bg1RegionRect.row0})
                                </span>
                                <button className="se-graphics__item-reset" onClick={onClearRegion}>Clear</button>
                            </>
                        )}
                    </div>
                )}

                <div className="se-graphics__row">
                    <label
                        className="se-graphics__radio"
                        title={
                            !m1te2Ok
                                ? 'M1TE2 extract is for the BG layers (BG1 area / BG2 / BG3), the World Map, and the Boot/Story/Title screens'
                                : target === 'worldmap'
                                    ? 'Extract the overworld (one .M1 per world) + a combined icons .M1 (all level icons + marker/castle) for M1TE'
                                    : target === 'systemscreens'
                                        ? 'Extract the tilemap-based screens (title island, storybook scene, the six bonus games) as one .M1 each for M1TE'
                                        : 'Extract an M1TE2 .M1 session (tilemap + CHR + palette) — one file for the whole BG layer (BG1 area = pixel + palette only)'
                        }
                    >
                        <input
                            type="radio"
                            name="se-gfx-format"
                            checked={effectiveFormat === 'm1te2'}
                            disabled={!m1te2Ok}
                            onChange={() => pickFormat('m1te2')}
                        />
                        M1TE2 (.M1)
                    </label>
                    <label
                        className="se-graphics__radio"
                        title={
                            tilemapTooOld
                                ? `Aseprite ${asepriteInfo?.version} can’t open tilemap extracts — needs 1.3+`
                                : asepriteOk
                                    ? (isRegion ? 'Edit pixels at 8×8 — a shared CHR tile is one Aseprite tile' : '')
                                    : 'Aseprite extract is for the BG layers, the screens, the Bosses arena, the message font / pictures, and metasprites'
                        }
                    >
                        <input
                            type="radio"
                            name="se-gfx-format"
                            checked={effectiveFormat === 'aseprite'}
                            disabled={!asepriteOk || tilemapTooOld}
                            onChange={() => pickFormat('aseprite')}
                        />
                        Aseprite
                    </label>
                    <label className="se-graphics__radio">
                        <input
                            type="radio"
                            name="se-gfx-format"
                            checked={effectiveFormat === 'png'}
                            onChange={() => pickFormat('png')}
                        />
                        PNG
                    </label>
                </div>
                {tilemapTooOld && (
                    <p className="se-graphics__log-error" title={asepritePath ?? undefined}>
                        ⚠ Aseprite {asepriteInfo?.version} can’t open tilemap extracts (tilemaps were added in 1.3).
                        Extracting as PNG — update Aseprite to use the tilemap format.
                    </p>
                )}

                <div className="se-graphics__row">
                    <button
                        className="se-banks__act"
                        onClick={() => void onExport()}
                        disabled={busy || (!isLevelIndependent(target) && !header) || (target === 'bg1' && !bg1RegionRect)}
                        title={header || isLevelIndependent(target) ? 'Extract the selected target to a folder' : 'Load a level first (screen/font extracts need no level)'}
                    >
                        Extract…
                    </button>
                    <button
                        className="se-banks__act"
                        onClick={() => void onImportDialog()}
                        disabled={busy}
                        title="Import an edited folder that isn't in the list below"
                    >
                        Import folder…
                    </button>
                </div>

                {panelLog && (
                    <div className="se-graphics__log">
                        {panelLog.dir && (
                            <p className="se-graphics__status" title={panelLog.dir}>
                                Imported from {folderName(panelLog.dir)}
                            </p>
                        )}
                        {panelLog.lines.map((line, i) => (
                            <p key={`l${i}`} className="se-graphics__log-line">{line}</p>
                        ))}
                        {panelLog.errors.map((err, i) => (
                            <p key={`e${i}`} className="se-graphics__log-error">⚠ {err}</p>
                        ))}
                        {panelLog.warnings.map((warn, i) => (
                            <p key={`w${i}`} className="se-graphics__log-warning">⚠ {warn}</p>
                        ))}
                    </div>
                )}

                <div className="se-graphics__changes">
                    <div className="se-graphics__changes-head">
                        <span className="se-graphics__changes-title">Extracted folders ({folders.length})</span>
                    </div>
                    {folders.length === 0 ? (
                        <p className="se-graphics__changes-empty">
                            No extracts yet — extract above and its folder is listed here.
                        </p>
                    ) : (
                        <ul className="se-graphics__list">
                            {folders.map((dir) => (
                                <li key={dir} className="se-graphics__item se-graphics__folder">
                                    <div className="se-graphics__folder-row">
                                        <span
                                            className="se-graphics__item-label se-graphics__item-label--link"
                                            title={`${dir}\n(click to open)`}
                                            onClick={() => void window.shinyEgg.editor.openRegionFolder(dir)}
                                        >
                                            {folderName(dir)}
                                        </span>
                                        <button
                                            className="se-graphics__item-reset"
                                            onClick={() => void onImportFolder(dir)}
                                            disabled={busy}
                                            title={`Import everything in ${dir}`}
                                        >
                                            Import changes
                                        </button>
                                        <button
                                            className="se-graphics__item-reset"
                                            onClick={() => void onRemoveFolder(dir)}
                                            disabled={busy}
                                            title="Remove from list (does not delete the files)"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                    {(m1Files[dir]?.length ?? 0) > 0 && (
                                        <ul className="se-graphics__m1-list">
                                            {m1Files[dir]!.map((m) => (
                                                <li key={m.file} className="se-graphics__m1-item">
                                                    <span
                                                        className="se-graphics__item-label se-graphics__item-label--link"
                                                        title={`Open ${m.file} in M1TE (BG${m.layer})`}
                                                        onClick={() => void window.shinyEgg.editor.openInM1te(dir, m.file, m.layer)}
                                                    >
                                                        {m.file} <span className="se-graphics__tag">BG{m.layer}</span>
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <div className="se-graphics__changes">
                    <div className="se-graphics__changes-head">
                        <span className="se-graphics__changes-title">Changed graphics ({edits.length + (paletteEditCount > 0 ? 1 : 0)})</span>
                        {(edits.length > 0 || paletteEditCount > 0) && (
                            <button
                                className="se-banks__act se-banks__act--danger"
                                onClick={() => setPendingReset('all')}
                                disabled={busy || resetBusy}
                                title="Reset every changed graphics file (and the palette) back to vanilla"
                            >
                                Reset all…
                            </button>
                        )}
                    </div>
                    {edits.length === 0 && paletteEditCount === 0 ? (
                        <p className="se-graphics__changes-empty">No graphics edited yet.</p>
                    ) : (
                        <ul className="se-graphics__list">
                            {paletteEditCount > 0 && (
                                <li className="se-graphics__item">
                                    <span className="se-graphics__item-label" title="Master-palette color edits (imported or edited here / in the Palette panel)">
                                        Palette colors
                                    </span>
                                    <span className="se-graphics__item-size">
                                        {paletteEditCount} {paletteEditCount === 1 ? 'color' : 'colors'} changed
                                    </span>
                                    <button
                                        className="se-graphics__item-reset"
                                        onClick={() => setPendingReset('palette')}
                                        disabled={busy || resetBusy}
                                        title="Reset every palette color back to vanilla"
                                    >
                                        Reset
                                    </button>
                                </li>
                            )}
                            {edits.map((e) => {
                                const fname = e.file.split('/').pop() ?? e.file
                                return (
                                <Fragment key={e.file}>
                                    <li className="se-graphics__item">
                                        <button
                                            className="se-graphics__item-caret"
                                            onClick={() => void toggleDetail(e.file)}
                                            title="Show what this file maps to"
                                        >
                                            {detail[e.file] !== undefined ? '▾' : '▸'}
                                        </button>
                                        <span className="se-graphics__item-label" title={e.file}>
                                            {e.label}
                                            {e.kind === 'raw-chr' && <span className="se-graphics__tag">shared</span>}
                                            {/* Show the on-disk filename alongside the friendly label (e.g.
                                                "Gfx file 0x2F (LZ2)  GFX_58A2CD.lz2"), unless the label already
                                                IS the filename (unknown-id blobs / by-name raw rows). */}
                                            {!e.label.includes(fname) && <span className="se-graphics__item-file">{fname}</span>}
                                        </span>
                                        <span className="se-graphics__item-size" title={`${sizeLabel(e.bytes)} on disk`}>
                                            {e.change ? changeBadge(e.change) : sizeLabel(e.bytes)}
                                        </span>
                                        <button
                                            className="se-graphics__item-reset"
                                            onClick={() => setPendingReset(e)}
                                            disabled={busy || resetBusy}
                                            title="Reset this file back to vanilla"
                                        >
                                            Reset
                                        </button>
                                    </li>
                                    {detail[e.file] !== undefined && (
                                        <li className="se-graphics__detail">
                                            {e.change && <div>{changeSentence(e.change)}</div>}
                                            <div>
                                                {detail[e.file] === 'loading'
                                                    ? 'Loading…'
                                                    : detailText(detail[e.file] as GfxFileRole)}
                                            </div>
                                        </li>
                                    )}
                                </Fragment>
                                )
                            })}
                        </ul>
                    )}
                </div>

                <DiscardChangesModal
                    open={pendingReset !== null}
                    title={resetTitle}
                    body={resetBody}
                    saving={resetBusy}
                    error={resetError}
                    confirmLabel="Reset"
                    danger
                    onDiscard={() => void doReset()}
                    onCancel={() => {
                        if (!resetBusy) {
                            setPendingReset(null)
                            setResetError(null)
                        }
                    }}
                />
            </div>
            )}
        </div>
    )
}
