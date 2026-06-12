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
// exit-triggers, and needs-setup (sprites with neighbour-deps — badge + chip,
// the designerRule as tooltip). All persisted in `shinyEgg.picker.v1`.

import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
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
import type { LevelData, RenderImage } from '../../../preload/api'
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
  /** Sprite neighbour-dependency designer rules (non-empty ⇒ "setup" badge +
   *  the "needs setup" chip facet). Objects: always empty. */
  setupRules: string[]
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

function sameItem(a: PlacementItem, b: PlacementItem): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'object' && b.kind === 'object') return a.num === b.num && a.exnum === b.exnum
  if (a.kind === 'sprite' && b.kind === 'sprite') return a.num === b.num
  return false
}

// ── Render-validity badges ──────────────────────────────────────────────────

interface RowValidity {
  /** Hidden by the "In Level Tileset" toggle (definite failure only). */
  failing: boolean
  badge?: { cls: 'error' | 'warn'; text: string; tip: string }
}

const ROW_OK: RowValidity = { failing: false }

function rowValidity(row: Row, validity: EntityValidityView | null): RowValidity {
  if (!validity) return ROW_OK
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
  needsSetup: boolean
  objectCategory: string
  spriteCategory: string
}
const DEFAULT_PREFS: PickerPrefs = {
  thisLevel: true,
  usedHere: false,
  exits: false,
  needsSetup: false,
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

export function PickerBody({
  armed,
  level,
  onPick
}: {
  armed: PlacementItem | null
  level: LevelData | null
  onPick: (item: PlacementItem) => void
}): JSX.Element {
  const [tab, setTab] = useState<'object' | 'sprite'>('object')
  const [query, setQuery] = useState('')
  const [prefs, setPrefs] = useState(readPrefs)
  const validity = useEntityRenderValidity(level)
  const thumbs = usePickerThumbnails(level, tab)
  // Focus the search box when the panel opens (it mounts on open).
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => searchRef.current?.focus(), [])

  const setPref = <K extends keyof PickerPrefs>(key: K, value: PickerPrefs[K]): void => {
    setPrefs((p) => {
      const next = { ...p, [key]: value }
      localStorage.setItem(PICKER_PREFS_KEY, JSON.stringify(next))
      return next
    })
  }

  const rows = useMemo(() => (tab === 'object' ? objectRows() : spriteRows()), [tab])
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
    const matched = rows.filter(
      (r) =>
        (!q ||
          r.label.toLowerCase().includes(q) ||
          r.sub.toLowerCase().includes(q) ||
          r.category.includes(q)) &&
        (!category || r.category === category) &&
        (!prefs.exits || r.exit) &&
        (!prefs.usedHere || usedKeys.has(r.key)) &&
        (!prefs.needsSetup || tab !== 'sprite' || r.setupRules.length > 0)
    )
    const annotated = matched.map((r) => ({ row: r, validity: rowValidity(r, validity) }))
    const kept = prefs.thisLevel ? annotated.filter((a) => !a.validity.failing) : annotated
    return { filtered: kept, hidden: annotated.length - kept.length }
  }, [rows, query, validity, prefs, category, usedKeys, tab])

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
    <div className="se-picker">
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
      </div>
      <input
        ref={searchRef}
        className="se-picker__search"
        placeholder="Search name / id / category…"
        value={query}
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="se-picker__chips">
        <label
          className="se-picker__filter"
          title="Hide entries whose graphics aren't loaded under this level's header (red 'no gfx'). Amber badges (partial / unknown) stay visible."
        >
          <input
            type="checkbox"
            checked={prefs.thisLevel}
            onChange={(e) => setPref('thisLevel', e.target.checked)}
          />
          In Level Tileset
        </label>
        {chip('used here', prefs.usedHere, () => setPref('usedHere', !prefs.usedHere),
          'Only entries already placed in the loaded level — "give me another of those".')}
        {chip('exits', prefs.exits, () => setPref('exits', !prefs.exits),
          'Only entries that can fire a screen exit (doors / enterable pipes / teleports).')}
        {tab === 'sprite' &&
          chip('needs setup', prefs.needsSetup, () => setPref('needsSetup', !prefs.needsSetup),
            'Only sprites that read surrounding placed data (a rail, a partner sprite, a keyhole…) — see each row’s "setup" badge.')}
        <select
          className="se-picker__category"
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
          <span className="se-picker__filter-count">{hidden} hidden</span>
        )}
      </div>
      <div className="se-picker__list">
        {filtered.map(({ row: r, validity: rv }) => (
          <button
            key={r.key}
            type="button"
            className={`se-picker__row${armed && sameItem(armed, r.item) ? ' is-armed' : ''}`}
            onClick={() => onPick(r.item)}
            title={r.tip}
          >
            <Thumb
              img={
                r.item.kind === 'object'
                  ? thumbs?.objectThumb(r.item.num, r.item.exnum)
                  : thumbs?.spriteThumb(r.item.num)
              }
            />
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
            </span>
            <span className={`se-props__cat se-props__cat--${r.category}`}>{r.category}</span>
            <span className="se-picker__row-id">{r.sub}</span>
          </button>
        ))}
        {filtered.length === 0 && <p className="se-pop__empty">No matches.</p>}
      </div>
      <p className="se-picker__hint">
        {armed
          ? `Placing ${armed.label} — click the canvas (Esc to stop).`
          : 'Pick an entry, then click the canvas to place it.'}
      </p>
    </div>
  )
}
