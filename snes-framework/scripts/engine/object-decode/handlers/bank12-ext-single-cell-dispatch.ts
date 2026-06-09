// Bank12 EXTENDED-object handler: single-cell "dispatch" (ext $0F).
//
// EXTENDED-object family (4-byte stream record, dispatched by CODE_108C13
// via DATA_extended_object_init_ptrs). No walker — a single
// fixed cell is stamped inline at the anchor.
//
// Despite the "dispatch" friendly name, the Map16 id is a CONSTANT $00B6 —
// NOT a table/`$15`-keyed lookup. The "dispatch" refers to the entry first
// calling CODE_get_current_map16_tile (which resolves the anchor's buffer
// offset into $1D via resolve_screen_page and latches the existing tile
// into $12), then jumping to the bare per-cell stamper CODE_12A64B that
// writes the constant. The stamper has no branch, no table read, and reads
// no decision input — confirmed by the trace (single cell, mapid $00B6,
// empty decision_template, is_decorator:false).
//
// Asm sources:
//   CODE_extobj_handler_single_cell_dispatch  Bank12.asm:1593 ($12:88F0)
//     aliases: CODE_extobj_handler_single_cell_dispatch
//   CODE_get_current_map16_tile               Bank12.asm:1171 ($12:86FD)
//   CODE_12A64B                               Bank12.asm:5937 ($12:A64B)
//
// Asm (verbatim):
//
//   CODE_extobj_handler_single_cell_dispatch:
//     JSR.w CODE_get_current_map16_tile   ; resolve $1D from $1B/$1C, latch $12
//     REP.b #$30
//     JSL.l CODE_12A64B
//     SEP.b #$30
//     RTL
//
//   CODE_12A64B:
//     LDA.w #$00B6
//     LDX.b $1D
//     STA.l !RAM_YI_Level_LevelDataBuffer,x
//     RTL
//
// Same shape as the EXTENDED special-coin (bank12-ext-special-coin.ts):
// re-resolve via getCurrentMap16Tile, then stamp. Sibling single-cell ext
// objects in the same sequential bank run: ext $11 (1x1 block, $7797+col),
// ext $10 (16x32 block). This one is the simplest — a flat constant.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState } from '../state.ts';
import { extConstStamp } from './_shared.ts';

// Cart asm: `LDA.w #$00B6`. Constant Map16 id stamped at the anchor cell.
const SINGLE_CELL_TILE = 0x00B6;

// ─────────────────────────────────────────────────────────────────────
// CODE_extobj_handler_single_cell_dispatch (Bank12.asm:1593).
//
// `getCurrentMap16Tile` re-resolves the anchor cell's buffer offset into
// $1D (may throw ScreenOverflowError — let it propagate; the parser
// catches it). Then stamp the constant tile at the resolved $1D, mirroring
// CODE_12A64B.
// ─────────────────────────────────────────────────────────────────────

function extSingleCellDispatch(state: DecodeState): void {
  // JSR CODE_get_current_map16_tile — re-resolves $1D (and latches $12).
  extConstStamp(state, SINGLE_CELL_TILE);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Ext id $0F only (the $10F mirror is automatic —
// getExtObjectHandler masks id & 0xff).
// ─────────────────────────────────────────────────────────────────────

export function installExtSingleCellDispatchHandlers(): void {
  registerExtObjectHandler(0x0F, extSingleCellDispatch);
}
