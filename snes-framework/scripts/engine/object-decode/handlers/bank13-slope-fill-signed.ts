// Bank13 slope-fill-signed stamp handler (std object $80).
//
// Cart routines:
//   $12:9C33  CODE_init_slope_fill_signed      — Bank12.asm:4353
//   $13:D01A  CODE_slope_fill_signed_stamp     — Bank13.asm:9324
//   $13:D04E  CODE_slope_fill_signed_leftcap   — Bank13.asm:9361 (X = 0)
//   $13:D066  CODE_slope_fill_signed_body      — Bank13.asm:9376 (X = 2)
//   $13:D071  CODE_slope_fill_alt_rightcap     — Bank13.asm:9385 (X = 4)
//   $13:D048  DATA_slope_fill_signed_handlers  — Bank13.asm:9355 (3-entry sub-ptr table)
//   $13:D094  DATA_slope_fill_alt_rightcap_tiles — Bank13.asm:9407 (2-entry $1D8C/$1D8E)
//
// Init handler (CODE_init_slope_fill_signed):
//   - Takes the absolute value of $2A into $2E so callers can pass a
//     signed direction encoded in $2A. The cart's flow:
//         REP #$20
//         LDA $2A
//         BPL skip            ; positive $2A: copy directly
//         EOR #$FFFF; INC     ; negate ($2A < 0)
//       skip:
//         STA $2E
//   - Then JMP into CODE_walker_setup_trampoline with the bank+ptr of
//     CODE_slope_fill_signed_stamp. The trampoline clears
//     $17 (slope = 0), writes the stamp into all three walker slots, and
//     runs the intra-object walker with rows-to-walk = $7FFF (terminates
//     via $2C == $2E).
//
// Per-cell stamp (CODE_slope_fill_signed_stamp):
//   1. Top of stamp: if $2C == 0 AND $28 != 0 → DEC $2E. This shrinks the
//      row extent by one each time a new column begins past column 0, so
//      the rectangle becomes a right-triangle diagonal (col 0 walks 16
//      rows; col 1 walks 15; ... col N walks 16-N rows). Trace confirms:
//      col 0 = cells 0..15 (rows 0..F), col 1 = cells 16..30 (rows 0..E),
//      col 2 = cells 31..44 (rows 0..D), ...
//   2. Sub-handler dispatch on $2C vs $2E:
//        $2C + 1 == $2E  → leftcap   (X = 0)  — last row of this column
//        $2C + 2 == $2E  → body      (X = 2)  — second-to-last row
//        otherwise       → rightcap  (X = 4)  — rows 0..$2E-3 (the fill)
//   3. Each sub-handler returns a tile in Y. If Y has bit 15 set ($FFFF
//      sentinel) the stamp is skipped (`TYA; BMI skip`). Otherwise
//      `STA buffer,$1D` stamps it.
//
// Sub-handlers:
//   leftcap (CODE_slope_fill_signed_leftcap): picks slot $1DA8 ($680F) for positive $2A or
//     slot $1DA2 ($680D) for negative $2A. Then if $12's page byte equals
//     TileTpl_Family6800_Anchor's page ($6800), suppress write (Y = $FFFF).
//     The page-suppression branch is the "already on a $1D8A-row context"
//     guard — when the buffer cell already holds a Family6800 tile from
//     a sibling slope/floor object, don't overwrite the cap.
//
//   body (CODE_slope_fill_signed_body): picks slot $1DA6 ($680E) for positive $2A or
//     slot $1DA4 ($680C) for negative $2A. Unconditional stamp.
//
//   rightcap_alt (CODE_slope_fill_alt_rightcap, CODE_slope_fill_alt_rightcap): SHARED with
//     object $81 (wide-slope-signed). Suppress write when $12 != 0 AND
//     $12's page != TileTpl_Family6800_Anchor's page — leaves the prior
//     tile alone if there's a non-empty, non-6800-family cell underneath.
//     Otherwise picks $1D8C ($6801) on even $28 or $1D8E ($6802) on odd
//     $28 (col-parity bias for the slope-interior alternation).
//
// Trace verification (1 spec, 136 cells, $2A = $10 = +16, $15 = $80):
//   - All cells take the positive-$2A path; the negative branches
//     (leftcap $1DA2 / body $1DA4) are not exercised. Algorithm ported
//     faithfully — bytes match the cart for sign-flipped placements that
//     existing levels might surface.
//   - $6801 (rightcap even-col), $6802 (rightcap odd-col), $680E (body),
//     $680F (leftcap) outputs all match.
//   - DEC-$2E-per-new-column shrinkage matches: col 0 = 16 cells, col 1
//     = 15, col 2 = 14, ..., col 13 = 3 (cells 130-132), col 14 = 2
//     (cells 133-134), col 15 = 1 (cell 135).
//
// Consolidation candidates:
//   - CODE_slope_fill_alt_rightcap is shared with object $81 wide-slope
//     stamp ($13:D098, CODE_wide_slope_signed_stamp). When $81 ports, the
//     `slopeFillAltRightcap` helper here should move to `_shared.ts`.
//   - DATA_slope_fill_alt_rightcap_tiles is similarly $81-shared (single
//     2-entry pointer table consulted by both stamps). Move alongside.
//   - The "page-byte == Family6800 anchor's page" suppression pattern
//     appears in BOTH leftcap and rightcap_alt, and recurs in several
//     other Bank13 stamp handlers (see Bank13.asm:8653 et al.). A
//     `isFamily6800PageMatch(state)` helper in _shared.ts would tidy
//     ~3 callers; deferring until $81 ports.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { TT } from '../template-slots.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Template-slot constants for the four picked tiles.
// $1D8A is Family6800_Anchor (page = $6800); the four slots below are
// at +2, +4, ... offsets within the same 20-slot family.
// ─────────────────────────────────────────────────────────────────────

const SLOT_1DA2 = 0x001DA2; // leftcap, negative-$2A path  ($680D)
const SLOT_1DA4 = 0x001DA4; // body,    negative-$2A path  ($680C)
const SLOT_1DA6 = 0x001DA6; // body,    positive-$2A path  ($680E)
const SLOT_1DA8 = 0x001DA8; // leftcap, positive-$2A path  ($680F)

// DATA_slope_fill_alt_rightcap_tiles (Bank13.asm:9407).
// 2-entry tile-id table indexed by ($28 & 1). Even col → $1D8C ($6801);
// odd col → $1D8E ($6802). Both slots dereference via state.templateAt.
const DATA_slope_fill_alt_rightcap_tiles = [0x001D8C, 0x001D8E] as const;

// ─────────────────────────────────────────────────────────────────────
// Sub-handlers. Each returns either a 16-bit Map16 ID to stamp, or
// `null` if the cart's `Y = $FFFF; TYA; BMI skip` path fired (no stamp).
// ─────────────────────────────────────────────────────────────────────

/** CODE_slope_fill_signed_leftcap. */
function slopeFillSignedLeftcap(state: DecodeState): number | null {
  // BPL: positive $2A → $1DA8; negative → $1DA2.
  const slot = (state.zp2A & 0x80) !== 0 ? SLOT_1DA2 : SLOT_1DA8;
  // Page-match guard: if $12's page byte matches Family6800_Anchor's,
  // suppress the write (the underlying cell already holds a 6800-family
  // tile from a sibling object — don't clobber the cap).
  const cur = state.zp12 & 0xffff;
  const curPage = cur & 0xff00;
  const anchor = state.templateAt(TT.Family6800_Anchor);
  const anchorPage = anchor & 0xff00;
  if (curPage === anchorPage) return null;
  return state.templateAt(slot);
}

/** CODE_slope_fill_signed_body. */
function slopeFillSignedBody(state: DecodeState): number | null {
  // BPL: positive $2A → $1DA6; negative → $1DA4. Unconditional stamp.
  const slot = (state.zp2A & 0x80) !== 0 ? SLOT_1DA4 : SLOT_1DA6;
  return state.templateAt(slot);
}

/** CODE_slope_fill_alt_rightcap. Shared with object $81. */
function slopeFillAltRightcap(state: DecodeState): number | null {
  const cur = state.zp12 & 0xffff;
  // Suppress write when $12 is non-zero AND not in the 6800 family.
  // (cart: BEQ → continue if zero; else AND #$FF00 / CMP anchor / BEQ →
  // continue if same page; else Y = $FFFF.)
  if (cur !== 0) {
    const anchor = state.templateAt(TT.Family6800_Anchor);
    if ((cur & 0xff00) !== (anchor & 0xff00)) return null;
  }
  // Pick by col parity: even $28 → $1D8C; odd → $1D8E.
  const colParity = state.zp28 & 0x01;
  const slot = DATA_slope_fill_alt_rightcap_tiles[colParity]!;
  return state.templateAt(slot);
}

// ─────────────────────────────────────────────────────────────────────
// Per-cell stamp (CODE_slope_fill_signed_stamp).
// ─────────────────────────────────────────────────────────────────────

const stampSlopeFillSigned: PerCellHandler = (state) => {
  // Top: if $2C == 0 AND $28 != 0 → DEC $2E (shrink row extent for the
  // next column-walk so the rectangle collapses into a right triangle).
  const row = state.zp2C & 0xff;
  const col = state.zp28 & 0xff;
  if (row === 0 && col !== 0) {
    state.zp2E = (state.zp2E - 1) & 0xffff;
  }

  // Sub-handler dispatch on ($2C + 1) vs $2E and ($2C + 2) vs $2E.
  const rowExtent = state.zp2E & 0xff;
  let tile: number | null;
  if (((row + 1) & 0xff) === rowExtent) {
    tile = slopeFillSignedLeftcap(state);
  } else if (((row + 2) & 0xff) === rowExtent) {
    tile = slopeFillSignedBody(state);
  } else {
    tile = slopeFillAltRightcap(state);
  }

  if (tile === null) return; // Y was $FFFF — TYA; BMI skip path.
  stampCell(state, tile);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_slope_fill_signed (Bank12.asm:4353).
// ─────────────────────────────────────────────────────────────────────

function initSlopeFillSigned(state: DecodeState): void {
  // Take absolute value of $2A into $2E. Cart:
  //   REP #$20; LDA $2A; BPL skip; EOR #$FFFF; INC; skip: STA $2E
  // $2A is a 16-bit word in REP #$20; we hold it as a byte (state.zp2A)
  // because the per-cell paths only care about the low byte. For sign
  // bit we test bit 7.
  const a = state.zp2A & 0xff;
  let absA: number;
  if ((a & 0x80) !== 0) {
    // Negate as 8-bit (matches the cart's 16-bit EOR/INC with high-byte
    // implicitly zero for legitimate column extents).
    absA = ((a ^ 0xff) + 1) & 0xff;
  } else {
    absA = a;
  }
  state.zp2E = absA;

  // Trampoline-style walker setup: $17 = 0, all 3 slots get the stamp.
  walkerSetupTrampoline(state, stampSlopeFillSigned);
}

// ─────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────

export function installSlopeFillSignedHandlers(): void {
  registerStdObjectHandler(0x80, initSlopeFillSigned);
}
