// Bank13 stamp handler for the width-selectable lift / platform piece
// (standard objects $D8 and $D9 — "lift width-select", a 14-tile shared
// platform whose width and orientation toggle on the object's low bit).
//
// Cart entry points:
//   CODE_init_lift_width_select  ($12:A17A, Bank12.asm:5162)
//   CODE_stamp_lift_14tile       ($13:F167, Bank13.asm:13794)
//   DATA_lift_width_2variant     ($12:A176, Bank12.asm:5157) — {$0004,$0003}
//   DATA_lift_14tile_pattern     ($13:F14B, Bank13.asm:13789) — 14-entry tile pattern
//
// Init handler (Bank12.asm:5162) — picks one of two pre-baked column widths
// (= row_extent), then re-encodes $15 as an orientation phase 0 or $10
// into the stamp's lookup index, and tail-calls into the slope=0 walker
// trampoline pointing at CODE_stamp_lift_14tile:
//
//   REP #$20
//   LDA  $15                      ; orientation byte (object ID at entry: $D8 / $D9)
//   AND  #$0001
//   ASL                           ; A = (id & 1) * 2  ; X = byte index into width word table
//   TAX
//   ASL ASL ASL                   ; A = (id & 1) * 16  (= $00 for $D8, $10 for $D9)
//   STA  $15                      ; orientation phase used by stamp's Y index
//   LDA  DATA_lift_width_2variant,x
//   STA  $2E                      ; row_extent = 4 (for $D8) or 3 (for $D9)
//   LDX.b #(CODE_stamp_lift_14tile-$01)>>16
//   LDA.w #CODE_stamp_lift_14tile-$01
//   JMP  CODE_walker_setup_trampoline
//
// DP delta verified against both specs:
//   $D8: $15=$D8 → $00,  $2E=$0001 → $0004
//   $D9: $15=$D9 → $10,  $2E=$0001 → $0003
//
// Per-cell stamp (CODE_stamp_lift_14tile, Bank13.asm:13794):
//
//   Y = ($2C << 2) | (($28 & 1) << 1) | $15        ; byte index into a 14-word table
//   tile = DATA_lift_14tile_pattern[Y / 2]
//   stamp tile at $1D
//
// The orientation byte ($15 ∈ {$00, $10}) shifts the lookup base — for $D8
// the table is walked from index 0 (8 entries: 4 rows × 2 col-parities),
// for $D9 it starts at index 8 (6 entries: rows 0/1/2 × duplicated parity).
// The $D9 entries duplicate across parity so the same tile appears for
// even and odd columns (its col_extent is 1 anyway).
//
// Verified against specs:
//   $D8 (4 rows × 14 cols, $15=$00):
//     col-even rows 0..3 → $84BA $330C $84BC $84BE (Y=0,4,8,12)
//     col-odd  rows 0..3 → $84BB $3510 $84BD $84BF (Y=2,6,10,14)
//   $D9 (3 rows × 1 col, $15=$10):
//     row 0 → $84C0 (Y=$10), row 1 → $8600 (Y=$14), row 2 → $84C1 (Y=$18)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_lift_width_2variant (Bank12.asm:5157).
// 2-entry word table of row_extent values picked by the init's $15 & 1.
// ─────────────────────────────────────────────────────────────────────

const DATA_lift_width_2variant = [0x0004, 0x0003] as const;

// ─────────────────────────────────────────────────────────────────────
// DATA_lift_14tile_pattern (Bank13.asm:13789).
// 14-entry word table indexed by (row<<2) | (col_odd<<1) | orientation,
// where orientation ∈ {0, $10}. Stored flat; the cart's byte-spaced Y
// halves to give a word index here.
// ─────────────────────────────────────────────────────────────────────

const DATA_lift_14tile_pattern = [
  0x84BA, 0x84BB, 0x330C, 0x3510,
  0x84BC, 0x84BD, 0x84BE, 0x84BF,
  0x84C0, 0x84C0, 0x8600, 0x8600,
  0x84C1, 0x84C1,
] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_lift_14tile (Bank13.asm:13794) — per-cell stamp.
//
// Combines row (×4), column parity (×2), and the init-encoded orientation
// phase into a single byte index, halves it to a word index, and stamps
// the resulting Map16 ID at the walker's current cell.
// ─────────────────────────────────────────────────────────────────────

const liftWidthSelectStamp: PerCellHandler = (state) => {
  const rowPart    = (state.zp2C & 0xff) << 2;          // $2C * 4
  const colParity  = (state.zp28 & 0x01) << 1;          // ($28 & 1) * 2
  const orient     = state.zp15 & 0xff;                 // $00 or $10 (set by init)
  const byteIndex  = (rowPart + colParity + orient) & 0xff;
  const tile = DATA_lift_14tile_pattern[byteIndex >>> 1]!;
  stampCell(state, tile);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_lift_width_select (Bank12.asm:5162).
//
// Mutates DP per the asm:
//   $15 ← ($15 & 1) * $10        (re-encoded orientation phase)
//   $2E ← DATA_lift_width_2variant[$15 & 1]   (row_extent: 4 or 3)
// then tail-calls walkerSetupTrampoline with the per-cell stamp.
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0xD8, 0xD9 share this handler.
function initLiftWidthSelect(state: DecodeState): void {
  const bit = state.zp15 & 0x0001;
  state.zp15 = (bit << 4) & 0xff;                       // $00 or $10
  state.zp2E = DATA_lift_width_2variant[bit]!;          // 4 or 3
  walkerSetupTrampoline(state, liftWidthSelectStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration — shared init drives both std IDs $D8 and $D9 (the cart's
// DATA_standard_object_init_ptrs has the same CODE_init_lift_width_select
// entry at both slots; the init self-selects on $15 & 1).
// ─────────────────────────────────────────────────────────────────────

export function installLiftWidthSelectHandlers(): void {
  registerStdObjectHandler(0xD8, initLiftWidthSelect);
  registerStdObjectHandler(0xD9, initLiftWidthSelect);
}
