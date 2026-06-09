// Bank12 ext-object init handler — grass_shadow_mid (ext ID 0x6B).
//
// Ports CODE_extobj_handler_grass_shadow_mid ($12, yi/Banks/Bank12.asm) and
// its per-cell stamper CODE_12B194 ($12:B194) → CODE_12B1DB ($12:B1DB),
// indexing tile table DATA_12B1C3 ($12:B1C3).
//
// SHAPE: WALKER-DRIVEN multi-cell (shape 2). Same family as grass_shadow_small
// (0x6A, $15=0) and grass_shadow_big (0x6C, $15=4); this is the "mid" variant
// ($15=2). The init re-encodes the orientation byte and writes fixed
// column/row extents, then tail-calls the walker setup trampoline with the
// per-cell handler CODE_12B194. The walker runs synchronously, calling the
// per-cell stamper once per (col,row) cell of the 4×3 rectangle.
//
// Init (from spec.json init_dp_delta — matches the 6A/6C sibling idiom):
//   REP #$10 : LDX #$0002 : STX $15   ; orientation := 2 (selects CODE_12B1DB)
//   LDX #$0004 : LDY #$0003           ; cols := 4, rows := 3
//   STX $2A : STY $2E                 ; $2A=4 (col extent), $2E=3 (row extent)
//   REP #$20 : SEP #$10
//   LDX/LDA #(CODE_12B194-1)          ; per-cell handler
//   JMP CODE_walker_setup_trampoline  ; slope=0, runs the walk
// Confirms spec.json: col_extent 0001→0004, row_extent 0001→0003,
// orientation 6B→02.  ($1B/$1C untouched.)
//
// Per-cell stamper CODE_12B194 ($12:B194):
//   LDA $28 : ASL : STA $00           ; $00 = col*2
//   LDA $2C : ASL ASL ASL : ORA $00   ; A = row*8 + col*2
//   TAY
//   LDX $15 : JSR (DATA_12B18E,x)     ; $15=2 → 2nd word = CODE_12B1DB
//   LDX $1D : STA buffer,x            ; stamp returned tile at current cell
// CODE_12B1DB ($12:B1DB): LDA DATA_12B1C3,y : RTS  — straight table lookup by
// the Y byte offset (= row*8 + col*2), so word index = Y/2 = col + row*4.
//
// DATA_12B1C3 ($12:B1C3) reconstructed from the ext-6B spec.json per-cell
// timeline (every Y index + table-read value logged; all 12 stamping cells
// matched). Word table, row stride 4 (col + row*4):
//   row0 (Y 0/2/4/6):    $7760 $7761 $7763 $7764   (grass band, top)
//   row1 (Y 8/A/C/E):    $7765 $7766 $7768 $7769   (grass band, mid)
//   row2 (Y 10/12/14/16):$01CB $01CC $01CE $01CF   (shadow band, bottom)
// (Mid uses the big family's columns {0,1,3,4} compacted to {0,1,2,3}: the
//  big-table entries $7762/$7767/$01CD are absent here.)
//
// The 4 "subX=-1" cells in the spec (indices 0/4/8/12) are CODE_128874
// walker column-wrap bookkeeping frames, not stamps — no tile output. All 12
// real stamps come from CODE_12B194/CODE_12B1DB.
//
// This is an OVERLAY (2 grass rows + 1 shadow row), NOT a read-modify-write:
// CODE_12B1DB loads the tile straight from DATA_12B1C3 and stamps it; the
// existing $12 cell is never consulted.

import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';
import { registerExtObjectHandler } from './index.ts';

// DATA_12B1C3 ($12:B1C3) — word table, row stride 4 words; indexed [col + row*4].
const GRASS_SHADOW_MID_TILES: readonly number[] = [
  0x7760, 0x7761, 0x7763, 0x7764, // row 0 (top: grass band)
  0x7765, 0x7766, 0x7768, 0x7769, // row 1 (mid: grass band)
  0x01cb, 0x01cc, 0x01ce, 0x01cf, // row 2 (bottom: shadow band)
];

// Ports CODE_12B194 / CODE_12B1DB ($15=2 path): word index = col + row*4.
const perCellGrassShadowMid: PerCellHandler = (state: DecodeState): void => {
  const col = state.zp28 & 0xff;
  const row = state.zp2C & 0xff;
  const idx = (col + row * 4) & 0xf;
  stampCell(state, GRASS_SHADOW_MID_TILES[idx] ?? 0x0000);
};

// Ports CODE_extobj_handler_grass_shadow_mid.
// Sets orientation=2, extents 4×3, dispatches the walker with the per-cell
// stamper. Walker reads $28 (col 0..3) / $2C (row 0..2) per cell.
function initGrassShadowMid(state: DecodeState): void {
  state.zp15 = 0x02; // orientation (selects CODE_12B1DB inside CODE_12B194)
  state.zp2A = 0x04; // col extent
  state.zp2E = 0x03; // row extent
  walkerSetupTrampoline(state, perCellGrassShadowMid);
}

export function installExtGrassShadowMidHandlers(): void {
  // 0x6B only; the 0x16B mirror is automatic (getExtObjectHandler masks id&0xff).
  registerExtObjectHandler(0x6b, initGrassShadowMid);
}
