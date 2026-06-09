// Standard object $38 — init_lava_rock_large.
//
// Cart entry: CODE_init_stone_large @ $12:9613 (yi/Banks/Bank12.asm:3450).
// Per-cell stamp handler: CODE_stamp_stone_large @ $13:9B15 (yi/Banks/Bank13.asm:3696).
// Stamp-handler data tables:
//   DATA_139A9B / DATA_139AB3 (= YG_IWA_BIG_DT0 / DT1, Bank13.asm:3659-3665):
//     12-entry per-cell Map16 tables, one per mirror variant ($15 picks).
//   DATA_139ACB (Bank13.asm:3667-3671):
//     50-byte adjacency lookup consumed by CODE_lava_rock_large_stamp_detail
//     — maps a neighbour cell's low byte to its smoothed counterpart in the
//     $9D00-$9D31 page.
//   DATA_139AFD (Bank13.asm:3673-3685):
//     12-entry sub-handler dispatch — chooses corner/edge/interior fixup
//     based on (row_class, col_class). Indexed by Y from the same scheme
//     that picks DT0/DT1 entries.
//
// Shape: a 3x4-style "big rock" structure (YGN_IWA_BIG in ys_bgsc1.asm,
// "iwa" = rock). Row/col are classified into 3x4 = 12 buckets:
//   row class: 0 (top), 1 (middle), 2 (bottom = $2C+1 == $2E)
//   col class: 0 (left), 1/2 (middle alternating by ($28 & 1) + 1),
//              3 (right = $28+1 == $2A)
// The base stamp is `table[rowClass*4 + colClass]` from DATA_139A9B
// (variant 0) or DATA_139AB3 (variant 1, selected by `$15 != 0`).
//
// After the base stamp, the cell-position sub-handler walks adjacent
// already-stamped tiles (above/below/left/right) and, if each is in the
// `$9D00-$9DFF` page (i.e. another lava-rock body tile from a previously
// stamped sibling), rewrites its low byte through DATA_139ACB to blend
// the seam. With a clean buffer (which is what the trace spec exercises)
// every CMP `#$9D00` BNE branch is taken and no detail-stamps fire — the
// observable output is exactly the base table read.
//
// Init: rolls PRNG, ANDs with `#$0002`, stores in `$15`. So $15 ends up
// $0000 or $0002 — picks one of the two mirror variants. Trace shows
// $15 = $38 (object ID) on entry, $15 = $02 at walker time (the PRNG
// happened to land on bit 1 = set).
//
// asm primary; cross-checked against the trace.
// No GoldenEgg counterpart for this object (Lava/Rock/case 0x38 searches all empty).

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { prngNext } from '../prng.ts';
import {
  getMap16Above,
  getMap16Below,
  getMap16Left,
  getMap16Right,
} from '../fetch.ts';
import { readBuf16, stampCell, writeBuf16 } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Base tile tables (Bank13.asm:3659-3665).
//
// 12 entries each; Y = (rowClass * 4 + colClass) * 2. Variant 0 lives at
// $9D00-$9D15 (the "natural" lighting big-rock); variant 1 at $9D1C-$9D2D
// (the mirror, flipped highlights).
// ─────────────────────────────────────────────────────────────────────

const DATA_stone_large_dt0 = [
  0x9D00, 0x9D01, 0x9D02, 0x9D03,
  0x9D0A, 0x9D0B, 0x9D0C, 0x9D0D,
  0x9D12, 0x9D13, 0x9D14, 0x9D15,
] as const;

const DATA_stone_large_dt1 = [
  0x9D1C, 0x9D1D, 0x9D1E, 0x9D1F,
  0x9D24, 0x9D25, 0x9D26, 0x9D27,
  0x9D2A, 0x9D2B, 0x9D2C, 0x9D2D,
] as const;

// ─────────────────────────────────────────────────────────────────────
// Adjacency low-byte rewrite table (Bank13.asm:3667-3671).
//
// CODE_lava_rock_large_stamp_detail (Bank13.asm:4158-4164):
//   TAY                             ; A = low byte of neighbour's $9DXX tile
//   LDA DATA_139ACB,y
//   AND #$00FF
//   ORA #$9D00
//   STA.l !LevelDataBuffer,x        ; rewrite neighbour
//
// 50 bytes — indexed by neighbour low byte (0..$31 observed). Maps each
// raw position-tile into its "blended-edge" sibling so that two adjacent
// big-rocks merge cleanly along the touching seam.
// ─────────────────────────────────────────────────────────────────────

const DATA_stone_large_blend = new Uint8Array([
  0x04, 0x05, 0x06, 0x07, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0E, 0x0B, 0x0C, 0x0F, 0x0E, 0x0F,
  0x1A, 0x1B, 0x16, 0x17, 0x18, 0x19, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x1B, 0x20, 0x21, 0x22, 0x23,
  0x20, 0x21, 0x22, 0x23, 0x28, 0x25, 0x26, 0x29, 0x28, 0x29, 0x2E, 0x2F, 0x30, 0x31, 0x2E, 0x2F,
  0x30, 0x31,
]);

const LAVA_ROCK_PAGE = 0x9D00;
const LAVA_ROCK_PAGE_MASK = 0xFF00;

/** Cart CODE_lava_rock_large_stamp_detail (Bank13.asm:4158).
 *
 *  `x` is the buffer offset of the neighbour cell; `lowByte` is the
 *  current Map16 ID's low byte (already verified to be in the
 *  $9D00 page). Rewrites the neighbour cell to
 *  `$9D00 | DATA_stone_large_blend[lowByte]`. */
function stoneLargeStampDetail(
  state: DecodeState,
  off: number,
  lowByte: number,
): void {
  const blended = DATA_stone_large_blend[lowByte & 0xff] ?? 0;
  writeBuf16(state, off, (LAVA_ROCK_PAGE | blended) & 0xffff);
}

/** Set probe coord $0E/$0F to the absolute (xy_lo, xy_hi) word built from
 *  applying the shape's per-corner sub-tile math to `$1B`. Mirrors the
 *  cart's `LDA $1B ; TAX ; AND #$F0F0 ; STA $XX ; TXA ; AND #$0F0F ; DEC
 *  ; AND #$0F0F ; ORA $XX ; STA $0E` patterns; we collapse it into a
 *  helper since 8 sub-handlers reuse the same shape. */
function setProbeFrom1BWithSubXAdjust(
  state: DecodeState,
  /** -1 = DEC sub-X nibble (step left within sub-tile),
   *  +1 = INC sub-X nibble (step right via the `ORA #$00F0 + INC` path),
   *  0 = no sub-X adjust (preserve $1B verbatim). */
  subXDelta: -1 | 0 | 1,
): void {
  const word1B = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  if (subXDelta === 0) {
    // zp0E holds the 16-bit probe coord (fetch primitives read it via
    // 16-bit masks). zp0F mirrors the high byte.
    state.zp0E = word1B;
    state.zp0F = (word1B >>> 8) & 0xff;
    return;
  }
  const screenKeep = word1B & 0xf0f0;
  let subKeep = word1B & 0x0f0f;
  if (subXDelta === -1) {
    // DEC ; AND #$0F0F
    subKeep = (subKeep - 1) & 0x0f0f;
  } else {
    // ORA #$00F0 ; INC ; AND #$0F0F — forces a sub-X overflow into
    // the screen-X nibble on natural wrap.
    subKeep = (((subKeep | 0x00f0) + 1) & 0x0f0f);
  }
  const composed = (screenKeep | subKeep) & 0xffff;
  state.zp0E = composed;
  state.zp0F = (composed >>> 8) & 0xff;
}

/** Helper: probe a neighbour offset, read its 16-bit Map16 ID; return
 *  `null` if it's not in the $9D00 page (so the caller's BNE bail-out
 *  branch fires). Otherwise return `{ off, low }`. */
function probeLavaRockNeighbour(
  state: DecodeState,
  fetchFn: (s: DecodeState) => number,
): { off: number; low: number } | null {
  const off = fetchFn(state);
  const tile = readBuf16(state, off) & 0xffff;
  if ((tile & LAVA_ROCK_PAGE_MASK) !== LAVA_ROCK_PAGE) return null;
  return { off, low: tile & 0xff };
}

// ─────────────────────────────────────────────────────────────────────
// 12 sub-handlers from DATA_139AFD.
//
// Each one verifies up to three neighbours are also lava-rock tiles. If
// every probe matches the `$9D00` page, every involved cell (including
// the just-stamped current cell) gets its low byte rewritten through
// DATA_stone_large_blend to smooth the seam. Any single BNE bail
// aborts the whole pass — partial smoothing isn't done.
//
// CODE_lava_rock_large_interior is a bare RTS (interior cells have no
// neighbour-fixup work).
// ─────────────────────────────────────────────────────────────────────

/** CODE_lava_rock_large_corner_tl ($13:9B62, Bank13.asm:3743).
 *  Probe above, then above-left, then left. If all are $9D-page,
 *  rewrite all three plus the current cell. */
function cornerTopLeft(state: DecodeState): void {
  // First probe: directly above current.
  setProbeFrom1BWithSubXAdjust(state, 0);
  const above = probeLavaRockNeighbour(state, getMap16Above);
  if (!above) return;

  // Second probe: above and one sub-tile left.
  setProbeFrom1BWithSubXAdjust(state, -1);
  const aboveLeft = probeLavaRockNeighbour(state, getMap16Above);
  if (!aboveLeft) return;
  // Cart actually does:
  //   LDA $1B ; STA $0E ; JSL get_above ; STX $04 ; ...probe...
  //   then computes a "left" coord directly, JSL get_above (using the
  //   left-shifted $0E), to grab the diag-above-left neighbour. So the
  //   second probe IS the diag (above-left), exactly as we did.
  // Third probe: the immediate left of current (above-left's
  // get_above re-issuing). The cart calls CODE_probe_left_tile here,
  // which sets $0E := $1B and runs get_map16_left.
  setProbeFrom1BWithSubXAdjust(state, 0);
  const left = probeLavaRockNeighbour(state, getMap16Left);
  if (!left) return;

  // All three matched — stamp_detail on each plus the current cell.
  stoneLargeStampDetail(state, above.off, above.low);
  stoneLargeStampDetail(state, aboveLeft.off, aboveLeft.low);
  stoneLargeStampDetail(state, left.off, left.low);

  // Current cell self-rewrite (cart: LDX $1D ; LDA buffer,x ; AND #$00FF
  // ; JSR stamp_detail).
  const off = state.zp1D & 0xffff;
  const curTile = readBuf16(state, off) & 0xffff;
  if ((curTile & LAVA_ROCK_PAGE_MASK) !== LAVA_ROCK_PAGE) return;
  stoneLargeStampDetail(state, off, curTile & 0xff);
}

/** CODE_lava_rock_large_edge_top ($13:9BE5, Bank13.asm:3798).
 *  Probes three "above"s: above-left-of-current, above-right-of-current,
 *  and directly above. */
function edgeTop(state: DecodeState): void {
  setProbeFrom1BWithSubXAdjust(state, -1);
  if (!probeLavaRockNeighbour(state, getMap16Above)) return;

  setProbeFrom1BWithSubXAdjust(state, +1);
  if (!probeLavaRockNeighbour(state, getMap16Above)) return;

  setProbeFrom1BWithSubXAdjust(state, 0);
  const above = probeLavaRockNeighbour(state, getMap16Above);
  if (!above) return;

  stoneLargeStampDetail(state, above.off, above.low);

  const off = state.zp1D & 0xffff;
  const curTile = readBuf16(state, off) & 0xffff;
  if ((curTile & LAVA_ROCK_PAGE_MASK) !== LAVA_ROCK_PAGE) return;
  stoneLargeStampDetail(state, off, curTile & 0xff);
}

/** CODE_lava_rock_large_corner_tr ($13:9C70, Bank13.asm:3847). */
function cornerTopRight(state: DecodeState): void {
  setProbeFrom1BWithSubXAdjust(state, 0);
  const above = probeLavaRockNeighbour(state, getMap16Above);
  if (!above) return;

  setProbeFrom1BWithSubXAdjust(state, 0);
  const right = probeLavaRockNeighbour(state, getMap16Right);
  if (!right) return;

  setProbeFrom1BWithSubXAdjust(state, +1);
  const aboveRight = probeLavaRockNeighbour(state, getMap16Above);
  if (!aboveRight) return;

  stoneLargeStampDetail(state, above.off, above.low);
  stoneLargeStampDetail(state, right.off, right.low);
  stoneLargeStampDetail(state, aboveRight.off, aboveRight.low);

  const off = state.zp1D & 0xffff;
  const curTile = readBuf16(state, off) & 0xffff;
  if ((curTile & LAVA_ROCK_PAGE_MASK) !== LAVA_ROCK_PAGE) return;
  stoneLargeStampDetail(state, off, curTile & 0xff);
}

/** CODE_lava_rock_large_edge_left ($13:9D11, Bank13.asm:3903). */
function edgeLeft(state: DecodeState): void {
  setProbeFrom1BWithSubXAdjust(state, -1);
  if (!probeLavaRockNeighbour(state, getMap16Above)) return;

  setProbeFrom1BWithSubXAdjust(state, -1);
  const belowLeft = probeLavaRockNeighbour(state, getMap16Below);
  if (!belowLeft) return;
  // Reuse: cart sequence here re-checks the diag-below-left and stores
  // the previous get_below result into the buffer's left probe. We map
  // both "below at left sub-X" probes to a single getMap16Below call;
  // the LDA buffer,x check is repeated separately.

  setProbeFrom1BWithSubXAdjust(state, 0);
  const left = probeLavaRockNeighbour(state, getMap16Left);
  if (!left) return;

  stoneLargeStampDetail(state, left.off, left.low);

  const off = state.zp1D & 0xffff;
  const curTile = readBuf16(state, off) & 0xffff;
  if ((curTile & LAVA_ROCK_PAGE_MASK) !== LAVA_ROCK_PAGE) return;
  stoneLargeStampDetail(state, off, curTile & 0xff);
}

/** CODE_lava_rock_large_interior ($13:9D5C, Bank13.asm:3948). */
const interior: PerCellHandler = (_state) => {
  // No-op: interior cells need no neighbour fixup.
};

/** CODE_lava_rock_large_edge_right ($13:9D5D, Bank13.asm:3951). */
function edgeRight(state: DecodeState): void {
  setProbeFrom1BWithSubXAdjust(state, +1);
  if (!probeLavaRockNeighbour(state, getMap16Above)) return;

  setProbeFrom1BWithSubXAdjust(state, +1);
  const belowRight = probeLavaRockNeighbour(state, getMap16Below);
  if (!belowRight) return;

  setProbeFrom1BWithSubXAdjust(state, 0);
  const right = probeLavaRockNeighbour(state, getMap16Right);
  if (!right) return;

  stoneLargeStampDetail(state, right.off, right.low);

  const off = state.zp1D & 0xffff;
  const curTile = readBuf16(state, off) & 0xffff;
  if ((curTile & LAVA_ROCK_PAGE_MASK) !== LAVA_ROCK_PAGE) return;
  stoneLargeStampDetail(state, off, curTile & 0xff);
}

/** CODE_lava_rock_large_corner_bl ($13:9DD2, Bank13.asm:3998). */
function cornerBottomLeft(state: DecodeState): void {
  setProbeFrom1BWithSubXAdjust(state, 0);
  const below = probeLavaRockNeighbour(state, getMap16Below);
  if (!below) return;

  setProbeFrom1BWithSubXAdjust(state, 0);
  const left = probeLavaRockNeighbour(state, getMap16Left);
  if (!left) return;

  setProbeFrom1BWithSubXAdjust(state, -1);
  const belowLeft = probeLavaRockNeighbour(state, getMap16Below);
  if (!belowLeft) return;

  stoneLargeStampDetail(state, below.off, below.low);
  stoneLargeStampDetail(state, left.off, left.low);
  stoneLargeStampDetail(state, belowLeft.off, belowLeft.low);

  const off = state.zp1D & 0xffff;
  const curTile = readBuf16(state, off) & 0xffff;
  if ((curTile & LAVA_ROCK_PAGE_MASK) !== LAVA_ROCK_PAGE) return;
  stoneLargeStampDetail(state, off, curTile & 0xff);
}

/** CODE_lava_rock_large_edge_bottom ($13:9E5C, Bank13.asm:4053). */
function edgeBottom(state: DecodeState): void {
  setProbeFrom1BWithSubXAdjust(state, -1);
  if (!probeLavaRockNeighbour(state, getMap16Below)) return;

  setProbeFrom1BWithSubXAdjust(state, +1);
  if (!probeLavaRockNeighbour(state, getMap16Below)) return;

  setProbeFrom1BWithSubXAdjust(state, 0);
  const below = probeLavaRockNeighbour(state, getMap16Below);
  if (!below) return;

  stoneLargeStampDetail(state, below.off, below.low);

  const off = state.zp1D & 0xffff;
  const curTile = readBuf16(state, off) & 0xffff;
  if ((curTile & LAVA_ROCK_PAGE_MASK) !== LAVA_ROCK_PAGE) return;
  stoneLargeStampDetail(state, off, curTile & 0xff);
}

/** CODE_lava_rock_large_corner_br ($13:9ED7, Bank13.asm:4102). */
function cornerBottomRight(state: DecodeState): void {
  setProbeFrom1BWithSubXAdjust(state, 0);
  const below = probeLavaRockNeighbour(state, getMap16Below);
  if (!below) return;

  setProbeFrom1BWithSubXAdjust(state, 0);
  const right = probeLavaRockNeighbour(state, getMap16Right);
  if (!right) return;

  setProbeFrom1BWithSubXAdjust(state, +1);
  const belowRight = probeLavaRockNeighbour(state, getMap16Below);
  if (!belowRight) return;

  stoneLargeStampDetail(state, below.off, below.low);
  stoneLargeStampDetail(state, right.off, right.low);
  stoneLargeStampDetail(state, belowRight.off, belowRight.low);

  const off = state.zp1D & 0xffff;
  const curTile = readBuf16(state, off) & 0xffff;
  if ((curTile & LAVA_ROCK_PAGE_MASK) !== LAVA_ROCK_PAGE) return;
  stoneLargeStampDetail(state, off, curTile & 0xff);
}

// ─────────────────────────────────────────────────────────────────────
// 12-entry sub-handler dispatch — mirror of DATA_139AFD (Bank13.asm:3673).
//
// Indexed by Y = (rowClass * 4 + colClass) * 2 — same Y used to pick
// the base tile from DATA_stone_large_dt0/1. The trace builds Y as
// a byte offset (× 2 for word indexing); we keep it as a plain index
// 0..11 here since JS arrays don't need the × 2.
// ─────────────────────────────────────────────────────────────────────

const DATA_stone_large_subhandlers: readonly PerCellHandler[] = [
  cornerTopLeft,    edgeTop,    edgeTop,    cornerTopRight,
  edgeLeft,         interior,   interior,   edgeRight,
  cornerBottomLeft, edgeBottom, edgeBottom, cornerBottomRight,
];

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_stone_large ($13:9B15, Bank13.asm:3696) — per-cell handler.
//
//   REP #$30
//   ; row class:
//   LDA $2C ; BEQ row0          ; $2C == 0 → row class 0
//   INC ; CMP $2E ; BEQ row2    ; $2C+1 == $2E → row class 2
//   LDA #$0001 ; BRA combine    ; else row class 1
//   row0: LDA #$0000            ; (implicit via fall-through)
//   row2: LDA #$0002
//   combine:
//   ASL ASL                     ; row class << 2 (= rowClass * 4)
//   STA $00
//   ; col class:
//   LDA $28 ; BEQ col0          ; $28 == 0 → col class 0
//   INC ; CMP $2A ; BNE colMid  ; $28+1 == $2A → col class 3
//     LDA #$0003 ; BRA combine_col
//   colMid: AND #$0001 ; INC    ; else 1 or 2 (odd/even by $28 bit 0)
//   col0: LDA #$0000             ; (implicit fall-through)
//   combine_col:
//   ORA $00                     ; Y = rowClass*4 + colClass
//   ASL ; TAY                   ; × 2 for word indexing
//   ; pick variant table:
//   LDA $15 ; BNE useDT1
//   LDA DATA_139A9B,y ; BRA stamp
//   useDT1:
//   LDA DATA_139AB3,y
//   stamp:
//   LDX $1D ; STA buffer,x      ; base stamp
//   TYX ; JSR (DATA_139AFD,x)   ; per-position fixup
//   SEP #$30 ; RTL
// ─────────────────────────────────────────────────────────────────────

const stoneLargeStamp: PerCellHandler = (state) => {
  // Row class.
  let rowClass: number;
  const row = state.zp2C & 0xff;
  const rowExt = state.zp2E & 0xff;
  if (row === 0) {
    rowClass = 0;
  } else if (((row + 1) & 0xff) === rowExt) {
    rowClass = 2;
  } else {
    rowClass = 1;
  }

  // Col class.
  let colClass: number;
  const col = state.zp28 & 0xff;
  const colExt = state.zp2A & 0xff;
  if (col === 0) {
    colClass = 0;
  } else if (((col + 1) & 0xff) === colExt) {
    colClass = 3;
  } else {
    colClass = (col & 1) + 1;
  }

  const idx = rowClass * 4 + colClass;
  const variantTable = (state.zp15 & 0xffff) !== 0
    ? DATA_stone_large_dt1
    : DATA_stone_large_dt0;

  // Base stamp.
  stampCell(state, variantTable[idx]!);

  // Per-position fixup. Cart `TYX ; JSR (DATA_139AFD,x)`. The sub-handlers
  // probe neighbours and only do work if they're already $9D-page tiles.
  DATA_stone_large_subhandlers[idx]!(state);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_stone_large ($12:9613, Bank12.asm:3450).
//
//   REP #$20
//   JSL prng                    ; PRNG → A (low byte)
//   AND #$0002                  ; isolate bit 1
//   STA $15                     ; $15 = 0 or 2 (variant select)
//   LDX #(CODE_stamp_stone_large-1)>>16
//   LDA #CODE_stamp_stone_large-1
//   JMP walker_setup_trampoline ; slope=0; 3 handler slots = same fn
//
// Spec confirms the $15 mutation: $38 (object ID on entry) → $02 at
// walker time. PRNG bit 1 was set on the captured trace; with our
// deterministic LFSR this may differ — but only by selecting the OTHER
// mirror table (DT0 vs DT1), which is a purely cosmetic flip.
// ─────────────────────────────────────────────────────────────────────

const initStoneLarge: InitHandler = (state) => {
  // Cart does a 16-bit AND #$0002 on the PRNG return value. prngNext()
  // returns the low byte; bit 1 of that is what cart reads after
  // `JSL prng ; AND #$0002`.
  const variantBit = prngNext(state) & 0x02;
  state.zp15 = variantBit;
  walkerSetupTrampoline(state, stoneLargeStamp);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent wires this into object-decode/index.ts.
// ─────────────────────────────────────────────────────────────────────

export function installStoneLargeHandlers(): void {
  registerStdObjectHandler(0x38, initStoneLarge);
}
