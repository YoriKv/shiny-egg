// Bank12 EXTENDED-object handler: tree_right_grass (ext $4A).
//
// Shape-1 (inline, no walker — spec walker_setup:null). The dispatched init
// (CODE_extobj_handler_tree_right_grass, the DATA_extended_object_init_ptrs entry for ext $4A)
// does:
//   PHB : PHK : PLB
//   JSR.w CODE_get_current_map16_tile   ; resolve $1D, latch existing tile → $12
//   REP.b #$30
//   JSL.l CODE_12ACD3                    ; the stamper below
//   SEP.b #$30 : PLB : RTL
//
// Per-cell stamper CODE_12ACD3 ($12:ACD3, Bank12.asm:6475) — VERBATIM:
//   CODE_12ACD3:
//     LDX.b $1D                            ; X = anchor cell buffer offset
//     LDA.w #$3D4C                         ; CONSTANT grass-right tile
//     STA.l !RAM_YI_Level_LevelDataBuffer,x ; STAMP anchor = $3D4C
//     LDA.b $1B : STA.b $0E                 ; seed probe coord = current cell
//     JSL.l CODE_get_map16_left            ; X = LEFT neighbour's buffer offset
//     LDA.l !RAM_YI_Level_LevelDataBuffer,x ; read LEFT neighbour's existing tile
//   CODE_12ACE8:
//     CMP.w #$3D3B : BEQ CODE_12ACF7
//     CMP.w #$3D49 : BEQ CODE_12ACF7
//     CMP.w #$3D4A : BNE CODE_12ACFF
//   CODE_12ACF7:
//     NOP
//     LDA.w #$3D3C
//     STA.l !RAM_YI_Level_LevelDataBuffer,x ; OVERWRITE left neighbour = $3D3C
//   CODE_12ACFF:
//     RTL
//
// Two parts:
//  1. Anchor: stamp the CONSTANT $3D4C (matches spec cell 0 → $3D4C @
//     $7F83A8). NOT (existing | $3D00) — the asm is an `LDA #$3D4C`.
//  2. Left-edge seam blend: probe the LEFT neighbour; if its existing tile
//     is one of {$3D3B, $3D49, $3D4A} (a grass-right-edge variant), rewrite
//     it to $3D3C so the two grass pieces visually join. Otherwise leave the
//     neighbour alone. This is the "probe left" decision the spec timeline
//     records (no associated output mapid, since in the trace the left cell
//     wasn't one of the three matches → no overwrite). is_decorator:false in
//     the spec only because the cell-extractor classifies the always-present
//     anchor stamp as the primary; the left write is conditional.
//
// `CODE_get_map16_left` ($12:87A1) computes the left neighbour's absolute
// buffer offset (the cart's X) from $0E/$2B/$2C without touching $1D. We
// mirror it via getMap16Left, which returns that offset; read/write the
// left cell with readBuf16/writeBuf16. `LDA $1B : STA $0E` in REP #$30
// copies the full $1B/$1C word into $0E/$0F — exactly setProbeToCurrent.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState } from '../state.ts';
import { getCurrentMap16Tile, getMap16Left } from '../fetch.ts';
import { stampCell, setProbeToCurrent, readBuf16, writeBuf16 } from './_shared.ts';

// Cart asm: `LDA.w #$3D4C`. Constant grass-right Map16 id stamped at anchor.
const TREE_RIGHT_GRASS = 0x3d4c;

// Cart asm: `LDA.w #$3D3C`. Replacement for a matching left neighbour.
const LEFT_SEAM_BLEND = 0x3d3c;

// Left-neighbour match set (CMP #$3D3B / #$3D49 / #$3D4A). If the existing
// left tile is any of these, overwrite it with $3D3C.
const LEFT_BLEND_MATCHES = [0x3d3b, 0x3d49, 0x3d4a] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_12ACD3 — constant anchor stamp + conditional left-edge seam blend.
// The wrapper's preceding CODE_get_current_map16_tile resolves the anchor
// offset into $1D (may throw ScreenOverflowError — let it propagate; the
// parser catches it).
// ─────────────────────────────────────────────────────────────────────

function extTreeRightGrass(state: DecodeState): void {
  // JSR CODE_get_current_map16_tile — resolve $1D (and latch $12).
  getCurrentMap16Tile(state);

  // LDX $1D ; LDA #$3D4C ; STA buffer,x — constant anchor stamp.
  stampCell(state, TREE_RIGHT_GRASS);

  // LDA $1B : STA $0E ; JSL get_map16_left — X = left neighbour offset.
  setProbeToCurrent(state);
  const leftOff = getMap16Left(state);

  // CMP #$3D3B/#$3D49/#$3D4A ; if match, LDA #$3D3C ; STA buffer,x.
  const leftTile = readBuf16(state, leftOff);
  if (LEFT_BLEND_MATCHES.includes(leftTile as (typeof LEFT_BLEND_MATCHES)[number])) {
    writeBuf16(state, leftOff, LEFT_SEAM_BLEND);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Ext id $4A only (the $14A mirror is automatic —
// getExtObjectHandler masks id & 0xff).
// ─────────────────────────────────────────────────────────────────────

export function installExtTreeRightGrassHandlers(): void {
  registerExtObjectHandler(0x4a, extTreeRightGrass);
}
