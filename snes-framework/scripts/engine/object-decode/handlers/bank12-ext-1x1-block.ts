// Bank12 extended-object "1x1 block" handler (despite the friendly name,
// lays a 1-row x 2-col strip).
//
// Extended objects are the 4-byte stream record family dispatched by
// CODE_108C13 via DATA_extended_object_init_ptrs. They have
// no width/height stream extents like standard objects — each init seeds
// the walker with FIXED extents and a per-cell stamp.
//
//   ext $11 → CODE_extobj_handler_1x1_block ($12:890E) → per-cell
//             CODE_12A68B ($12:A68B).
//
// The init writes constant extents — row $2E = $0001, col $2A = $0002 (a
// 2-wide, 1-tall strip) — overwriting whatever the stream loader seeded,
// then dispatches the trampoline. The walker stamps two cells (col 0,
// col 1) at row 0. The stamp emits a column-indexed Map16 id:
// `$7797 + $28` (column index), so col 0 → $7797 and col 1 → $7798 —
// confirmed by the trace (`$7F8334`←$7797, `$7F8336`←$7798).
//
// Asm sources:
//   CODE_extobj_handler_1x1_block   Bank12.asm:1612 ($12:890E)
//   CODE_12A68B                     Bank12.asm:5966 ($12:A68B)
//
// Asm (verbatim, init):
//   CODE_extobj_handler_1x1_block:
//     REP.b #$20
//     LDA.w #$0001                       ; \ row extent $2E = $0001
//     STA.b $2E                          ; /
//     INC                                ; \ A = $0002 → col extent
//     STA.b $2A                          ; /   $2A = $0002 (constant)
//     LDX.b #(CODE_12A68B-$01)>>16
//     LDA.w #CODE_12A68B-$01
//     JMP.w CODE_walker_setup_trampoline
//
// Asm (verbatim, per-cell stamp):
//   CODE_12A68B:
//     REP.b #$30
//     LDX.b $1D
//     LDA.b $28                          ; \ Map16 id = $7797 + column
//     CLC ; ADC.w #$7797                 ; /
//     STA.l !RAM_YI_Level_LevelDataBuffer,x
//     SEP.b #$30
//     RTL
//
// The trace's interleaved `CODE_128874` (empty-cell helper) and
// `CODE_128640`/`CODE_1286A2`/`CODE_1286C3` frames are the walker's own
// plumbing, handled inside `walkerSetupTrampoline` — not part of this
// handler.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// Base Map16 id the stamp emits at column 0. Cart asm: `LDA.w #$7797`.
const BLOCK_BASE_TILE = 0x7797;

// ─────────────────────────────────────────────────────────────────────
// CODE_12A68B — per-cell stamper (Bank12.asm:5966).
//
// Stamps `$7797 + column` at the walker's current cell offset ($1D).
// ─────────────────────────────────────────────────────────────────────

const ext1x1BlockStamp: PerCellHandler = (state) => {
  stampCell(state, (BLOCK_BASE_TILE + (state.zp28 & 0xffff)) & 0xffff);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_extobj_handler_1x1_block ($12:890E).
//
// Writes constant extents (row $2E = $0001, col $2A = $0002) then
// dispatches the walker trampoline. These are unconditional constants,
// NOT derived from the incoming stream value — the spec's DP-delta
// "$2A 0001 → 0002" is just the constant overwriting an incoming $0001.
// The walker reads `zp2A`/`zp2E` at dispatch time, so set them first.
// ─────────────────────────────────────────────────────────────────────

function initExt1x1Block(state: DecodeState): void {
  state.zp2E = 0x0001;
  state.zp2A = 0x0002;
  walkerSetupTrampoline(state, ext1x1BlockStamp);
}

export function installExt1x1BlockHandlers(): void {
  registerExtObjectHandler(0x11, initExt1x1Block);
}
