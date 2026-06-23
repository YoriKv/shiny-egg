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

import { useState, type Dispatch, type JSX } from 'react'
import type { LevelData } from '../../../preload/api'
import type { LevelAction } from '../canvas/level-reducer'
import { headerFields, type HeaderField } from '../data/header-schema'
import { FieldRow } from './field-widgets'

/** Action under the Visual fields: set the sprite tileset (header[7]) to the
 *  stock spriteset that best covers this level's placed sprites. Handy after a
 *  GBA import or after adding sprites whose gfx the current set doesn't load. */
function SpritesetFitRow({
  level,
  dispatchLevel
}: {
  level: LevelData
  dispatchLevel: Dispatch<LevelAction>
}): JSX.Element {
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function fit(): Promise<void> {
    setBusy(true)
    setStatus(null)
    try {
      const r = await window.shinyEgg.render.fitSpriteset(level.sprites.map((s) => s.num))
      dispatchLevel({ type: 'setHeaderField', index: 7, value: r.spriteTileset })
      const id = `0x${r.spriteTileset.toString(16).toUpperCase().padStart(2, '0')}`
      setStatus(
        r.gatedInstances === 0
          ? `Set ${id} — no graphics-gated sprites, any set works.`
          : r.missingFiles.length === 0
            ? `Set ${id} — covers all ${r.gatedInstances} graphics-gated sprite${r.gatedInstances === 1 ? '' : 's'}.`
            : `Set ${id} — best available, but ${r.missingFiles.length} gfx file${r.missingFiles.length === 1 ? '' : 's'} still uncovered; some sprites may render wrong.`
      )
    } catch (e) {
      setStatus((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <dd className="se-props__fitspriteset">
      <button type="button" className="se-btn" onClick={() => void fit()} disabled={busy}>
        {busy ? 'Fitting…' : 'Fit sprite tileset to sprites'}
      </button>
      {status && <span className="se-props__fithint">{status}</span>}
    </dd>
  )
}

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
      <SpritesetFitRow level={level} dispatchLevel={dispatchLevel} />
      <dt className="se-props__section">
        Gameplay
        <span className="se-props__section-note">No live preview — Test Level to verify.</span>
      </dt>
      {fields.filter((f) => !f.preview).map(row)}
    </dl>
  )
}
