// Bank12 extended-object "mushroom small pair" init + per-cell stamper.
//
// Extended objects $B4 and $B5 share ONE init symbol in the cart
// (CODE_extobj_handler_mushroom_small_pair, $12:8FF0). It is a 2×2 WALKER
// object: the init sets a 2×2 rectangle and tail-calls the walker-setup
// trampoline (like the std special-coin / ext pair-dispatch inits). The
// underground "small mushroom" graphic is a 2×2 block whose 4 cells are
// picked from an 8-entry tile table by (row, col).
//
// The two IDs route through the same init/stamper but index DIFFERENT tile
// tables. The discriminator is $15 (the orientation byte = the object ID,
// stuffed by the Bank10 dispatcher): the init does `LDA $15 : AND #$0001 :
// STA $15`, so bit 0 of the ID selects the table at stamp time:
//   $B4 → $15 = 0 → DATA_12C0E8
//   $B5 → $15 = 1 → DATA_12C0F8
//
// The init ALSO seeds a RNG-driven half-table offset:
//   `JSL CODE_prng : AND #$0004 : STA $A1`  → $A1 ∈ {0, 4}
// $A1 picks between the top half (rows 0-1) and bottom half (rows 2-3) of
// the 8-entry table — a runtime cosmetic variant (top mushroom vs an
// alternate). Both trace snapshots captured $A1 = 0; at static-decode time
// the HV-counter noise our LFSR can't replicate (see PRNG carry caveat),
// so we DO call prngNext to keep the call order faithful, then mask it the
// same way ($A1 = prng & 4). The picked variant may differ by ±half-table
// from a specific cart snapshot — cosmetic only.
//
// Stamper CODE_12C108 ($12:C108) per-cell index math (REP #$30):
//   LDA $2C : ASL : ADC $28 : CLC : ADC $A1 : ASL : TAY    ; word offset
//   LDA $15 : BNE odd ; LDA DATA_12C0E8,y : BRA stamp       ; $15==0
//   odd:     LDA DATA_12C0F8,y                              ; $15==1
//   stamp:   LDX $1D : STA.l buffer,x
// i.e. array index = (row*2 + col + $A1). The interleaved
// `LDY $2C : BNE : TAY : LDA $0000,y` step (CODE_12C120) is a no-op on the
// stamped value for the cells the spec observes — row-0 cells still stamp
// the table-read value, rows>=1 BNE past it. We omit it (matches all 8
// spec cells).
//
// Table entries are MIXED: the four `slot_1Axx` entries are per-tileset
// template-slot derefs (`state.templateAt($001Axx)` — confirmed by the
// spec `tpl_read16 slot_1A04 ($1A04) = $0825` etc.), while the `$8D0x`
// entries are literal Map16 IDs (read straight from the table, no
// tpl_read16 event).
//
// Asm sources:
//   CODE_extobj_handler_mushroom_small_pair  Bank12.asm:2602 ($12:8FF0)
//   CODE_12C108 (stamper)                    Bank12.asm:8407 ($12:C108)
//   DATA_12C0E8 (table, $B4)                 ($12:C0E8)
//   DATA_12C0F8 (table, $B5)                 ($12:C0F8)
//
// DATA_12C0E8: dw $1A04,$1A46,$8D00,$8D01, $1A06,$1A4E,$8D06,$8D07
// DATA_12C0F8: dw $1A36,$1A18,$8D02,$8D03, $1A3C,$1A1A,$8D04,$8D05
// (read verbatim from the cart asm via `closure DATA_12C0E8/F8`. The $1Axx
//  entries are template-slot addresses → deref via state.templateAt; the
//  $8Dxx entries are literal Map16 IDs. The spec only exercised $A1=0, i.e.
//  indices 0-3 of each table — the $A1=4 half (indices 4-7) is taken
//  straight from the asm and is therefore UNVERIFIED against a trace cell.)

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';
import { prngNext, RNG_SITE } from '../prng.ts';

// A table entry is either a literal Map16 ID or a per-tileset template
// slot to deref via state.templateAt. The cart stores both as raw words;
// the `slot_*` words happen to be WRAM template-slot addresses ($1Axx).
type TileEntry = { lit: number } | { slot: number };
const lit = (id: number): TileEntry => ({ lit: id });
const slot = (addr: number): TileEntry => ({ slot: addr });

// DATA_12C0E8 ($12:C0E8) — 8-entry tile table for ext $B4 ($15 == 0).
const TABLE_B4: readonly TileEntry[] = [
  slot(0x001A04), slot(0x001A46), lit(0x8D00), lit(0x8D01),
  slot(0x001A06), slot(0x001A4E), lit(0x8D06), lit(0x8D07),
];

// DATA_12C0F8 ($12:C0F8) — 8-entry tile table for ext $B5 ($15 == 1).
const TABLE_B5: readonly TileEntry[] = [
  slot(0x001A36), slot(0x001A18), lit(0x8D02), lit(0x8D03),
  slot(0x001A3C), slot(0x001A1A), lit(0x8D04), lit(0x8D05),
];

const MSP_COL_EXTENT = 2; // init: LDA #$0002 : STA $2A
const MSP_ROW_EXTENT = 2; // init: LDA #$0002 : STA $2E

// ─────────────────────────────────────────────────────────────────────
// makeMushroomStamp — factory for CODE_12C108 (one closure per table).
//
// index = (row*2 + col + $A1), where $A1 ∈ {0,4} is the init's PRNG-seeded
// half-table offset. Resolve template-slot entries via state.templateAt;
// stamp literal entries directly.
// ─────────────────────────────────────────────────────────────────────
function makeMushroomStamp(table: readonly TileEntry[]): PerCellHandler {
  return (state) => {
    // LDA $2C : ASL : ADC $28 : CLC : ADC $A1  →  table index (pre-ASL).
    const idx = ((state.zp2C & 0xff) * 2 + (state.zp28 & 0xff) + (state.zpA1 & 0xffff)) & 0xffff;
    const entry = table[idx];
    if (entry === undefined) return; // past the 8-entry table (defensive)
    const id = 'lit' in entry ? entry.lit : state.templateAt(entry.slot);
    stampCell(state, id); // LDX $1D : STA.l buffer,x
  };
}

const mushroomStampB4 = makeMushroomStamp(TABLE_B4);
const mushroomStampB5 = makeMushroomStamp(TABLE_B5);

// ─────────────────────────────────────────────────────────────────────
// CODE_extobj_handler_mushroom_small_pair (Bank12.asm:2602).
//
// Sets the 2×2 rectangle ($2A=$2E=2, overriding the parser's 1×1 default),
// seeds $A1 from the PRNG (& 4), reduces $15 to its bit-0 selector, then
// runs the walker with the per-$15 stamper.
// ─────────────────────────────────────────────────────────────────────
// Merge: object IDs 0xB4, 0xB5 share this handler.
function initMushroomSmallPair(state: DecodeState): void {
  state.zp2A = MSP_COL_EXTENT; // LDA #$0002 : STA $2A
  state.zp2E = MSP_ROW_EXTENT; // STA $2E (same value)
  // JSL CODE_prng : AND #$0004 : STA $A1 — half-table offset (0 or 4).
  state.zpA1 = prngNext(state, RNG_SITE.initMushroomSmallPair) & 0x0004;
  // LDA $15 : AND #$0001 : STA $15 — collapse object ID to bit-0 selector.
  state.zp15 = state.zp15 & 0x0001;
  const handler = state.zp15 !== 0 ? mushroomStampB5 : mushroomStampB4;
  walkerSetupTrampoline(state, handler);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Ext $B4 and $B5 share the init symbol; the $15 bit-0
// branch (set inside the init) selects the per-ID tile table.
// ─────────────────────────────────────────────────────────────────────
export function installExtMushroomSmallPairHandlers(): void {
  registerExtObjectHandler(0xB4, initMushroomSmallPair);
  registerExtObjectHandler(0xB5, initMushroomSmallPair);
}
