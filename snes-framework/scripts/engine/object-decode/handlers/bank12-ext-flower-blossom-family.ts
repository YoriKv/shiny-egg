// Ports CODE_extobj_handler_flower_blossom_family ($12:910B, yi/Banks/Bank12.asm:2752)
// + its per-cell stamper CODE_12C3FF ($12:C3FF, Bank12.asm:8785).
//
// Extended-object family, ext IDs $CA-$D3 (10 IDs sharing one init dispatching
// on $15). Immediate sibling of flower_pattern_family ($C5-$C9) but a DIFFERENT
// shape: this one is SINGLE-CELL, not walker-driven.
//
// SHAPE: SINGLE-CELL. Every spec.json for $CA-$D3 reports `walker_setup: null`
// and exactly one stamped cell; the spec.md says "no walker setup — handler
// stamps inline without CODE_object_stream_walk". The init re-resolves the
// anchor via CODE_get_current_map16_tile, then writes one cell.
//
// DISPATCH KEY: $15 (the ext id), re-encoded to a 0-based variant via
// $15 := $15 - $CA. The stamper folds that straight into the tile constant.
//
// Init (CODE_extobj_handler_flower_blossom_family), verbatim:
//   JSR.w CODE_get_current_map16_tile     ; re-resolve $1D, latch existing tile
//   REP #$30
//   LDA $15 ; SEC ; SBC #$00CA ; STA $15  ; $15 := (id - $CA), variant 0..9
//   JSL.l CODE_12C3FF                       ; stamp the single cell
//   SEP #$30 ; RTL
//
// Stamper (CODE_12C3FF), verbatim:
//   LDA #$79BB ; CLC ; ADC $15              ; tile = $79BB + variant
//   LDX $1D ; STA.l LevelDataBuffer,x       ; stamp at the resolved anchor
//   RTL
//
// So the stamped Map16 is simply $79BB + (id - $CA). No tile table, no
// neighbour probes, no PRNG, no savefile gate. Verified per-cell against
// ext-CA..D3 spec.json: CA->$79BB, CB->$79BC, ... D3->$79C4 (the cart's
// LDA #$79BB + ADC $15 sequence reproduces every traced output exactly).
import type { DecodeState } from '../state.ts';
import { registerExtObjectHandler } from './index.ts';
import { extConstStamp } from './_shared.ts';

// CODE_12C3FF stamper base: LDA #$79BB ; ADC (variant).
const BLOSSOM_BASE_TILE = 0x79BB;

// CODE_extobj_handler_flower_blossom_family — single-cell init + stamp.
// Same epilogue as the ext single-cell-dispatch handler (extConstStamp =
// getCurrentMap16Tile re-resolve + stampCell), but the tile is variant-keyed.
// The cart's SBC #$00CA runs after the JSR, but the variant math is
// independent of $1D/$12, so computing it first is observationally identical.
function initFlowerBlossom(state: DecodeState): void {
  const variant = (state.zp15 & 0xff) - 0xCA;  // SBC #$00CA -> 0-based variant
  if (variant < 0 || variant > 9) return;      // outside $CA-$D3
  // CODE_12C3FF: tile = $79BB + variant, stamped at the re-resolved $1D.
  extConstStamp(state, (BLOSSOM_BASE_TILE + variant) & 0xffff);
}

export function installExtFlowerBlossomFamilyHandlers(): void {
  for (let id = 0xCA; id <= 0xD3; id++) {
    registerExtObjectHandler(id, initFlowerBlossom);
  }
}
