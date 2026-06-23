// The Add-picker floating window: a searchable catalog of objects + sprites.
// Picking an entry arms it (`onPick`) and switches the toolbar to the Place
// tool; the user then clicks the canvas to place it (see App's onPlaceAt +
// Canvas's place gesture). Extended objects are placed as `num=0, exnum=id`.
//
// Render-validity: each row is badged with whether it would render correctly
// in-game under the CURRENT level's header (objects: main-side probe via
// useEntityRenderValidity; sprites: spriteset set-inclusion). The "In Level
// Tileset" toggle hides only the definite failures (`invalid` / `missing-gfx`);
// `degraded`/`unknown` stay visible with an amber badge — never silently hide
// what we're not sure about.
//
// Filter chips (§B5b): category facet (compact select), used-in-this-level,
// and exit-triggers. All persisted in `shinyEgg.picker.v1`.
// Two informational sprite badges that do NOT filter (the sprite stays listed
// like any other): "setup" (neighbour-deps — the designerRule as tooltip) and
// "spawn-only" (obj-metadata `spawnedOnly`, runtime-spawned children).

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { usePickerThumbnails } from '../hooks/usePickerThumbnails'
import {
  fallbackExtendedObjectName,
  fallbackObjectName,
  fallbackSpriteName,
  getSpriteNeighborDeps,
  listExtendedObjects,
  listSprites,
  listStandardObjects
} from '../data/obj-metadata'
import { useEntityRenderValidity, type EntityValidityView } from '../hooks/useEntityRenderValidity'
import type { FindInstanceKind, LevelData, RenderImage } from '../../../preload/api'
import type { PlacementItem } from '../types'
import { hex } from '../lib/hex'


interface Row {
  key: string
  label: string
  /** Id display (also searchable), e.g. `0x68` / `ext 0x12` / `0x0CA`. */
  sub: string
  category: string
  /** Row tooltip (label + id + object default size / growth directions). */
  tip: string
  /** Fires a screen exit (door/pipe/teleport) — the "exits" chip's facet. */
  exit: boolean
  /** Sprite neighbour-dependency designer rules (non-empty ⇒ "setup" badge,
   *  the rules as tooltip). Objects: always empty. */
  setupRules: string[]
  /** Runtime-spawned-only sprite (obj-metadata `spawnedOnly`) ⇒ "spawn-only"
   *  badge. Objects / specials: always false. */
  spawnedOnly: boolean
  item: PlacementItem
}

function objectRows(): Row[] {
  const std = listStandardObjects().map(({ id, info }): Row => {
    const label = info.name || fallbackObjectName(id)
    return {
      key: `o${id}`,
      label,
      sub: `0x${hex(id, 2)}`,
      category: info.category,
      tip: objectTip(label, `0x${hex(id, 2)}`, info),
      exit: info.exitTrigger,
      setupRules: [],
      spawnedOnly: false,
      item: { kind: 'object', num: id, w: info.defaultWidth, h: info.defaultHeight, label }
    }
  })
  const ext = listExtendedObjects().map(({ id, info }): Row => {
    const label = info.name || fallbackExtendedObjectName(id)
    return {
      key: `e${id}`,
      label,
      sub: `ext 0x${hex(id, 2)}`,
      category: info.category,
      tip: objectTip(label, `ext 0x${hex(id, 2)}`, info),
      exit: info.exitTrigger,
      setupRules: [],
      spawnedOnly: false,
      item: { kind: 'object', num: 0, exnum: id, w: info.defaultWidth, h: info.defaultHeight, label }
    }
  })
  return [...std, ...ext]
}

/** Object tooltip: id + default size + which directions it may grow
 *  (negative-extent validity — see obj-metadata `negW/negHAllowed`). */
function objectTip(
  label: string,
  sub: string,
  info: { defaultWidth: number; defaultHeight: number; negWAllowed?: boolean; negHAllowed?: boolean }
): string {
  const grow: string[] = []
  if (info.negWAllowed) grow.push('left')
  if (info.negHAllowed) grow.push('up')
  return (
    `${label} (${sub}) — default ${info.defaultWidth}×${info.defaultHeight}` +
    (grow.length ? `, can also grow ${grow.join(' + ')}` : '')
  )
}

/** The "Exit / Special" tab's fixed entries — non-entity placements. Today just
 *  the screen exit; future specials (spawn point presets, …) slot in here. */
function specialRows(): Row[] {
  return [
    {
      key: 'x-exit',
      label: 'Screen Exit',
      sub: '\u2014',
      category: 'exit',
      tip:
        'Screen Exit \u2014 click a cell to add a warp exit on that SCREEN (one exit per ' +
        '16\u00d716-cell screen). Defaults to a self-warp at the clicked cell; edit the ' +
        'destination (or switch it to a minibattle) in Properties.',
      exit: true,
      setupRules: [],
      spawnedOnly: false,
      item: { kind: 'exit', label: 'Screen Exit' }
    }
  ]
}

function spriteRows(): Row[] {
  return listSprites().map(({ id, info }): Row => {
    const label = info.name || fallbackSpriteName(id)
    return {
      key: `s${id}`,
      label,
      sub: `0x${hex(id, 3)}`,
      category: info.category,
      tip: `${label} (0x${hex(id, 3)})`,
      exit: info.exitTrigger,
      setupRules: getSpriteNeighborDeps(id).map((d) => d.designerRule),
      spawnedOnly: !!info.spawnedOnly,
      item: { kind: 'sprite', num: id, label }
    }
  })
}

/** One row's thumbnail: a tiny canvas the bitmap is blitted into once, scaled
 *  down by CSS (pixelated) inside a fixed letterbox. No bitmap ⇒ an empty box
 *  (keeps the rows aligned; glyph-tier / no-visual entries are text-only). */
function Thumb({ img }: { img: RenderImage | undefined }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !img) return
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height),
      0,
      0
    )
  }, [img])
  return <span className="se-picker__thumb">{img && <canvas ref={ref} />}</span>
}

// ── Hover preview ────────────────────────────────────────────────────────────
// A magnified copy of the hovered row's thumbnail, pinned along the Place
// panel's LEFT edge (vertically tracking the hovered row). Reuses the same
// full-res RenderImage the row already holds (the row Thumb just CSS-scales it
// DOWN into a 26×22 letterbox), integer-zoomed UP here for a crisp look.
// Portaled to <body> so it escapes the list's `overflow` clip and the floating-
// window z-stack; `pointer-events:none` so it never intercepts the click that
// arms the entry.
const PREVIEW_FIT = 144 // target box (px) the bitmap is integer-zoomed to fill
const PREVIEW_GAP = 8 // cursor-to-popup gap (px)
const PREVIEW_CHROME = 10 // border (1) + padding (4), both sides — matches the CSS

/** Largest integer zoom that fits the bitmap inside the PREVIEW_FIT box (≥1× so
 *  bitmaps already larger than the box still show, just un-zoomed). */
function previewScale(img: RenderImage): number {
  return Math.max(1, Math.min(8, Math.floor(PREVIEW_FIT / Math.max(img.width, img.height))))
}

function HoverPreview({
  img,
  y,
  panel
}: {
  img: RenderImage
  y: number
  /** The Place panel's viewport rect (the `.se-window` frame), measured at hover
   *  time so it tracks drag/resize. Null only if the frame can't be found. */
  panel: DOMRect | null
}): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0)
  }, [img])

  const scale = previewScale(img)
  const w = img.width * scale + PREVIEW_CHROME
  const h = img.height * scale + PREVIEW_CHROME
  // Pinned to the panel's LEFT edge: the popup's right edge sits PREVIEW_GAP px
  // outside it. Flips to the panel's right edge if there's no room on the left,
  // then clamps fully on-screen. Vertically centred on the cursor's row.
  const panelLeft = panel?.left ?? 0
  const panelRight = panel?.right ?? window.innerWidth
  let left = panelLeft - PREVIEW_GAP - w
  if (left < 4) left = panelRight + PREVIEW_GAP
  left = Math.max(4, Math.min(left, window.innerWidth - w - 4))
  const top = Math.max(4, Math.min(y - h / 2, window.innerHeight - h - 4))

  return createPortal(
    <div className="se-picker__preview" style={{ left, top }}>
      <canvas ref={ref} style={{ width: img.width * scale, height: img.height * scale }} />
    </div>,
    document.body
  )
}

function sameItem(a: PlacementItem, b: PlacementItem): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'object' && b.kind === 'object') return a.num === b.num && a.exnum === b.exnum
  if (a.kind === 'sprite' && b.kind === 'sprite') return a.num === b.num
  return a.kind === 'exit' && b.kind === 'exit'
}

/** Map a picker entry to the Object Finder's (kind, id) — std/ext object or
 *  sprite. Null for the Screen Exit special (nothing to find). Drives shift-click
 *  on a row: find this entity's instances instead of arming it for placement. */
function findTargetFor(item: PlacementItem): { kind: FindInstanceKind; id: number } | null {
  if (item.kind === 'object') {
    return item.num === 0 && item.exnum !== undefined
      ? { kind: 'ext', id: item.exnum }
      : { kind: 'std', id: item.num }
  }
  if (item.kind === 'sprite') return { kind: 'sprite', id: item.num }
  return null
}

// ── Render-validity badges ──────────────────────────────────────────────────

interface RowValidity {
  /** Hidden by the "In Level Tileset" toggle (definite failure only). */
  failing: boolean
  badge?: { cls: 'error' | 'warn'; text: string; tip: string }
}

const ROW_OK: RowValidity = { failing: false }

function rowValidity(row: Row, validity: EntityValidityView | null): RowValidity {
  if (!validity || row.item.kind === 'exit') return ROW_OK
  if (row.item.kind === 'object') {
    const v = validity.objectVerdict(row.item.num, row.item.exnum)
    if (v === 'invalid') {
      return {
        failing: true,
        badge: {
          cls: 'error',
          text: 'no gfx',
          tip: "This level's tilesets don't carry this object's art — placing it shows missing-art (X) or wrong tiles in-game. (Either the sheet lacks the art family, or the needed animation-tileset pairing is absent.)"
        }
      }
    }
    if (v === 'degraded') {
      return {
        failing: false,
        badge: {
          cls: 'warn',
          text: 'partial',
          tip: "Some of this object's tiles have no graphics under this level's header."
        }
      }
    }
    if (v === 'unknown') {
      return {
        failing: false,
        badge: { cls: 'warn', text: '?', tip: 'Render-validity unknown (handler not ported).' }
      }
    }
    return ROW_OK
  }
  const sv = validity.spriteValidity(row.item.num)
  if (sv.verdict === 'missing-gfx') {
    return {
      failing: true,
      badge: {
        cls: 'error',
        text: 'no gfx',
        tip: `Needs gfx file${sv.missingFiles.length > 1 ? 's' : ''} ${sv.missingFiles
          .map((f) => `0x${hex(f, 2)}`)
          .join(', ')} — not in this level's spriteset (header sprite tileset).`
      }
    }
  }
  if (sv.verdict === 'unknown') {
    return {
      failing: false,
      badge: {
        cls: 'warn',
        text: '?',
        tip: 'Never appears in a shipped level — gfx needs unknown.'
      }
    }
  }
  return ROW_OK
}

// ── Filter prefs (persisted) ────────────────────────────────────────────────

const PICKER_PREFS_KEY = 'shinyEgg.picker.v1'
interface PickerPrefs {
  thisLevel: boolean
  usedHere: boolean
  exits: boolean
  objectCategory: string
  spriteCategory: string
}
const DEFAULT_PREFS: PickerPrefs = {
  thisLevel: true,
  usedHere: false,
  exits: false,
  objectCategory: '',
  spriteCategory: ''
}
function readPrefs(): PickerPrefs {
  try {
    const raw = localStorage.getItem(PICKER_PREFS_KEY)
    if (raw) return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<PickerPrefs>) }
  } catch {
    /* corrupted pref — fall back to defaults */
  }
  return DEFAULT_PREFS
}

// ── Windowed list (§A/E) ─────────────────────────────────────────────────────
// The catalog is ~500 entries; rendering them all created hundreds of DOM rows +
// thumbnail canvases at once (slow mount + scroll). Rows are a FIXED height, so
// only the visible slice is mounted, absolutely positioned inside a full-height
// sizer. `ROW_H` must match `.se-picker__row`'s CSS height; `+1` is the visual
// gap (rows are absolutely positioned, so the gap lives in the pitch, not CSS).
// This also makes thumbnails effectively lazy: only visible rows mount a <Thumb>,
// so only visible bitmaps blit (the data is already cached by usePickerThumbnails).
const PICKER_ROW_H = 28
const PICKER_ROW_PITCH = PICKER_ROW_H + 1
const PICKER_OVERSCAN = 6

export function PickerBody({
  armed,
  level,
  onPick,
  onFind,
  renderRefresh
}: {
  armed: PlacementItem | null
  level: LevelData | null
  onPick: (item: PlacementItem) => void
  /** Shift-click a row: populate + open the Object Finder for that entity instead
   *  of arming it for placement (no-op for the Screen Exit special). */
  onFind: (kind: FindInstanceKind, id: number) => void
  /** Render epoch (bumps on rebuild / gfx edit) — keys the thumbnail cache so a
   *  rebuild refreshes the bitmaps but a plain reopen reuses them. */
  renderRefresh: number
}): JSX.Element {
  const [tab, setTab] = useState<'object' | 'sprite' | 'special'>('object')
  const [query, setQuery] = useState('')
  const [prefs, setPrefs] = useState(readPrefs)
  // Hover-preview target: the bitmap of the row under the cursor + the cursor's
  // Y (the popup is pinned to the panel's left edge, so only Y tracks). Set on
  // row mousemove (only for rows that HAVE a bitmap), cleared on leave — see
  // HoverPreview.
  const [preview, setPreview] = useState<{ img: RenderImage; y: number } | null>(null)
  const validity = useEntityRenderValidity(level)
  const thumbs = usePickerThumbnails(level, tab === 'sprite' ? 'sprite' : 'object', renderRefresh)
  // Focus the search box when the panel opens (it mounts on open).
  const searchRef = useRef<HTMLInputElement>(null)
  // The picker root — used to find the enclosing `.se-window` so the hover
  // preview can pin itself to the panel's left edge.
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => searchRef.current?.focus(), [])

  const setPref = <K extends keyof PickerPrefs>(key: K, value: PickerPrefs[K]): void => {
    setPrefs((p) => {
      const next = { ...p, [key]: value }
      localStorage.setItem(PICKER_PREFS_KEY, JSON.stringify(next))
      return next
    })
  }

  const rows = useMemo(
    () => (tab === 'object' ? objectRows() : tab === 'sprite' ? spriteRows() : specialRows()),
    [tab]
  )
  const categories = useMemo(
    () => [...new Set(rows.map((r) => r.category))].sort(),
    [rows]
  )
  const category = tab === 'object' ? prefs.objectCategory : prefs.spriteCategory
  // Row-key set of entities placed in the loaded level — the "used here" facet.
  const usedKeys = useMemo(() => {
    const set = new Set<string>()
    if (level) {
      for (const o of level.objects) {
        set.add(o.num === 0 && o.exnum !== undefined ? `e${o.exnum}` : `o${o.num}`)
      }
      for (const s of level.sprites) set.add(`s${s.num}`)
    }
    return set
  }, [level])

  const { filtered, hidden } = useMemo(() => {
    const q = query.trim().toLowerCase()
    // The special tab carries a handful of fixed entries — only the search
    // applies (the entity facets/chips are hidden and must not filter it).
    const matched = rows.filter(
      (r) =>
        (!q ||
          r.label.toLowerCase().includes(q) ||
          r.sub.toLowerCase().includes(q) ||
          r.category.includes(q)) &&
        (tab === 'special' ||
          ((!category || r.category === category) &&
            (!prefs.exits || r.exit) &&
            (!prefs.usedHere || usedKeys.has(r.key))))
    )
    const annotated = matched.map((r) => ({ row: r, validity: rowValidity(r, validity) }))
    // Hide only definite render-failures (when "in level tileset" is on).
    const kept = prefs.thisLevel ? annotated.filter((a) => !a.validity.failing) : annotated
    return { filtered: kept, hidden: annotated.length - kept.length }
  }, [rows, query, validity, prefs, category, usedKeys, tab])

  // Windowed list: only the visible slice of `filtered` is mounted (see the
  // PICKER_ROW_* note). Track scroll + viewport height; reset to top when the
  // result set changes (new search / filter / tab) so you see the top hits.
  const listRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(0)
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    const measure = (): void => setViewportH(el.clientHeight)
    measure() // before paint, so the first render windows to the real height
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0
    setScrollTop(0)
  }, [tab, query, category, prefs.thisLevel, prefs.usedHere, prefs.exits])

  const total = filtered.length
  const maxScroll = Math.max(0, total * PICKER_ROW_PITCH - viewportH)
  const clampedTop = Math.min(scrollTop, maxScroll) // survives a list shrink
  const winStart = Math.max(0, Math.floor(clampedTop / PICKER_ROW_PITCH) - PICKER_OVERSCAN)
  const winEnd = Math.min(total, Math.ceil((clampedTop + viewportH) / PICKER_ROW_PITCH) + PICKER_OVERSCAN)
  const visibleRows = filtered.slice(winStart, winEnd)

  const chip = (
    label: string,
    active: boolean,
    onToggle: () => void,
    tip: string
  ): JSX.Element => (
    <button
      type="button"
      className={`se-picker__chip${active ? ' is-active' : ''}`}
      onClick={onToggle}
      title={tip}
    >
      {label}
    </button>
  )

  return (
    <div className="se-picker" ref={rootRef}>
      <div className="se-tabs">
        <button
          type="button"
          className={`se-tab${tab === 'object' ? ' is-active' : ''}`}
          onClick={() => setTab('object')}
        >
          Objects
        </button>
        <button
          type="button"
          className={`se-tab${tab === 'sprite' ? ' is-active' : ''}`}
          onClick={() => setTab('sprite')}
        >
          Sprites
        </button>
        <button
          type="button"
          className={`se-tab${tab === 'special' ? ' is-active' : ''}`}
          onClick={() => setTab('special')}
        >
          Exit / Special
        </button>
      </div>
      <input
        ref={searchRef}
        className="se-input se-picker__search"
        placeholder="Search name / id / category…"
        value={query}
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
      />
      {tab !== 'special' && (
      <div className="se-picker__chips">
        {chip('in level tileset', prefs.thisLevel, () => setPref('thisLevel', !prefs.thisLevel),
          "Hide entries whose graphics aren't loaded under this level's header (red 'no gfx'). Amber badges (partial / unknown) stay visible.")}
        {chip('used here', prefs.usedHere, () => setPref('usedHere', !prefs.usedHere),
          'Only entries already placed in the loaded level — "give me another of those".')}
        {chip('exits', prefs.exits, () => setPref('exits', !prefs.exits),
          'Only entries that can fire a screen exit (doors / enterable pipes / teleports).')}
        <select
          className={`se-picker__category${category ? ' is-active' : ''}`}
          value={category}
          title="Category facet"
          onChange={(e) =>
            setPref(tab === 'object' ? 'objectCategory' : 'spriteCategory', e.target.value)
          }
        >
          <option value="">all categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {prefs.thisLevel && hidden > 0 && (
          <span className="se-meta-xs se-picker__filter-count">{hidden} hidden</span>
        )}
      </div>
      )}
      <div
        className="se-picker__list"
        ref={listRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div className="se-picker__list-sizer" style={{ height: total * PICKER_ROW_PITCH }}>
        {visibleRows.map(({ row: r, validity: rv }, i) => {
          const img =
            r.item.kind === 'object'
              ? thumbs?.objectThumb(r.item.num, r.item.exnum)
              : r.item.kind === 'sprite'
                ? thumbs?.spriteThumb(r.item.num)
                : undefined
          return (
          <button
            key={r.key}
            type="button"
            className={`se-picker__row${armed && sameItem(armed, r.item) ? ' is-armed' : ''}`}
            style={{ top: (winStart + i) * PICKER_ROW_PITCH }}
            onClick={(e) => {
              if (e.shiftKey) {
                const t = findTargetFor(r.item)
                if (t) onFind(t.kind, t.id)
              } else {
                onPick(r.item)
              }
            }}
            onMouseMove={(e) => setPreview(img ? { img, y: e.clientY } : null)}
            onMouseLeave={() => setPreview(null)}
            title={r.tip}
          >
            <Thumb img={img} />
            <span className="se-picker__row-name">
              {r.label}
              {rv.badge && (
                <span
                  className={`se-picker__badge se-picker__badge--${rv.badge.cls}`}
                  title={rv.badge.tip}
                >
                  {rv.badge.text}
                </span>
              )}
              {r.setupRules.length > 0 && (
                <span
                  className="se-picker__badge se-picker__badge--setup"
                  title={`Needs surrounding setup:\n${r.setupRules.join('\n')}`}
                >
                  setup
                </span>
              )}
              {r.spawnedOnly && (
                <span
                  className="se-picker__badge se-picker__badge--spawn"
                  title="Spawned only at runtime by another sprite (projectile / sub-part / event actor). Not normally hand-placed — it relies on its parent for setup."
                >
                  spawn-only
                </span>
              )}
            </span>
            <span className={`se-props__cat se-props__cat--${r.category}`}>{r.category}</span>
            <span className="se-meta-xs se-picker__row-id">{r.sub}</span>
          </button>
          )
        })}
        </div>
        {total === 0 && <p className="se-pop__empty">No matches.</p>}
      </div>
      <p className="se-picker__hint">
        {armed
          ? `Placing ${armed.label} — click the canvas (Esc to stop).`
          : 'Pick an entry, then click the canvas to place it.'}
      </p>
      {preview && (
        <HoverPreview
          img={preview.img}
          y={preview.y}
          panel={rootRef.current?.closest('.se-window')?.getBoundingClientRect() ?? null}
        />
      )}
    </div>
  )
}
