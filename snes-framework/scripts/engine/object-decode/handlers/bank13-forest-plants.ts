// Bank13 2x2 spike-block (variant A) stamp handler + Bank12 init wrapper.
//
// Standard object $70 — 2x2 ceiling-spike block (variant A). Stamps a
// 2-row × N-column band of ceiling-spike tiles. The cart picks from a
// 4-entry tile table (DATA_2x2_spike_A_tiles) indexed by (col%2, row%2):
//
//                   col%2 = 0      col%2 = 1
//   row%2 = 0       $3D37          $3D38      (top half of spike block)
//   row%2 = 1       $3D45          $3D46      (bottom half of spike block)
//
// Init handler forces the row extent to exactly 2 ($2E = $0002) and
// rounds the column extent up to even ($2A += 1 if odd), so the
// 2×N band always shows a clean spike-block sequence.
//
// Stamp routine is shared with $71 (CODE_2x2_spike_block_B) and $74
// (CODE_2x2_structural_block) via CODE_2x2_block_picker — those siblings
// pass different 4-entry tile tables in via DP $00. Consolidation
// candidate: if/when the B/structural variants land, lift the
// `pick2x2ByParity` helper into `_shared.ts`.
//
// Asm sources:
//   CODE_init_forest_plants  Bank12.asm:4164  ($12:9AEE)
//   CODE_stamp_forest_plants       Bank13.asm:8354  ($13:C86A)
//   CODE_2x2_block_picker        Bank13.asm:8393  ($13:C8A9)
//   DATA_2x2_spike_block_A_tiles Bank13.asm:8362  ($13:C877)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_2x2_spike_block_A_tiles (DATA_2x2_spike_A_tiles, Bank13.asm:8362).
//
// 4-entry literal Map16 ID table consumed by CODE_2x2_block_picker.
// Layout matches the picker's index = (rowParity << 1) | colParity:
//   [0] col=0,row=0  $3D37
//   [1] col=1,row=0  $3D38
//   [2] col=0,row=1  $3D45
//   [3] col=1,row=1  $3D46
// ─────────────────────────────────────────────────────────────────────

const DATA_2x2_spike_block_A_tiles: ReadonlyArray<number> = [
  0x3D37, 0x3D38, 0x3D45, 0x3D46,
];

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_forest_plants (Bank13.asm:8354) +
// CODE_2x2_block_picker (Bank13.asm:8393).
//
// Spike-A stamper:
//   REP #$30
//   LDA #DATA_2x2_spike_block_A_tiles ; STA $00
//   JSR CODE_2x2_block_picker
//   SEP #$30 ; RTL
//
// Picker:
//   SEP #$20
//   LDA $28 ; AND #$01 ; STA $02       ; col parity bit
//   LDA $2C ; ASL ; ORA $02 ; ASL      ; idx = ((row<<1) | colParity) << 1
//   REP #$20
//   AND #$00FF ; TAY                   ; Y = byte offset into word table
//   LDX $1D
//   LDA ($00),Y                        ; tile = table[Y]
//   STA LevelDataBuffer,X
//   RTS
//
// The picker's `ASL` of $2C and the final `ASL` together build an even
// byte offset; the AND #$00FF strips any high-byte garbage from $2C
// before TAY. Equivalent: `tile = table[(rowParity << 1) | colParity]`
// (any high bits of $2C beyond the LSB get masked off by `AND #$00FF`
// after the second ASL — see note below).
//
// Subtle: the picker does *not* mask $2C with #$01 before the first
// ASL. So `idx` actually = `((zp2C & 0x7F) << 1) | colParity`, then
// `<< 1`, then `AND #$00FF`. Because the spike-A table has only 4
// entries, only the bottom 2 bits of the row counter ever matter
// (the 2 rows the init forces). Row extent is fixed at 2, so $2C ∈
// {0, 1} during the walk and `& 0x01` is implicit.
// ─────────────────────────────────────────────────────────────────────

/** Cart `CODE_2x2_block_picker` ($13:C8A9): generic 4-entry tile picker
 *  indexed by (rowParity<<1)|colParity. Shared by every 2x2-pattern
 *  stamp routine ($70, $71, $74) — only the table differs. Consolidate
 *  into `_shared.ts` when the B/structural ports land. */
function pick2x2ByParity(state: DecodeState, table: ReadonlyArray<number>): void {
  const colParity = state.zp28 & 0x01;
  const rowParity = state.zp2C & 0x01;
  const idx = ((rowParity << 1) | colParity) & 0x03;
  stampCell(state, table[idx]!);
}

const stampForestPlants: PerCellHandler = (state) => {
  pick2x2ByParity(state, DATA_2x2_spike_block_A_tiles);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_forest_plants ($12:9AEE, Bank12.asm:4164).
//
//   REP #$20
//   LDA $2A ; AND #$0001 ; BEQ +
//   INC $2A                            ; force even column count
// + LDA #$0002 ; STA $2E                ; force row extent = 2
//   LDX #(CODE_stamp_forest_plants-1)>>16
//   LDA #CODE_stamp_forest_plants-1
//   JMP walker_setup_trampoline
//
// Spec-confirmed DP mutations: $2E flips $0001→$0002, $2A stays the
// same in the trace (col extent was already even $0010). All other DP
// fields unchanged at walker time.
//
// Note: `INC $2A` is on the word at $2A (REP #$20 in scope), so a
// $00FF→$0100 carry is handled correctly. We mirror that with a 16-bit
// add.
// ─────────────────────────────────────────────────────────────────────

function initForestPlants(state: DecodeState): void {
  if ((state.zp2A & 0x0001) !== 0) {
    state.zp2A = (state.zp2A + 1) & 0xffff;
  }
  state.zp2E = 0x0002;
  walkerSetupTrampoline(state, stampForestPlants);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installForestPlantsHandlers(): void {
  registerStdObjectHandler(0x70, initForestPlants);
}
