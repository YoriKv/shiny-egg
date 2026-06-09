// Bank13 thick-post-overlay stamp handler + Bank12 init wrapper.
//
// Object $58 dispatches to `CODE_init_thick_post_overlay` ($12:987A,
// Bank12.asm:3809) — a near-bare walker-trampoline that additionally
// zeroes $A1 (the autotile-overlay "previously-overlaid" flag). Per-cell
// dispatch lands on `CODE_stamp_thick_post_overlay` ($13:BBA6,
// Bank13.asm:6873) which 3-way splits on column position (left edge /
// interior / right edge) via `DATA_thick_post_sub_handlers`:
//
//   col == 0                  → CODE_thick_post_left_edge      ($13:BBC4)
//   col + 1 == col_extent     → CODE_thick_post_right_edge     ($13:BCD4)
//   else                      → CODE_thick_post_interior       ($13:BC73)
//
// All three sub-handlers consult $A1 as a "previously-overlaid" sticky
// flag — once a row encounters a floor-below-style overlay, subsequent
// cells in that row early-exit via the high-bit-set check
// (`LDA $A1 ; BPL body / JMP exit`). The interior path also clears $A1
// at the top of each call.
//
//
// Asm landmarks (full closure in /tmp/thick_post.s):
//   CODE_init_thick_post_overlay  $12:987A — Bank12.asm:3809
//   CODE_stamp_thick_post_overlay $13:BBA6 — Bank13.asm:6873
//   CODE_thick_post_left_edge     $13:BBC4 — Bank13.asm:6897
//   CODE_thick_post_interior      $13:BC73 — Bank13.asm:6986
//   CODE_thick_post_right_edge    $13:BCD4 — Bank13.asm:7025
//   DATA_thick_post_int_match     $13:BCA4 — 12-entry tile-ID match list
//   DATA_thick_post_int_replace   $13:BCBC — 12-entry replacement slots
//
// Init mutates no walker-relevant DP fields (spec DP-diff: all "no") —
// the orientation byte $15 IS the std-obj ID ($58), set by the Bank10
// dispatcher. The only non-walker DP write is `STZ $A1` (reset autotile
// overlay state at object start).

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { TT } from '../template-slots.ts';
import { getMap16Below } from '../fetch.ts';
import { floorEdgeRandomSide } from './bank13-floor-edge-or-wall.ts';
import {
  probeLeftTile,
  probeRightTile,
  readBuf16,
  setProbeToCurrent,
  stampCell,
} from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Unnamed template-slot addresses used by the thick-post family.
// None have canonical TT.* names yet; promote in a parent sweep if a
// sibling handler references the same slots.
// ─────────────────────────────────────────────────────────────────────

// Flat-floor anchors used by the left/right-edge below-probe early-out.
// $1CE8/$1CEA are the "skip overlay" sentinels; the range $1CAE..RndSelfMarkA
// brackets the random-grass center tiles which also force the "no overlay"
// path (asm: CMP $1CAE / BCC ; CMP RndSelfMarkA / BCS).
const SLOT_ThickPost_BelowSkipA       = 0x001CE8;
const SLOT_ThickPost_BelowSkipB       = 0x001CEA;
const SLOT_ThickPost_BelowRangeLo     = 0x001CAE;

// Tile slots stamped in the various sub-paths.
const SLOT_ThickPost_TopLeftOverlay   = 0x001CE6; // left-edge row>0, probe-right matches floor-row family
const SLOT_ThickPost_TopRightOverlay  = 0x001CE4; // right-edge row>0, probe-left  matches floor-row family
const SLOT_ThickPost_LeftBottom       = 0x001CF6; // left-edge row=0, below-probe matches sentinel
const SLOT_ThickPost_RightBottom      = 0x001CF4; // right-edge row=0, below-probe matches sentinel
const SLOT_ThickPost_TopInterior      = 0x001CF2; // row=0 default body
const SLOT_ThickPost_TopLeftBody      = 0x001CF0; // left-edge row=0 fallback body
const SLOT_ThickPost_TopRightBody     = 0x001CFA; // right-edge row=0 fallback body
const SLOT_ThickPost_TopExtraA        = 0x001CF8; // additional row=0 "already overlaid" sentinel
// Floor-overlap autotile slots ($1C28 / $1BF6) — the asm walks two
// "convert me to this" mappings on the top-row floor overlap path.
const SLOT_ThickPost_FloorOverlapA    = 0x001C28;
const SLOT_ThickPost_FloorOverlapB    = 0x001BF6;

// The left/right edges of $58 invoke the shared CODE_floor_edge_random_side
// ($13:8231, exported from bank13-floor-edge-or-wall.ts) with $15 forced to the
// side index (1 = left side, 0 = right side); see the call sites in
// thickPostLeftEdge / thickPostRightEdge.

// ─────────────────────────────────────────────────────────────────────
// DATA_thick_post_int_match / DATA_thick_post_int_replace (Bank13.asm:7015 / 7020)
//
// 12-entry parallel lists used by CODE_thick_post_interior on the top
// row ($2C == 0) when $12 ≠ $1C28: scan the match list for $12; on hit,
// dereference the matching replacement slot via templateAt + stamp. On
// fall-through (no match), stamp $1CF2.
// ─────────────────────────────────────────────────────────────────────

const DATA_thick_post_int_match: ReadonlyArray<number> = [
  0x001BE2, 0x001BE6, 0x001BE8, 0x001BEE,
  0x001BF6, 0x001C00, 0x001C02, 0x001C1A,
  0x001C30, 0x001C34, 0x001C36, 0x001C3A,
];

const DATA_thick_post_int_replace: ReadonlyArray<number> = [
  0x001C28, 0x001C28, 0x001C26, 0x001C2A,
  0x001C28, 0x001C26, 0x001C2A, 0x001C28,
  0x001C2A, 0x001C26, 0x001C2A, 0x001C2C,
];

// `probeLeftTile` / `probeRightTile` (cart `CODE_probe_left_tile` $13:FD54
// / `CODE_probe_right_tile` $13:FD61) are imported from `_shared.ts`.

// ─────────────────────────────────────────────────────────────────────
// CODE_thick_post_left_edge ($13:BBC4, Bank13.asm:6897)
//
// Asm trace (matches spec cell 0 with empty-buffer neighbour):
//
//   LDA $A1 ; BPL body / JMP exit       ; $A1 high-bit set ⇒ already done, skip
// body:
//   LDA $A1 ; BNE seal                  ; $A1 set (lo bit) ⇒ jump straight to seal/floor-edge
//   probe below; if  == $1CE8 / $1CEA   ⇒ seal (top-row autotile-overlay)
//   if < $1CAE OR >= RndSelfMarkA       ⇒ jump to CODE_13BC2A (non-floor path)
//   ; falls into "seal" (above probe matched a floor-below template)
// seal (CODE_13BBEF):
//   $A1 = $0001
//   if $2C == 0:                          ⇒ stamp $1CF6 + exit
//   else:
//     $15 = 1 (side-left for floor_edge_random_side)
//     JSL floor_edge_random_side          (advances PRNG; side-bit picks pool slot)
//     probe right; if in {$7D, $7E, FloorRow0_LeftLo, FloorRow0_RightLo}
//       ⇒ overwrite current cell with $1CE6 (top-overlay)
//     exit
//
// CODE_13BC2A (non-floor below):
//   if $2C != 0                           ⇒ exit (no stamp; cell keeps current value)
//   ; $2C == 0 path: $12 (current cell) vs row-0 template family
//   if $12 ∈ {$1CF0, $1CF2, RndBoundA, RndBoundB, $1CF8, $1CFA}
//                                         ⇒ stamp $1CF2
//   else (CODE_13BC53):
//     $A1 = $8000 (set "done" high bit)
//     if $12 == $1C28                     ⇒ exit (no stamp)
//     if $12 == $1BF6                     ⇒ stamp $1C28
//     else                                ⇒ stamp $1CF0
// ─────────────────────────────────────────────────────────────────────

function thickPostLeftEdge(state: DecodeState): void {
  // BPL/JMP gate — high bit set means a previous cell in this row
  // already finished the overlay; the row stays untouched.
  if ((state.zpA1 & 0x8000) !== 0) return;

  const a1Lo = state.zpA1 & 0xffff;
  let goSeal = a1Lo !== 0;
  let goNonFloor = false;

  if (!goSeal) {
    // Probe below for floor-family templates.
    setProbeToCurrent(state);
    const belowOff = getMap16Below(state);
    const below = readBuf16(state, belowOff);
    const skipA = state.templateAt(SLOT_ThickPost_BelowSkipA);
    const skipB = state.templateAt(SLOT_ThickPost_BelowSkipB);
    if (below === skipA || below === skipB) {
      goSeal = true;
    } else {
      const rangeLo = state.templateAt(SLOT_ThickPost_BelowRangeLo);
      const rangeHi = state.templateAt(TT.FlatFloor_RndSelfMarkA);
      if (below < rangeLo || below >= rangeHi) {
        goNonFloor = true;
      } else {
        // Within [$1CAE, RndSelfMarkA) — falls into seal path.
        goSeal = true;
      }
    }
  }

  if (goSeal) {
    state.zpA1 = 0x0001;
    if ((state.zp2C & 0xff) === 0) {
      stampCell(state, state.templateAt(SLOT_ThickPost_LeftBottom));
      return;
    }
    // Non-zero row: the cart JSLs CODE_floor_edge_random_side ($15=1 = left
    // side), which STAMPS the cell with a left-edge random-side variant. That
    // stamp is the floor's edge detail; it's only overwritten below if the
    // right neighbour is in the floor-row-0 family. (Earlier this was a
    // PRNG-only stub, so the edge cell kept the bare floor body — the 2-2
    // $67/$58 right-edge-missing-details bug.)
    state.zp15 = 0x0001;
    floorEdgeRandomSide(state);
    // Probe right; overwrite-with-top-overlay if neighbour is in the
    // floor-row-0 template family.
    const right = probeRightTile(state);
    const floorL = state.templateAt(TT.FloorRow0_LeftLo);
    const floorR = state.templateAt(TT.FloorRow0_RightLo);
    if (right === 0x007D || right === 0x007E || right === floorL || right === floorR) {
      stampCell(state, state.templateAt(SLOT_ThickPost_TopLeftOverlay));
    }
    return;
  }

  if (goNonFloor) {
    // CODE_13BC2A: only fires on row 0; row >0 just falls through.
    if ((state.zp2C & 0xff) !== 0) return;

    const cur = state.zp12 & 0xffff;
    const f1CF0 = state.templateAt(SLOT_ThickPost_TopLeftBody);
    const f1CF2 = state.templateAt(SLOT_ThickPost_TopInterior);
    const rndA  = state.templateAt(TT.FlatFloor_RndBoundA);
    const rndB  = state.templateAt(TT.FlatFloor_RndBoundB);
    const f1CF8 = state.templateAt(SLOT_ThickPost_TopExtraA);
    const f1CFA = state.templateAt(SLOT_ThickPost_TopRightBody);

    if (
      cur === f1CF0 || cur === f1CF2 || cur === rndA ||
      cur === rndB || cur === f1CF8 || cur === f1CFA
    ) {
      // CODE_13BC4E
      stampCell(state, f1CF2);
      return;
    }

    // CODE_13BC53
    state.zpA1 = 0x8000;
    const overlapA = state.templateAt(SLOT_ThickPost_FloorOverlapA);
    const overlapB = state.templateAt(SLOT_ThickPost_FloorOverlapB);
    if (cur === overlapA) return; // CODE_13BC53 BEQ exit
    if (cur === overlapB) {
      stampCell(state, overlapA);
      return;
    }
    // CODE_13BC69
    stampCell(state, f1CF0);
  }
}

// ─────────────────────────────────────────────────────────────────────
// CODE_thick_post_right_edge ($13:BCD4, Bank13.asm:7025)
//
// Mirror of left-edge: same $A1 gate, same below-probe, but with the
// side flipped — probe LEFT instead of right, and stamp $1CE4 /
// $1CF4 / $1CFA family instead of $1CE6 / $1CF6 / $1CF0.
// ─────────────────────────────────────────────────────────────────────

function thickPostRightEdge(state: DecodeState): void {
  if ((state.zpA1 & 0x8000) !== 0) return;

  const a1Lo = state.zpA1 & 0xffff;
  let goSeal = a1Lo !== 0;
  let goNonFloor = false;

  if (!goSeal) {
    setProbeToCurrent(state);
    const belowOff = getMap16Below(state);
    const below = readBuf16(state, belowOff);
    const skipA = state.templateAt(SLOT_ThickPost_BelowSkipA);
    const skipB = state.templateAt(SLOT_ThickPost_BelowSkipB);
    if (below === skipA || below === skipB) {
      goSeal = true;
    } else {
      const rangeLo = state.templateAt(SLOT_ThickPost_BelowRangeLo);
      const rangeHi = state.templateAt(TT.FlatFloor_RndSelfMarkA);
      if (below < rangeLo || below >= rangeHi) {
        goNonFloor = true;
      } else {
        goSeal = true;
      }
    }
  }

  if (goSeal) {
    state.zpA1 = 0x0001;
    if ((state.zp2C & 0xff) === 0) {
      stampCell(state, state.templateAt(SLOT_ThickPost_RightBottom));
      return;
    }
    // Cart: STZ $15 (side-right) ; JSL CODE_floor_edge_random_side — stamps the
    // right-edge random-side variant (the edge detail), overwritten below only
    // if the left neighbour is in the floor-row-0 family.
    state.zp15 = 0x0000;
    floorEdgeRandomSide(state);
    const left = probeLeftTile(state);
    const floorL = state.templateAt(TT.FloorRow0_LeftLo);
    const floorR = state.templateAt(TT.FloorRow0_RightLo);
    // Asm uses #$007D / #$007F (NOT $007E like the left mirror — cart
    // chose distinct sentinels for left vs right; both are FloorRow0
    // family raw IDs).
    if (left === 0x007D || left === 0x007F || left === floorL || left === floorR) {
      stampCell(state, state.templateAt(SLOT_ThickPost_TopRightOverlay));
    }
    return;
  }

  if (goNonFloor) {
    if ((state.zp2C & 0xff) !== 0) return;

    const cur = state.zp12 & 0xffff;
    const f1CF0 = state.templateAt(SLOT_ThickPost_TopLeftBody);
    const f1CF2 = state.templateAt(SLOT_ThickPost_TopInterior);
    const rndA  = state.templateAt(TT.FlatFloor_RndBoundA);
    const rndB  = state.templateAt(TT.FlatFloor_RndBoundB);
    const f1CF8 = state.templateAt(SLOT_ThickPost_TopExtraA);
    const f1CFA = state.templateAt(SLOT_ThickPost_TopRightBody);

    if (
      cur === f1CF0 || cur === f1CF2 || cur === rndA ||
      cur === rndB || cur === f1CF8 || cur === f1CFA
    ) {
      // CODE_13BD5B
      stampCell(state, f1CF2);
      return;
    }

    // CODE_13BD60
    state.zpA1 = 0x8000;
    const overlapA = state.templateAt(SLOT_ThickPost_FloorOverlapA);
    const overlapB = state.templateAt(SLOT_ThickPost_FloorOverlapB);
    if (cur === overlapA) return;
    if (cur === overlapB) {
      stampCell(state, overlapA);
      return;
    }
    // CODE_13BD76 → stamp $1CFA (right-edge mirror of left's $1CF0)
    stampCell(state, f1CFA);
  }
}

// ─────────────────────────────────────────────────────────────────────
// CODE_thick_post_interior ($13:BC73, Bank13.asm:6986)
//
//   STZ $A1                              ; always reset the sticky flag
//   if $2C != 0                          ⇒ exit (no stamp)
//   if $12 == $1C28                      ⇒ exit (already overlaid)
//   scan DATA_thick_post_int_match for $12:
//     on hit at index i  ⇒ stamp templateAt(DATA_thick_post_int_replace[i])
//     on no hit          ⇒ stamp templateAt($1CF2)
// ─────────────────────────────────────────────────────────────────────

function thickPostInterior(state: DecodeState): void {
  state.zpA1 = 0x0000;
  if ((state.zp2C & 0xff) !== 0) return;

  const cur = state.zp12 & 0xffff;
  const overlapA = state.templateAt(SLOT_ThickPost_FloorOverlapA);
  if (cur === overlapA) return;

  for (let i = 0; i < DATA_thick_post_int_match.length; i++) {
    const matchId = state.templateAt(DATA_thick_post_int_match[i]!);
    if (cur === matchId) {
      stampCell(state, state.templateAt(DATA_thick_post_int_replace[i]!));
      return;
    }
  }

  // Fall-through: no template match → top-interior body tile.
  stampCell(state, state.templateAt(SLOT_ThickPost_TopInterior));
}

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_thick_post_overlay ($13:BBA6) — column-position dispatcher.
//
//   X = 0
//   if $28 != 0:
//     X += 2 (= interior pointer)
//     if ($28 + 1) == $2A:
//       X += 2 (= right-edge pointer)
//   JSR (DATA_thick_post_sub_handlers, x)
//
// DATA_thick_post_sub_handlers = [left_edge, interior, right_edge].
// ─────────────────────────────────────────────────────────────────────

const stampThickPostOverlay: PerCellHandler = (state) => {
  const col = state.zp28 & 0xff;
  if (col === 0) {
    thickPostLeftEdge(state);
    return;
  }
  const colExtent = state.zp2A & 0xff;
  if (((col + 1) & 0xff) === colExtent) {
    thickPostRightEdge(state);
    return;
  }
  thickPostInterior(state);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_thick_post_overlay ($12:987A, Bank12.asm:3809)
//
//   REP #$30
//   wire all 3 handler slots ($1F/$21, $22/$24, $25/$27) to
//     CODE_stamp_thick_post_overlay-$01
//   $19 = $7FFF        (unbounded; walker terminates on $2C==$2E)
//   STZ $17            (slope = 0)
//   STZ $A1            (autotile-overlay "previously-overlaid" sticky flag)
//   JSR object_stream_walk
//
// The $A1 reset is the only feature beyond a bare trampoline — it
// ensures the sticky early-exit gate inside the sub-handlers starts
// fresh for each new object.
// ─────────────────────────────────────────────────────────────────────

function initThickPostOverlay(state: DecodeState): void {
  state.zpA1 = 0x0000;
  walkerSetupTrampoline(state, stampThickPostOverlay);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Object $58 is the only consumer of this init.
// ─────────────────────────────────────────────────────────────────────

export function installThickPostOverlayHandlers(): void {
  registerStdObjectHandler(0x58, initThickPostOverlay);
}
