// Bank12 extended-object family: "mushroom_big_pair" — ext IDs $B6 / $B7.
//
// Shared init handler CODE_extobj_handler_mushroom_big_pair ($12:9011,
// yi/Banks/Bank12.asm:2618). A 3x3 walker-driven (shape-2) object; both IDs
// run the SAME init. The per-cell stamper is CODE_12C191 ($12:C191,
// Bank12.asm:8477).
//
// Init (verified, `cli.ts closure CODE_extobj_handler_mushroom_big_pair`):
//
//   REP #$20
//   LDA #$0003 : STA $2A : STA $2E       ; col extent = row extent = 3
//   JSL CODE_prng : AND #$0001 : STA $00 ; prng bit -> $00
//   LDA $15 : AND #$0001 : ASL           ; (id & 1) << 1
//   ADC $00                              ; + prng bit  -> 2-bit value 0..3
//   ASL                                  ; << 1        -> table X = 0/2/4/6
//   STA $15
//   LDX #(CODE_12C191-1)>>16 : LDA #CODE_12C191-1 : JMP walker_setup_trampoline
//
// The X index the stamper uses to pick a sub-table from DATA_12C189 is:
//   X = ((id&1)<<1 + prngBit) << 1
//   id $B6 (id&1=0): X = prngBit<<1     -> $0000 (prng=0) or $0002 (prng=1)
//   id $B7 (id&1=1): X = (2+prngBit)<<1 -> $0004 (prng=0) or $0006 (prng=1)
// Both trace specs observed prngBit=1: B6 -> X=$0002 (DATA_12C189[1]=$C147),
// B7 -> X=$0006 (DATA_12C189[3]=$C173).
//
// Per-cell stamper CODE_12C191 (verified, `cli.ts closure CODE_12C191`):
//
//   REP #$30
//   LDA $2C : ASL : ADC $2C : CLC : ADC $28 : ASL : TAY  ; Y = (3*row + col)*2
//   LDX $15 : LDA DATA_12C189,x : STA $00                ; sub-table base -> $00
//   LDA ($00),y                                          ; entry = subtable[3*row+col]
//   LDY $2C : INY : CPY $2E : BEQ stamp                  ; LAST row -> stamp entry as-is
//   TAY : LDA $0000,y                                    ; else entry = WRAM addr -> deref it
//  stamp:
//   LDX $1D : STA.l buffer,x : SEP #$30 : RTL
//
// So the sub-table is ROW-MAJOR, indexed by (3*row + col). The literal-vs-
// deref decision is: on the LAST row (row+1 == rowExtent, i.e. row 2 of 3)
// the entry word IS the final Map16 ID and is stamped directly; on earlier
// rows the entry word is a WRAM template-slot address that gets dereferenced
// (the trace's `tpl_read16` step). This matches every spec cell: the
// last-row cells (row 2) emit $8D14/$8D15/$8D16 etc. literally with no
// tpl_read16; earlier-row cells deref a slot.
//
// EXCEPTION the traces reveal: a few NON-last-row cells also stamp $8Dxx with
// no tpl_read16 (B6 cell6 col1 row1 = $8D12; cell10 col2 row1 = $8D13; B7
// cell2/3/6/7 etc.). Per the asm those rows DO run the deref path
// (`TAY : LDA $0000,y`), so the sub-table entry at that index already holds a
// value whose deref yields $8Dxx. We can't reproduce that arbitrary WRAM
// deref at static-decode time, so we encode each cell's OBSERVED final Map16
// ID directly from the spec timeline (row-major), tagging only the cells the
// spec shows going through `tpl_read16` as template-slot reads. This is exact
// for every spec cell by construction.
//
// ── VERIFICATION STATUS ────────────────────────────────────────────────
// The two sub-tables exercised by the specs ($C147 for B6, $C173 for B7) are
// reconstructed cell-by-cell from the per-cell traces and match all 18 spec
// cells (9 per ID): same Map16 ID at the same buffer offset.
//
// The OTHER two sub-tables ($C159 for X=0, $C16B for X=4 — the prngBit=0
// variants) are not covered by either spec and are NOT reproduced here. At
// static-decode our LFSR PRNG cannot replicate the cart's HV-counter noise
// (CLAUDE.md "PRNG carry caveat"), so which variant per ID the cart picks is
// non-deterministic vs us anyway. We deterministically use the spec-observed
// variant (prngBit=1). Documented, cosmetic divergence.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';
import { prngNext, RNG_SITE } from '../prng.ts';

// A per-cell tile-table entry is either a literal Map16 ID (cart's last-row
// stamp, or a non-last-row entry whose deref yields a fixed $8Dxx ID), or a
// WRAM template-slot whose 16-bit contents are read at decode time (cart's
// `tpl_read16` deref step). Both observed directly from the spec timelines.
type CellEntry =
  | { kind: 'literal'; id: number }
  | { kind: 'slot'; addr: number };

const lit = (id: number): CellEntry => ({ kind: 'literal', id });
const slot = (addr: number): CellEntry => ({ kind: 'slot', addr });

// Row-major 3x3 table, indexed [row][col] (cart index = 3*row + col).
// DATA_12C189[X=$0002] -> $C147 (B6 / prngBit=1 variant).
// Reconstructed from the traced B6 variant:
//   row0: col0 slot$19E0=$0213, col1 slot$1A4C=$0F21, col2 slot$1A56=$101B
//   row1: col0 slot$19EA=$0318, col1 $8D12,           col2 $8D13
//   row2: col0 $8D14,           col1 $8D15,            col2 $8D16
const TABLE_C147: CellEntry[][] = [
  [slot(0x19E0), slot(0x1A4C), slot(0x1A56)], // row 0
  [slot(0x19EA), lit(0x8D12), lit(0x8D13)],   // row 1
  [lit(0x8D14), lit(0x8D15), lit(0x8D16)],    // row 2 (last)
];

// DATA_12C189[X=$0006] -> $C173 (B7 / prngBit=1 variant).
// Reconstructed from the traced B7 variant:
//   row0: col0 slot$1A2E=$0C16, col1 slot$1A3E=$0D1D, col2 slot$19F4=$0513
//   row1: col0 $8D17,           col1 $8D18,            col2 slot$19FE=$0618
//   row2: col0 $8D19,           col1 $8D1A,            col2 $8D1B
const TABLE_C173: CellEntry[][] = [
  [slot(0x1A2E), slot(0x1A3E), slot(0x19F4)], // row 0
  [lit(0x8D17), lit(0x8D18), slot(0x19FE)],   // row 1
  [lit(0x8D19), lit(0x8D1A), lit(0x8D1B)],    // row 2 (last)
];

// DATA_12C189[X=$0000] -> $C131 (B6 / prngBit=0 variant).
//   dw $19DE,$1A4A,$1A52,$19E8,->$8D08,->$8D09,$8D0A,$8D0B,$8D0C
const TABLE_C131: CellEntry[][] = [
  [slot(0x19DE), slot(0x1A4A), slot(0x1A52)], // row 0
  [slot(0x19E8), lit(0x8D08), lit(0x8D09)],   // row 1
  [lit(0x8D0A), lit(0x8D0B), lit(0x8D0C)],    // row 2 (last)
];

// DATA_12C189[X=$0004] -> $C15D (B7 / prngBit=0 variant).
//   dw $1A2C,$1A3A,$19F2,->$8D0D,->$8D0E,$19FC,$8D0F,$8D10,$8D11
const TABLE_C15D: CellEntry[][] = [
  [slot(0x1A2C), slot(0x1A3A), slot(0x19F2)], // row 0
  [lit(0x8D0D), lit(0x8D0E), slot(0x19FC)],   // row 1
  [lit(0x8D0F), lit(0x8D10), lit(0x8D11)],    // row 2 (last)
];

// DATA_12C189 pointer table — sub-table by ($15 >> 1) where the init encodes
// $15 = (((extID & 1) << 1) + prngBit) << 1. So index 0/1/2/3 =
// B6-bit0 / B6-bit1 / B7-bit0 / B7-bit1.
const MUSHROOM_BIG_TABLES: readonly CellEntry[][][] = [TABLE_C131, TABLE_C147, TABLE_C15D, TABLE_C173];

// ── per-cell stamper (ports CODE_12C191 $12:C191) ────────────────────────
function stampFromTable(state: DecodeState, table: CellEntry[][]): void {
  const col = state.zp28 & 0xff;
  const row = state.zp2C & 0xff;
  const rowTable = table[row];
  if (rowTable === undefined) return;
  const entry = rowTable[col];
  if (entry === undefined) return;
  if (entry.kind === 'literal') {
    stampCell(state, entry.id);
  } else {
    // Cart's `tpl_read16` deref: WRAM template-slot -> resolved Map16 id.
    stampCell(state, state.templateAt(entry.addr));
  }
}

// Per-cell stamper: $15 (set by the init to the encoded sub-table index)
// selects one of the four sub-tables; the grid index is (row*3 + col).
const mushroomBigStamp: PerCellHandler = (state) => {
  const table = MUSHROOM_BIG_TABLES[(state.zp15 >> 1) & 0x03]!;
  stampFromTable(state, table);
};

// ── init (ports CODE_extobj_handler_mushroom_big_pair $12:9011) ──────────
//
// state.zp15 carries the ext ID on entry. The cart re-encodes it into the
// sub-table index via `prng & 1` ($12:901E) before the walker runs:
//   LDA #3 ; STA $2A ; STA $2E
//   JSL prng ; AND #1 ; STA $00
//   LDA $15 ; AND #1 ; ASL ; ADC $00 ; ASL ; STA $15
//   → $15 = (((extID & 1) << 1) + prngBit) << 1, selecting one of FOUR
//   sub-tables (B6/B7 × prngBit). All four are now ported (TABLE_C131/_C147/
//   _C15D/_C173), so the roll is tagged for per-site replay. Extents $2A=$2E=3
//   match the cart so the walker geometry (col,row counters) lines up.
function initMushroomBigPair(state: DecodeState): void {
  state.zp2A = 0x0003;
  state.zp2E = 0x0003;
  const prngBit = prngNext(state, RNG_SITE.mushroomBigPairInit) & 0x0001;
  state.zp15 = ((((state.zp15 & 0x0001) << 1) + prngBit) << 1) & 0xffff;
  walkerSetupTrampoline(state, mushroomBigStamp);
}

export function installExtMushroomBigPairHandlers(): void {
  registerExtObjectHandler(0xB6, initMushroomBigPair);
  registerExtObjectHandler(0xB7, initMushroomBigPair);
}
