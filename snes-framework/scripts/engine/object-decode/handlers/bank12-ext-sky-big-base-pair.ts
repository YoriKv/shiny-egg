// Bank12 extended-object init handler: sky_big_base_pair ($C2 / $C3).
//
// Ports CODE_extobj_handler_sky_big_base_pair ($12:90B1, Bank12.asm:2704).
// Both ext IDs $C2 and $C3 share ONE init handler (reached via the
// DATA_extended_object_init_ptrs ext init-pointer table at
// both ID slots — confirmed by xref). The parser stuffs the object ID into
// $15, and the init re-encodes it into a table-base selector via bit 0.
// Shape-2 (walker-driven): the init fixes a 4×4 cell extent and tail-calls
// the walker trampoline; the per-cell stamper (CODE_12C375) indexes a
// 32-entry word table by (row, col, orientation).
//
// Init (CODE_extobj_handler_sky_big_base_pair, $12:90B1, verbatim):
//   REP #$20
//   LDA #$0004 : STA $2A : STA $2E        ; col extent = row extent = 4
//   LDA $15 : AND #$0001                   ; bit 0 of ext ID: $C2→0, $C3→1
//   ASL : ASL : ASL : ASL                  ; << 4 → $00 / $10
//   STA $15                                ; orientation base
//   LDX #CODE_12C375>>16 : LDA #CODE_12C375-1
//   JMP CODE_walker_setup_trampoline
//
// Per-cell stamper (CODE_12C375, $12:C375, Bank12.asm:8704, verbatim):
//   REP #$30
//   LDA $2C : ASL : ASL                    ; row << 2
//   ADC $28                                ; + col   (carry clear after ASL)
//   CLC : ADC $15                          ; + orientation base ($00 / $10)
//   ASL                                    ; word-scale → byte offset
//   TAY
//   LDA DATA_12C335,y                      ; word table read
//   LDX $1D : STA.l buffer,x               ; stamp (UNCONDITIONAL — no BEQ)
//   RTL
//
// Note: unlike many stampers, CODE_12C375 has NO "BEQ skip" — it stamps the
// table value even when that value is $0000 (so col0/row3 of each block
// writes a $0000 tile, exactly as spec cells 4 and 19 show). We replicate
// that: stamp unconditionally.
//
// The 4 "subX=-1" trace cells per spec (CODE_128874) are the walker's
// row-wrap bookkeeping, not stamps — the walker emits them itself, so the
// per-cell handler never sees them.
//
// Verified: all 16 stamped cells of BOTH $C2 and $C3 reproduce the
// spec.json (col,row)→Map16 outputs exactly with the formula + table below
// (replayed the walker counters against every spec cell, 0 mismatches).
// $0000 entries (col0/row3 of each orientation block) correctly suppress
// the stamp (spec cells 4 and 19 leave a $0000 tile, matching BEQ skip).

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// DATA_12C335 ($12:C335). 32-entry word table, two 4×4 blocks (row-major,
// 4 rows of 4 cols per orientation): entries 0..15 = orientation $00 ($C2),
// entries 16..31 = orientation $10 ($C3) — the per-cell *2 word-scale turns
// the $10 orientation base into byte offset $20 = word-entry 16.
const DATA_12C335 = [
  // orientation $C2 ($15 = $00) — record_addr $12C335..$12C353
  0x8D96, 0x8D97, 0x8D98, 0x8D99, // row 0
  0x152C, 0x152D, 0x152E, 0x152F, // row 1
  0x8DB4, 0x8DB5, 0x8DB6, 0x8DB7, // row 2
  0x0000, 0x8DC3, 0x8DC4, 0x8DC5, // row 3 ($0000 at col 0)
  // orientation $C3 ($15 = $10) — record_addr $12C355..$12C373
  0x8DD1, 0x8DD2, 0x8DD3, 0x8DD4, // row 0
  0x8F00, 0x8F01, 0x8F02, 0x8F03, // row 1
  0x8DD5, 0x8DD6, 0x8DD7, 0x8DD8, // row 2
  0x0000, 0x8DD9, 0x8DDA, 0x8DDB, // row 3 ($0000 at col 0)
] as const;

// CODE_12C375 — per-cell stamper. $2C = row counter, $28 = col counter,
// $15 = orientation base ($00 / $10). Cart computes a BYTE offset into the
// word table — `(((row<<2) + col + $15) << 1)` then `LDA tbl,y`; here we
// index the word array directly (so drop the final << 1).
const skyBigBasePairStamp: PerCellHandler = (state) => {
  const row = state.zp2C & 0xff;
  const col = state.zp28 & 0xff;
  const orient = state.zp15 & 0xff; // $00 ($C2) or $10 ($C3)
  const idx = ((row << 2) + col + orient) & 0x1f; // word-entry index 0..31
  const tile = DATA_12C335[idx] ?? 0;
  stampCell(state, tile); // UNCONDITIONAL — cart has no BEQ skip
};

// CODE_extobj_handler_sky_big_base_pair — shared init for $C2 and $C3.
// Merge: object IDs 0xC2, 0xC3 share this handler.
function initSkyBigBasePair(state: DecodeState): void {
  state.zp2A = 0x0004; // col extent
  state.zp2E = 0x0004; // row extent
  // $15 = (id & $0001) << 4  →  $C2 → $00, $C3 → $10.
  state.zp15 = ((state.zp15 & 0x01) << 4) & 0xff;
  walkerSetupTrampoline(state, skyBigBasePairStamp);
}

export function installExtSkyBigBasePairHandlers(): void {
  registerExtObjectHandler(0xc2, initSkyBigBasePair);
  registerExtObjectHandler(0xc3, initSkyBigBasePair);
}
