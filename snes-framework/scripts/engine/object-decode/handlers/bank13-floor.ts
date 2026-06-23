// Bank13 floor-stamp handlers + their Bank12 init wrappers.
//
// Ports the most-stamped standard object init handlers covering flat
// terrain rendering. The bg_floor_* family is fully ported including
// the shape-aware fallbacks (page-anchor probes + bg_floor_subbody
// seam fix-up + bg_floor_random PRNG variant pool). Wall ($48) is a
// full carve-style port (side-merge probes, decor overlays, corner
// fix-ups, shadow epilogue). Tunnel ($14) is ported in its own file —
// see `./bank13-tunnel.ts` — and registers itself there.
//
// Covered handlers:
//   $01 init_floor_basic       (1281 stamps, 7.7%)  → bg_floor_left/right/random
//   $48 init_brick             (953 stamps,  5.7%)  → full carve-style port
//   $67 init_big_floor_or_jungle_canopy (595, 3.6%)  → re-uses floor stamps
//   $68 init_coin_object        (686 stamps,  4.1%)  → re-uses floor stamps

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerRun, walkerSetupTrampoline } from '../walker.ts';
import { TT } from '../template-slots.ts';
import { getMap16Above, getMap16Below, getMap16Left, getMap16Right } from '../fetch.ts';
import { prngNext, RNG_SITE } from '../prng.ts';
import {
  stampCell, readBuf16, writeBuf16, setProbeToCurrent, floorRowShiftUp,
  probeLeftTile, probeRightTile, probeAboveTile,
  DATA_floor_random_grass_8way_pool,
  SLOT_RND_POOL_0 as SLOT_1CAE, SLOT_RND_POOL_4 as SLOT_1CE8, SLOT_RND_POOL_5 as SLOT_1CEA,
  WIDE_FLOOR_REMAP_LEFT, WIDE_FLOOR_REMAP_RIGHT,
} from './_shared.ts';
import {
  wallHBelowProbe, wallHBelowProbeWide, wallHRightProbe, wallHBelowRightProbe,
  wallHRightProbeRandom,
} from './bank13-wall-h-block.ts';

// ─────────────────────────────────────────────────────────────────────
// Per-row tile tables for bg_floor_left / bg_floor_right.
//
// Cart asm:
//   DATA_floor0_tiles:
//     dw FloorRow0_LeftLo, FlatFloor_Row1LeftLo,
//        FlatFloor_Row2LeftLo, FlatFloor_Row3LeftLo
//   DATA_floor1_tiles:
//     dw FloorRow0_RightLo, FlatFloor_Row1RightLo,
//        FlatFloor_Row2RightLo, FlatFloor_Row3RightLo
//
// Entries are SLOT ADDRESSES (WRAM template-slot pointers). The
// caller derefences via state.templateAt() to get the actual Map16 ID.
// ─────────────────────────────────────────────────────────────────────

const DATA_floor0_tiles = [
  TT.FloorRow0_LeftLo,
  TT.FlatFloor_Row1LeftLo,
  TT.FlatFloor_Row2LeftLo,
  TT.FlatFloor_Row3LeftLo,
] as const;

const DATA_floor1_tiles = [
  TT.FloorRow0_RightLo,
  TT.FlatFloor_Row1RightLo,
  TT.FlatFloor_Row2RightLo,
  TT.FlatFloor_Row3RightLo,
] as const;

// Subbody fallback tables (CODE_bg_floor_subbody at $138073). The
// first entry is an unnamed row-0 alt within the flat-floor family
// ($001CE6 left / $001CE4 right) — used when the seam-detect path
// hits row 0; for other rows the table delegates to slope-cap +
// body slots. Caller dereferences via state.templateAt().
const DATA_subbody_left  = [
  0x001CE6,                            // row-0 left alt (no canonical TT slot name yet)
  TT.FlatFloor_SlopeCapLeftLo,
  TT.FlatFloor_Row2LeftLo,
  TT.FlatFloor_Row3LeftLo,
] as const;
const DATA_subbody_right = [
  0x001CE4,                            // row-0 right alt (no canonical TT slot name yet)
  TT.FlatFloor_SlopeCapRightLo,
  TT.FlatFloor_Row2RightLo,
  TT.FlatFloor_Row3RightLo,
] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_floor_subcheck (FLOR_SUB) at $138055
//
// Helper used by both bg_floor_left/right and bg_floor_subbody. If the
// caller is at row 2 (idx==2 / asm Y==4) and the tile above the cursor
// matches one of the slope-cap markers, bump idx by 1 so the caller
// picks the row-3 tile (which visually continues the descending slope
// onto the floor) instead of the row-2 tile.
// ─────────────────────────────────────────────────────────────────────

function floorSubcheck(state: DecodeState, idx: number): number {
  if (idx !== 2) return idx;
  // Cart: LDA $1B ; STA $0E ; JSL get_map16_above
  setProbeToCurrent(state);
  const aboveOff = getMap16Above(state);
  const aboveId = readBuf16(state, aboveOff);
  if (
    aboveId === state.templateAt(TT.FlatFloor_SlopeCapLeftLo) ||
    aboveId === state.templateAt(TT.FlatFloor_SlopeCapRightLo)
  ) {
    return 3;
  }
  return idx;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_bg_floor_subbody (BG_FLOORSB) at $138073
//
// Shape-aware fallback selector. Called when the current cell's
// Map16 ID is already in the flat-floor family (CMP $1C92 matched
// in bg_floor_left/right). Decides which alt slot to stamp based on
// column-parity byte ($28) and a tile self-check:
//
//   $28 == 0:  if $12 == NoSeamCheckB → AnchorB
//              else → DATA_subbody_left[Y]  (with floor_subcheck bump)
//   $28 != 0:  if $12 == NoSeamCheckA → AnchorA
//              else → DATA_subbody_right[Y] (with floor_subcheck bump)
//
// Returns the WRAM slot address the caller dereferences via templateAt.
// ─────────────────────────────────────────────────────────────────────

function bgFloorSubbody(state: DecodeState, idx: number): number {
  const col = state.zp28 & 0xff;
  const cur = state.zp12 & 0xffff;
  if (col === 0) {
    if (cur === state.templateAt(TT.FlatFloor_NoSeamCheckB)) {
      return TT.FlatFloor_NoSeamAnchorB;
    }
    const i = floorSubcheck(state, idx);
    return DATA_subbody_left[Math.min(i, DATA_subbody_left.length - 1)];
  } else {
    if (cur === state.templateAt(TT.FlatFloor_NoSeamCheckA)) {
      return TT.FlatFloor_NoSeamAnchorA;
    }
    const i = floorSubcheck(state, idx);
    return DATA_subbody_right[Math.min(i, DATA_subbody_right.length - 1)];
  }
}

// ─────────────────────────────────────────────────────────────────────
// bg_floor_left / bg_floor_right (CODE_bg_floor_left / CODE_bg_floor_right)
//
// Even-$28 cells dispatch to bg_floor_left; odd-$28 to bg_floor_right.
// Both branch on the current cell's page-byte: if it matches the
// FlatFloor_PageAnchor (= "we're stamping over an already-flat-floor
// neighbour"), take the bg_floor_subbody seam-fix path. Otherwise
// pick the plain row tile (with floor_subcheck slope-continuation
// bump at row 2).
// ─────────────────────────────────────────────────────────────────────

function bgFloorStamp(
  state: DecodeState,
  tileTable: readonly number[]
): void {
  const idx = state.zp2C & 0xff;
  const pageByte = state.zp12 & 0xff00;
  let slotAddr: number;
  if (pageByte === state.templateAt(TT.FlatFloor_PageAnchor)) {
    slotAddr = bgFloorSubbody(state, idx);
  } else {
    const bumped = floorSubcheck(state, idx);
    slotAddr = tileTable[Math.min(bumped, tileTable.length - 1)];
  }
  stampCell(state, state.templateAt(slotAddr));
}

const bgFloorLeft: PerCellHandler = (state) => bgFloorStamp(state, DATA_floor0_tiles);
const bgFloorRight: PerCellHandler = (state) => bgFloorStamp(state, DATA_floor1_tiles);

// ─────────────────────────────────────────────────────────────────────
// CODE_bg_floor_random (FLOOR_RND) at $1380B4
//
// Random-grass variant picker. Probes the current cell:
//   - if already a bound-marker (RndBoundA/B) or already within the
//     "no-seam range" (NoSeamCheckA..$1CE8), leave it alone (skip)
//   - if at the LAST row of the object and the current cell is a
//     specific row-1/3 marker or self-mark, do the adjacency-fix
//     branch (CODE_1380F9 → CODE_bg_floor_random_slope_cap): pick RndAdjMatch and
//     possibly mutate the left/right neighbours via probe walkers
//   - otherwise: maybe-fix neighbours (CODE_bg_floor_random_seam_fix), then pick from
//     the 8-entry random pool DATA_floor_random_grass_8way_pool indexed by prng & 7
//
// Pool entries:
//   $1CAE $1CB0 $1CB2 $1CB4   ← four grass-tuft variants (slope-cap region)
//   $1CE8 $1CEA              ← two row-3 alt variants
//   $1CAE $1CB0              ← duplicate of first two (so 4/8 chance of $1CAE/$1CB0)
// ─────────────────────────────────────────────────────────────────────

// Adjacency-fix slots used by CODE_bg_floor_random_seam_fix / CODE_bg_floor_random_slope_cap (specific to
// this file's bgFloorRandomNeighbourFix — not shared by other handlers).
const SLOT_BELOW_RIGHT_FIX = 0x001CC4; // FlatFloor_Row3RightLo
const SLOT_BELOW_LEFT_FIX  = 0x001CC2; // FlatFloor_Row3LeftLo

/** CODE_bg_floor_random_seam_fix — when picking a random tile, check the left neighbour:
 *  if it's the RndAdjMatch ("canonical center"), promote it to RndSelfMarkA
 *  and stamp Row3RightLo to the cell BELOW the current cell. Same for
 *  right neighbour with the mirror fix. The "below" stamp is below the
 *  CURRENT cell (the cart resets $0E to $1B between probes). */
function bgFloorRandomNeighbourFix(state: DecodeState): void {
  const adjMatchId  = state.templateAt(TT.FlatFloor_RndAdjMatch);
  const selfMarkAId = state.templateAt(TT.FlatFloor_RndSelfMarkA);
  const selfMarkBId = state.templateAt(TT.FlatFloor_RndSelfMarkB);
  const fixRightId  = state.templateAt(SLOT_BELOW_RIGHT_FIX);
  const fixLeftId   = state.templateAt(SLOT_BELOW_LEFT_FIX);

  // Left probe.
  setProbeToCurrent(state);
  const leftOff = getMap16Left(state);
  if (readBuf16(state, leftOff) === adjMatchId) {
    writeBuf16(state, leftOff, selfMarkAId);
    setProbeToCurrent(state);
    const belowOff = getMap16Below(state);
    writeBuf16(state, belowOff, fixRightId);
  }

  // Right probe (cart's CODE_probe_right_tile = inline get_map16_right
  // then read buffer).
  setProbeToCurrent(state);
  const rightOff = getMap16Right(state);
  if (readBuf16(state, rightOff) === adjMatchId) {
    writeBuf16(state, rightOff, selfMarkBId);
    setProbeToCurrent(state);
    const belowOff = getMap16Below(state);
    writeBuf16(state, belowOff, fixLeftId);
  }
}

// ─────────────────────────────────────────────────────────────────────
// CODE_bg_floor_random_slope_cap — the LAST-ROW grass cap.
//
// Runs when a floor's bottom row lands on an existing Row1 floor tile (i.e.
// the floor ends on top of another floor — e.g. a hanging pillar meeting the
// ground). Probes the LEFT neighbour, then the RIGHT; the FIRST one whose tile
// falls in the "grass-edge" range stamps a Row3 grass cap into the cell BELOW
// and returns the matching self-mark slot for the current cell. With no match,
// the current cell just gets RndAdjMatch (the canonical grass-centre tile). All
// three outcomes are grass — vs. the random dirt pick this branch replaces.
//
// Range test mirrors the cart's `CMP $1CE8/$1CEA (BEQ) ; CMP $1CAE (BCC out) ;
// CMP Row1LeftLo (BCS out)` — i.e. tile ∈ {$1CE8,$1CEA} OR $1CAE ≤ tile < Row1L.
// ─────────────────────────────────────────────────────────────────────

function inSlopeCapRange(state: DecodeState, tile: number): boolean {
  if (tile === state.templateAt(SLOT_1CE8) || tile === state.templateAt(SLOT_1CEA)) return true;
  const lo = state.templateAt(SLOT_1CAE);
  const hi = state.templateAt(TT.FlatFloor_Row1LeftLo);
  return tile >= lo && tile < hi;
}

/** Returns the template-slot address to stamp into the current (last-row) cell.
 *  Side effect: in the left/right match cases, writes a Row3 grass cap into the
 *  cell directly below. */
function bgFloorRandomSlopeCap(state: DecodeState): number {
  // Left probe (cart relies on $0E = $1B already set by the caller).
  setProbeToCurrent(state);
  if (inSlopeCapRange(state, readBuf16(state, getMap16Left(state)))) {
    setProbeToCurrent(state);
    writeBuf16(state, getMap16Below(state), state.templateAt(TT.FlatFloor_Row3LeftLo));
    return TT.FlatFloor_RndSelfMarkB;
  }
  // Right probe.
  setProbeToCurrent(state);
  if (inSlopeCapRange(state, readBuf16(state, getMap16Right(state)))) {
    setProbeToCurrent(state);
    writeBuf16(state, getMap16Below(state), state.templateAt(TT.FlatFloor_Row3RightLo));
    return TT.FlatFloor_RndSelfMarkA;
  }
  return TT.FlatFloor_RndAdjMatch;
}

export const bgFloorRandom: PerCellHandler = (state) => {
  const cur = state.zp12 & 0xffff;
  const rndBoundA = state.templateAt(TT.FlatFloor_RndBoundA);
  const rndBoundB = state.templateAt(TT.FlatFloor_RndBoundB);
  const noSeamA   = state.templateAt(TT.FlatFloor_NoSeamCheckA);

  // Early-out: if cell is already one of the bound markers, keep it.
  if (cur === rndBoundA || cur === rndBoundB) return;
  // "In no-seam range" check: $12 < NoSeamCheckA OR $12 < $1CE8 → no-op.
  // Asm: BCC = unsigned-less-than. Translation: skip the picker when
  // we're inside the known "already-handled" 16-bit value range.
  const slot1CE8Id = state.templateAt(SLOT_1CE8);
  if (cur >= noSeamA && cur < slot1CE8Id) return;

  // Cart `LDA $1B ; STA $0E` — probe coord for the last-row branch below.
  setProbeToCurrent(state);

  // LAST-ROW branch (cart: `LDA $2C ; INC ; CMP $2E ; BNE pick_random`). On the
  // floor's bottom row, the existing tile $12 decides:
  //   - Row1Left/Right  → grass slope-cap (CODE_1380F9): the floor is ending on
  //                       top of another floor; stamp a grass cap instead of dirt.
  //   - Row3Left/Right or RndSelfMarkA/B → keep the existing tile (already capped).
  //   - otherwise        → fall through to the random dirt pick.
  if (((state.zp2C + 1) & 0xff) === (state.zp2E & 0xff)) {
    if (cur === state.templateAt(TT.FlatFloor_Row1LeftLo) ||
        cur === state.templateAt(TT.FlatFloor_Row1RightLo)) {
      stampCell(state, state.templateAt(bgFloorRandomSlopeCap(state)));
      return;
    }
    if (cur === state.templateAt(TT.FlatFloor_Row3LeftLo) ||
        cur === state.templateAt(TT.FlatFloor_Row3RightLo) ||
        cur === state.templateAt(TT.FlatFloor_RndSelfMarkA) ||
        cur === state.templateAt(TT.FlatFloor_RndSelfMarkB)) {
      return; // already a cap/self-mark — leave it
    }
  }

  // pick_random (CODE_138105): neighbour seam-fix, then the 8-way pool pick.
  bgFloorRandomNeighbourFix(state);
  const idx = prngNext(state, RNG_SITE.floorRandomGrass8way) & 0x07;
  const slotAddr = DATA_floor_random_grass_8way_pool[idx];
  stampCell(state, state.templateAt(slotAddr));
};

// ─────────────────────────────────────────────────────────────────────
// Object $01 — CODE_init_floor_basic
//
// THE basic ground/ledge — the most common ground object. Variable
// width × height (from the object's size bytes; NOT a fixed 3-wide —
// the name's "3" is the $19 row-threshold, not a width).
//
// Per asm: bumps position up by 1 row, increments row extent, sets
// $19=3 (per-column row-threshold), wires left/right/random handlers.
// Even cols stamp the left-half surface/dirt tiles, odd cols the
// right-half (a 2-tile repeating surface texture). With $19=3 the
// random handler only fires for objects taller than 3 rows — most
// floors are 1-2 tall, so it rarely runs.
// ─────────────────────────────────────────────────────────────────────

function initFloorBasic(state: DecodeState): void {
  // Cart CODE_floor_row_shift_up: origin up 1 row + INC $2E.
  floorRowShiftUp(state);
  // Wire handlers + run walker with $19=3 row threshold.
  state.zp17 = 0; // slope = 0
  walkerRun(
    state,
    /*oddCol=*/  bgFloorRight,
    /*evenCol=*/ bgFloorLeft,
    /*row=*/     bgFloorRandom,
    /*rowsEnd=*/ 3
  );
}

// ─────────────────────────────────────────────────────────────────────
// Object $67 — CODE_init_big_floor_or_jungle_canopy ($12:9A4D)
//
// Tileset-conditional dispatch on BG1TYP:
//   $0C (jungle)  → CODE_jungle_canopy_random  ($13:C6A5)
//   anything else → CODE_big_floor_stamp       ($13:C2AF)
//
// Both use the walker trampoline (one handler for all slots). The
// jungle path is a tiny PRNG-foliage picker (no template-slot reads).
// The non-jungle "big floor" path is ~9 routines including 8 corner /
// edge fix-ups that probe the WideFloorPage_Anchor template family —
// not yet ported; we stamp the base PRNG-picked tile only and skip
// the fix-ups (cells at object boundaries will show seams).
// ─────────────────────────────────────────────────────────────────────

/** Jungle canopy (CODE_jungle_canopy_random, $13:C6A5).
 *  6-bit PRNG roll: if < $0B (11/64 ≈ 17%) pick from contiguous
 *  Map16 IDs $79BB..$79C5 (11 foliage variants); else stamp the
 *  fallback $79E0 (53/64 ≈ 83% — most cells get the "boring" tile). */
const jungleCanopyRandom: PerCellHandler = (state) => {
  const roll = prngNext(state, RNG_SITE.jungleCanopy) & 0x3f;
  const id = roll < 0x0b ? 0x79BB + roll : 0x79E0;
  stampCell(state, id);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_big_floor_stamp ($13:C2AF) — non-jungle $67 cell stamp.
//
// 1. Base PRNG pick into the CURRENT cell (CODE_floor_random_8way_pick,
//    same 8-entry pool as bg_floor_random).
// 2. Up to 8 edge/corner fix-ups, each gated on the cell's position in
//    the object rectangle ($28 col / $2A width, $2C row / $2E height):
//      top_left  : col==0 && row==0          right    : col==last
//      left      : col==0                     top_right: row==0  && col==last
//      bottom_left: col==0 && row==last       bottom_right: col==last && row==last
//      top_middle: row==0                     bottom_middle: row==last
//
// Each fix-up PROBES a neighbour cell (CODE_get_map16_*) and — if that
// neighbour is in the WideFloorPage template family (page byte ==
// WideFloorPage_Anchor, $1D00 for tileset $01) — REWRITES that neighbour
// (a PutrTile / neighbour-write) to a seam-blend variant. The neighbour's
// low byte (family sub-id) indexes a per-direction 46-entry remap table
// (DATA_floor_left_neighbour_remap/_20F/_311/_36D/_3C9/_425/_481/_4DD); the entry is a family
// slot index → Map16 ID = WideFloorPage_Anchor + idx (templateAt). This
// is what draws the rounded decorated outline where a big-floor abuts a
// neighbouring wide-floor object (e.g. a $14 tunnel); without it the seam
// renders as a flat cut. Object order matters — the neighbour must already
// be stamped, which holds because the abutting object precedes $67 in the
// stream.
//
// Remap tables hold family slot indices (0..45), transcribed from ROM by
// tmp/gen-bigfloor-tables.ts. Entry N maps sub-id N → slot index; mostly
// identity, with deliberate remaps at the seam sub-ids. The named cart
// tables are 46 entries; a sub-id >= 46 (a $1D2E..$1D31 family slot, never
// stamped as a big-floor neighbour in shipped levels) leaves the neighbour
// unchanged rather than reading the cart's ROM-bleed overrun.
// ─────────────────────────────────────────────────────────────────────

const REMAP_TOP_LEFT = [   // DATA_big_floor_remap_top_left
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 6, 15,
  16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
  32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45,
] as const;
// REMAP_LEFT (DATA_floor_left_neighbour_remap) + REMAP_RIGHT (DATA_floor_above_neighbour_remap) are shared with the
// wide-floor seam helpers — imported from _shared.ts as WIDE_FLOOR_REMAP_LEFT
// / WIDE_FLOOR_REMAP_RIGHT (the big-floor edge fix-ups probe-and-rewrite a
// neighbour; the wide-floor helpers remap a cell in place — same table data).
const REMAP_BOTTOM_LEFT = [ // DATA_big_floor_remap_bottom_left
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 1, 30, 31,
  32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45,
] as const;
const REMAP_TOP_MIDDLE = [  // DATA_big_floor_remap_top_middle
  45, 1, 3, 3, 4, 43, 42, 7, 7, 4, 3, 11, 16, 17, 42, 43,
  16, 17, 11, 19, 20, 21, 22, 23, 24, 25, 26, 27, 29, 29, 30, 31,
  32, 33, 34, 35, 36, 37, 38, 40, 40, 7, 42, 43, 44, 45,
] as const;
const REMAP_BOTTOM_MIDDLE = [ // DATA_big_floor_remap_bottom_middle
  44, 3, 2, 3, 42, 5, 6, 43, 5, 6, 10, 3, 14, 15, 14, 15,
  42, 43, 10, 19, 20, 21, 22, 23, 24, 25, 26, 27, 10, 3, 10, 10,
  32, 33, 34, 35, 36, 37, 38, 15, 43, 15, 42, 43, 44, 45,
] as const;
const REMAP_TOP_RIGHT = [   // DATA_big_floor_remap_top_right
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 2, 11, 12, 13, 14, 5,
  16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
  32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45,
] as const;
const REMAP_BOTTOM_RIGHT = [ // DATA_big_floor_remap_bottom_right
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 29, 12, 41, 14, 15,
  16, 7, 28, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
  32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45,
] as const;

/** Set the neighbour-probe coord ($0E) to one cell LEFT of the current
 *  walker cell (cart `AND #$F0F0 ; … (sub-X)-1`), keeping the Y nibbles.
 *  Borrow from sub-X ripples into screen-X under the `& $0F0F` mask. */
function setProbeColLeft(state: DecodeState): void {
  const w = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  const composed = ((w & 0xf0f0) | (((w & 0x0f0f) - 1) & 0x0f0f)) & 0xffff;
  state.zp0E = composed;
  state.zp0F = (composed >>> 8) & 0xff;
}

/** Set the neighbour-probe coord ($0E) to one cell RIGHT of the current
 *  walker cell (cart `(sub-X | $00F0)+1`), keeping the Y nibbles. */
function setProbeColRight(state: DecodeState): void {
  const w = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  const composed = ((w & 0xf0f0) | ((((w & 0x0f0f) | 0x00f0) + 1) & 0x0f0f)) & 0xffff;
  state.zp0E = composed;
  state.zp0F = (composed >>> 8) & 0xff;
}

// The 8 neighbour probes — each sets the probe coord then returns the
// neighbour's LevelDataBuffer byte offset (the cart's X after get_map16_*).
const probeAbove      = (s: DecodeState): number => { setProbeToCurrent(s); return getMap16Above(s); };
const probeBelow      = (s: DecodeState): number => { setProbeToCurrent(s); return getMap16Below(s); };
const probeLeftOff    = (s: DecodeState): number => { setProbeToCurrent(s); return getMap16Left(s); };
const probeRightOff   = (s: DecodeState): number => { setProbeToCurrent(s); return getMap16Right(s); };
const probeAboveLeft  = (s: DecodeState): number => { setProbeColLeft(s);  return getMap16Above(s); };
const probeBelowLeft  = (s: DecodeState): number => { setProbeColLeft(s);  return getMap16Below(s); };
const probeAboveRight = (s: DecodeState): number => { setProbeColRight(s); return getMap16Above(s); };
const probeBelowRight = (s: DecodeState): number => { setProbeColRight(s); return getMap16Below(s); };

/** One big-floor edge fix-up: probe a neighbour; if it's a WideFloorPage
 *  tile, rewrite it to the table's seam-blend variant. */
function bigFloorEdgeFix(
  state: DecodeState,
  probe: (s: DecodeState) => number,
  table: readonly number[]
): void {
  const anchor = state.templateAt(TT.WideFloorPage_Anchor);
  const off = probe(state);
  const neighbour = readBuf16(state, off);
  if ((neighbour & 0xff00) !== anchor) return; // not a wide-floor-page tile
  const subId = neighbour & 0xff;
  const idx = table[subId];
  if (idx === undefined) return; // beyond named 46-entry table — leave unchanged
  writeBuf16(state, off, state.templateAt(TT.WideFloorPage_Anchor + idx * 2));
}

/** Big-floor non-jungle per-cell stamp (CODE_big_floor_stamp, $13:C2AF):
 *  base PRNG pick, then the position-gated neighbour seam fix-ups. */
const bigFloorStamp: PerCellHandler = (state) => {
  // Base pick into the current cell (CODE_floor_random_8way_pick, shared $13:C163).
  const idx = prngNext(state, RNG_SITE.floorRandom8wayPick) & 0x07;
  stampCell(state, state.templateAt(DATA_floor_random_grass_8way_pool[idx]));

  const col = state.zp28 & 0xffff;
  const width = state.zp2A & 0xffff;
  const row = state.zp2C & 0xff;
  const height = state.zp2E & 0xffff;
  const atLeft = col === 0;
  const atRight = ((col + 1) & 0xffff) === width;
  const atTop = row === 0;
  const atBottom = ((row + 1) & 0xffff) === height;

  if (atLeft && atTop)     bigFloorEdgeFix(state, probeAboveLeft,  REMAP_TOP_LEFT);
  if (atLeft)              bigFloorEdgeFix(state, probeLeftOff,     WIDE_FLOOR_REMAP_LEFT);
  if (atLeft && atBottom)  bigFloorEdgeFix(state, probeBelowLeft,  REMAP_BOTTOM_LEFT);
  if (atTop)               bigFloorEdgeFix(state, probeAbove,      REMAP_TOP_MIDDLE);
  if (atBottom)            bigFloorEdgeFix(state, probeBelow,      REMAP_BOTTOM_MIDDLE);
  if (atTop && atRight)    bigFloorEdgeFix(state, probeAboveRight, REMAP_TOP_RIGHT);
  if (atRight)             bigFloorEdgeFix(state, probeRightOff,   WIDE_FLOOR_REMAP_RIGHT);
  if (atRight && atBottom) bigFloorEdgeFix(state, probeBelowRight, REMAP_BOTTOM_RIGHT);
};

function initBigFloorOrCanopy(state: DecodeState): void {
  const bg1tileset = state.header[1] & 0x0f;
  const handler = bg1tileset === 0x0c ? jungleCanopyRandom : bigFloorStamp;
  walkerSetupTrampoline(state, handler);
}

// ─────────────────────────────────────────────────────────────────────
// Object $68 (Coin) — CODE_init_coin_object ($12:9A68) [also $8A, !-switch
// coin]. The synced asm names this "coin", but the per-cell mechanic is the
// alternate-state-ground stamp it shares: pick $6000 (present) vs $7400
// (collected) from $15 bit 1, gated by an item-memory probe.
//
// Walker-trampoline with cell handler CODE_stamp_coin ($13:C6C9):
//   - Calls CODE_item_memory_bit_lookup ("has this coin been
//     collected?"). If set → skip (don't stamp; leave previous tile).
//   - If clear → stamp DATA_alt_state_ground_tiles[$15 & $02]:
//        $15 bit 1 == 0 → Map16 $6000  (present)
//        $15 bit 1 == 1 → Map16 $7400  (collected)
//
// For static render we assume the flag is 0 (initial / uncollected state),
// so we always stamp.
// ─────────────────────────────────────────────────────────────────────

const COIN_TILES = [0x6000, 0x7400] as const;

// Object $68/$8A per-cell stamp (cart CODE_stamp_coin, $13:C6C9). The cart gates
// the stamp on CODE_item_memory_bit_lookup: it stamps the coin ONLY if the cell's
// collected-items bit is CLEAR in the SRAM item-memory bitmap ($03C0/$0440/$04C0/
// $0540, selected by the level header's ItemMemorySetting). We DELIBERATELY omit
// that gate: the editor shows the level's DESIGN (all coins present), which also
// equals a fresh-save load (all bits zero). Modelling the gate would make a static
// decoder depend on save/playthrough state — wrong for an editor. (A live capture
// reached via gameplay can therefore be missing an already-collected coin; that's
// a capture artifact, not a decode bug — see notes-bg1-trace-rng-parity.md §7.)
const coinObjectStamp: PerCellHandler = (state) => {
  const slot = (state.zp15 & 0x02) !== 0 ? 1 : 0;
  stampCell(state, COIN_TILES[slot]);
};

// Merge: object IDs 0x68, 0x8A share this handler.
function initCoinObject(state: DecodeState): void {
  walkerSetupTrampoline(state, coinObjectStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Object $48 — CODE_init_brick
//
// Two stamp routines, $22 = top-edge (CODE_stamp_wall_thick_top,
// $13:A753), $1F + $25 = body (CODE_stamp_wall_thick_bot, $13:A811).
// $19=$7FFF so row handler never fires; col-parity dispatch determines
// top vs body — alternating columns get top vs body stamper.
//
// Tile picks are literal Map16 IDs (NOT template slots — wall has its
// own dedicated tile range):
//   DATA_wall_thick_top_tiles = [$015A, $015B, $0151]    (top stamper main table)
//   DATA_wall_thick_bottom_tiles = [$015B, $015A]            (bot stamper main table;
//                                             DATA_wall_thick_left_match=$0152 sits
//                                             immediately after so a
//                                             Y=4 read off the end
//                                             yields $0152)
//   DATA_wall_thick_left_decor_tiles = [$01A2, $01A4, $01A4]    (left grass-decor overlay)
//   DATA_wall_thick_right_decor_tiles = [$01A1, $01A3, $01A3]    (right grass-decor overlay)
//   plus $0152 for the width=1 special case in the top stamper.
//
// Y picker (CODE_wall_thick_index_helper, wall_thick_index_helper): Y = (parity1 XOR
// parity2) * 2 where
//   parity1 = ($1B + $28) & 1                  // abs cell-X parity
//   parity2 = ((($1B & $10) >> 4) + $2C) & 1   // sub-Y bit XOR row counter
// gives Y = 0 or 2 for normal (width > 1) walls. Y stays at the
// default 4 only when width == 1 — that path uses $0151 (top) or
// $0152 (bot, read off the end of DATA_wall_thick_bottom_tiles into DATA_wall_thick_left_match).
//
// Full carve-style port: side-merge probes (CODE_wall_thick_left_side/CODE_wall_thick_right_side),
// corner probe (CODE_wall_thick_corner_probe), grass-decor overlays (CODE_wall_thick_left_decor_probe/
// CODE_wall_thick_right_decor_probe), above-grass overlay (CODE_wall_thick_above_grass_probe), and the shadow
// epilogue (CODE_wall_thick_neighbour_epilogue) calling into wall_h_block probe helpers.
// ─────────────────────────────────────────────────────────────────────

const WALL_TOP_TILES = [0x015A, 0x015B, 0x0151] as const;     // DATA_wall_thick_top_tiles
// DATA_wall_thick_bottom_tiles is 2 entries in the cart; DATA_wall_thick_left_match=$0152 sits
// contiguously after so a Y=4 read off the end yields $0152. Model
// here as a 3-entry table so [0]/[1]/[2] all index in-bounds.
const WALL_BOT_TILES = [0x015B, 0x015A, 0x0152] as const;
const WALL_WIDTH1_TOP = 0x0152;                                // top stamper CODE_13A767 width-1 path
const WALL_LEFT_DECOR_TILES  = [0x01A2, 0x01A4, 0x01A4] as const; // DATA_wall_thick_left_decor_tiles
const WALL_RIGHT_DECOR_TILES = [0x01A1, 0x01A3, 0x01A3] as const; // DATA_wall_thick_right_decor_tiles
const WALL_LEFT_MATCH = 0x0152;                                // DATA_wall_thick_left_match

/** Cart CODE_wall_thick_index_helper — wall_thick_index_helper. Returns Y in {0, 2}. */
function wallParityY(state: DecodeState): number {
  const parity1 = (state.zp1B + state.zp28) & 1;
  const parity2 = (((state.zp1B & 0x10) >>> 4) + state.zp2C) & 1;
  return (parity1 ^ parity2) << 1;
}

/** CODE_wall_thick_left_side ($13:A79A).
 *  Name is misleading — this runs on the LEFT-side dispatch path but
 *  probes the RIGHT neighbour. Only fires on rightmost col (col+1==ext).
 *  Probes right tile; if it's $015B (DATA_wall_thick_top_tiles+2) → no-op (Y stays);
 *  if it's $0151 (DATA_wall_thick_top_tiles+4) → rewrite right neighbour to $015B and
 *  keep Y; else reset Y to 4 (which then makes the main top-stamper
 *  fall into the width-1 $0152 substitution).
 *  Returns the new Y (0/2 or 4). */
function wallThickLeftSide(state: DecodeState, y: number): number {
  const col = state.zp28 & 0xff;
  const colExt = state.zp2A & 0xff;
  if (((col + 1) & 0xff) !== colExt) return y;
  setProbeToCurrent(state);
  const rightOff = getMap16Right(state);
  const rightTile = readBuf16(state, rightOff);
  if (rightTile === WALL_TOP_TILES[1]) return y;          // $015B → exit
  if (rightTile === WALL_TOP_TILES[2]) {                  // $0151 → rewrite
    writeBuf16(state, rightOff, WALL_TOP_TILES[1]);
    return y;
  }
  return 4;                                                // reset Y
}

/** CODE_wall_thick_right_side ($13:A7BC).
 *  Mirror — runs on RIGHT-side dispatch path but probes the LEFT
 *  neighbour. Only fires on col==0. If left tile == $0152 (the
 *  width-1 substitution / DATA_wall_thick_left_match), rewrite left to $015A
 *  (DATA_wall_thick_top_tiles+0) and keep Y; else reset Y to 4. */
function wallThickRightSide(state: DecodeState, y: number): number {
  const col = state.zp28 & 0xff;
  if (col !== 0) return y;
  setProbeToCurrent(state);
  const leftOff = getMap16Left(state);
  const leftTile = readBuf16(state, leftOff);
  if (leftTile === WALL_LEFT_MATCH) {
    writeBuf16(state, leftOff, WALL_TOP_TILES[0]);
    return y;
  }
  return 4;
}

/** Cart DATA_wall_thick_side_handlers — 2-entry handler table dispatched via the
 *  helper's output (X = 0 → left_side, X = 2 → right_side). */
function wallThickDispatchSide(state: DecodeState, x: number, y: number): number {
  if (x === 0) return wallThickLeftSide(state, y);
  return wallThickRightSide(state, y);
}

/** CODE_wall_thick_left_decor_probe ($13:A7E0).
 *  Probes the LEFT neighbour for grass/dirt overlay sentinel ranges;
 *  on match, stamps WALL_LEFT_DECOR_TILES[y/2] into the CURRENT cell
 *  (asm `LDX $1D` resets to current). Sentinels:
 *    $002E..$0032, $0084..$008D, $7E00, $7E01. */
function wallThickLeftDecorProbe(state: DecodeState, y: number): void {
  const leftTile = probeLeftTile(state);
  const hit =
    (leftTile >= 0x002E && leftTile < 0x0033) ||
    (leftTile >= 0x0084 && leftTile < 0x008E) ||
    leftTile === 0x7E00 || leftTile === 0x7E01;
  if (!hit) return;
  stampCell(state, WALL_LEFT_DECOR_TILES[y >>> 1]!);
}

/** CODE_wall_thick_right_decor_probe ($13:A8AB).
 *  Mirror of left_decor — only fires on rightmost col (col+1 == ext)
 *  and probes the RIGHT neighbour against the same sentinel ranges.
 *  On match, stamps WALL_RIGHT_DECOR_TILES[y/2] into the CURRENT cell. */
function wallThickRightDecorProbe(state: DecodeState, y: number): void {
  const col = state.zp28 & 0xff;
  const colExt = state.zp2A & 0xff;
  if (((col + 1) & 0xff) !== colExt) return;
  const rightTile = probeRightTile(state);
  const hit =
    (rightTile >= 0x002E && rightTile < 0x0033) ||
    (rightTile >= 0x0084 && rightTile < 0x008E) ||
    rightTile === 0x7E00 || rightTile === 0x7E01;
  if (!hit) return;
  stampCell(state, WALL_RIGHT_DECOR_TILES[y >>> 1]!);
}

/** CODE_wall_thick_corner_probe ($13:A866).
 *  Bot-stamper rightmost-column corner: probes the RIGHT neighbour;
 *  if it's $015B → exit (Y kept); if it's $0152 → rewrite right to
 *  $015B (DATA_wall_thick_bottom_tiles+0) and exit; else reset Y to 4. */
function wallThickCornerProbe(state: DecodeState, y: number): number {
  const col = state.zp28 & 0xff;
  const colExt = state.zp2A & 0xff;
  if (((col + 1) & 0xff) !== colExt) return y;
  setProbeToCurrent(state);
  const rightOff = getMap16Right(state);
  const rightTile = readBuf16(state, rightOff);
  if (rightTile === WALL_BOT_TILES[0]) return y;          // $015B → exit
  if (rightTile === WALL_LEFT_MATCH) {                    // $0152 → rewrite
    writeBuf16(state, rightOff, WALL_BOT_TILES[0]);
    return y;
  }
  return 4;
}

/** CODE_wall_thick_above_grass_probe ($13:A8DD).
 *  Row-0 only. Probes the ABOVE neighbour; if it's $7E00 or $7E01,
 *  read the CURRENT cell's stamped tile T, replace it with
 *  T - $015A + $01A5 (translates a $015x wall-top into the matching
 *  $01Ax grass-blended variant). */
function wallThickAboveGrassProbe(state: DecodeState): void {
  if ((state.zp2C & 0xff) !== 0) return;
  const aboveTile = probeAboveTile(state);
  if (aboveTile !== 0x7E00 && aboveTile !== 0x7E01) return;
  // LDX $1D ; LDA buffer,x — read current cell's just-stamped tile.
  const curOff = state.zp1D & 0x7fff;
  const cur = readBuf16(state, curOff);
  const translated = (cur - 0x015A + 0x01A5) & 0xffff;
  writeBuf16(state, curOff, translated);
}

/** CODE_wall_thick_neighbour_epilogue ($13:A833).
 *  Shared shadow-overlay epilogue. Runs the wall_h_block_* probes
 *  conditionally on which edge the current cell sits on:
 *    if row+1 == ext (bottom row):
 *      col == 0  → wallHBelowProbe
 *      col != 0  → wallHBelowProbeWide
 *    if col+1 == ext (rightmost col):
 *      row == 0  → wallHRightProbe
 *      row != 0  → wallHRightProbeRandom
 *      if row+1 == ext (bottom-right corner): wallHBelowRightProbe. */
export function wallThickNeighbourEpilogue(state: DecodeState): void {
  const row = state.zp2C & 0xff;
  const rowExt = state.zp2E & 0xff;
  const col = state.zp28 & 0xff;
  const colExt = state.zp2A & 0xff;

  if (((row + 1) & 0xff) === rowExt) {
    if (col === 0) wallHBelowProbe(state);
    else           wallHBelowProbeWide(state);
  }
  if (((col + 1) & 0xff) === colExt) {
    if (row === 0) wallHRightProbe(state);
    else           wallHRightProbeRandom(state);
    if (((row + 1) & 0xff) === rowExt) wallHBelowRightProbe(state);
  }
}

const bgWallTop: PerCellHandler = (state) => {
  // CODE_stamp_wall_thick_top ($13:A753). REP #$30 ; Y = 4.
  let y = 4;
  const col = state.zp28 & 0xff;
  const colExt = state.zp2A & 0xff;
  const isWidth1 = ((colExt - 1) & 0xff) === 0;

  if (!isWidth1) {
    // JSR wall_thick_index_helper → X/Y in {0/0, 2/2}. The setProbeToCurrent
    // here mirrors `LDA $1B ; STA $0E` (cart sets just the low byte,
    // but our 16-bit composite covers it cleanly).
    const x = wallParityY(state);
    y = x;
    setProbeToCurrent(state);
    y = wallThickDispatchSide(state, x, y);
  }

  // CODE_13A767 — main top-tile stamp.
  // Asm: width-1 fast path checks col+1==ext AND Y==4. With Y reset
  // logic above, this can also fire on non-width-1 walls when the
  // side-merge probe reset Y. Pick $0152 in that case; else use
  // DATA_wall_thick_top_tiles[y/2].
  let tile: number;
  if (((col + 1) & 0xff) === colExt && y === 4) {
    tile = WALL_WIDTH1_TOP;
  } else {
    tile = WALL_TOP_TILES[Math.min(y >>> 1, WALL_TOP_TILES.length - 1)]!;
  }
  stampCell(state, tile);

  // Decor + epilogue.
  if (col === 0) {
    wallThickLeftDecorProbe(state, y);
  } else if (((col + 1) & 0xff) === colExt) {
    // Cart: DEY DEY (y -= 2) before calling right_decor_probe — so a
    // width>1 rightmost col with y=2 reads decor[0], with y=4 reads
    // decor[1], etc.
    const decorY = (y - 2) & 0xff;
    wallThickRightDecorProbe(state, decorY);
  }
  wallThickAboveGrassProbe(state);
  wallThickNeighbourEpilogue(state);
};

const bgWallBody: PerCellHandler = (state) => {
  // CODE_stamp_wall_thick_bot ($13:A811). REP #$30 ; Y = 4.
  let y = 4;
  const col = state.zp28 & 0xff;
  const colExt = state.zp2A & 0xff;
  const isWidth1 = ((colExt - 1) & 0xff) === 0;

  if (!isWidth1) {
    const x = wallParityY(state);
    y = x;
    if (x !== 0) {
      // X == 2 → wall_thick_corner_probe (no setProbeToCurrent
      // prelude; corner_probe does its own).
      y = wallThickCornerProbe(state, y);
    }
    // X == 0 path skips both side-dispatch and corner_probe.
  }

  // Main stamp — DATA_wall_thick_bottom_tiles[y/2]; y=4 reads off-end to DATA_wall_thick_left_match=$0152.
  const tile = WALL_BOT_TILES[Math.min(y >>> 1, WALL_BOT_TILES.length - 1)]!;
  stampCell(state, tile);

  wallThickRightDecorProbe(state, y);
  wallThickAboveGrassProbe(state);
  wallThickNeighbourEpilogue(state);
};

function initBrick(state: DecodeState): void {
  // Walker with $19=$7FFF means row handler never fires; only
  // col-parity dispatch. Even col → top, odd col → body.
  state.zp17 = 0;
  walkerRun(state, bgWallBody, bgWallTop, bgWallBody, 0x7fff);
}

// ─────────────────────────────────────────────────────────────────────
// Registration
//
// Object $14 (init_tunnel) registers itself via
// `installBank13TunnelHandler()` in `./bank13-tunnel.ts` — full
// carve-style port lives there.
// ─────────────────────────────────────────────────────────────────────

export function installBank13FloorHandlers(): void {
  registerStdObjectHandler(0x01, initFloorBasic);
  registerStdObjectHandler(0x48, initBrick);
  registerStdObjectHandler(0x67, initBigFloorOrCanopy);
  // Merge: $68 (Coin) + $8A (!-switch Coin) share CODE_init_coin_object /
  // CODE_stamp_coin (Bank12.asm:4212). Stamp picks $6000 (present) vs $7400
  // (collected) by `$15 & 2`: $68 → bit 1 = 0 → $6000, $8A → bit 1 = 1 → $7400.
  registerStdObjectHandler(0x68, initCoinObject);
  registerStdObjectHandler(0x8A, initCoinObject);
}
