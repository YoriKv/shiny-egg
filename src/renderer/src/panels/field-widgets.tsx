// Shared field-input widgets for the declarative property panels. Extracted from
// PropertiesPanel so the Properties panel (per-entity edits) and the Level Header
// panel (level-wide header fields) render the SAME inputs — commit-on-blur number
// field, raw-fallback enum dropdown, level-id picker — and a `FieldRow` that maps
// a `FieldKind` to its widget. Stays presentational: each takes a value + an
// `onCommit(value)`; the panels own how a commit turns into a reducer dispatch.

import { useEffect, useState, type JSX } from 'react'
import { getLevel, getLevelGroups, levelLabel, type LevelLabelFallback } from '../data/levels'
import type { FieldKind } from '../data/property-schema'
import { hex } from '../lib/hex'

/** A compact numeric input that keeps a local value while focused (snappy
 *  typing) and commits the parsed, clamped value up only on blur or Enter — so
 *  the live canvas re-render fires once per edit, not per keystroke. Re-syncs
 *  when the committed `value` changes externally (drag, undo). */
export function NumberField({
  value,
  min,
  max,
  disabled,
  hex,
  onCommit
}: {
  value: number
  min: number
  max: number
  disabled?: boolean
  hex?: boolean
  onCommit: (v: number) => void
}): JSX.Element {
  const fmt = (n: number): string => (hex ? n.toString(16).toUpperCase() : String(n))
  const [local, setLocal] = useState(fmt(value))
  useEffect(() => {
    setLocal(hex ? value.toString(16).toUpperCase() : String(value))
  }, [value, hex])
  const commit = (): void => {
    const parsed = parseInt(local, hex ? 16 : 10)
    if (Number.isNaN(parsed)) {
      setLocal(fmt(value))
      return
    }
    const clamped = Math.max(min, Math.min(max, parsed))
    if (clamped !== value) onCommit(clamped)
    setLocal(fmt(clamped))
  }
  return (
    <input
      className="se-props__num"
      value={local}
      disabled={disabled}
      spellCheck={false}
      inputMode={hex ? 'text' : 'numeric'}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}

/** A dropdown of named values. Keeps an unlisted value selectable (shown as
 *  `0xNN (raw)`) so data the editor has no label for isn't silently rewritten. */
export function EnumField({
  value,
  options,
  disabled,
  onCommit
}: {
  value: number
  options: { value: number; label: string }[]
  disabled?: boolean
  onCommit: (v: number) => void
}): JSX.Element {
  const known = options.some((o) => o.value === value)
  return (
    <select
      className="se-props__select"
      value={value}
      disabled={disabled}
      onChange={(e) => onCommit(parseInt(e.target.value, 10))}
    >
      {!known && <option value={value}>{`0x${hex(value)} (raw)`}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{`0x${hex(o.value)} · ${o.label}`}</option>
      ))}
    </select>
  )
}

/** Where a `LevelPicker`'s options come from: the playable catalog grouped by
 *  world, or an explicit flat id list (e.g. a level's discovered sub-rooms). */
export type LevelPickerSource = { kind: 'catalog' } | { kind: 'ids'; ids: number[] }

/** The single shared "pick a level / sub-room" dropdown. Options come from the
 *  catalog (grouped by world) or an explicit id list; the current value is always
 *  kept selectable (as its own option) even when it isn't in the list, so an
 *  off-list id is shown + preserved. Labels via the shared `levelLabel`. */
export function LevelPicker({
  value,
  source,
  fallback = 'hex',
  disabled,
  onCommit
}: {
  value: number
  source: LevelPickerSource
  /** Fallback rendering for ids not in the playable catalog. */
  fallback?: LevelLabelFallback
  disabled?: boolean
  onCommit: (v: number) => void
}): JSX.Element {
  const inSet = source.kind === 'catalog' ? getLevel(value) !== undefined : source.ids.includes(value)
  return (
    <select
      className="se-props__select"
      value={value}
      disabled={disabled}
      onChange={(e) => onCommit(parseInt(e.target.value, 10))}
    >
      {!inSet && <option value={value}>{levelLabel(value, fallback)}</option>}
      {source.kind === 'catalog'
        ? getLevelGroups().map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.levels
                .filter((l) => l.recordId !== null)
                .map((l) => (
                  <option key={`${g.label}:${l.slot}:${l.recordId}`} value={l.recordId as number}>
                    {levelLabel(l.recordId as number, fallback)}
                  </option>
                ))}
            </optgroup>
          ))
        : source.ids.map((id) => (
            <option key={id} value={id}>
              {levelLabel(id, fallback)}
            </option>
          ))}
    </select>
  )
}

/** A level-id picker over the playable catalog (a thin `LevelPicker`). The value
 *  is a data-record id; an id not in the catalog is kept selectable. */
export function LevelRefField({
  value,
  disabled,
  onCommit
}: {
  value: number
  disabled?: boolean
  onCommit: (v: number) => void
}): JSX.Element {
  return (
    <LevelPicker value={value} source={{ kind: 'catalog' }} disabled={disabled} onCommit={onCommit} />
  )
}

/** One descriptor → a labelled row with the widget for its `FieldKind`. */
export function FieldRow({
  label,
  field,
  value,
  hint,
  onCommit
}: {
  label: string
  field: FieldKind
  value: number
  hint?: string
  onCommit: (v: number) => void
}): JSX.Element {
  return (
    <>
      <dt title={hint}>{label}</dt>
      <dd className="se-props__field" title={hint}>
        {field.kind === 'num' ? (
          <>
            {field.hex && <span className="se-props__hexprefix">0x</span>}
            <NumberField
              value={value}
              min={field.min}
              max={field.max}
              disabled={field.disabled}
              hex={field.hex}
              onCommit={onCommit}
            />
          </>
        ) : field.kind === 'enum' ? (
          <EnumField
            value={value}
            options={field.options}
            disabled={field.disabled}
            onCommit={onCommit}
          />
        ) : (
          <LevelRefField value={value} disabled={field.disabled} onCommit={onCommit} />
        )}
      </dd>
    </>
  )
}
