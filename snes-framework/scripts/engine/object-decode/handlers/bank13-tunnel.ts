// Bank13 tunnel / cave-mouth dispatcher (object $14, init_tunnel).
//
// Port of CODE_tunnel_dispatch ($13:8605) and the entire 19-routine
// closure beneath it: 3 sub-dispatchers (vert/horiz/box), 9 per-cell
// box stampers, the 18-entry input-tile classifier, the top-cap above
// fix-up, and the 14 per-cell tile tables + 3 helper tables.
//
// Algorithm (cart `CODE_tunnel_dispatch`):
//   1. Latch `$1B → $0E` (probe coord = current coord), latch `$1D → X`
//      (current cell offset).
//   2. Pre-classify based on cur_tile ($12) — if its page byte matches
//      `WideFloorPage_Anchor`, set `$A1 = (cur_lo + 1) * 2` (used as the
//      table index Y in the box sub-dispatcher's mid-col path); else $A1
//      stays at 0 and the classifier loop runs later.
//   3. Branch on extents to one of the 3 sub-dispatchers:
//        $2A == 1 → vert (single column)
//        $2E == 1 → horiz (single row)
//        else     → box (2D 3×3 corner/edge/middle dispatch)
//   4. Each sub-dispatcher picks ONE of N per-cell tables based on the
//      current cell's position within the rectangle, runs the input-tile
//      classifier (which derives Y from cur_tile), then reads
//      `DATA_*_tiles[Y]` to get a 16-bit WRAM slot address.
//   5. Top-row stampers ALSO call `top_cap_above_fixup` BEFORE the table
//      lookup — read the buffer cell ABOVE; if it's currently a
//      `FloorRow0_Left/Right` cap, overwrite it with a corresponding
//      tunnel-cap Map16 ID from `DATA_tunnel_top_cap_above_fixup`.
//   6. Common epilogue (`tunnel_dispatch_tail`): dereference the picked
//      slot address as a WRAM template-slot — stamp `templateAt(slot)`
//      into the buffer at offset $1D.
//
// Each per-cell table is 47 entries × 2 bytes = 94 bytes. Entries are
// WRAM slot ADDRESSES (mostly in the wide-floor family $1BE0+, with a
// few reaching into flat-floor $1C92+ or FloorRow0 $1C5C+).
//
// The classifier `CODE_tunnel_input_tile_classifier` walks 18 slot
// addresses from `DATA_tunnel_input_tile_classifier`, dereferences each
// (templateAt), compares against cur_tile $12. On match, returns
// Y = matched_idx*2 + $28 (= $28..$4A in steps of 2). On miss, Y = 0
// ($A1 cleared). This sets the classifier output Y for the table read.
//
// The wide-floor-page anchor pre-classify path bypasses the classifier
// entirely — when cur_tile is already in the wide-floor family page,
// Y = (cur_lo + 1) * 2 picks an early entry from the table directly.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { TT } from '../template-slots.ts';
import { getMap16Above } from '../fetch.ts';
import { setProbeToCurrent, readBuf16, writeBuf16, stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_tunnel_top_cap_above_fixup.
//
// 3-entry replacement table for `top_cap_above_fixup`. Indexed by
// Y = {0, 2, 4} passed in from the 3 top-row box stampers (top_left,
// top_middle, top_right). Entries are RAW Map16 IDs — stamped directly
// into the ABOVE cell when its current value is a `FloorRow0_*` cap.
// ─────────────────────────────────────────────────────────────────────

const DATA_tunnel_top_cap_above_fixup = [0x007E, 0x0000, 0x007F] as const;

// ─────────────────────────────────────────────────────────────────────
// DATA_tunnel_extra_singleton_007D.
//
// Standalone 1-word slot containing Map16 ID $007D. Two entries in the
// vert-top tiles table (indices 22 and 23) reference THIS WRAM cell as
// their slot address — so dereferencing those entries through the
// templateAt path would naturally yield $007D in the cart. Our port
// short-circuits: replace those two slot-address references with the
// raw $007D Map16 ID inside the vert-top table.
// ─────────────────────────────────────────────────────────────────────

const DATA_tunnel_extra_singleton_007D = 0x007D;

// ─────────────────────────────────────────────────────────────────────
// DATA_tunnel_input_tile_classifier.
//
// 18-entry list of slot addresses. The classifier loop dereferences
// each (templateAt(slot)) and tests cur_tile against it. On first
// match, returns Y = matched_idx*2 + $28. Entries 9-12 (anchored at
// WideFloorPage_Anchor = $1BE0) all dereference to the same value — a
// quirky cart-data construction.
// ─────────────────────────────────────────────────────────────────────

const DATA_tunnel_input_tile_classifier: readonly number[] = [
  TT.FlatFloor_Row1LeftLo,    TT.FlatFloor_Row1RightLo,
  TT.FloorRow0_LeftLo,        TT.FloorRow0_RightLo,
  0x1CF2,                     0x1CF8,
  0x1CD8,                     0x1CDC,
  0x1CE0,                     TT.WideFloorPage_Anchor,
  TT.WideFloorPage_Anchor,    TT.WideFloorPage_Anchor,
  TT.WideFloorPage_Anchor,    0x1CDA,
  0x1CDE,                     0x1CE2,
  0x1CE4,                     0x1CE6,
];

// ─────────────────────────────────────────────────────────────────────
// Per-cell tile tables (47 slot-address entries each).
//
// Translation rule for the cart source `dw` lists:
//   - `!RAM_YI_Level_TileTpl_WideFloorPage_Anchor` → TT.WideFloorPage_Anchor ($1BE0)
//   - `DATA_tunnel_extra_singleton_007D` (referenced in the vert-top table at indices 22/23)
//     → DATA_tunnel_extra_singleton_007D (raw $007D, since that table
//       cell holds the Map16 ID itself; templateAt isn't used on raw
//       Map16 IDs and the cart's `LDA $0000,y` with y=$13875E reads
//       that physical cell directly).
//   - All other `$1xxx` literals stay as slot addresses (consumed by
//     `templateAt(slot)` in the dispatch tail).
// ─────────────────────────────────────────────────────────────────────

const WFPA = TT.WideFloorPage_Anchor; // shorthand for table readability

/** DATA_tunnel_vcol_middle_tiles. Vert tunnel, middle rows. */
const DATA_tunnel_vcol_middle_tiles: readonly number[] = [
  WFPA,   WFPA,   0x1C18, 0x1C18, 0x1C18, 0x1BF2, 0x1BF0, 0x1BF2,
  0x1BF0, 0x1BF0, 0x1BF2, 0x1C18, 0x1C04, 0x1BF8, 0x1BFA, 0x1BF8,
  0x1C32, 0x1BF8, 0x1BFA, 0x1C04, 0x1C06, 0x1C06, 0x1C0A, 0x1C0C,
  0x1C0E, 0x1C10, 0x1C12, 0x1C14, 0x1C16, 0x1C18, 0x1C18, 0x1C1C,
  0x1C1E, 0x1C20, 0x1C22, 0x1C24, 0x1C26, 0x1C28, 0x1C2A, 0x1C2C,
  0x1C2E, 0x1C30, 0x1C32, 0x1BF2, 0x1BF0, WFPA,   WFPA,
];

/** DATA_tunnel_vcol_top_tiles. Vert tunnel, row 0.
 *  Indices 22 + 23 in the cart point at DATA_tunnel_extra_singleton_007D (a 1-word cell
 *  containing $007D); our table stores that constant directly. */
const DATA_tunnel_vcol_top_tiles: readonly number[] = [
  0x1C38, WFPA,   0x1C18, 0x1BE4, 0x1BE4, 0x1BF2, 0x1BEA, 0x1BEC,
  0x1BF0, 0x1BEA, 0x1BEC, 0x1BF4, 0x1C04, 0x1BF8, 0x1BFA, 0x1BFC,
  0x1BFE, 0x1BF8, 0x1BFA, 0x1C04, 0x1C06, 0x1C06,
  DATA_tunnel_extra_singleton_007D, DATA_tunnel_extra_singleton_007D,
  0x1C0E, 0x1C10, 0x1C12, 0x1C14, 0x1C16, 0x1C18, 0x1C18, 0x1C1C,
  0x1C1E, 0x1C20, 0x1C22, 0x1C24, 0x1C26, 0x1C28, 0x1C2A, 0x1C2C,
  0x1C2E, 0x1C30, 0x1C32, 0x1BEC, 0x1BEA, 0x1C38, WFPA,
];

/** DATA_tunnel_vcol_bottom_tiles. Vert tunnel, last row. */
const DATA_tunnel_vcol_bottom_tiles: readonly number[] = [
  0x1C3A, WFPA,   0x1BE2, 0x1C18, 0x1C1A, 0x1BE8, 0x1BF0, 0x1BF2,
  0x1BEE, 0x1BEE, 0x1BE8, 0x1C18, 0x1BF6, 0x1BF8, 0x1BFA, 0x1BF8,
  0x1C32, 0x1C02, 0x1C02, 0x1C04, 0x1C06, 0x1C08, 0x1C0A, 0x1C0C,
  0x1C2C, 0x1C2C, 0x1C12, 0x1C14, 0x1C16, 0x1C18, 0x1C1A, 0x1C1C,
  0x1C1E, 0x1C20, 0x1C22, 0x1C24, 0x1C26, 0x1C28, 0x1C2A, 0x1C2C,
  0x1C2E, 0x1C30, 0x1C32, 0x1BE8, 0x1BEE, WFPA,   0x1C3A,
];

/** DATA_tunnel_hrow_middle_tiles. Horiz tunnel, middle cols. */
const DATA_tunnel_hrow_middle_tiles: readonly number[] = [
  0x1BE6, 0x1C18, 0x1BE2, 0x1BE4, 0x1BE6, 0x1C1A, 0x1BE4, 0x1BE4,
  0x1C1A, 0x1C18, 0x1C18, 0x1BF4, 0x1BF6, 0x1C18, 0x1C04, 0x1BE4,
  0x1BF4, 0x1C1A, 0x1BF6, 0x1C04, 0x1C06, 0x1C08, 0x1C0A, 0x1C0C,
  0x1C0E, 0x1C10, 0x1C12, 0x1C14, 0x1C16, 0x1C18, 0x1C1A, 0x1C1C,
  0x1C1E, 0x1C20, 0x1C22, 0x1C24, 0x1C26, 0x1C28, 0x1C2A, 0x1C2C,
  0x1C2E, 0x1C30, 0x1C32, 0x1BE6, 0x1BE6, 0x1BE4, 0x1BE2,
];

/** DATA_tunnel_hrow_left_tiles. Horiz tunnel, col 0. */
const DATA_tunnel_hrow_left_tiles: readonly number[] = [
  0x1C34, 0x1BF2, 0x1BE8, 0x1BEC, 0x1BE6, 0x1BE8, 0x1BE4, 0x1BEC,
  0x1C1A, 0x1C18, 0x1BF2, 0x1BF4, 0x1BF6, 0x1BF8, 0x1C04, 0x1BFC,
  0x1BF4, 0x1BF6, 0x1BF6, 0x1C04, 0x1C06, 0x1C08, 0x1C0A, 0x1C0C,
  0x1C0E, 0x1C10, 0x1C08, 0x1C08, 0x1C08, 0x1C18, 0x1C1A, 0x1C1C,
  0x1C1E, 0x1C20, 0x1C22, 0x1C24, 0x1C3C, 0x1C28, 0x1C2A, 0x1C2C,
  0x1C2E, 0x1C30, 0x1C32, 0x1C34, 0x1BE6, 0x1BEC, 0x1BE8,
];

/** DATA_tunnel_hrow_right_tiles. Horiz tunnel, last col. */
const DATA_tunnel_hrow_right_tiles: readonly number[] = [
  0x1C36, 0x1BF0, 0x1BEE, 0x1BEA, 0x1BE6, 0x1C1A, 0x1BEA, 0x1BE4,
  0x1BEE, 0x1BF0, 0x1C18, 0x1BF4, 0x1BF6, 0x1C18, 0x1BFA, 0x1BF4,
  0x1BFE, 0x1C1A, 0x1C02, 0x1C04, 0x1C06, 0x1C08, 0x1C0A, 0x1C0C,
  0x1C0E, 0x1C10, 0x1C12, 0x1C14, 0x1C16, 0x1C18, 0x1C1A, 0x1C1C,
  0x1C1E, 0x1C0A, 0x1C0A, 0x1C0A, 0x1C26, 0x1C3E, 0x1C2A, 0x1C2C,
  0x1C2E, 0x1C30, 0x1C32, 0x1BE6, 0x1C36, 0x1BEA, 0x1BEE,
];

/** DATA_tunnel_box_top_left_tiles. Box 3×3 [col=0, row=0]. */
const DATA_tunnel_box_top_left_tiles: readonly number[] = [
  0x1BFC, 0x1BF8, 0x1C18, 0x1BF4, 0x1BE4, 0x1BF8, 0x1BF4, 0x1BFC,
  0x1C18, 0x1C18, 0x1BF8, 0x1BF4, 0x1C04, 0x1BF8, 0x1C04, 0x1BFC,
  0x1BF4, 0x1BF8, 0x1C04, 0x1C04, 0x1C20, 0x1C20, 0x1C20, 0x1C20,
  0x1C0E, 0x1C10, 0x1C10, 0x1C10, 0x1C10, 0x1C18, 0x1C18, 0x1C1C,
  0x1C1E, 0x1C20, 0x1C22, 0x1C24, 0x1C26, 0x1C28, 0x1C2A, 0x1C2C,
  0x1C2E, 0x1C30, 0x1C32, 0x1BFC, 0x1BF4, 0x1BFC, 0x1BF8,
];

/** DATA_tunnel_box_middle_left_tiles. Box 3×3 [col=0, mid row]. */
const DATA_tunnel_box_middle_left_tiles: readonly number[] = [
  0x1BF8, 0x1BF8, 0x1BF8, 0x1C18, 0x1C18, 0x1BF8, 0x1C18, 0x1BF8,
  0x1C18, 0x1C18, 0x1BF8, 0x1C18, 0x1C04, 0x1BF8, 0x1C04, 0x1BF8,
  0x1C18, 0x1BF8, 0x1C04, 0x1C04, 0x1C06, 0x1C08, 0x1C0A, 0x1C0C,
  0x1C0E, 0x1C10, 0x1C0C, 0x1C0C, 0x1C0C, 0x1C18, 0x1C18, 0x1C1C,
  0x1C1E, 0x1C20, 0x1C22, 0x1C24, 0x1C26, 0x1C28, 0x1C2A, 0x1C2C,
  0x1C2E, 0x1C30, 0x1C32, 0x1BF8, 0x1C18, 0x1BF8, 0x1BF8,
];

/** DATA_tunnel_box_bottom_left_tiles. Box 3×3 [col=0, row=last]. */
const DATA_tunnel_box_bottom_left_tiles: readonly number[] = [
  0x1C00, 0x1BF8, 0x1C1A, 0x1C18, 0x1C1A, 0x1C00, 0x1C04, 0x1BF8,
  0x1C1A, 0x1C18, 0x1BF8, 0x1C18, 0x1BF6, 0x1BF8, 0x1C04, 0x1BF8,
  0x1C18, 0x1C00, 0x1BF6, 0x1C04, 0x1C06, 0x1C08, 0x1C0A, 0x1C0C,
  0x1C26, 0x1C10, 0x1C14, 0x1C14, 0x1C14, 0x1C18, 0x1C1A, 0x1C1C,
  0x1C1E, 0x1C26, 0x1C26, 0x1C26, 0x1C40, 0x1C28, 0x1C2A, 0x1C2C,
  0x1C2E, 0x1C30, 0x1C32, 0x1C00, 0x1C1A, 0x1BF8, 0x1C00,
];

/** DATA_tunnel_box_top_middle_tiles. Box 3×3 [mid col, row=0]. */
const DATA_tunnel_box_top_middle_tiles: readonly number[] = [
  0x1BF4, 0x1C18, 0x1C18, 0x1BF4, 0x1BF4, 0x1C18, 0x1BF4, 0x1BF4,
  0x1C18, 0x1C18, 0x1C18, 0x1BF4, 0x1C04, 0x1C18, 0x1C04, 0x1BF4,
  0x1BF4, 0x1C18, 0x1C04, 0x1C04, 0x1C22, 0x1C22, 0x1C0A, 0x1C0C,
  0x1C0E, 0x1C10, 0x1C12, 0x1C14, 0x1C16, 0x1C18, 0x1C18, 0x1C1C,
  0x1C1E, 0x1C20, 0x1C22, 0x1C24, 0x1C26, 0x1C28, 0x1C2A, 0x1C2C,
  0x1C2E, 0x1C30, 0x1C32, 0x1BF4, 0x1BF4, 0x1BF4, 0x1C18,
];

/** DATA_tunnel_box_bottom_middle_tiles. Box 3×3 [mid col, row=last]. */
const DATA_tunnel_box_bottom_middle_tiles: readonly number[] = [
  0x1BF6, 0x1C04, 0x1BF6, 0x1C04, 0x1BF6, 0x1BF6, 0x1C04, 0x1C04,
  0x1BF6, 0x1C04, 0x1C04, 0x1C04, 0x1BF6, 0x1C04, 0x1C04, 0x1C04,
  0x1C04, 0x1BF6, 0x1BF6, 0x1C04, 0x1C06, 0x1C08, 0x1C0A, 0x1C0C,
  0x1C28, 0x1C28, 0x1C12, 0x1C14, 0x1C16, 0x1C04, 0x1BF6, 0x1C1C,
  0x1C1E, 0x1C20, 0x1C22, 0x1C24, 0x1C26, 0x1C28, 0x1C2A, 0x1C2C,
  0x1C2E, 0x1C30, 0x1C32, 0x1BF6, 0x1BF6, 0x1C04, 0x1BF6,
];

/** DATA_tunnel_box_top_right_tiles. Box 3×3 [col=last, row=0]. */
const DATA_tunnel_box_top_right_tiles: readonly number[] = [
  0x1BFE, 0x1C32, 0x1C18, 0x1C18, 0x1BF4, 0x1C18, 0x1BFE, 0x1BF4,
  0x1C32, 0x1C32, 0x1C18, 0x1BF4, 0x1C04, 0x1C18, 0x1BFA, 0x1BF4,
  0x1BF4, 0x1C18, 0x1BFA, 0x1C04, 0x1C24, 0x1C24, 0x1C0A, 0x1C0C,
  0x1C0E, 0x1C10, 0x1C12, 0x1C14, 0x1C0E, 0x1C04, 0x1C18, 0x1C1C,
  0x1C1E, 0x1C12, 0x1C12, 0x1C12, 0x1C26, 0x1C28, 0x1C2A, 0x1C2C,
  0x1C2E, 0x1C30, 0x1C32, 0x1BF4, 0x1BFE, 0x1BFE, 0x1C32,
];

/** DATA_tunnel_box_middle_right_tiles. Box 3×3 [col=last, mid row]. */
const DATA_tunnel_box_middle_right_tiles: readonly number[] = [
  0x1BFA, 0x1BFA, 0x1C04, 0x1C04, 0x1C04, 0x1C04, 0x1BFA, 0x1C04,
  0x1BFA, 0x1BFA, 0x1C04, 0x1C04, 0x1C04, 0x1C04, 0x1BFA, 0x1C04,
  0x1BFA, 0x1C04, 0x1BFA, 0x1C04, 0x1C06, 0x1C08, 0x1C0A, 0x1C0C,
  0x1C0E, 0x1C10, 0x1C12, 0x1C14, 0x1C16, 0x1C04, 0x1C04, 0x1C1C,
  0x1C1E, 0x1C0E, 0x1C0E, 0x1C0E, 0x1C26, 0x1C16, 0x1C2A, 0x1C2C,
  0x1C2E, 0x1C30, 0x1C32, 0x1C04, 0x1BFA, 0x1BFA, 0x1BFA,
];

/** DATA_tunnel_box_bottom_right_tiles. Box 3×3 [col=last, row=last]. */
const DATA_tunnel_box_bottom_right_tiles: readonly number[] = [
  0x1C02, 0x1BFA, 0x1BF6, 0x1C04, 0x1BF6, 0x1BF6, 0x1BFA, 0x1C04,
  0x1C02, 0x1BFA, 0x1C04, 0x1C04, 0x1BF6, 0x1C04, 0x1BFA, 0x1C04,
  0x1BFA, 0x1BF6, 0x1C02, 0x1C04, 0x1C06, 0x1C08, 0x1C0A, 0x1C0C,
  0x1C2A, 0x1C2A, 0x1C12, 0x1C14, 0x1C16, 0x1C04, 0x1C1A, 0x1C1C,
  0x1C1E, 0x1C16, 0x1C16, 0x1C16, 0x1C26, 0x1C42, 0x1C2A, 0x1C2C,
  0x1C2E, 0x1C30, 0x1C32, 0x1BF6, 0x1C02, 0x1BFA, 0x1C02,
];

/** Slot $1C04 — the mid-mid box stamper writes this slot address as a
 *  literal, then dispatch-tail dereferences it via templateAt. */
const SLOT_BOX_INTERIOR = 0x1C04;

// ─────────────────────────────────────────────────────────────────────
// CODE_tunnel_input_tile_classifier ($13:8712).
//
// Returns Y, the table index used by all 12 sub-stampers (except
// box_middle_middle and the horiz_middle "wide-floor anchor" path,
// which set Y differently).
//
//   if (cur_tile & $FF00) == WideFloorPage_Anchor:
//     return $A1 unchanged (was pre-set by main dispatcher to (cur_lo+1)*2)
//   else scan 18-entry classifier table for cur_tile match:
//     if match @ idx i: $A1 = i*2 + $28 ; return $A1
//     else            : $A1 = 0         ; return 0
// ─────────────────────────────────────────────────────────────────────

function tunnelInputTileClassifier(state: DecodeState): number {
  const cur = state.zp12 & 0xffff;
  const pageByte = cur & 0xff00;
  const anchor = state.templateAt(TT.WideFloorPage_Anchor);
  if (pageByte === anchor) { // cart `CMP WideFloorPage_Anchor` is a full-word compare
    return state.zpA1 & 0xffff;
  }
  for (let i = 0; i < DATA_tunnel_input_tile_classifier.length; i++) {
    const slotId = state.templateAt(DATA_tunnel_input_tile_classifier[i]!);
    if (slotId === cur) {
      state.zpA1 = (i * 2 + 0x28) & 0xffff;
      return state.zpA1;
    }
  }
  state.zpA1 = 0;
  return 0;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_tunnel_top_cap_above_fixup ($13:873E).
//
// Called by the 3 top-row box stampers (top_left/middle/right) BEFORE
// they pick their main tile. Reads the cell directly ABOVE the current
// cell; if it's currently `FloorRow0_Left` or `FloorRow0_Right`,
// overwrite it with `DATA_tunnel_top_cap_above_fixup[y/2]` so the
// tunnel mouth dovetails into the floor cap above.
//
// `y` arrives as 0/2/4 (top_left/middle/right).
// ─────────────────────────────────────────────────────────────────────

function tunnelTopCapAboveFixup(state: DecodeState, y: number): void {
  // JSL get_map16_above — primitive reads $0E:$0F. Cart sets $0E from $1B at
  // routine entry; we replicate by re-anchoring to current cell here.
  setProbeToCurrent(state);
  const aboveOff = getMap16Above(state);
  const above = readBuf16(state, aboveOff);
  const row0Left = state.templateAt(TT.FloorRow0_LeftLo);
  const row0Right = state.templateAt(TT.FloorRow0_RightLo);
  if (above !== row0Left && above !== row0Right) return;
  const replacement = DATA_tunnel_top_cap_above_fixup[y >>> 1]!;
  writeBuf16(state, aboveOff, replacement);
}

// ─────────────────────────────────────────────────────────────────────
// Slot-picker helpers — each calls the classifier, reads the per-cell
// table by Y, returns the resulting slot address. Top-row variants also
// run the above-cap fixup with their corresponding Y.
// ─────────────────────────────────────────────────────────────────────

/** Read a 16-bit entry from a per-cell table at byte offset `y`.
 *  The table indexes by Y as a byte offset (per the cart `LDA.w
 *  DATA_138xxx,y`), so entry index = y >> 1. Clamp y for safety
 *  against the wide-floor-anchor path overflowing past 47 entries. */
function readTableByY(table: readonly number[], y: number): number {
  const idx = (y >>> 1);
  if (idx < 0 || idx >= table.length) return 0;
  return table[idx]!;
}

// Vert sub-dispatch stampers (single column, $2A == 1).
function pickVcolTop(state: DecodeState): number {
  const y = tunnelInputTileClassifier(state);
  return readTableByY(DATA_tunnel_vcol_top_tiles, y);
}
function pickVcolMiddle(state: DecodeState): number {
  const y = tunnelInputTileClassifier(state);
  return readTableByY(DATA_tunnel_vcol_middle_tiles, y);
}
function pickVcolBottom(state: DecodeState): number {
  const y = tunnelInputTileClassifier(state);
  return readTableByY(DATA_tunnel_vcol_bottom_tiles, y);
}

// Horiz sub-dispatch stampers (single row, $2E == 1).
//
// Cart `CODE_tunnel_horiz_sub_dispatch`:
//   col == 0  → JSR classifier ; LDA hrow_left[Y]
//   col == last → JSR classifier ; LDA hrow_right[Y]
//   middle col → LDY $A1 ; LDA hrow_middle[Y]   (no classifier call;
//     uses the pre-set $A1 = wide-floor anchor offset, or 0 from
//     the main-dispatcher's initial STZ.)
function pickHrowLeft(state: DecodeState): number {
  const y = tunnelInputTileClassifier(state);
  return readTableByY(DATA_tunnel_hrow_left_tiles, y);
}
function pickHrowRight(state: DecodeState): number {
  const y = tunnelInputTileClassifier(state);
  return readTableByY(DATA_tunnel_hrow_right_tiles, y);
}
function pickHrowMiddle(state: DecodeState): number {
  const y = state.zpA1 & 0xffff;
  return readTableByY(DATA_tunnel_hrow_middle_tiles, y);
}

// Box sub-dispatch stampers (3×3 corner/edge/middle).
function pickBoxTopLeft(state: DecodeState): number {
  const y = tunnelInputTileClassifier(state);
  tunnelTopCapAboveFixup(state, 0);
  return readTableByY(DATA_tunnel_box_top_left_tiles, y);
}
function pickBoxMiddleLeft(state: DecodeState): number {
  const y = tunnelInputTileClassifier(state);
  return readTableByY(DATA_tunnel_box_middle_left_tiles, y);
}
function pickBoxBottomLeft(state: DecodeState): number {
  const y = tunnelInputTileClassifier(state);
  return readTableByY(DATA_tunnel_box_bottom_left_tiles, y);
}
function pickBoxTopMiddle(state: DecodeState): number {
  const y = tunnelInputTileClassifier(state);
  tunnelTopCapAboveFixup(state, 2);
  return readTableByY(DATA_tunnel_box_top_middle_tiles, y);
}
function pickBoxMiddleMiddle(_state: DecodeState): number {
  // Cart: `LDA.w #$1C04 ; BRA dispatch_tail` — stamps the literal slot
  // address as Y, dispatch_tail then derefs templateAt($1C04).
  return SLOT_BOX_INTERIOR;
}
function pickBoxBottomMiddle(state: DecodeState): number {
  const y = tunnelInputTileClassifier(state);
  return readTableByY(DATA_tunnel_box_bottom_middle_tiles, y);
}
function pickBoxTopRight(state: DecodeState): number {
  const y = tunnelInputTileClassifier(state);
  tunnelTopCapAboveFixup(state, 4);
  return readTableByY(DATA_tunnel_box_top_right_tiles, y);
}
function pickBoxMiddleRight(state: DecodeState): number {
  const y = tunnelInputTileClassifier(state);
  return readTableByY(DATA_tunnel_box_middle_right_tiles, y);
}
function pickBoxBottomRight(state: DecodeState): number {
  const y = tunnelInputTileClassifier(state);
  return readTableByY(DATA_tunnel_box_bottom_right_tiles, y);
}

// ─────────────────────────────────────────────────────────────────────
// Sub-dispatchers — pick which per-cell stamper to invoke based on
// (col, row) position within the rectangle.
// ─────────────────────────────────────────────────────────────────────

/** CODE_tunnel_vert_sub_dispatch ($13:8645). Pure row dispatch. */
function tunnelVertSubDispatch(state: DecodeState): number {
  const row = state.zp2C & 0xff;
  const rowExt = state.zp2E & 0xff;
  if (row === 0) return pickVcolTop(state);
  if (((row + 1) & 0xff) === rowExt) return pickVcolBottom(state);
  return pickVcolMiddle(state);
}

/** CODE_tunnel_horiz_sub_dispatch ($13:8666). Pure col dispatch. */
function tunnelHorizSubDispatch(state: DecodeState): number {
  const col = state.zp28 & 0xff;
  const colExt = state.zp2A & 0xff;
  if (col === 0) return pickHrowLeft(state);
  if (((col + 1) & 0xff) === colExt) return pickHrowRight(state);
  return pickHrowMiddle(state);
}

/** CODE_tunnel_box_sub_dispatch ($13:8686). 3×3 cell-position dispatch. */
function tunnelBoxSubDispatch(state: DecodeState): number {
  const col = state.zp28 & 0xff;
  const colExt = state.zp2A & 0xff;
  const row = state.zp2C & 0xff;
  const rowExt = state.zp2E & 0xff;

  if (col === 0) {
    if (row === 0) return pickBoxTopLeft(state);
    if (((row + 1) & 0xff) === rowExt) return pickBoxBottomLeft(state);
    return pickBoxMiddleLeft(state);
  }
  if (((col + 1) & 0xff) !== colExt) {
    if (row === 0) return pickBoxTopMiddle(state);
    if (((row + 1) & 0xff) === rowExt) return pickBoxBottomMiddle(state);
    return pickBoxMiddleMiddle(state);
  }
  // Rightmost col.
  if (row === 0) return pickBoxTopRight(state);
  if (((row + 1) & 0xff) === rowExt) return pickBoxBottomRight(state);
  return pickBoxMiddleRight(state);
}

// ─────────────────────────────────────────────────────────────────────
// CODE_tunnel_dispatch ($13:8605). Per-cell entry point.
//
// Mirrors the asm verbatim:
//   1. Set probe coord ($0E) = current ($1B), latch current offset ($1D)
//      into X — both implicit in our state model.
//   2. STZ $A1.
//   3. Page-anchor pre-classify: if cur_tile.page == WideFloorPage_Anchor.page,
//      $A1 = (cur_lo + 1) * 2.
//   4. Pick sub-dispatcher by extents (vert / horiz / box).
//   5. dispatch_tail: stamp templateAt(slot_address) — the picked entry
//      from the table is a WRAM slot address, so the final tile is the
//      template-slot's populated Map16 ID at object-render time.
// ─────────────────────────────────────────────────────────────────────

export const tunnelDispatch: PerCellHandler = (state) => {
  setProbeToCurrent(state);
  state.zpA1 = 0;
  const cur = state.zp12 & 0xffff;
  const pageByte = cur & 0xff00;
  const anchor = state.templateAt(TT.WideFloorPage_Anchor);
  if (pageByte === anchor) { // cart `CMP WideFloorPage_Anchor` is a full-word compare
    state.zpA1 = (((cur & 0xff) + 1) << 1) & 0xffff;
  }

  const colExt = state.zp2A & 0xff;
  const rowExt = state.zp2E & 0xff;
  let slot: number;
  if (((colExt - 1) & 0xff) === 0) {
    slot = tunnelVertSubDispatch(state);
  } else if (((rowExt - 1) & 0xff) === 0) {
    slot = tunnelHorizSubDispatch(state);
  } else {
    slot = tunnelBoxSubDispatch(state);
  }

  // dispatch_tail: cart `TAY ; LDA $0000,y ; STA buffer,x` deref's the picked
  // pointer. Most table entries are WRAM template-slot addresses ($19DA..$1FDA),
  // read via templateAt. A few are pre-resolved RAW Map16 IDs that have no WRAM
  // slot — the cart deref's a ROM `dw` (e.g. the vcol-top $007D singleton at
  // $13:875E). Those are below the template-slot range, so stamp them directly;
  // templateAt(raw) would fall out of range and yield $0000 (record $43/$53).
  const tile = (slot >= 0x19da && slot < 0x1fda) ? state.templateAt(slot) : slot;
  stampCell(state, tile & 0xffff);
};

// ─────────────────────────────────────────────────────────────────────
// Object $14 init handler — wires the dispatcher into all 3 walker
// slots via the standard trampoline (cart `walker_setup_trampoline`).
// ─────────────────────────────────────────────────────────────────────

function initTunnel(state: DecodeState): void {
  walkerSetupTrampoline(state, tunnelDispatch);
}

export function installBank13TunnelHandler(): void {
  registerStdObjectHandler(0x14, initTunnel);
}
