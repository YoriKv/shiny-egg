// Bank13 wall-vertical-pair stamp handlers + Bank12 init wrapper.
//
// Standard objects $AA / $AB — wall_vertical_pair (KABETATE / "vertical
// wall", two mirror orientations). Each object stamps a 2-column-wide
// vertical wall: rows 0..1 are a top "cap" pair, rows ($2E-2)..($2E-1)
// are a bottom "cap" pair, and middle rows are body. Both bodies pick
// a base tile from a 4-entry table keyed on (col-parity, row-parity)
// then route through CODE_remap_tile_to_template so an underlying
// terrain tile in $12 can override into a tileset-correct seam tile.
//
// The two object IDs differ only by orientation bit $15 & $01:
//   $AA → bit clear → CODE_stamp_wall_vleft   (uses DATA_wall_vleft_tiles)
//   $AB → bit set   → CODE_stamp_wall_vright  (uses DATA_wall_vright_tiles)
//
// Asm sources:
//   CODE_init_wall_vertical_pair          Bank12.asm:4800 ($12:9F35)
//   DATA_wall_vertical_body_ptrs          Bank12.asm:4795 (DATA_wall_vertical_body_ptrs)
//   CODE_stamp_wall_vleft                 Bank13.asm:11652 ($13:DF04)
//   DATA_wall_vleft_tiles                 Bank13.asm:11648 (DATA_wall_vleft_tiles)
//   CODE_stamp_wall_vright                Bank13.asm:11692 ($13:DF50)
//   DATA_wall_vright_tiles                Bank13.asm:11688 (DATA_wall_vright_tiles)
//   CODE_remap_tile_to_template           Bank13.asm:11776 ($13:E0F4)
//   DATA_13DF94 / DATA_13DFB4 / DATA_13DFC4
//   DATA_13DFD4 / DATA_13DFE4
//   DATA_13DFF4 / DATA_13E014 / DATA_13E034 / DATA_13E054
//   DATA_13E074 / DATA_13E094 / DATA_13E0B4 / DATA_13E0D4

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Base body-tile tables — DATA_wall_vleft_tiles (vleft) / DATA_wall_vright_tiles (vright).
//
// 4-entry word tables indexed by Y = (($2C & 1) << 2) | (($28 & 1) << 1).
// So entry order is: (col-even,row-even), (col-odd,row-even),
// (col-even,row-odd), (col-odd,row-odd).
// ─────────────────────────────────────────────────────────────────────

const DATA_wall_vleft_tiles: ReadonlyArray<number> = [
  0x790F, 0x7799, 0x791F, 0x779A,
];

const DATA_wall_vright_tiles: ReadonlyArray<number> = [
  0x779F, 0x7910, 0x77A0, 0x7920,
];

// ─────────────────────────────────────────────────────────────────────
// Template-remap tables — CODE_remap_tile_to_template ($13:E0F4).
//
// The remap helper rewrites the proposed Map16 tile (passed as `proposed`)
// to a tileset-correct seam variant whenever:
//   1. The underlying buffer tile $12 is non-zero (something already
//      stamped beneath the wall), AND
//   2. The proposed tile appears in DATA_13DF94 (16-entry "known wall
//      stamp" set — see asm), AND
//   3. $12 appears in the proposed-tile-specific 8-entry "neighbour
//      shape" table picked from DATA_13DFB4.
//
// DATA_13DFB4 holds 8 pointers to "neighbour-match" tables (each 8 words);
// DATA_13DFC4 holds 8 pointers to "remap" tables (each 16 words = 8
// shapes × 2 row brackets). The row-bracket index ($02) is stored by the
// stamp handler before calling the remapper.
//
// Special remap values:
//   $FFFF → no overwrite (keep the proposed tile as-is)
//   $0000 → use $12 (the underlying tile) instead of the proposed tile
//   else  → use that value
// ─────────────────────────────────────────────────────────────────────

/** DATA_13DF94 — 16-entry "known proposed-tile" match set.
 *  Indexed by Y = 30, 28, …, 0 (descending word-step in asm). Idx into the
 *  pointer tables uses `(Y >> 1) & 7` so entries 0..7 and 8..15 share
 *  the same pointer-table index — the two halves carry the same Map16
 *  IDs in left/right family form. */
const DATA_remap_proposed_match: ReadonlyArray<number> = [
  0x7915, 0x7916, 0x7925, 0x7926, 0x790F, 0x791F, 0x7910, 0x7920,
  0x77A9, 0x77AA, 0x77AF, 0x77B0, 0x7799, 0x779A, 0x779F, 0x77A0,
];

/** DATA_13DFD4 — 8-entry neighbour-shape match table (variant A,
 *  used by indices 0/1/4/5 of DATA_13DFB4). */
const DATA_remap_neighbour_set_a: ReadonlyArray<number> = [
  0x790F, 0x791F, 0x7910, 0x7920, 0x7799, 0x779A, 0x779F, 0x77A0,
];

/** DATA_13DFE4 — 8-entry neighbour-shape match table (variant B,
 *  used by indices 2/3/6/7 of DATA_13DFB4). */
const DATA_remap_neighbour_set_b: ReadonlyArray<number> = [
  0x7915, 0x7916, 0x7925, 0x7926, 0x77A9, 0x77AA, 0x77AF, 0x77B0,
];

/** DATA_13DFB4 — 8 entries selecting which neighbour-shape table to use
 *  for each idx (0..7) of the proposed-tile match. */
const DATA_remap_neighbour_set_per_idx: ReadonlyArray<ReadonlyArray<number>> = [
  DATA_remap_neighbour_set_a, DATA_remap_neighbour_set_a,
  DATA_remap_neighbour_set_b, DATA_remap_neighbour_set_b,
  DATA_remap_neighbour_set_a, DATA_remap_neighbour_set_a,
  DATA_remap_neighbour_set_b, DATA_remap_neighbour_set_b,
];

// DATA_13DFF4 / 13E014 / 13E034 / 13E054 / 13E074 / 13E094 / 13E0B4 / 13E0D4
// — 8 remap tables, each 16 words (8 neighbour shapes × 2 row brackets).
// The cart indexes them as `Y = (neighbourIdx & 3) << 3 | $02`, i.e. for
// each of the 4 distinct neighbour-shape pairs ((a,b)/(c,d)/(e,f)/(g,h))
// the row-bracket ($02 ∈ {0,2,4}) picks 1 of 4 slots in an 8-word row.
//
// We mirror the asm encoding faithfully — entries written as `dw $xxx,...`
// in 8-word rows.
const DATA_remap_13DFF4: ReadonlyArray<number> = [
  0x7931, 0x792C, 0x792C, 0x0000, 0x792B, 0x7931, 0x792B, 0x0000,
  0x792E, 0x0000, 0x0000, 0x0000, 0x0000, 0x792D, 0x0000, 0x0000,
];
const DATA_remap_13E014: ReadonlyArray<number> = [
  0x7931, 0x791C, 0x791C, 0x0000, 0x791B, 0x7931, 0x791B, 0x0000,
  0x791E, 0x0000, 0x0000, 0x0000, 0x0000, 0x791D, 0x0000, 0x0000,
];
const DATA_remap_13E034: ReadonlyArray<number> = [
  0x7931, 0x792C, 0x792C, 0x0000, 0x791C, 0x7931, 0x791C, 0x0000,
  0x792E, 0x0000, 0x0000, 0x0000, 0x0000, 0x791E, 0x0000, 0x0000,
];
const DATA_remap_13E054: ReadonlyArray<number> = [
  0x7931, 0x792B, 0x792B, 0x0000, 0x791B, 0x7931, 0x791B, 0x0000,
  0x792D, 0x0000, 0x0000, 0x0000, 0x0000, 0x791D, 0x0000, 0x0000,
];
const DATA_remap_13E074: ReadonlyArray<number> = [
  0x792E, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0x792D, 0xFFFF, 0xFFFF,
  0x5D09, 0x77B9, 0x77B9, 0x0000, 0x77CC, 0x5B0D, 0x77CC, 0x0000,
];
const DATA_remap_13E094: ReadonlyArray<number> = [
  0x791E, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0x791D, 0xFFFF, 0xFFFF,
  0x0A2F, 0x77BB, 0x77BB, 0x0000, 0x77BA, 0x082D, 0x77BA, 0x0000,
];
const DATA_remap_13E0B4: ReadonlyArray<number> = [
  0x792E, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0x791E, 0xFFFF, 0xFFFF,
  0x5D09, 0x77B9, 0x77B9, 0x0000, 0x77BB, 0x0A2F, 0x77BB, 0x0000,
];
const DATA_remap_13E0D4: ReadonlyArray<number> = [
  0x792D, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0x791D, 0xFFFF, 0xFFFF,
  0x5B0D, 0x77CC, 0x77CC, 0x0000, 0x77BA, 0x082D, 0x77BA, 0x0000,
];

/** DATA_13DFC4 — 8 remap tables, one per proposed-tile idx. */
const DATA_remap_table_per_idx: ReadonlyArray<ReadonlyArray<number>> = [
  DATA_remap_13DFF4, DATA_remap_13E014, DATA_remap_13E034, DATA_remap_13E054,
  DATA_remap_13E074, DATA_remap_13E094, DATA_remap_13E0B4, DATA_remap_13E0D4,
];

/** Port of CODE_remap_tile_to_template ($13:E0F4). Given a proposed Map16
 *  tile, the row-bracket index `rowBracket` ($02 in asm: 0/2/4 for
 *  top-cap / bottom-cap / body) and `state.zp12` (the existing
 *  underlying tile), returns the actual tile to stamp.
 *
 *  Returns the proposed tile unchanged when:
 *    - $12 is zero (nothing underneath — no remap needed), OR
 *    - the proposed tile isn't in DATA_13DF94, OR
 *    - $12 isn't in the selected neighbour-match table, OR
 *    - the indexed remap entry is $FFFF.
 *  Returns $12 when the indexed remap entry is $0000.
 *  Otherwise returns the indexed remap entry. */
function remapTileToTemplate(
  state: DecodeState,
  proposed: number,
  rowBracket: number,
): number {
  if ((state.zp12 & 0xffff) === 0) return proposed;
  // Linear search DATA_13DF94 for `proposed`. Asm scans descending from
  // Y=$1E so a tie picks the LOWER-index entry — for our forward search
  // this is the first match.
  const matchIdx = DATA_remap_proposed_match.indexOf(proposed);
  if (matchIdx < 0) return proposed;
  // Asm: TYA / LSR / AND #$000E / TAY — collapses Y to a byte offset
  // into an 8-entry word table (drops the upper duplicate-half bit).
  const idx = matchIdx & 7;

  const neighbourSet = DATA_remap_neighbour_set_per_idx[idx]!;
  const neighbourIdx = neighbourSet.indexOf(state.zp12 & 0xffff);
  if (neighbourIdx < 0) return proposed;

  // Asm: TYA / AND #$000C / ASL / ORA $02 — neighbour Y stays as byte
  // offset, masked to bits 2-3, shifted left → row stride of 8; OR with
  // $02 (already a byte word-offset 0/2/4). For our typed-array index
  // we want a WORD index 0..15: (neighbourIdx & 6) << 1 | (rowBracket >> 1).
  const remapTable = DATA_remap_table_per_idx[idx]!;
  const wordIdx = ((neighbourIdx & 0x6) << 1) | ((rowBracket >>> 1) & 0x3);
  const entry = remapTable[wordIdx]!;
  if (entry === 0xFFFF) return proposed;
  if (entry === 0x0000) return state.zp12 & 0xffff;
  return entry;
}

// ─────────────────────────────────────────────────────────────────────
// Shared cell-stamp body — CODE_stamp_wall_vleft / vright share the
// same prologue + epilogue, differing only in the base-tile table.
//
// Prologue: compute the row-bracket index `$02`:
//   $2C < 2                 → 0 (top cap)
//   $2E - ($2C + 1) < 2     → 2 (bottom cap)
//   else                    → 4 (body)
//
// Body: build a (col-parity, row-parity) index Y into the 4-entry base
// table, fetch the proposed tile, run remap, stamp result at $1D.
// ─────────────────────────────────────────────────────────────────────

function stampVerticalWallCell(
  state: DecodeState,
  baseTable: ReadonlyArray<number>,
): void {
  // Row-bracket (asm Y → $02): 0 top, 2 bottom, 4 body.
  let rowBracket: number;
  const row = state.zp2C & 0xff;
  if (row < 2) {
    rowBracket = 0;
  } else {
    const rowsFromEnd = (state.zp2E - (row + 1)) & 0xffff;
    rowBracket = rowsFromEnd < 2 ? 2 : 4;
  }

  // Base-tile pick: Y = (($2C & 1) << 2) | (($28 & 1) << 1) → 0/2/4/6.
  const colParity = (state.zp28 & 1) << 1;
  const rowParity = (state.zp2C & 1) << 2;
  const yByte = (rowParity | colParity) & 0xff;
  const baseTile = baseTable[yByte >>> 1]!;

  const finalTile = remapTileToTemplate(state, baseTile, rowBracket);
  stampCell(state, finalTile);
}

const stampWallVLeft: PerCellHandler = (state) => {
  stampVerticalWallCell(state, DATA_wall_vleft_tiles);
};

const stampWallVRight: PerCellHandler = (state) => {
  stampVerticalWallCell(state, DATA_wall_vright_tiles);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_wall_vertical_pair ($12:9F35).
//
//   LDA #$0002         → $2A = 2 (force 2-column width)
//   STA $2A
//   LDA $15            → orient byte
//   AND #$0001 ASL TAY → Y = ($15 & 1) << 1 (word offset into ptr table)
//   LDX #(...)>>16     → bank byte = $13
//   LDA DATA_wall_vertical_body_ptrs,y  → low word = vleft-1 or vright-1
//   JMP walker_setup_trampoline
//
// $15 bit 0 picks vleft ($AA) vs vright ($AB). The cart's pointer-table
// indirection is collapsed here into a direct PerCellHandler reference.
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0xAA, 0xAB share this handler.
const initWallVerticalPair: InitHandler = (state) => {
  state.zp2A = 0x0002;
  const handler =
    (state.zp15 & 0x01) === 0 ? stampWallVLeft : stampWallVRight;
  walkerSetupTrampoline(state, handler);
};

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installWallVerticalPairHandlers(): void {
  registerStdObjectHandler(0xAA, initWallVerticalPair);
  registerStdObjectHandler(0xAB, initWallVerticalPair);
}
