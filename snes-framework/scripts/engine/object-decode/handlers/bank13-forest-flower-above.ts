// Bank13 2x2 structural-block stamp handler + Bank12 init wrapper.
//
// Standard object $71 — 2x2 structural block ($01xx tile range). Fills the
// object's rectangle with a 2x2 phased pattern of structural Map16 tiles
// drawn from the 4-entry table `DATA_2x2_structural_tiles`
// (`$0141`/`$0142`/`$0143`/`$0144`). Phase is selected by column parity
// ($28 bit 0) and row parity ($2C bit 0):
//
//   (col%2, row%2) = (0, 0) -> $0141
//   (col%2, row%2) = (1, 0) -> $0142
//   (col%2, row%2) = (0, 1) -> $0143
//   (col%2, row%2) = (1, 1) -> $0144
//
// Stamp logic is shared with the $70/$72 spike-block variants via the
// `CODE_2x2_block_picker` helper (which takes the 4-entry table pointer
// in DP $00). When those variants get ported they should reuse the same
// `make2x2BlockPicker` helper exported here.
//
// Init handler does two structural fix-ups:
//   - Force the column extent ($2A) to be even — if odd, INC it. This
//     anchors the pattern to even-column boundaries so phasing matches
//     the cart's expectation regardless of caller-supplied length.
//   - Force the row extent ($2E) to exactly 2 — the 2x2 motif is two
//     rows tall regardless of the caller's row length-1 byte. The spec
//     confirms `$2E: 0001 -> 0002` is the only DP mutation observed.
//
// Asm sources:
//   CODE_init_forest_flower_above  Bank12.asm:4178  ($12:9B06)
//   CODE_stamp_forest_flower_above       Bank13.asm:8367  ($13:C87F)
//   DATA_2x2_structural_tiles       Bank13.asm:8376  ($13:C88C)
//   CODE_2x2_block_picker           Bank13.asm:8393  ($13:C8A9)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_2x2_structural_tiles ($13:C88C, Bank13.asm:8376).
//
//   dw $0141, $0142, $0143, $0144
//
// Indexed as words by the (col-parity, row-parity) phase pair below.
// ─────────────────────────────────────────────────────────────────────

const DATA_2x2_structural_tiles: ReadonlyArray<number> = [0x0141, 0x0142, 0x0143, 0x0144];

// ─────────────────────────────────────────────────────────────────────
// CODE_2x2_block_picker ($13:C8A9, Bank13.asm:8393).
//
//   SEP #$20
//   LDA $28 ; AND #$01 ; STA $02       ; $02 = col_parity
//   LDA $2C ; ASL ; ORA $02 ; ASL      ; A = (row<<2) | (col_parity<<1)
//   REP #$20
//   AND #$00FF ; TAY                   ; Y = byte index into dw table
//   LDX $1D
//   LDA ($00),y                        ; word fetch from caller-supplied table
//   STA.l LevelDataBuffer,x
//
// Since the dw table holds 4 entries and the walker constrains
// $2C in {0, 1} (row extent is forced to 2 by the init), the effective
// entry-index is `(row & 1) << 1 | (col & 1)`, i.e.:
//
//   table_index = (row_parity * 2) + col_parity
//
// (Higher row values would wrap mod 32 thanks to the AND #$00FF, but the
// init's row_extent=2 makes that unreachable from $71's call site.)
//
// Exposed as a small factory so the $70/$72 spike-block variants — which
// share the picker with a different 4-entry table — can reuse this
// without re-deriving the bit-twiddle.
// ─────────────────────────────────────────────────────────────────────

export function make2x2BlockPicker(tileTable: ReadonlyArray<number>): PerCellHandler {
  return (state) => {
    const colParity = state.zp28 & 0x01;
    const rowParity = state.zp2C & 0x01;
    const idx = (rowParity << 1) | colParity;
    stampCell(state, tileTable[idx]!);
  };
}

const stampForestFlowerAbove: PerCellHandler = make2x2BlockPicker(DATA_2x2_structural_tiles);

// ─────────────────────────────────────────────────────────────────────
// CODE_init_forest_flower_above ($12:9B06, Bank12.asm:4178).
//
//   REP #$20
//   LDA $2A ; AND #$0001 ; BEQ skip ; INC $2A   ; even-up col extent
//  skip:
//   LDA #$0002 ; STA $2E                         ; force row extent = 2
//   LDX #(CODE_stamp_forest_flower_above-1)>>16
//   LDA #CODE_stamp_forest_flower_above-1
//   JMP walker_setup_trampoline
//
// The col-extent even-up uses a 16-bit AND but only bit 0 matters; INC
// on the full 16-bit $2A is fine because the extent is constrained well
// below 256 in practice. The row-extent store is a full 16-bit `$0002`.
// ─────────────────────────────────────────────────────────────────────

function initForestFlowerAbove(state: DecodeState): void {
  if ((state.zp2A & 0x0001) !== 0) {
    state.zp2A = (state.zp2A + 1) & 0xffff;
  }
  state.zp2E = 0x0002;
  walkerSetupTrampoline(state, stampForestFlowerAbove);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installForestFlowerAboveHandlers(): void {
  registerStdObjectHandler(0x71, initForestFlowerAbove);
}
