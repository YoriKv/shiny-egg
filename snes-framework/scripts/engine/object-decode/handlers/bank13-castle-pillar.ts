// Bank12 init wrapper + Bank13 per-cell stamp handlers for castle
// pillars ($42 / $43).
//
// Standard objects $42 + $43 — `castle_pillar` ("KABENABLOCK"): castle
// pillars that render as diagonal-wall blocks.
//   $42 (CastlePillarTwoBlock) → $15 bit 0 = 0 → up-rising diagonal (CODE_stamp_castle_pillar_up)
//   $43 (CastlePillar)         → $15 bit 0 = 1 → down-falling diagonal (CODE_stamp_castle_pillar_down)
//
// Both stamps share a single epilogue (`CODE_castle_pillar_stamp_and_overlay`)
// that:
//   1. writes the chosen diagonal Map16 ID into the buffer
//   2. checks the *under-tile* ($12) against a grass-page sentinel range
//      ($0032, $0084..$008E exclusive of $008E) — on match, overlays a
//      grass-shadow tile from DATA_castle_pillar_grass_overlay keyed by (stamped - $00B6).
//   3. fixes the right/below/below-right neighbours by calling the same
//      four neighbour-probe routines used by CODE_init_wall_h_block (object
//      $41) — see bank13-wall-h-block.ts for the narrow/wide remap tables.
//   4. For the down-falling variant, the right probe additionally rolls a
//      random-grass tile via CODE_wall_h_block_right_probe_random on
//      non-top rows.
//
// Asm sources:
//   CODE_init_castle_pillar                  Bank12.asm:3548  ($12:96AE)
//   DATA_castle_pillar_handlers Bank12.asm:3543
//   CODE_stamp_castle_pillar_up                    Bank13.asm:4759  ($13:A372)
//   CODE_stamp_castle_pillar_down                  Bank13.asm:4797  ($13:A3AF)
//   CODE_castle_pillar_stamp_and_overlay           Bank13.asm:4816  ($13:A3CE)
//   DATA_castle_pillar_up_tiles      Bank13.asm:4755
//   DATA_castle_pillar_down_tiles    Bank13.asm:4789
//   DATA_castle_pillar_grass_overlay Bank13.asm:4793
//   CODE_wall_h_block_right_probe              Bank13.asm:4612  ($13:A20A)
//   CODE_wall_h_block_below_probe              Bank13.asm:4587  ($13:A1D3)
//   CODE_wall_h_block_below_right_probe        Bank13.asm:4725  ($13:A333)
//   CODE_wall_h_block_right_probe_random       Bank13.asm:4674  ($13:A2D1)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { getMap16Below, getMap16Right } from '../fetch.ts';
import { readBuf16, setProbeToBelowRight, setProbeToCurrent, stampCell, writeBuf16 } from './_shared.ts';
import { wallHRightProbeRandom } from './bank13-wall-h-block.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_castle_pillar_up_tiles. 5-entry table for the
// up-rising variant, indexed two different ways:
//
//   * "top-of-rectangle" rows (row-from-bottom $2E-$2C < 4):
//       Y = ($2E - $2C) * 2     → reads entries 0..3
//   * "body" rows (row-from-bottom >= 4):
//       Y = ($2C & 1) * 2 + $02 → reads entries 1, 2 (B8, BA) alternating
//
// First and last entries duplicate $00B6 to terminate the rise pattern
// at the rectangle's top-left.
// ─────────────────────────────────────────────────────────────────────

const DATA_castle_pillar_up_tiles: ReadonlyArray<number> = [
  0x00B6, 0x00B8, 0x00BA, 0x00B9, 0x00B6,
];

// ─────────────────────────────────────────────────────────────────────
// DATA_castle_pillar_down_tiles. 3-entry table for the
// down-falling variant, indexed by row position:
//
//   row 0 (top)                        → entry 0  = $00B6
//   intermediate rows                  → entry 1  = $00B7
//   row $2C+1 == $2E (bottom)          → entry 2  = $00B8
// ─────────────────────────────────────────────────────────────────────

const DATA_castle_pillar_down_tiles: ReadonlyArray<number> = [0x00B6, 0x00B7, 0x00B8];

// ─────────────────────────────────────────────────────────────────────
// DATA_castle_pillar_grass_overlay. 5-entry table of
// $77xx grass-shadow overlay tiles. Indexed by (stamped - $00B6) << 1:
//
//   stamped $00B6 → $7794
//   stamped $00B7 → $7795
//   stamped $00B8 → $7796
//   stamped $00B9 → $7794
//   stamped $00BA → $7794
//
// Applied by the shared epilogue when the *under-tile* ($12) matches
// $0032 OR sits in [$0084, $008E) — i.e. the "grass surface" sentinel
// range. Mis-indexed reads (stamped outside $00B6..$00BA) would walk
// past the table; the only stamps produced are exactly those 5 values
// so the indexing is always in range.
// ─────────────────────────────────────────────────────────────────────

const DATA_castle_pillar_grass_overlay: ReadonlyArray<number> = [
  0x7794, 0x7795, 0x7796, 0x7794, 0x7794,
];

// ─────────────────────────────────────────────────────────────────────
// Shared "below-probe" match column. Identical to DATA_13A1AF in
// CODE_init_wall_h_block (object $41); see bank13-wall-h-block.ts.
// 9 Map16 IDs scanned in the cell below / right / below-right.
// ─────────────────────────────────────────────────────────────────────

const DATA_wall_h_below_match: ReadonlyArray<number> = [
  0x00C2, 0x00C3, 0x00C4, 0x00C5, 0x00C6, 0x00C7, 0x150D, 0x150E, 0x00D1,
];

// Narrow below remap (DATA_13A1C1).
const DATA_wall_h_below_remap: ReadonlyArray<number> = [
  0x00C3, 0x00C3, 0x00D5, 0x00D5, 0x00C6, 0x00C6, 0x151B, 0x151B, 0x00C3,
];

// Right-neighbour remap (DATA_13A1F8).
const DATA_wall_h_right_remap: ReadonlyArray<number> = [
  0x00C4, 0x00D5, 0x00C4, 0x00C5, 0x00D5, 0x00C5, 0x151B, 0x151B, 0x00C4,
];

// Below-right neighbour remap (DATA_13A321).
const DATA_wall_h_below_right_remap: ReadonlyArray<number> = [
  0x00C7, 0x00C6, 0x00C5, 0x00C5, 0x00C6, 0x00C7, 0x151B, 0x151B, 0x00C7,
];

// ─────────────────────────────────────────────────────────────────────
// Probe helpers (mirror of bank13-wall-h-block.ts internal helpers,
// duplicated here so the diag stamps can reuse them without exporting
// implementation details from that module). See "Consolidation
// candidates" note in the report.
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
function wallHBelowProbe(state: DecodeState): void {
  setProbeToCurrent(state);
  const off = getMap16Below(state);
  probeAndRemap(state, off, DATA_wall_h_below_match, DATA_wall_h_below_remap);
}

/** Cart CODE_wall_h_block_right_probe ($13:A20A). */
function wallHRightProbe(state: DecodeState): void {
  setProbeToCurrent(state);
  const off = getMap16Right(state);
  probeAndRemap(state, off, DATA_wall_h_below_match, DATA_wall_h_right_remap);
}

/** Cart CODE_wall_h_block_below_right_probe ($13:A333). */
function wallHBelowRightProbe(state: DecodeState): void {
  // Step one cell right (subX+1, carry within the page) preserving the
  // screen-page byte, then read the cell below. Coord math lives in
  // setProbeToBelowRight (_shared.ts) — the single asm routine
  // CODE_wall_h_block_below_right_probe ($13:A333) is shared by the
  // $41/$42/$48 wall stamps, so this keeps the copies from drifting.
  setProbeToBelowRight(state);
  const off = getMap16Below(state);
  probeAndRemap(state, off, DATA_wall_h_below_match, DATA_wall_h_below_right_remap);
}

// ─────────────────────────────────────────────────────────────────────
// Shared stamp epilogue — CODE_castle_pillar_stamp_and_overlay ($13:A3CE).
//
// 1. stamp the picked diagonal tile into the buffer.
// 2. if under-tile ($12) is in the grass sentinel set ($0032, or
//    $0084..$008D inclusive), overlay DATA_castle_pillar_grass_overlay
//    indexed by (stamped - $00B6).
// 3. neighbour-fix the right/below/below-right cells:
//      row 0  → wallHRightProbe (regular).
//      row >0 → wallHRightProbeRandom; on the bottom row, also
//                 wallHBelowProbe + wallHBelowRightProbe.
// ─────────────────────────────────────────────────────────────────────

function castlePillarStampAndOverlay(state: DecodeState, stamped: number): void {
  stampCell(state, stamped);

  const underTile = state.zp12 & 0xffff;
  const isGrass =
    underTile === 0x0032 ||
    (underTile >= 0x0084 && underTile < 0x008E);
  if (isGrass) {
    const idx = (stamped - 0x00B6) & 0xffff;
    stampCell(state, DATA_castle_pillar_grass_overlay[idx]!);
  }

  const rowCounter = state.zp2C & 0xff;
  if (rowCounter === 0) {
    wallHRightProbe(state);
    return;
  }
  wallHRightProbeRandom(state);
  // Bottom-of-rectangle test: $2C+1 == $2E.
  if (((rowCounter + 1) & 0xff) === (state.zp2E & 0xff)) {
    wallHBelowProbe(state);
    wallHBelowRightProbe(state);
  }
}

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_castle_pillar_up ($13:A372).
//
// Early-exit if the existing cell's high byte == $7E (skip-sentinel,
// shared across Bank13 stamp handlers). Otherwise:
//
//   rowsFromBottom = $2E - $2C
//   if rowsFromBottom < 4 (the rectangle's top 4 rows):
//     pick = DATA_castle_pillar_up_tiles[(($2C & 1) << 1) >> 1] = [0] or [1]
//     (asm: AND #$0001 / ASL / TAY then LDA DATA_castle_pillar_up_tiles,y)
//   else (body):
//     pick = DATA_castle_pillar_up_tiles[rowsFromBottom * 2 / 2 + 1]
//
// Wait — re-read the asm:
//
//   LDA $2E ; SEC ; SBC $2C ; CMP #$0004
//   BCC CODE_13A394          ; rowsFromBottom < 4 → body branch
//   LDA $2C ; AND #$0001 ; ASL ; TAY
//   LDA DATA_castle_pillar_up_tiles,y         ; entries 0 or 2 ($00B6 or $00BA)
//   BRA CODE_13A399
//
//   CODE_13A394:               ; rowsFromBottom < 4 (top of rectangle)
//   ASL ; TAY                  ; (A holds rowsFromBottom; ASL → *2)
//   LDA DATA_castle_pillar_up_tiles+$02,y      ; entries 1..4 ($00B8, $00BA, $00B9, $00B6)
//
// So the BODY branch (rowsFromBottom >= 4) alternates $00B6/$00BA by
// $2C parity (matches trace: cells 0-12 alternate $00B6/$00B8 — wait,
// trace shows $00B8 not $00BA). Let me re-check.
//
// Looking at the trace for $42 cell 1 (row=1, rowsFromBottom = $10-$01
// = $0F >= 4 → body branch):
//   col=$00 row=$0001 → "indexed by Y=$0002 → entry at $13A36A = $00B8"
//
// $13A36A = DATA_castle_pillar_up_tiles + 2 = entry 1 = $00B8 ✓
// So body branch picks from DATA_castle_pillar_up_tiles[(($2C & 1) << 1) ... wait, ASL
// on A=0 → A=0 → Y=0 → entry 0 = $00B6. ASL on A=1 → A=2 → Y=2 → entry
// 1 = $00B8. ✓
//
// And the top branch (rowsFromBottom < 4): the trace for cell 14
// (row=$0E, rowsFromBottom = $10-$0E = $02 → top branch):
//   indexed → entry $00B9
// $00B9 is DATA_castle_pillar_up_tiles[3], and Y from CODE_13A394 = rowsFromBottom * 2
// = $04, then LDA DATA_castle_pillar_up_tiles+$02,y = entry at offset $02+$04 = $06 =
// word index 3 = $00B9 ✓.
//
// And cell 15 (row=$0F, rowsFromBottom=$01 → top branch):
//   stamps $00BA — DATA_castle_pillar_up_tiles[2]. Y = 1*2 = $02, then +$02 = $04 =
//   word index 2 = $00BA ✓.
// ─────────────────────────────────────────────────────────────────────

const stampCastlePillarUp: PerCellHandler = (state) => {
  // Early exit if existing tile is in the "skip" $7Exx sentinel range.
  if ((state.zp12 & 0xff00) === 0x7e00) return;

  const rowExt = state.zp2E & 0xff;
  const rowCounter = state.zp2C & 0xff;
  const rowsFromBottom = (rowExt - rowCounter) & 0xff;

  let stamped: number;
  if (rowsFromBottom >= 4) {
    // Body: alternate $00B6 / $00B8 by $2C parity.
    const idx = (rowCounter & 0x01);
    stamped = DATA_castle_pillar_up_tiles[idx]!;
  } else {
    // Top-of-rectangle: indexed by rowsFromBottom (1..3) into entries 2..4.
    // Asm: LDA holds rowsFromBottom ; ASL ; TAY ; LDA DATA_castle_pillar_up_tiles+2,Y.
    // Net: DATA_castle_pillar_up_tiles[1 + rowsFromBottom].
    stamped = DATA_castle_pillar_up_tiles[1 + rowsFromBottom]!;
  }

  castlePillarStampAndOverlay(state, stamped);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_castle_pillar_down ($13:A3AF).
//
// Early-exit on the $7Exx skip sentinel. Otherwise:
//   Y = 0
//   if $2C == 0 (top row):                    pick = DATA_castle_pillar_down_tiles[0] = $00B6
//   else if $2C+1 == $2E (bottom row):        pick = DATA_castle_pillar_down_tiles[2] = $00B8
//   else (intermediate row):                  pick = DATA_castle_pillar_down_tiles[1] = $00B7
//
// Then falls through into CODE_castle_pillar_stamp_and_overlay.
// ─────────────────────────────────────────────────────────────────────

const stampCastlePillarDown: PerCellHandler = (state) => {
  if ((state.zp12 & 0xff00) === 0x7e00) return;

  const rowCounter = state.zp2C & 0xff;
  const rowExt = state.zp2E & 0xff;

  let idx = 0;
  if (rowCounter !== 0) {
    if (((rowCounter + 1) & 0xff) === rowExt) {
      idx = 2;
    } else {
      idx = 1;
    }
  }
  const stamped = DATA_castle_pillar_down_tiles[idx]!;
  castlePillarStampAndOverlay(state, stamped);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_castle_pillar ($12:96AE).
//
//   REP #$20
//   LDA $15 ; AND #$0001 ; ASL ; TAY
//   LDX #(CODE_stamp_castle_pillar_up-1)>>16
//   LDA DATA_castle_pillar_handlers,y    ; → CODE_stamp_castle_pillar_up-1 or CODE_stamp_castle_pillar_down-1
//   JMP walker_setup_trampoline
//
// Both per-cell handlers live in bank $13, so the bank slot is the
// same regardless of orientation — only the handler ptr differs.
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x42, 0x43 share this handler.
function initCastlePillar(state: DecodeState): void {
  const handler: PerCellHandler =
    (state.zp15 & 0x01) === 0 ? stampCastlePillarUp : stampCastlePillarDown;
  walkerSetupTrampoline(state, handler);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installCastlePillarHandlers(): void {
  registerStdObjectHandler(0x42, initCastlePillar);
  registerStdObjectHandler(0x43, initCastlePillar);
}
