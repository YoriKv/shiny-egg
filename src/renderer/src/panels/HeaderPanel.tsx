// Level Header panel body — edits the loaded level's 15 bit-packed header fields
// (BG color, per-layer tileset/palette, sprite tileset/palette, level mode,
// animation tileset/palette, BG scroll rate, music, item memory).
//
// The header is level-wide (not a canvas selection), so this is its own floating
// panel rather than part of Properties. Each field is rendered with the shared
// FieldRow widget and commits via the level reducer's `setHeaderField` action —
// so header edits ride the SAME live-render / undo / dirty / save path as every
// other level edit (the override re-decode picks up the new header, all caches
// key on it, and the serializer already packs header into the .bin). Fields are
// grouped into "Visual" (re-skins live) and "Gameplay" (built-ROM only).

import type { Dispatch, JSX } from 'react'
import type { LevelData } from '../../../preload/api'
import type { LevelAction } from '../canvas/level-reducer'
import { headerFields, type HeaderField } from '../data/header-schema'
import { FieldRow } from './field-widgets'

export interface HeaderBodyProps {
  /** The loaded level (its `header` is the edited surface). */
  level: LevelData | null
  /** Dispatch header edits to the level reducer. */
  dispatchLevel: Dispatch<LevelAction>
}

export function HeaderBody({ level, dispatchLevel }: HeaderBodyProps): JSX.Element {
  if (!level) {
    return <p className="se-props__empty">No level loaded.</p>
  }
  if (level.empty || level.special) {
    return <p className="se-props__empty">This level has no editable header.</p>
  }
  const header = level.header
  const fields = headerFields()
  const row = (f: HeaderField): JSX.Element => (
    <FieldRow
      key={f.index}
      label={f.label}
      field={f.field}
      value={header[f.index] ?? 0}
      hint={f.hint}
      onCommit={(v) => dispatchLevel({ type: 'setHeaderField', index: f.index, value: v })}
    />
  )
  // Known/acceptable for v1: the main BG/sprite/palette/collision layers update live on a
  // header edit, but a few auxiliary panels (Tiles "Used in this level", Properties→Collision
  // readout, Map16/gfx galleries) key on recordId / on-disk decode rather than the live header
  // override, so they reflect a header edit only after rebuild/reselect. Fix-if-it-grates: thread
  // a `headerVersion` counter the way the palette editor threads `paletteVersion`.
  return (
    <dl className="se-props__list se-props__list--2col">
      <dt className="se-props__section">
        Visual
        <span className="se-props__section-note">Re-skins the level live.</span>
      </dt>
      {fields.filter((f) => f.preview).map(row)}
      <dt className="se-props__section">
        Gameplay
        <span className="se-props__section-note">No live preview — Test Level to verify.</span>
      </dt>
      {fields.filter((f) => !f.preview).map(row)}
    </dl>
  )
}
