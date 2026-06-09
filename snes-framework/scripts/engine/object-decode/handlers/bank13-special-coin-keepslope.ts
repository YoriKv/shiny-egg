// Bank13 special-coin (keep-slope variant) — standard object $84.
//
// Cart entry points:
//   CODE_init_special_coin_keepslope              ($12:9C7E, Bank12.asm:4398)
//   CODE_special_coin_stamp_keepslope             ($13:D10A, Bank13.asm:9486)
//
// Sibling ($82/$83, NOT in this file):
//   CODE_init_special_coin                        ($12:9C74, Bank12.asm:4391)
//   CODE_special_coin_stamp                       ($13:D0E6, Bank13.asm:9465)
//
//
// All three objects drop the literal red-coin tile $A400 into otherwise-
// unclaimed cells only — the cart calls `CODE_item_memory_bit_lookup` (a
// save-RAM bit probe used for egg / coin / pickup persistence) and
// BNE-skips on "bit set" (= already collected). For an offline editor
// render no save state exists, so the probe always returns "bit not set"
// and the stamp path runs unconditionally.
//
// The KEEP-SLOPE difference:
//   - Regular fill ($82/$83) goes through `walker_setup_trampoline` which
//     zeroes $17 (slope=0, plain rectangle) and gates the stamp on
//     ($15 & 1 == 0) || ($28 & 1 == 0) — at least one of orientation-bit or
//     even column must be true.
//   - Keep-slope fill ($84) writes $17 = $FFFF *before* tail-calling
//     `walker_setup_keep_slope` so the walker advances diagonally. The
//     stamp force-writes $9B = $FFFF (slope-suppression-bypass marker,
//     bit-15 set → walker_row_wrap skips the $2E shrink that would
//     otherwise collapse the strip) and stamps only on EVEN columns.
//     Net effect: a checkerboard half-density red-coin overlay along a 1:1
//     diagonal.
//
// Asm reference — CODE_special_coin_stamp_keepslope:
//
//   REP #$30
//   LDX $1D
//   JSL CODE_item_memory_bit_lookup    ; A != 0 → bit set, skip stamp
//   BNE skip
//   LDA #$FFFF                          ; force keep-slope marker even
//   STA $9B                             ; when col is odd (stamp gated below)
//   LDA $28
//   AND #$0001
//   BNE skip                            ; odd col → no stamp
//   LDX $1D
//   LDA #$A400
//   STA.l LevelDataBuffer,x
//  skip:
//   SEP #$30
//   RTL
//
// Init handler (Bank12.asm:4398):
//
//   REP #$20
//   LDA #$FFFF ; STA $17                ; per-row slope step = -1
//   LDX #(CODE_special_coin_stamp_keepslope-1)>>16
//   LDA #CODE_special_coin_stamp_keepslope-1
//   JMP walker_setup_keep_slope
//
// Spec DP-diff table is all "no" — the init only mutates $17, which the
// walker setup chain reads (DP-diff table tracks walker-time DP fields
// other than the slope-relevant one).

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupKeepSlope } from '../walker.ts';
import { stampCell } from './_shared.ts';

// Map16 ID for the red-coin collectible tile. Cart asm: `LDA #$A400`.
// Shared with the regular $82/$83 sibling; promote to `_shared.ts` once
// they coexist long enough to share a constant.
const SPECIAL_COIN_TILE = 0xA400;

// $9B "slope-suppression bypass" sentinel. Bit-15 set → walker_row_wrap's
// `BMI skip-extent-adjust` branch taken, so the $2E row-extent doesn't get
// adjusted by $17 between rows. Same role as the lift-track $8000 marker
// (see `_shared.ts:LIFT_TRACK_*`) but force-set every cell rather than
// conditionally on column position.
const SLOPE_BYPASS_MARKER = 0xFFFF;

// ─────────────────────────────────────────────────────────────────────
// CODE_special_coin_stamp_keepslope — per-cell stamper.
//
// item_memory_bit_lookup: in-cart, indexes a save-RAM bitmap selected by
// the level header's ItemMemorySetting and returns nonzero if the bit
// for this object-instance's xy is set (= "the player has interacted /
// collected here"). The editor renders against a blank save, so the
// probe always returns zero — the BNE skip is never taken.
// ─────────────────────────────────────────────────────────────────────

const specialCoinKeepslopeStamp: PerCellHandler = (state) => {
  // JSL item_memory_bit_lookup → A. Editor: always "bit not set" → A=0,
  // so the BNE is not taken; fall through to the slope-marker store.
  // (Skip-on-set would cosmetically hide a small handful of cells in
  // playthroughs after item pickup; irrelevant for a fresh-cart render.)

  // LDA #$FFFF ; STA $9B — force the slope-bypass marker before the
  // column-parity gate. This is the keep-slope variant's defining
  // mutation: even when the stamp itself is skipped on odd columns,
  // $9B is still set so the walker's next row-wrap preserves the
  // 1-row strip.
  state.rewound = SLOPE_BYPASS_MARKER;

  // LDA $28 ; AND #$0001 ; BNE skip — only stamp on EVEN columns.
  if ((state.zp28 & 0x01) !== 0) return;

  // LDX $1D ; LDA #$A400 ; STA.l buffer,X.
  stampCell(state, SPECIAL_COIN_TILE);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_special_coin_keepslope (Bank12.asm:4398).
// ─────────────────────────────────────────────────────────────────────

function initSpecialCoinKeepslope(state: DecodeState): void {
  // LDA #$FFFF ; STA $17 — per-row slope step = -1 (1:1 diagonal rise).
  state.zp17 = 0xFFFF;
  // JMP walker_setup_keep_slope(stamp). The keep-slope entry skips the
  // `STZ $17` that the regular trampoline does, preserving our $17.
  walkerSetupKeepSlope(state, specialCoinKeepslopeStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Sibling $82/$83 (regular special-coin) lives in
// `bank13-special-coin.ts`. Both variants run the same item-memory probe
// and stamp the same literal $A400 tile, differing only in column-gate
// logic and whether $17 / $9B get pre-set.
// ─────────────────────────────────────────────────────────────────────

export function installSpecialCoinKeepslopeHandlers(): void {
  registerStdObjectHandler(0x84, initSpecialCoinKeepslope);
}
