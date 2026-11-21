// Pure edit operations + geometry for the autoscroll model (Bank03 tables; codec
// in snes-framework/scripts/autoscroll.ts). Every op returns a NEW model, or
// null when the edit is refused (the caller shows `reason` where relevant).
//
// Tracks point INTO sequences, and two tracks may share one (1-5, 6-5), so a
// structural edit re-points every track in the touched sequence so each keeps
// pointing at the same checkpoint it did before.

import {
  AUTOSCROLL_CAMERA_Y_OFFSET,
  AUTOSCROLL_FIRST_SPRITE,
  AUTOSCROLL_MAX_SPEED,
  AUTOSCROLL_MAX_X,
  AUTOSCROLL_MAX_Y,
  AUTOSCROLL_VALUES_SIZE,
  autoscrollBytesUsed
} from 'snes-framework/autoscroll-model'
import type {
  AutoscrollCheckpoint,
  AutoscrollModel,
  AutoscrollSequence,
  AutoscrollTrackStart
} from '../../../preload/api'

/** SNES screen size the camera box covers (world px). */
export const AUTOSCROLL_SCREEN_W = 256
export const AUTOSCROLL_SCREEN_H = 224

export interface CheckpointRef {
  sequence: number
  checkpoint: number
}

export const trackSpriteId = (track: number): number => AUTOSCROLL_FIRST_SPRITE + track
export const spriteTrack = (num: number): number => num - AUTOSCROLL_FIRST_SPRITE

export function bytesFree(model: AutoscrollModel): number {
  return AUTOSCROLL_VALUES_SIZE - autoscrollBytesUsed(model.sequences)
}

/** Camera top-left (world px) for a checkpoint. */
export function checkpointCamera(c: { x: number; y: number }): { x: number; y: number } {
  return { x: c.x * 16, y: c.y * 16 + AUTOSCROLL_CAMERA_Y_OFFSET }
}

/** Screen-center (world px) for a checkpoint — where the canvas draws its node. */
export function checkpointCenter(c: { x: number; y: number }): { x: number; y: number } {
  const cam = checkpointCamera(c)
  return { x: cam.x + AUTOSCROLL_SCREEN_W / 2, y: cam.y + AUTOSCROLL_SCREEN_H / 2 }
}

/** Inverse of checkpointCenter, snapped to cells and clamped to the camera-safe
 *  range (the canvas never drags a checkpoint out of bounds; hex entry can). */
export function checkpointFromCenter(wx: number, wy: number): { x: number; y: number } {
  const x = Math.round((wx - AUTOSCROLL_SCREEN_W / 2) / 16)
  const y = Math.round((wy - AUTOSCROLL_SCREEN_H / 2 - AUTOSCROLL_CAMERA_Y_OFFSET) / 16)
  return {
    x: Math.max(0, Math.min(AUTOSCROLL_MAX_X, x)),
    y: Math.max(0, Math.min(AUTOSCROLL_MAX_Y, y))
  }
}

/** Dominant-axis speed in px/frame (speed byte sign-extended ×16 subpixels). */
export function speedPxPerFrame(speed: number): number {
  const s = speed & 0x80 ? speed - 0x100 : speed
  return (s * 16) / 256
}

/** The checkpoints a track visits: from its start to its sequence's end. */
export function trackCheckpoints(model: AutoscrollModel, track: number): CheckpointRef[] {
  const t = model.tracks[track]
  const s = t ? model.sequences[t.sequence] : undefined
  if (!t || !s) return []
  const out: CheckpointRef[] = []
  for (let i = t.checkpoint; i < s.checkpoints.length; i++) out.push({ sequence: t.sequence, checkpoint: i })
  return out
}

/** Tracks whose start lies in `sequence` (for "shared with …" labels). */
export function tracksInSequence(model: AutoscrollModel, sequence: number): number[] {
  return model.tracks.flatMap((t, i) => (t.sequence === sequence ? [i] : []))
}

export function getCheckpoint(model: AutoscrollModel, ref: CheckpointRef): AutoscrollCheckpoint | undefined {
  return model.sequences[ref.sequence]?.checkpoints[ref.checkpoint]
}

function withSequence(
  model: AutoscrollModel,
  sequence: number,
  next: AutoscrollSequence,
  tracks: AutoscrollTrackStart[] = model.tracks
): AutoscrollModel {
  const sequences = model.sequences.slice()
  sequences[sequence] = next
  return { ...model, sequences, tracks }
}

/** Patch one checkpoint's fields (bytes, 0-255). */
export function setCheckpoint(
  model: AutoscrollModel,
  ref: CheckpointRef,
  patch: Partial<AutoscrollCheckpoint>
): AutoscrollModel | null {
  const s = model.sequences[ref.sequence]
  const c = s?.checkpoints[ref.checkpoint]
  if (!s || !c) return null
  const next = { ...c, ...patch }
  for (const v of [next.x, next.y, next.speed]) if (!Number.isInteger(v) || v < 0 || v > 0xff) return null
  if (next.x >= 0xfe) return null // would read as an end command
  if (next.x === c.x && next.y === c.y && next.speed === c.speed) return null
  const checkpoints = s.checkpoints.slice()
  checkpoints[ref.checkpoint] = next
  return withSequence(model, ref.sequence, { ...s, checkpoints })
}

/** Insert `cp` at index `at` of a sequence. Tracks keep pointing at the
 *  checkpoint they started on, except that inserting at a track's very first
 *  checkpoint index 0 makes the new checkpoint that track's start (so "insert
 *  before the first" extends the path backwards). Refused when it doesn't fit. */
export function insertCheckpoint(
  model: AutoscrollModel,
  sequence: number,
  at: number,
  cp: AutoscrollCheckpoint
): AutoscrollModel | null {
  const s = model.sequences[sequence]
  if (!s || at < 0 || at > s.checkpoints.length || bytesFree(model) < 3) return null
  const checkpoints = s.checkpoints.slice()
  checkpoints.splice(at, 0, { ...cp })
  const tracks = model.tracks.map((t) =>
    t.sequence === sequence && (t.checkpoint > at || (t.checkpoint === at && at > 0))
      ? { ...t, checkpoint: t.checkpoint + 1 }
      : t
  )
  return withSequence(model, sequence, { ...s, checkpoints }, tracks)
}

/** A checkpoint midway between `ref` and the next one (or offset past the
 *  last), for "insert after". */
export function checkpointAfter(model: AutoscrollModel, ref: CheckpointRef): AutoscrollCheckpoint | null {
  const s = model.sequences[ref.sequence]
  const a = s?.checkpoints[ref.checkpoint]
  if (!s || !a) return null
  const b = s.checkpoints[ref.checkpoint + 1]
  if (b) return { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2), speed: b.speed }
  return { x: Math.min(AUTOSCROLL_MAX_X, a.x + 0x10), y: a.y, speed: a.speed }
}

/** Remove a checkpoint. Refused when it would empty a sequence a track starts in. */
export function removeCheckpoint(model: AutoscrollModel, ref: CheckpointRef): { model: AutoscrollModel } | { reason: string } {
  const s = model.sequences[ref.sequence]
  if (!s || !s.checkpoints[ref.checkpoint]) return { reason: 'No such checkpoint.' }
  if (s.checkpoints.length === 1 && tracksInSequence(model, ref.sequence).length > 0) {
    return { reason: 'A track starts in this sequence — it needs at least one checkpoint.' }
  }
  const checkpoints = s.checkpoints.slice()
  checkpoints.splice(ref.checkpoint, 1)
  const last = checkpoints.length - 1
  const tracks = model.tracks.map((t) => {
    if (t.sequence !== ref.sequence) return t
    if (t.checkpoint > ref.checkpoint) return { ...t, checkpoint: t.checkpoint - 1 }
    if (t.checkpoint === ref.checkpoint && t.checkpoint > last) return { ...t, checkpoint: last }
    return t
  })
  return { model: withSequence(model, ref.sequence, { ...s, checkpoints }, tracks) }
}

export function setSequenceEnd(model: AutoscrollModel, sequence: number, end: 0xfe | 0xff): AutoscrollModel | null {
  const s = model.sequences[sequence]
  if (!s || s.end === end) return null
  return withSequence(model, sequence, { ...s, end })
}

export function setTrackStart(model: AutoscrollModel, track: number, start: CheckpointRef): AutoscrollModel | null {
  const cur = model.tracks[track]
  if (!cur || !getCheckpoint(model, start)) return null
  if (cur.sequence === start.sequence && cur.checkpoint === start.checkpoint) return null
  const tracks = model.tracks.slice()
  tracks[track] = { sequence: start.sequence, checkpoint: start.checkpoint }
  return { ...model, tracks }
}

/** Append a new one-checkpoint sequence (4 bytes). */
export function addSequence(model: AutoscrollModel, cp: AutoscrollCheckpoint): AutoscrollModel | null {
  if (bytesFree(model) < 4) return null
  return { ...model, sequences: [...model.sequences, { checkpoints: [{ ...cp }], end: 0xff }] }
}

/** Delete a sequence no track starts in; later track indices shift down. */
export function removeSequence(model: AutoscrollModel, sequence: number): { model: AutoscrollModel } | { reason: string } {
  if (!model.sequences[sequence]) return { reason: 'No such sequence.' }
  const users = tracksInSequence(model, sequence)
  if (users.length > 0) {
    return { reason: `Used by ${users.map((t) => `$${trackSpriteId(t).toString(16).toUpperCase()}`).join(', ')} — point those tracks elsewhere first.` }
  }
  const sequences = model.sequences.filter((_, i) => i !== sequence)
  const tracks = model.tracks.map((t) => (t.sequence > sequence ? { ...t, sequence: t.sequence - 1 } : t))
  return { model: { ...model, sequences, tracks } }
}

/** Give a track its own copy of the checkpoints it visits (so editing it no
 *  longer changes a track that shares the sequence). */
export function detachTrack(model: AutoscrollModel, track: number): { model: AutoscrollModel } | { reason: string } {
  const t = model.tracks[track]
  const s = t ? model.sequences[t.sequence] : undefined
  if (!t || !s) return { reason: 'No such track.' }
  const copy = s.checkpoints.slice(t.checkpoint).map((c) => ({ ...c }))
  const cost = copy.length * 3 + 1
  if (bytesFree(model) < cost) return { reason: `Needs ${cost} free bytes; ${bytesFree(model)} left.` }
  const tracks = model.tracks.slice()
  tracks[track] = { sequence: model.sequences.length, checkpoint: 0 }
  return { model: { ...model, sequences: [...model.sequences, { checkpoints: copy, end: s.end }], tracks } }
}

/** Restore the base-cart tables (keeps `reference`). */
export function resetToReference(model: AutoscrollModel): AutoscrollModel | null {
  if (!model.reference) return null
  return { ...model, sequences: structuredClone(model.reference.sequences), tracks: structuredClone(model.reference.tracks) }
}

/** Does the model differ from the base cart? */
export function differsFromReference(model: AutoscrollModel): boolean {
  if (!model.reference) return false
  return JSON.stringify({ s: model.sequences, t: model.tracks }) !==
    JSON.stringify({ s: model.reference.sequences, t: model.reference.tracks })
}

export const AUTOSCROLL_SPEED_MAX = AUTOSCROLL_MAX_SPEED
