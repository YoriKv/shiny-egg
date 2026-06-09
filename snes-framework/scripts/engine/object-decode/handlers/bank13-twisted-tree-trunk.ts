// Bank13 spike-pit-with-floor stamp handler + Bank12 init wrapper.
//
// Standard object $6F — spike-pit hazard with bottom-floor cap.
// Stamps a 1-wide vertical column of spike-pit body tiles (PRNG-picked
// from a 4-entry pool); the LAST row of the object swaps to a
// bottom-cap stamper that picks $3D4B when the existing cell matches
// the FloorRow0_Left/Right template tiles (so the spike pit "joins"
// onto the floor edge it sits below). When the cap probe misses, the
// bottom-cap routine falls through into the body PRNG path so the
// bottom cell still gets a sensible body tile.
//
// Asm sources:
//   CODE_init_twisted_tree_trunk  Bank12.asm:4157  ($12:9AE4)
//   CODE_stamp_twisted_tree_trunk       Bank13.asm:8305  ($13:C81E)
//   CODE_spike_pit_body             Bank13.asm:8322  ($13:C831)
//   CODE_spike_pit_bottom_cap       Bank13.asm:8339  ($13:C850)
//   DATA_spike_pit_body_tiles       Bank13.asm:8335  ($13:C848)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { TT } from '../template-slots.ts';
import { prngNext } from '../prng.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_spike_pit_body_tiles (Bank13.asm:8335)
//
// 4-entry literal Map16 ID pool consumed by CODE_spike_pit_body:
// PRNG-picks one via `(prng & 3) << 1` indexed as words.
// ─────────────────────────────────────────────────────────────────────

const DATA_spike_pit_body_tiles = [0x3D3B, 0x3D3C, 0x3D49, 0x3D4A] as const;

/** Literal Map16 ID stamped by the bottom-cap path when the current
 *  cell matches one of the FloorRow0 templates (cart `LDA #$3D4B`). */
const SPIKE_PIT_BOTTOM_CAP_TILE = 0x3D4B;

// ─────────────────────────────────────────────────────────────────────
// CODE_spike_pit_body (Bank13.asm:8322)
//
//   REP #$30
//   JSL CODE_prng
//   AND #$0003 ; ASL ; TAY
//   LDX $1D
//   LDA DATA_spike_pit_body_tiles,y
//   STA buffer,x
//   SEP #$30 ; RTS
// ─────────────────────────────────────────────────────────────────────

const spikePitBody: PerCellHandler = (state) => {
  const idx = prngNext(state) & 0x03;
  stampCell(state, DATA_spike_pit_body_tiles[idx]!);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_spike_pit_bottom_cap (Bank13.asm:8339)
//
//   REP #$30
//   LDA $12                              ; current cell's Map16 ID
//   CMP TileTpl_FloorRow0_LeftLo
//   BEQ stamp_cap
//   CMP TileTpl_FloorRow0_RightLo
//   BNE CODE_spike_pit_body              ; fall through to body PRNG
// stamp_cap:
//   LDX $1D ; LDA #$3D4B ; STA buffer,x
//   SEP #$30 ; RTS
//
// The "match → stamp $3D4B" path makes the bottom of the pit visually
// merge with a floor tile placed directly above it. The fall-through
// to body is important: when the spike pit sits over an empty cell the
// bottom row still needs a sane body tile picked by the same PRNG pool.
// ─────────────────────────────────────────────────────────────────────

const spikePitBottomCap: PerCellHandler = (state) => {
  const cur = state.zp12 & 0xffff;
  const leftTpl  = state.templateAt(TT.FloorRow0_LeftLo);
  const rightTpl = state.templateAt(TT.FloorRow0_RightLo);
  if (cur === leftTpl || cur === rightTpl) {
    stampCell(state, SPIKE_PIT_BOTTOM_CAP_TILE);
    return;
  }
  // Fall-through: body PRNG path (matches BNE CODE_spike_pit_body).
  spikePitBody(state);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_twisted_tree_trunk (Bank13.asm:8305)
//
//   LDX #$00
//   LDA $2C ; INC ; CMP $2E ; BNE +
//   LDX #$02
// + JSR (DATA_spike_pit_dispatch,x)      ; X=0 → body, X=2 → bottom_cap
//   RTL
//
// Row index is bottom-most when ($2C + 1) == $2E (row extent). All
// three walker handler slots are wired to this routine via the init's
// `walker_setup_trampoline` call, so col-parity is irrelevant.
// ─────────────────────────────────────────────────────────────────────

const twistedTreeTrunk: PerCellHandler = (state) => {
  const row = state.zp2C & 0xff;
  const rowExtent = state.zp2E & 0xff;
  if (((row + 1) & 0xff) === rowExtent) {
    spikePitBottomCap(state);
  } else {
    spikePitBody(state);
  }
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_twisted_tree_trunk ($12:9AE4)
//
//   REP #$20
//   LDX #(CODE_stamp_twisted_tree_trunk-$01)>>16
//   LDA #CODE_stamp_twisted_tree_trunk-$01
//   JMP walker_setup_trampoline
//
// Plain trampoline wire-up — same handler for even-col / odd-col / row
// dispatch. Init does NOT mutate any walker-relevant DP fields
// (spec confirms entry == walker-time).
// ─────────────────────────────────────────────────────────────────────

function initTwistedTreeTrunk(state: DecodeState): void {
  walkerSetupTrampoline(state, twistedTreeTrunk);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installTwistedTreeTrunkHandlers(): void {
  registerStdObjectHandler(0x6F, initTwistedTreeTrunk);
}
