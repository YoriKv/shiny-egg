// Bank13 contextual spike-row stamp handler + Bank12 init wrapper.
//
// Standard object $8C — a 2-row spike row whose underside (row 2+) is
// context-aware: it inspects the cell already occupied at the stamp
// position ($12) and either overwrites with a transition tile, leaves
// the existing cell alone, or falls through to a normal-row spike tile.
//
//
// Algorithm summary (see asm sources below):
//
//   rows 0..1 ($2C < 2):
//     Y = (rowParity * 4) | (colParity * 2)       ; row* 4, col* 2 word index
//     if $12 ∈ {$00B6..$00BA}:  skip stamp        ; anti-collision: leave
//                                                  existing top-row spikes
//                                                  in place
//     else                       stamp DATA_spike_row_tiles[Y/2]
//
//   rows 2+ ($2C >= 2): inspect $12:
//     $12 == $00C3: if col==0 → skip; else stamp $00C6  (transition tile)
//     $12 == $00C7: stamp $00C6                          (transition tile)
//     $12 == $00C5: stamp $00D5                          (transition tile)
//     $12 == $00C2: stamp $00C6                          (transition tile)
//     otherwise   : skip stamp                           (leave existing cell)
//
// The trace's row-2 cells all show `$????` because the test scenario stamps
// onto an empty buffer where $12 == $0000 — none of the context literals
// match, so the handler returns without stamping. The full algorithm only
// becomes visible when an $8C spike row sits above a curved cap (the
// $00C2/$00C3/$00C5/$00C7 transition tiles produced by adjacent floor or
// slope objects).
//
// Init handler forces row extent to 3 ($2E = $0003). Spec confirms the
// row-extent flip 0001 → 0003 with all other DP fields unchanged.
//
// Asm sources:
//   CODE_init_boo_guy_bomb_room   Bank12.asm:4459  ($12:9CE2)
//   CODE_stamp_boo_guy_bomb_room  Bank13.asm:9856  ($13:D384)
//   DATA_spike_row_tiles             Bank13.asm:9852  ($13:D37C)
//
// No GoldenEgg counterpart — searches for BooGuyBombRoom /
// boo_guy_bomb_room / ContextualSpike / SpikeRow in the ReSharper-loaded
// "ge" solution all return zero (consistent with the other Bank13
// contextual stamp ports in this batch).
//
// Consolidation: this is the first $8C-style stamp that combines a
// 4-entry word table indexed by `(rowParity * 4 | colParity * 2)` with a
// row-bound context check on $12. The structure is similar enough to the
// 2x2 picker family that a future helper could share the index math; the
// $12 anti-collision skip-set is unique enough to keep inline for now.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_spike_row_tiles (Bank13.asm:9852).
//
// 4-entry word table {$016F, $0170, $0171, $0172}. Indexed by
// `(rowParity << 1) | colParity` for rows 0..1.
//
//                  col%2 = 0   col%2 = 1
//   row 0          $016F        $0170
//   row 1          $0171        $0172
// ─────────────────────────────────────────────────────────────────────

const DATA_spike_row_tiles: ReadonlyArray<number> = [
  0x016F, // row 0, col 0
  0x0170, // row 0, col 1
  0x0171, // row 1, col 0
  0x0172, // row 1, col 1
];

// Anti-collision skip-set for the row 0/1 branch. If the underlying
// cell ($12) already holds one of these Map16 IDs, the handler leaves
// it alone (cart: BEQ to CODE_13D3E4 / SEP+RTL).
const ROW01_SKIP_IF_CUR_IN: ReadonlySet<number> = new Set([
  0x00B6, 0x00B7, 0x00B8, 0x00B9, 0x00BA,
]);

// Row-2+ context-tile literals (Bank13.asm:9861-9869).
const CTX_C3_LEFTCAP   = 0x00C3; // skip at col 0; stamp $00C6 elsewhere
const CTX_C7_TRANS     = 0x00C7; // stamp $00C6
const CTX_C5_TRANS     = 0x00C5; // stamp $00D5
const CTX_C2_TRANS     = 0x00C2; // stamp $00C6 (falls into the C7 branch)

const OUT_C6_TRANS = 0x00C6;
const OUT_D5_TRANS = 0x00D5;

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_boo_guy_bomb_room ($13:D384, Bank13.asm:9856).
//
//   REP #$30
//   LDA $2C
//   CMP #$0002
//   BCC CODE_13D3B3            ; rows 0..1 → tile-table branch
//   LDA $12                    ; rows 2+ → context check on existing tile
//   CMP #$00C3 ; BEQ CODE_13D3A5
//   CMP #$00C7 ; BEQ CODE_13D3A9
//   CMP #$00C5 ; BEQ CODE_13D3AE
//   CMP #$00C2 ; BNE CODE_13D3E4   ; mismatch → SEP/RTL (skip stamp)
//   BRA CODE_13D3A9
//
// CODE_13D3A5: LDA $28 ; BEQ CODE_13D3E4 ; fall-through to A9
// CODE_13D3A9: LDA #$00C6 ; BRA CODE_13D3DE
// CODE_13D3AE: LDA #$00D5 ; BRA CODE_13D3DE
//
// CODE_13D3B3 (rows 0..1):
//   ASL ASL                    ; A = $2C * 4
//   STA $00
//   LDA $28 ; AND #$0001 ; ASL ; ORA $00 ; TAY
//   LDA $12
//   CMP #$00B6 ; BEQ skip
//   CMP #$00B7 ; BEQ skip
//   CMP #$00B8 ; BEQ skip
//   CMP #$00B9 ; BEQ skip
//   CMP #$00BA ; BEQ skip
//   LDA DATA_spike_row_tiles,y
//
// CODE_13D3DE: LDX $1D ; STA.l LevelDataBuffer,x
// CODE_13D3E4: SEP #$30 ; RTL
//
// Notes:
//   - Y indexes a *word* table; only the bottom bits matter because
//     $2C ∈ {0,1} for the table branch (row extent is forced to 3 and
//     only rows 0..1 hit CODE_13D3B3). The high byte of A after the
//     final ASL is implicit-zero from `ASL ASL ASL` starting at $2C∈{0,1}.
//   - The C2 case `BRA CODE_13D3A9` short-circuits the BEQ branches and
//     joins the C7 path → stamps $00C6.
// ─────────────────────────────────────────────────────────────────────

const stampBooGuyBombRoom: PerCellHandler = (state) => {
  const row = state.zp2C & 0xff;
  const col = state.zp28 & 0xff;
  const cur = state.zp12 & 0xffff;

  if (row < 2) {
    // Rows 0/1: tile-table branch with anti-collision skip-set.
    if (ROW01_SKIP_IF_CUR_IN.has(cur)) return;
    const idx = ((row & 0x01) << 1) | (col & 0x01);
    stampCell(state, DATA_spike_row_tiles[idx]!);
    return;
  }

  // Row 2+ context-aware branch.
  switch (cur) {
    case CTX_C3_LEFTCAP:
      // Skip at col 0; otherwise fall through and stamp $00C6.
      if (col === 0) return;
      stampCell(state, OUT_C6_TRANS);
      return;
    case CTX_C7_TRANS:
    case CTX_C2_TRANS:
      stampCell(state, OUT_C6_TRANS);
      return;
    case CTX_C5_TRANS:
      stampCell(state, OUT_D5_TRANS);
      return;
    default:
      // No match → SEP+RTL without stamping. Leaves $12 in place.
      return;
  }
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_boo_guy_bomb_room ($12:9CE2, Bank12.asm:4459).
//
//   REP #$20
//   LDA #$0003 ; STA $2E              ; force row extent to 3
//   LDX #(CODE_stamp_boo_guy_bomb_room-$01)>>16
//   LDA #CODE_stamp_boo_guy_bomb_room-$01
//   JMP walker_setup_trampoline       ; all 3 dispatch slots = stamp
//
// Spec-confirmed DP delta: $2E flips 0001 → 0003. All other DP fields
// (xy_lo/xy_hi/$2A/$15) unchanged.
// ─────────────────────────────────────────────────────────────────────

const initBooGuyBombRoom: InitHandler = (state) => {
  state.zp2E = 0x0003;
  walkerSetupTrampoline(state, stampBooGuyBombRoom);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent (object-decode/index.ts) wires this in.
// ─────────────────────────────────────────────────────────────────────

export function installBooGuyBombRoomHandlers(): void {
  registerStdObjectHandler(0x8C, initBooGuyBombRoom);
}
