// Builds the level instance index that backs the editor's debug
// object/sprite finder (`src/main/ipc/debug.ts` → `debug:findInstances` →
// the ObjectFinder panel). Replaces the hand-committed
// `docs/level-{object,sprite}-index.tsv` files (whose generators were
// deleted): this regenerates from the freshly-extracted level data at
// extract time, so it's never stale and ships inside the editor-data tree
// (the docs/ TSVs weren't bundled in packaged builds, so the finder was
// silently empty there).
//
// SCHEMA is consumer-shaped — the finder's only query is
// `(kind, id) → list of (level, position)`, so the file is keyed exactly
// that way and carries nothing the finder doesn't read:
//
//   instance-index.json = {
//     std:    { "<idHex>": [ [recordId, x, y, offset], … ], … },
//     ext:    { "<idHex>": [ … ], … },
//     sprite: { "<idHex>": [ … ], … },
//   }
//
//   idHex   : "0x" + uppercase hex of the std/ext-object or 9-bit sprite id
//             (project convention: hex-string keys on disc — never decimal,
//             which JSON.stringify would reorder; see CLAUDE.md).
//   tuple   : [recordId, x, y, offset] — all plain numbers (decimal on disc).
//   recordId: data-record level id (what loadLevel / navigation use).
//   x, y    : cell coords (16px units), as the level loader decodes them.
//   offset  : objects → FILE-relative byte offset (10-byte header + Σ prior
//             record lengths); sprites → stream-relative (index × 3). Matches
//             the old TSV `offset` / `recordOffset` semantics — used by the
//             finder for display + stable ordering.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadLevel, loadLevelMapPublic } from './level.ts';
import type { LevelData } from './types.ts';

const HEADER_BYTES = 10;        // bit-packed scene header precedes the object stream
const SPRITE_RECORD_BYTES = 3;  // each sprite record is 3 bytes

type Instance = [recordId: number, x: number, y: number, offset: number];
type Bucket = Record<string, Instance[]>;

export interface InstanceIndex {
  std: Bucket;
  ext: Bucket;
  sprite: Bucket;
}

/** Canonical id key — `'0x' + UPPER(hex)`, unpadded. Generator + reader
 *  (debug.ts) must agree; both derive it from the numeric id. */
export function instanceIndexKey(id: number): string {
  return '0x' + id.toString(16).toUpperCase();
}

/** Index one decoded level's objects + sprites into `index`. Shared by the
 *  full extract-time build and the debug finder's overlay splice (which
 *  re-decodes only the levels a project has edited). Does NOT sort — callers
 *  sort once when done. */
function indexLevelInto(index: InstanceIndex, level: LevelData, recordId: number): void {
  // Objects, in stream order. File-relative byte offset accumulates from the
  // header end across each record's raw bytes (3/4/5 bytes per object).
  let offset = HEADER_BYTES;
  for (const o of level.objects) {
    if (o.num === 0 && o.exnum != null) {
      (index.ext[instanceIndexKey(o.exnum)] ??= []).push([recordId, o.x, o.y, offset]);
    } else {
      (index.std[instanceIndexKey(o.num)] ??= []).push([recordId, o.x, o.y, offset]);
    }
    offset += o.raw.length;
  }
  // Sprites — fixed 3-byte records, so offset is just the stream index × 3.
  for (const s of level.sprites) {
    (index.sprite[instanceIndexKey(s.num)] ??= []).push([recordId, s.x, s.y, s.index * SPRITE_RECORD_BYTES]);
  }
}

/** Stable order within each id list (level, then offset) — the finder serves
 *  the list as-is, so sort once after building. */
function sortIndex(index: InstanceIndex): void {
  for (const bucket of [index.std, index.ext, index.sprite]) {
    for (const list of Object.values(bucket)) {
      list.sort((a, b) => a[0] - b[0] || a[3] - b[3]);
    }
  }
}

/**
 * Index a specific set of records, optionally through a project overlay (an
 * overlay `.bin` shadows the base via `resolveLevelBinPath`). Backs the debug
 * finder's Approach-A overlay splice: re-index just the levels a project has
 * edited (~6 ms/level), so saved edits are reflected without regenerating the
 * whole base index. Returns an UNSORTED partial index — the finder merges it
 * with the base and sorts the result.
 */
export function buildInstanceIndexForRecords(
  workRoot: string,
  overlayRoot: string | undefined,
  recordIds: Iterable<number>
): InstanceIndex {
  const index: InstanceIndex = { std: {}, ext: {}, sprite: {} };
  for (const recordId of recordIds) {
    let level: LevelData;
    try {
      level = loadLevel({ workRoot, levelRecordId: recordId, overlayRoot });
    } catch {
      continue; // unreadable / malformed slot — skip
    }
    if (level.empty || level.special) continue;
    indexLevelInto(index, level, recordId);
  }
  return index;
}

/**
 * Decode every backed level and index its objects + sprites by id. Reads the
 * extracted `.bin` files via `loadLevel` (so `level-map.json` must already be
 * on disk + its loader cache fresh — extract handles both before calling this).
 */
export function buildInstanceIndex(workRoot: string): InstanceIndex {
  const map = loadLevelMapPublic(workRoot);
  const index: InstanceIndex = { std: {}, ext: {}, sprite: {} };

  for (const hexId of Object.keys(map.levels)) {
    const entry = map.levels[hexId];
    if (!entry || entry.objectFile == null) continue;
    const recordId = parseInt(hexId, 16);

    let level: LevelData;
    try {
      level = loadLevel({ workRoot, levelRecordId: recordId });
    } catch {
      continue; // unreadable / malformed slot — skip
    }
    if (level.empty || level.special) continue;
    indexLevelInto(index, level, recordId);
  }

  sortIndex(index);
  return index;
}

/** Path of the index file within an editor-data tree. */
export function instanceIndexPath(workRoot: string): string {
  return path.join(workRoot, 'editor-data', 'yi', 'instance-index.json');
}

/**
 * Build + write `editor-data/yi/instance-index.json`. Called from `extract.ts`
 * after `level-map.json` is written. Returns the total instance count.
 */
export function writeInstanceIndex(workRoot: string): number {
  const index = buildInstanceIndex(workRoot);
  fs.writeFileSync(instanceIndexPath(workRoot), JSON.stringify(index));
  let count = 0;
  for (const bucket of [index.std, index.ext, index.sprite]) {
    for (const list of Object.values(bucket)) count += list.length;
  }
  return count;
}

// Standalone regen / smoke test against the already-extracted data:
//   node snes-framework/scripts/instance-index.ts
// (defaults workRoot to snes-framework/). Handy without a full re-extract.
if (import.meta.url === `file://${process.argv[1]}`) {
  const workRoot = process.argv[2] ?? path.resolve(import.meta.dirname, '..');
  const count = writeInstanceIndex(workRoot);
  console.log(`wrote ${instanceIndexPath(workRoot)} — ${count} instances`);
}
