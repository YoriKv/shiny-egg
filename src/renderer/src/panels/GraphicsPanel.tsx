import {Fragment, useCallback, useEffect, useState, type JSX} from 'react'
import type {BgRegionLayer, BgRegionRect, BgRegionFormat, GfxExportTrack, GfxEditEntry, GfxFileRole, LevelData} from '../../../preload/api'
import {DiscardChangesModal} from '../DiscardChangesModal'
import {headerFromLevel} from './TilesPanel'
import {getSprite} from '../data/obj-metadata'
import {Map16Body} from './Map16Panel'

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

/** Last path segment of a folder, for a compact list label (full path in title). */
const folderName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/** Versioned localStorage key for the "Auto-Open Exports" preference (default on). */
const AUTO_OPEN_KEY = 'shinyEgg.autoOpenExports.v1'

/** What the export dropdown writes. `metasprites`/`screens` are gfx-export tracks;
 *  BG1/2/3 are the positioned-region export. Aseprite is available for the BG regions,
 *  the screens (the title logo + island assemble as real tilemaps), and metasprites. */
type ExportTarget = 'screens' | 'metasprites' | 'bg1' | 'bg2' | 'bg3'
// `metasprites` is intentionally omitted from the dropdown for now (export removed from
// the UI). The implementation is kept — engine `sprite-metasprite.ts`, the
// `tracks:['metasprites']` exportGfxPngs path, and the import auto-detect all still work;
// re-add `{value:'metasprites', label:'Metasprites'}` here to expose it again.
const TARGETS: { value: ExportTarget; label: string }[] = [
    {value: 'bg1', label: 'BG1 area'},
    {value: 'bg2', label: 'BG2'},
    {value: 'bg3', label: 'BG3'},
    {value: 'screens', label: 'Screens'}
]
const isRegionTarget = (t: ExportTarget): boolean => t === 'bg1' || t === 'bg2' || t === 'bg3'
const regionLayerOf = (t: ExportTarget): BgRegionLayer => (t === 'bg1' ? 1 : t === 'bg2' ? 2 : 3)
// Targets whose Aseprite output goes through the gfx-png export (screens = assembled
// tilemaps + single-image icons/scenery; metasprites = single-image-with-palette
// projects). The BG regions use the separate exportBgRegion path.
const isAsepriteGfxTarget = (t: ExportTarget): boolean => t === 'screens' || t === 'metasprites'
const gfxTracksOf = (t: ExportTarget): GfxExportTrack[] => (t === 'metasprites' ? ['metasprites'] : ['screens'])

interface Props {
    /** The level currently loaded in the canvas — its palette colours the export. */
    level: LevelData | null
    /** Called after an import or reset changes files (mark the build dirty). */
    onMutated: () => void
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
 * the last import's log. (Map16 block editing is a separate tab.)
 */
export function GraphicsBody({
    level, onMutated, bg1RegionRect, pickingRegion, onStartRegionPick, onClearRegion
}: Props): JSX.Element {
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState<string | null>(null)
    const [edits, setEdits] = useState<GfxEditEntry[]>([])
    // Per changed-file expandable "what this maps back to" detail (keyed by file).
    const [detail, setDetail] = useState<Record<string, GfxFileRole | 'loading'>>({})
    // A pending reset confirmation: a single file, or 'all'. null = no dialog.
    const [pendingReset, setPendingReset] = useState<GfxEditEntry | 'all' | null>(null)
    const [resetBusy, setResetBusy] = useState(false)
    const [resetError, setResetError] = useState<string | null>(null)
    const [tab, setTab] = useState<'gfx' | 'map16'>('gfx')
    // What the export dropdown targets, + the output format (PNG vs Aseprite — applies
    // to the BG regions and the screens; ignored by other tracks).
    const [target, setTarget] = useState<ExportTarget>('bg1')
    const [exportFormat, setExportFormat] = useState<BgRegionFormat>('png')
    // Folders this project has exported to, + the last import's log.
    const [folders, setFolders] = useState<string[]>([])
    const [importLog, setImportLog] = useState<{ dir: string; lines: string[]; errors: string[] } | null>(null)
    // Located Aseprite executable (for opening exported .aseprite projects).
    const [asepritePath, setAsepritePath] = useState<string | null>(null)
    const [asepriteError, setAsepriteError] = useState<string | null>(null)
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
        try { setFolders(await window.shinyEgg.editor.listRegionExports()) } catch { setFolders([]) }
    }, [])

    useEffect(() => {
        void refreshEdits()
        void refreshFolders()
        window.shinyEgg.editor.getAsepriteExe().then(setAsepritePath).catch(() => setAsepritePath(null))
    }, [refreshEdits, refreshFolders])

    const onLocateAseprite = async (): Promise<void> => {
        setAsepriteError(null)
        const r = await window.shinyEgg.editor.locateAseprite()
        if (r.ok && r.path) setAsepritePath(r.path)
        else if (r.error) setAsepriteError(r.error)
    }

    const onExport = async (): Promise<void> => {
        // Screens are non-level-dependent — exportable with no level loaded; every other
        // target needs the loaded level's header + palette.
        if (target !== 'screens' && (!header || !level)) return
        if (target === 'bg1' && !bg1RegionRect) { setStatus('Select an area on the canvas first (shift-drag).'); return }
        setBusy(true)
        setStatus(null)
        if (isRegion) {
            // isRegion ⇒ a BG layer (never 'screens'), so the guard above ensured header+level.
            const r = await window.shinyEgg.editor.exportBgRegion(header!, {
                layer: regionLayerOf(target),
                rect: target === 'bg1' ? (bg1RegionRect ?? undefined) : undefined,
                level: level!,
                format: exportFormat
            })
            setBusy(false)
            if ('canceled' in r) return
            if (r.ok) {
                setStatus(`Exported ${r.file} (${r.cells} editable cells) to ${folderName(r.dir)}`)
                await refreshFolders()
                if (autoOpen && asepritePath) void window.shinyEgg.editor.openInAseprite(r.dir, r.file)
            } else setStatus(`Export failed: ${r.error}`)
            return
        }
        // Screens + metasprites export PNG or Aseprite. The island's Aseprite is a
        // COMBINED tilemap (pixels + placement + added tiles in one file).
        const gfxFmt: 'png' | 'aseprite' = isAsepriteGfxTarget(target) && exportFormat !== 'png' ? 'aseprite' : 'png'
        const r = await window.shinyEgg.editor.exportGfxPngs(header, {
            tracks: gfxTracksOf(target),
            spriteNames: allSpriteNames(),
            format: gfxFmt
        })
        setBusy(false)
        if ('canceled' in r) return
        if (r.ok) {
            const unit = gfxFmt === 'png' ? 'PNG' : 'file'
            setStatus(`Exported ${r.count} ${unit}${r.count === 1 ? '' : 's'} to ${folderName(r.dir)}`)
            await refreshFolders()
        } else setStatus(`Export failed: ${r.error}`)
    }

    // Shared display for an import result (per-folder button or the ad-hoc dialog).
    const applyImportResult = async (
        r: Awaited<ReturnType<typeof window.shinyEgg.editor.importGraphics>>
    ): Promise<void> => {
        if ('canceled' in r) return
        if (!r.ok) { setImportLog({dir: '', lines: [], errors: [r.error]}); return }
        if (r.changed > 0) onMutated()
        setImportLog({dir: r.dir, lines: r.log, errors: r.errors})
        await refreshEdits()
        await refreshFolders()
    }
    // Run an import (folder-dialog or a tracked folder), gating busy + clearing the log.
    const runImport = async (
        fetch: () => ReturnType<typeof window.shinyEgg.editor.importGraphics>
    ): Promise<void> => {
        setBusy(true); setImportLog(null)
        try { await applyImportResult(await fetch()) } finally { setBusy(false) }
    }
    const onImportDialog = (): Promise<void> => runImport(() => window.shinyEgg.editor.importGraphics())
    const onImportFolder = (dir: string): Promise<void> => runImport(() => window.shinyEgg.editor.importGraphicsFolder(dir))
    const onRemoveFolder = async (dir: string): Promise<void> => {
        setFolders(await window.shinyEgg.editor.removeRegionExport(dir))
    }

    const doReset = async (): Promise<void> => {
        if (!pendingReset) return
        const targets = pendingReset === 'all' ? edits : [pendingReset]
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
        setPendingReset(null)
        if (removed > 0) onMutated()
        setStatus(`Reset ${removed} file${removed === 1 ? '' : 's'} to vanilla.`)
        await refreshEdits()
    }

    const resetTitle = pendingReset === 'all' ? 'Reset all graphics' : 'Reset graphics file'
    const resetBody =
        pendingReset === 'all'
            ? `Reset all ${edits.length} changed graphics file${edits.length === 1 ? '' : 's'} back to vanilla? ` +
            'Your imported edits to these files will be discarded. Rebuild to apply.'
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
                {asepritePath && (
                    <label
                        className="se-graphics__radio"
                        title="After exporting a single region file, open it in Aseprite automatically"
                    >
                        <input type="checkbox" checked={autoOpen} onChange={(e) => toggleAutoOpen(e.target.checked)} />
                        Auto-Open Exports
                    </label>
                )}
                {asepriteError && <span className="se-graphics__log-error">⚠ {asepriteError}</span>}
            </div>

            <div className="se-graphics__tabs">
                <button
                    className={`se-graphics__tab${tab === 'gfx' ? ' se-graphics__tab--active' : ''}`}
                    onClick={() => setTab('gfx')}
                >
                    Export / Import
                </button>
                <button
                    className={`se-graphics__tab${tab === 'map16' ? ' se-graphics__tab--active' : ''}`}
                    onClick={() => setTab('map16')}
                    title="Edit Map16 object blocks — which tile / palette / flip each quadrant uses"
                >
                    Map16 Blocks
                </button>
            </div>

            {tab === 'map16' ? (
                <Map16Body level={level} onMutated={onMutated}/>
            ) : (
                <div className="se-graphics__region">
                    <p className="se-graphics__desc">
                        Export the level’s graphics to a folder, edit them in any image editor (or
                        Aseprite), then import the folder back — only changed tiles are saved.
                        Pick <strong>what</strong> to export below; <code>BG1 area</code> exports the
                        rectangle you select on the canvas, the other <code>BG</code> layers the whole
                        tilemap, and <code>Screens</code> the system / title / overworld graphics.
                        Import auto-detects everything in the folder.
                    </p>

                    <div className="se-graphics__row">
                        <span className="se-graphics__status">Export:</span>
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
                        <label className="se-graphics__radio">
                            <input
                                type="radio"
                                name="se-gfx-format"
                                checked={!asepriteOk || exportFormat === 'png'}
                                onChange={() => setExportFormat('png')}
                            />
                            PNG
                        </label>
                        <label
                            className="se-graphics__radio"
                            title={asepriteOk ? (isRegion ? 'Edit pixels at 8×8 — a shared CHR tile is one Aseprite tile' : '') : 'Aseprite export is for the BG layers, the screens, and metasprites'}
                        >
                            <input
                                type="radio"
                                name="se-gfx-format"
                                checked={asepriteOk && exportFormat === 'aseprite'}
                                disabled={!asepriteOk}
                                onChange={() => setExportFormat('aseprite')}
                            />
                            Aseprite (tilemap)
                        </label>
                    </div>

                    <div className="se-graphics__row">
                        <button
                            className="se-banks__act"
                            onClick={() => void onExport()}
                            disabled={busy || (target !== 'screens' && !header) || (target === 'bg1' && !bg1RegionRect)}
                            title={header || target === 'screens' ? 'Export the selected target to a folder' : 'Load a level first (Screens export needs no level)'}
                        >
                            Export…
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
                    {status && <p className="se-graphics__status">{status}</p>}

                    <div className="se-graphics__changes">
                        <div className="se-graphics__changes-head">
                            <span className="se-graphics__changes-title">Exported folders ({folders.length})</span>
                        </div>
                        {folders.length === 0 ? (
                            <p className="se-graphics__changes-empty">
                                No exports yet — export above and its folder is listed here.
                            </p>
                        ) : (
                            <ul className="se-graphics__list">
                                {folders.map((dir) => (
                                    <li key={dir} className="se-graphics__item">
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
                                            Import
                                        </button>
                                        <button
                                            className="se-graphics__item-reset"
                                            onClick={() => void onRemoveFolder(dir)}
                                            disabled={busy}
                                            title="Remove from list (does not delete the files)"
                                        >
                                            ✕
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <div className="se-graphics__changes">
                        <div className="se-graphics__changes-head">
                            <span className="se-graphics__changes-title">Changed graphics ({edits.length})</span>
                            {edits.length > 0 && (
                                <button
                                    className="se-banks__act se-banks__act--danger"
                                    onClick={() => setPendingReset('all')}
                                    disabled={busy || resetBusy}
                                    title="Reset every changed graphics file back to vanilla"
                                >
                                    Reset all…
                                </button>
                            )}
                        </div>
                        {edits.length === 0 ? (
                            <p className="se-graphics__changes-empty">No graphics edited yet.</p>
                        ) : (
                            <ul className="se-graphics__list">
                                {edits.map((e) => (
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
                                            </span>
                                            <span className="se-graphics__item-size">{sizeLabel(e.bytes)}</span>
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
                                                {detail[e.file] === 'loading'
                                                    ? 'Loading…'
                                                    : detailText(detail[e.file] as GfxFileRole)}
                                            </li>
                                        )}
                                    </Fragment>
                                ))}
                            </ul>
                        )}
                    </div>

                    {importLog && (
                        <div className="se-graphics__log">
                            {importLog.dir && (
                                <p className="se-graphics__status" title={importLog.dir}>
                                    Imported from {folderName(importLog.dir)}
                                </p>
                            )}
                            {importLog.lines.map((line, i) => (
                                <p key={`l${i}`} className="se-graphics__log-line">{line}</p>
                            ))}
                            {importLog.errors.map((err, i) => (
                                <p key={`e${i}`} className="se-graphics__log-error">⚠ {err}</p>
                            ))}
                        </div>
                    )}

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
