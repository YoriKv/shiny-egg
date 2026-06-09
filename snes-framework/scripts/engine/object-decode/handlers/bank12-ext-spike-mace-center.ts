// Bank12 EXTENDED-object handler: spike_mace_center (ext $51).
//
// EXTENDED-object family (4-byte stream record, dispatched by CODE_108C13
// via DATA_extended_object_init_ptrs). Shape-1 single-cell —
// no walker; one fixed cell is stamped inline at the anchor.
//
// The Map16 id is a CONSTANT $0183 — NOT a table/`$15`-keyed lookup. The
// entry first calls CODE_get_current_map16_tile (which resolves the anchor's
// buffer offset into $1D via resolve_screen_page and latches the existing
// tile into $12), then jumps to the bare per-cell stamper CODE_12AE22 that
// writes the constant. CODE_12AE22 has no branch, no table read, and reads
// no decision input — it falls through to CODE_12AE2B which is a bare RTL.
// Confirmed by the trace (single cell, mapid $0183, empty decision_template,
// is_decorator:false, buf_addr $7F82F6 == offset $02F6).
//
// Asm sources:
//   CODE_extobj_handler_spike_mace_center  Bank12.asm:1966 ($12:8B57)
//     aliases: CODE_extobj_handler_spike_mace_center
//   CODE_get_current_map16_tile          Bank12.asm:1171 ($12:86FD)
//   CODE_12AE22                          Bank12.asm:6660 ($12:AE22)
//
// Asm (verbatim):
//
//   CODE_extobj_handler_spike_mace_center:
//     JSR.w CODE_get_current_map16_tile   ; resolve $1D from $1B/$1C, latch $12
//     REP.b #$30
//     JSL.l CODE_12AE22
//     SEP.b #$30
//     RTL
//
//   CODE_12AE22:
//     LDX.b $1D
//     LDA.w #$0183
//     STA.l !RAM_YI_Level_LevelDataBuffer,x
//   CODE_12AE2B:
//     RTL
//
// Identical shape to bank12-ext-single-cell-dispatch.ts (ext $0F): re-resolve
// via getCurrentMap16Tile, then stamp a flat constant at the resolved $1D.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState } from '../state.ts';
import { extConstStamp } from './_shared.ts';

// Cart asm: `LDA.w #$0183`. Constant Map16 id stamped at the anchor cell.
const WHIRLING_CENTER_TILE = 0x0183;

// ─────────────────────────────────────────────────────────────────────
// CODE_extobj_handler_spike_mace_center (Bank12.asm:1966, $12:8B57).
//
// `getCurrentMap16Tile` re-resolves the anchor cell's buffer offset into
// $1D (may throw ScreenOverflowError — let it propagate; the parser
// catches it). Then stamp the constant tile at the resolved $1D, mirroring
// CODE_12AE22.
// ─────────────────────────────────────────────────────────────────────

function extSpikeMaceCenter(state: DecodeState): void {
  // JSR CODE_get_current_map16_tile — re-resolves $1D (and latches $12).
  extConstStamp(state, WHIRLING_CENTER_TILE);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Ext id $51 only (the $151 mirror is automatic —
// getExtObjectHandler masks id & 0xff).
// ─────────────────────────────────────────────────────────────────────

export function installExtSpikeMaceCenterHandlers(): void {
  registerExtObjectHandler(0x51, extSpikeMaceCenter);
}
