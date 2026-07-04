import {memo, useCallback, useEffect, useMemo, useRef, useState, type JSX} from 'react'
import type {M1teMapsFile, M1teMapsState, YychrThumbnail} from '../../../preload/api'
import {blitRgba} from '../lib/blit'
import {HoverPreview} from '../lib/hover-preview'
import {persistedState} from '../lib/persisted-state'
import {DiscardChangesModal} from '../DiscardChangesModal'

/**
 * The Graphics panel's "M1TE Maps" tab — the YY-CHR tab's twin for the game's
 * fixed `.M1` map surfaces (the 6 overworlds + the level-icons grid + the 9
 * tilemap-based system screens), exported to the project's fixed m1te folder
 * (`<projectRoot>/m1te/`). Every file shows a thumbnail composed from its
 * ON-DISK bytes (so edits saved in M1TE preview BEFORE import), a change status
 * from the same checksum gate the import uses, and per-file Import / Open-in-M1TE
 * actions. Status refreshes on window focus (the alt-tab-back-from-M1TE moment),
 * after every action, and on the Refresh button — no fs watcher.
 *
 * The parent remounts this per project (`key={projectScope}`), so state never
 * leaks across a project switch. (Per-LEVEL BG-layer `.M1`s stay on the
 * Extract/Import tab — they need a loaded level.)
 */

/** Category keys in display order, with friendly headings. */
const CATEGORIES: [string, string][] = [
    ['map', 'World Map'],
    ['title', 'Title screen'],
    ['storybook', 'Storybook'],
    ['bonus', 'Bonus games']
]

/** Per-category collapse state (persisted). ABSENCE = expanded — unlike the
 *  ~110-sheet YY-CHR browser, this list is 16 files, so open-by-default reads
 *  better; collapsing one stores `true` for its key. */
const COLLAPSED_STORE = persistedState<Record<string, boolean>>('shinyEgg.m1teMapsCollapsed.v1', {})

/** The hover popout's zoom box: the widest map is 512 px, so fit at 512 = 1×. */
const PREVIEW_FIT = 512

/** Thumbnails keyed `${file}@${hash}` — content-addressed (see YychrTab). */
const thumbCache = new Map<string, YychrThumbnail | null>()
const thumbKey = (f: M1teMapsFile): string => `${f.file}@${f.hash}`

interface Props {
    /** After an import changed files: mark the build dirty + refresh the canvas. */
    onMutated: () => void
    /** Refresh the parent's "Changed graphics" list after an import. */
    onImported: () => Promise<void>
}

export function M1teMapsTab({onMutated, onImported}: Props): JSX.Element {
    const [st, setSt] = useState<M1teMapsState | null>(null)
    const [busy, setBusy] = useState(false)
    const [log, setLog] = useState<{ lines: string[]; errors: string[]; warnings: string[] } | null>(null)
    const [pendingExport, setPendingExport] = useState(false)
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => COLLAPSED_STORE.load())
    const [preview, setPreview] = useState<{ img: YychrThumbnail; y: number } | null>(null)
    const [, bumpThumbs] = useState(0)
    const refreshing = useRef(false)
    const lastRefresh = useRef(0)
    const rootRef = useRef<HTMLDivElement>(null)
    const dirRef = useRef('')

    const refresh = useCallback(async (): Promise<void> => {
        if (refreshing.current) return
        refreshing.current = true
        try {
            const s = await window.shinyEgg.editor.m1teMapsState()
            lastRefresh.current = Date.now()
            dirRef.current = s.dir
            setSt(s)
            setPreview(null)
            const wanted = s.files.filter((f) => f.hash !== null)
            const keep = new Set(wanted.map(thumbKey))
            for (const k of thumbCache.keys()) if (!keep.has(k)) thumbCache.delete(k)
            const jobs = wanted.filter((f) => !thumbCache.has(thumbKey(f)))
            const CHUNK = 6 // full-map thumbs are big; smaller batches than the sheet tab
            for (let i = 0; i < jobs.length; i += CHUNK) {
                const chunk = jobs.slice(i, i + CHUNK)
                try {
                    const entries = await window.shinyEgg.editor.m1teMapsThumbnails(chunk.map((f) => f.file))
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

    // The alt-tab-back-from-M1TE moment: re-check statuses on window focus (debounced).
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
            const r = await window.shinyEgg.editor.m1teMapsExport()
            if (r.ok) setLog({lines: [`Exported ${r.count} map session${r.count === 1 ? '' : 's'}.`], errors: [], warnings: []})
            else setLog({lines: [], errors: [`Export failed: ${r.error}`], warnings: []})
            await refresh()
        } finally {
            setBusy(false)
        }
    }

    // Re-exporting overwrites the on-disk .M1s — confirm when any carry unimported edits.
    const onExport = (): void => {
        if ((st?.changedCount ?? 0) > 0) setPendingExport(true)
        else void doExport()
    }

    const onImport = useCallback(async (files: string[] | null): Promise<void> => {
        setBusy(true)
        setLog(null)
        try {
            const r = await window.shinyEgg.editor.m1teMapsImport(files)
            if (!r.ok) {
                setLog({lines: [], errors: [r.error], warnings: []})
                return
            }
            if (r.changed > 0) {
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
            const next = {...c, [cat]: !(c[cat] ?? false)} // absent = expanded
            COLLAPSED_STORE.save(next)
            return next
        })
    }, [])

    const importFile = useCallback((file: string): void => {
        void onImport([file])
    }, [onImport])
    const openFile = useCallback((file: string): void => {
        // Map/screen .M1s carry no bg-layer hint in their names — M1TE opens on BG1.
        void window.shinyEgg.editor.openInM1te(dirRef.current, file, 1)
    }, [])
    const onPreview = useCallback((img: YychrThumbnail | null, y: number): void => {
        setPreview(img ? {img, y} : null)
    }, [])

    const {groups, order} = useMemo(() => {
        const groups = new Map<string, M1teMapsFile[]>()
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
                Every fixed map in the game — the overworlds, the level icons, and the
                tilemap-based screens — exported into this project as M1TE sessions
                (tilemap + tiles + palette in one .M1). Save in M1TE and switch back here:
                changed maps light up for import, and imported edits preview on the canvas
                immediately. A file already open in M1TE doesn’t see a re-export — reopen it.
            </p>

            <div className="se-graphics__row se-yychr__head">
                <button
                    className="se-banks__act"
                    onClick={onExport}
                    disabled={busy || !st}
                    title="Write every map session into this project's m1te folder"
                >
                    {st?.exported ? 'Re-export all maps' : 'Export all maps'}
                </button>
                {st?.exported && (
                    <>
                        <button
                            className="se-banks__act"
                            onClick={() => void onImport(null)}
                            disabled={busy || st.changedCount === 0}
                            title="Import every map with unimported M1TE edits"
                        >
                            Import all changed{st.changedCount > 0 ? ` (${st.changedCount})` : ''}
                        </button>
                        <button
                            className="se-banks__act"
                            onClick={() => void refresh()}
                            disabled={busy}
                            title="Re-check which maps changed on disk"
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
                    No M1TE export in this project yet — Export writes every fixed map in the
                    game into the project’s m1te folder, ready to open in M1TE (bundled with
                    the editor, no install needed).
                </p>
            ) : (
                <div className="se-yychr__browser">
                    {order.map(([cat, label]) => {
                        const files = groups.get(cat)!
                        const isCollapsed = collapsed[cat] ?? false // absent = expanded
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
                                            <MapRow
                                                key={f.file}
                                                f={f}
                                                thumb={f.hash !== null ? thumbCache.get(thumbKey(f)) : null}
                                                busy={busy}
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
                title="Re-export map sessions"
                body={`${st?.changedCount ?? 0} map${(st?.changedCount ?? 0) === 1 ? ' has' : 's have'} unimported M1TE edits — re-exporting overwrites them with the editor’s current data. Import them first to keep them.`}
                saving={busy}
                confirmLabel="Re-export"
                danger
                onDiscard={() => void doExport()}
                onCancel={() => setPendingExport(false)}
            />
        </div>
    )
}

/** One map row: on-disk composed thumbnail, description + filename, status badge,
 *  and per-file Import (changed only) / Open-in-M1TE actions. Memo'd like the
 *  YY-CHR SheetRow (stable handlers; only rows whose thumb/status changed re-render). */
const MapRow = memo(function MapRow({f, thumb, busy, onImportFile, onOpenFile, onPreview}: {
    f: M1teMapsFile
    thumb: YychrThumbnail | null | undefined
    busy: boolean
    onImportFile: (file: string) => void
    onOpenFile: (file: string) => void
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
                    onMouseMove={(e) => onPreview(thumb, e.clientY)}
                    onMouseLeave={() => onPreview(null, 0)}
                />
            ) : (
                <div className="se-yychr__thumb se-yychr__thumb--none">
                    {f.status === 'missing' ? 'missing' : '…'}
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
                        title={f.status === 'changed' ? 'Import this map’s M1TE edits' : 'Nothing to import — the file matches the last export/import'}
                    >
                        Import
                    </button>
                    <button
                        className="se-graphics__item-reset"
                        onClick={() => onOpenFile(f.file)}
                        disabled={busy || f.status === 'missing'}
                        title="Open this map in M1TE (bundled)"
                    >
                        Open
                    </button>
                </div>
                <span className="se-yychr__meta" title={f.file}>
                    {fname}
                </span>
            </div>
        </li>
    )
})
