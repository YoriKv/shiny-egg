// Ports the ext-object handler at DATA_extended_object_init_ptrs slot 0x5E. The spec calls it
// `CODE_extobj_handler_donut_block_small`, but that's a stale GoldenEgg
// alias — the live DATA_extended_object_init_ptrs ext init-pointer table maps slot 0x5E (and
// also 0x5F/0x60, out of scope here) to a different label. The real init
// entry is CODE_extobj_handler_donut_block_small ($12:8C21); its
// per-cell stamper is CODE_12B001.
//
// Single-cell ext object. The ext-dispatch parser path has already seeded
// the anchor cell before this handler runs:
//   - state.zp1D = anchor byte offset into levelDataBuffer
//   - state.zp1B / state.zp1C = anchor coords
//   - state.zp15 = extID (0x5E)
//
// Like the other single-cell ext handlers (single_cell_dispatch, stake),
// the init re-resolves the anchor via CODE_get_current_map16_tile (which
// re-runs resolve_screen_page → $1D, latches the existing tile into $12)
// and then stamps one constant tile. No walker, no neighbour probe, no
// PRNG, no template-slot read, no savefile/flag gate.
//
// Asm (verbatim from `closure`):
//   CODE_extobj_handler_donut_block_small ($12:8C21):
//     JSR.w CODE_get_current_map16_tile   ; re-resolve $1D from $1B/$1C, latch $12
//     REP.b #$30
//     JSL.l CODE_12B001
//     SEP.b #$30
//     RTL
//   CODE_12B001 ($12:B001):
//     LDX.b $1D
//     LDA.w #$7502
//     STA.l !RAM_YI_Level_LevelDataBuffer,x
//     RTL
//
// Spec ext-5E: 1 cell, output Map16 $7502 at buffer $7F8310 (offset 0x0310),
// init_dp col_extent=0001 row_extent=0001 — a lone constant stamp.
import type { DecodeState } from '../state.ts';
import { extConstStamp } from './_shared.ts';
import { registerExtObjectHandler } from './index.ts';

// Cart asm: `LDA.w #$7502`. Constant Map16 id stamped at the anchor cell.
const DONUT_BLOCK_SMALL_TILE = 0x7502;

// CODE_extobj_handler_donut_block_small ($12:8C21) + CODE_12B001.
function initDonutBlockSmall(state: DecodeState): void {
  // JSR CODE_get_current_map16_tile — re-resolve $1D (may throw
  // ScreenOverflowError; let it propagate — the parser catches it).
  extConstStamp(state, DONUT_BLOCK_SMALL_TILE);
}

export function installExtDonutBlockSmallHandlers(): void {
  // ext ID 0x5E (the 0x100 mirror is masked automatically by the dispatcher).
  registerExtObjectHandler(0x5e, initDonutBlockSmall);
}
