// The Add-picker floating window: a searchable catalog of objects + sprites.
// Picking an entry arms it (`onPick`) and switches the toolbar to the Place
// tool; the user then clicks the canvas to place it (see App's onPlaceAt +
// Canvas's place gesture). Extended objects are placed as `num=0, exnum=id`.

import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import {
  listExtendedObjects,
  listSprites,
  listStandardObjects
} from '../data/obj-metadata'
import type { PlacementItem } from '../types'
import { hex } from '../lib/hex'


interface Row {
  key: string
  label: string
  /** Id display (also searchable), e.g. `0x68` / `ext 0x12` / `0x0CA`. */
  sub: string
  category: string
  item: PlacementItem
}

function objectRows(): Row[] {
  const std = listStandardObjects().map(({ id, info }): Row => {
    const label = info.name || `Object ${hex(id, 2)}`
    return {
      key: `o${id}`,
      label,
      sub: `0x${hex(id, 2)}`,
      category: info.category,
      item: { kind: 'object', num: id, w: info.defaultWidth, h: info.defaultHeight, label }
    }
  })
  const ext = listExtendedObjects().map(({ id, info }): Row => {
    const label = info.name || `ExObject ${hex(id, 2)}`
    return {
      key: `e${id}`,
      label,
      sub: `ext 0x${hex(id, 2)}`,
      category: info.category,
      item: { kind: 'object', num: 0, exnum: id, w: info.defaultWidth, h: info.defaultHeight, label }
    }
  })
  return [...std, ...ext]
}

function spriteRows(): Row[] {
  return listSprites().map(({ id, info }): Row => {
    const label = info.name || `Sprite ${hex(id, 3)}`
    return {
      key: `s${id}`,
      label,
      sub: `0x${hex(id, 3)}`,
      category: info.category,
      item: { kind: 'sprite', num: id, label }
    }
  })
}

function sameItem(a: PlacementItem, b: PlacementItem): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'object' && b.kind === 'object') return a.num === b.num && a.exnum === b.exnum
  if (a.kind === 'sprite' && b.kind === 'sprite') return a.num === b.num
  return false
}

export function PickerBody({
  armed,
  onPick
}: {
  armed: PlacementItem | null
  onPick: (item: PlacementItem) => void
}): JSX.Element {
  const [tab, setTab] = useState<'object' | 'sprite'>('object')
  const [query, setQuery] = useState('')
  // Focus the search box when the panel opens (it mounts on open).
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => searchRef.current?.focus(), [])

  const rows = useMemo(() => (tab === 'object' ? objectRows() : spriteRows()), [tab])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.label.toLowerCase().includes(q) ||
        r.sub.toLowerCase().includes(q) ||
        r.category.includes(q)
    )
  }, [rows, query])

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
      <div className="se-picker__list">
        {filtered.map((r) => (
          <button
            key={r.key}
            type="button"
            className={`se-picker__row${armed && sameItem(armed, r.item) ? ' is-armed' : ''}`}
            onClick={() => onPick(r.item)}
            title={`${r.label} (${r.sub})`}
          >
            <span className="se-picker__row-name">{r.label}</span>
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
