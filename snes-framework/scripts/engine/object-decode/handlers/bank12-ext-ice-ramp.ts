// Ext-object handler: ice_ramp (ext ID 0xA7).
//
// Cart symbol: CODE_extobj_handler_ice_ramp ($12:8F78,
// Bank12.asm:2540) → bare stamper CODE_12C063 ($12:C063).
//
// Despite the "ramp" name there is NO slope/keep-slope walker: the init
// re-resolves the anchor cell then stamps a single constant Map16 tile.
//
// Shape 1 (inline single-cell), no walker, no $15 dispatch, no variants.
//
// Verified against ext-A7 spec.json: one cell, output $799C at buf $7F835A.
// ─────────────────────────────────────────────────────────────────────

import type { DecodeState } from '../state.ts';
import { registerExtObjectHandler } from './index.ts';
import { extConstStamp } from './_shared.ts';

// Cart constant: the stamper CODE_12C063 does `LDA #$799C : STA buffer,x`.
const ICE_RAMP_TILE = 0x799c;

// ─────────────────────────────────────────────────────────────────────
// CODE_extobj_handler_ice_ramp (init) — re-resolves $1D via
// get_current_map16_tile, then JMPs to the constant stamper.
// ─────────────────────────────────────────────────────────────────────

function initIceRamp(state: DecodeState): void {
  extConstStamp(state, ICE_RAMP_TILE);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Ext 0xA7 only; getExtObjectHandler masks id & 0xff so the
// 0x1A7 mirror is automatic — do NOT register it explicitly (ids > 0xff
// throw RangeError in registerExtObjectHandler).
// ─────────────────────────────────────────────────────────────────────

export function installExtIceRampHandlers(): void {
  registerExtObjectHandler(0xa7, initIceRamp);
}
