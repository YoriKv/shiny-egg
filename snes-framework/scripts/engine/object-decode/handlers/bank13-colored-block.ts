// Bank13 colored-block 2-tile stamp handler + Bank12 init wrapper.
//
// Standard objects $A0, $A1, $A2 share this init. They are the three
// colored-block variants — RedBlock ($A0), YellowBlock ($A1), and
// GreenBlock ($A2) — a 1-row, even-width strip of block tiles drawn from
// the 2-entry base table DATA_colored_block_tiles ($7A00/$7A01). The init
// handler re-encodes the dispatcher-supplied $15 (object ID) into a
// per-variant tile offset that the stamp adds onto the base table read:
//
//   $A0 RedBlock    (0b10100000) → ($15 & $0F) = $0 → ASL → $00 → stamps $7A00/$7A01
//   $A1 YellowBlock (0b10100001) → ($15 & $0F) = $1 → ASL → $02 → stamps $7A02/$7A03
//   $A2 GreenBlock  (0b10100010) → ($15 & $0F) = $2 → ASL → $04 → stamps $7A04/$7A05
//
// Init also rounds $2A up to the next even value (so a 1-wide placement
// still produces a 2-cell strip — matches the cart's stamp pairing).
//
// Asm sources:
//   CODE_init_colored_block   Bank12.asm:4686 ($12:9E71)
//   CODE_stamp_water_top_2tile     Bank13.asm:10981 ($13:DACC)
//   DATA_colored_block_tiles           Bank13.asm:10977 ($13:DAC8)
//
// Asm (verbatim, init):
//
//   CODE_init_colored_block:
//     REP #$20
//     LDA $15 ; AND #$000F ; ASL ; STA $15  ; re-encode ID → tile offset
//     LDA $2A ; INC ; AND #$FFFE ; STA $2A  ; round col-extent up to even
//     LDX #(CODE_stamp_water_top_2tile-1)>>16
//     LDA #CODE_stamp_water_top_2tile-1
//     JMP CODE_walker_setup_trampoline
//
// Asm (verbatim, stamp):
//
//   CODE_stamp_water_top_2tile:
//     REP #$30
//     LDX $1D
//     LDA $28 ; AND #$0001 ; ASL ; TAY      ; col-parity → table byte index
//     LDA DATA_colored_block_tiles,y            ; base = $7A00 (col even) / $7A01 (col odd)
//     CLC ; ADC $15                         ; + per-variant offset (00/02/04)
//     STA.l !RAM_YI_Level_LevelDataBuffer,x
//     SEP #$30
//     RTL
//
// All three confirm the DP-diff table: only $15 is mutated by the init
// ($A0 → $00 / $A1 → $02 / $A2 → $04). The trace fixtures use $2A=$0002 /
// $0002 / $0004 (already even) and $2E=$0001 — placements where the
// `INC ; AND #$FFFE` round-up is a no-op, so it can't be cross-checked
// against the trace directly. The cart's behaviour is preserved verbatim.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_colored_block_tiles (Bank13.asm:10977, $13:DAC8).
//
// 2-entry base tile table. Indexed by ($28 & 1) — even col reads $7A00,
// odd col reads $7A01. The init's per-variant offset is then added on
// top to produce the final Map16 ID.
// ─────────────────────────────────────────────────────────────────────
const DATA_colored_block_tiles = [0x7A00, 0x7A01] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_water_top_2tile — per-cell stamper (Bank13.asm:10981).
//
// No shape awareness, no neighbour probe — base table read + $15
// offset add, unconditional stamp. Cell parity selects which of the
// 2 base tiles; the per-variant offset (block color) is latched in $15
// by the init.
// ─────────────────────────────────────────────────────────────────────
const coloredBlock2TileStamp: PerCellHandler = (state) => {
  const idx = state.zp28 & 0x0001;
  const base = DATA_colored_block_tiles[idx]!;
  const tile = (base + (state.zp15 & 0xffff)) & 0xffff;
  stampCell(state, tile);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_colored_block (Bank12.asm:4686).
//
// Re-encodes $15 (object ID, low nibble) into a tile-offset, rounds
// $2A up to even, then tail-calls the standard walker trampoline.
// ─────────────────────────────────────────────────────────────────────
// Merge: object IDs 0xA0 (RedBlock), 0xA1 (YellowBlock), 0xA2 (GreenBlock)
// share this handler.
function initColoredBlock(state: DecodeState): void {
  // LDA $15 ; AND #$000F ; ASL ; STA $15 — masks to low nibble, ASL → byte
  // index into DATA_colored_block_tiles base ($7A00 + offset). Variants $A0/$A1/
  // $A2 produce offsets $00/$02/$04 respectively (red / yellow / green).
  state.zp15 = ((state.zp15 & 0x000F) << 1) & 0xffff;

  // LDA $2A ; INC ; AND #$FFFE ; STA $2A — rounds col-extent up to even.
  // Trace fixtures all enter with $2A already even so this is a no-op
  // there, but the cart performs it unconditionally so we mirror.
  state.zp2A = ((state.zp2A + 1) & 0xFFFE) & 0xffff;

  walkerSetupTrampoline(state, coloredBlock2TileStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Objects $A0/$A1/$A2 are the three colored-block variants
// (RedBlock / YellowBlock / GreenBlock). The neighbouring $A3/$A4 pair
// (breakable-rock 2x2 variant) shares the same "low-nibble of $15 →
// tile-offset" idiom but uses a 4-entry base table (DATA_breakable_rock_tiles)
// and a different bit slice ($15 & $0004); they live in their own file.
// ─────────────────────────────────────────────────────────────────────
export function installColoredBlockHandlers(): void {
  registerStdObjectHandler(0xA0, initColoredBlock);
  registerStdObjectHandler(0xA1, initColoredBlock);
  registerStdObjectHandler(0xA2, initColoredBlock);
}
