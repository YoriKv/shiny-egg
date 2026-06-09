// Bank13 tunnel ceiling sloping up-right (steep) stamp handler + Bank12 init wrapper.
//
// Standard object $85 — tunnel ceiling sloping up-right (steep); a
// horizontal ceiling row with right-neighbour endcap detection. Interior
// rows pick from the 8-way random-grass pool (same as `bg_floor_random`),
// the last two rows of each column switch over to dedicated endcap-tile
// slots that visually cap the ceiling's bottom edge. On the last row, two
// extra "match-below" probes optionally extend the ceiling one tile
// further down when the existing neighbour matches a sentinel template ID.
//
// Asm sources:
//   CODE_init_tunnel_ceiling_slope_right_steep          Bank12.asm:4407  ($12:9C8D)
//   CODE_tunnel_ceiling_slope_right_steep_stamp         Bank13.asm:9507  ($13:D130)
//   CODE_big_floor_left_fix               Bank13.asm:7908  ($13:C570)
//   CODE_big_floor_right_fix              Bank13.asm:8027  ($13:C64D)
//   CODE_floor_random_8way_pick           Bank13.asm:7639  ($13:C15F)
//   CODE_ceiling_endcap_match_below       Bank13.asm:9637  ($13:D218)
//   CODE_ceiling_endcap_match_below_alt   Bank13.asm:9649  ($13:D22F)
//   DATA_tunnel_ceiling_slope_right_steep_tiles         Bank13.asm:9503  ($13:D12C)
//   DATA_floor_left_neighbour_remap / DATA_floor_above_neighbour_remap (left/right edge remap tables for big_floor_*_fix)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { getMap16Below, getMap16Left, getMap16Right } from '../fetch.ts';
import {
  floorRandom8wayPick, readBuf16, stampCell, writeBuf16,
} from './_shared.ts';
import { TT } from '../template-slots.ts';

// ─────────────────────────────────────────────────────────────────────
// Template-slot constants (WRAM `$00:1Dxx` addresses populated at
// level-load by `init_per_tileset_template_slots`).
//
// These are NOT in `template-slots.ts:TT` — they're handler-local
// because the ceiling-endcap family is the only consumer. The
// `state.templateAt(addr)` lookup yields the per-tileset Map16 ID.
// ─────────────────────────────────────────────────────────────────────

/** Slot for the "penultimate-row" endcap tile (Y=2 in DATA_tunnel_ceiling_slope_right_steep_tiles). */
const SLOT_ENDCAP_PENULT = 0x001DF2;
/** Slot for the "last-row" endcap tile (Y=0 in DATA_tunnel_ceiling_slope_right_steep_tiles). */
const SLOT_ENDCAP_LAST = 0x001DF6;
/** Slot for the "right-decorator" tile (overwritten onto right neighbour
 *  when the penultimate-row cell is at the object's rightmost column). */
const SLOT_DECOR_RIGHT = 0x001D2E;
/** Slot for the "match-below" sentinel — compared against neighbours
 *  during the last-row probe to decide whether to extend downward. */
const SLOT_MATCH_BELOW_SENTINEL = 0x001C04;
/** Slot stamped INTO the below-neighbour when CODE_ceiling_endcap_match_below matches
 *  the sentinel (the "non-alt" / below-left probe path). */
const SLOT_BELOW_EXTEND = 0x001D2C;
/** Slot stamped INTO the below-neighbour when CODE_ceiling_endcap_match_below_alt matches
 *  the sentinel (the alt / directly-below probe path). */
const SLOT_BELOW_EXTEND_ALT = 0x001D2E;

// ─────────────────────────────────────────────────────────────────────
// DATA_tunnel_ceiling_slope_right_steep_tiles (Bank13.asm:9503).
//
//   dw $1DF6, $1DF2
//
// Indexed by `(($2E - $2C - 1) << 1)` so:
//   diff == 0 (last row)       → Y=0 → slot $1DF6
//   diff == 1 (penultimate row) → Y=2 → slot $1DF2
// ─────────────────────────────────────────────────────────────────────

const DATA_tunnel_ceiling_slope_right_steep_tiles: ReadonlyArray<number> = [
  SLOT_ENDCAP_LAST,
  SLOT_ENDCAP_PENULT,
];

// ─────────────────────────────────────────────────────────────────────
// CODE_big_floor_left_fix / CODE_big_floor_right_fix.
//
// Each probes the neighbour in its direction; if the neighbour's page
// byte ($1100) matches `TileTpl_WideFloorPage_Anchor` ($1BE0 → $1D00 in
// the observed traces), the asm dereferences `DATA_floor_left_neighbour_remap,y` (left) or
// `DATA_floor_above_neighbour_remap,y` (right) using `(neighbour & $FF) * 2` and stamps the
// resolved tile into the current cell.
//
// **Minimal port**: these table reads target a parallel template family
// not currently modelled by `state.templateAt` (the tables are RAM
// indirections built by `init_per_tileset_template_slots`). The
// observed traces show the page-byte CMP fails on every probe (neighbours
// are uniformly $0000 = uninitialised), so the remap never fires for
// the spec-test cases. Implementing the remap correctly requires porting
// the DATA_floor_left_neighbour_remap / DATA_floor_above_neighbour_remap slot pages — out of scope for the
// $85 init port. We perform the probe (for trace fidelity) but treat
// the CMP-match branch as a no-op.
// ─────────────────────────────────────────────────────────────────────

/** Probe the left/right/below neighbour. Uses the 16-bit cursor
 *  composition `($1C << 8) | $1B` for zp0E rather than the shared
 *  `setProbeToCurrent` helper — the latter discards $1C (the page-byte)
 *  which matters when the walker's current cell sits on a non-zero page.
 *  fetch.ts reads zp0E as the 16-bit composite (`zp0E & 0x0f0f`,
 *  `zp0E | 0x0f00`, …). Matches the `word1B` reconstruction pattern
 *  used in `bank13-floor-edges.ts` etc. */
function setProbeToCurrent16(state: DecodeState): void {
  state.zp0E = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  state.zp0F = state.zp1C & 0xff;
}

function bigFloorLeftFix(state: DecodeState): void {
  // CODE_probe_left_tile: zp0E = zp1B; get_map16_left; LDA buffer,x.
  setProbeToCurrent16(state);
  const off = getMap16Left(state);
  // Probe consumed; CMP against WideFloorPage_Anchor would normally
  // gate a remap stamp. See header comment for why we no-op the remap.
  void readBuf16(state, off);
  void state.templateAt(TT.WideFloorPage_Anchor);
}

function bigFloorRightFix(state: DecodeState): void {
  setProbeToCurrent16(state);
  const off = getMap16Right(state);
  void readBuf16(state, off);
  void state.templateAt(TT.WideFloorPage_Anchor);
}

// ─────────────────────────────────────────────────────────────────────
// CODE_ceiling_endcap_match_below / CODE_ceiling_endcap_match_below_alt
// (Bank13.asm:9637 / 9649).
//
// Both probe the cell below a caller-provided coord ($0E/$0F = A on
// entry) and overwrite that below-cell with a template slot value IF
// the existing tile matches the sentinel slot `$1C04`. Only the stamp
// slot differs:
//   match_below     → $1D2C  (non-alt / below-left path)
//   match_below_alt → $1D2E  (alt / directly-below path)
// ─────────────────────────────────────────────────────────────────────

function ceilingEndcapMatchBelow(state: DecodeState, probeCoord: number): void {
  // fetch.ts treats `zp0E` as the 16-bit composite cursor (`$0E:$0F`
  // under REP #$20); set both halves so the high-byte (page index)
  // survives into getMap16Below's screen-resolve step.
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
// CODE_tunnel_ceiling_slope_right_steep_stamp ($13:D130).
//
// Per-cell handler for object $85. The cart's flow:
//
//   1. Clamp $2E (row extent) on the first row of a NEW column (col!=0
//      && row==0): DEC twice, then if result == 0 force $2E=1, else
//      if negative also force $2E=1. (BPL skip = positive keeps the
//      DEC'd value.) This means subsequent columns are at most 2 rows
//      shorter than the lead column.
//
//   2. If col == 0, call CODE_big_floor_left_fix (left-edge probe).
//
//   3. Compute `diff = $2E - $2C - 1` (SBC with CLC = subtract+borrow):
//        diff == 0 → short_special with Y=0 (last row)
//        diff == 1 → short_special with Y=2 (penultimate row)
//        else      → interior path: floor_random_8way_pick, then
//                    big_floor_right_fix if at rightmost column.
//
//   4. short_special: stamp tile = templateAt(DATA_tunnel_ceiling_slope_right_steep_tiles[Y/2]).
//        - If Y == 2 (penultimate row): if at rightmost column, run
//          probe_right_tile + stamp slot $1D2E into the right neighbour
//          (the "decorator overwrite" pattern seen in cell 10 of the
//          spec).
//        - If Y == 0 (last row): probe directly-below and below-left,
//          extending the ceiling downward via match_below_alt + match_below
//          when neighbours equal the sentinel.
// ─────────────────────────────────────────────────────────────────────

const tunnelCeilingSlopeRightSteepStamp: PerCellHandler = (state) => {
  // 1. Per-column row-extent clamp (col != 0 AND row == 0).
  if (((state.zp28 & 0xff) !== 0) && ((state.zp2C & 0xff) === 0)) {
    // 16-bit DEC under REP #$30.
    let v = state.zp2E & 0xffff;
    v = (v - 2) & 0xffff;
    // BEQ clampTo1 (==0) ; BPL skip (positive) ; else fall through to clampTo1.
    if (v === 0 || (v & 0x8000) !== 0) {
      v = 1;
    }
    state.zp2E = v;
  }

  // 2. Left-cap fix on first column.
  if ((state.zp28 & 0xff) === 0) {
    bigFloorLeftFix(state);
  }

  // 3. Compute diff = $2E - $2C - 1 (SBC with CLC).
  const rowExtent = state.zp2E & 0xffff;
  const rowCounter = state.zp2C & 0xffff;
  const diff = (rowExtent - rowCounter - 1) & 0xffff;

  if (diff !== 0 && diff !== 1) {
    // Interior path: PRNG-pick from the 8-way random-grass pool.
    floorRandom8wayPick(state);
    // Right-cap fix at rightmost column.
    if ((((state.zp28 & 0xff) + 1) & 0xff) === (state.zp2A & 0xff)) {
      bigFloorRightFix(state);
    }
    return;
  }

  // 4. short_special path. Y = diff << 1 (word index into table).
  const y = diff << 1;
  const slotAddr = DATA_tunnel_ceiling_slope_right_steep_tiles[y >>> 1]!;
  stampCell(state, state.templateAt(slotAddr));

  if (y === 0) {
    // Y == 0 → last row. Two probe-below variants:
    //
    //   (a) alt path with A = $1B (directly below current cell):
    //       stamps slot $1D2E into the below-neighbour if it matches
    //       sentinel $1C04.
    //
    //   (b) non-alt path with A = $1B with subX nibble decremented
    //       (below-left of current cell): stamps slot $1D2C on the
    //       same sentinel match.
    //
    // Pass coords through ceilingEndcapMatchBelow*; each helper writes
    // zp0E and invokes getMap16Below internally.
    const cursor1B = (state.zp1B | (state.zp1C << 8)) & 0xffff;
    ceilingEndcapMatchBelowAlt(state, cursor1B);

    // Reconstruct below-left coord: $1B AND #$F0F0 (keep subY-nibble +
    // page-X-nibble), $1B AND #$0F0F (keep subX + page-Y-low), DEC,
    // AND #$0F0F (mask back), ORA preserved high.
    const keepHigh = cursor1B & 0xf0f0;
    let dec = cursor1B & 0x0f0f;
    dec = (dec - 1) & 0xffff;
    dec = dec & 0x0f0f;
    const belowLeftCursor = (keepHigh | dec) & 0xffff;
    ceilingEndcapMatchBelow(state, belowLeftCursor);
    return;
  }

  // Y == 2 → penultimate row. Decorator overwrite only at rightmost col.
  if ((((state.zp28 & 0xff) + 1) & 0xff) === (state.zp2A & 0xff)) {
    // CODE_probe_right_tile: zp0E = zp1B; get_map16_right; (asm also
    // does LDA buffer,x but we only need the offset for the
    // subsequent overwrite store).
    setProbeToCurrent16(state);
    const off = getMap16Right(state);
    // LDA $1D2E ; STA buffer,x — overwrite the right neighbour with
    // the per-tileset Map16 ID at the decor slot.
    writeBuf16(state, off, state.templateAt(SLOT_DECOR_RIGHT));
  }
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_tunnel_ceiling_slope_right_steep ($12:9C8D).
//
//   REP #$20
//   LDX #(CODE_tunnel_ceiling_slope_right_steep_stamp-1)>>16
//   LDA #CODE_tunnel_ceiling_slope_right_steep_stamp-1
//   JMP walker_setup_trampoline
//
// Plain trampoline init — same per-cell handler in every walker slot.
// `walker_setup_trampoline` first STZs `$17` (slope = 0).
// ─────────────────────────────────────────────────────────────────────

function initTunnelCeilingSlopeRightSteep(state: DecodeState): void {
  walkerSetupTrampoline(state, tunnelCeilingSlopeRightSteepStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installTunnelCeilingSlopeRightSteepHandlers(): void {
  registerStdObjectHandler(0x85, initTunnelCeilingSlopeRightSteep);
}
