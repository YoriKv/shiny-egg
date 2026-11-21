// Sprite Properties window: the per-ID spawn-default property tables (Bank0A)
// for one normal sprite ID, as compact bit toggles / dropdowns plus a raw hex
// word per table. Opened from the Properties panel or a sprite's context menu.
// Edits are GLOBAL (every placement of the ID in every level) and only seed the
// slot — the sprite's own code may override them — both stated up front.

import { useId, useMemo, useState, type JSX } from 'react'
import type { LevelSprite, SpriteHitboxShape, SpritePropertyTableKey } from '../../../preload/api'
import type { SpritePropertiesEditorApi } from '../edit-session/useSpritePropertiesEditor'
import {
  SPRITE_PROPERTY_MAX_ID,
  SPRITE_PROPERTY_TABLE_INFO,
  SPRITE_TERRAIN_PRESETS,
  fieldsForTable,
  getFieldValue,
  setFieldValue,
  type SpritePropertyField
} from '../data/sprite-property-fields'
import { getSprite } from '../data/obj-metadata'
import { NumberField } from './field-widgets'
import { DiscardChangesModal } from '../DiscardChangesModal'
import { hex } from '../lib/hex'

const id3 = (n: number): string => `$${hex(n, 3)}`

function shapeLabel(i: number, s: SpriteHitboxShape): string {
  return `${i} · ${s.hw * 2}×${s.hh * 2} px, center (${s.cx}, ${s.cy})`
}

/** The hitbox over a 16×16 sprite cell (cell = dashed square, origin top-left). */
function HitboxPreview({ shape }: { shape: SpriteHitboxShape }): JSX.Element {
  const x0 = Math.min(0, shape.cx - shape.hw)
  const y0 = Math.min(0, shape.cy - shape.hh)
  const x1 = Math.max(16, shape.cx + shape.hw + 1)
  const y1 = Math.max(16, shape.cy + shape.hh + 1)
  const pad = 2
  return (
    <svg
      className="se-sprprops__hitbox"
      viewBox={`${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`}
      aria-label="Hitbox preview"
    >
      <rect x={0} y={0} width={16} height={16} className="se-sprprops__hitbox-cell" />
      <rect
        x={shape.cx - shape.hw}
        y={shape.cy - shape.hh}
        width={shape.hw * 2 + 1}
        height={shape.hh * 2 + 1}
        className="se-sprprops__hitbox-box"
      />
    </svg>
  )
}

function TerrainPreview({ points }: { points: (typeof SPRITE_TERRAIN_PRESETS)[number]['points'] }): JSX.Element {
  const [xs, ys] = [points.map(([x]) => x), points.map(([, y]) => y)]
  const left = Math.min(0, ...xs)
  const top = Math.min(0, ...ys)
  const width = Math.max(16, ...xs) - left
  const height = Math.max(16, ...ys) - top
  const scale = 42 / Math.max(width, height)
  const position = (x: number, y: number) => ({
    left: (52 - width * scale) / 2 + (x - left) * scale,
    top: (52 - height * scale) / 2 + (y - top) * scale
  })
  return (
    <div
      className="se-sprprops__terrain-preview"
      role="img"
      aria-label={`Terrain check points in pixels. ${points.map(([x, y]) => `(${x}, ${y})`).join(', ')}`}
    >
      <span className="se-sprprops__terrain-cell" style={{ ...position(0, 0), width: 16 * scale, height: 16 * scale }} />
      {points.map(([x, y], i) => <span key={i} className="se-sprprops__terrain-point" style={position(x, y)} />)}
    </div>
  )
}

function FieldControl({
  field,
  word,
  refWord,
  shapes,
  showAdvanced,
  onWord
}: {
  field: SpritePropertyField
  word: number
  refWord: number | undefined
  shapes: SpriteHitboxShape[]
  showAdvanced: boolean
  onWord: (w: number) => void
}): JSX.Element {
  const value = getFieldValue(word, field)
  const helpId = useId()
  const preset = field.id === 'terrainSet' ? SPRITE_TERRAIN_PRESETS[value] : undefined
  const changed = refWord !== undefined && getFieldValue(refWord, field) !== value
  const refValue = refWord === undefined ? undefined : getFieldValue(refWord, field)
  const refLabel = field.options?.find((option) => option.value === refValue)?.label ?? refValue
  const title = field.tooltip + (changed ? ` Original value was ${refLabel}.` : '')
  const cls = `se-sprprops__field${changed ? ' is-changed' : ''}${field.unverified ? ' is-unverified' : ''}`
  if (field.kind === 'flag') {
    return (
      <label className={`${cls} se-sprprops__flag`} title={title}>
        <input type="checkbox" checked={value === 1} onChange={(e) => onWord(setFieldValue(word, field, e.target.checked ? 1 : 0))} />
        <span>{field.label}</span>
      </label>
    )
  }
  let control: JSX.Element
  if (field.kind === 'enum' || field.kind === 'hitbox') {
    const options = field.kind === 'hitbox'
      ? shapes.map((s, i) => ({ value: i, label: shapeLabel(i, s) }))
      : field.options!.map((o) => ({ value: o.value, label: showAdvanced ? `${o.value} · ${o.label}` : o.label }))
    control = (
      <select className="se-input" aria-describedby={preset ? helpId : undefined} value={value} onChange={(e) => onWord(setFieldValue(word, field, Number(e.target.value)))}>
        {!options.some((o) => o.value === value) && <option value={value}>{`${value} (raw)`}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
  } else {
    const max = (1 << field.bits) - 1
    control = field.signed ? (
      <NumberField value={value} min={-(1 << (field.bits - 1))} max={(1 << (field.bits - 1)) - 1} onCommit={(v) => onWord(setFieldValue(word, field, v))} />
    ) : (
      <NumberField value={value} min={0} max={max} hex={showAdvanced} onCommit={(v) => onWord(setFieldValue(word, field, v))} />
    )
  }
  const shape = field.kind === 'hitbox' ? shapes[value] : undefined
  const rowStyle = field.kind === 'hitbox' ? ' is-hitbox' : preset ? ' is-terrain' : ''
  return (
    <>
      <label className={`${cls} se-sprprops__row${rowStyle}`} title={title}>
        <span className="se-sprprops__row-label">
          {field.label}
          {showAdvanced && field.kind === 'number' && !field.signed && <span className="se-sprprops__dim"> (hex)</span>}
        </span>
        {control}
        {shape && <HitboxPreview shape={shape} />}
      </label>
      {preset && (
        <div className="se-sprprops__terrain-help">
          {preset.points.length > 0 && <TerrainPreview points={preset.points} />}
          <div id={helpId}>
            <p>Each preset chooses where and how the sprite checks for level tiles.</p>
            <p>{preset.description}</p>
            {preset.points.length > 0 && <p>Dots mark check points relative to a 16×16 tile.</p>}
          </div>
        </div>
      )}
    </>
  )
}

export function SpritePropertiesBody({
  editor,
  projectActive,
  levelSprites
}: {
  editor: SpritePropertiesEditorApi
  projectActive: boolean
  /** The open level's sprites — for the "N placed here" note. */
  levelSprites: LevelSprite[]
}): JSX.Element {
  const { model, spriteId } = editor
  const [confirm, setConfirm] = useState<'sprite' | 'all' | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const info = getSprite(spriteId)
  const placedHere = levelSprites.filter((s) => s.num === spriteId).length
  const spriteOptions = useMemo(
    () => Array.from({ length: SPRITE_PROPERTY_MAX_ID + 1 }, (_, i) => ({ id: i, label: `${id3(i)} ${getSprite(i).name || '—'}` })),
    []
  )
  const changedSprite = model?.reference
    ? SPRITE_PROPERTY_TABLE_INFO.some((t) => model.tables[t.key][spriteId] !== model.reference![t.key][spriteId])
    : false
  const changedIds = useMemo(() => {
    if (!model?.reference) return 0
    let n = 0
    for (let i = 0; i <= SPRITE_PROPERTY_MAX_ID; i++) {
      if (SPRITE_PROPERTY_TABLE_INFO.some((t) => model.tables[t.key][i] !== model.reference![t.key][i])) n++
    }
    return n
  }, [model])
  const setWord = (table: SpritePropertyTableKey, w: number): void => editor.setWord(table, spriteId, w)

  return (
    <div className="se-sprprops">
      <div className="se-sprprops__head">
        <button type="button" className="se-banks__act" disabled={spriteId <= 0} onClick={() => editor.setSpriteId(spriteId - 1)} title="Previous sprite ID">◀</button>
        <select className="se-input se-sprprops__picker" value={spriteId} onChange={(e) => editor.setSpriteId(Number(e.target.value))}>
          {spriteOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <button type="button" className="se-banks__act" disabled={spriteId >= SPRITE_PROPERTY_MAX_ID} onClick={() => editor.setSpriteId(spriteId + 1)} title="Next sprite ID">▶</button>
        <div className="se-spriteset__actions">
          <button type="button" className="se-banks__act se-banks__act--danger" disabled={!changedSprite || editor.saving} onClick={() => setConfirm('sprite')} title="Restore this sprite's seven words to the reference cart">Restore sprite…</button>
          <button type="button" className="se-banks__act se-banks__act--danger" disabled={changedIds === 0 || editor.saving} onClick={() => setConfirm('all')} title="Restore every sprite's property tables to the reference cart">Restore all…</button>
          <button type="button" className="se-banks__act" disabled={!editor.dirty || editor.saving} onClick={() => editor.discard()}>Discard</button>
          <button type="button" className="se-banks__act" disabled={!editor.dirty || editor.saving || !projectActive} onClick={() => void editor.save()} title={projectActive ? 'Save to the project overlay (Bank0A.asm)' : 'Open a project to save edits'}>
            {editor.saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        <label className="se-sprprops__flag">
          <input type="checkbox" checked={showAdvanced} onChange={(e) => setShowAdvanced(e.target.checked)} />
          Show advanced
        </label>
      </div>

      <div className="se-sprprops__notice" role="note">
        <p>
          Changes apply to <strong>every {info.name || id3(spriteId)} in the project</strong>
          {placedHere > 0 ? ` (${placedHere} placed in this room)` : ''}.
        </p>
        <p>
          These settings apply when the sprite appears. Some sprites change them during play, so test your edits in the emulator.
        </p>
      </div>

      <div className="se-spriteset__status">
        {editor.error ?? editor.saveError ?? (editor.status ||
          (editor.dirty ? `Unsaved sprite property edits · ${changedIds} sprite ID${changedIds === 1 ? '' : 's'} differ from the reference cart` :
            changedIds > 0 ? `${changedIds} sprite ID${changedIds === 1 ? '' : 's'} differ from the reference cart` : ''))}
      </div>
      {!projectActive && <div className="se-spriteset__hint">Open a project to save sprite property changes.</div>}

      {!model ? (
        <div className="se-spriteset__empty">{editor.error ?? 'Loading sprite property tables…'}</div>
      ) : (
        <div className="se-sprprops__tables">
          {SPRITE_PROPERTY_TABLE_INFO.filter((t) => showAdvanced || !t.advanced).map((t) => {
            const word = model.tables[t.key][spriteId] ?? 0
            const refWord = model.reference?.[t.key][spriteId]
            const fields = fieldsForTable(t.key).filter((field) => showAdvanced || !field.advanced)
            const flags = fields.filter((x) => x.kind === 'flag')
            const rows = fields.filter((x) => x.kind !== 'flag')
            const changed = refWord !== undefined && refWord !== word
            return (
              <section key={t.key} className={`se-sprprops__table${changed ? ' is-changed' : ''}`}>
                <header className="se-sprprops__table-head" title={t.summary}>
                  <h3>{t.title}</h3>
                  {showAdvanced && (
                    <>
                      <span className="se-sprprops__dim">{t.label}</span>
                      <label className="se-sprprops__raw" title={`Raw 16-bit word (hex)${refWord !== undefined ? ` · reference $${hex(refWord, 4)}` : ''}`}>
                        Raw $<NumberField value={word} min={0} max={0xffff} hex onCommit={(v) => setWord(t.key, v)} />
                      </label>
                    </>
                  )}
                  {changed && refWord !== undefined && (
                    <button type="button" className="se-banks__act" onClick={() => setWord(t.key, refWord)} title={`Restore original ${t.title.toLowerCase()} settings`}>↺</button>
                  )}
                </header>
                {rows.map((field) => (
                  <FieldControl key={field.id} field={field} word={word} refWord={refWord} shapes={model.hitboxShapes} showAdvanced={showAdvanced} onWord={(w) => setWord(t.key, w)} />
                ))}
                {flags.length > 0 && (
                  <div className="se-sprprops__flags">
                    {flags.map((field) => (
                      <FieldControl key={field.id} field={field} word={word} refWord={refWord} shapes={model.hitboxShapes} showAdvanced={showAdvanced} onWord={(w) => setWord(t.key, w)} />
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}

      <DiscardChangesModal
        open={confirm !== null}
        title={confirm === 'all' ? 'Restore all sprite properties?' : `Restore ${id3(spriteId)} properties?`}
        body={confirm === 'all'
          ? 'Restore the original settings for every sprite. Use Save to apply the changes to the project.'
          : `Restore the original settings for ${info.name || id3(spriteId)}. Use Save to apply the changes to the project.`}
        confirmLabel="Restore"
        danger
        onDiscard={() => {
          if (confirm === 'all') editor.resetAll()
          else editor.resetSprite(spriteId)
          setConfirm(null)
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}
