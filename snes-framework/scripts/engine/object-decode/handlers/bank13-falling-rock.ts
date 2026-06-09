// Bank13 stamp handler for the small lift / platform piece
// (standard object $89 — "small lift platform").
//
// Cart entry points:
//   CODE_init_falling_rock  ($12:9CD8, Bank12.asm:4452)
//   CODE_stamp_falling_rock          ($13:D2D6, Bank13.asm:9740) — per-cell dispatcher
//   DATA_small_lift_handler_ptrs   ($13:D2CE) — 4-entry sub-handler pointer table
//   CODE_small_lift_endcap         ($13:D301) — 1x1 platform (returns $720D)
//   CODE_small_lift_bodyrow        ($13:D30B) — 1-row platform
//   CODE_small_lift_colstrip       ($13:D324) — 1-col platform
//   CODE_small_lift_corner         ($13:D354) — full 2D platform (3x4 dispatch)
//   DATA_small_lift_bodyrow_tiles  ($13:D305) — {$7209, $720A, $720B}
//   DATA_small_lift_colstrip_tiles ($13:D31C) — {$720C, $720E, $7213, $720F}
//   DATA_small_lift_corner_tiles   ($13:D33C) — 12 entries (4 rows × 3 cols)
//
// Init handler (Bank12.asm:4452) — simple trampoline into the slope=0 walker.
// No DP mutations; spec's `init_dp_delta` table confirms xy_lo/xy_hi/col_extent/
// row_extent/orientation are unchanged from entry to walker time.
//
//   REP #$20
//   LDX.b #(CODE_stamp_falling_rock-$01)>>16
//   LDA.w #CODE_stamp_falling_rock-$01
//   JMP   CODE_walker_setup_trampoline           ; STZ $17 (slope=0)
//
// Per-cell stamp (CODE_stamp_falling_rock):
//   The cart dispatches to ONE of 4 sub-handlers based on object dimensions
//   (extent constants — same handler every cell within one object):
//
//     X = 0
//     if ($2E - 1) != 0:                  ; row_extent > 1
//       X = 4
//       if ($2A - 1) != 0: X = 6          ; col_extent > 1
//     else:                                ; row_extent == 1
//       if ($2A - 1) != 0: X = 2          ; col_extent > 1
//
//     JSR (DATA_small_lift_handler_ptrs,x):
//       X=0  → endcap   (1x1 platform)
//       X=2  → bodyrow  (1-row platform)
//       X=4  → colstrip (1-col platform)
//       X=6  → corner   (full 2D platform)
//
//     STA.l buffer,X   ; stamp result
//
// Sub-handler logic (each returns its Map16 ID in A):
//
//   endcap:     return $720D
//
//   bodyrow:    pick by col-position from {leftcap, mid, rightcap}
//     Y = 0
//     if $28 != 0:                         ; not left cap
//       Y = 2
//       if ($28 + 1) == $2A: Y = 4         ; right cap
//     return DATA_small_lift_bodyrow_tiles[Y/2]
//
//   colstrip:   pick by row-position from {topcap, mid-even, mid-odd, botcap}
//     Y = 0
//     if $2C != 0:                         ; not top cap
//       Y = 6
//       if ($2C + 1) != $2E:               ; not bottom cap
//         Y = 2 + ((row & 1) * 2)          ; mid-even (Y=2) / mid-odd (Y=4)
//     return DATA_small_lift_colstrip_tiles[Y/2]
//
//   corner:     full 3x4 dispatch (verified against spec's per-cell trace)
//     ; Y picks the row-band base (0..3 → 0, 6, 12, 18 byte-indexed)
//     Y = 0                                ; row 0 base
//     if $2C != 0:
//       Y = 18                             ; row = extent-1 base
//       if ($2C + 1) != $2E:
//         if ($2C & 1) == 0:
//           Y = 12                         ; row mid-even base
//         else:
//           Y = 6                          ; row mid-odd base
//     ; Then offset within the row (0/2/4 → col 0, mid, end)
//     if $28 != 0:
//       Y += 2
//       if ($28 + 1) == $2A: Y += 2
//     return DATA_small_lift_corner_tiles[Y/2]
//
// Per-cell trace for the spec's 16×16 platform (corner sub-handler):
//   col=0,row=0:    Y=$00 → $7200    ; col=0,row=mid-odd:  Y=$06 → $7203
//   col=0,row=mid-even: Y=$0C → $7210
//   col=0,row=15:   Y=$12 → $7206    ; col=1,row=0:        Y=$02 → $7201
//   col=1,row=mid-odd:  Y=$08 → $7204 …
//
// Layout (4 rows × 3 cols, byte-spaced word entries):
//   row=0:        $7200  $7201  $7202     ; Y= 0, 2, 4
//   row=mid-odd:  $7203  $7204  $7205     ; Y= 6, 8, 10
//   row=mid-even: $7210  $7211  $7212     ; Y=12,14,16
//   row=end:      $7206  $7207  $7208     ; Y=18,20,22

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Tile tables consumed by the sub-handlers (Bank13.asm:9783, 9798, 9819).
// All cart entries are word-spaced; we store as flat arrays and index
// by `Y / 2` (the asm uses byte-spaced Y indexing).
// ─────────────────────────────────────────────────────────────────────

/** DATA_small_lift_bodyrow_tiles — 3-entry row {leftcap, mid, rightcap}. */
const DATA_small_lift_bodyrow_tiles  = [0x7209, 0x720A, 0x720B] as const;

/** DATA_small_lift_colstrip_tiles — 4-entry column {topcap, mid-even,
 *  mid-odd, botcap}. */
const DATA_small_lift_colstrip_tiles = [0x720C, 0x720E, 0x7213, 0x720F] as const;

/** DATA_small_lift_corner_tiles — 4 rows × 3 cols of platform-edge tiles.
 *  Layout row-major: row0, row-mid-odd, row-mid-even, row-end. */
const DATA_small_lift_corner_tiles   = [
  0x7200, 0x7201, 0x7202,
  0x7203, 0x7204, 0x7205,
  0x7210, 0x7211, 0x7212,
  0x7206, 0x7207, 0x7208,
] as const;

/** Endcap Map16 ID returned by CODE_small_lift_endcap (1x1 platform). */
const SMALL_LIFT_ENDCAP_TILE = 0x720D;

// ─────────────────────────────────────────────────────────────────────
// Sub-handlers — each returns the Map16 ID for the current cell.
// ─────────────────────────────────────────────────────────────────────

function smallLiftEndcap(_state: DecodeState): number {
  return SMALL_LIFT_ENDCAP_TILE;
}

function smallLiftBodyrow(state: DecodeState): number {
  const col = state.zp28 & 0xff;
  // LDA $28 ; BEQ leftcap.
  if (col === 0) return DATA_small_lift_bodyrow_tiles[0]!;
  // INY INY ; INC ; CMP $2A ; BNE mid.
  // INY INY (Y=4 → rightcap) if (col+1) == col_extent.
  const idx = ((col + 1) & 0xff) === (state.zp2A & 0xff) ? 2 : 1;
  return DATA_small_lift_bodyrow_tiles[idx]!;
}

function smallLiftColstrip(state: DecodeState): number {
  const row = state.zp2C & 0xff;
  // LDA $2C ; BEQ topcap.
  if (row === 0) return DATA_small_lift_colstrip_tiles[0]!;
  // LDY #$0006 ; INC ; CMP $2E ; BEQ botcap.
  if (((row + 1) & 0xff) === (state.zp2E & 0xff)) {
    return DATA_small_lift_colstrip_tiles[3]!;
  }
  // AND #$0001 ; ASL ; TAY ; INY INY → idx = 1 (even row) or 2 (odd row).
  // (The cart re-reads $2C via the prior INC's A; bit 0 picks parity.)
  const idx = ((row + 1) & 0x01) === 0 ? 1 : 2;
  return DATA_small_lift_colstrip_tiles[idx]!;
}

function smallLiftCorner(state: DecodeState): number {
  // Step 1: pick row-band base index (0..3 → entries 0, 3, 6, 9 in flat array).
  const row = state.zp2C & 0xff;
  let band: number;
  if (row === 0) {
    band = 0;                                // row 0 (top edge)
  } else if (((row + 1) & 0xff) === (state.zp2E & 0xff)) {
    band = 3;                                // row = extent-1 (bottom edge)
  } else if (((row + 1) & 0x01) === 0) {
    band = 1;                                // mid row, (row+1) even → row odd → mid-odd
  } else {
    band = 2;                                // mid row, (row+1) odd  → row even → mid-even
  }

  // Step 2: pick col offset within the row (0 / 1 / 2 → leftcap / mid / rightcap).
  const col = state.zp28 & 0xff;
  let colOff: number;
  if (col === 0) {
    colOff = 0;                              // leftcap
  } else if (((col + 1) & 0xff) === (state.zp2A & 0xff)) {
    colOff = 2;                              // rightcap
  } else {
    colOff = 1;                              // mid
  }

  return DATA_small_lift_corner_tiles[band * 3 + colOff]!;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_falling_rock (Bank13.asm:9740) — per-cell dispatcher.
//
// Reads object dimensions to pick one of 4 sub-handlers. Note this reads
// extents (constants for the whole object), so the same sub-handler fires
// every cell within one object — the cart still re-runs the dispatch per
// cell because the per-cell handler pointer is set once by the init.
// ─────────────────────────────────────────────────────────────────────

const fallingRock: PerCellHandler = (state) => {
  const rowExtMinus1 = (state.zp2E - 1) & 0xffff;
  const colExtMinus1 = (state.zp2A - 1) & 0xffff;

  let tile: number;
  if (rowExtMinus1 !== 0) {
    // row_extent > 1: colstrip or corner.
    tile = colExtMinus1 === 0
      ? smallLiftColstrip(state)
      : smallLiftCorner(state);
  } else {
    // row_extent == 1: endcap or bodyrow.
    tile = colExtMinus1 === 0
      ? smallLiftEndcap(state)
      : smallLiftBodyrow(state);
  }

  stampCell(state, tile);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_falling_rock (Bank12.asm:4452).
//
// Pure trampoline into the slope=0 walker setup. No DP mutations —
// walker reads xy_lo / xy_hi / col_extent / row_extent / orientation
// directly from the stream record (spec init_dp_delta is all "no").
// ─────────────────────────────────────────────────────────────────────

function initFallingRock(state: DecodeState): void {
  walkerSetupTrampoline(state, fallingRock);
}

// ─────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────

export function installFallingRockHandlers(): void {
  registerStdObjectHandler(0x89, initFallingRock);
}
