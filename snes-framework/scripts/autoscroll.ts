// Codec for the autoscroll tables in Bank03.asm (`;@editable:autoscroll`):
//
//   DATA_autoscroller_indices  12 words: byte offset of each track's first
//                              checkpoint in the values stream. Track i is
//                              special sprite $1CA + i (CODE_init_autoscroller
//                              indexes it with (SprID - $1B9) - $11).
//   DATA_autoscroller_values   376 bytes of 3-byte checkpoints {x, y, speed},
//                              each run ended by an end command byte read in
//                              the x position: $FE = restore normal scrolling,
//                              $FF = lock the camera where it stopped.
//
// Engine (CODE_init_autoscroller / CODE_main_autoscroller, $03:D83D/$03:D8D7):
// target camera X = x*16, Y = y*16 + $1C (top-left). The speed byte is sign-
// extended and *16; the GSU (CODE_09907C) gives the dominant axis that velocity
// in subpixels/frame and scales the other axis by minor/major. The live
// velocity ramps toward it by 1 subpixel per frame, so big speed jumps lag.
//
// Both tables are one contiguous `dw` run (indices then values), parsed and
// rewritten as 200 words. Saves splice only changed words (format preserved).
// The values stream must keep its exact size: CODE_03D83D follows at $03:D83D,
// and patches (e.g. racknae's enable-1D5) hard-code that address. Unused bytes
// are padded with $FF, which nothing reads.

import { applyEdits } from './asm/text-literals.ts';
import { dataWordEdits, findRegionDataWords } from './asm/data-words.ts';
import type {
  AutoscrollCheckpoint,
  AutoscrollModel,
  AutoscrollSequence,
  AutoscrollTrackStart,
} from './types.ts';
import {
  AUTOSCROLL_FIRST_SPRITE,
  AUTOSCROLL_TRACK_COUNT,
  AUTOSCROLL_VALUES_SIZE,
  validateAutoscroll,
} from './autoscroll-model.ts';

export * from './autoscroll-model.ts';

export const AUTOSCROLL_BANK_FILE = 'yi/Banks/Bank03.asm';
export const AUTOSCROLL_REGION = 'autoscroll';

const TABLE_LABEL = 'DATA_autoscroller_indices';
const WORD_COUNT = AUTOSCROLL_TRACK_COUNT + AUTOSCROLL_VALUES_SIZE / 2;
function tableWords(text: string) {
  const words = findRegionDataWords(text, AUTOSCROLL_REGION, TABLE_LABEL);
  if (words.length !== WORD_COUNT) {
    throw new Error(
      `${TABLE_LABEL} + DATA_autoscroller_values hold ${words.length * 2} bytes; ` +
      `expected ${WORD_COUNT * 2} (out of date or hand-resized?).`
    );
  }
  return words;
}

/** Byte offset of each sequence's first checkpoint. */
function sequenceOffsets(sequences: readonly AutoscrollSequence[]): number[] {
  const out: number[] = [];
  let o = 0;
  for (const s of sequences) {
    out.push(o);
    o += s.checkpoints.length * 3 + 1;
  }
  return out;
}

/** Split the values stream into sequences and resolve each track offset to a
 *  (sequence, checkpoint). Throws on a layout the structured model can't hold
 *  (a track pointing mid-record or at an end byte). */
export function decodeAutoscroll(indices: readonly number[], values: readonly number[]): AutoscrollModel {
  const sequences: AutoscrollSequence[] = [];
  const starts = new Map<number, AutoscrollTrackStart>();
  let o = 0;
  let current: AutoscrollCheckpoint[] = [];
  while (o < values.length) {
    const b = values[o]!;
    if (b >= 0xfe) {
      sequences.push({ checkpoints: current, end: b as 0xfe | 0xff });
      current = [];
      o += 1;
      continue;
    }
    if (o + 3 > values.length) break; // truncated tail: padding
    starts.set(o, { sequence: sequences.length, checkpoint: current.length });
    current.push({ x: b, y: values[o + 1]!, speed: values[o + 2]! });
    o += 3;
  }
  // An unterminated tail is only meaningful if a track starts in it.
  const tracks = indices.map((offset, i): AutoscrollTrackStart => {
    const at = starts.get(offset);
    if (!at) {
      throw new Error(
        `Autoscroll track $${(AUTOSCROLL_FIRST_SPRITE + i).toString(16).toUpperCase()} starts at ` +
        `offset $${offset.toString(16).toUpperCase()}, which is not a checkpoint.`
      );
    }
    if (at.sequence >= sequences.length) {
      throw new Error(
        `Autoscroll track $${(AUTOSCROLL_FIRST_SPRITE + i).toString(16).toUpperCase()} runs off the end ` +
        'of the checkpoint data without an end command.'
      );
    }
    return at;
  });
  // Trailing empty sequences that no track uses are padding ($FF fill).
  const used = new Set(tracks.map((t) => t.sequence));
  while (sequences.length > 0) {
    const last = sequences.length - 1;
    if (sequences[last]!.checkpoints.length > 0 || used.has(last)) break;
    sequences.pop();
  }
  return { sequences, tracks };
}

/** Parse the autoscroll tables from Bank03 asm text. */
export function parseAutoscroll(text: string): AutoscrollModel {
  const words = tableWords(text);
  const indices = words.slice(0, AUTOSCROLL_TRACK_COUNT).map((w) => w.value);
  const values: number[] = [];
  for (const w of words.slice(AUTOSCROLL_TRACK_COUNT)) values.push(w.value & 0xff, w.value >>> 8);
  return decodeAutoscroll(indices, values);
}

/** The two tables' cart bytes for a model: 24 index bytes, then the 376-byte
 *  values stream padded with $FF. Throws on an invalid model. */
export function autoscrollBytes(model: AutoscrollModel): { indices: number[]; values: number[] } {
  const err = validateAutoscroll(model);
  if (err) throw new RangeError(err);
  const values: number[] = [];
  for (const s of model.sequences) {
    for (const c of s.checkpoints) values.push(c.x, c.y, c.speed);
    values.push(s.end);
  }
  while (values.length < AUTOSCROLL_VALUES_SIZE) values.push(0xff);
  const offsets = sequenceOffsets(model.sequences);
  const indices = model.tracks.map((t) => offsets[t.sequence]! + t.checkpoint * 3);
  return { indices, values };
}

export type SerializeAutoscrollResult = { ok: true; text: string } | { ok: false; error: string };

/** Validate and splice the tables into Bank03 asm text (changed words only). */
export function serializeAutoscroll(text: string, model: AutoscrollModel): SerializeAutoscrollResult {
  try {
    const words = tableWords(text);
    const { indices, values } = autoscrollBytes(model);
    const changes = new Map<number, number>();
    indices.forEach((v, i) => changes.set(i * 2, v));
    for (let i = 0; i < AUTOSCROLL_VALUES_SIZE / 2; i++) {
      changes.set((AUTOSCROLL_TRACK_COUNT + i) * 2, values[i * 2]! | (values[i * 2 + 1]! << 8));
    }
    return { ok: true, text: applyEdits(text, dataWordEdits(words, changes)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
