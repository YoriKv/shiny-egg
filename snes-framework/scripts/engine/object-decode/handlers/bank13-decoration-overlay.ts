// Bank13 decoration-overlay stamp handler + Bank12 init wrapper.
//
// Standard object $F6 — paint Map16 ID $9D8B onto every cell of the
// object's rectangle, BUT only if the cell is currently empty
// (Map16 ID $0000). Non-empty cells are left alone — the existing
// terrain "wins". This is a READ-CONDITIONAL stamp (not blind
// overwrite), matching the object's documented role: a decoration
// laid on top of pre-stamped geometry that never clobbers it.
//
// The init is a bare trampoline-walker into CODE_decoration_overlay; no DP
// mutation. Walker reads col_extent / row_extent / orientation
// straight from the stream-loaded DP fields.
//
// Asm sources:
//   CODE_init_decoration_overlay   Bank12.asm:5520 ($12:A3D1)
//   CODE_decoration_overlay                    Bank13.asm:15321 ($13:FD85)
//
// Asm (verbatim, stamp body):
//
//   CODE_decoration_overlay:
//     REP #$30
//     LDX $1D
//     LDA.l !RAM_YI_Level_LevelDataBuffer,x
//     BNE skip                       ; cell already has a tile → skip
//     LDA #$9D8B                     ; decoration tile
//     STA.l !RAM_YI_Level_LevelDataBuffer,x
//   skip:
//     SEP #$30
//     RTL
//
// Asm (init):
//   REP #$20
//   LDX #(CODE_decoration_overlay-1)>>16
//   LDA #CODE_decoration_overlay-1
//   JMP CODE_walker_setup_trampoline

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// Map16 ID the stamp writes. Cart asm: `LDA #$9D8B`. The walker latches
// the current cell's existing tile into `state.zp12` before invoking the
// per-cell handler, so we use that rather than re-reading the buffer.
const DECORATION_OVERLAY_TILE = 0x9D8B;

// ─────────────────────────────────────────────────────────────────────
// CODE_decoration_overlay — per-cell stamper (Bank13.asm:15321).
//
// Read-conditional: stamp only when the existing cell is $0000 (empty).
// ─────────────────────────────────────────────────────────────────────

const decorationOverlayStamp: PerCellHandler = (state) => {
  if ((state.zp12 & 0xffff) !== 0x0000) return; // cell occupied → skip
  stampCell(state, DECORATION_OVERLAY_TILE);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_decoration_overlay ($12:A3D1, Bank12.asm:5520).
//
// Bare trampoline; walker reads col_extent / row_extent / orientation
// straight from the stream-loaded DP fields. No init-time mutation.
// ─────────────────────────────────────────────────────────────────────

function initDecorationOverlay(state: DecodeState): void {
  walkerSetupTrampoline(state, decorationOverlayStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installDecorationOverlayHandlers(): void {
  registerStdObjectHandler(0xF6, initDecorationOverlay);
}
