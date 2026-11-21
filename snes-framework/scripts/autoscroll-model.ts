// Asm-free half of the autoscroll codec (scripts/autoscroll.ts): constants,
// byte budget, validation and advisories. Split out so the renderer can import
// it without the asm text helpers (its tsconfig targets an older lib).

import type { AutoscrollCheckpoint, AutoscrollModel, AutoscrollSequence } from './types.ts';

export const AUTOSCROLL_TRACK_COUNT = 12;
export const AUTOSCROLL_FIRST_SPRITE = 0x1ca;
export const AUTOSCROLL_VALUES_SIZE = 376;
/** Camera-safe maxima (larger values scroll the camera out of the level). */
export const AUTOSCROLL_MAX_X = 0xf0;
export const AUTOSCROLL_MAX_Y = 0x70;
export const AUTOSCROLL_MAX_SPEED = 0x7f;
/** Camera Y is the stored Y cell * 16 plus this offset (CODE_init_autoscroller). */
export const AUTOSCROLL_CAMERA_Y_OFFSET = 0x1c;


/** Special sprites whose tracks only move the camera horizontally (the init
 *  skips the $0C20 vertical lock for them, so the player still scrolls Y). */
export const AUTOSCROLL_HORIZONTAL_ONLY = new Set([0x1ca, 0x1d4]);
/** Tracks no vanilla sprite activates ($1D5 is a scroll stopper in the base
 *  game; racknae's enablesprite1D5 patch repurposes it). */
export const AUTOSCROLL_UNUSED_TRACKS = new Set([0x1d5]);

export function isAutoscrollSprite(num: number): boolean {
  return num >= AUTOSCROLL_FIRST_SPRITE && num < AUTOSCROLL_FIRST_SPRITE + AUTOSCROLL_TRACK_COUNT;
}

/** Bytes used by a sequence list in the values stream. */
export function autoscrollBytesUsed(sequences: readonly AutoscrollSequence[]): number {
  return sequences.reduce((n, s) => n + s.checkpoints.length * 3 + 1, 0);
}

/** Structural + range validation. Returns the first hard error, or null.
 *  Camera-bounds / speed advisories are `autoscrollWarnings`. */
export function validateAutoscroll(model: AutoscrollModel): string | null {
  if (!Array.isArray(model?.sequences) || !Array.isArray(model?.tracks)) return 'Malformed autoscroll model.';
  if (model.tracks.length !== AUTOSCROLL_TRACK_COUNT) {
    return `Expected ${AUTOSCROLL_TRACK_COUNT} autoscroll tracks; got ${model.tracks.length}.`;
  }
  const used = autoscrollBytesUsed(model.sequences);
  if (used > AUTOSCROLL_VALUES_SIZE) {
    return `Autoscroll data uses ${used} of ${AUTOSCROLL_VALUES_SIZE} bytes — remove ${used - AUTOSCROLL_VALUES_SIZE} byte(s) (one checkpoint = 3).`;
  }
  for (const [si, s] of model.sequences.entries()) {
    if (s.end !== 0xfe && s.end !== 0xff) return `Sequence ${si}: end command must be $FE or $FF.`;
    for (const [ci, c] of s.checkpoints.entries()) {
      for (const [k, v] of [['X', c.x], ['Y', c.y], ['speed', c.speed]] as const) {
        if (!Number.isInteger(v) || v < 0 || v > 0xff) return `Sequence ${si}, checkpoint ${ci}: ${k} must be a byte.`;
      }
      if (c.x >= 0xfe) return `Sequence ${si}, checkpoint ${ci}: X $${c.x.toString(16).toUpperCase()} would be read as an end command.`;
    }
  }
  for (const [i, t] of model.tracks.entries()) {
    const s = model.sequences[t.sequence];
    const name = `Track $${(AUTOSCROLL_FIRST_SPRITE + i).toString(16).toUpperCase()}`;
    if (!s) return `${name} points at a missing sequence.`;
    if (!Number.isInteger(t.checkpoint) || t.checkpoint < 0 || t.checkpoint >= s.checkpoints.length) {
      return `${name} must start on a checkpoint (its sequence has ${s.checkpoints.length}).`;
    }
  }
  return null;
}

/** Non-blocking advisories (the readme's camera-bounds and speed limits). */
export function autoscrollCheckpointWarnings(c: AutoscrollCheckpoint): string[] {
  const out: string[] = [];
  if (c.x > AUTOSCROLL_MAX_X) out.push(`X above $${AUTOSCROLL_MAX_X.toString(16).toUpperCase()} scrolls past the level's right edge.`);
  if (c.y > AUTOSCROLL_MAX_Y) out.push(`Y above $${AUTOSCROLL_MAX_Y.toString(16).toUpperCase()} scrolls past the level's bottom edge.`);
  if (c.speed === 0) out.push('Speed 0 never reaches the checkpoint — the camera stalls.');
  if (c.speed > AUTOSCROLL_MAX_SPEED) out.push('Speed above $7F is negative (sign-extended) — the camera moves away.');
  return out;
}
