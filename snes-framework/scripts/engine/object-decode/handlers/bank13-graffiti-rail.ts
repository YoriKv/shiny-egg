// Bank13 graffiti-rail stamp handler + Bank12 init wrapper.
//
// Covers standard objects $50 (vertical graffiti rail) / $51 (horizontal
// graffiti rail) — both decorative — dispatching to
// `CODE_init_graffiti_rail` (Bank12.asm:3720), a bare walker-trampoline that
// invokes `CODE_stamp_graffiti_rail` ($13:B924, Bank13.asm:6505) as the
// odd-col / even-col / row handler. Per-ID variant emerges purely from the
// orientation byte ($15 = std-obj ID) inside the stamp handler.
//
//
// Asm reference (CODE_stamp_graffiti_rail, Bank13.asm:6505):
//   REP #$30
//   LDA $15 ; AND #$0001 ; ASL ; TAY     ; y = (orientation & 1) << 1
//   LDA $12
//   CMP $1C5C ; BEQ override              ; FloorRow0_LeftLo
//   CMP $1C5E ; BEQ override              ; FloorRow0_RightLo
//   CMP $1D94 ; BEQ override              ; slot_1D94
//   CMP $1D96 ; BNE table                 ; slot_1D96
// override:
//   LDY #$1C48 ; BRA stamp
// table:
//   LDA DATA_graffiti_rail_tiles,y ; TAY               ; DATA_graffiti_rail_tiles[y]
// stamp:
//   LDX $1D ; LDA $0000,y ; STA buffer,x  ; deref template slot, stamp
//
// DATA_graffiti_rail_tiles (Bank13.asm:6537):
//   dw $1C46, $1C52
// → orient 0 ($50): WRAM slot $1C46
// → orient 1 ($51): WRAM slot $1C52
//
// Override slot $1C48 fires when the cell currently holds a top-row
// floor template ($1C5C/$1C5E = FloorRow0 family) or one of two extra
// template slots ($1D94 / $1D96, both in the Family6800 trailing block).
// In both observed traces the cells are zero-buffer (no match), so the
// override path is unobserved — port verbatim so it matches behaviour
// when a graffiti rail overlaps a floor's top row.
//
// Init mutates no DP fields — confirmed by both spec.md DP-diff tables
// (all rows "no"). Orientation byte $15 IS the std-obj ID, set by the
// Bank10 dispatcher before this init runs.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { TT } from '../template-slots.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Unnamed template-slot addresses used only by the graffiti-rail family.
// None currently have canonical TT.* names; if a parent sweep finds
// other handlers reading them, promote to TT.* there.
// ─────────────────────────────────────────────────────────────────────
const SLOT_GraffitiRail_Override   = 0x001C48; // forced tile on floor-row overlap
const SLOT_GraffitiRail_Tile_Even  = 0x001C46; // orient 0 ($50): vertical-rail tile
const SLOT_GraffitiRail_Tile_Odd   = 0x001C52; // orient 1 ($51): horizontal-rail tile
const SLOT_GraffitiRail_ExtraCheckA = 0x001D94; // extra under-tile match A
const SLOT_GraffitiRail_ExtraCheckB = 0x001D96; // extra under-tile match B

// DATA_graffiti_rail_tiles (Bank13.asm:6537).
// Indexed by `(orientation & 1)`; entries are WRAM template-slot addrs.
const GRAFFITI_RAIL_TILES: ReadonlyArray<number> = [
  SLOT_GraffitiRail_Tile_Even,
  SLOT_GraffitiRail_Tile_Odd,
];

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_graffiti_rail ($13:B924, Bank13.asm:6505)
//
// Picks a template-slot address based on orientation, with an override
// when the cell already holds a floor-row-top template or one of two
// extra slots. Then dereferences the chosen slot and stamps its 16-bit
// Map16 ID into the walker's current cell.
// ─────────────────────────────────────────────────────────────────────

const stampGraffitiRail: PerCellHandler = (state) => {
  const orientIdx = state.zp15 & 0x01;
  const cur = state.zp12 & 0xffff;

  const floorRow0Left  = state.templateAt(TT.FloorRow0_LeftLo);
  const floorRow0Right = state.templateAt(TT.FloorRow0_RightLo);
  const extraA = state.templateAt(SLOT_GraffitiRail_ExtraCheckA);
  const extraB = state.templateAt(SLOT_GraffitiRail_ExtraCheckB);

  let slot: number;
  if (cur === floorRow0Left || cur === floorRow0Right || cur === extraA || cur === extraB) {
    slot = SLOT_GraffitiRail_Override;
  } else {
    slot = GRAFFITI_RAIL_TILES[orientIdx]!;
  }

  stampCell(state, state.templateAt(slot));
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_graffiti_rail (Bank12.asm:3720)
//
//   REP #$30
//   LDX #(CODE_stamp_graffiti_rail-$01)>>16
//   LDA #CODE_stamp_graffiti_rail-$01
//   ... (stores into $21/$22/$24/$25/$27 — even/odd/row all same handler)
//   JSR walker_setup_trampoline equivalent (JSR object_stream_walk)
//
// Bare trampoline — no DP mutations. Extent/orientation come straight
// from the Bank10 stream record. Verified against the "Init handler DP
// mutations" diff tables in both spec.md files (all rows "no").
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x50, 0x51 share this handler.
function initGraffitiRail(state: DecodeState): void {
  walkerSetupTrampoline(state, stampGraffitiRail);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Object IDs $50/$51 share the same init handler; the
// per-ID tile variant emerges from $15 (= std-obj ID, set by Bank10's
// dispatcher) inside `stampGraffitiRail`.
// ─────────────────────────────────────────────────────────────────────

export function installGraffitiRailHandlers(): void {
  registerStdObjectHandler(0x50, initGraffitiRail);
  registerStdObjectHandler(0x51, initGraffitiRail);
}
