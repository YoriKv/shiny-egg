// Bank13 3-cell-tall waterfall stamp handler + Bank12 init wrapper.
//
// Covers standard object $ED — `init_stone_3d_wall` (Bank12.asm:5392).
// The init derives orientation $15 from parity of two $1B bits (so the
// visible variant flips depending on map-grid placement) and then
// dispatches into `CODE_stamp_stone_3d_wall` (Bank13.asm:14920).
//
//   - col extent / row extent inherit straight from the stream record;
//     test scenario is $0004 × $0010 = 4-wide × 16-tall column.
//   - orientation $15: init computes `($1B & 1) XOR (($1B>>4) & 1)`.
//     For the test pos (xy_lo=$68) that's `0 XOR 0 = $00` (spec confirms).
//   - all 3 walker handler slots → CODE_stamp_stone_3d_wall.
//   - 64 cells stamped — every cell goes through one of the 3 cap
//     sub-handlers (left / middle / right) picked by $28's relation to
//     $2A, then on row 0 the result is remapped from the $79E8/$79E9
//     "stream interior" pair to the $3D09/$3D0A/$3D0B "spout" tiles.
//
// Asm reference — CODE_init_stone_3d_wall (Bank12.asm:5392):
//
//   REP #$20
//   LDA $1B
//   AND #$0001
//   STA $00                                       ; bit-0 of $1B
//   LDA $1B
//   LSR : LSR : LSR : LSR
//   AND #$0001                                    ; bit-4 of $1B
//   EOR $00
//   STA $15                                       ; orientation = XOR of those
//   LDX #(CODE_stamp_stone_3d_wall-1)>>16
//   LDA #CODE_stamp_stone_3d_wall-1
//   JMP CODE_walker_setup_trampoline
//
// Asm reference — CODE_stamp_stone_3d_wall (Bank13.asm:14920):
//
//   REP #$30
//   LDA $2C
//   EOR #$FFFF : INC                              ; A = -$2C (mod 16-bit)
//   CMP #$0005 : BCC +
//   LDA #$0004                                    ; clamp to 4
// + AND #$0006
//   TAY
//   LDA DATA_waterfall_rowgroups,y                ; row-group base offset
//   STA $00
//   CMP #$0006 : BCS skip_prng
//   LDA $2C : AND #$0001 : BEQ skip_prng
//   JSL CODE_prng : AND #$0002 : BEQ skip_prng
//   INC $00 : INC $00 : INC $00                   ; PRNG promote group 0→3
// skip_prng:
//   LDA $2C : EOR $28 : EOR $15
//   AND #$0001
//   ASL
//   TAY                                           ; Y = parity-of-$2C^$28^$15 << 1
//   LDX #$0000
//   LDA $28
//   BEQ jsr                                       ; col 0 → left cap (X=0)
//   INX : INX
//   INC : CMP $2A : BNE jsr                       ; col != last → middle (X=2)
//   INX : INX                                     ; last col → right cap (X=4)
// jsr:
//   JSR (DATA_waterfall_subhandlers,x)
//   LDY $2C : BNE done                            ; non-row-0 → write A as-is
//   LDA $02                                       ; row-0 patch: remap $79E8/9
//   SEC : SBC #$79E8                              ;   into the $3D09 spout
//   CLC : ADC #$3D09                              ;   page using the cap tile
// done:
//   LDX $1D
//   STA.l !RAM_YI_Level_LevelDataBuffer,x
//   SEP #$30
//   RTL
//
// The cap sub-handlers all converge on `CODE_waterfall_left_cap` which
// writes `$02 = capTile`, `A = capTile + $00`. For left cap $00 holds the
// row-group offset (0 or 6); for middle/right caps the left-neighbour
// probe rewrites $00 with `(probe - $79E9)`, achieving an additive blend
// against the alternating $79EA fill.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { prngNext, RNG_SITE } from '../prng.ts';
import { getMap16Left } from '../fetch.ts';
import { stampCell, readBuf16, setProbeToCurrent, signed8 } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Cap-tile + row-group constants (Bank13.asm:14910-14979).
// ─────────────────────────────────────────────────────────────────────

/** `DATA_waterfall_rowgroups` at $13:FB07 (Bank13.asm:14916).
 *  Indexed by Y ∈ {0,2,4} → row-group offset added onto cap tile.
 *  Entry 0 (top row) leaves cap unshifted; entry 4 shifts +6 into the
 *  "interior stream" tile range. Entry 2 is reachable only through the
 *  PRNG-promote branch (effectively dead for current cart usage). */
const DATA_waterfall_rowgroups = [0x0000, 0x0003, 0x0006] as const;

/** `DATA_waterfall_left_cap_tiles` at $13:FB76 (Bank13.asm:14977).
 *  Indexed by Y ∈ {0,2} → cap-tile parity choice for the leftmost
 *  column. Y is the `(($2C ^ $28 ^ $15) & 1) << 1` parity selector. */
const DATA_waterfall_left_cap_tiles = [0x79E9, 0x79E8] as const;

/** Middle-column base tile (Bank13.asm:14988 — `LDA #$79E9`). */
const WATERFALL_MIDDLE_CAP_BASE = 0x79E9;

/** Right-column base tile (Bank13.asm:14993 — `LDA #$79E8`). */
const WATERFALL_RIGHT_CAP_BASE = 0x79E8;

/** Probe-blend pivot tile (Bank13.asm:14999/15001). The asm subtracts
 *  this from the probed left-neighbour, then loads $79EA as the new
 *  base; net effect is "stamp $79EA + (probe - $79E9)". */
const WATERFALL_BLEND_PIVOT = 0x79E9;
const WATERFALL_BLEND_BASE  = 0x79EA;

/** Row-0 patch endpoints (Bank13.asm:14968-14970). Top-row cells get
 *  their cap remapped from the $79E8/$79E9/$79EA "stream interior" page
 *  into the $3D09/$3D0A/$3D0B "spout cap" page. */
const ROW0_PATCH_SOURCE = 0x79E8;
const ROW0_PATCH_TARGET = 0x3D09;

// ─────────────────────────────────────────────────────────────────────
// CODE_probe_left_tile ($13:FD54). Sets $0E to $1B (16-bit), runs
// CODE_get_map16_left, returns the buffer word at that offset. Local
// copy because it's only consumed by the cap-blend path here.
// ─────────────────────────────────────────────────────────────────────

function probeLeftTile(state: DecodeState): number {
  setProbeToCurrent(state);
  const off = getMap16Left(state);
  return readBuf16(state, off);
}

// ─────────────────────────────────────────────────────────────────────
// Cap sub-handlers — analogues of the `DATA_waterfall_subhandlers`
// dispatch table. Each returns the pair `[$02 (capTile latch),
// A (capTile + $00)]` used by the row-0 patch and final stamp.
// `rowGroupOffset` is the `$00` value computed by the caller (either
// the row-group entry or, after a middle/right probe, the blend delta).
// ─────────────────────────────────────────────────────────────────────

/** CODE_waterfall_left_cap ($13:FB7A) → CODE_waterfall_left_cap.
 *  Cap tile = DATA_waterfall_left_cap_tiles[parity]; A = cap + rowGroup. */
function waterfallLeftCap(parityY: number, rowGroup: number): { cap: number; sum: number } {
  const cap = DATA_waterfall_left_cap_tiles[parityY >>> 1]!;
  return { cap, sum: (cap + rowGroup) & 0xffff };
}

/** CODE_waterfall_middle_cap ($13:FB7F) → CODE_waterfall_left_probe.
 *  Cap base = $79E9. If parityY == 0 → no probe, sum = $79E9 + rowGroup.
 *  Else probe left-neighbour: delta = (probe - $79E9), cap = $79EA,
 *  sum = $79EA + delta. Note that the cap latched into $02 differs
 *  between the two paths — row-0 patch reads $02, so this matters. */
function waterfallMiddleCap(
  state: DecodeState,
  parityY: number,
  rowGroup: number
): { cap: number; sum: number } {
  if (parityY === 0) {
    const cap = WATERFALL_MIDDLE_CAP_BASE;
    return { cap, sum: (cap + rowGroup) & 0xffff };
  }
  const probe = probeLeftTile(state) & 0xffff;
  const delta = (probe - WATERFALL_BLEND_PIVOT) & 0xffff;
  const cap = WATERFALL_BLEND_BASE;
  return { cap, sum: (cap + delta) & 0xffff };
}

/** CODE_waterfall_right_cap ($13:FB84) → CODE_waterfall_left_probe.
 *  Same probe path as middle, but the no-probe branch uses $79E8 instead
 *  of $79E9. */
function waterfallRightCap(
  state: DecodeState,
  parityY: number,
  rowGroup: number
): { cap: number; sum: number } {
  if (parityY === 0) {
    const cap = WATERFALL_RIGHT_CAP_BASE;
    return { cap, sum: (cap + rowGroup) & 0xffff };
  }
  const probe = probeLeftTile(state) & 0xffff;
  const delta = (probe - WATERFALL_BLEND_PIVOT) & 0xffff;
  const cap = WATERFALL_BLEND_BASE;
  return { cap, sum: (cap + delta) & 0xffff };
}

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_stone_3d_wall — the actual per-cell handler ($13:FB0D).
// ─────────────────────────────────────────────────────────────────────

const stone3dWallStamp: PerCellHandler = (state) => {
  // Row-group selection. The cart reads `$2C` as a 16-bit SIGNED row offset (the
  // walker counts negative for cells ABOVE the placement origin) and does
  // `EOR #$FFFF ; INC` = 16-bit negate, then `CMP #5 ; BCC keep ; else 4`.
  // The walker stores $2C in 8 bits, so use signed8() to recover the cart's
  // 16-bit value: signed8($FD) = -3 → negate = 3 (NOT 253 → clamp-to-4). This is
  // what makes the row-group-3 / promote branch below reachable for upper cells.
  const negRow = (-signed8(state.zp2C)) & 0xffff;
  const yRowGroup = (negRow < 0x0005 ? negRow : 0x0004) & 0x0006;
  let rowGroup: number = DATA_waterfall_rowgroups[yRowGroup >>> 1]!;

  // CMP #$0006 / BCS skip → the PRNG promote branch fires when rowGroup < 6 AND
  // $2C is ODD. This IS reachable: for the waterfall column's cells ABOVE the
  // placement origin the walker's $2C is negative (large-unsigned, e.g. $FFFD),
  // so the `EOR #$FFFF ; INC` negate-clamp above yields negRow ∈ {2,3} → rowGroup
  // = 3 (odd $2C). When `prng & 2` is set the cart does `INC $00 ×3`, promoting
  // the row-group offset (3 → 6) and so bumping the waterfall cap base. The roll
  // fires whenever the gate holds (matching the cart's JSL placement).
  if (rowGroup < 0x0006 && (state.zp2C & 0x0001) !== 0) {
    if ((prngNext(state, RNG_SITE.stone3dWallPromote) & 0x0002) !== 0) {
      rowGroup = (rowGroup + 3) & 0xffff;
    }
  }

  // Parity selector for cap-tile pick. Y ∈ {0, 2}.
  const parityY = (((state.zp2C ^ state.zp28 ^ state.zp15) & 0x0001) << 1) & 0xffff;

  // Column-position dispatch. X ∈ {0 (left), 2 (middle), 4 (right)}.
  // The cart uses `LDA $28 ; BEQ ; INX INX ; INC ; CMP $2A ; BNE ; INX INX`
  // which means "first column → left; last column (col+1 == $2A) → right;
  // otherwise middle". $2A is the column extent.
  let result: { cap: number; sum: number };
  const col = state.zp28 & 0xff;
  if (col === 0) {
    result = waterfallLeftCap(parityY, rowGroup);
  } else if (((col + 1) & 0xff) === (state.zp2A & 0xff)) {
    result = waterfallRightCap(state, parityY, rowGroup);
  } else {
    result = waterfallMiddleCap(state, parityY, rowGroup);
  }

  // Row-0 patch (Bank13.asm:14964-14970). Reads $02 (the cap latch from
  // the sub-handler), NOT the running A. Then stamps the patched value.
  let finalTile = result.sum & 0xffff;
  if ((state.zp2C & 0xffff) === 0) {
    finalTile = ((result.cap - ROW0_PATCH_SOURCE + ROW0_PATCH_TARGET) & 0xffff);
  }

  stampCell(state, finalTile);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_stone_3d_wall (Bank12.asm:5392)
//
// $15 = (bit-0 of $1B) XOR (bit-4 of $1B). Then standard trampoline with
// all 3 handler slots = stone3dWallStamp. Spec confirms "$15 ED → 00
// (init re-encoded $15)" — for the test scenario both bits are zero.
// ─────────────────────────────────────────────────────────────────────

function initStone3dWall(state: DecodeState): void {
  const bit0 = state.zp1B & 0x0001;
  const bit4 = (state.zp1B >>> 4) & 0x0001;
  state.zp15 = (bit0 ^ bit4) & 0xffff;
  walkerSetupTrampoline(state, stone3dWallStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Object $ED is the 3-cell-tall waterfall column.
// ─────────────────────────────────────────────────────────────────────

export function installStone3dWallHandlers(): void {
  registerStdObjectHandler(0xED, initStone3dWall);
}
