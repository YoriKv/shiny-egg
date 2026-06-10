import { Fragment, useEffect, useState, type Dispatch, type JSX } from 'react'
import type {
  CollisionEntry,
  DecodedLevelLayout,
  LevelData,
  LevelObject,
  LevelSprite,
  ScreenExit,
  SpriteProperty
} from '../../../preload/api'
import { getLevel } from '../data/levels'
import { getObjectInfo, getSprite, getSpriteNeighborDeps } from '../data/obj-metadata'
import { neighborSummary } from '../data/sprite-neighbor-text'
import { summarizeObjectCollision } from '../data/collision-info'
import {
  encodeObjectRecord,
  objectSizeMode
} from '../data/object-record'
import { useObjectPropertyTable } from '../hooks/useObjectPropertyTable'
import {
  exitFields,
  objectFields,
  spriteFields,
  type PropertyField
} from '../data/property-schema'
import { FieldRow, NumberField } from './field-widgets'
import type { LevelAction } from '../canvas/level-reducer'
import { spriteSpinDirection } from '../canvas/draw/sprite-variant-hints'
import type { IncomingExit, Selection } from '../types'
import { hex } from '../lib/hex'


// Module-level cache for the cart's collision table — it doesn't change
// across levels (it's per-cart) and is only ~5 KB, so fetching once on
// first selection and reusing forever is the right tradeoff vs touching
// the IPC on every Properties render.
let collisionTableCache: CollisionEntry[] | null = null
let collisionTableFetching: Promise<CollisionEntry[]> | null = null
function getCollisionTable(): Promise<CollisionEntry[]> {
  if (collisionTableCache) return Promise.resolve(collisionTableCache)
  if (collisionTableFetching) return collisionTableFetching
  collisionTableFetching = window.shinyEgg.render.collisionTable()
    .then((t) => { collisionTableCache = t; return t })
  return collisionTableFetching
}

export interface PropertiesBodyProps {
  /** The current selection (array — empty = nothing, 1 = single-entity detail,
   *  >1 = the multi-select count view). */
  selection: Selection[]
  /** Current level — resolves uid-based object/sprite/exit selections to the
   *  live entity, so a moved/edited entity shows its current values. */
  level: LevelData | null
  /** Level the canvas is currently showing. Used to fetch the decoded
   *  layout so per-object collision lookups can read actual cell IDs. */
  currentLevelRecordId: number | null
  /** The user's world-map level pick (anchors sub-level discovery). Its translevel
   *  is the play context's `CurrentLevelFromMap` — needed by sprite providers like
   *  the message box, whose behaviour keys off the translevel, not the sub-room. */
  rootLevelRecordId: number | null
  /** Dispatch field edits for the selected entity. */
  dispatchLevel: Dispatch<LevelAction>
  /** Live world-map spawn cell for the loaded level (entrance-table draft), shown
   *  + edited when a spawn is selected. Null when the level has no entrance. */
  worldMapSpawn?: { x: number; y: number } | null
  /** Commit an absolute spawn cell to the entrance-table document. Absent → the
   *  spawn shows read-only. */
  onSpawnCommit?: (x: number, y: number) => void
}

export function PropertiesBody({
  selection,
  level,
  currentLevelRecordId,
  rootLevelRecordId,
  dispatchLevel,
  worldMapSpawn,
  onSpawnCommit
}: PropertiesBodyProps): JSX.Element {
  if (selection.length === 0) {
    return <p className="se-props__empty">Nothing selected.</p>
  }
  // Multi-select shows per-type counts only — no individual editing (the group
  // is edited via Delete / Ctrl+D / Ctrl+C-X-V).
  if (selection.length > 1) {
    return <MultiProps selection={selection} level={level} />
  }
  const sel = selection[0]!
  const nothing = <p className="se-props__empty">Nothing selected.</p>
  switch (sel.kind) {
    case 'object': {
      const obj = level?.objects.find((o) => o.uid === sel.uid)
      return obj ? (
        <ObjectProps
          obj={obj}
          count={level?.objects.length ?? 1}
          currentLevelRecordId={currentLevelRecordId}
          dispatchLevel={dispatchLevel}
        />
      ) : (
        nothing
      )
    }
    case 'sprite': {
      const spr = level?.sprites.find((s) => s.uid === sel.uid)
      // The play context's translevel = the root (world-map) level's slot;
      // CurrentLevelFromMap persists across sub-room warps, so a sub-room's own
      // (missing) translevel is irrelevant.
      const translevelId =
        rootLevelRecordId !== null ? getLevel(rootLevelRecordId)?.translevelId ?? null : null
      return spr ? (
        <SpriteProps
          spr={spr}
          count={level?.sprites.length ?? 1}
          dispatchLevel={dispatchLevel}
          levelRecordId={currentLevelRecordId}
          translevelId={translevelId}
        />
      ) : nothing
    }
    case 'exit': {
      const exit = level?.exits.find((e) => e.uid === sel.uid)
      return exit ? <ExitProps exit={exit} dispatchLevel={dispatchLevel} /> : nothing
    }
    case 'incoming': return <IncomingProps incoming={sel.incoming} />
    case 'spawn':    return <SpawnProps spawn={worldMapSpawn ?? sel.spawn} onCommit={onSpawnCommit} />
  }
}

/** Multi-select summary: total + a per-type breakdown (objects grouped by
 *  id/exid, sprites grouped by id) with friendly names and counts. The group is
 *  edited via the keyboard/canvas (Delete · Ctrl+D · Ctrl+C/X/V), not here. */
function MultiProps({
  selection,
  level
}: {
  selection: Selection[]
  level: LevelData | null
}): JSX.Element {
  const objs = selection
    .flatMap((s) => (s.kind === 'object' ? [s.uid] : []))
    .map((uid) => level?.objects.find((o) => o.uid === uid))
    .filter((o): o is LevelObject => !!o)
  const sprs = selection
    .flatMap((s) => (s.kind === 'sprite' ? [s.uid] : []))
    .map((uid) => level?.sprites.find((s) => s.uid === uid))
    .filter((s): s is LevelSprite => !!s)

  // Group objects by (num, exnum); sprites by num. Insertion order = first seen.
  const objGroups = new Map<string, { label: string; count: number }>()
  for (const o of objs) {
    const key = `${o.num}:${o.exnum ?? ''}`
    const existing = objGroups.get(key)
    if (existing) {
      existing.count++
    } else {
      const id = o.num === 0 && o.exnum !== undefined ? `ext 0x${hex(o.exnum)}` : `0x${hex(o.num)}`
      const name = getObjectInfo(o.num, o.exnum).name
      objGroups.set(key, { label: name ? `${id} · ${name}` : id, count: 1 })
    }
  }
  const sprGroups = new Map<number, { label: string; count: number }>()
  for (const s of sprs) {
    const existing = sprGroups.get(s.num)
    if (existing) {
      existing.count++
    } else {
      const name = getSprite(s.num).name
      sprGroups.set(s.num, { label: name ? `0x${hex(s.num)} · ${name}` : `0x${hex(s.num)}`, count: 1 })
    }
  }

  return (
    <dl className="se-props__list">
      <dt>Selection</dt>
      <dd>
        {objs.length + sprs.length} entities — {objs.length} object
        {objs.length === 1 ? '' : 's'}, {sprs.length} sprite{sprs.length === 1 ? '' : 's'}
      </dd>
      {objGroups.size > 0 && (
        <>
          <dt>Objects ({objs.length})</dt>
          <dd className="se-props__count-list">
            {[...objGroups.values()].map((g) => (
              <div key={g.label} className="se-props__count-row">
                <span className="se-props__count-label" title={g.label}>{g.label}</span>
                <span className="se-props__count">×{g.count}</span>
              </div>
            ))}
          </dd>
        </>
      )}
      {sprGroups.size > 0 && (
        <>
          <dt>Sprites ({sprs.length})</dt>
          <dd className="se-props__count-list">
            {[...sprGroups.values()].map((g) => (
              <div key={g.label} className="se-props__count-row">
                <span className="se-props__count-label" title={g.label}>{g.label}</span>
                <span className="se-props__count">×{g.count}</span>
              </div>
            ))}
          </dd>
        </>
      )}
      <dt>Edit</dt>
      <dd className="se-props__desc">
        Group: drag/arrows move · +/− reorder · Del · Ctrl+D · Ctrl+C/X/V. Fields
        &amp; resize need single-select.
      </dd>
    </dl>
  )
}

// NumberField / EnumField / LevelRefField / FieldRow live in ./field-widgets
// (shared with the Level Header panel).

/** Render an entity's editable property descriptors as labelled rows. Each
 *  commit dispatches the entity-family `setFields` action with the descriptor's
 *  semantic patch — encoding stays the serializer's job. */
function PropertyFields<E>({
  entity,
  fields,
  onPatch
}: {
  entity: E
  fields: PropertyField<E>[]
  onPatch: (p: Partial<E>) => void
}): JSX.Element {
  return (
    <>
      {fields
        .filter((f) => !f.showIf || f.showIf(entity))
        .map((f) => (
          <FieldRow
            key={f.key}
            label={f.label}
            field={f.field}
            value={f.get(entity)}
            hint={f.hint}
            onCommit={(v) => onPatch(f.patch(v))}
          />
        ))}
    </>
  )
}

function ObjectProps({
  obj,
  count,
  currentLevelRecordId,
  dispatchLevel
}: {
  obj: LevelObject
  /** Total objects in the level — the stream-index upper bound. */
  count: number
  currentLevelRecordId: number | null
  dispatchLevel: Dispatch<LevelAction>
}): JSX.Element {
  const isExtended = obj.num === 0 && obj.exnum !== undefined
  const info = getObjectInfo(obj.num, obj.exnum)

  // Cart property table → this object's size mode (which W/H it encodes) and
  // its live record bytes. Cached fetch (per-cart static).
  const propTable = useObjectPropertyTable()
  const sizeMode = objectSizeMode(obj.num, obj.exnum, propTable)
  const rawBytes = encodeObjectRecord(obj, sizeMode)

  // Fetch + summarise the object's collision footprint (cart per-page table +
  // this level's on-disk decoded Map16 buffer). Reads the on-disk decode, so it
  // lags a live geometry edit until reselect — acceptable for a debug readout.
  const [collisionDisplay, setCollisionDisplay] = useState<string | null>(null)
  useEffect(() => {
    if (currentLevelRecordId === null) { setCollisionDisplay(null); return }
    let cancelled = false
    void Promise.all([
      getCollisionTable(),
      window.shinyEgg.render.decodeLevelLayout({ levelRecordId: currentLevelRecordId }) as Promise<DecodedLevelLayout | null>
    ]).then(([table, layout]) => {
      if (cancelled) return
      const summary = summarizeObjectCollision(obj, layout, table)
      setCollisionDisplay(summary ? summary.display : null)
    }).catch(() => {
      if (!cancelled) setCollisionDisplay(null)
    })
    return () => { cancelled = true }
  }, [obj.index, currentLevelRecordId])

  return (
    <dl className="se-props__list">
      <dt>Kind</dt>
      <dd><span className="se-props__id-kind">Object</span></dd>
      <dt>Name</dt>
      <dd>{info.name || '—'}</dd>
      <dt>Category</dt>
      <dd>
        <span className={`se-props__cat se-props__cat--${info.category}`}>
          {info.category}
        </span>
      </dd>
      {info.desc && (
        <>
          <dt>Description</dt>
          <dd className="se-props__desc">{info.desc}</dd>
        </>
      )}
      <dt>Type</dt>
      <dd>
        <span className="se-props__id-kind">{isExtended ? 'Extended' : 'Standard'}</span>
      </dd>
      <PropertyFields
        entity={obj}
        fields={objectFields(obj, sizeMode)}
        onPatch={(p) => dispatchLevel({ type: 'setObjectFields', uid: obj.uid!, patch: p })}
      />
      <dt>Collision</dt>
      <dd className="se-props__desc">{collisionDisplay ?? '…'}</dd>
      <dt>Index</dt>
      <dd>
        {/* Editing the index moves the object to that absolute stream position
            (= paint order) and shifts the others to fit — same as the reorder
            slider / +/- shortcuts. */}
        <NumberField
          value={obj.index}
          min={0}
          max={Math.max(0, count - 1)}
          onCommit={(v) => dispatchLevel({ type: 'setObjectIndex', uid: obj.uid!, index: v })}
        />
      </dd>
      <dt>Raw</dt>
      <dd className="se-props__raw">{rawBytes.map((b) => hex(b)).join(' ')}</dd>
    </dl>
  )
}

function IncomingProps({ incoming }: { incoming: IncomingExit }): JSX.Element {
  const screen = `${incoming.sourceScreenIndex & 0x0f},${(incoming.sourceScreenIndex >> 4) & 0x0f}`
  const source = getLevel(incoming.sourceLevelRecordId)
  return (
    <dl className="se-props__list">
      <dt>Kind</dt>
      <dd><span className="se-props__id-kind">Incoming entry</span></dd>
      <dt>From level</dt>
      <dd>
        {source ? `${source.slot} ${source.name}` : '—'}{' '}
        <code>0x{hex(incoming.sourceLevelRecordId)}</code>
      </dd>
      <dt>From screen</dt>
      <dd>
        0x{hex(incoming.sourceScreenIndex)} (col,row {screen})
      </dd>
      <dt>Lands at</dt>
      <dd>{incoming.destX}, {incoming.destY}</dd>
      <dt>Hint</dt>
      <dd className="se-props__desc">
        Drag the marker to move where the source room&apos;s exit lands the
        player (edits the source level&apos;s exit and auto-saves it; undoable).
        Double-click to jump back to the source room and center on its outgoing
        exit — an editor-only reverse navigation the player can&apos;t make
        in-game.
      </dd>
    </dl>
  )
}

function SpawnProps({
  spawn,
  onCommit
}: {
  /** Effective spawn cell — the world-map draft when editing (so live edits show
   *  here), else the selection's base position. */
  spawn: { x: number; y: number }
  /** Commit an absolute spawn cell to the entrance-table document. Absent when
   *  the document isn't available (no project / not loaded) → read-only. */
  onCommit?: (x: number, y: number) => void
}): JSX.Element {
  return (
    <dl className="se-props__list">
      <dt>Kind</dt>
      <dd><span className="se-props__id-kind">World-map spawn</span></dd>
      {onCommit ? (
        <>
          <FieldRow
            label="Spawn X"
            field={{ kind: 'num', min: 0, max: 255 }}
            value={spawn.x}
            hint="Entrance X in 16-px cells (×16 → pixel). Previews live on the canvas marker."
            onCommit={(v) => onCommit(v, spawn.y)}
          />
          <FieldRow
            label="Spawn Y"
            field={{ kind: 'num', min: 0, max: 255 }}
            value={spawn.y}
            hint="Entrance Y in 16-px cells (×16 → pixel). Previews live on the canvas marker."
            onCommit={(v) => onCommit(spawn.x, v)}
          />
        </>
      ) : (
        <>
          <dt>Position</dt>
          <dd>{spawn.x}, {spawn.y}</dd>
        </>
      )}
      <dt>Source</dt>
      {/* DATA_map_level_entrances is the auto-name at $17:F471; its current friendly label
          is YI_LevelDataPtrsAndEntranceData_DATA_map_level_entrances. Kept as
          the address-name here because it reads better in user-facing prose. */}
      <dd className="se-props__desc">
        Yoshi materializes at this cell when entering the level from the world map
        (<code>DATA_map_level_entrances</code> in the framework asm). Edits preview
        live here + on the canvas marker; <strong>Test Level</strong> to verify
        in-game. Also editable per-slot in the <strong>World Map</strong> panel.
      </dd>
    </dl>
  )
}

function SpriteProps({
  spr,
  count,
  dispatchLevel,
  levelRecordId,
  translevelId
}: {
  spr: LevelSprite
  /** Total sprites in the level — the stream-index upper bound. */
  count: number
  dispatchLevel: Dispatch<LevelAction>
  /** Loaded level + play-context translevel — fed to per-sprite-type providers. */
  levelRecordId: number | null
  translevelId: number | null
}): JSX.Element {
  const info = getSprite(spr.num)
  const neighborDeps = getSpriteNeighborDeps(spr.num)
  const spin = spriteSpinDirection(spr)
  return (
    <dl className="se-props__list">
      {/* Primary — identity + the core editable fields (id, position, stream
          order). These are always present and lead the panel. */}
      <dt>Kind</dt>
      <dd><span className="se-props__id-kind">Sprite</span></dd>
      <dt>Name</dt>
      <dd>{info.name || '—'}</dd>
      <dt>Category</dt>
      <dd>
        <span className={`se-props__cat se-props__cat--${info.category}`}>
          {info.category}
        </span>
      </dd>
      <PropertyFields
        entity={spr}
        fields={spriteFields(spr)}
        onPatch={(p) => dispatchLevel({ type: 'setSpriteFields', uid: spr.uid!, patch: p })}
      />
      <dt>Index</dt>
      <dd>
        {/* Editing the index moves the sprite to that absolute stream position
            (= overlap/draw order) and shifts the others to fit. */}
        <NumberField
          value={spr.index}
          min={0}
          max={Math.max(0, count - 1)}
          onCommit={(v) => dispatchLevel({ type: 'setSpriteIndex', uid: spr.uid!, index: v })}
        />
      </dd>

      {/* Level-data dependencies this sprite needs placed nearby — listed
          directly below the primary fields (no section divider). */}
      {neighborDeps.length > 0 && (
        <>
          <dt>Neighbours</dt>
          {/* Placed level data this sprite needs. `required` deps are verified
              on-canvas (red badge if missing); `info` deps aren't auto-checkable
              (keyhole tile / a Key from a connected sub-room) so they're shown
              for reference only. */}
          <dd className="se-props__count-list">
            {neighborDeps.map((d, i) => (
              <div
                key={i}
                className="se-props__count-row"
                title={d.cls === 'F' ? `${d.designerRule} — ${d.failureMode}` : `${d.designerRule} — if absent: ${d.failureMode}`}
              >
                <span className="se-props__count-label">{neighborSummary(d)}</span>
                <span className="se-props__count">{d.enforce ? 'required' : 'info'}</span>
              </div>
            ))}
          </dd>
        </>
      )}

      {/* Sprite-specific — derived spin direction + per-sprite-type computed
          values (e.g. the message box's resolved message). Renders its own
          section divider only when it has content. */}
      <SpriteSpecificProps
        spin={spin}
        num={spr.num}
        x={spr.x}
        y={spr.y}
        levelRecordId={levelRecordId}
        translevelId={translevelId}
      />
    </dl>
  )
}

/** The "Sprite-specific" section: per-sprite-type behaviour that only applies to
 *  some sprites — the placement-derived spin direction plus read-only computed
 *  properties (e.g. the message box's derived message ID/text). The computed set
 *  is fetched main-side per selection (it may read cart/asm data). Renders the
 *  section divider + rows only when there's at least one row (spin or a computed
 *  property); otherwise nothing, so a sprite with neither leaves no orphan header.
 *  The dt/dd pairs slot straight into the parent `dl`. */
function SpriteSpecificProps({
  spin,
  num,
  x,
  y,
  levelRecordId,
  translevelId
}: {
  /** Placement-derived rotation direction, or null for non-spinning sprites. */
  spin: 'cw' | 'ccw' | null
  num: number
  x: number
  y: number
  levelRecordId: number | null
  translevelId: number | null
}): JSX.Element | null {
  const [props, setProps] = useState<SpriteProperty[]>([])
  useEffect(() => {
    let cancelled = false
    setProps([])
    void window.shinyEgg.editor
      .spriteProperties({ levelRecordId, translevelId, num, x, y })
      .then((p) => {
        if (!cancelled) setProps(p)
      })
      .catch(() => {
        if (!cancelled) setProps([])
      })
    return () => {
      cancelled = true
    }
  }, [num, x, y, levelRecordId, translevelId])

  if (!spin && props.length === 0) return null
  return (
    <>
      <dt className="se-props__section">Sprite-specific</dt>
      {spin && (
        <>
          {/* Read-only: spin direction is derived from the sprite's X-cell parity
              (no stored byte), so it tracks the X field above and matches the
              on-outline badge. To flip it, nudge the sprite one column. */}
          <dt title="Auto-rotation direction, derived from the sprite's X-cell parity — nudge it one column to flip. Visual CW/CCW is a best-effort guess.">Spin</dt>
          <dd>{spin === 'cw' ? 'Clockwise' : 'Counterclockwise'}</dd>
        </>
      )}
      {props.map((p, i) => (
        <Fragment key={i}>
          <dt title={p.tooltip}>{p.label}</dt>
          <dd className="se-props__computed" title={p.tooltip}>
            {p.value}
          </dd>
        </Fragment>
      ))}
    </>
  )
}

function ExitProps({
  exit,
  dispatchLevel
}: {
  exit: ScreenExit
  dispatchLevel: Dispatch<LevelAction>
}): JSX.Element {
  const dest = exit.variant === 'warp' ? getLevel(exit.destLevelRecordId) : undefined
  return (
    <dl className="se-props__list">
      <dt>Kind</dt>
      <dd>
        <span className="se-props__id-kind">
          {exit.variant === 'warp' ? 'Exit · Warp' : 'Exit · Minibattle'}
        </span>
      </dd>
      {exit.variant === 'warp' && (
        <>
          <dt>Destination</dt>
          <dd className="se-props__desc">{dest ? `${dest.slot} ${dest.name}` : '—'}</dd>
        </>
      )}
      <PropertyFields
        entity={exit}
        fields={exitFields(exit)}
        onPatch={(p) => dispatchLevel({ type: 'setExitFields', uid: exit.uid!, patch: p })}
      />
      {exit.variant === 'warp' && (
        <>
          <dt>Hint</dt>
          <dd className="se-props__desc">Double-click the marker to jump.</dd>
        </>
      )}
    </dl>
  )
}
