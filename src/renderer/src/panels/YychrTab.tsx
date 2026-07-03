import {memo, useCallback, useEffect, useMemo, useRef, useState, type JSX} from 'react'
import type {YychrProjectFile, YychrProjectState, YychrThumbnail} from '../../../preload/api'
import {blitRgba} from '../lib/blit'
import {HoverPreview} from '../lib/hover-preview'
import {persistedState} from '../lib/persisted-state'
import {DiscardChangesModal} from '../DiscardChangesModal'

/**
 * The Graphics panel's YY-CHR tab: a browser over the project's fixed yychr export
 * folder (`<projectRoot>/yychr/`). Every sheet shows its on-disk thumbnail (so
 * edits saved in YY-CHR preview BEFORE import), details, and a change status from
 * the same checksum gate the import uses; changed sheets import per-file or all at
 * once, through the shared reconciler → live-preview path. Status refreshes when
 * the editor window regains focus (the alt-tab-back-from-YY-CHR moment), after
 * every action, and on the Refresh button — no fs watcher.
 *
 * The parent remounts this component per project (`key={projectScope}`), so state
 * never leaks across a project switch.
 */

/** Category folders in display order, with friendly headings. Unknown categories
 *  (a future export addition) land after these, alphabetically. */
const CATEGORIES: [string, string][] = [
    ['bg1-tileset', 'BG1 tilesets'],
    ['bg2', 'BG2 backgrounds'],
    ['bg3', 'BG3 backgrounds'],
    ['sprites', 'Sprite sheets'],
    ['hud', 'HUD / status'],
    ['screens', 'Screens'],
    ['advanced', 'Mode-7 / fonts'],
    ['other', 'No known loads'],
    ['gsu', 'GSU bitmap banks'],
    ['raw', 'Raw animation / credits']
]

const sizeLabel = (bytes: number): string =>
    bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`

/** Per-category collapse state, persisted so the browser reopens the way it was
 *  left (categories are the same set in every project). ABSENCE = collapsed —
 *  every category starts collapsed; expanding one stores `false` for its key. */
const COLLAPSED_STORE = persistedState<Record<string, boolean>>('shinyEgg.yychrCollapsed.v1', {})

/** The hover popout's zoom box (lib/hover-preview.tsx): sheets are always 128 px
 *  wide (16 tiles), so 384 works out to a crisp 3× integer zoom. */
const PREVIEW_FIT = 384

/** Thumbnails keyed `${file}@${hash}` — content-addressed, so a refresh re-fetches
 *  only sheets whose bytes actually changed, and a tab switch (which unmounts the
 *  component) keeps the rendered previews. Pruned to the current export's keys on
 *  every refresh, so it never grows past ~one whole-cart export. */
const thumbCache = new Map<string, YychrThumbnail | null>()
const thumbKey = (f: YychrProjectFile): string => `${f.file}@${f.hash}`

interface Props {
    yychrExe: string | null
    /** Open one sheet in YY-CHR (the parent owns the locate-first flow). */
    onOpenYychr: (dir: string, file: string) => Promise<void>
    /** After an import changed files: mark the build dirty + refresh the canvas. */
    onMutated: () => void
    /** Refresh the parent's "Changed graphics" list after an import. */
    onImported: () => Promise<void>
}

export function YychrTab({yychrExe, onOpenYychr, onMutated, onImported}: Props): JSX.Element {
    const [st, setSt] = useState<YychrProjectState | null>(null)
    const [busy, setBusy] = useState(false)
    const [log, setLog] = useState<{ lines: string[]; errors: string[]; warnings: string[] } | null>(null)
    const [pendingExport, setPendingExport] = useState(false)
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => COLLAPSED_STORE.load())
    // The hovered row's thumbnail + cursor Y, for the magnified popout (see
    // HoverPreview). Set on thumb mousemove, cleared on leave / refresh.
    const [preview, setPreview] = useState<{ img: YychrThumbnail; y: number } | null>(null)
    const [, bumpThumbs] = useState(0) // re-render trigger as thumbnail fetches land
    const refreshing = useRef(false)
    const lastRefresh = useRef(0)
    // The tab root — used to find the enclosing `.se-window` so the popout can
    // pin itself to the panel's edge.
    const rootRef = useRef<HTMLDivElement>(null)

    const dirRef = useRef('') // the export folder, for the stable per-row Open handler

    const refresh = useCallback(async (): Promise<void> => {
        if (refreshing.current) return
        refreshing.current = true
        try {
            const s = await window.shinyEgg.editor.yychrProjectState()
            lastRefresh.current = Date.now()
            dirRef.current = s.dir
            setSt(s)
            setPreview(null) // rows/thumbs may be replaced under the cursor
            // Prune stale thumbnails, then fetch the missing ones in CHUNK-sized
            // batches — one IPC round trip and ONE re-render per chunk, not per
            // sheet. Content-addressed keys mean a focus refresh fetches nothing
            // unless a sheet's bytes actually changed.
            const wanted = s.files.filter((f) => f.hash !== null)
            const keep = new Set(wanted.map(thumbKey))
            for (const k of thumbCache.keys()) if (!keep.has(k)) thumbCache.delete(k)
            const jobs = wanted.filter((f) => !thumbCache.has(thumbKey(f)))
            const CHUNK = 12
            for (let i = 0; i < jobs.length; i += CHUNK) {
                const chunk = jobs.slice(i, i + CHUNK)
                try {
                    const entries = await window.shinyEgg.editor.yychrThumbnails(chunk.map((f) => f.file))
                    const byFile = new Map(entries.map((e) => [e.file, e.thumb]))
                    for (const f of chunk) thumbCache.set(thumbKey(f), byFile.get(f.file) ?? null)
                } catch {
                    for (const f of chunk) thumbCache.set(thumbKey(f), null)
                }
                bumpThumbs((n) => n + 1)
            }
        } finally {
            refreshing.current = false
        }
    }, [])

    useEffect(() => {
        void refresh()
    }, [refresh])

    // The alt-tab-back-from-YY-CHR moment: re-check statuses when the editor window
    // regains focus (debounced — an action's own refresh already just ran).
    useEffect(() => {
        const onFocus = (): void => {
            if (Date.now() - lastRefresh.current > 1000) void refresh()
        }
        window.addEventListener('focus', onFocus)
        return () => window.removeEventListener('focus', onFocus)
    }, [refresh])

    const doExport = async (): Promise<void> => {
        setPendingExport(false)
        setBusy(true)
        setLog(null)
        try {
            const r = await window.shinyEgg.editor.yychrExportProject()
            if (r.ok) setLog({lines: [`Exported ${r.count} tile sheet${r.count === 1 ? '' : 's'}.`], errors: [], warnings: []})
            else setLog({lines: [], errors: [`Export failed: ${r.error}`], warnings: []})
            await refresh()
        } finally {
            setBusy(false)
        }
    }

    // Re-exporting overwrites the on-disk sheets — confirm when any still carry
    // unimported YY-CHR edits.
    const onExport = (): void => {
        if ((st?.changedCount ?? 0) > 0) setPendingExport(true)
        else void doExport()
    }

    const onImport = useCallback(async (files: string[] | null): Promise<void> => {
        setBusy(true)
        setLog(null)
        try {
            const r = await window.shinyEgg.editor.yychrImportProject(files)
            if (!r.ok) {
                setLog({lines: [], errors: [r.error], warnings: []})
                return
            }
            if (r.imported > 0) {
                onMutated()
                await onImported()
            }
            setLog({lines: r.log, errors: r.errors, warnings: r.warnings})
            await refresh()
        } finally {
            setBusy(false)
        }
    }, [onMutated, onImported, refresh])

    const toggleCat = useCallback((cat: string): void => {
        setCollapsed((c) => {
            const next = {...c, [cat]: !(c[cat] ?? true)} // absent = collapsed
            COLLAPSED_STORE.save(next)
            return next
        })
    }, [])

    // Stable per-row handlers, so the memo'd SheetRows skip re-rendering on the
    // thumbnail bumps (only rows whose thumb/status props changed re-render).
    const importFile = useCallback((file: string): void => {
        void onImport([file])
    }, [onImport])
    const openFile = useCallback((file: string): void => {
        void onOpenYychr(dirRef.current, file)
    }, [onOpenYychr])
    const onPreview = useCallback((img: YychrThumbnail | null, y: number): void => {
        setPreview(img ? {img, y} : null)
    }, [])

    // Group by category folder, in the fixed friendly order (unknowns appended) —
    // recomputed only when a refresh replaces the state, not on thumbnail bumps.
    const {groups, order} = useMemo(() => {
        const groups = new Map<string, YychrProjectFile[]>()
        for (const f of st?.files ?? []) {
            (groups.get(f.category) ?? groups.set(f.category, []).get(f.category)!).push(f)
        }
        const order: [string, string][] = [
            ...CATEGORIES.filter(([k]) => groups.has(k)),
            ...[...groups.keys()].filter((k) => !CATEGORIES.some(([c]) => c === k)).sort().map((k): [string, string] => [k, k])
        ]
        return {groups, order}
    }, [st])

    return (
        <div className="se-graphics__region" ref={rootRef}>
            <p className="se-graphics__desc">
                Every tile sheet in the game, exported into this project as raw files YY-CHR
                edits in place (with palette sidecars — see the folder’s README). Save in
                YY-CHR and switch back here: changed sheets light up for import, and imported
                pixels preview on the canvas immediately. A sheet already open in YY-CHR
                doesn’t see a re-export — reopen it.
            </p>

            <div className="se-graphics__row se-yychr__head">
                <button
                    className="se-banks__act"
                    onClick={onExport}
                    disabled={busy || !st}
                    title="Write every tile sheet into this project's yychr folder"
                >
                    {st?.exported ? 'Re-export all sheets' : 'Export all sheets'}
                </button>
                {st?.exported && (
                    <>
                        <button
                            className="se-banks__act"
                            onClick={() => void onImport(null)}
                            disabled={busy || st.changedCount === 0}
                            title="Import every sheet with unimported YY-CHR edits"
                        >
                            Import all changed{st.changedCount > 0 ? ` (${st.changedCount})` : ''}
                        </button>
                        <button
                            className="se-banks__act"
                            onClick={() => void refresh()}
                            disabled={busy}
                            title="Re-check which sheets changed on disk"
                        >
                            Refresh
                        </button>
                        <span
                            className="se-graphics__item-label se-graphics__item-label--link se-yychr__folder-link"
                            title={`${st.dir}\n(click to open)`}
                            onClick={() => void window.shinyEgg.editor.openRegionFolder(st.dir)}
                        >
                            Open folder
                        </span>
                    </>
                )}
            </div>

            {log && (
                <div className="se-graphics__log">
                    {log.lines.map((line, i) => (
                        <p key={`l${i}`} className="se-graphics__log-line">{line}</p>
                    ))}
                    {log.errors.map((err, i) => (
                        <p key={`e${i}`} className="se-graphics__log-error">⚠ {err}</p>
                    ))}
                    {log.warnings.map((warn, i) => (
                        <p key={`w${i}`} className="se-graphics__log-warning">⚠ {warn}</p>
                    ))}
                </div>
            )}

            {!st ? (
                <p className="se-graphics__changes-empty">Loading…</p>
            ) : !st.exported ? (
                <p className="se-graphics__changes-empty">
                    No YY-CHR export in this project yet — Export writes every sheet in the game
                    into the project’s yychr folder, ready to open in YY-CHR.
                </p>
            ) : (
                <div className="se-yychr__browser">
                    {order.map(([cat, label]) => {
                        const files = groups.get(cat)!
                        const isCollapsed = collapsed[cat] ?? true // absent = collapsed
                        // Surface pending edits a collapse would otherwise hide.
                        const changedN = isCollapsed ? files.filter((f) => f.status === 'changed').length : 0
                        return (
                            <div key={cat} className="se-yychr__group">
                                <button
                                    className="se-yychr__cat"
                                    onClick={() => toggleCat(cat)}
                                    title={isCollapsed ? 'Expand' : 'Collapse'}
                                >
                                    <span className="se-yychr__cat-caret">{isCollapsed ? '▸' : '▾'}</span>
                                    <span className="se-graphics__changes-title">{label} ({files.length})</span>
                                    {changedN > 0 && (
                                        <span className="se-yychr__status se-yychr__status--changed">{changedN} changed</span>
                                    )}
                                </button>
                                {!isCollapsed && (
                                    <ul className="se-graphics__list se-yychr__list">
                                        {files.map((f) => (
                                            <SheetRow
                                                key={f.file}
                                                f={f}
                                                thumb={f.hash !== null ? thumbCache.get(thumbKey(f)) : null}
                                                busy={busy}
                                                yychrExe={yychrExe}
                                                onImportFile={importFile}
                                                onOpenFile={openFile}
                                                onPreview={onPreview}
                                            />
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}

            {preview && (
                <HoverPreview
                    img={preview.img}
                    y={preview.y}
                    panel={rootRef.current?.closest('.se-window')?.getBoundingClientRect() ?? null}
                    fit={PREVIEW_FIT}
                />
            )}

            <DiscardChangesModal
                open={pendingExport}
                title="Re-export tile sheets"
                body={`${st?.changedCount ?? 0} sheet${(st?.changedCount ?? 0) === 1 ? ' has' : 's have'} unimported YY-CHR edits — re-exporting overwrites them with the editor’s current graphics. Import them first to keep them.`}
                saving={busy}
                confirmLabel="Re-export"
                danger
                onDiscard={() => void doExport()}
                onCancel={() => setPendingExport(false)}
            />
        </div>
    )
}

/** One sheet row: on-disk thumbnail, description + filename/format/size details,
 *  status badge, and per-file Import (changed only) / Open-in-YY-CHR actions.
 *  `thumb` undefined = fetch still in flight; null = no preview (missing file, or
 *  the Mode-7 tilemap sheet, which isn't pixel art). Memo'd: ~110 rows re-render
 *  per thumbnail-chunk bump otherwise — with stable handlers, only rows whose
 *  thumb/status actually changed do. */
const SheetRow = memo(function SheetRow({f, thumb, busy, yychrExe, onImportFile, onOpenFile, onPreview}: {
    f: YychrProjectFile
    thumb: YychrThumbnail | null | undefined
    busy: boolean
    yychrExe: string | null
    onImportFile: (file: string) => void
    onOpenFile: (file: string) => void
    /** Hovering the thumb shows the magnified popout (null clears it). */
    onPreview: (img: YychrThumbnail | null, y: number) => void
}): JSX.Element {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    useEffect(() => {
        if (thumb) blitRgba(canvasRef.current, thumb)
    }, [thumb])
    const fname = f.file.split('/').pop() ?? f.file
    return (
        <li className="se-yychr__item">
            {thumb ? (
                <canvas
                    ref={canvasRef}
                    className="se-yychr__thumb"
                    title={thumb.renderedTiles < thumb.totalTiles ? `Preview of the first ${thumb.renderedTiles} of ${thumb.totalTiles} tiles` : undefined}
                    onMouseMove={(e) => onPreview(thumb, e.clientY)}
                    onMouseLeave={() => onPreview(null, 0)}
                />
            ) : (
                <div className="se-yychr__thumb se-yychr__thumb--none">
                    {f.bpp === 8 ? 'tilemap' : f.status === 'missing' ? 'missing' : '…'}
                </div>
            )}
            <div className="se-yychr__info">
                <div className="se-yychr__toprow">
                    <span className="se-graphics__item-label" title={f.file}>{f.description}</span>
                    {f.status === 'changed' && <span className="se-yychr__status se-yychr__status--changed">changed</span>}
                    {f.status === 'missing' && <span className="se-yychr__status se-yychr__status--missing">missing</span>}
                    <button
                        className="se-graphics__item-reset"
                        onClick={() => onImportFile(f.file)}
                        disabled={busy || f.status !== 'changed'}
                        title={f.status === 'changed' ? 'Import this sheet’s YY-CHR edits' : 'Nothing to import — the sheet matches the last export/import'}
                    >
                        Import
                    </button>
                    <button
                        className="se-graphics__item-reset"
                        onClick={() => onOpenFile(f.file)}
                        disabled={busy || f.status === 'missing'}
                        title={yychrExe ? 'Open this sheet in YY-CHR' : 'Open in YY-CHR (you’ll be asked to locate it first)'}
                    >
                        Open
                    </button>
                </div>
                <span className="se-yychr__meta" title={f.file}>
                    {fname} · {f.format ?? f.kind} · {f.bpp}bpp · {sizeLabel(f.sizeBytes)} · {f.tileCount} tiles
                </span>
            </div>
        </li>
    )
})
