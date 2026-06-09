// Bank12 EXTENDED-object handler: special coin (ext $17).
//
// This is the EXTENDED-object variant — distinct from the STANDARD-object
// special-coin in `bank13-special-coin.ts` ($82/$83, walker-driven). The
// ext object is a single fixed-shape inline stamp: no walker, one cell.
//
// $A400 is the (red-)coin collectible Map16 tile, item-memory tracked.
//
// Asm sources:
//   CODE_extobj_handler_special_coin   Bank12.asm:1672 ($12:8973)
//   CODE_12A749 (inline stamper)       Bank12.asm:6057 ($12:A749)
//   CODE_item_memory_bit_lookup        Bank01.asm:13064 ($01:E501)
//
// Asm (verbatim):
//
//   CODE_extobj_handler_special_coin:
//     JSR.w CODE_get_current_map16_tile  ; resolves $1D from $1B/$1C, latches $12
//     REP.b #$30
//     JSL.l CODE_12A749
//     SEP.b #$30
//     RTL
//
//   CODE_12A749:
//     LDX.b $1D
//     JSL.l CODE_item_memory_bit_lookup  ; A != 0 → coin already collected (skip)
//     BNE.b CODE_12A758
//     LDA.w #$A400
//     STA.l !RAM_YI_Level_LevelDataBuffer,x
//   CODE_12A758:
//     RTL
//
// Savefile/item-memory gate (model as "clear / proceed with stamp"):
// CODE_item_memory_bit_lookup reads the savefile's per-coordinate
// item-memory bitmap and returns non-zero when this coin's bit is set
// ("already collected"), which makes the stamp branch out. That bitmap is
// NOT available at static-decode time (it's built up at runtime by
// gameplay), so for the editor we always treat the gate as "clear"
// (= proceed with stamp), which matches what the trace cell observes
// (uncollected coin). Same modelling as bank13-special-coin.ts.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState } from '../state.ts';
import { getCurrentMap16Tile } from '../fetch.ts';
import { stampCell } from './_shared.ts';

// Cart asm: `LDA #$A400`. (Red-)coin collectible tile (item-memory tracked).
const SPECIAL_COIN_TILE = 0xA400;

// ─────────────────────────────────────────────────────────────────────
// CODE_extobj_handler_special_coin (Bank12.asm:1672).
//
// Single-cell inline stamp. `getCurrentMap16Tile` re-resolves the anchor
// cell's buffer offset into $1D (may throw ScreenOverflowError — let it
// propagate; the parser catches it). The item-memory gate
// (CODE_item_memory_bit_lookup) is modelled as "clear / proceed" — see
// header — so we stamp unconditionally at the resolved $1D.
// ─────────────────────────────────────────────────────────────────────

function extSpecialCoin(state: DecodeState): void {
  // JSR CODE_get_current_map16_tile — re-resolves $1D (and latches $12).
  getCurrentMap16Tile(state);
  // Item-memory / collected-coin gate treated as "clear" (see header).
  stampCell(state, SPECIAL_COIN_TILE);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Ext id $17 only (the $117 mirror is automatic —
// getExtObjectHandler masks id & 0xff).
// ─────────────────────────────────────────────────────────────────────

export function installExtSpecialCoinHandlers(): void {
  registerExtObjectHandler(0x17, extSpecialCoin);
}
