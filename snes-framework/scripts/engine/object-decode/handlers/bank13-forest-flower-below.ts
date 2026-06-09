// Bank13 2x2 spike-block (variant B) stamp handler + Bank12 init wrapper.
//
// Standard object $72 — 2x2 spike block, "B" variant. Fills the
// object's rectangle (clamped to row-extent = 2, col-extent rounded up
// to the next even count) with a 2x2 tile pattern picked from a
// 4-entry table indexed by (rowParity << 1) | colParity:
//
//   (col%2, row%2) = (0, 0) -> $3D39  (top-left)
//   (col%2, row%2) = (1, 0) -> $3D3A  (top-right)
//   (col%2, row%2) = (0, 1) -> $3D47  (bottom-left)
//   (col%2, row%2) = (1, 1) -> $3D48  (bottom-right)
//
// Sibling of object $70 (2x2 spike block variant A — tiles $3D37/$3D38
// top, $3D45/$3D46 bottom via DATA_2x2_spike_A_tiles) and object $71
// (2x2 structural block — tiles $0141-$0144 via DATA_2x2_structural_tiles).
// All three share the same Bank12 init shape (force-even col extent +
// force $2E=2) and the same Bank13 cell-picker helper (CODE_2x2_block_picker
// @ $13:C8A9), differing only in their 4-entry tile table.
//
// Asm sources:
//   CODE_init_forest_flower_below  Bank12.asm:4192  ($12:9B1E)
//   CODE_2x2_spike_block_B       Bank13.asm:8380  ($13:C894)
//   DATA_2x2_spike_B_tiles       Bank13.asm:8389  ($13:C8A1)
//   CODE_2x2_block_picker        Bank13.asm:8393  ($13:C8A9) — shared

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_2x2_spike_B_tiles ($13:C8A1) — 4-entry Map16 ID table indexed
// by ((rowParity << 1) | colParity). Top row $3D39/$3D3A; bottom row
// $3D47/$3D48.
// ─────────────────────────────────────────────────────────────────────

const DATA_2x2_spike_B_tiles = [0x3D39, 0x3D3A, 0x3D47, 0x3D48] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_2x2_spike_block_B ($13:C894) → CODE_2x2_block_picker ($13:C8A9)
//
// Asm picker (CODE_2x2_block_picker):
//   SEP #$20
//   LDA $28 ; AND #$01 ; STA $02       ; col parity -> bit 0 (in $02)
//   LDA $2C ; ASL ; ORA $02 ; ASL      ; (rowParity<<1 | colParity) * 2
//   REP #$20 ; AND #$00FF ; TAY        ; Y = byte index into 4-word table
//   LDX $1D ; LDA ($00),y ; STA buf,x  ; stamp 16-bit tile
//
// The final ASL doubles the index for the word-stride table; we just
// index the 4-entry TS array directly.
//
// Note: the asm only ANDs $28 with $01 (col parity), but uses $2C
// untouched and relies on it being 0 or 1 (post-init row extent is
// forced to 2, so $2C only ever advances 0 → 1). We mirror with an
// explicit `& 0x01` mask for clarity / defence-in-depth.
// ─────────────────────────────────────────────────────────────────────

const spikeBlock2x2BStamp: PerCellHandler = (state) => {
  const colParity = state.zp28 & 0x01;
  const rowParity = state.zp2C & 0x01;
  const idx = ((rowParity << 1) | colParity) & 0x03;
  stampCell(state, DATA_2x2_spike_B_tiles[idx]!);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_forest_flower_below ($12:9B1E)
//
//   REP #$20
//   LDA $2A ; AND #$0001 ; BEQ +     ; if col extent is odd
//   INC $2A                          ;   bump it to the next even count
// +:LDA #$0002 ; STA $2E             ; force row extent = 2
//   LDX #bank ; LDA #ptr-1
//   JMP walker_setup_trampoline → per-cell = CODE_2x2_spike_block_B
//
// The spec confirms: row_extent 0001 → 0002 (delta $0001), col extent
// untouched on the captured trace (col=$0010 is already even). The
// odd-col INC path is exercised when the cart object stream supplies an
// odd length-1; our spec scenario doesn't hit that path, but the asm
// reads it so we mirror unconditionally.
// ─────────────────────────────────────────────────────────────────────

function initForestFlowerBelow(state: DecodeState): void {
  // Force even column extent. $2A is the column extent (16-bit logical
  // count; trampoline / walker compares against signed8($28)).
  if ((state.zp2A & 0x0001) !== 0) {
    state.zp2A = (state.zp2A + 1) & 0xffff;
  }
  // Force row extent = 2.
  state.zp2E = 0x0002;

  walkerSetupTrampoline(state, spikeBlock2x2BStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installForestFlowerBelowHandlers(): void {
  registerStdObjectHandler(0x72, initForestFlowerBelow);
}
