// Standard object $E3 — IceFloorEdgeHole.
//
// Cart entries:
//   CODE_init_ice_floor_edge_hole   @ $12:A214 (yi/Banks/Bank12.asm:5259)
//   CODE_stamp_ice_floor_edge_hole  @ $13:F511 (yi/Banks/Bank13.asm:14251)
//   DATA_ice_floor_edge_hole_tiles  @ $13:F50B (yi/Banks/Bank13.asm:14247)
//
// Icy floor edges with a hole between them: a 3-row × N-column structure
// where the left + right columns of the rectangle hold the visible floor-
// edge tiles (top / middle / body), and every interior column is cleared
// to $0000 (the hole). So a 16×16 walker extent renders as two side
// edges with empty space (the hole) between them.
//
// Per-cell logic (`CODE_stamp_ice_floor_edge_hole`, Bank13.asm:14251):
//
//   row_clamped = min($2C, 2)        ; only 3 distinct row "groups"
//   y = row_clamped * 2              ; word-offset into the 3-entry table
//                                    ;   row 0  → DATA[0] = $8C00 (top)
//                                    ;   row 1  → DATA[1] = $8C04 (middle)
//                                    ;   row ≥2 → DATA[2] = $8C08 (body)
//
//   if $28 == 0          ; first column (left edge)
//     tile = DATA[y] + 3      ; → $8C03 / $8C07 / $8C0B
//   else if $28+1 == $2A ; last column (right edge)
//     tile = DATA[y] + 0      ; → $8C00 / $8C04 / $8C08
//   else                 ; interior column (the hole between the edges)
//     tile = $0000
//
//   stamp tile @ $1D
//
//   if row == 0          ; only on the top row of each column,
//     probe above; stamp $0000 over the neighbour cell  ← "decorator
//                                                         overwrite":
//                                                         clears any
//                                                         ceiling/wall
//                                                         directly above
//                                                         the top row of
//                                                         each edge.
//
// The captured trace exercises a 16×16 extent
// (col 0..15, row 0..15): col 0 stamps $8C03 / $8C07 / $8C0B; col 15
// stamps $8C00 / $8C04 / $8C08; cols 1..14 stamp $0000. Every row-0 cell
// also overwrites the cell above with $0000.
//
// Init handler is a bare trampoline — DP-diff table all "no".

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { getMap16Above } from '../fetch.ts';
import { setProbeToCurrent, stampCell, writeBuf16 } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_ice_floor_edge_hole_tiles (Bank13.asm:14247).
// 3-entry word table of right-column base tiles. The left column adds
// +3 to each entry; the right column uses the base directly.
//
//   y = 0  →  $8C00  (top row)
//   y = 2  →  $8C04  (middle row, 2nd row from top)
//   y = 4  →  $8C08  (body — every row from index 2 down)
// ─────────────────────────────────────────────────────────────────────
const DATA_ice_floor_edge_hole_tiles = [0x8C00, 0x8C04, 0x8C08] as const;

// Side-column offsets added to the table entry.
const EDGE_LEFT_COL_OFFSET  = 3; // first col   (col == 0)
const EDGE_RIGHT_COL_OFFSET = 0; // last col    (col+1 == colExtent)
const HOLE_INTERIOR_TILE    = 0x0000; // every column between the two edges

// Decorator overwrite: tile written into the cell directly above any
// row-0 stamp. The asm hard-codes a 16-bit immediate $0000 (not a
// template-slot dereference), so it's a literal zero regardless of
// tileset.
const EDGE_TOP_DECORATOR_OVERWRITE = 0x0000;

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_ice_floor_edge_hole ($13:F511, Bank13.asm:14251).
// ─────────────────────────────────────────────────────────────────────
const stampIceFloorEdgeHole: PerCellHandler = (state) => {
  // row_clamped = min($2C, 2). Asm: LDA $2C ; CMP #$0002 ; BCC keep ; LDA #2.
  const rowRaw = state.zp2C & 0xffff;
  const rowClamped = rowRaw < 2 ? rowRaw : 2;
  const yIdx = rowClamped; // word-index (asm: ASL ; TAY → byte-offset Y=row*2)

  const col    = state.zp28 & 0xff;
  const colExt = state.zp2A & 0xff;

  let tile: number;
  if (col === 0) {
    // First column → left edge. tile = DATA[y] + 3.
    tile = (DATA_ice_floor_edge_hole_tiles[yIdx]! + EDGE_LEFT_COL_OFFSET) & 0xffff;
  } else if (((col + 1) & 0xff) === colExt) {
    // Last column → right edge. tile = DATA[y] + 0.
    tile = (DATA_ice_floor_edge_hole_tiles[yIdx]! + EDGE_RIGHT_COL_OFFSET) & 0xffff;
  } else {
    // Interior column → empty (the hole).
    tile = HOLE_INTERIOR_TILE;
  }
  stampCell(state, tile);

  // Row-0 decorator overwrite: probe above and stamp $0000 over the
  // neighbour. Asm: LDA $2C ; BNE skip ; LDA $1B ; STA $0E ;
  //                 JSL get_map16_above ; LDA #$0000 ; STA buffer,x.
  if ((rowRaw & 0xff) === 0) {
    setProbeToCurrent(state);
    const aboveOff = getMap16Above(state);
    writeBuf16(state, aboveOff, EDGE_TOP_DECORATOR_OVERWRITE);
  }
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_ice_floor_edge_hole ($12:A214, Bank12.asm:5259).
//
//   REP.b #$20
//   LDX.b #(CODE_stamp_ice_floor_edge_hole-$01)>>16
//   LDA.w #CODE_stamp_ice_floor_edge_hole-$01
//   JMP.w CODE_walker_setup_trampoline
//
// Bare trampoline — no DP mutations (spec DP-diff table all "no"). The
// caller pre-sets dimensions via the stream record.
// ─────────────────────────────────────────────────────────────────────
function initIceFloorEdgeHole(state: DecodeState): void {
  walkerSetupTrampoline(state, stampIceFloorEdgeHole);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent wires this into object-decode/index.ts.
// ─────────────────────────────────────────────────────────────────────
export function installIceFloorEdgeHoleHandlers(): void {
  registerStdObjectHandler(0xE3, initIceFloorEdgeHole);
}
