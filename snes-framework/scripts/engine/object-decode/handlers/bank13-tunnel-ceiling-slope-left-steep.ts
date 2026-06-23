// Bank13 tunnel ceiling sloping up-left (steep) stamp handler + Bank12 init wrapper.
//
// Standard object $86 — tunnel ceiling sloping up-left (steep); a
// vertical wall column with endcap. Interior rows pick from the 8-way
// random-grass pool (shared `floor_random_8way_pick`), the last two rows
// pick from a dedicated 2-entry endcap-tile table that visually caps the
// column's bottom edge. On the last row (Y=0), two extra "match-below"
// probes optionally extend the column one tile further down when the
// existing neighbour matches a sentinel template ID.
//
// Topology vs sibling $85 tunnel ceiling sloping up-right (steep):
//   - $85 is HORIZONTAL — endcaps on the bottom of every column, the
//     "left_fix" runs on col==0 and the "right_fix" / decorator-overwrite
//     runs at the rightmost column.
//   - $86 is VERTICAL — endcaps on the bottom of the column itself.
//     `big_floor_right_fix` runs UNCONDITIONALLY when the cell is at
//     the rightmost column (top of stamp, before the diff branch); the
//     `big_floor_left_fix` runs on the body branch when col==0. The
//     "decorator overwrite" found in $85 is absent — instead the
//     last-row variant probes via match_below + match_below_alt with a
//     subY+1 offset (NOT the subX-1 below-left offset $85 uses).
//
// Init handler also differs from $85's plain trampoline: it pre-computes
// `$2E = max(1, $2E - $2A)` so the row extent reflects "row count past
// the initial column-fanout cap" before the walker starts — height
// shrinks by the initial column index.
//
// Asm sources:
//   CODE_init_tunnel_ceiling_slope_left_steep          Bank12.asm:4414  ($12:9C97)
//   CODE_tunnel_ceiling_slope_left_steep_stamp         Bank13.asm:9579  ($13:D1B0)
//   CODE_big_floor_left_fix               Bank13.asm:7908  ($13:C570)
//   CODE_big_floor_right_fix              Bank13.asm:8027  ($13:C64D)
//   CODE_floor_random_8way_pick           Bank13.asm:7639  ($13:C15F)
//   CODE_ceiling_endcap_match_below       Bank13.asm:9637  ($13:D218)
//   CODE_ceiling_endcap_match_below_alt   Bank13.asm:9649  ($13:D22F)
//   DATA_tunnel_ceiling_slope_left_steep_tiles         Bank13.asm:9575  ($13:D1AC)
//   DATA_floor_left_neighbour_remap / DATA_floor_above_neighbour_remap (left/right edge remap tables for big_floor_*_fix)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { getMap16Below } from '../fetch.ts';
import {
  floorRandom8wayPick, readBuf16, stampCell, writeBuf16,
  bigFloorLeftEdgeFix, bigFloorRightEdgeFix,
} from './_shared.ts';
import { TT } from '../template-slots.ts';

// ─────────────────────────────────────────────────────────────────────
// Template-slot constants.
//
// Mirror of the addresses used by $85 tunnel ceiling sloping up-right (steep); not in
// `template-slots.ts:TT` because only the endcap family consumes them.
// The `state.templateAt(addr)` lookup yields the per-tileset Map16 ID.
// ─────────────────────────────────────────────────────────────────────

/** Slot for the "penultimate-row" endcap tile (Y=2 in DATA_tunnel_ceiling_slope_left_steep_tiles). */
const SLOT_ENDCAP_PENULT = 0x001DEA;
/** Slot for the "last-row" endcap tile (Y=0 in DATA_tunnel_ceiling_slope_left_steep_tiles). */
const SLOT_ENDCAP_LAST = 0x001DEE;
/** Slot for the "match-below" sentinel — compared against neighbours
 *  during the last-row probe to decide whether to extend downward. */
const SLOT_MATCH_BELOW_SENTINEL = 0x001C04;
/** Slot stamped INTO the below-neighbour when CODE_ceiling_endcap_match_below matches the
 *  sentinel (non-alt path; called first with $1B as the seed). */
const SLOT_BELOW_EXTEND = 0x001D2C;
/** Slot stamped INTO the below-neighbour when CODE_ceiling_endcap_match_below_alt matches the
 *  sentinel (alt path; called only at the rightmost column with a
 *  subY+1 coord seed). */
const SLOT_BELOW_EXTEND_ALT = 0x001D2E;

// ─────────────────────────────────────────────────────────────────────
// DATA_tunnel_ceiling_slope_left_steep_tiles (Bank13.asm:9575).
//
//   dw $1DEE, $1DEA
//
// Indexed by `(($2E - $2C - 1) << 1)` so:
//   diff == 0 (last row)       → Y=0 → slot $1DEE
//   diff == 1 (penultimate row) → Y=2 → slot $1DEA
// ─────────────────────────────────────────────────────────────────────

const DATA_tunnel_ceiling_slope_left_steep_tiles: ReadonlyArray<number> = [
  SLOT_ENDCAP_LAST,
  SLOT_ENDCAP_PENULT,
];

// ─────────────────────────────────────────────────────────────────────
// CODE_big_floor_left_fix / CODE_big_floor_right_fix ($13:C570 / $13:C64D) —
// the wide-floor overlap-seam fixer, shared with the right-steep sibling and
// ported once in _shared.ts (`bigFloorLeftEdgeFix` / `bigFloorRightEdgeFix`).
// Each probes the left/right NEIGHBOUR and, if it's a wide-floor-page tile
// (a previously-stamped tunnel/floor), remaps that NEIGHBOUR cell in place to
// the matching connector.
//
// This was wrongly stubbed as a no-op on the premise that neighbours are
// always $0000 — true only for a fresh decode with no overlap. In real levels
// a $14 tunnel often abuts this slope: record $69 cell (53,81) holds the
// tunnel's $1D12; $86 #239's col0 left-fix remaps it (idx 13 → slot $1BFA →
// $1D0D), the value the live cart shows. The stub left it as $1D12.
// ─────────────────────────────────────────────────────────────────────

const bigFloorLeftFix = bigFloorLeftEdgeFix;
const bigFloorRightFix = bigFloorRightEdgeFix;

// ─────────────────────────────────────────────────────────────────────
// CODE_ceiling_endcap_match_below / CODE_ceiling_endcap_match_below_alt
// (Bank13.asm:9637 / 9649). Reused verbatim from $85's port — the asm
// label says "ceiling" but the routine is generic: probe-below, if
// match sentinel $1C04 stamp slot $1D2C / $1D2E.
// ─────────────────────────────────────────────────────────────────────

function ceilingEndcapMatchBelow(state: DecodeState, probeCoord: number): void {
  state.zp0E = probeCoord & 0xffff;
  state.zp0F = (probeCoord >>> 8) & 0xff;
  const off = getMap16Below(state);
  const cur = readBuf16(state, off);
  if (cur === state.templateAt(SLOT_MATCH_BELOW_SENTINEL)) {
    writeBuf16(state, off, state.templateAt(SLOT_BELOW_EXTEND));
  }
}

function ceilingEndcapMatchBelowAlt(state: DecodeState, probeCoord: number): void {
  state.zp0E = probeCoord & 0xffff;
  state.zp0F = (probeCoord >>> 8) & 0xff;
  const off = getMap16Below(state);
  const cur = readBuf16(state, off);
  if (cur === state.templateAt(SLOT_MATCH_BELOW_SENTINEL)) {
    writeBuf16(state, off, state.templateAt(SLOT_BELOW_EXTEND_ALT));
  }
}

// ─────────────────────────────────────────────────────────────────────
// CODE_tunnel_ceiling_slope_left_steep_stamp ($13:D1B0).
//
// Per-cell handler for object $86. The cart's flow:
//
//   1. Row-extent bump for non-first columns on row 0 (col != 0 AND
//      row == 0): `$2E += 2`. Lets subsequent columns extend two rows
//      past the lead column. (Inverse direction of $85's clamp.)
//
//   2. UNCONDITIONAL right-cap check: if col is at the rightmost
//      column ($28 + 1 == $2A), call CODE_big_floor_right_fix BEFORE
//      the body/cap branch. With col_extent=1 this fires every cell.
//
//   3. Compute `diff = $2E - $2C - 1` (CLC + SBC = subtract + borrow):
//        diff == 0 → cap_stamp Y=0 (last row → slot $1DEE)
//        diff == 1 → cap_stamp Y=2 (penultimate → slot $1DEA)
//        else      → interior path:
//                      floor_random_8way_pick
//                      if col == 0: big_floor_left_fix
//
//   4. cap_stamp: stamp tile = templateAt(DATA_tunnel_ceiling_slope_left_steep_tiles[Y/2]).
//        Then, only if Y == 0 (last row):
//          - call CODE_ceiling_endcap_match_below with A = $1B  (probes the cell below).
//          - if at rightmost column ($28 + 1 == $2A): compose a coord
//            with subY-nibble incremented (wrapping in the low byte's
//            high-nibble) and call CODE_ceiling_endcap_match_below_alt.
// ─────────────────────────────────────────────────────────────────────

const tunnelCeilingSlopeLeftSteepStamp: PerCellHandler = (state) => {
  // 1. Per-column row-extent bump (col != 0 AND row == 0).
  if (((state.zp28 & 0xff) !== 0) && ((state.zp2C & 0xff) === 0)) {
    state.zp2E = (state.zp2E + 2) & 0xffff;
  }

  // 2. Unconditional right-cap fix at rightmost column (top of stamp).
  const colExt = state.zp2A & 0xff;
  const col = state.zp28 & 0xff;
  const atRightmost = ((col + 1) & 0xff) === colExt;
  if (atRightmost) {
    bigFloorRightFix(state);
  }

  // 3. Compute diff = $2E - $2C - 1 (SBC with CLC).
  const rowExtent = state.zp2E & 0xffff;
  const rowCounter = state.zp2C & 0xffff;
  const diff = (rowExtent - rowCounter - 1) & 0xffff;

  if (diff !== 0 && diff !== 1) {
    // Interior path: PRNG-pick from the 8-way random-grass pool.
    floorRandom8wayPick(state);
    // Left-cap fix on first column.
    if (col === 0) {
      bigFloorLeftFix(state);
    }
    return;
  }

  // 4. cap_stamp path. Y = diff << 1 (word index into table).
  const y = diff << 1;
  const slotAddr = DATA_tunnel_ceiling_slope_left_steep_tiles[y >>> 1]!;
  stampCell(state, state.templateAt(slotAddr));

  if (y !== 0) {
    // Y == 2 (penultimate row): no below-probes.
    return;
  }

  // Y == 0 → last row.
  //
  // First probe: A = $1B (current cell), CODE_ceiling_endcap_match_below → checks the cell
  // directly below and stamps slot $1D2C on sentinel match.
  const cursor1B = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  ceilingEndcapMatchBelow(state, cursor1B);

  // Second probe (only at rightmost column): compose a coord with
  // subY-nibble incremented and call CODE_ceiling_endcap_match_below_alt. Asm builds it as:
  //   LDA $1B ; TAX
  //   AND #$0F0F ; ORA #$00F0 ; INC ; AND #$0F0F ; STA $0E
  //   TXA ; AND #$F0F0 ; ORA $0E
  //
  // The `ORA #$00F0` saturates the low byte's high-nibble so INC
  // bumps the low byte's *low*-nibble (subY) via carry-out, then the
  // mask strips back to the nibble bits. Net: subY += 1, wrapping
  // within the low byte's low-nibble (and incrementing subY into
  // pageY-low if it overflows the low byte's high-nibble after the
  // ORA — but the AND #$0F0F immediately strips that).
  if (!atRightmost) return;

  const orig1B = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  let low = orig1B & 0x0F0F;
  low = ((low | 0x00F0) + 1) & 0x0F0F;
  const composed = ((orig1B & 0xF0F0) | low) & 0xffff;
  ceilingEndcapMatchBelowAlt(state, composed);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_tunnel_ceiling_slope_left_steep ($12:9C97).
//
//   REP #$20
//   LDA $2A         ; col_extent
//   STA $00         ; scratch
//   LDA $2E         ; row_extent
//   SEC ; SBC $00   ; diff = row_extent - col_extent
//   BEQ → set 1     ; on 0, clamp to 1
//   BPL → STA $2E   ; on positive, keep diff
//   ; else (negative): fall through to set-1
//   LDA #$0001
//   STA $2E
//   LDX #(stamp-1)>>16
//   LDA #stamp-1
//   JMP walker_setup_trampoline
//
// Effect: `$2E = max(1, $2E - $2A)`. Encodes "remaining body rows
// after the per-column row-extent bump cycle" — the stamp adds 2
// rows back on for each subsequent column (col!=0, row==0 path).
// ─────────────────────────────────────────────────────────────────────

function initTunnelCeilingSlopeLeftSteep(state: DecodeState): void {
  const rowExt = state.zp2E & 0xffff;
  const colExt = state.zp2A & 0xffff;
  const diff = (rowExt - colExt) & 0xffff;
  // BEQ → 1 ; BPL (sign bit clear) → keep ; else (negative) → 1.
  if (diff === 0 || (diff & 0x8000) !== 0) {
    state.zp2E = 0x0001;
  } else {
    state.zp2E = diff;
  }
  walkerSetupTrampoline(state, tunnelCeilingSlopeLeftSteepStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installTunnelCeilingSlopeLeftSteepHandlers(): void {
  registerStdObjectHandler(0x86, initTunnelCeilingSlopeLeftSteep);
}
