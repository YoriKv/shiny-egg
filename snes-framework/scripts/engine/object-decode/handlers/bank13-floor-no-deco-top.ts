// Bank13 floor-without-top-decoration stamp handler + Bank12 init wrapper.
//
// Shared init for standard objects $87 AND $88 — a floor without top
// decoration, with floor-aware caps. $87 is the base variant; $88 is the
// more-uniform variant. Both IDs route to CODE_init_floor_no_deco_top; the
// only run-time difference is the orientation byte ($15 = $87 vs $88),
// which selects between two halves of the body-tile PRNG pool (bit 3).
//
// Walker wiring is dual-handler (NOT a plain trampoline):
//   - even-col / odd-col → CODE_stamp_floor_no_deco_top  (the row 0..1 stamper)
//   - row handler        → CODE_bg_floor_random    (random-grass fill)
//   - $19 = 2            (row-dispatch threshold: rows 0..1 = top,
//                         rows 2+ fall through to bg_floor_random)
//   - slope ($17) = 0
//
// So a $88 (height-1 > 1) object draws the top rows on top of 2 rows then
// a tail of floor-random body — matches the std-88 spec: rows 0-1 stamp
// $014E/$014F (PRNG-picked), rows 2+ stamp $390E/.. (bg_floor_random).
//
// Per-cell stamp (CODE_stamp_floor_no_deco_top, CODE_stamp_floor_no_deco_top, Bank13.asm:9669):
//   At col=0 or col=last AND existing cell is FloorRow0_L/R or
//   FlatFloor_Row1_L/R → "cap" path: pick from DATA_floor_no_deco_top_cap_tiles.
//     row=0: first 2 entries are TEMPLATE-SLOT POINTERS (deref via the
//            second indexed read `LDA $0000,y`).
//     row>0: last 2 entries are LITERAL Map16 IDs ($0145, $0150).
//   At col=0 or col=last, existing cell is NOT a floor template:
//     row=0: stamp $0000 (clear) if existing is FloorRow0_L/R, else
//            return without stamping. (Asm BNE skips the cap stamp.)
//     row>0: PRNG body path.
//   At interior columns:
//     row=0: nothing stamped unless current cell is FloorRow0_L/R,
//            in which case stamp $0000. (Doesn't happen in practice —
//            $87 row 0 cells are typically empty.)
//   (Asm symbol DATA_ledge_no_grass_random_tiles retains its legacy
//    label; it backs the body-tile PRNG pool for this floor object.)
//     row>0: PRNG body. Cart: Y = ($15 & 8) | ((prng & 3)<<1) is a BYTE
//            offset into the word table; tile = word at byte Y (entry Y>>1).
//            $87 (bit 3 = 0) → entries 0-3 → tiles $0146,$0147,$0148,$0149.
//            $88 (bit 3 = 8) → entries 4-7 → tiles $014E,$014F,$014E,$014F.
//
// Asm sources:
//   CODE_init_floor_no_deco_top            Bank12.asm:4432   ($12:9CB3)
//   CODE_stamp_floor_no_deco_top           Bank13.asm:9669   ($13:D25E)
//   DATA_ledge_no_grass_random_tiles    Bank13.asm:9661   ($13:D246)
//   DATA_floor_no_deco_top_cap_tiles       Bank13.asm:9665   ($13:D256)
//
// Friendly names: !Define_YI_StdObj87_LedgeNoGrass (ObjectIDs.asm:172),
// and $88 shares the init (no separate friendly name; orientation byte
// distinguishes the two variants at stamp time).
//
// No GoldenEgg counterpart — case 0x87 / 0x88 searches all empty in the
// loaded "ge" solution.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerRun } from '../walker.ts';
import { TT } from '../template-slots.ts';
import { prngNext, RNG_SITE } from '../prng.ts';
import { stampCell } from './_shared.ts';
import { bgFloorRandom } from './bank13-floor.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_ledge_no_grass_random_tiles (DATA_floor_no_deco_top_random_tiles, Bank13.asm:9661)
//
// 8-entry word table. The cell-stamp indexes it with
// `(prng & 3) << 1 | ($15 & 8)`. The $15 bit-3 mix carves the 8 entries
// into two 4-entry halves selected by which std ID dispatched the init.
// ─────────────────────────────────────────────────────────────────────

const DATA_ledge_no_grass_random_tiles = [
  0x0146, 0x0147, 0x0148, 0x0149, // low half — picked when $15 bit 3 = 0 (std $87)
  0x014E, 0x014F, 0x014E, 0x014F, // high half — picked when $15 bit 3 = 1 (std $88)
] as const;

// ─────────────────────────────────────────────────────────────────────
// DATA_floor_no_deco_top_cap_tiles (Bank13.asm:9665)
//
// 4-entry word table. First two entries are TEMPLATE-SLOT POINTERS
// (the cart loads the entry, compares Y<4, then re-loads via
// `LDA $0000,y` to dereference). Last two entries are LITERAL Map16
// IDs (cart's `CPY #$0004 ; BCS` skips the dereference).
//
//   y=0: col=0,   row=0 → templateAt($1D14)
//   y=2: col=end, row=0 → templateAt($1D12)
//   y=4: col=0,   row>0 → literal $0145
//   y=6: col=end, row>0 → literal $0150
// ─────────────────────────────────────────────────────────────────────

const FLOOR_NO_DECO_TOP_CAP_SLOT_COL0_ROW0   = 0x001D14;
const FLOOR_NO_DECO_TOP_CAP_SLOT_COLEND_ROW0 = 0x001D12;
const FLOOR_NO_DECO_TOP_CAP_LITERAL_COL0_ROW1   = 0x0145;
const FLOOR_NO_DECO_TOP_CAP_LITERAL_COLEND_ROW1 = 0x0150;

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_floor_no_deco_top (Bank13.asm:9669) — per-cell stamp
// for rows 0..1 of objects $87 / $88.
// ─────────────────────────────────────────────────────────────────────

const floorNoDecoTopStamp: PerCellHandler = (state) => {
  // Y = 0 at col=0; Y = 2 at col=last; otherwise falls through to body.
  const col = state.zp28 & 0xff;
  const colExtent = state.zp2A & 0xff;
  let y: number;
  let atCapColumn: boolean;
  if (col === 0) {
    y = 0;
    atCapColumn = true;
  } else if (((col + 1) & 0xff) === colExtent) {
    y = 2;
    atCapColumn = true;
  } else {
    y = 0;
    atCapColumn = false;
  }

  if (atCapColumn) {
    // Cap-column branch ($13:D26E): check existing cell against the four
    // floor template tiles. If it matches → cap path; else → body path.
    const cur = state.zp12 & 0xffff;
    const floorL = state.templateAt(TT.FloorRow0_LeftLo);
    const floorR = state.templateAt(TT.FloorRow0_RightLo);
    const row1L  = state.templateAt(TT.FlatFloor_Row1LeftLo);
    const row1R  = state.templateAt(TT.FlatFloor_Row1RightLo);
    if (cur === floorL || cur === floorR || cur === row1L || cur === row1R) {
      // Floor-anchored cap. Asm $13:D284: if row > 0, Y |= 4.
      if ((state.zp2C & 0xff) !== 0) {
        y = y | 0x0004;
      }
      // For y < 4: table entry is a template-slot pointer → deref.
      // For y >= 4: table entry is a literal Map16 ID.
      let tile: number;
      if (y === 0) {
        tile = state.templateAt(FLOOR_NO_DECO_TOP_CAP_SLOT_COL0_ROW0);
      } else if (y === 2) {
        tile = state.templateAt(FLOOR_NO_DECO_TOP_CAP_SLOT_COLEND_ROW0);
      } else if (y === 4) {
        tile = FLOOR_NO_DECO_TOP_CAP_LITERAL_COL0_ROW1;
      } else {
        tile = FLOOR_NO_DECO_TOP_CAP_LITERAL_COLEND_ROW1;
      }
      stampCell(state, tile);
      return;
    }
    // Cap-column but no floor anchor under us — fall through to body path.
  }

  // Body path ($13:D29B).
  if ((state.zp2C & 0xff) === 0) {
    // Row 0, no PRNG: if existing cell is FloorRow0_L/R, stamp $0000
    // (clear it so the top row can sit above the floor cleanly).
    // Otherwise return WITHOUT stamping anything (preserves whatever
    // is already at that cell).
    const cur = state.zp12 & 0xffff;
    const floorL = state.templateAt(TT.FloorRow0_LeftLo);
    const floorR = state.templateAt(TT.FloorRow0_RightLo);
    if (cur === floorL || cur === floorR) {
      stampCell(state, 0x0000);
    }
    return;
  }

  // Row > 0: PRNG-picked body tile. The cart computes a BYTE offset into the
  // word table DATA_floor_no_deco_top_random_tiles — `Y = ($15 & 8) | ((prng & 3) << 1)` then
  // `LDA DATA_floor_no_deco_top_random_tiles,y`. $15 bit 3 selects the table half:
  //   $87 (bit3=0) → byte offsets 0,2,4,6 = entries 0-3 {$0146,$0147,$0148,$0149}
  //   $88 (bit3=8) → byte offsets 8,A,C,E = entries 4-7 {$014E,$014F,$014E,$014F}
  // Index the JS *word* array by the entry number = byteOffset >> 1. Indexing
  // by the raw byte offset read OOB for $88 (idx 8-14 into an 8-entry array) →
  // undefined → an unstamped cell: that was the "$88 top rows missing" bug.
  const prngBits = (prngNext(state, RNG_SITE.floorNoDecoTopBody) & 0x03) << 1;
  const orientBit = state.zp15 & 0x08;
  const byteOffset = orientBit | prngBits;
  stampCell(state, DATA_ledge_no_grass_random_tiles[byteOffset >> 1]!);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_floor_no_deco_top ($12:9CB3, Bank12.asm:4432).
//
// Plain walker wire-up: even/odd col → floorNoDecoTopStamp, row →
// bgFloorRandom. $19 = 2 (row dispatch threshold), $17 = 0 (no slope).
// Does NOT mutate xy_lo/xy_hi/$2A/$2E/$15 — all walker inputs come
// straight from the stream record (matches both std-87 + std-88 spec
// "no change" diff tables).
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x87, 0x88 share this handler.
const initFloorNoDecoTop: InitHandler = (state) => {
  state.zp17 = 0;
  walkerRun(
    state,
    /*oddCol=*/  floorNoDecoTopStamp,
    /*evenCol=*/ floorNoDecoTopStamp,
    /*row=*/     bgFloorRandom,
    /*rowsEnd=*/ 2,
  );
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent (object-decode/index.ts) wires this in.
// ─────────────────────────────────────────────────────────────────────

export function installFloorNoDecoTopHandlers(): void {
  registerStdObjectHandler(0x87, initFloorNoDecoTop);
  registerStdObjectHandler(0x88, initFloorNoDecoTop);
}
