import { describe, expect, it } from 'vitest'
import type { AutoscrollModel } from '../../../preload/api'
import { validateAutoscroll } from 'snes-framework/autoscroll-model'
import { hitTestCheckpoint } from '../canvas/draw/autoscroll'
import {
  addSequence,
  bytesFree,
  checkpointCenter,
  checkpointFromCenter,
  detachTrack,
  insertCheckpoint,
  removeCheckpoint,
  removeSequence,
  resetToReference,
  setCheckpoint,
  speedPxPerFrame,
  trackCheckpoints
} from './autoscroll-edit'

const cp = (x: number, y = 0x10, speed = 8) => ({ x, y, speed })

/** Two tracks share sequence 0 (track 1 starts at its 3rd checkpoint); track 2 owns sequence 1. */
function fixture(): AutoscrollModel {
  const tracks = Array.from({ length: 12 }, () => ({ sequence: 1, checkpoint: 0 }))
  tracks[0] = { sequence: 0, checkpoint: 0 }
  tracks[1] = { sequence: 0, checkpoint: 2 }
  const sequences = [
    { checkpoints: [cp(1), cp(2), cp(3), cp(4)], end: 0xff as const },
    { checkpoints: [cp(9)], end: 0xfe as const }
  ]
  return { sequences, tracks, reference: structuredClone({ sequences, tracks }) }
}

describe('autoscroll geometry', () => {
  it('maps checkpoints to camera centers and back', () => {
    expect(checkpointCenter({ x: 0x10, y: 0x20 })).toEqual({ x: 0x100 + 128, y: 0x200 + 0x1c + 112 })
    expect(checkpointFromCenter(0x100 + 128, 0x200 + 0x1c + 112)).toEqual({ x: 0x10, y: 0x20 })
    expect(checkpointFromCenter(99999, 99999)).toEqual({ x: 0xf0, y: 0x70 })
    expect(checkpointFromCenter(-50, -50)).toEqual({ x: 0, y: 0 })
  })
  it('converts speed bytes to px/frame', () => {
    expect(speedPxPerFrame(0x08)).toBe(0.5)
    expect(speedPxPerFrame(0xf8)).toBe(-0.5)
  })
  it('picks the nearest checkpoint when enlarged hit areas overlap', () => {
    const overlay = { model: fixture(), tracks: [0], active: null, drag: null, sprites: [] }
    const first = checkpointCenter(cp(1))
    expect(hitTestCheckpoint(overlay, first.x + 5, first.y, 1)?.checkpoint).toBe(0)
    expect(hitTestCheckpoint(overlay, first.x + 11, first.y, 1)?.checkpoint).toBe(1)
  })
})

describe('autoscroll edits', () => {
  it('lists the checkpoints a track visits', () => {
    expect(trackCheckpoints(fixture(), 1).map((r) => r.checkpoint)).toEqual([2, 3])
  })
  it('insert keeps shared tracks on their checkpoint', () => {
    const m = insertCheckpoint(fixture(), 0, 1, cp(0x20))!
    expect(m.tracks[0]).toEqual({ sequence: 0, checkpoint: 0 })
    expect(m.tracks[1]).toEqual({ sequence: 0, checkpoint: 3 })
    expect(m.sequences[0]!.checkpoints[3]).toEqual(cp(3))
    expect(validateAutoscroll(m)).toBeNull()
  })
  it('insert at index 0 becomes the track start', () => {
    const m = insertCheckpoint(fixture(), 0, 0, cp(0x20))!
    expect(m.tracks[0]).toEqual({ sequence: 0, checkpoint: 0 })
    expect(m.sequences[0]!.checkpoints[0]).toEqual(cp(0x20))
  })
  it('insert at a shared start index keeps the later track on its old checkpoint', () => {
    const m = insertCheckpoint(fixture(), 0, 2, cp(0x20))!
    expect(m.tracks[1]).toEqual({ sequence: 0, checkpoint: 3 })
  })
  it('refuses inserts past the byte budget', () => {
    const big: AutoscrollModel = { ...fixture(), sequences: [{ checkpoints: Array.from({ length: 124 }, () => cp(1)), end: 0xff }] }
    big.tracks = big.tracks.map(() => ({ sequence: 0, checkpoint: 0 }))
    expect(bytesFree(big)).toBe(376 - 373)
    expect(insertCheckpoint(big, 0, 0, cp(2))).not.toBeNull()
    expect(insertCheckpoint(insertCheckpoint(big, 0, 0, cp(2))!, 0, 0, cp(2))).toBeNull()
  })
  it('remove re-points tracks, and refuses to empty a used sequence', () => {
    const r = removeCheckpoint(fixture(), { sequence: 0, checkpoint: 0 })
    expect('model' in r && r.model.tracks[1]).toEqual({ sequence: 0, checkpoint: 1 })
    const last = removeCheckpoint(fixture(), { sequence: 0, checkpoint: 3 })
    expect('model' in last && last.model.tracks[1]).toEqual({ sequence: 0, checkpoint: 2 })
    const startGone = removeCheckpoint(fixture(), { sequence: 0, checkpoint: 2 })
    expect('model' in startGone && startGone.model.tracks[1]).toEqual({ sequence: 0, checkpoint: 2 })
    expect('reason' in removeCheckpoint(fixture(), { sequence: 1, checkpoint: 0 })).toBe(true)
  })
  it('refuses X values that read as end commands', () => {
    expect(setCheckpoint(fixture(), { sequence: 0, checkpoint: 0 }, { x: 0xfe })).toBeNull()
    expect(setCheckpoint(fixture(), { sequence: 0, checkpoint: 0 }, { x: 0xfd })).not.toBeNull()
  })
  it('sequence add/remove shifts track indices', () => {
    const added = addSequence(fixture(), cp(5))!
    expect(added.sequences).toHaveLength(3)
    expect('reason' in removeSequence(added, 1)).toBe(true)
    const r = removeSequence(addSequence(fixture(), cp(5))!, 2)
    expect('model' in r && r.model.sequences).toHaveLength(2)
  })
  it('detach copies a shared tail into its own sequence', () => {
    const r = detachTrack(fixture(), 1)
    expect('model' in r).toBe(true)
    if ('model' in r) {
      expect(r.model.tracks[1]).toEqual({ sequence: 2, checkpoint: 0 })
      expect(r.model.sequences[2]!.checkpoints).toEqual([cp(3), cp(4)])
      expect(validateAutoscroll(r.model)).toBeNull()
    }
  })
  it('restores the reference tables', () => {
    const edited = setCheckpoint(fixture(), { sequence: 0, checkpoint: 0 }, { speed: 1 })!
    expect(resetToReference(edited)!.sequences).toEqual(fixture().sequences)
  })
})
