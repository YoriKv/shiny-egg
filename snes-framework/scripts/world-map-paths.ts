// World-map Yoshi path editing — the two Bank17.asm coordinate table groups the
// World Map panel's per-world path editor owns:
//
//   • DOTS  — `DATA_worldmap_yoshi_xcoords_by_world` / `…_ycoords_by_world`
//     ($17BDAE/$17BE0E): 6 worlds × 8 words each — where each level's Yoshi
//     sits on the overworld, indexed world*8+dot (dot = level position 0-7).
//   • WALK  — `DATA_worldmap_yoshi_walk_xcoords` / `…_walk_ycoords`
//     ($17B781/$17B901): 4 checkpoint words per level × 48 levels
//     (world*8+level) — the waypoints Yoshi walks to after clearing a level;
//     the engine stops at the first $0000 word (CODE_17BC18).
//
// All values are PIXELS in the 512×256 overworld space. Each group's x + y
// tables share one `;@editable` region (the y table is just the next `dw` run,
// so one label scan covers both — x words first, then y at the same offsets
// + the table size). Edits are format-preserving in-place `dw` operand splices
// (data-words.ts), like palette-edit.ts / yoshi-colors.ts — a no-change save
// round-trips to base byte-for-byte. Fixed length, so no byte budget.

import { findRegion } from './asm/markers.ts';
import { applyEdits, type TextEdit } from './asm/text-literals.ts';
import { dataWordEdits, findRegionDataWords, type DataWord } from './asm/data-words.ts';
import type { WorldMapPathPoint, WorldMapPathsModel } from './types.ts';

/** The asm file both table groups live in (workRoot-relative). */
export const WORLD_MAP_PATHS_FILE = 'yi/Banks/Bank17.asm';
/** The `;@editable` region wrapping the per-world Yoshi dot tables (x + y). */
export const WORLD_MAP_YOSHI_DOTS_REGION = 'world-map-yoshi-dots';
/** The `;@editable` region wrapping the walk-checkpoint tables (x + y). */
export const WORLD_MAP_WALK_PATHS_REGION = 'world-map-yoshi-walk-paths';
/** Base label of the dots group's `dw` run (the x table; y follows in-run). */
export const WORLD_MAP_YOSHI_DOTS_LABEL = 'DATA_worldmap_yoshi_xcoords_by_world';
/** Base label of the walk group's `dw` run (the x table; y follows in-run). */
export const WORLD_MAP_WALK_PATHS_LABEL = 'DATA_worldmap_yoshi_walk_xcoords';

export const PATH_WORLDS = 6;
export const PATH_DOTS_PER_WORLD = 8;
export const PATH_LEVELS_PER_WORLD = 8;
export const PATH_CHECKPOINTS_PER_LEVEL = 4;

/** Words per axis (x or y) of each group. */
const DOT_AXIS_WORDS = PATH_WORLDS * PATH_DOTS_PER_WORLD; // 48
const WALK_AXIS_WORDS = PATH_WORLDS * PATH_LEVELS_PER_WORLD * PATH_CHECKPOINTS_PER_LEVEL; // 192

export type SerializeResult = { ok: true; text: string } | { ok: false; error: string };

/** A table group's parsed `dw` words, sliced to exactly x+y. The slice guards
 *  the marker-less fallback scan, which would otherwise run past the group into
 *  the next contiguous `dw` table (DATA_17BA81 / DATA_17BE6E). */
function groupWords(fileText: string, regionId: string, label: string, axisWords: number): DataWord[] {
  return findRegionDataWords(fileText, regionId, label).slice(0, axisWords * 2);
}

function missingMarkers(regionId: string): SerializeResult {
  return {
    ok: false,
    error:
      `Missing ;@editable:${regionId} markers — the overlay predates the editable ` +
      'Yoshi path tables. Upgrade the overlay (Project menu) and retry.'
  };
}

/** Parse both table groups into the editor model. Throws if either group's
 *  `;@editable` markers are absent or a table is truncated. */
export function parseWorldMapPaths(fileText: string): WorldMapPathsModel {
  for (const region of [WORLD_MAP_YOSHI_DOTS_REGION, WORLD_MAP_WALK_PATHS_REGION]) {
    if (!findRegion(fileText, region)) throw new Error(`Missing ;@editable:${region} markers.`);
  }
  const dotWords = groupWords(fileText, WORLD_MAP_YOSHI_DOTS_REGION, WORLD_MAP_YOSHI_DOTS_LABEL, DOT_AXIS_WORDS);
  if (dotWords.length !== DOT_AXIS_WORDS * 2) {
    throw new Error(`Yoshi-dot tables have ${dotWords.length} words; expected ${DOT_AXIS_WORDS * 2}.`);
  }
  const walkWords = groupWords(fileText, WORLD_MAP_WALK_PATHS_REGION, WORLD_MAP_WALK_PATHS_LABEL, WALK_AXIS_WORDS);
  if (walkWords.length !== WALK_AXIS_WORDS * 2) {
    throw new Error(`Walk-checkpoint tables have ${walkWords.length} words; expected ${WALK_AXIS_WORDS * 2}.`);
  }

  const dots: WorldMapPathPoint[][] = [];
  for (let w = 0; w < PATH_WORLDS; w++) {
    const row: WorldMapPathPoint[] = [];
    for (let d = 0; d < PATH_DOTS_PER_WORLD; d++) {
      const i = w * PATH_DOTS_PER_WORLD + d;
      row.push({ x: dotWords[i]!.value, y: dotWords[DOT_AXIS_WORDS + i]!.value });
    }
    dots.push(row);
  }
  const checkpoints: WorldMapPathPoint[][][] = [];
  for (let w = 0; w < PATH_WORLDS; w++) {
    const world: WorldMapPathPoint[][] = [];
    for (let l = 0; l < PATH_LEVELS_PER_WORLD; l++) {
      const level: WorldMapPathPoint[] = [];
      for (let k = 0; k < PATH_CHECKPOINTS_PER_LEVEL; k++) {
        const i = (w * PATH_LEVELS_PER_WORLD + l) * PATH_CHECKPOINTS_PER_LEVEL + k;
        level.push({ x: walkWords[i]!.value, y: walkWords[WALK_AXIS_WORDS + i]!.value });
      }
      world.push(level);
    }
    checkpoints.push(world);
  }
  return { dots, checkpoints };
}

/** Collect a group's byteOffset→value changes (model vs the parsed run). Only
 *  CHANGED words are validated, so an odd base word is never rejected. `name`
 *  labels error messages. Returns an error string, or null on success. */
function collectChanges(
  words: DataWord[],
  axisWords: number,
  valueAt: (i: number) => { v: number; what: string },
  changes: Map<number, number>
): string | null {
  for (let i = 0; i < axisWords * 2; i++) {
    const { v, what } = valueAt(i);
    if (v === words[i]!.value) continue;
    if (!Number.isInteger(v) || v < 0 || v > 0xffff) {
      return `${what} value ${v} is not a word (0–65535).`;
    }
    changes.set(words[i]!.byteOffset, v);
  }
  return null;
}

/**
 * Splice the edited model back into `fileText` → edited text (format-preserving;
 * only words whose value changed are touched). Both regions' word tokens carry
 * absolute offsets, so one `applyEdits` splices the whole file. Returns an error
 * result (never throws) — the resource layer surfaces it.
 */
export function serializeWorldMapPaths(fileText: string, model: WorldMapPathsModel): SerializeResult {
  if (!findRegion(fileText, WORLD_MAP_YOSHI_DOTS_REGION)) return missingMarkers(WORLD_MAP_YOSHI_DOTS_REGION);
  if (!findRegion(fileText, WORLD_MAP_WALK_PATHS_REGION)) return missingMarkers(WORLD_MAP_WALK_PATHS_REGION);

  const dotWords = groupWords(fileText, WORLD_MAP_YOSHI_DOTS_REGION, WORLD_MAP_YOSHI_DOTS_LABEL, DOT_AXIS_WORDS);
  if (dotWords.length !== DOT_AXIS_WORDS * 2) {
    return { ok: false, error: `Yoshi-dot tables have ${dotWords.length} words; expected ${DOT_AXIS_WORDS * 2} (out of date?).` };
  }
  const walkWords = groupWords(fileText, WORLD_MAP_WALK_PATHS_REGION, WORLD_MAP_WALK_PATHS_LABEL, WALK_AXIS_WORDS);
  if (walkWords.length !== WALK_AXIS_WORDS * 2) {
    return { ok: false, error: `Walk-checkpoint tables have ${walkWords.length} words; expected ${WALK_AXIS_WORDS * 2} (out of date?).` };
  }

  const dotChanges = new Map<number, number>();
  const dotErr = collectChanges(dotWords, DOT_AXIS_WORDS, (i) => {
    const axis = i < DOT_AXIS_WORDS ? 'X' : 'Y';
    const j = i % DOT_AXIS_WORDS;
    const w = Math.floor(j / PATH_DOTS_PER_WORLD);
    const d = j % PATH_DOTS_PER_WORLD;
    const p = model.dots[w]?.[d];
    return { v: (axis === 'X' ? p?.x : p?.y) ?? NaN, what: `Yoshi dot ${w + 1}-${d + 1} ${axis}` };
  }, dotChanges);
  if (dotErr) return { ok: false, error: dotErr };

  const walkChanges = new Map<number, number>();
  const walkErr = collectChanges(walkWords, WALK_AXIS_WORDS, (i) => {
    const axis = i < WALK_AXIS_WORDS ? 'X' : 'Y';
    const j = i % WALK_AXIS_WORDS;
    const k = j % PATH_CHECKPOINTS_PER_LEVEL;
    const wl = Math.floor(j / PATH_CHECKPOINTS_PER_LEVEL);
    const w = Math.floor(wl / PATH_LEVELS_PER_WORLD);
    const l = wl % PATH_LEVELS_PER_WORLD;
    const p = model.checkpoints[w]?.[l]?.[k];
    return { v: (axis === 'X' ? p?.x : p?.y) ?? NaN, what: `Checkpoint ${w + 1}-${l + 1} #${k} ${axis}` };
  }, walkChanges);
  if (walkErr) return { ok: false, error: walkErr };

  const edits: TextEdit[] = [
    ...dataWordEdits(dotWords, dotChanges),
    ...dataWordEdits(walkWords, walkChanges)
  ];
  return { ok: true, text: applyEdits(fileText, edits) };
}

// ── Edit-set read/apply (the overlay-migration shape; see overlay-data-editors) ─

/** One edited coordinate word — `table` picks the group, `offset` is the byte
 *  offset from that group's base label (x words first, then y). */
export interface WorldMapPathsEdit {
  table: 'dots' | 'walk';
  offset: number;
  value: number;
}

function tableEdits(
  baseText: string,
  overlayText: string,
  table: WorldMapPathsEdit['table'],
  regionId: string,
  label: string,
  axisWords: number
): WorldMapPathsEdit[] {
  const baseByOff = new Map(groupWords(baseText, regionId, label, axisWords).map((w) => [w.byteOffset, w.value]));
  const out: WorldMapPathsEdit[] = [];
  for (const w of groupWords(overlayText, regionId, label, axisWords)) {
    const bv = baseByOff.get(w.byteOffset);
    if (bv !== undefined && bv !== w.value) out.push({ table, offset: w.byteOffset, value: w.value });
  }
  return out;
}

/** The path-coordinate edits an overlay `Bank17.asm` holds vs base — every table
 *  word whose value differs, matched by byte offset. Works on a marker-less
 *  overlay too (the `findRegionDataWords` label-scan fallback + the group slice). */
export function readWorldMapPathsEdits(baseText: string, overlayText: string | null): WorldMapPathsEdit[] {
  if (overlayText === null) return [];
  return [
    ...tableEdits(baseText, overlayText, 'dots', WORLD_MAP_YOSHI_DOTS_REGION, WORLD_MAP_YOSHI_DOTS_LABEL, DOT_AXIS_WORDS),
    ...tableEdits(baseText, overlayText, 'walk', WORLD_MAP_WALK_PATHS_REGION, WORLD_MAP_WALK_PATHS_LABEL, WALK_AXIS_WORDS)
  ];
}

/** Splice `edits` into the BASE text → edited text (always reborn from base, so
 *  the result = base ⊕ the full edit set). Throws if an offset isn't a word
 *  boundary in its table. */
export function applyWorldMapPathsEdits(baseText: string, edits: readonly WorldMapPathsEdit[]): string {
  if (edits.length === 0) return baseText;
  const dotWords = groupWords(baseText, WORLD_MAP_YOSHI_DOTS_REGION, WORLD_MAP_YOSHI_DOTS_LABEL, DOT_AXIS_WORDS);
  const walkWords = groupWords(baseText, WORLD_MAP_WALK_PATHS_REGION, WORLD_MAP_WALK_PATHS_LABEL, WALK_AXIS_WORDS);
  const dotChanges = new Map<number, number>();
  const walkChanges = new Map<number, number>();
  for (const e of edits) (e.table === 'dots' ? dotChanges : walkChanges).set(e.offset, e.value & 0xffff);
  return applyEdits(baseText, [
    ...dataWordEdits(dotWords, dotChanges),
    ...dataWordEdits(walkWords, walkChanges)
  ]);
}
