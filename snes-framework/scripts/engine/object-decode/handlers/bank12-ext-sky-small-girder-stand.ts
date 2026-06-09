// Bank12 EXTENDED-object handler: sky small girder stand (ext $C0).
//
// Walker-driven (shape 2): the init sets a 2-col × 2-row extent and tail-calls
// the (plain) walker trampoline with the per-cell stamper pointer (CODE_12C2CA).
// The trampoline runs the walk synchronously and invokes the stamper for each
// of the 2×2 cells. (Same idiom as bank12-ext-8x16-block.ts.)
//
// The per-cell stamper picks a BASE Map16 id from the cell's ROW counter, then
// stamps base + columnIndex at the walker-resolved buffer offset. Result is a
// 2×2 girder-stand block; the bottom (row-nonzero) row also probes the tile
// below it to choose a "connected" variant:
//
//        col0   col1
//      +------+------+
//      | 8DA7 | 8DA8 |   row 0          → base 8DA7 + col
//      +------+------+
//      | 152A | 152B |   row 1 (default) → base 152A + col   (below ∉ {8DA5,8DA6})
//      +------+------+   row 1 (connect) → base 8F04 + col   (below ∈ {8DA5,8DA6})
//
// Asm sources (V1.0):
//   CODE_extobj_handler_sky_small_girder_stand  Bank12.asm:2683 ($12:908E)
//   CODE_12C2CA (per-cell stamper)              Bank12.asm:8641 ($12:C2CA)
//   CODE_walker_setup_trampoline                Bank12.asm:5689 ($12:A3DB)
//   CODE_get_map16_below                        Bank12.asm:1254 ($12:875D)
//
// Init (CODE_extobj_handler_sky_small_girder_stand), verbatim from `closure`:
//   REP #$20
//   LDA #$0002 : STA $2A : STA $2E         ; col extent = row extent = 2
//   LDX #(CODE_12C2CA-1)>>16 : LDA #(CODE_12C2CA-1)
//   JMP CODE_walker_setup_trampoline        ; runs the walk synchronously
//
// Per-cell stamper (CODE_12C2CA), verbatim from `closure`:
//   REP #$30
//   LDA $2C : BNE CODE_12C2D8                ; dispatch on ROW counter (!= 0)
//     LDA $28 : CLC : ADC #$8DA7 : BRA C2F9  ; row 0 → A = 8DA7 + col
//   CODE_12C2D8:                             ; row != 0
//     LDA $1B : STA $0E                      ; seed probe coord from xy_lo
//     JSL CODE_get_map16_below               ; X ← buffer offset of tile below
//     LDA buffer,x : CMP #$8DA5 : BEQ C2F3
//                    CMP #$8DA6 : BEQ C2F3
//     LDA #$152A : BRA C2F6                  ;   below ∉ {8DA5,8DA6} → base 152A
//   CODE_12C2F3:
//     LDA #$8F04                             ;   below ∈ {8DA5,8DA6} → base 8F04
//   CODE_12C2F6:
//     CLC : ADC $28                          ; A = base + col
//   CODE_12C2F9:
//     LDX $1D : STA buffer,x                 ; STAMP at the walker offset
//     SEP #$30 : RTL
//
// Output selection (verified against the ext-C0 spec.json per-cell trace —
// all 4 stamped cells reproduce exactly):
//   - row 0      → 8DA7 + col → 8DA7 (col0 @ buf 02EA), 8DA8 (col1 @ 02EC)
//   - row 1 (below ∉ {8DA5,8DA6}) → 152A + col → 152A (col0 @ 030A), 152B (col1 @ 030C)
// The trace's row-1 cells take the 152A default (the tile below was not a
// girder-base 8DA5/8DA6 neighbour), matching the probe branch we port.
//
// The 8F04 "connected" branch (below ∈ {8DA5,8DA6}) is UNVERIFIED by the C0
// trace (the test position never had a matching tile below), but is ported
// literally from the asm via probeBelowTile + the same CMPs.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { stampCell, probeBelowTile } from './_shared.ts';
import { walkerSetupTrampoline } from '../walker.ts';

// Cart asm `ADC #$8DA7` — base id for the top (row-0) girder-stand tiles.
const GIRDER_TOP_BASE = 0x8DA7;
// Cart asm `LDA #$152A` — default base for the bottom (row != 0) post tiles.
const GIRDER_BOTTOM_BASE = 0x152A;
// Cart asm `LDA #$8F04` — "connected" base when the tile below is a girder
// base (8DA5/8DA6); selects the variant that joins onto it.
const GIRDER_CONNECT_BASE = 0x8F04;
// Cart asm `CMP #$8DA5` / `CMP #$8DA6` — girder-base neighbour tiles that
// trigger the connected variant.
const CONNECT_NEIGHBOUR_A = 0x8DA5;
const CONNECT_NEIGHBOUR_B = 0x8DA6;

// ─────────────────────────────────────────────────────────────────────
// Per-cell stamper — ports CODE_12C2CA ($12:C2CA).
//
// $28 = column counter, $2C = row counter (the walker maintains both).
// Row 0 → top base; row != 0 → probe the tile below and pick the default
// (152A) or connected (8F04) base. The column index is then added and the
// sum stamped at the walker-resolved buffer offset ($1D, via stampCell).
// ─────────────────────────────────────────────────────────────────────
const perCellSkyGirder: PerCellHandler = (state: DecodeState): void => {
  const col = state.zp28 & 0xff;
  const row = state.zp2C & 0xffff;

  let base: number;
  if (row === 0) {
    // CODE_12C2CA fall-through: row 0 → A = 8DA7 + col.
    base = GIRDER_TOP_BASE;
  } else {
    // CODE_12C2D8: probe the tile below; pick connected (8F04) when it is a
    // girder base (8DA5/8DA6), else the default post base (152A).
    const below = probeBelowTile(state) & 0xffff;
    base =
      below === CONNECT_NEIGHBOUR_A || below === CONNECT_NEIGHBOUR_B
        ? GIRDER_CONNECT_BASE
        : GIRDER_BOTTOM_BASE;
  }

  // Cart: `CLC : ADC $28` → base + column index.
  stampCell(state, (base + col) & 0xffff);
};

// ─────────────────────────────────────────────────────────────────────
// Init handler — ports CODE_extobj_handler_sky_small_girder_stand
// ($12:908E). Sets the 2×2 extent and dispatches the (plain) walker
// trampoline, which runs the walk synchronously and calls perCellSkyGirder
// per cell.
// ─────────────────────────────────────────────────────────────────────
function extSkySmallGirderStand(state: DecodeState): void {
  state.zp2A = 0x0002; // col extent
  state.zp2E = 0x0002; // row extent
  walkerSetupTrampoline(state, perCellSkyGirder);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Ext id $C0 only (the $1C0 mirror is automatic —
// getExtObjectHandler masks id & 0xff).
// ─────────────────────────────────────────────────────────────────────
export function installExtSkySmallGirderStandHandlers(): void {
  registerExtObjectHandler(0xC0, extSkySmallGirderStand);
}
