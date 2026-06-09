// Bank12 EXTENDED-object handler: downward_grass_single (ext $4F).
//
// Shape-1 inline single-cell stamper. The init re-resolves the anchor cell
// via CODE_get_current_map16_tile (resolves $1D, latches existing tile into
// $12), then tail-calls the bare per-cell stamper CODE_12AD6F which writes a
// single CONSTANT Map16 id ($014A) at $1D and returns. No walker, no extents,
// no PRNG, no neighbour probes, no template read — confirmed by the trace
// (1 cell, mapid $014A, walker_setup:null, empty decision_template,
// is_decorator:false).
//
// Asm sources:
//   CODE_extobj_handler_downward_grass_single  Bank12.asm:1929 ($12:8B32)
//     aliases: CODE_extobj_handler_downward_grass_single
//     calls:   CODE_get_current_map16_tile, CODE_12AD6F
//   CODE_get_current_map16_tile                Bank12.asm:1171 ($12:86FD)
//   CODE_12AD6F                                Bank12.asm:6558 ($12:AD6F)
//
// Init dispatch: DATA_extended_object_init_ptrs (= DATA_extended_object_init_ptrs) ext
// init-pointer table, slot $4F.
//
// Asm (verbatim):
//
//   CODE_extobj_handler_downward_grass_single:   ; downward-hanging grass tuft
//     JSR.w CODE_get_current_map16_tile          ; resolve $1D from $1B/$1C, latch $12
//     REP.b #$30
//     JSL.l CODE_12AD6F
//     SEP.b #$30
//     RTL
//
//   CODE_12AD6F:
//     LDX.b $1D
//     LDA.w #$014A
//     STA.l !RAM_YI_Level_LevelDataBuffer,x
//     RTL
//
// Trace (ext-4F spec.json): pos (pageX=2,pageY=2,subX=8,subY=8),
//   xy_lo=$88 xy_hi=$22 → anchor buffer $7F8310 (offset $0310), output $014A.
//
// Same shape as bank12-ext-single-cell-dispatch.ts ($0F) — re-resolve via
// getCurrentMap16Tile, then stamp a flat constant.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState } from '../state.ts';
import { extConstStamp } from './_shared.ts';

// Cart asm CODE_12AD6F: `LDA.w #$014A`. Constant Map16 id — the
// downward-hanging grass tuft tile, stamped at the anchor cell.
const DOWNWARD_GRASS_TILE = 0x014a;

// ─────────────────────────────────────────────────────────────────────
// CODE_extobj_handler_downward_grass_single (Bank12.asm:1929, $12:8B32).
//
// `getCurrentMap16Tile` re-resolves the anchor cell's buffer offset into
// $1D (may throw ScreenOverflowError — let it propagate; the parser
// catches it) and latches the pre-existing tile into $12. Then stamp the
// constant tile at the resolved $1D, mirroring CODE_12AD6F.
// ─────────────────────────────────────────────────────────────────────

function extDownwardGrassSingle(state: DecodeState): void {
  // JSR CODE_get_current_map16_tile — re-resolves $1D (and latches $12).
  extConstStamp(state, DOWNWARD_GRASS_TILE);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Ext id $4F only (the $14F mirror is automatic —
// getExtObjectHandler masks id & 0xff).
// ─────────────────────────────────────────────────────────────────────

export function installExtDownwardGrassSingleHandlers(): void {
  registerExtObjectHandler(0x4f, extDownwardGrassSingle);
}
