// Bank12 EXTENDED-object handler: random question block (ext $46).
//
// EXTENDED-object family (4-byte stream record, dispatched by CODE_108C13
// via DATA_extended_object_init_ptrs). No walker — a single
// cell is stamped inline at the parser-resolved anchor ($1D). The Map16 id
// is PRNG-picked from a 4-entry pool ($5F00/$5F01/$5F03/$5F03): a "random
// question block" variant. (Pool index 2 is $5F03, a duplicate of index 3 —
// there is no $5F02 — so $5F03 is picked 2/4 of the time and $5F02 never.)
//
// Name note: the entry handler's asm label is
// `CODE_extobj_handler_h_block_single` (the friendly
// `CODE_extobj_handler_random_question_block` from the spec/assignment does
// not exist as a label), but it IS the random-question-block handler — its
// per-cell stamper `CODE_12ABFF` is aliased
// `CODE_extobj_stamp_random_question_block` in the asm.
//
// Asm sources:
//   CODE_extobj_handler_h_block_single  Bank12.asm:1815 ($12:8A62)
//     aliases: CODE_extobj_handler_random_question_block
//   CODE_get_current_map16_tile         Bank12.asm:1171 ($12:86FD)
//   CODE_12ABFF                         Bank12.asm:6356 ($12:ABFF)
//     aliases: CODE_extobj_stamp_random_question_block
//   CODE_prng                           Bank12.asm:1495 ($12:8875)
//   DATA_12ABF7                         Bank12.asm:6353
//
// Asm (verbatim):
//
//   CODE_extobj_handler_h_block_single:   ; ext-obj ID $46
//     JSR.w CODE_get_current_map16_tile   ; resolve $1D from $1B/$1C, latch $12
//     REP.b #$30
//     JSL.l CODE_12ABFF
//     SEP.b #$30
//     RTL
//
//   DATA_12ABF7:
//     dw $5F00,$5F01,$5F03,$5F03
//
//   CODE_12ABFF:                          ; aka CODE_extobj_stamp_random_question_block
//     JSR.w CODE_prng                     ; A = random byte (low 8 bits)
//     AND.w #$0003                        ; pick = prng & 3  (0..3)
//     ASL                                 ; word index = pick * 2
//     TAX
//     LDA.l DATA_12ABF7,x                 ; pool[pick]
//     LDX.b $1D                           ; resolved anchor offset
//     STA.l !RAM_YI_Level_LevelDataBuffer,x   ; stamp at $1D
//     RTL
//
// PRNG-carry caveat: the pick is a clean `AND #$0003` (no ADC), so there is
// no carry-flag dependence here. The only divergence from a cart snapshot is
// which of the pool entries our deterministic LFSR selects vs. the cart's
// HV-counter-seeded PRNG — purely cosmetic (the question-block variant
// tile). The cell, offset and pool are identical. The spec trace (prng low
// byte $61 → $61 & 3 = 1 → pool[1] = $5F01) is reproduced exactly when the
// PRNG state matches.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState } from '../state.ts';
import { getCurrentMap16Tile } from '../fetch.ts';
import { stampCell } from './_shared.ts';
import { prngNext } from '../prng.ts';

// DATA_12ABF7 (Bank12.asm:6357). 4-entry Map16-ID pool, indexed as words by
// `(prng & 3) * 2` — we index a JS array by `prng & 3` directly. Note entry
// 2 == entry 3 == $5F03 on the cart (no $5F02).
const POOL = [0x5F00, 0x5F01, 0x5F03, 0x5F03] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_extobj_handler_h_block_single (Bank12.asm:1815) — ext $46.
//
// `getCurrentMap16Tile` re-resolves the anchor cell's buffer offset into
// $1D (may throw ScreenOverflowError — let it propagate; the parser
// catches it) and latches the existing tile into $12. Then CODE_12ABFF
// draws one PRNG value, masks to 0..3, and stamps DATA_12ABF7[pick] at $1D.
// ─────────────────────────────────────────────────────────────────────

function extRandomQuestionBlock(state: DecodeState): void {
  // JSR CODE_get_current_map16_tile — re-resolves $1D (and latches $12).
  getCurrentMap16Tile(state);
  // CODE_12ABFF: JSR CODE_prng ; AND #$0003 ; ASL ; TAX ; LDA DATA_12ABF7,X
  const pick = prngNext(state) & 0x0003;
  // LDX $1D ; STA.l buffer,X.
  stampCell(state, POOL[pick]);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Ext id $46 only (the $146 mirror is automatic —
// getExtObjectHandler masks id & 0xff).
// ─────────────────────────────────────────────────────────────────────

export function installExtRandomQuestionBlockHandlers(): void {
  registerExtObjectHandler(0x46, extRandomQuestionBlock);
}
