// Bank13 horizontal-post stamp handler + Bank12 init wrapper.
//
// Ports the "horizontal bouncing-post / trampoline bar" object family.
//
//   $0D init_post_horizontal  (Bank12:3001 -> Bank13:846 stamp)
//        Stamp: CODE_post_horizontal_3section ($13:8478) — 3-section
//        decision tree (left cap / middle / right cap) with shape-aware
//        FlatFloor seam-blend fallback at the end caps.
//
// Sibling object $0C/$0E/$0F (vertical posts) lives in a separate file —
// they share the same "3-section + FlatFloor seam blend" pattern but on
// a different axis. A parent sweep will consolidate the post family once
// both ports land.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { TT } from '../template-slots.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Unnamed template-slot addresses used only by the post family.
// These don't yet have canonical TT.* names in template-slots.ts; if
// the post family ends up being the only consumer, leave them inline.
// If the parent sweep finds the vertical handler reads the same slots,
// promote to TT.* there.
// ─────────────────────────────────────────────────────────────────────
const SLOT_HorizPost_Middle    = 0x001C7C; // middle-of-bar tile (asm $1C7C)
const SLOT_HorizPost_RightCap  = 0x001C7E; // right-cap tile     (asm $1C7E)
const SLOT_HorizPost_FloorBlendR = 0x001C98; // right-cap-on-floor blend (asm $1C98)
const SLOT_HorizPost_FloorBlendL = 0x001C9A; // left-cap-on-floor  blend (asm $1C9A)

// ─────────────────────────────────────────────────────────────────────
// CODE_post_horizontal_3section ($13:8478, Bank13.asm:846)
//
// Three-section bar with end-cap shape detection:
//
//   1. If the cell already contains a HorizPost-family tile
//      (page byte == HorizPost_PageAnchor), this cell is the interior
//      of an overlapping post → stamp the middle slot ($1C7C).
//   2. Else if $28 == 0 (leftmost column of THIS object):
//      - If cell currently holds a FlatFloor-family tile → stamp the
//        floor-blend left cap ($1C9A).
//      - Else → stamp the plain left cap ($1C7A = HorizPost_PageAnchor).
//   3. Else if ($28 + 1) == $2A (rightmost column):
//      - If cell holds a FlatFloor-family tile → stamp floor-blend
//        right cap ($1C98).
//      - Else → stamp the plain right cap ($1C7E).
//   4. Else (true interior column): stamp the middle slot ($1C7C).
//
// All slot loads happen as 16-bit reads (REP #$30), so the
// shape-detect probes look at the high page-byte of $12 via AND #$FF00.
// ─────────────────────────────────────────────────────────────────────

const postHorizontal3Section: PerCellHandler = (state) => {
  const pageByte = state.zp12 & 0xff00;

  // (1) Cell is already in the HorizPost family → middle interior.
  if (pageByte === state.templateAt(TT.HorizPost_PageAnchor)) {
    stampCell(state, state.templateAt(SLOT_HorizPost_Middle));
    return;
  }

  const col = state.zp28 & 0xff;

  // (2) Leftmost column.
  if (col === 0) {
    if (pageByte === state.templateAt(TT.FlatFloor_PageAnchor)) {
      stampCell(state, state.templateAt(SLOT_HorizPost_FloorBlendL));
    } else {
      stampCell(state, state.templateAt(TT.HorizPost_PageAnchor));
    }
    return;
  }

  // (3) Rightmost column.  Asm: INC ; CMP $2A ; BEQ CODE_1384A6
  const colExtent = state.zp2A & 0xff;
  if (((col + 1) & 0xff) === colExtent) {
    if (pageByte === state.templateAt(TT.FlatFloor_PageAnchor)) {
      stampCell(state, state.templateAt(SLOT_HorizPost_FloorBlendR));
    } else {
      stampCell(state, state.templateAt(SLOT_HorizPost_RightCap));
    }
    return;
  }

  // (4) Interior column → middle slot. (Falls through to CODE_13848D in
  // the asm; same store as case 1.)
  stampCell(state, state.templateAt(SLOT_HorizPost_Middle));
};

// ─────────────────────────────────────────────────────────────────────
// Object $0D — CODE_init_post_horizontal ($12:935E, Bank12.asm:3001)
//
// Pure walker-trampoline init: same handler for odd / even / row slots.
// No DP mutations (spec confirms: xy/extents/orientation unchanged
// entry → walker time).
// ─────────────────────────────────────────────────────────────────────

function initPostHorizontal(state: DecodeState): void {
  walkerSetupTrampoline(state, postHorizontal3Section);
}

// ─────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────

export function installPostHorizontalHandlers(): void {
  registerStdObjectHandler(0x0D, initPostHorizontal);
}
