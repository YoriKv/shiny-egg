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
  LevelCatalogGroup,
  WorldMapEntrance,
  WorldMapMidwayEntrance,
  WorldMapModel
} from '../../../preload/api'
import { useLevelsCatalog } from '../data/levels'
import { useSubLevelBFS } from '../hooks/useSubLevelBFS'
import { ENTRANCE_TYPES } from '../data/property-schema'
import { EnumField, LevelPicker, LevelRefField, NumberField } from './field-widgets'
import { hex0x } from '../lib/hex'

/** One world-map slot resolved to its entrance record + checkpoint pages. */
interface SlotRow {
  translevelId: number
  slot: string
  name: string
  e: WorldMapEntrance
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

/** The buildable slots of a world group (those with a real main entrance). */
function buildWorldSlots(model: WorldMapModel, group: LevelCatalogGroup, ctx: SlotCtx): SlotRow[] {
  return group.levels.flatMap((l) => {
    if (l.translevelId === undefined) return []
    const idx = entranceIndexFor(model, l.translevelId)
    const e = idx === undefined ? undefined : ctx.byIndex.get(idx)
    if (!e) return []
    return [{ translevelId: l.translevelId, slot: l.slot, name: l.name, e, pages: midwayPagesFor(model, l.translevelId, ctx) }]
  })
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

  const groups = catalog.groups.filter((g) => buildWorldSlots(model, g, ctx).length > 0)
  const curGroup = nav.view !== 'worlds' ? groups.find((g) => g.label === nav.group) : undefined
  const slots = curGroup ? buildWorldSlots(model, curGroup, ctx) : []
  const curSlot = nav.view === 'level' ? slots.find((s) => s.translevelId === nav.translevelId) : undefined
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
              onClick={() => setNav({ view: 'world', group: curGroup.label })}
              disabled={view === 'world'}
            >
              {curGroup.label}
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
          {groups.map((g) => (
            <button
              key={g.label}
              type="button"
              className="se-worldmap__world-btn"
              onClick={() => setNav({ view: 'world', group: g.label })}
            >
              <span className="se-worldmap__world-name">{g.label}</span>
              <span className="se-worldmap__world-count">
                {buildWorldSlots(model, g, ctx).length} levels
              </span>
            </button>
          ))}
        </div>
      )}

      {view === 'world' && curGroup && (
        <div className="se-worldmap__list">
          <p className="se-worldmap__note">
            Each level's data mapping (<b>plays</b>) and progression (<b>→</b>) — the
            world's flow. No live preview; Test Level to verify. Click a level to edit
            its spawn + checkpoints.
          </p>
          {slots.map((s) => (
            <div className="se-worldmap__row" key={s.translevelId}>
              <button
                type="button"
                className="se-worldmap__slot-link"
                title="Edit spawn + checkpoints"
                onClick={() => setNav({ view: 'level', group: curGroup.label, translevelId: s.translevelId })}
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
                  value={s.e.levelDataId}
                  onCommit={(v) => editor.setEntranceField(s.e.index, { levelDataId: v })}
                />
              </span>
              <span
                className="se-worldmap__cell se-worldmap__cell--prog"
                title="Progression target — the level the world map advances to after clearing this one"
              >
                <span className="se-worldmap__cell-label">→</span>
                <LevelRefField
                  value={s.e.progTarget}
                  onCommit={(v) => editor.setEntranceField(s.e.index, { progTarget: v })}
                />
              </span>
            </div>
          ))}
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
