// Bank12 extended-object "pipe cap pair" handler (ext $9E left / $9F right).
//
// Both ext objects $9E and $9F share ONE init symbol
// (CODE_extobj_handler_pipe_cap_pair, $12:8EB7) and ONE stamp body
// (CODE_12BDC0, $12:BDC0). The ext init-pointer table (DATA_extended_object_init_ptrs) has
// both the $9E and $9F slots pointing at the same init.
//
// Shape: INLINE single-anchor (no walker — spec "walker_setup": null), but
// it lays down TWO cells: the cap tile at the anchor ($1D) and a decorator
// tile in the cell directly BELOW it (via CODE_get_map16_below — NOT a
// raw $1D+$20 add). The dispatch key is $15 (the ext object ID); the init
// reduces it to bit 0 << 1, i.e. $15 := 0 for $9E, 2 for $9F, which then
// indexes the cart's tables in the stamp body.
//
// Asm (verbatim):
//   CODE_extobj_handler_pipe_cap_pair:           ; $12:8EB7  (Bank12.asm:2441)
//     JSR.w CODE_get_current_map16_tile            ; re-resolves $1D, latches $12
//     REP.b #$30
//     LDA.b $15 : AND.w #$0001 : ASL : STA.b $15   ; $15 := (id & 1) << 1 (0 or 2)
//     JSL.l CODE_12BDC0
//     SEP.b #$30
//     RTL
//
//   DATA_12BDBC: dw $8562,$8566                   ; [$9E]=$8562, [$9F]=$8566
//
//   CODE_12BDC0:                                  ; $12:BDC0  (Bank12.asm:8045)
//     REP.b #$30
//     LDX.b $1D
//     LDY.b $15                                     ; 0 ($9E) / 2 ($9F)
//     LDA.b $12 : SEC : SBC.w #$854B : CLC : ADC.w DATA_12BDBC,y
//     STA.l !RAM_YI_Level_LevelDataBuffer,x         ; STAMP anchor cap @ $1D
//     LDA.b $1B : STA.b $0E                          ; probe coord = current cell
//     JSL.l CODE_get_map16_below                     ; X = buffer offset of cell below
//     LDA.b $15 : LSR : CLC : ADC.w #$8104           ; below tile = (id&1)+$8104
//     STA.l !RAM_YI_Level_LevelDataBuffer,x          ; STAMP decorator below
//     SEP.b #$30
//     RTL
//
// Tile math (verified against both spec.json cells, where the underlying
// pre-existing tile $12 = $0000 / empty):
//   anchor = ($12 - $854B + DATA_12BDBC[$15]) & $FFFF
//     $9E: $0000 - $854B + $8562 = $0017   ✓ (spec anchor $0017)
//     $9F: $0000 - $854B + $8566 = $001B   ✓ (spec anchor $001B)
//   below  = ($15 >> 1) + $8104
//     $9E: 0 + $8104 = $8104               ✓ (spec below $8104)
//     $9F: 1 + $8104 = $8105               ✓ (spec below $8105)
//   below offset = get_map16_below(anchor) → spec shows anchor+$20 in both
//     traces ($839C→$83BC, $820A→$822A), reproduced by stampBelowTile.
//
// NOTE: the anchor tile is NOT a constant — it is biased by the tile
// already present under the cap ($12, latched by getCurrentMap16Tile). The
// $8562/$8566 table values are "cap base − $854B already folded in", so the
// cap morphs with whatever Map16 it overlays. Empty cells (the common case
// + both trace cells) give the canonical $0017/$001B caps.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState } from '../state.ts';
import { getCurrentMap16Tile } from '../fetch.ts';
import { stampCell, stampBelowTile } from './_shared.ts';

// DATA_12BDBC ($12:BDBC) — anchor-tile bias table, indexed by $15 (0/2).
// We index by orientation slot (0 = $9E, 1 = $9F) since $15 = slot << 1.
const ANCHOR_BIAS = [0x8562, 0x8566] as const;

// Cart constant: `LDA $12 : SEC : SBC #$854B`.
const ANCHOR_TILE_SUB = 0x854b;
// Cart constant: `LDA $15 : LSR : CLC : ADC #$8104` → below tile base.
const BELOW_TILE_BASE = 0x8104;

// ─────────────────────────────────────────────────────────────────────
// CODE_extobj_handler_pipe_cap_pair ($12:8EB7) + CODE_12BDC0 ($12:BDC0).
//
// getCurrentMap16Tile re-resolves $1D and latches the pre-existing tile
// into $12 (it is the source of the spec's "probe below"? — no: that probe
// is CODE_get_map16_below in the stamp body, reproduced below). May throw
// ScreenOverflowError — let it propagate; the parser catches it.
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x9E, 0x9F share this handler.
function extPipeCapPair(state: DecodeState): void {
  // JSR CODE_get_current_map16_tile — re-resolves $1D, latches $12.
  getCurrentMap16Tile(state);

  // $15 := (id & 1) << 1 → slot 0 ($9E) or 1 ($9F). The $1xx mirror is
  // masked by getExtObjectHandler, so state.zp15 is 0x9E or 0x9F here.
  const slot = state.zp15 & 0x01; // bit 0 = orientation

  // Anchor cap tile: ($12 - $854B + DATA_12BDBC[slot]) & $FFFF.
  const anchor = (state.zp12 - ANCHOR_TILE_SUB + ANCHOR_BIAS[slot]) & 0xffff;
  stampCell(state, anchor); // STA buffer,x @ $1D

  // Decorator tile one cell below (cart: LDA $1B : STA $0E :
  // JSL get_map16_below : ... STA buffer,x). below = slot + $8104.
  const below = (BELOW_TILE_BASE + slot) & 0xffff;
  stampBelowTile(state, below);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Ext $9E and $9F share the init; the $15 (orientation)
// branch selects the tile pair. The $19E/$19F mirrors are automatic
// (getExtObjectHandler masks id & 0xff).
// ─────────────────────────────────────────────────────────────────────

export function installExtPipeCapPairHandlers(): void {
  registerExtObjectHandler(0x9e, extPipeCapPair);
  registerExtObjectHandler(0x9f, extPipeCapPair);
}
