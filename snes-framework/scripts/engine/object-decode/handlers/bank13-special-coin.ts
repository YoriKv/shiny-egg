// Bank13 special-coin stamp handler + Bank12 init wrapper.
//
// Standard objects $82 AND $83 share this init. The discriminator is the
// orientation byte ($15) — which the dispatcher stuffs with the object ID
// itself. Bit 0 of $15 picks between two modes inside the stamp:
//
//   $82 → bit 0 = 0 → UNCONDITIONAL stamp at every cell (subject to the
//                      item-memory gate; see below).
//   $83 → bit 0 = 1 → STAMP only on EVEN columns (skip every other col).
//                      Visible in the trace: cells 0/2/4/6/8/10/12/14
//                      stamp $A400, cells 1/3/5/7/9/11/13/15 skip.
//
// $A400 is the red-coin collectible tile (per yi-shiny's bank reanalysis;
// older comments here described it as a water-surface tile). The
// "non-destructive overlay" behaviour comes from the item-memory gate —
// `item_memory_bit_lookup` (see below) — which reads the savefile's
// per-coordinate item-memory bitmap and skips stamps where the bit is set
// ("this red coin has been collected"). That bitmap is NOT available at
// static-decode time, so for the editor we always treat the gate as "bit
// clear" (= proceed with stamp), which matches what every trace cell
// actually does (unclaimed cells).
//
// Asm sources:
//   CODE_init_special_coin                Bank12.asm:4391 ($12:9C74)
//   CODE_special_coin_stamp               Bank13.asm:9465 ($13:D0E6)
//   CODE_item_memory_bit_lookup           Bank01.asm:13035 ($01:E501)
//
// Asm (verbatim, stamp body):
//
//   CODE_special_coin_stamp:
//     REP #$30
//     LDX $1D
//     JSL CODE_item_memory_bit_lookup     ; A != 0 → gate is SET (skip)
//     BNE skip
//     LDA $15 ; AND #$0001 ; BEQ stamp    ; orientation bit 0 = 0 → stamp
//     LDA $28 ; AND #$0001 ; BNE skip     ; bit 0 = 1 AND col odd → skip
//   stamp:
//     LDX $1D
//     LDA #$A400
//     STA.l !RAM_YI_Level_LevelDataBuffer,x
//   skip:
//     SEP #$30
//     RTL
//
// Asm (init):
//   REP #$20
//   LDX #(CODE_special_coin_stamp-1)>>16
//   LDA #CODE_special_coin_stamp-1
//   JMP CODE_walker_setup_trampoline
//
// Bare trampoline — slope=0, no DP mutations. Both specs confirm every
// "changed" entry in the DP-diff table is "no".

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// Map16 ID the stamp writes. Cart asm: `LDA #$A400`. Red-coin collectible
// tile (item-memory tracked).
const SPECIAL_COIN_TILE = 0xA400;

// ─────────────────────────────────────────────────────────────────────
// CODE_special_coin_stamp — per-cell stamper (Bank13.asm:9465).
//
// At static-decode time we have no access to the per-level savefile
// item-memory bitmap that `CODE_item_memory_bit_lookup` consults — that
// data is built up at runtime by gameplay events (e.g. picking up
// collectibles). We model the gate as always "clear" (bit not set),
// which is what every cell in the trace specs observes. The remaining
// orientation/col-parity gate is fully deterministic.
// ─────────────────────────────────────────────────────────────────────

const specialCoinStamp: PerCellHandler = (state) => {
  // Item-memory gate is treated as "clear" (see header comment) → fall
  // through to the orientation gate.

  // Orientation bit 0 = 0 → unconditional stamp ($82 path).
  // Orientation bit 0 = 1 → skip on odd cols ($83 path).
  if ((state.zp15 & 0x0001) !== 0) {
    if ((state.zp28 & 0x0001) !== 0) return; // odd col → skip
  }
  stampCell(state, SPECIAL_COIN_TILE);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_special_coin (Bank12.asm:4391).
//
// Bare trampoline — same shape as `init_water_open`. Walker reads col/row
// extents from the stream's raw values; init does not mutate $1B/$1C/
// $2A/$2E/$15. Dispatcher stuffs $15 with the object ID itself (so the
// stamp can branch on $82 vs $83).
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x82, 0x83 share this handler.
function initSpecialCoin(state: DecodeState): void {
  walkerSetupTrampoline(state, specialCoinStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Object $84 (`init_special_coin_keepslope`) is a
// sibling but with a different stamp body (CODE_special_coin_stamp_keepslope) and the
// keep-slope trampoline; it lives in its own file.
// ─────────────────────────────────────────────────────────────────────

export function installSpecialCoinHandlers(): void {
  registerStdObjectHandler(0x82, initSpecialCoin);
  registerStdObjectHandler(0x83, initSpecialCoin);
}
