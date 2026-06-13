// World Map panel — a hierarchical editor for the world-map entrance tables.
// Drill-down: Worlds → a world's levels (their RELATIONSHIPS: which data each
// tile plays + the progression flow) → one level's details (spawn + checkpoints).
//
//   • World view (relationships): per level, the "plays" data-record remap
//     (entrance byte +0, Phase 3) and the progression target (byte +3). Editing
//     the remap is self-consistent here (the panel reads the live draft) and the
//     level dropdown picks it up on save (levelRecordOverrides).
//   • Level view (details): the spawn cell (byte +1/+2 — previews live on the
//     canvas marker when this level is loaded) and the midway/checkpoint records.
//     Each spawn / checkpoint line has a "jump" button that loads that level and
//     focuses the camera at the cell — drilling in no longer auto-loads.
//
// The editing document + undo/save live at App level (useWorldMapEditor); this
// body owns the drill-down navigation state. Coords are decimal (cells); the
// checkpoint re-entry level is a sub-room dropdown; entrance state is a friendly
// enum. Re-renders on catalog refresh.

import { useState, type JSX } from 'react'
import type { WorldMapEditorApi } from '../edit-session/useWorldMapEditor'
import type {
  WorldMapEntrance,
  WorldMapMidwayEntrance,
  WorldMapModel
} from '../../../preload/api'
import { getAllLevels, getLevel, useLevelsCatalog } from '../data/levels'
import { useSubLevelBFS } from '../hooks/useSubLevelBFS'
import { ENTRANCE_TYPES } from '../data/property-schema'
import { EnumField, LevelPicker, LevelRefField, NumberField } from './field-widgets'
import { hex0x } from '../lib/hex'

/** One world-map slot row. The shape is FIXED (6 worlds × 12 translevel slots)
 *  so worlds stay listed and editable even when every level was removed:
 *    • `live`    — the slot resolves to an entrance record (editable);
 *    • `unwired` — its index word is $0000 but the base cart wires it (a
 *                  removed level / manual unwire) — offers a re-wire action;
 *    • `bonus`   — the per-world bonus tile (a GameMode $2A code-scene
 *                  minigame; never has an entrance record). */
interface SlotRow {
  translevelId: number
  slot: string
  name: string
  kind: 'live' | 'unwired' | 'bonus'
  e?: WorldMapEntrance
  pages: WorldMapMidwayEntrance[]
}

/** Shared lookups derived once per render from the model. */
interface SlotCtx {
  byIndex: Map<number, WorldMapEntrance>
  midwayByIndex: Map<number, WorldMapMidwayEntrance>
  midwayBases: number[]
}

/** Resolve a translevel slot to its main entrance record index. */
function entranceIndexFor(model: WorldMapModel, translevelId: number): number | undefined {
  return model.translevelToRecordIndex[hex0x(translevelId, 2)]
}

/** The checkpoint (midway) records for a slot: from its base record up to the
 *  next allocated base (runtime indexes by CheckpointReentryPage, so consecutive
 *  records are this level's checkpoint pages). Empty when the slot has no midway.
 *
 *  Fixed allocation, ≤4 pages/translevel: the engine selects one record via
 *  `base + CheckpointReentryPage` (a 2-bit header field → ≤4 pages). The `ckpt 0–3`
 *  rows ARE these `(translevel, page)` records — per-room restart points, NOT
 *  several checkpoints in one room. The 122-record midway total is a fixed cart
 *  constraint: growing it is STRUCTURAL (reindex every downstream base + free-space),
 *  not a value edit. */
function midwayPagesFor(
  model: WorldMapModel,
  translevelId: number,
  ctx: SlotCtx
): WorldMapMidwayEntrance[] {
  const base = model.midwayIndex[hex0x(translevelId, 2)]
  if (base === undefined) return []
  const i = ctx.midwayBases.indexOf(base)
  const next = i >= 0 && i + 1 < ctx.midwayBases.length ? ctx.midwayBases[i + 1] : model.midway.length
  const pages: WorldMapMidwayEntrance[] = []
  for (let r = base; r < next; r++) {
    const rec = ctx.midwayByIndex.get(r)
    if (rec) pages.push(rec)
  }
  return pages
}

/** The fixed world list (the cart's 6 × 12-slot translevel blocks). */
const WORLD_LABELS = [1, 2, 3, 4, 5, 6].map((w) => `World ${w}`)

/** The slot label for a translevel by its position in the 12-slot block. */
function slotShapeLabel(world: number, pos: number, translevelId: number): string {
  if (pos < 8) return `${world}-${pos + 1}`
  if (pos === 8) return `${world}-Extra`
  if (pos === 9) return `${world}-Bonus`
  if (translevelId === 0x0a) return 'Intro'
  if (translevelId === 0x0b) return 'Welcome'
  return `pad ${hex0x(translevelId, 2)}`
}

/** Display name for the record a slot plays (catalog name, else the raw id —
 *  removed records aren't in the catalog but stay editable here). */
function recordName(recordId: number): string {
  return getLevel(recordId)?.name ?? `record ${hex0x(recordId, 2)}`
}

/** Every slot of one world, from the FIXED shape — independent of the levels
 *  catalog, so worlds whose levels were all removed still list and edit. Pure
 *  padding slots (no live wiring, no base wiring, not the bonus tile) are
 *  omitted; W1's intro-cutscene/Welcome slots ride on their base wiring. */
function buildWorldSlots(model: WorldMapModel, world: number, ctx: SlotCtx): SlotRow[] {
  const out: SlotRow[] = []
  for (let pos = 0; pos < 12; pos++) {
    const t = (world - 1) * 12 + pos
    const slot = slotShapeLabel(world, pos, t)
    const idx = entranceIndexFor(model, t)
    const e = idx === undefined ? undefined : ctx.byIndex.get(idx)
    if (e) {
      out.push({ translevelId: t, slot, kind: 'live', name: recordName(e.levelDataId), e, pages: midwayPagesFor(model, t, ctx) })
      continue
    }
    if (pos === 9) {
      // The minigame's friendly name (Flip Cards, Roulette, …) rides on the
      // catalog's null-record Bonus entries (levels-slot-shape nameOverride) —
      // the Level dropdown hides those rows, so this is where the name shows.
      const bonus = getAllLevels().find((l) => l.translevelId === t)
      out.push({
        translevelId: t,
        slot,
        kind: 'bonus',
        name: bonus ? `${bonus.name} · minigame` : 'minigame code scene',
        pages: []
      })
      continue
    }
    const baseWord = model.baseEntranceIndexWords?.[t] ?? 0
    if (baseWord > 0) {
      const baseE = ctx.byIndex.get(Math.floor(baseWord / 4))
      out.push({
        translevelId: t,
        slot,
        kind: 'unwired',
        name: baseE ? `was ${recordName(baseE.levelDataId)}` : 'unused',
        pages: []
      })
    }
    // else: pure padding — nothing to show or edit.
  }
  return out
}

/** Slot-space (translevel) picker for the progression target. The unlock value
 *  is stored into CurrentLevelFromMap, so its id space is MAP SLOTS, not
 *  level-data records — 1-7's unlock is $07 (the 1-8 TILE), even though that
 *  tile plays record $9B. (An earlier revision edited this field through the
 *  record picker — the classic two-id-spaces conflation — which would have
 *  committed record ids into slot space.) Options are the wired slots, grouped
 *  by world; an off-list value stays selectable as raw hex. */
function SlotRefField({
  model,
  ctx,
  value,
  onCommit
}: {
  model: WorldMapModel
  ctx: SlotCtx
  value: number
  onCommit: (v: number) => void
}): JSX.Element {
  // Live slots AND bonus tiles: a bonus tile is a legitimate unlock target —
  // vanilla wires every world's Extra level to unlock its Bonus tile (1-Extra
  // → slot $09 "Flip Cards"), even though the tile boots a code scene rather
  // than an entrance record.
  const groups = WORLD_LABELS.map((label, i) => ({
    label,
    slots: buildWorldSlots(model, i + 1, ctx).filter(
      (s) => s.kind === 'live' || s.kind === 'bonus'
    )
  }))
  const known = groups.some((g) => g.slots.some((s) => s.translevelId === value))
  return (
    <select
      className="se-props__select"
      value={value}
      onChange={(e) => onCommit(parseInt(e.target.value, 10))}
    >
      {!known && <option value={value}>slot {hex0x(value, 2)}</option>}
      {groups.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.slots.map((s) => (
            <option key={s.translevelId} value={s.translevelId}>
              {s.slot} — {s.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

/** A small button that loads a level and focuses the camera at a cell. */
function JumpButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="se-worldmap__jump"
      title="Jump: load this level and focus the camera at this cell"
      onClick={onClick}
    >
      ⊙
    </button>
  )
}

/** A midway record is "empty" (an allocated-but-unused checkpoint page) when all
 *  four fields are 0 — the cart's convention for an unused page slot. */
function isEmptyMidway(p: WorldMapMidwayEntrance): boolean {
  return p.levelDataId === 0 && p.spawnX === 0 && p.spawnY === 0 && p.entranceState === 0
}

/** A small text icon button (add / remove) on a checkpoint row. */
function RowButton({
  label,
  title,
  onClick
}: {
  label: string
  title: string
  onClick: () => void
}): JSX.Element {
  return (
    <button type="button" className="se-worldmap__rowbtn" title={title} onClick={onClick}>
      {label}
    </button>
  )
}

type WmNav =
  | { view: 'worlds' }
  | { view: 'world'; group: string }
  | { view: 'level'; group: string; translevelId: number }

/** The world (1-6) a label addresses, or undefined. */
function worldOf(label: string): number | undefined {
  const i = WORLD_LABELS.indexOf(label)
  return i >= 0 ? i + 1 : undefined
}

/** The World Map window body. `editor` is the App-level entrance-table document;
 *  `onJump(recordId, x, y)` loads that level + focuses the cell (the per-line jump
 *  buttons). */
export function WorldMapBody({
  editor,
  onJump
}: {
  editor: WorldMapEditorApi
  onJump?: (recordId: number, x: number, y: number) => void
}): JSX.Element {
  const catalog = useLevelsCatalog()
  const [nav, setNav] = useState<WmNav>({ view: 'worlds' })
  const { model } = editor

  // Discover the drilled level's sub-rooms for the checkpoint dropdown. Computed
  // before the guards (null-safe) so the hook order is stable.
  const drilledRecordId = (() => {
    if (!model || nav.view !== 'level') return null
    const idx = entranceIndexFor(model, nav.translevelId)
    const e = idx === undefined ? undefined : model.entrances.find((x) => x.index === idx)
    return e ? e.levelDataId : null
  })()
  const subBfs = useSubLevelBFS(drilledRecordId)

  if (editor.error) {
    return (
      <div className="se-worldmap">
        <p className="se-strings__warn">Error: {editor.error}</p>
      </div>
    )
  }
  if (!model) {
    return (
      <div className="se-worldmap">
        <p className="se-strings__hint">{editor.status || 'Loading…'}</p>
      </div>
    )
  }
  if (catalog.groups.length === 0) {
    return (
      <div className="se-worldmap">
        <p className="se-strings__hint">No levels — extract a ROM first.</p>
      </div>
    )
  }

  const ctx: SlotCtx = {
    byIndex: new Map(model.entrances.map((e) => [e.index, e])),
    midwayByIndex: new Map(model.midway.map((m) => [m.index, m])),
    midwayBases: [...new Set(Object.values(model.midwayIndex))].sort((a, b) => a - b)
  }

  const curGroup =
    nav.view !== 'worlds' && worldOf(nav.group) !== undefined ? nav.group : undefined
  const curWorld = curGroup !== undefined ? worldOf(curGroup) : undefined
  const slots = curWorld !== undefined ? buildWorldSlots(model, curWorld, ctx) : []
  const found =
    nav.view === 'level'
      ? slots.find((s) => s.translevelId === nav.translevelId && s.kind === 'live')
      : undefined
  const curSlot = found?.e ? { ...found, e: found.e } : undefined
  const view: WmNav['view'] = nav.view === 'level' && !curSlot ? (curGroup ? 'world' : 'worlds') : nav.view === 'world' && !curGroup ? 'worlds' : nav.view

  return (
    <div className="se-worldmap">
      <div className="se-worldmap__crumbs">
        <button
          type="button"
          className="se-worldmap__crumb"
          onClick={() => setNav({ view: 'worlds' })}
          disabled={view === 'worlds'}
        >
          Worlds
        </button>
        {view !== 'worlds' && curGroup && (
          <>
            <span className="se-worldmap__crumb-sep">▸</span>
            <button
              type="button"
              className="se-worldmap__crumb"
              onClick={() => setNav({ view: 'world', group: curGroup })}
              disabled={view === 'world'}
            >
              {curGroup}
            </button>
          </>
        )}
        {view === 'level' && curSlot && (
          <>
            <span className="se-worldmap__crumb-sep">▸</span>
            <span className="se-worldmap__crumb is-current">{curSlot.slot}</span>
          </>
        )}
      </div>

      {view === 'worlds' && (
        <div className="se-worldmap__worlds">
          {WORLD_LABELS.map((label, i) => {
            const live = buildWorldSlots(model, i + 1, ctx).filter((s) => s.kind === 'live').length
            return (
              <button
                key={label}
                type="button"
                className="se-worldmap__world-btn"
                onClick={() => setNav({ view: 'world', group: label })}
              >
                <span className="se-worldmap__world-name">{label}</span>
                <span className="se-worldmap__world-count">
                  {live === 0 ? 'no wired levels' : `${live} level${live === 1 ? '' : 's'}`}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {view === 'world' && curGroup && (
        <div className="se-worldmap__list">
          <p className="se-worldmap__note">
            Each level's data mapping (<b>plays</b>) and progression (<b>→</b>) — the
            world's flow. No live preview; Test Level to verify. Click a level to edit
            its spawn + checkpoints. Unwired slots (removed levels) can be re-wired to
            their base records here.
          </p>
          {slots.map((s) => {
            if (s.kind === 'bonus') {
              return (
                <div className="se-worldmap__row se-worldmap__row--empty" key={s.translevelId}>
                  <span className="se-worldmap__slot">{s.slot}</span>
                  <span
                    className="se-worldmap__name se-worldmap__empty-label"
                    title="The bonus tile boots a GameMode $2A minigame code scene — it has no entrance record or level data to edit."
                  >
                    {s.name}
                  </span>
                </div>
              )
            }
            if (s.kind === 'unwired' || !s.e) {
              return (
                <div className="se-worldmap__row se-worldmap__row--empty" key={s.translevelId}>
                  <span className="se-worldmap__slot">{s.slot}</span>
                  <span className="se-worldmap__name se-worldmap__empty-label" title={s.name}>
                    unwired — {s.name}
                  </span>
                  <RowButton
                    label="+ wire"
                    title="Re-wire this slot to its base entrance record (the tile plays a level again; pick which one with the plays field)"
                    onClick={() => editor.setSlotWired(s.translevelId, true)}
                  />
                </div>
              )
            }
            const e = s.e
            return (
              <div className="se-worldmap__row" key={s.translevelId}>
                <button
                  type="button"
                  className="se-worldmap__slot-link"
                  title="Edit spawn + checkpoints"
                  onClick={() => setNav({ view: 'level', group: curGroup, translevelId: s.translevelId })}
                >
                  <span className="se-worldmap__slot">{s.slot}</span>
                  <span className="se-worldmap__name" title={s.name}>
                    {s.name}
                  </span>
                </button>
                <span
                  className="se-worldmap__cell se-worldmap__cell--prog"
                  title="Plays this data record (remap the tile to a different level's data)"
                >
                  <span className="se-worldmap__cell-label">plays</span>
                  <LevelRefField
                    value={e.levelDataId}
                    onCommit={(v) => editor.setEntranceField(e.index, { levelDataId: v })}
                  />
                </span>
                <span
                  className="se-worldmap__cell se-worldmap__cell--prog"
                  title="Progression target — the MAP SLOT the Yoshi token advances to (unlocks) after clearing this one"
                >
                  <span className="se-worldmap__cell-label">→</span>
                  <SlotRefField
                    model={model}
                    ctx={ctx}
                    value={e.progTarget}
                    onCommit={(v) => editor.setEntranceField(e.index, { progTarget: v })}
                  />
                </span>
              </div>
            )
          })}
        </div>
      )}

      {view === 'level' && curSlot && (
        <div className="se-worldmap__list">
          <div className="se-worldmap__detail-head" title={`entrance record #${curSlot.e.index} · plays level data ${hex0x(curSlot.e.levelDataId, 2)}`}>
            {curSlot.slot} · {curSlot.name}
          </div>
          <div className="se-worldmap__row">
            <span className="se-worldmap__name">Entrance spawn</span>
            <label className="se-worldmap__cell" title="Entrance X in 16-px cells. Previews live on the canvas marker.">
              <span className="se-worldmap__cell-label">X</span>
              <NumberField value={curSlot.e.spawnX} min={0} max={255} onCommit={(v) => editor.setEntranceField(curSlot.e.index, { spawnX: v })} />
            </label>
            <label className="se-worldmap__cell" title="Entrance Y in 16-px cells. Previews live on the canvas marker.">
              <span className="se-worldmap__cell-label">Y</span>
              <NumberField value={curSlot.e.spawnY} min={0} max={255} onCommit={(v) => editor.setEntranceField(curSlot.e.index, { spawnY: v })} />
            </label>
            {onJump && <JumpButton onClick={() => onJump(curSlot.e.levelDataId, curSlot.e.spawnX, curSlot.e.spawnY)} />}
          </div>

          {/* A room's Middle Ring sprite (edited on the level canvas) and its
              checkpoint re-entry record (edited here) are INDEPENDENT and do NOT
              auto-sync — a designer must keep them aligned by hand. */}
          <div className="se-worldmap__subhead">
            Checkpoints (midway re-entry){curSlot.pages.length === 0 ? ' — none' : ''}
          </div>
          {curSlot.pages.length > 0 && (
            <p className="se-worldmap__note">
              Rows are the level's allocated page slots (fixed count). Add fills an
              unused page; remove zeroes it. A page is only reached in-game if a
              room's header item-memory selects it and a Middle Ring arms it.
            </p>
          )}
          {curSlot.pages.map((p, pi) =>
            isEmptyMidway(p) ? (
              <div className="se-worldmap__row se-worldmap__row--ckpt se-worldmap__row--empty" key={`m${p.index}`}>
                <span className="se-worldmap__ckpt" title={`midway record #${p.index} · checkpoint page ${pi}`}>
                  ↳ ckpt {pi}
                </span>
                <span className="se-worldmap__name se-worldmap__empty-label">empty (unused page)</span>
                <RowButton
                  label="+ add"
                  title="Activate this checkpoint page — seeds it with this level's entrance position to edit from"
                  onClick={() =>
                    editor.setMidwayField(p.index, {
                      levelDataId: curSlot.e.levelDataId,
                      spawnX: curSlot.e.spawnX,
                      spawnY: curSlot.e.spawnY,
                      entranceState: 0
                    })
                  }
                />
              </div>
            ) : (
              <div className="se-worldmap__row se-worldmap__row--ckpt" key={`m${p.index}`}>
                <span className="se-worldmap__ckpt" title={`midway record #${p.index} · checkpoint page ${pi}`}>
                  ↳ ckpt {pi}
                </span>
                <span className="se-worldmap__name se-worldmap__cell--prog" title="Re-entry level Yoshi restarts in past this checkpoint (this level + its sub-rooms)">
                  <LevelPicker
                    value={p.levelDataId}
                    source={{ kind: 'ids', ids: subBfs.subLevels }}
                    fallback="subroom"
                    onCommit={(v) => editor.setMidwayField(p.index, { levelDataId: v })}
                  />
                </span>
                <label className="se-worldmap__cell" title="Re-entry X in 16-px cells">
                  <span className="se-worldmap__cell-label">X</span>
                  <NumberField value={p.spawnX} min={0} max={255} onCommit={(v) => editor.setMidwayField(p.index, { spawnX: v })} />
                </label>
                <label className="se-worldmap__cell" title="Re-entry Y in 16-px cells">
                  <span className="se-worldmap__cell-label">Y</span>
                  <NumberField value={p.spawnY} min={0} max={255} onCommit={(v) => editor.setMidwayField(p.index, { spawnY: v })} />
                </label>
                <span className="se-worldmap__cell" title="How Yoshi enters at this checkpoint (entry animation / pose)">
                  <span className="se-worldmap__cell-label">via</span>
                  <EnumField value={p.entranceState} options={ENTRANCE_TYPES} onCommit={(v) => editor.setMidwayField(p.index, { entranceState: v })} />
                </span>
                {onJump && <JumpButton onClick={() => onJump(p.levelDataId, p.spawnX, p.spawnY)} />}
                <RowButton
                  label="−"
                  title="Remove this checkpoint (zero the record back to an unused page)"
                  onClick={() =>
                    editor.setMidwayField(p.index, { levelDataId: 0, spawnX: 0, spawnY: 0, entranceState: 0 })
                  }
                />
              </div>
            )
          )}
        </div>
      )}

      <div className="se-worldmap__footer">
        {editor.saveError && <span className="se-strings__warn">{editor.saveError}</span>}
        {editor.dirty && <span className="se-worldmap__dirty">unsaved</span>}
        <button
          type="button"
          className="se-btn is-primary se-worldmap__save"
          disabled={!editor.dirty || editor.saving}
          onClick={() => void editor.save()}
        >
          {editor.saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
