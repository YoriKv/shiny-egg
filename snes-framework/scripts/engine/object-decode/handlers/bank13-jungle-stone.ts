// Standard object $2C — init_jungle_stone.
//
// Cart entry: CODE_init_jungle_stone @ $12:9573 (yi/Banks/Bank12.asm:3352).
// Per-cell stamp handler: CODE_jungle_stone @ $13:9549 (yi/Banks/Bank13.asm:2791).
// Stamp-handler data table: DATA_139545 (= JNGL_STN_DT0, Bank13.asm:2780).
//
// World-1 "jungle stone-block": a 2-column-wide vertical block. Row 0 is
// a deterministic 2-tile cap (DATA_139545 = $330E / $3511). The left
// column of the body (col 0, row >= 1) picks a random base tile via
// `prng & $0006 + $90DA` → one of $90DA / $90DC / $90DE / $90E0. The
// right column of the body (col 1, row >= 1) reads the left-neighbour
// tile and stamps `(left + 1)` — a "continuation tile" pairing each
// even-numbered random tile with its $XXdb-suffixed twin.
//
// The init just bumps $2A from 1 to 2 (extra column for the stone-block
// right half) then tail-calls the walker trampoline. Slope is 0; all 3
// handler slots receive CODE_jungle_stone.
//
// Sibling-family note: this is the cleanest member of the jungle family
// — no neighbour-classify, no edge-aware blend pairs. The shared probe-
// left helper pattern (also used by jungle-slope-45deg's
// `probeLeftCellOffset` and by bank13-jungle-mud-wall-lr) is a small
// consolidation candidate but only 3 lines.
//
// asm primary; cross-checked against the trace:
//   row 0 → $330E / $3511 (table[col])
//   row 1+ col 0 → $90DA + (prng & 6) → observed $90DA/DC/DE/E0
//   row 1+ col 1 → readBuf16(left) + 1 → observed $90DB/DD/DF/E1
// No GoldenEgg counterpart for this object (search returned zero hits).

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { getMap16Left } from '../fetch.ts';
import { prngNext } from '../prng.ts';
import { stampCell, setProbeToCurrent, readBuf16 } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_139545 (Bank13.asm:2780) — 2-entry row-0 cap table.
// Indexed by Y = col * 2 (word). Col 0 → $330E, col 1 → $3511.
// ─────────────────────────────────────────────────────────────────────
const DATA_139545 = [0x330E, 0x3511] as const;

// Random body base. PRNG picks `& $0006` (i.e. 0/2/4/6) added to base,
// giving $90DA / $90DC / $90DE / $90E0. The right-column continuation
// tile is base + 1, i.e. $90DB / $90DD / $90DF / $90E1.
const JUNGLE_STONE_BODY_BASE = 0x90DA;

// ─────────────────────────────────────────────────────────────────────
// CODE_jungle_stone ($13:9549, Bank13.asm:2791) — per-cell handler.
//
//   REP #$30
//   LDA $2C ; BNE row-non-zero      ; row 0 branch
//     LDA $28 ; ASL ; TAY ; LDA DATA_139545,y ; BRA store
//   row-non-zero:
//   LDA $28 ; BNE col-non-zero      ; col 0 branch (rows 1+)
//     JSL prng ; AND #$0006 ; CLC ; ADC #$90DA ; BRA store
//   col-non-zero (col 1+, rows 1+):
//     JSR probe_left_tile ; INC
//   store:
//     LDX $1D ; STA buffer,X ; SEP #$30 ; RTL
//
// The cart `ADC #$90DA` lacks a preceding CLC; for our deterministic
// LFSR the carry is always clear coming out of prngNext (no HV-counter
// math), so the result matches a "CLC ; ADC" exactly. Carry-flag
// uncertainty applies only to the variant pick within the 4-tile pool;
// the right-column INC continuation pairing is exact.
// ─────────────────────────────────────────────────────────────────────
const jungleStoneStamp: PerCellHandler = (state) => {
  const row = state.zp2C & 0xffff;
  const col = state.zp28 & 0xff;

  if (row === 0) {
    // Row 0: deterministic cap. col 0 → $330E, col 1 → $3511.
    stampCell(state, DATA_139545[col & 0x01]!);
    return;
  }

  if (col === 0) {
    // Row 1+, col 0: random base in $90DA / $90DC / $90DE / $90E0.
    const variant = prngNext(state) & 0x06;
    stampCell(state, (JUNGLE_STONE_BODY_BASE + variant) & 0xffff);
    return;
  }

  // Row 1+, col 1+: continuation tile = (left neighbour) + 1.
  // CODE_probe_left_tile ($13:FD54): LDA $1B ; STA $0E ; JSL
  // get_map16_left ; LDA buffer,X ; RTS. We mirror that — set probe
  // coord to current cell, fetch the left neighbour's buffer offset,
  // read its 16-bit Map16 ID, then stamp (id + 1).
  setProbeToCurrent(state);
  const leftOff = getMap16Left(state);
  const leftTile = readBuf16(state, leftOff);
  stampCell(state, (leftTile + 1) & 0xffff);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_jungle_stone ($12:9573, Bank12.asm:3352).
//
//   REP #$20
//   INC $2A                                  ; col_extent: 1 → 2
//   LDX #(CODE_jungle_stone-1)>>16            ; bank byte
//   LDA #CODE_jungle_stone-1                  ; ptr-1
//   JMP walker_setup_trampoline               ; slope=0; 3 handler slots = same fn
//
// Spec confirms the $2A bump: col_extent 0001 → 0002.
// ─────────────────────────────────────────────────────────────────────
const initJungleStone: InitHandler = (state) => {
  state.zp2A = (state.zp2A + 1) & 0xffff;
  walkerSetupTrampoline(state, jungleStoneStamp);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent wires this into object-decode/index.ts.
// ─────────────────────────────────────────────────────────────────────
export function installJungleStoneHandlers(): void {
  registerStdObjectHandler(0x2C, initJungleStone);
}
