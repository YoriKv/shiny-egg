import { describe, expect, it } from 'vitest'
import type { AutoscrollCheckpoint } from '../../../preload/api'
import { createAutoscrollPlayback } from './autoscroll-playback'

const cp = (x: number, y = 0, speed = 8): AutoscrollCheckpoint => ({ x, y, speed })

describe('autoscroll camera playback', () => {
  it('ramps in 1/256-pixel units and carries momentum through checkpoints', () => {
    const playback = createAutoscrollPlayback({
      track: 1, checkpoint: 0, sequence: { checkpoints: [cp(0), cp(1), cp(2)], end: 0xff }
    })
    playback.advance(90)
    expect(playback.frame).toEqual({ x: 15, y: 28, status: 'playing' })
    playback.advance(1)
    expect(playback.frame.x).toBe(16)
    playback.advance(36)
    expect(playback.frame.x).toBe(31)
    playback.advance(1)
    expect(playback.frame).toEqual({ x: 32, y: 28, status: 'locked' })
  })

  it('starts at the selected checkpoint and keeps horizontal-only previews at that height', () => {
    const playback = createAutoscrollPlayback({
      track: 0, checkpoint: 1, sequence: { checkpoints: [cp(0), cp(3, 2), cp(1, 3)], end: 0xfe }
    })
    expect(playback.frame).toEqual({ x: 48, y: 60, status: 'playing' })
    playback.advance(400)
    expect(playback.frame).toEqual({ x: 16, y: 60, status: 'released' })
  })

  it('matches positions sampled from the USA v1.0 1-5 camera trace', () => {
    const playback = createAutoscrollPlayback({
      track: 1,
      checkpoint: 0,
      sequence: { checkpoints: [cp(110, 96, 6), cp(99, 106), cp(91, 108), cp(60, 108, 6)], end: 0xff }
    })
    let elapsed = 0
    for (const [frame, x, y] of [
      [120, 1731, 1592], [414, 1584, 1724], [416, 1583, 1725], [670, 1456, 1756], [1300, 1218, 1756]
    ]) {
      playback.advance(frame - elapsed)
      expect(playback.frame).toEqual({ x, y, status: 'playing' })
      elapsed = frame
    }
  })

  it('stops a stalled or negative-speed segment and can start at the end', () => {
    for (const [speed, status] of [[0, 'stalled'], [0xff, 'negative-speed']] as const) {
      const sequence = { checkpoints: [cp(1), cp(2, 0, speed)], end: 0xfe as const }
      const playback = createAutoscrollPlayback({ track: 1, checkpoint: 0, sequence })
      playback.advance(1)
      expect(playback.frame).toEqual({ x: 16, y: 28, status })
      expect(createAutoscrollPlayback({ track: 1, checkpoint: 1, sequence }).frame)
        .toEqual({ x: 32, y: 28, status: 'released' })
    }
  })
})
