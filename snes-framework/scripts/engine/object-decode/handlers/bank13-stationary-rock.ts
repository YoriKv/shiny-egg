// Bank13 decoration-cluster-4state stamp handler + Bank12 init wrapper.
//
// Standard object $9D — "decoration cluster (4-state)". Stamps a rectangle
// of Map16 tiles from the $79xx page. The "4-state" name refers to the
// four per-row "load" sub-handlers selected by an inner X dispatch via
// `DATA_13DA2F`:
//
//   v0:               top row              → DATA_13DA11[Y] = $7900..$7902
//   v3_floorbiased:   bottom row (last)    → DATA_13DA23[Y] = $7909..$790E
//   v1:               interior row, (row+1) even → DATA_13DA17[Y] = $7903..$7905
//   v2:               interior row, (row+1) odd  → DATA_13DA1D[Y] = $7906..$7908
//
// The "Y" passed to each load is a 3-state column bucket built from $28
// vs. $2A: 0 = leftmost col, 2 = interior col, 4 = rightmost col (each as
// a word index, so the table lookup is `LDA tbl,y` with Y being the byte
// offset into a 3-word table).
//
// v3 (last row) has a tileset-aware floor-bias: if the underlying buffer
// tile ($12) equals one of the per-tileset "floor row 0" template slots
// (FloorRow0_LeftLo / FloorRow0_RightLo — both checked), Y is bumped by
// 6, shifting the lookup into the 2nd half of DATA_13DA23 ($790C..$790E).
// In practice this triggers only when this object overlays a fresh floor;
// for empty buffer cells ($12 == $0000) the floor-bias never fires (the
// spec's 18-cell trace confirms — all v3 reads hit $7909/$790A/$790B).
//
// Init handler does NOT mutate any walker-relevant DP fields — bare
// trampoline-walker pointing all 3 walker slots at the same per-cell
// stamp handler.
//
// Asm sources:
//   CODE_init_stationary_rock              Bank12.asm:4659 ($12:9E46)
//   CODE_stamp_stationary_rock                     Bank13.asm:10879 ($13:DA37)
//   DATA_13DA2F (4 sub-handler ptrs)                 Bank13.asm:10873
//   DATA_13DA11 / 13DA17 / 13DA1D / 13DA23 (tile tables)  Bank13.asm:10861..10871
//   CODE_decoration_4state_load_v0..v3_floorbiased   Bank13.asm:10914..10939

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';
import { TT } from '../template-slots.ts';

// ─────────────────────────────────────────────────────────────────────
// Per-state Map16 tile tables (DATA_13DA11 / DATA_13DA17 / DATA_13DA1D
// / DATA_13DA23). Bank13 ROM-resident, indexed by the Y column-bucket
// in 3 (or 6) word entries.
// ─────────────────────────────────────────────────────────────────────

// v0 — top row: $7900..$7902 (left / interior / right).
const DATA_decoration_4state_v0_top = [
  0x7900, 0x7901, 0x7902,
] as const;

// v1 — interior row, (row+1) even: $7903..$7905.
const DATA_decoration_4state_v1_mid_even = [
  0x7903, 0x7904, 0x7905,
] as const;

// v2 — interior row, (row+1) odd: $7906..$7908.
const DATA_decoration_4state_v2_mid_odd = [
  0x7906, 0x7907, 0x7908,
] as const;

// v3 — bottom row with floor-bias. First half is the "non-floor" group
// indexed by Y in {0,2,4}; floor-bias adds +6 (Y in {6,8,10}) to land in
// the second half $790C..$790E.
const DATA_decoration_4state_v3_bottom = [
  0x7909, 0x790A, 0x790B, 0x790C, 0x790D, 0x790E,
] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_stationary_rock ($13:DA37).
//
//   ; --- Build Y (column bucket: 0 / 2 / 4 as word offsets) ---
//   LDY #0
//   LDA $28        ; column counter
//   BEQ row_dispatch    ; col == 0 → Y=0 (left)
//   INY INY             ; Y=2 (interior, tentative)
//   INC ; CMP $2A
//   BNE row_dispatch    ; (col+1) != colExtent → Y=2 (interior)
//   INY INY             ; Y=4 (rightmost col)
//
//   ; --- Build X (row dispatch: 0 / 2 / 4 / 6 as word offsets into
//   ;     DATA_13DA2F) ---
// row_dispatch:
//   LDX #0
//   LDA $2C        ; row counter
//   BEQ stamp           ; row == 0 → X=0 → v0 (top)
//   INX INX             ; X=2 (interior tentative; also = v3 if last)
//   INC ; CMP $2E
//   BEQ stamp           ; (row+1) == rowExtent → X=2 → v3_floorbiased
//   INX INX             ; X=4 (interior, A is row+1)
//   AND #1
//   BEQ stamp           ; (row+1) even → X=4 → v1
//   INX INX             ; X=6 → v2 (interior, (row+1) odd)
// stamp:
//   JSR (DATA_13DA2F,x)   ; one of v0..v3 — returns tile in A
//   LDX $1D ; STA buffer,x
// ─────────────────────────────────────────────────────────────────────

const stampStationaryRock: PerCellHandler = (state) => {
  // --- Column bucket Y (word index 0..2 → use directly as array index). ---
  const col = state.zp28 & 0xff;
  const colExtent = state.zp2A & 0xff;
  let colIdx: number;
  if (col === 0) {
    colIdx = 0;                                     // left
  } else if (((col + 1) & 0xff) !== colExtent) {
    colIdx = 1;                                     // interior
  } else {
    colIdx = 2;                                     // right
  }

  // --- Row dispatch: select one of 4 load variants. ---
  const row = state.zp2C & 0xff;
  const rowExtent = state.zp2E & 0xff;

  let tile: number;
  if (row === 0) {
    // v0 — top row.
    tile = DATA_decoration_4state_v0_top[colIdx]!;
  } else if (((row + 1) & 0xff) === rowExtent) {
    // v3 — bottom row (floor-biased).
    let y = colIdx;
    const cur = state.zp12 & 0xffff;
    const floorLeft  = state.templateAt(TT.FloorRow0_LeftLo);
    const floorRight = state.templateAt(TT.FloorRow0_RightLo);
    if (cur === floorLeft || cur === floorRight) {
      // Asm: `TYA ; CLC ; ADC #6 ; TAY` — bumps Y by 6 bytes = 3 words.
      y += 3;
    }
    tile = DATA_decoration_4state_v3_bottom[y]!;
  } else if ((((row + 1) & 0xff) & 1) === 0) {
    // v1 — interior row, (row+1) even (rows 1, 3, 5, ...).
    tile = DATA_decoration_4state_v1_mid_even[colIdx]!;
  } else {
    // v2 — interior row, (row+1) odd (rows 2, 4, 6, ...).
    tile = DATA_decoration_4state_v2_mid_odd[colIdx]!;
  }

  stampCell(state, tile);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_stationary_rock ($12:9E46).
//
//   REP #$20
//   LDX #(CODE_stamp_stationary_rock-1)>>16
//   LDA #CODE_stamp_stationary_rock-1
//   JMP walker_setup_trampoline
//
// Bare trampoline — no DP mutation (spec's init_dp_delta is all-zeros).
// ─────────────────────────────────────────────────────────────────────

function initStationaryRock(state: DecodeState): void {
  walkerSetupTrampoline(state, stampStationaryRock);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installStationaryRockHandlers(): void {
  registerStdObjectHandler(0x9D, initStationaryRock);
}
