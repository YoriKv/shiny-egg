import { AUTOSCROLL_HORIZONTAL_ONLY } from 'snes-framework/autoscroll-model'
import type { AutoscrollSequence } from '../../../preload/api'
import { checkpointCamera, speedPxPerFrame, trackSpriteId } from './autoscroll-edit'

export const AUTOSCROLL_FRAME_MS = 1000 / 60.0988 // NTSC SNES video frame
const SUBPIXELS = 256

interface Position {
  x: number
  y: number
}

export type AutoscrollPlaybackStatus = 'playing' | 'locked' | 'released' | 'stalled' | 'negative-speed'

export interface AutoscrollPlaybackRequest {
  track: number
  sequence: AutoscrollSequence
  checkpoint: number
}

// CODE_09907C chooses Y on a tie and divides the minor-axis product as an
// integer. Its restoring division returns all ones for a zero denominator.
function targetVelocity(dx: number, dy: number, speed: number): Position {
  const x = Math.abs(dx)
  const y = Math.abs(dy)
  const direction = (delta: number): number => delta < 0 ? -1 : 1
  if (x > y) return { x: direction(dx) * speed, y: direction(dy) * Math.trunc(speed * y / x) }
  return { x: y === 0 ? -1 : direction(dx) * Math.trunc(speed * x / y), y: direction(dy) * speed }
}

// Bank03 integrates in 8.8 fixed point and compares whole pixels against the
// target. On crossing, it overwrites only the integer part, keeping the fraction.
function advanceAxis(position: number, velocity: number, target: number, initialDelta: number): number {
  const next = position + velocity
  const delta = Math.floor(next / SUBPIXELS) - target
  return (delta ^ initialDelta) >= 0
    ? target * SUBPIXELS + (next & 0xff)
    : next
}

/** Take one camera tick at a time, preserving velocity and fraction through
 * checkpoint changes. Starting the preview places the camera at rest. */
export function createAutoscrollPlayback({ track, sequence, checkpoint }: AutoscrollPlaybackRequest) {
  const { checkpoints, end } = sequence
  const start = checkpointCamera(checkpoints[checkpoint]!)
  const horizontalOnly = AUTOSCROLL_HORIZONTAL_ONLY.has(trackSpriteId(track))
  const finished = end === 0xff ? 'locked' : 'released'
  let next = checkpoint + 1
  let target = checkpoints[next] ? checkpointCamera(checkpoints[next]) : start
  let initialX = target.x - start.x
  let initialY = target.y - start.y
  let x = start.x * SUBPIXELS
  let y = start.y * SUBPIXELS
  let vx = 0
  let vy = 0
  let status: AutoscrollPlaybackStatus = checkpoints[next] ? 'playing' : finished
  const whole = (value: number): number => Math.floor(value / SUBPIXELS)

  return {
    get frame() {
      return { x: whole(x), y: horizontalOnly ? start.y : whole(y), status }
    },
    advance(frames: number): void {
      for (let i = 0; i < frames && status === 'playing'; i++) {
        const speed = speedPxPerFrame(checkpoints[next]!.speed) * SUBPIXELS
        if (speed < 0) {
          status = 'negative-speed'
          return
        }
        const desired = targetVelocity(target.x - whole(x), target.y - whole(y), speed)
        vx += Math.sign(desired.x - vx)
        vy += Math.sign(desired.y - vy)
        x = advanceAxis(x, vx, target.x, initialX)
        y = advanceAxis(y, vy, target.y, initialY)

        if (whole(x) === target.x && whole(y) === target.y) {
          const following = checkpoints[++next]
          if (!following) {
            status = finished
            return
          }
          target = checkpointCamera(following)
          initialX = target.x - whole(x)
          initialY = target.y - whole(y)
        } else if (speed === 0 && vx === 0 && vy === 0) {
          status = 'stalled'
        }
      }
    }
  }
}
