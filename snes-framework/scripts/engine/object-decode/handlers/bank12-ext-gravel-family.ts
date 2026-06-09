// Bank12 extended-object handler — gravel_family (ext IDs $A9, $AA, $AB, $AC).
//
// A 4-way underground-gravel-column family. All four IDs share ONE init
// (CODE_extobj_handler_gravel_family); the dispatch key is the ext ID
// itself, which the init re-encodes into $15 and uses to pick both the row
// extent and the per-column tile table.
//
// Shape: single-column (col extent = stream's 1), WALKER-driven. The init
// sets the row extent and tail-calls the walker trampoline with a per-cell
// stamper (CODE_12C044) that indexes a tile table by the walker's row
// counter ($2C).
//
// ── Asm (init), CODE_extobj_handler_gravel_family @ $12:8F8C (Bank12.asm:2551):
//
//   REP #$20
//   LDA $15 ; AND #$0007 ; DEC ; ASL ; STA $15 ; TAY   ; $15 = ((id&7)-1)*2
//   LDA DATA_128F84,y ; STA $2E                         ; row extent
//   LDX #(CODE_12C044-1)>>16
//   LDA #CODE_12C044-1
//   JMP CODE_walker_setup_trampoline
//
// $15 re-encoding (matches all four specs' $15 deltas):
//   $A9 → ((0xA9&7)-1)*2 = (1-1)*2 = 0
//   $AA → (2-1)*2 = 2
//   $AB → (3-1)*2 = 4
//   $AC → (4-1)*2 = 6
//
// DATA_128F84 @ $12:8F84 (Bank12.asm:2543), word table indexed by re-encoded
// $15 → row extent:
//   dw $0005,$0004,$0003,$0003     ; A9=5, AA=4, AB=3, AC=3
//
// ── Asm (per-cell stamper), CODE_12C044 @ $12:C044 (Bank12.asm:8325):
//
//   REP #$30
//   LDA $2C ; BNE CODE_12C04F      ; row 0 → literal $799D
//   LDA #$799D ; BRA CODE_12C05A
// CODE_12C04F:
//   ASL ; TAY                      ; Y = row*2 (word index)
//   LDX $15
//   LDA DATA_12C03C,x ; STA $00    ; pointer to this variant's tile array
//   LDA ($00),y                    ; tile = array[row]
// CODE_12C05A:
//   LDX $1D ; STA.l buffer,x ; SEP #$30 ; RTL
//
// DATA_12C03C @ $12:C03C (Bank12.asm:8318), word pointer table indexed by $15:
//   dw $C024,$C02C,$C032,$C036
//
// DATA_12C024 @ $12:C024 (Bank12.asm:8294), the 4 concatenated tile arrays
// (read from the asm, NOT the ROM):
//   $C024 (A9): dw $799D,$8E00,$8E01,$8E02,$8D95     ; 5 rows
//   $C02C (AA): dw $799D,$8E01,$8E02,$8D95           ; 4 rows  (= $C024+8)
//   $C032 (AB): dw $799D,$8E02,$8D95                 ; 3 rows  (= $C024+14)
//   $C036 (AC): dw $799D,$799E,$8D94                 ; 3 rows  (= $C024+18)
//
// Each array's row-0 entry is $799D, identical to the literal taken by the
// `LDA $2C : BNE` row-0 fast path — so indexing array[row] for ALL rows
// (including 0) reproduces the cart exactly. Verified against every cell in
// ext-A9/AA/AB/AC spec.json (mapids + buf_addrs).
//
// No PRNG, no neighbour probe, no template-slot read, no item-memory gate.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// Re-encoded-$15 index → row extent (DATA_128F84, Bank12.asm:2543).
const ROW_EXTENT = [0x0005, 0x0004, 0x0003, 0x0003] as const;

// Per-variant tile arrays (DATA_12C024, Bank12.asm:8294), indexed by the
// walker's row counter ($2C). Outer index = re-encoded $15 >> 1
// (i.e. ext ID $A9..$AC → 0..3).
const TILE_TABLES = [
  [0x799D, 0x8E00, 0x8E01, 0x8E02, 0x8D95], // $A9 ($C024)
  [0x799D, 0x8E01, 0x8E02, 0x8D95],         // $AA ($C02C)
  [0x799D, 0x8E02, 0x8D95],                 // $AB ($C032)
  [0x799D, 0x799E, 0x8D94],                 // $AC ($C036)
] as const;

// ─────────────────────────────────────────────────────────────────────
// Per-cell stamper — CODE_12C044 (Bank12.asm:8325).
//
// $15 has already been re-encoded by the init to (variantIndex * 2). We
// recover the variant index as ($15 >> 1) to pick the tile array, then
// index by the walker row counter ($2C). The cart's row-0 fast path and
// the array's own row-0 entry are both $799D, so a single array[row] read
// covers every row.
// ─────────────────────────────────────────────────────────────────────

const gravelStamp: PerCellHandler = (state) => {
  const variant = (state.zp15 >>> 1) & 0x03;
  const row = state.zp2C & 0xff;
  const table = TILE_TABLES[variant]!;
  const tile = table[row];
  if (tile !== undefined) stampCell(state, tile);
};

// ─────────────────────────────────────────────────────────────────────
// Init — CODE_extobj_handler_gravel_family (Bank12.asm:2551).
//
// Re-encode $15 = ((id & 7) - 1) * 2, set the row extent from ROW_EXTENT,
// then dispatch the walker. Col extent ($2A) is left as the stream value
// (1) — these are single-column objects. The stamper recovers the variant
// from the re-encoded $15.
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0xA9, 0xAA, 0xAB, 0xAC share this handler.
function initGravelFamily(state: DecodeState): void {
  const reenc = (((state.zp15 & 0x07) - 1) * 2) & 0xff; // ((id&7)-1)*2
  state.zp15 = reenc;
  const idx = (reenc >>> 1) & 0x03;
  state.zp2E = ROW_EXTENT[idx]!;
  walkerSetupTrampoline(state, gravelStamp);
}

export function installExtGravelFamilyHandlers(): void {
  registerExtObjectHandler(0xA9, initGravelFamily);
  registerExtObjectHandler(0xAA, initGravelFamily);
  registerExtObjectHandler(0xAB, initGravelFamily);
  registerExtObjectHandler(0xAC, initGravelFamily);
}
