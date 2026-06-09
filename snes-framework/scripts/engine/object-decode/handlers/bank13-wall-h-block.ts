// Bank13 horizontal-wall-block stamp handler + Bank12 init wrapper.
//
// Standard object $41 — wall_h_block ("KABEHBLOCK" / kabe horizontal
// block). Stamps a single horizontal strip of wall tiles, picking
// left-cap / interior / right-cap Map16 IDs from a 3-entry edge table.
// Adjacent cells below (and, on the right cap, also right + below-right)
// get remapped through three small lookup tables so the cart's shadow
// overlays merge cleanly with whatever terrain was already stamped
// underneath.
//
// Asm sources:
//   CODE_init_wall_h_block            Bank12.asm:3537  ($12:96A0)
//   CODE_wall_h_block                 Bank13.asm:4528  ($13:A156)
//   CODE_wall_h_block_below_probe     Bank13.asm:4587  ($13:A1D3)
//   CODE_wall_h_block_right_probe     Bank13.asm:4612  ($13:A20A)
//   CODE_wall_h_block_below_probe_wide
//                                     Bank13.asm:4644  ($13:A272)
//   CODE_wall_h_block_below_right_probe
//                                     Bank13.asm:4725  ($13:A333)
//   DATA_13A152 / DATA_13A1A9 / DATA_13A1AF / DATA_13A1C1
//   DATA_13A1F8 / DATA_13A226 / DATA_13A24C / DATA_13A321

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { getMap16Below, getMap16Right } from '../fetch.ts';
import { prngNext } from '../prng.ts';
import { readBuf16, setProbeToBelowRight, setProbeToCurrent, stampCell, writeBuf16 } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Edge tile picker — DATA_13A1A9 (Bank13.asm:4576).
//
//   Y = 0 (leftmost col)   → $0153
//   Y = 2 (interior col)   → $0154
//   Y = 4 (rightmost col)  → $0155
// ─────────────────────────────────────────────────────────────────────

const DATA_wall_h_edge_tiles: ReadonlyArray<number> = [0x0153, 0x0154, 0x0155];

// ─────────────────────────────────────────────────────────────────────
// "Narrow" below-probe match + remap tables.
//
// DATA_13A1AF — 9 Map16 IDs the cart looks for in the cell below the
//   current one (CPY #$0012 = 9 words, Bank13.asm:4579).
// DATA_13A1C1 — replacement Map16 IDs at the matching Y (Bank13.asm:4583).
// DATA_13A1F8 — right-neighbour remap (CODE_wall_h_block_right_probe).
// DATA_13A321 — below-right neighbour remap (CODE_wall_h_block_below_right_probe).
//
// All three remap tables are 9 words each and share the DATA_13A1AF
// match column.
// ─────────────────────────────────────────────────────────────────────

const DATA_wall_h_below_match: ReadonlyArray<number> = [
  0x00C2, 0x00C3, 0x00C4, 0x00C5, 0x00C6, 0x00C7, 0x150D, 0x150E, 0x00D1,
];
const DATA_wall_h_below_remap: ReadonlyArray<number> = [
  0x00C3, 0x00C3, 0x00D5, 0x00D5, 0x00C6, 0x00C6, 0x151B, 0x151B, 0x00C3,
];
const DATA_wall_h_right_remap: ReadonlyArray<number> = [
  0x00C4, 0x00D5, 0x00C4, 0x00C5, 0x00D5, 0x00C5, 0x151B, 0x151B, 0x00C4,
];
const DATA_wall_h_below_right_remap: ReadonlyArray<number> = [
  0x00C7, 0x00C6, 0x00C5, 0x00C5, 0x00C6, 0x00C7, 0x151B, 0x151B, 0x00C7,
];

// ─────────────────────────────────────────────────────────────────────
// "Wide" below-probe tables (interior columns of multi-cell walls).
//
// DATA_13A226 — 19-entry match column (CPY #$0026 = 19 words, Bank13.asm:4630).
// DATA_13A24C — 19-entry remap column (Bank13.asm:4635). The last entry
//   is encoded as `dw ... $151A,$151A : db $C6` immediately followed by
//   `DATA_13A271: db $00`, so the trailing word reads as $00C6.
// ─────────────────────────────────────────────────────────────────────

const DATA_wall_h_below_wide_match: ReadonlyArray<number> = [
  0x00BE, 0x00BF, 0x00C0, 0x00C1, 0x00C2, 0x00C3, 0x00C4, 0x00C5,
  0x00C6, 0x00C7, 0x00C9, 0x00CA, 0x00CB, 0x00CC, 0x00D6, 0x00D7,
  0x150D, 0x150E, 0x00D1,
];
const DATA_wall_h_below_wide_remap: ReadonlyArray<number> = [
  0x77DE, 0x77DF, 0x77E0, 0x77E1, 0x00C6, 0x00C6, 0x00D5, 0x00D5,
  0x00C6, 0x00C6, 0x77DA, 0x77DB, 0x77DC, 0x77DD, 0x77D8, 0x77D9,
  0x151A, 0x151A, 0x00C6,
];

// ─────────────────────────────────────────────────────────────────────
// Probe helpers.
//
// Each helper mirrors one of the cart's neighbour-fix routines:
//   1. compute the neighbour buffer offset
//   2. read the existing Map16 ID
//   3. linear-search a match table (asm: CMP+BEQ loop)
//   4. on hit, overwrite the neighbour with the matching remap entry
//
// Match miss is a no-op (cart falls through past the STA).
// ─────────────────────────────────────────────────────────────────────

function probeAndRemap(
  state: DecodeState,
  off: number,
  matchTable: ReadonlyArray<number>,
  remapTable: ReadonlyArray<number>,
): void {
  const cur = readBuf16(state, off);
  const idx = matchTable.indexOf(cur);
  if (idx < 0) return;
  writeBuf16(state, off, remapTable[idx]!);
}

/** Cart CODE_wall_h_block_below_probe ($13:A1D3). */
export function wallHBelowProbe(state: DecodeState): void {
  setProbeToCurrent(state);
  const off = getMap16Below(state);
  probeAndRemap(state, off, DATA_wall_h_below_match, DATA_wall_h_below_remap);
}

/** Cart CODE_wall_h_block_right_probe ($13:A20A). The asm calls
 *  CODE_probe_right_tile which inlines $0E ← $1B then get_map16_right
 *  and a buffer read; we do the same and reuse the loaded value. */
export function wallHRightProbe(state: DecodeState): void {
  setProbeToCurrent(state);
  const off = getMap16Right(state);
  probeAndRemap(state, off, DATA_wall_h_below_match, DATA_wall_h_right_remap);
}

/** Cart CODE_wall_h_block_below_probe_wide ($13:A272). Same neighbour
 *  offset as wallHBelowProbe but a wider match/remap table covers more
 *  terrain variants for interior wall cells. */
export function wallHBelowProbeWide(state: DecodeState): void {
  setProbeToCurrent(state);
  const off = getMap16Below(state);
  probeAndRemap(state, off, DATA_wall_h_below_wide_match, DATA_wall_h_below_wide_remap);
}

/** Cart CODE_wall_h_block_below_right_probe ($13:A333). Points the probe
 *  at the cell one column to the right (subX += 1, wrap inside the page)
 *  then calls get_map16_below. The +1 column step + page-preserving coord
 *  math is shared via setProbeToBelowRight (_shared.ts) — the asm has a
 *  single routine here, called by the $41/$42/$48 wall stamps. */
export function wallHBelowRightProbe(state: DecodeState): void {
  setProbeToBelowRight(state);
  const off = getMap16Below(state);
  probeAndRemap(state, off, DATA_wall_h_below_match, DATA_wall_h_below_right_remap);
}

// ─────────────────────────────────────────────────────────────────────
// Random right-probe tables (DATA_13A226 / 13A2AB / 13A297).
//
// CODE_wall_h_block_right_probe_random ($13:A2D1) probes the right
// neighbour against a 19-entry "wide" match column (DATA_13A226) and on
// hit writes the corresponding entry from a RANDOM remap variant
// (DATA_13A2AB) — the regular wide-remap (DATA_13A24C) is used by
// CODE_wall_h_block_below_probe_wide; here the random variant produces
// different overlay choices.
//
// If the first loop misses (y reaches $26), a SECOND loop reads
// `DATA_13A271,y` for y in [$26, $3A). Since DATA_13A271 sits one byte
// past the end of DATA_13A24C, `DATA_13A271 + $26 == DATA_13A297`, and
// the asm effectively scans `DATA_13A297` for indexes 0..6 (7 word
// entries, the grass-page Map16 IDs $0084..$008A). On match:
//   - if Y < $30 (== match was in DATA_13A297[0..4] / $0084..$0088)
//     AND $2C == 1, roll prng for a random replacement; otherwise
//     stamp the literal $0031.
//
// Pre-second-loop: if the probed tile equals $002E, write $002F and
// return.
// ─────────────────────────────────────────────────────────────────────

const DATA_wall_h_random_right_match: ReadonlyArray<number> = [
  0x00BE, 0x00BF, 0x00C0, 0x00C1, 0x00C2, 0x00C3, 0x00C4, 0x00C5,
  0x00C6, 0x00C7, 0x00C9, 0x00CA, 0x00CB, 0x00CC, 0x00D6, 0x00D7,
  0x150D, 0x150E, 0x00D1,
];

const DATA_wall_h_random_right_remap: ReadonlyArray<number> = [
  0x77E7, 0x77E9, 0x77E8, 0x77E6, 0x00C5, 0x00D5, 0x00C5, 0x00C5,
  0x00D5, 0x00C6, 0x77E5, 0x77E3, 0x77E2, 0x77E4, 0x77D8, 0x77D9,
  0x151B, 0x151B, 0x00C5,
];

// Secondary match: cart treats these as 10-entry grass-page IDs but
// only the first 5 (Y/2 = 0..4) can hit because the CPY #$0030 gate
// rejects matches at Y=$30+ (= entries 5..9).
const DATA_wall_h_random_grass_match: ReadonlyArray<number> = [
  0x0084, 0x0085, 0x0086, 0x0087, 0x0088, 0x0089, 0x008A, 0x008B,
  0x008C, 0x008D,
];

// PRNG-pool used when $2C == 1 and the grass match hit: prng & 6 → Y,
// then `DATA_13A297[Y>>1]` → stamp. Only entries 0..3 are actually
// reachable (mask is 0x06).
const DATA_wall_h_random_grass_pool: ReadonlyArray<number> = [
  0x0084, 0x0085, 0x0086, 0x0087,
];

/** Cart CODE_wall_h_block_right_probe_random ($13:A2D1).
 *  Right-neighbour probe with a wider match column + a random-grass
 *  branch on the secondary match table. Shared across wall stamps — called
 *  by the $42/$43 castle_pillar down stamp (CODE_stamp_castle_pillar_down) on
 *  non-top rows, and by the $48 brick stamp. */
export function wallHRightProbeRandom(state: DecodeState): void {
  setProbeToCurrent(state);
  const off = getMap16Right(state);
  const cur = readBuf16(state, off);

  const wideIdx = DATA_wall_h_random_right_match.indexOf(cur);
  if (wideIdx >= 0) {
    writeBuf16(state, off, DATA_wall_h_random_right_remap[wideIdx]!);
    return;
  }

  // First-loop miss: hard-coded $002E → $002F early-out.
  if (cur === 0x002E) {
    writeBuf16(state, off, 0x002F);
    return;
  }

  // Secondary loop scans DATA_13A297 (the asm uses `DATA_13A271,y` with
  // y starting at $26 — equivalent to DATA_13A297[0..]). Only Y < $30
  // (== first 5 entries → $0084..$0088) is considered a hit.
  let grassIdx = -1;
  for (let i = 0; i < 5; i++) {
    if (DATA_wall_h_random_grass_match[i] === cur) {
      grassIdx = i;
      break;
    }
  }
  if (grassIdx < 0) return; // no match → no write

  if ((state.zp2C & 0xff) !== 0x01) {
    writeBuf16(state, off, 0x0031);
    return;
  }
  // $2C == 1 → roll prng & 6, pick from DATA_13A297[(prng&6)>>1].
  const pick = (prngNext(state) & 0x06) >>> 1;
  writeBuf16(state, off, DATA_wall_h_random_grass_pool[pick]!);
}

// ─────────────────────────────────────────────────────────────────────
// CODE_wall_h_block ($13:A156).
//
// 1×1 special case ($2A == 1 && $2E == 1): stamp $0156 + run the narrow
// below-probe + right-probe + below-right-probe trio.
//
// Multi-cell case: pick edge tile from DATA_13A1A9 by column position:
//   - leftmost  ($28 == 0)              → $0153 + narrow below-probe
//   - rightmost ($28 + 1 == $2A)        → $0155 + right + wide + below-right
//   - interior  (everything else)       → $0154 + wide below-probe
// ─────────────────────────────────────────────────────────────────────

const wallHBlockStamp: PerCellHandler = (state) => {
  const colExt = state.zp2A & 0xff;
  const rowExt = state.zp2E & 0xff;
  const col = state.zp28 & 0xff;

  // 1×1 degenerate case — asm: LDA $2A ORA $2E DEC BNE multi.
  if (((colExt | rowExt) - 1) === 0) {
    stampCell(state, 0x0156);
    wallHBelowProbe(state);
    wallHRightProbe(state);
    wallHBelowRightProbe(state);
    return;
  }

  let edgeIdx: number;
  let isRightmost = false;
  if (col === 0) {
    edgeIdx = 0;
  } else if (((col + 1) & 0xff) === colExt) {
    edgeIdx = 2;
    isRightmost = true;
  } else {
    edgeIdx = 1;
  }
  stampCell(state, DATA_wall_h_edge_tiles[edgeIdx]!);

  if (col === 0) {
    wallHBelowProbe(state);
  } else if (isRightmost) {
    wallHRightProbe(state);
    wallHBelowProbeWide(state);
    wallHBelowRightProbe(state);
  } else {
    wallHBelowProbeWide(state);
  }
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_wall_h_block ($12:96A0).
//
//   LDX #(CODE_wall_h_block-1)>>16
//   LDA #CODE_wall_h_block-1
//   JMP walker_setup_trampoline
//
// Plain trampoline init — same per-cell handler in every walker slot.
// ─────────────────────────────────────────────────────────────────────

function initWallHBlock(state: DecodeState): void {
  walkerSetupTrampoline(state, wallHBlockStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installWallHBlockHandlers(): void {
  registerStdObjectHandler(0x41, initWallHBlock);
}
