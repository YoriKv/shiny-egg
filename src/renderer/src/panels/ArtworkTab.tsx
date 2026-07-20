import {memo, useCallback, useEffect, useMemo, useRef, useState, type JSX} from 'react'
import type {ArtworkFormat, GfxProjectFile, GfxProjectState, YychrThumbnail} from '../../../preload/api'
import {blitRgba} from '../lib/blit'
import {HoverPreview} from '../lib/hover-preview'
import {persistedState} from '../lib/persisted-state'
import {DiscardChangesModal} from '../DiscardChangesModal'

/**
 * The Graphics panel's "Misc Art" tab — the third fixed project-folder browser
 * (YY-CHR tab: raw CHR sheets; M1TE Maps tab: `.M1` sessions; this: the
 * PNG/Aseprite image surfaces; 'artwork' stays the internal tab/folder name).
 * The four level-independent image tracks — world map, boot/story/title
 * screens, the Raphael arena, the message
 * font/pictures — export to `<projectRoot>/artwork/`, which this tab browses:
 * per-file thumbnails decoded from the ON-DISK bytes (external edits preview
 * before import), a change status from the same checksum gate the import uses,
 * and per-file/all import. Status refreshes on window focus, after actions, and
 * on Refresh — no fs watcher. The one option is the export format: PNG (any
 * image editor, pixels only) or Aseprite (tilemap/layout-capable surfaces).
 *
 * The parent remounts this per project (`key={projectScope}`), so state never
 * leaks across a project switch. (The level-DEPENDENT surfaces — BG regions,
 * metasprites — stay on the Level BGs tab: they need the loaded level.)
 */

/** Category keys in display order, with friendly headings. */
const CATEGORIES: [string, string][] = [
    ['map', 'World Map'],
    ['boot', 'Boot screen'],
    ['title', 'Title screen'],
    ['storybook', 'Storybook'],
    ['bosses', 'Bosses'],
    ['fonts', 'Message font / pictures']
]

/** Per-category collapse state (persisted). ABSENCE = expanded (same as M1TE). */
const COLLAPSED_STORE = persistedState<Record<string, boolean>>('shinyEgg.artworkCollapsed.v1', {})
/** The export-format preference (persisted; aseprite = layout-capable). */
const FORMAT_STORE = persistedState<{ format: ArtworkFormat }>('shinyEgg.artworkFormat.v1', {format: 'aseprite'})

/** The hover popout's zoom box (screens are ≤512 px wide at thumbnail scale). */
const PREVIEW_FIT = 512

/** Thumbnails keyed `${file}@${hash}` — content-addressed (see YychrTab). */
const thumbCache = new Map<string, YychrThumbnail | null>()
const thumbKey = (f: GfxProjectFile): string => `${f.file}@${f.hash}`

interface Props {
    /** After an import changed files: mark the build dirty + refresh the canvas. */
    onMutated: () => void
    /** Refresh the parent's "Changed graphics" list after an import. */
    onImported: () => Promise<void>
}

export function ArtworkTab({onMutated, onImported}: Props): JSX.Element {
    const [st, setSt] = useState<GfxProjectState | null>(null)
    const [busy, setBusy] = useState(false)
    const [log, setLog] = useState<{ lines: string[]; errors: string[]; warnings: string[] } | null>(null)
    const [pendingExport, setPendingExport] = useState(false)
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => COLLAPSED_STORE.load())
    const [format, setFormat] = useState<ArtworkFormat>(() => FORMAT_STORE.load().format)
    const [preview, setPreview] = useState<{ img: YychrThumbnail; y: number } | null>(null)
    const [, bumpThumbs] = useState(0)
    const refreshing = useRef(false)
    const lastRefresh = useRef(0)
    const rootRef = useRef<HTMLDivElement>(null)
    const dirRef = useRef('')

    const pickFormat = (f: ArtworkFormat): void => {
        setFormat(f)
        FORMAT_STORE.save({format: f})
    }

    const refresh = useCallback(async (): Promise<void> => {
        if (refreshing.current) return
        refreshing.current = true
        try {
            const s = await window.shinyEgg.editor.artworkState()
            lastRefresh.current = Date.now()
            dirRef.current = s.dir
            setSt(s)
            setPreview(null)
            const wanted = s.files.filter((f) => f.hash !== null)
            const keep = new Set(wanted.map(thumbKey))
            for (const k of thumbCache.keys()) if (!keep.has(k)) thumbCache.delete(k)
            const jobs = wanted.filter((f) => !thumbCache.has(thumbKey(f)))
            const CHUNK = 8
            for (let i = 0; i < jobs.length; i += CHUNK) {
                const chunk = jobs.slice(i, i + CHUNK)
                try {
                    const entries = await window.shinyEgg.editor.artworkThumbnails(chunk.map((f) => f.file))
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

    // The alt-tab-back-from-the-image-editor moment: re-check statuses on focus.
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
            const r = await window.shinyEgg.editor.artworkExport(format)
            if (r.ok) setLog({lines: [`Exported ${r.count} file${r.count === 1 ? '' : 's'} (${format}).`], errors: [], warnings: []})
            else setLog({lines: [], errors: [`Export failed: ${r.error}`], warnings: []})
            await refresh()
        } finally {
            setBusy(false)
        }
    }

    // Re-exporting overwrites the on-disk files — confirm when any carry unimported edits.
    const onExport = (): void => {
        if ((st?.changedCount ?? 0) > 0) setPendingExport(true)
        else void doExport()
    }

    const onImport = useCallback(async (files: string[] | null): Promise<void> => {
        setBusy(true)
        setLog(null)
        try {
            const r = await window.shinyEgg.editor.artworkImport(files)
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
        // shell.openPath on the absolute file — the OS default app (Aseprite for
        // .aseprite when associated, the image viewer/editor for .png).
        void window.shinyEgg.editor.openRegionFolder(`${dirRef.current}/${file}`)
    }, [])
    const onPreview = useCallback((img: YychrThumbnail | null, y: number): void => {
        setPreview(img ? {img, y} : null)
    }, [])

    const {groups, order} = useMemo(() => {
        const groups = new Map<string, GfxProjectFile[]>()
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
                The game’s fixed image surfaces — the world map, the boot / title /
                storybook screens, Raphael’s arena, and the message font —
                exported as {format === 'aseprite' ? 'Aseprite projects' : 'PNGs'}. Edit
                them externally: changed files light up for import, and imported edits
                preview on the canvas immediately.
            </p>

            <div className="se-graphics__row se-yychr__head">
                <button
                    className="se-banks__act"
                    onClick={onExport}
                    disabled={busy || !st}
                    title={`Write every artwork surface into this project's artwork folder as ${format === 'aseprite' ? 'Aseprite projects (pixels + layout where supported)' : 'PNGs (pixels only)'}`}
                >
                    {st?.exported ? 'Re-export all artwork' : 'Export all artwork'}
                </button>
                <label className="se-graphics__item-label" title="Aseprite projects carry tilemap layout (rearrange tiles); PNGs are pixels-only and open anywhere.">
                    <select
                        className="se-graphics__select"
                        value={format}
                        onChange={(e) => pickFormat(e.target.value as ArtworkFormat)}
                        disabled={busy}
                    >
                        <option value="aseprite">Aseprite</option>
                        <option value="png">PNG</option>
                    </select>
                </label>
                {st?.exported && (
                    <>
                        <button
                            className="se-banks__act"
                            onClick={() => void onImport(null)}
                            disabled={busy || st.changedCount === 0}
                            title="Import every file with unimported edits"
                        >
                            Import all changed{st.changedCount > 0 ? ` (${st.changedCount})` : ''}
                        </button>
                        <button
                            className="se-banks__act"
                            onClick={() => void refresh()}
                            disabled={busy}
                            title="Re-check which files changed on disk"
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
                    No artwork export in this project yet — Export writes the game’s fixed
                    image surfaces into the project’s artwork folder, ready to edit in any
                    image editor (PNG) or in Aseprite (with tile layout where supported).
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
                                            <ArtworkRow
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
                title="Re-export artwork"
                body={`${st?.changedCount ?? 0} file${(st?.changedCount ?? 0) === 1 ? ' has' : 's have'} unimported edits — re-exporting overwrites them with the editor’s current data. Import them first to keep them.`}
                saving={busy}
                confirmLabel="Re-export"
                danger
                onDiscard={() => void doExport()}
                onCancel={() => setPendingExport(false)}
            />
        </div>
    )
}

/** One artwork row: on-disk thumbnail, description + filename, status badge, and
 *  per-file Import (changed only) / Open actions. Memo'd like the sibling tabs. */
const ArtworkRow = memo(function ArtworkRow({f, thumb, busy, onImportFile, onOpenFile, onPreview}: {
    f: GfxProjectFile
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
                        title={f.status === 'changed' ? 'Import this file’s edits' : 'Nothing to import — the file matches the last export/import'}
                    >
                        Import
                    </button>
                    <button
                        className="se-graphics__item-reset"
                        onClick={() => onOpenFile(f.file)}
                        disabled={busy || f.status === 'missing'}
                        title="Open this file in its editor"
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
