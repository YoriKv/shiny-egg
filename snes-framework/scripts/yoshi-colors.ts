// Per-level Yoshi-color table editing — the `DATA_yoshi_level_colors` LUT in
// Bank02.asm: 72 `db` bytes, indexed by translevel slot (world*12+level), value =
// Yoshi color id 0..7 ($00 green, $01 light-blue, $02 yellow, $03 red, $04 pink,
// $05 cyan, $06 purple, $07 brown). The engine reads it at level load
// (Bank17 CODE_17E729: `LDX CurrentLevelFromMap; LDA DATA_yoshi_level_colors,x`)
// and the color id selects a Yoshi palette row (DATA_yoshi_palette_ptrs → a run
// in DATA_master_palette_rom_blob), so the World Map panel's dropdown previews
// the actual palette row those ids point at.
//
// Editor-owned via the `;@editable:yoshi-level-colors` region; the splice is
// byte-preserving (only a CHANGED byte's hex digits are rewritten), like
// island-tilemap.ts / world-map.ts — a no-change save round-trips to base
// byte-for-byte. Fixed length, so no byte budget.

import { findRegion } from './asm/markers.ts';
import { applyEdits } from './asm/text-literals.ts';
import { dataByteEdits, findRegionDataBytes } from './asm/data-words.ts';
import type { YoshiColorsModel } from './types.ts';

/** The asm file the table lives in (workRoot-relative). */
export const YOSHI_COLORS_FILE = 'yi/Banks/Bank02.asm';
/** The `;@editable` region wrapping the table. */
export const YOSHI_COLORS_REGION = 'yoshi-level-colors';
/** The `db` run's base label. */
export const YOSHI_COLORS_LABEL = 'DATA_yoshi_level_colors';
/** Translevel slots the table covers (6 worlds × 12 = the full 0x00..0x47 space). */
export const YOSHI_COLOR_SLOTS = 72;
/** Highest valid Yoshi color id (8 colors, 0..7). */
export const YOSHI_COLOR_MAX = 7;

export type SerializeResult = { ok: true; text: string } | { ok: false; error: string };

/** Parse the table's `db` bytes into a `colors[translevelId]` model. Throws if
 *  the `;@editable` markers are absent. */
export function parseYoshiColors(fileText: string): YoshiColorsModel {
  if (!findRegion(fileText, YOSHI_COLORS_REGION)) {
    throw new Error(`Missing ;@editable:${YOSHI_COLORS_REGION} markers.`);
  }
  const bytes = findRegionDataBytes(fileText, YOSHI_COLORS_REGION, YOSHI_COLORS_LABEL);
  const colors = new Array<number>(YOSHI_COLOR_SLOTS).fill(0);
  for (const b of bytes) {
    if (b.byteOffset < YOSHI_COLOR_SLOTS) colors[b.byteOffset] = b.value;
  }
  return { colors };
}

/**
 * Splice the edited color ids back into the region → edited text
 * (format-preserving; only bytes whose value changed are touched). Validates
 * only CHANGED slots (0..7), so an unchanged odd base byte is never rejected.
 * Throws nothing — returns an error result the resource layer surfaces.
 */
export function serializeYoshiColors(fileText: string, model: YoshiColorsModel): SerializeResult {
  if (!findRegion(fileText, YOSHI_COLORS_REGION)) {
    return {
      ok: false,
      error:
        `Missing ;@editable:${YOSHI_COLORS_REGION} markers — the overlay predates the editable ` +
        'Yoshi-color table. Upgrade the overlay (Project menu) and retry.'
    };
  }
  // Absolute-offset byte tokens (findRegionDataBytes already shifted hexStart/End
  // into the full text), so dataByteEdits → applyEdits splices the whole file.
  const bytes = findRegionDataBytes(fileText, YOSHI_COLORS_REGION, YOSHI_COLORS_LABEL);
  if (bytes.length !== YOSHI_COLOR_SLOTS) {
    return { ok: false, error: `Yoshi-color table has ${bytes.length} bytes; expected ${YOSHI_COLOR_SLOTS} (out of date?).` };
  }
  const changes = new Map<number, number>();
  for (let i = 0; i < YOSHI_COLOR_SLOTS; i++) {
    const v = model.colors[i];
    if (v === bytes[i]!.value) continue; // unchanged — never re-validate an odd base byte
    if (!Number.isInteger(v) || v < 0 || v > YOSHI_COLOR_MAX) {
      return { ok: false, error: `Yoshi color for slot 0x${i.toString(16).toUpperCase()} is ${v}; must be 0..${YOSHI_COLOR_MAX}.` };
    }
    changes.set(i, v);
  }
  return { ok: true, text: applyEdits(fileText, dataByteEdits(bytes, changes)) };
}
