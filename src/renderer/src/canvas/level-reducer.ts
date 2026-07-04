// Reducer over the loaded LevelData. Owns the editable-on-canvas state:
// the level itself plus an immutable `base` snapshot of the on-disk
// version (kept for dirty-check + future undo).
//
// Edit actions are intentionally small: each one changes one entity
// (object, sprite, exit, spawn) by index. The render pipeline re-decodes the
// object stream from scratch each commit (no per-action decode delta); the
// BG1/collision bitmaps are then updated INCREMENTALLY from a cell-diff of that
// full decode (see hooks/useLevelRenderLayers + render-bg1's renderBg1Patch).
//
// **Structural-sharing invariant (load-bearing — do not break).** Every action
// returns a NEW slice for what it changed (`{ ...level, objects: objs.slice() }`,
// the edited entity replaced by a fresh object) and keeps the unchanged slices'
// refs. hooks/useLevelRenderLayers keys each render layer's re-fetch on the
// referential equality of a slice (objects → bg1 + collision; sprites → sprite
// layer, + bg1 iff a changer sprite $1BA-$1C9 moved; header → all), and the
// Tier-2 patch path then diffs the decode. So a new action MUST produce a new ref
// on change — mutating `level.objects[i]` or a slice array in place would
// SILENTLY skip the layer's re-render — and should not clone a slice it didn't
// change (a spurious but harmless re-render). `saved` keeps the `level` ref, so a
// save re-renders nothing.
//
// Caveat — neighbour-aware stamps: the cart decoder (Bank13 object handlers)
// blends each object with tiles already in the buffer, so the full re-decode
// after a move can re-blend neighbouring objects at the new seam. The drag
// outline moves WYSIWYG, but the painted tiles under it can shift in ways the
// outline doesn't show; the on-commit repaint is what makes that visible.

import type {
  LevelData,
  LevelObject,
  LevelSprite,
  ScreenExit
} from '../../../preload/api'
import {
  MAX_LEVEL_EXITS,
  MAX_LEVEL_SPRITES,
  clampCell,
  clampGroupMove,
  clampHeaderField,
  clampObjectMove,
  clampObjectResize,
  clampSpriteMove
} from './limits'

export interface LevelState {
  /** The current (possibly edited) level. */
  level: LevelData | null
  /** Snapshot of the on-disk version of the same level. Used for
   *  dirty-check (`level === base` → clean). Reset each time a new
   *  level is loaded. */
  base: LevelData | null
  /** Undo stack — prior `level` snapshots, most-recent last. Cleared on
   *  load. Each committing action pushes the pre-edit `level`. */
  past: LevelData[]
  /** Redo stack — snapshots undone past, next-to-redo first. Cleared by
   *  any new committing action. */
  future: LevelData[]
  /** Next session uid to hand out. Set when a level loads (= total entities
   *  stamped); bumped by entity-creating actions (add/duplicate, later). */
  nextUid: number
  /** Monotonic count of *real* committing edits this level session (bumped only
   *  in `commit()`, reset to 0 on `load`; undo/redo/saved leave it untouched).
   *  App observes this to interleave the loaded-level undo with cross-level
   *  edits in one most-recent-first history — a no-op action doesn't call
   *  `commit()`, so it never desyncs that stack. See App's unified undo. */
  commits: number
}

export type LevelAction =
  | {
      /** Replace both `level` and `base` from disk (or null to clear).
       *  Stamps session uids on every entity and resets undo/redo. */
      type: 'load'
      data: LevelData | null
    }
  | {
      /** Translate one object (identified by uid) by integer cell deltas. */
      type: 'moveObject'
      uid: number
      dx: number
      dy: number
    }
  | {
      /** Translate one sprite (by uid) by integer cell deltas. */
      type: 'moveSprite'
      uid: number
      dx: number
      dy: number
    }
  | {
      /** Remove one object (by uid). The caller clears selection. */
      type: 'deleteObject'
      uid: number
    }
  | {
      /** Clone one object (by uid): offset one cell, insert right after the
       *  source (one step higher in paint order). The clone takes `nextUid`. */
      type: 'duplicateObject'
      uid: number
    }
  | {
      /** Move one object ±1 in the stream (= paint order). +1 = later/on top
       *  ("bring forward"); -1 = earlier/behind ("send back"). No-op at an edge. */
      type: 'reorderObject'
      uid: number
      delta: number
    }
  | {
      /** Move one sprite ±1 in the stream (= overlap/draw order). +1 = later/on
       *  top ("bring forward"); -1 = earlier/behind ("send back"). No-op at an
       *  edge. The sprite analog of `reorderObject`. */
      type: 'reorderSprite'
      uid: number
      delta: number
    }
  | {
      /** Reorder a multi-selection by ±1 as a group: every selected object (paint
       *  order) and sprite (overlap order) shifts past its nearest UNSELECTED
       *  neighbour in its own array, preserving relative order; items at the
       *  stream edge or blocked by a selected neighbour stay. +1 = forward/on top,
       *  -1 = back. One commit. Empty / nothing-moved → no-op. */
      type: 'reorderEntities'
      objectUids: number[]
      spriteUids: number[]
      delta: number
    }
  | {
      /** Move one object to an ABSOLUTE stream position (= paint order; higher =
       *  later/on top). Clamped to `[0, len-1]`. No-op (returns prior state, so
       *  no commit/undo entry) when already there — lets the reorder slider fire
       *  idempotent throttled dispatches without piling up history. */
      type: 'setObjectIndex'
      uid: number
      index: number
    }
  | {
      /** Move one sprite to an absolute stream position (overlap order; higher =
       *  drawn later/on top). Clamped; no-op when unchanged. */
      type: 'setSpriteIndex'
      uid: number
      index: number
    }
  | {
      /** Patch one object's fields (by uid). Clamped to bounds; order + count
       *  unchanged (no reindex). Descriptors only ever send geometry/id keys. */
      type: 'setObjectFields'
      uid: number
      patch: Partial<LevelObject>
    }
  | {
      /** Patch one sprite's fields (by uid). Clamped to bounds. */
      type: 'setSpriteFields'
      uid: number
      patch: Partial<LevelSprite>
    }
  | {
      /** Patch one exit's fields (by uid). A screen-index change is rejected if
       *  another exit already occupies that screen (one exit per screen). */
      type: 'setExitFields'
      uid: number
      patch: Partial<ScreenExit>
    }
  | {
      /** Set one level-header field (index 0..14) to an absolute value, clamped
       *  to the field's bit-width (clampHeaderField). No-op when unchanged.
       *  Returns a NEW `header` array (structural-sharing invariant) so every
       *  render layer re-fetches — header drives bg1/bg2/bg3/sprite/collision. */
      type: 'setHeaderField'
      index: number
      value: number
    }
  | { /** Remove one sprite (by uid). Caller clears selection. */
      type: 'deleteSprite'; uid: number }
  | { /** Clone one sprite (by uid): +1 cell, after source, takes `nextUid`. */
      type: 'duplicateSprite'; uid: number }
  | { /** Remove one exit (by uid). Caller clears selection. */
      type: 'deleteExit'; uid: number }
  | { /** Clone one exit (by uid) onto the first free screen; takes `nextUid`. */
      type: 'duplicateExit'; uid: number }
  | {
      /** Place a new WARP exit on a screen (the Place tool's "Screen Exit"
       *  entry). One exit per screen — an occupied screen is a no-op (the
       *  caller selects the existing exit instead). Defaults to a self-warp
       *  back to the clicked cell: immediately valid, obviously editable. */
      type: 'addExit'
      /** Screen index (0x00–0x7F) the exit sits on. */
      screenIndex: number
      /** Initial warp destination (the level itself at the clicked cell). */
      dest: { levelRecordId: number; x: number; y: number }
    }
  | {
      /** Convert one exit (by uid) between warp ↔ minibattle — a clean payload
       *  swap (the serializer encodes the variant by byte1 range). Geometry
       *  maps across (dest ↔ return cell; the OTHER side's level id seeds the
       *  counterpart); same-variant ⇒ no-op. */
      type: 'setExitVariant'
      uid: number
      variant: 'warp' | 'minibattle'
    }
  | {
      /** Batch-remove objects and/or sprites in one commit — the Erase tool's
       *  sweep. One commit = a single undo step + one render re-decode (vs. one
       *  per entity). Unmatched uids are ignored; an all-empty match is a no-op.
       *  Caller clears any selection that pointed at an erased entity. */
      type: 'deleteEntities'
      objectUids: number[]
      spriteUids: number[]
    }
  | {
      /** Translate a whole group (objects + sprites) by one shared, group-clamped
       *  delta in a single commit — the multi-select drag-to-move (and multi
       *  arrow-nudge). Clamped rigidly via clampGroupMove so the group can't shear
       *  at a boundary; new slice only for the kinds present (structural-sharing). */
      type: 'moveEntities'
      objectUids: number[]
      spriteUids: number[]
      dx: number
      dy: number
    }
  | {
      /** Batch-add objects and/or sprites in one commit — the multi-select
       *  Duplicate and Paste paths. Each entity gets a fresh uid (objects first
       *  in array order, then sprites — callers predict that run to reselect the
       *  new group) and is appended (top of paint order). Coords are clamped;
       *  sprites past the per-level cap are dropped (callers trim first so their
       *  uid prediction matches). One commit = a single undo step + one re-decode.
       *  New slice only for the kinds actually added (structural-sharing). */
      type: 'addEntities'
      objects: LevelObject[]
      sprites: LevelSprite[]
    }
  | {
      /** Place a new object at a cell (appended → top of paint order). */
      type: 'addObject'
      template: { num: number; exnum?: number; x: number; y: number; w: number; h: number }
    }
  | {
      /** Place a new sprite at a cell (cap-enforced). */
      type: 'addSprite'
      template: { num: number; x: number; y: number }
    }
  | {
      /** Mark the current `level` as the saved baseline. Fires after a
       *  successful save — flips `isDirty` back to false
       *  without touching the level itself. */
      type: 'saved'
    }
  | {
      /** Undo the last committing edit (no-op if the undo stack is empty). */
      type: 'undo'
    }
  | {
      /** Redo the last undone edit (no-op if the redo stack is empty). */
      type: 'redo'
    }

export const INITIAL_LEVEL_STATE: LevelState = {
  level: null,
  base: null,
  past: [],
  future: [],
  nextUid: 0,
  commits: 0
}

export function levelReducer(state: LevelState, action: LevelAction): LevelState {
  switch (action.type) {
    case 'load': {
      if (!action.data) {
        return { level: null, base: null, past: [], future: [], nextUid: 0, commits: 0 }
      }
      const { level, nextUid } = stampUids(action.data)
      // base === level by reference at load: isDirty starts false, and an
      // undo back to the load snapshot restores reference-equality → clean.
      return { level, base: level, past: [], future: [], nextUid, commits: 0 }
    }
    case 'moveObject': {
      if (!state.level) return state
      const objs = state.level.objects
      const idx = objs.findIndex((o) => o.uid === action.uid)
      if (idx < 0) return state
      const o = objs[idx]
      if (!o) return state
      // Clamp the translation so the object's box can't leave the level's
      // spatial bounds. Shared with the live drag overlay (Canvas) so the
      // committed move matches the preview; also the defensive backstop for
      // any other dispatcher of `moveObject`.
      const { dx, dy } = clampObjectMove(o, action.dx, action.dy)
      if (dx === 0 && dy === 0) return state
      const moved: LevelObject = { ...o, x: o.x + dx, y: o.y + dy }
      const nextObjs = objs.slice()
      nextObjs[idx] = moved
      return commit(state, { ...state.level, objects: nextObjs })
    }
    case 'moveSprite': {
      if (!state.level) return state
      const sprs = state.level.sprites
      const idx = sprs.findIndex((s) => s.uid === action.uid)
      const s = sprs[idx]
      if (idx < 0 || !s) return state
      const { dx, dy } = clampSpriteMove(s, action.dx, action.dy)
      if (dx === 0 && dy === 0) return state
      const moved: LevelSprite = { ...s, x: s.x + dx, y: s.y + dy }
      const nextSprs = sprs.slice()
      nextSprs[idx] = moved
      return commit(state, { ...state.level, sprites: nextSprs })
    }
    case 'deleteObject': {
      if (!state.level) return state
      const objs = state.level.objects
      const idx = objs.findIndex((o) => o.uid === action.uid)
      if (idx < 0) return state
      const nextObjs = objs.slice()
      nextObjs.splice(idx, 1)
      return commit(state, { ...state.level, objects: reindex(nextObjs) })
    }
    case 'duplicateObject': {
      if (!state.level) return state
      const objs = state.level.objects
      const idx = objs.findIndex((o) => o.uid === action.uid)
      const src = objs[idx]
      if (idx < 0 || !src) return state
      // Offset the clone one cell (clamped into bounds) so it's visibly
      // distinct, and insert it right after the source so it sits one step
      // higher in paint order (later in the stream = drawn on top).
      const { dx, dy } = clampObjectMove(src, 1, 1)
      const clone: LevelObject = {
        ...src,
        uid: state.nextUid,
        x: src.x + dx,
        y: src.y + dy
      }
      const nextObjs = objs.slice()
      nextObjs.splice(idx + 1, 0, clone)
      return {
        ...commit(state, { ...state.level, objects: reindex(nextObjs) }),
        nextUid: state.nextUid + 1
      }
    }
    case 'reorderObject': {
      if (!state.level) return state
      const objs = state.level.objects
      const idx = objs.findIndex((o) => o.uid === action.uid)
      if (idx < 0) return state
      const swap = idx + action.delta
      if (swap < 0 || swap >= objs.length) return state // at the stream edge
      const nextObjs = objs.slice()
      ;[nextObjs[idx], nextObjs[swap]] = [nextObjs[swap]!, nextObjs[idx]!]
      return commit(state, { ...state.level, objects: reindex(nextObjs) })
    }
    case 'reorderSprite': {
      if (!state.level) return state
      const sprs = state.level.sprites
      const idx = sprs.findIndex((s) => s.uid === action.uid)
      if (idx < 0) return state
      const swap = idx + action.delta
      if (swap < 0 || swap >= sprs.length) return state // at the stream edge
      const nextSprs = sprs.slice()
      ;[nextSprs[idx], nextSprs[swap]] = [nextSprs[swap]!, nextSprs[idx]!]
      return commit(state, { ...state.level, sprites: reindex(nextSprs) })
    }
    case 'reorderEntities': {
      if (!state.level) return state
      const objSet = new Set(action.objectUids)
      const sprSet = new Set(action.spriteUids)
      // Shift each kind within its own array; keep the untouched slice's ref
      // (the structural-sharing invariant the render layers key on).
      const objs = objSet.size ? shiftGroup(state.level.objects, objSet, action.delta) : state.level.objects
      const sprs = sprSet.size ? shiftGroup(state.level.sprites, sprSet, action.delta) : state.level.sprites
      if (objs === state.level.objects && sprs === state.level.sprites) return state // edge / no-op
      const next: LevelData = { ...state.level }
      if (objs !== state.level.objects) next.objects = reindex(objs)
      if (sprs !== state.level.sprites) next.sprites = reindex(sprs)
      return commit(state, next)
    }
    case 'setObjectIndex': {
      if (!state.level) return state
      const objs = moveToIndex(state.level.objects, action.uid, action.index)
      if (objs === state.level.objects) return state // already there → no commit
      return commit(state, { ...state.level, objects: reindex(objs) })
    }
    case 'setSpriteIndex': {
      if (!state.level) return state
      const sprs = moveToIndex(state.level.sprites, action.uid, action.index)
      if (sprs === state.level.sprites) return state
      return commit(state, { ...state.level, sprites: reindex(sprs) })
    }
    case 'setObjectFields': {
      if (!state.level) return state
      const objs = state.level.objects
      const idx = objs.findIndex((o) => o.uid === action.uid)
      const o = objs[idx]
      if (idx < 0 || !o) return state
      const merged: LevelObject = { ...o, ...action.patch }
      // num 0 = extended; it must carry an exnum to serialize.
      if (merged.num === 0 && merged.exnum === undefined) merged.exnum = 0
      const { x, y } = clampCell(merged.x, merged.y)
      const { w, h } = clampObjectResize({ ...merged, x, y }, merged.w, merged.h)
      const next: LevelObject = { ...merged, x, y, w, h }
      if (
        next.x === o.x && next.y === o.y && next.w === o.w && next.h === o.h &&
        next.num === o.num && next.exnum === o.exnum
      ) {
        return state
      }
      const nextObjs = objs.slice()
      nextObjs[idx] = next
      return commit(state, { ...state.level, objects: nextObjs })
    }
    case 'setSpriteFields': {
      if (!state.level) return state
      const sprs = state.level.sprites
      const idx = sprs.findIndex((s) => s.uid === action.uid)
      const s = sprs[idx]
      if (idx < 0 || !s) return state
      const merged: LevelSprite = { ...s, ...action.patch }
      const { x, y } = clampCell(merged.x, merged.y)
      const num = Math.max(0, Math.min(0x1ff, merged.num))
      const next: LevelSprite = { ...merged, x, y, num }
      if (next.x === s.x && next.y === s.y && next.num === s.num) return state
      const nextSprs = sprs.slice()
      nextSprs[idx] = next
      return commit(state, { ...state.level, sprites: nextSprs })
    }
    case 'setExitFields': {
      if (!state.level) return state
      const exits = state.level.exits
      const idx = exits.findIndex((e) => e.uid === action.uid)
      const e = exits[idx]
      if (idx < 0 || !e) return state
      const nextScreen = action.patch.screenIndex
      // One exit per screen — reject a move onto an occupied screen.
      if (
        nextScreen !== undefined &&
        nextScreen !== e.screenIndex &&
        exits.some((x, i) => i !== idx && x.screenIndex === nextScreen)
      ) {
        return state
      }
      const next = { ...e, ...action.patch } as ScreenExit
      const nextExits = exits.slice()
      nextExits[idx] = next
      return commit(state, { ...state.level, exits: nextExits })
    }
    case 'setHeaderField': {
      if (!state.level) return state
      const cur = state.level.header[action.index]
      if (cur === undefined) return state // index outside the 15-field header
      const value = clampHeaderField(action.index, action.value)
      if (value === cur) return state // no-op → no commit/undo entry
      const header = state.level.header.slice() // NEW ref — render layers key on it
      header[action.index] = value
      return commit(state, { ...state.level, header })
    }
    case 'deleteSprite': {
      if (!state.level) return state
      const sprs = state.level.sprites
      const idx = sprs.findIndex((s) => s.uid === action.uid)
      if (idx < 0) return state
      const nextSprs = sprs.slice()
      nextSprs.splice(idx, 1)
      return commit(state, { ...state.level, sprites: reindex(nextSprs) })
    }
    case 'duplicateSprite': {
      if (!state.level) return state
      const sprs = state.level.sprites
      if (sprs.length >= MAX_LEVEL_SPRITES) return state
      const idx = sprs.findIndex((s) => s.uid === action.uid)
      const src = sprs[idx]
      if (idx < 0 || !src) return state
      const { x, y } = clampCell(src.x + 1, src.y + 1)
      const clone: LevelSprite = { ...src, uid: state.nextUid, x, y }
      const nextSprs = sprs.slice()
      nextSprs.splice(idx + 1, 0, clone)
      return {
        ...commit(state, { ...state.level, sprites: reindex(nextSprs) }),
        nextUid: state.nextUid + 1
      }
    }
    case 'deleteExit': {
      if (!state.level) return state
      const exits = state.level.exits
      const idx = exits.findIndex((e) => e.uid === action.uid)
      if (idx < 0) return state
      const nextExits = exits.slice()
      nextExits.splice(idx, 1)
      return commit(state, { ...state.level, exits: nextExits })
    }
    case 'duplicateExit': {
      if (!state.level) return state
      const exits = state.level.exits
      const idx = exits.findIndex((e) => e.uid === action.uid)
      const src = exits[idx]
      if (idx < 0 || !src) return state
      // One exit per screen. Prefer the screen right after the source so the
      // copy lands next to where you're working; if that's occupied (or the
      // source is on the last screen) fall back to the first free screen from 0
      // up — so screen 0 is the natural fallback. No-op only when every screen
      // is occupied.
      const used = new Set(exits.map((e) => e.screenIndex))
      let screen = -1
      const next = src.screenIndex + 1
      if (next < MAX_LEVEL_EXITS && !used.has(next)) {
        screen = next
      } else {
        for (let i = 0; i < MAX_LEVEL_EXITS; i++) {
          if (!used.has(i)) { screen = i; break }
        }
      }
      if (screen < 0) return state
      const clone = { ...src, uid: state.nextUid, screenIndex: screen } as ScreenExit
      const nextExits = exits.slice()
      nextExits.splice(idx + 1, 0, clone)
      return {
        ...commit(state, { ...state.level, exits: nextExits }),
        nextUid: state.nextUid + 1
      }
    }
    case 'addExit': {
      if (!state.level) return state
      const exits = state.level.exits
      const screen = Math.max(0, Math.min(MAX_LEVEL_EXITS - 1, action.screenIndex))
      // One exit per screen + the per-level cap (every screen occupied).
      if (exits.length >= MAX_LEVEL_EXITS) return state
      if (exits.some((e) => e.screenIndex === screen)) return state
      const { x, y } = clampCell(action.dest.x, action.dest.y)
      const exit: ScreenExit = {
        uid: state.nextUid,
        variant: 'warp',
        screenIndex: screen,
        destLevelRecordId: Math.max(0, Math.min(0xff, action.dest.levelRecordId)),
        destX: x,
        destY: y,
        entranceType: 0
      }
      return {
        ...commit(state, { ...state.level, exits: [...exits, exit] }),
        nextUid: state.nextUid + 1
      }
    }
    case 'setExitVariant': {
      if (!state.level) return state
      const exits = state.level.exits
      const idx = exits.findIndex((e) => e.uid === action.uid)
      const e = exits[idx]
      if (idx < 0 || !e || e.variant === action.variant) return state
      const next: ScreenExit =
        e.variant === 'warp'
          ? {
              uid: e.uid,
              variant: 'minibattle',
              screenIndex: e.screenIndex,
              minibattleId: 0xde,
              returnX: e.destX,
              returnY: e.destY,
              returnLevelRecordId: e.destLevelRecordId
            }
          : {
              uid: e.uid,
              variant: 'warp',
              screenIndex: e.screenIndex,
              destLevelRecordId: e.returnLevelRecordId,
              destX: e.returnX,
              destY: e.returnY,
              entranceType: 0
            }
      const nextExits = exits.slice()
      nextExits[idx] = next
      return commit(state, { ...state.level, exits: nextExits })
    }
    case 'deleteEntities': {
      if (!state.level) return state
      const objSet = new Set(action.objectUids)
      const sprSet = new Set(action.spriteUids)
      // Filter only the kinds that actually had targets, so an erase that hit
      // only objects keeps the sprites slice's ref (and vice versa) — the
      // structural-sharing invariant the render layers key on.
      const objs = objSet.size
        ? state.level.objects.filter((o) => !objSet.has(o.uid!))
        : state.level.objects
      const sprs = sprSet.size
        ? state.level.sprites.filter((s) => !sprSet.has(s.uid!))
        : state.level.sprites
      const objsChanged = objs.length !== state.level.objects.length
      const sprsChanged = sprs.length !== state.level.sprites.length
      if (!objsChanged && !sprsChanged) return state // nothing matched → no-op
      const next: LevelData = { ...state.level }
      if (objsChanged) next.objects = reindex(objs)
      if (sprsChanged) next.sprites = reindex(sprs)
      return commit(state, next)
    }
    case 'moveEntities': {
      if (!state.level) return state
      const objSet = new Set(action.objectUids)
      const sprSet = new Set(action.spriteUids)
      const objs = state.level.objects.filter((o) => objSet.has(o.uid!))
      const sprs = state.level.sprites.filter((s) => sprSet.has(s.uid!))
      if (objs.length === 0 && sprs.length === 0) return state
      // One group-clamped delta for the whole set — matches the drag overlay.
      const { dx, dy } = clampGroupMove(objs, sprs, action.dx, action.dy)
      if (dx === 0 && dy === 0) return state
      const next: LevelData = { ...state.level }
      if (objs.length > 0) {
        next.objects = state.level.objects.map((o) =>
          objSet.has(o.uid!) ? { ...o, x: o.x + dx, y: o.y + dy } : o
        )
      }
      if (sprs.length > 0) {
        next.sprites = state.level.sprites.map((s) =>
          sprSet.has(s.uid!) ? { ...s, x: s.x + dx, y: s.y + dy } : s
        )
      }
      return commit(state, next)
    }
    case 'addEntities': {
      if (!state.level) return state
      // Assign uids objects-first (in array order), then sprites — the order
      // callers predict to reselect the new group.
      let uid = state.nextUid
      const stampedObjs = action.objects.map((o) => {
        const { x, y } = clampCell(o.x, o.y)
        const e: LevelObject = { ...o, x, y, uid: uid++ }
        if (e.num === 0 && e.exnum === undefined) e.exnum = 0
        return e
      })
      // Drop sprites that won't fit under the per-level cap (callers trim first,
      // so this is the defensive backstop — keeps uid assignment in step).
      const room = Math.max(0, MAX_LEVEL_SPRITES - state.level.sprites.length)
      const stampedSprs = action.sprites.slice(0, room).map((s) => {
        const { x, y } = clampCell(s.x, s.y)
        return { ...s, x, y, num: s.num & 0x1ff, uid: uid++ } as LevelSprite
      })
      if (stampedObjs.length === 0 && stampedSprs.length === 0) return state
      const next: LevelData = { ...state.level }
      if (stampedObjs.length > 0) next.objects = reindex([...state.level.objects, ...stampedObjs])
      if (stampedSprs.length > 0) next.sprites = reindex([...state.level.sprites, ...stampedSprs])
      return { ...commit(state, next), nextUid: uid }
    }
    case 'addObject': {
      if (!state.level) return state
      const t = action.template
      const { x, y } = clampCell(t.x, t.y)
      const obj: LevelObject = {
        uid: state.nextUid,
        index: state.level.objects.length,
        num: t.num,
        x,
        y,
        w: t.w,
        h: t.h,
        raw: []
      }
      if (t.exnum !== undefined) obj.exnum = t.exnum
      if (obj.num === 0 && obj.exnum === undefined) obj.exnum = 0
      const nextObjs = [...state.level.objects, obj]
      return {
        ...commit(state, { ...state.level, objects: reindex(nextObjs) }),
        nextUid: state.nextUid + 1
      }
    }
    case 'addSprite': {
      if (!state.level) return state
      if (state.level.sprites.length >= MAX_LEVEL_SPRITES) return state
      const t = action.template
      const { x, y } = clampCell(t.x, t.y)
      const spr: LevelSprite = {
        uid: state.nextUid,
        index: state.level.sprites.length,
        num: t.num & 0x1ff,
        x,
        y
      }
      const nextSprs = [...state.level.sprites, spr]
      return {
        ...commit(state, { ...state.level, sprites: reindex(nextSprs) }),
        nextUid: state.nextUid + 1
      }
    }
    case 'saved':
      // Pull `base` forward to the current `level`. Reference equality
      // → `isDirty` flips false.
      return { ...state, base: state.level }
    case 'undo': {
      if (!state.level) return state
      const prev = state.past[state.past.length - 1]
      if (!prev) return state
      return {
        ...state,
        level: prev,
        past: state.past.slice(0, -1),
        future: [state.level, ...state.future]
      }
    }
    case 'redo': {
      if (!state.level) return state
      const next = state.future[0]
      if (!next) return state
      return {
        ...state,
        level: next,
        past: [...state.past, state.level],
        future: state.future.slice(1)
      }
    }
  }
}

/** Produce the next state for a committing edit: push the pre-edit `level`
 *  onto the undo stack, clear the redo stack, install `nextLevel`. */
function commit(state: LevelState, nextLevel: LevelData): LevelState {
  return {
    ...state,
    level: nextLevel,
    past: state.level ? [...state.past, state.level] : state.past,
    future: [],
    commits: state.commits + 1
  }
}

/** Re-sync each entity's `index` field to its array position after a structural
 *  edit (insert/remove). The serializer ignores `index`, but the Properties
 *  panel displays it, so keep it truthful. Only clones entries whose index
 *  changed. Used for objects + sprites (exits have no stream index). */
function reindex<T extends { index: number }>(list: T[]): T[] {
  return list.map((e, i) => (e.index === i ? e : { ...e, index: i }))
}

/**
 * Move the `uid`'d entity to absolute position `to` (clamped to the list). Pure;
 * returns the SAME array reference when it's already there (or the uid is
 * missing), so callers can cheaply detect a no-op. Does NOT reindex — callers
 * that persist the order pass the result through `reindex`; the render-preview
 * path (Canvas) skips reindex since decode reads array order, not the field.
 */
export function moveToIndex<T extends { uid?: number | null }>(
  list: T[],
  uid: number,
  to: number
): T[] {
  const from = list.findIndex((e) => e.uid === uid)
  if (from < 0) return list
  const dest = Math.max(0, Math.min(list.length - 1, to))
  if (dest === from) return list
  const next = list.slice()
  const [moved] = next.splice(from, 1)
  next.splice(dest, 0, moved!)
  return next
}

/**
 * Group reorder by one step (`delta` sign = direction): shift every entity whose
 * uid is in `sel` past its nearest UNSELECTED neighbour in `list`, preserving
 * the group's relative order. Items at the stream edge — or blocked by a
 * selected neighbour (so the group moves as a block) — stay. Returns the SAME
 * array reference when nothing moved, so the caller can detect a no-op. Does NOT
 * reindex; callers that persist the order pass the result through `reindex`.
 *
 * Forward (`delta > 0`) walks high→low so a contiguous block shifts together;
 * back (`delta < 0`) walks low→high for the mirror.
 */
function shiftGroup<T extends { uid?: number | null }>(list: T[], sel: Set<number>, delta: number): T[] {
  const next = list.slice()
  const isSel = (e: T): boolean => e.uid != null && sel.has(e.uid)
  let moved = false
  if (delta > 0) {
    for (let i = next.length - 1; i >= 0; i--) {
      if (isSel(next[i]!) && i + 1 < next.length && !isSel(next[i + 1]!)) {
        ;[next[i], next[i + 1]] = [next[i + 1]!, next[i]!]
        moved = true
      }
    }
  } else if (delta < 0) {
    for (let i = 0; i < next.length; i++) {
      if (isSel(next[i]!) && i - 1 >= 0 && !isSel(next[i - 1]!)) {
        ;[next[i], next[i - 1]] = [next[i - 1]!, next[i]!]
        moved = true
      }
    }
  }
  return moved ? next : list
}

/** Stamp a fresh, session-stable `uid` on every editable entity (objects,
 *  sprites, exits) from one per-level counter. Editor-only — uids are never
 *  serialized (the serializer reads only the encoded fields). Returns the
 *  cloned level plus the next free uid. */
function stampUids(data: LevelData): { level: LevelData; nextUid: number } {
  let uid = 0
  const objects: LevelObject[] = data.objects.map((o) => ({ ...o, uid: uid++ }))
  const sprites: LevelSprite[] = data.sprites.map((s) => ({ ...s, uid: uid++ }))
  const exits: ScreenExit[] = data.exits.map((e) => ({ ...e, uid: uid++ }))
  return { level: { ...data, objects, sprites, exits }, nextUid: uid }
}

/** True if `level` differs from the on-disk snapshot. */
export function isDirty(state: LevelState): boolean {
  return state.level !== state.base
}
