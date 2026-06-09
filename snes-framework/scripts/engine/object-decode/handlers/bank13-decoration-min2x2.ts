// Bank13 decoration-min2x2 stamp handler + Bank12 init wrapper.
//
// Standard object $7F — "Wall hole" decoration. Editor metadata describes
// the object as "A hole in the wall. It will not appear if it is not
// placed on a wall." That qualifier is exactly what the stamp handler
// implements: it is a SHAPE-AWARE READ-CONDITIONAL stamp (NOT a blind
// write). Each cell only overwrites the buffer if the existing tile
// ($12) belongs to one of two host families:
//
//   1) WideFloor page ($1BE0 page-byte)  → wide-floor carve helper
//      (CODE_decoration_min2x2_widefloor_helper). Picks a replacement
//      tile from one of two 9-entry slot tables (DATA_13CFB2 /
//      DATA_13CFC4) indexed by (col-position class, row-position class).
//      The chooser between the two tables looks at the cell's exact
//      tile vs. template slots $1C0C / $1C0E.
//
//   2) Family6800 ($1D8A page family) → 9-row interior grid lookup
//      (CODE_decoration_min2x2_grid_select). Uses (col-position class,
//      row-position class) to pick one of nine row sub-tables, then
//      indexes that sub-table by `($12 & $FF) * 2` to get the
//      replacement slot/sentinel.
//
//   3) Anything else (including the buffer-zero $0000 case) → leave the
//      cell alone. No write.
//
// The "carve" effect comes from the row/col gating: row-/col-edge
// positions pull cap/edge tiles, interior positions either pull body
// tiles or the $FFFF sentinel (= no-stamp). When the object is dropped
// on empty space ($12 == 0) the BEQ at entry exits early so nothing
// renders — which matches the "won't appear unless on a wall" hint.
//
// Per-row sub-tables (DATA_decoration_min2x2_row0..DATA_13CF86) hold 16-bit entries
// that are either:
//   - A WRAM template-slot address ($1C5C/$1D8A/$1DA2/…) — dereference
//     via state.templateAt() to obtain the live Map16 ID.
//   - The ROM-resident label DATA_13CFAE ($13:CFAE = dw $FFFF) — the
//     final `LDA $0000,y ; BMI exit` reads $FFFF and skips the stamp.
//   - The ROM-resident label DATA_13CFB0 ($13:CFB0 = dw $0000) — reads
//     $0000 and stamps a zero (clears the cell).
//
// We model this two-level indirection by storing the table entry's
// 16-bit address and switching on whether the address lives in WRAM
// template space (<$2000) or the inline-ROM sentinel labels.
//
// Asm sources:
//   CODE_init_decoration_min2x2              Bank12.asm:4334 ($12:9C11)
//   CODE_decoration_min2x2_stamp             Bank13.asm:9152 ($13:CDD7)
//   CODE_decoration_min2x2_grid_select       Bank13.asm:9163 ($13:CDED)
//   DATA_decoration_min2x2_handler_ptrs      Bank13.asm:9211 (DATA_decoration_min2x2_handler_ptrs)
//   DATA_decoration_min2x2_row0..row8        Bank13.asm:9216..9261
//   DATA_13CFAE / DATA_13CFB0                Bank13.asm:9266 / 9269  (sentinels)
//   DATA_13CFB2 / DATA_13CFC4                Bank13.asm:9272 / 9276
//   CODE_decoration_min2x2_widefloor_helper  Bank13.asm:9280 ($13:CFD6)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';
import { TT } from '../template-slots.ts';

// ─────────────────────────────────────────────────────────────────────
// Sentinel address constants.
//
// The cart per-row tables hold raw 16-bit pointers. Two of those pointers
// resolve to inline `dw $FFFF` / `dw $0000` labels in bank $13, which the
// final `LDA $0000,y` then dereferences via DBR=$13. Modelled here as
// magic address constants the lookup function knows to special-case.
// ─────────────────────────────────────────────────────────────────────

const PTR_SENTINEL_SKIP  = 0xCFAE; // DATA_13CFAE → dw $FFFF → BMI exit (no stamp)
const PTR_SENTINEL_ZERO  = 0xCFB0; // DATA_13CFB0 → dw $0000 → stamp 0

// Template-slot anchors compared / read by the helper. The widefloor
// helper compares against the *value* held by slots $1C0C / $1C0E (which
// live in the WideFloor template page) — these are per-tileset Map16
// IDs, not raw addresses.
const SLOT_WIDEFLOOR_PAIR_A = 0x001C0C;
const SLOT_WIDEFLOOR_PAIR_B = 0x001C0E;

// ─────────────────────────────────────────────────────────────────────
// Per-row sub-tables for the Family6800 path (DATA_decoration_min2x2_row0..DATA_13CF86).
//
// 9 tables of 20 entries each. The row sub-table is selected by the
// X index built in CODE_decoration_min2x2_grid_select:
//
//   Bit layout of X (word offset into DATA_decoration_min2x2_handler_ptrs):
//     X=0 (idx 0) → row-class "top-only"     → row0
//     X=2 (idx 1) → row-class "bottom-only"  → row1
//     X=4 (idx 2) → row-class "middle"       → row2
//     plus +6 if $28 != 0  (col is not first)
//     plus +12 if ($28+1) == $2A AND $28 != 0  (col is last; the asm's
//                                               second-INX-block stacks
//                                               on top of the first six)
//
// Wait — re-reading the asm: the col block is selected independently
// of the row block by *additive* INX steps. Looking again:
//
//   LDX #0
//   LDA $2C ; BEQ row_first
//     INX INX           ; X = 2 (row is not top)
//     INC ; CMP $2E ; BNE row_first
//     INX INX           ; X = 4 (row is bottom, $2C+1 == $2E)
//   row_first:
//   LDA $28 ; BEQ col_first
//     INX*6             ; X += 6 (col is not first)
//     INC ; CMP $2A ; BNE col_first
//     INX*6             ; X += 6 (col is last)
//   col_first:
//   LDA DATA_decoration_min2x2_handler_ptrs,x   ; pointer into 9-entry pointer table
//
// So X ∈ {0, 2, 4} (row class) + {0, 6, 12} (col class) — but the table
// only has 9 entries (X = 0,2,4,6,8,10,12,14,16). That maps to:
//
//   row\col  first(0)  mid(6)  last(12)
//   top(0)     0         6        12
//   mid(2)     2         8        14
//   bot(4)     4        10        16
//
// → table indices  row0, row3, row6, row1, row4, row7, row2, row5, row8.
// ─────────────────────────────────────────────────────────────────────

const DATA_decoration_min2x2_row0 = [
  0x1DA2, 0x1DA6, 0x1DA6, 0x1D90, PTR_SENTINEL_SKIP, PTR_SENTINEL_SKIP, PTR_SENTINEL_SKIP, PTR_SENTINEL_SKIP,
  PTR_SENTINEL_SKIP, PTR_SENTINEL_SKIP, 0x1DAC, PTR_SENTINEL_SKIP, PTR_SENTINEL_SKIP, 0x1DB0, 0x1DA6, PTR_SENTINEL_SKIP,
  0x1DA2, 0x1DAC, 0x1DA0, 0x1DB0,
] as const;

const DATA_decoration_min2x2_row1 = [
  PTR_SENTINEL_ZERO, 0x1D90, 0x1DAC, 0x1D90, TT.FloorRow0_LeftLo, 0x1D98, 0x1D98, TT.FloorRow0_RightLo,
  PTR_SENTINEL_ZERO, 0x1DA0, 0x1DAC, PTR_SENTINEL_ZERO, PTR_SENTINEL_ZERO, 0x1DA8, 0x1D90, PTR_SENTINEL_SKIP,
  PTR_SENTINEL_ZERO, 0x1DAC, 0x1DA0, 0x1DA8,
] as const;

const DATA_decoration_min2x2_row2 = [
  0x1D9A, 0x1D9E, 0x1D9E, 0x1D90, TT.FloorRow0_LeftLo, 0x1D98, 0x1D98, TT.FloorRow0_RightLo,
  0x1D9E, 0x1DAE, 0x1D9E, 0x1D9E, PTR_SENTINEL_ZERO, PTR_SENTINEL_ZERO, 0x1DAC, PTR_SENTINEL_SKIP,
  0x1D9A, 0x1DAC, PTR_SENTINEL_SKIP, 0x1DA8,
] as const;

const DATA_decoration_min2x2_row3 = [
  0x1DA2, 0x1DB0, 0x1DB0, 0x1DA8, PTR_SENTINEL_SKIP, PTR_SENTINEL_SKIP, PTR_SENTINEL_SKIP, PTR_SENTINEL_SKIP,
  PTR_SENTINEL_ZERO, 0x1DA2, 0x1DA8, PTR_SENTINEL_ZERO, PTR_SENTINEL_SKIP, 0x1DB0, 0x1DB0, PTR_SENTINEL_SKIP,
  0x1DA2, 0x1DA8, PTR_SENTINEL_ZERO, 0x1DB0,
] as const;

const DATA_decoration_min2x2_row4 = [
  PTR_SENTINEL_ZERO, PTR_SENTINEL_ZERO, PTR_SENTINEL_ZERO, PTR_SENTINEL_ZERO, TT.FloorRow0_LeftLo, TT.FloorRow0_RightLo, TT.FloorRow0_LeftLo, TT.FloorRow0_RightLo,
  PTR_SENTINEL_ZERO, PTR_SENTINEL_ZERO, PTR_SENTINEL_ZERO, PTR_SENTINEL_ZERO, PTR_SENTINEL_ZERO, PTR_SENTINEL_ZERO, PTR_SENTINEL_ZERO, PTR_SENTINEL_ZERO,
  PTR_SENTINEL_ZERO, PTR_SENTINEL_ZERO, PTR_SENTINEL_ZERO, PTR_SENTINEL_ZERO,
] as const;

const DATA_decoration_min2x2_row5 = [
  0x1D9A, 0x1DAE, 0x1DAE, 0x1DA0, TT.FloorRow0_LeftLo, TT.FloorRow0_RightLo, TT.FloorRow0_LeftLo, TT.FloorRow0_RightLo,
  PTR_SENTINEL_ZERO, 0x1DAE, 0x1DAE, PTR_SENTINEL_ZERO, PTR_SENTINEL_ZERO, 0x1D9A, 0x1DA0, PTR_SENTINEL_ZERO,
  0x1D9A, 0x1DA0, 0x1DAE, PTR_SENTINEL_ZERO,
] as const;

const DATA_decoration_min2x2_row6 = [
  TT.Family6800_Anchor, 0x1DA4, 0x1DA4, 0x1DA6, PTR_SENTINEL_SKIP, PTR_SENTINEL_SKIP, PTR_SENTINEL_SKIP, PTR_SENTINEL_SKIP,
  PTR_SENTINEL_SKIP, TT.Family6800_Anchor, PTR_SENTINEL_ZERO, PTR_SENTINEL_ZERO, PTR_SENTINEL_SKIP, 0x1DA4, 0x1DB0, PTR_SENTINEL_SKIP,
  0x1DAA, 0x1DA6, 0x1D9A, 0x1DB0,
] as const;

const DATA_decoration_min2x2_row7 = [
  TT.Family6800_Anchor, TT.Family6800_Anchor, 0x1DAA, PTR_SENTINEL_ZERO, TT.FloorRow0_LeftLo, 0x1D92, 0x1D92, TT.FloorRow0_RightLo,
  PTR_SENTINEL_ZERO, 0x1DAA, 0x1D9A, PTR_SENTINEL_ZERO, PTR_SENTINEL_SKIP, TT.Family6800_Anchor, 0x1DA2, PTR_SENTINEL_ZERO,
  0x1DAA, PTR_SENTINEL_ZERO, 0x1D9A, 0x1DA2,
] as const;

const DATA_decoration_min2x2_row8 = [
  TT.Family6800_Anchor, 0x1D9C, 0x1D9C, 0x1DA0, TT.FloorRow0_LeftLo, 0x1D92, 0x1D92, TT.FloorRow0_RightLo,
  PTR_SENTINEL_SKIP, 0x1D9C, 0x1DAE, PTR_SENTINEL_SKIP, 0x1DA2, 0x1DAA, PTR_SENTINEL_SKIP, PTR_SENTINEL_ZERO,
  0x1DAA, 0x1DAC, 0x1DAE, PTR_SENTINEL_SKIP,
] as const;

// 9-entry pointer table (DATA_decoration_min2x2_handler_ptrs). Indexed by the (row-class,
// col-class) X built in the asm — see comment block above.
const DATA_decoration_min2x2_handler_ptrs = [
  DATA_decoration_min2x2_row0, DATA_decoration_min2x2_row1, DATA_decoration_min2x2_row2,
  DATA_decoration_min2x2_row3, DATA_decoration_min2x2_row4, DATA_decoration_min2x2_row5,
  DATA_decoration_min2x2_row6, DATA_decoration_min2x2_row7, DATA_decoration_min2x2_row8,
] as const;

// Wide-floor helper output tables (DATA_13CFB2 / DATA_13CFC4). 9 entries
// each, indexed by the (col-class, row-class) Y stepping the helper
// builds. Both contain WRAM template-slot addresses (with one PTR_SENTINEL_ZERO
// in each — DATA_13CFB0 = $0000 inline) — never the SKIP sentinel.
const DATA_decoration_min2x2_widefloor_low = [
  0x1DA6, 0x1DB0, 0x1DA4, 0x1DAC, PTR_SENTINEL_ZERO, 0x1DAA, 0x1D9E, 0x1DAE,
  0x1D9C,
] as const;

const DATA_decoration_min2x2_widefloor_high = [
  0x1DA2, 0x1DB0, 0x1DA8, PTR_SENTINEL_ZERO, PTR_SENTINEL_ZERO, PTR_SENTINEL_ZERO, 0x1D9A, 0x1DAE,
  0x1DA0,
] as const;

// ─────────────────────────────────────────────────────────────────────
// Resolve one row-table entry (16-bit pointer) to either:
//   - a Map16 ID (number, when entry is a WRAM template slot or a
//     PTR_SENTINEL_ZERO inline-zero label), or
//   - null, when entry is the PTR_SENTINEL_SKIP ($FFFF) label and the
//     caller must NOT stamp.
// Mirrors the asm's `LDA $0000,y ; BMI exit ; STA buffer,x` epilogue:
// $FFFF has its high bit set → BMI taken → exit without stamping.
// ─────────────────────────────────────────────────────────────────────

function resolveTableEntry(state: DecodeState, entry: number): number | null {
  if (entry === PTR_SENTINEL_SKIP) return null;   // $FFFF → BMI → skip stamp
  if (entry === PTR_SENTINEL_ZERO) return 0;      // $0000 → stamp 0
  return state.templateAt(entry);                 // WRAM template slot → Map16 ID
}

// ─────────────────────────────────────────────────────────────────────
// CODE_decoration_min2x2_widefloor_helper ($13:CFD6, Bank13.asm:9280).
//
// Called from the stamp handler when the current cell's HIGH BYTE matches
// the WideFloorPage anchor ($1BE0). Picks a replacement tile from one of
// two 9-entry slot tables; the chooser is whether $12 equals the *value*
// held by template slot $1C0C or $1C0E (per-tileset wide-floor pair).
//
// Index Y is the same 0/2/4 + {0,6,12} structure used by the grid path
// but applied via INY (not INX), because the table is a flat slot list
// rather than 9 pointers. The first INY block uses $28 (column), the
// second adds 6 from $2C (row).
// ─────────────────────────────────────────────────────────────────────

function widefloorHelper(state: DecodeState): void {
  // Y bits from $28 (col).
  let y = 0;
  const col = state.zp28 & 0xff;
  const colExtent = state.zp2A & 0xff;
  if (col !== 0) {
    y = 2;
    if (((col + 1) & 0xff) === colExtent) {
      y = 4;
    }
  }
  // +6 from $2C (row).
  const row = state.zp2C & 0xff;
  const rowExtent = state.zp2E & 0xff;
  if (row !== 0) {
    y += 6;
    if (((row + 1) & 0xff) === rowExtent) {
      y += 6;
    }
  }
  // Convert byte offset (0,2,4,…,16) to word index (0..8).
  const idx = y >>> 1;

  // Table chooser: $12 matches slot $1C0C or $1C0E → "high" pair;
  // otherwise → "low" pair.
  const cur = state.zp12 & 0xffff;
  const pairA = state.templateAt(SLOT_WIDEFLOOR_PAIR_A);
  const pairB = state.templateAt(SLOT_WIDEFLOOR_PAIR_B);
  const entry = (cur === pairA || cur === pairB)
    ? DATA_decoration_min2x2_widefloor_high[idx]!
    : DATA_decoration_min2x2_widefloor_low[idx]!;

  // The asm's final epilogue here lacks a BMI guard — both tables only
  // carry WRAM slots and the PTR_SENTINEL_ZERO label. Stamp whatever
  // resolveTableEntry returns (never null on this path).
  const id = resolveTableEntry(state, entry);
  if (id !== null) stampCell(state, id);
}

// ─────────────────────────────────────────────────────────────────────
// CODE_decoration_min2x2_stamp ($13:CDD7, Bank13.asm:9152).
//
//   if ($12 == $0000)         → exit (cell is empty; nothing to carve)
//   if ($12 & $FF00) == WideFloorPage_Anchor → widefloorHelper, exit
//   if ($12 & $FF00) != Family6800_Anchor    → exit (host family unrecognised)
//
//   ; Grid-select path:
//   Y = ($12 & $FF) * 2                   ; entry within the chosen sub-table
//   X = row-class (0,2,4) + col-class (0,6,12)
//   sub = DATA_decoration_min2x2_handler_ptrs[X / 2]
//   entry = sub[Y / 2]
//   tile = deref(entry)
//   if (tile < 0)             → exit (sentinel)
//   stamp tile
// ─────────────────────────────────────────────────────────────────────

const decorationMin2x2Stamp: PerCellHandler = (state) => {
  const cur = state.zp12 & 0xffff;
  if (cur === 0x0000) return;                          // BEQ exit — host is empty

  const pageByte = cur & 0xff00;
  if (pageByte === state.templateAt(TT.WideFloorPage_Anchor)) {
    widefloorHelper(state);
    return;
  }
  if (pageByte !== state.templateAt(TT.Family6800_Anchor)) return;

  // Y = ($12 & $FF) * 2 — byte offset into the chosen sub-table.
  const yByte = (cur & 0x00ff) << 1;
  const wordIdx = yByte >>> 1;                          // 0..127, but the
                                                         // sub-tables are 20
                                                         // entries; reads
                                                         // beyond that would
                                                         // be out-of-bounds in
                                                         // the cart too — the
                                                         // host-family page
                                                         // check above (only
                                                         // page $1D8A) plus
                                                         // the 20-slot
                                                         // Family6800 family
                                                         // size keeps $12 in
                                                         // bounds for in-
                                                         // family cells.

  // Build X (row-class + col-class).
  let x = 0;
  const row = state.zp2C & 0xff;
  const rowExtent = state.zp2E & 0xff;
  if (row !== 0) {
    x = 2;
    if (((row + 1) & 0xff) === rowExtent) {
      x = 4;
    }
  }
  const col = state.zp28 & 0xff;
  const colExtent = state.zp2A & 0xff;
  if (col !== 0) {
    x += 6;
    if (((col + 1) & 0xff) === colExtent) {
      x += 6;
    }
  }
  const subTableIdx = x >>> 1;                          // 0..8

  const sub = DATA_decoration_min2x2_handler_ptrs[subTableIdx];
  if (!sub) return;
  // Bounds-clip: the cart's relative `LDA ($00),y` would happily read past
  // the 20-entry sub-table for $12 values beyond the family's 20 slots,
  // but in practice in-family cells stay within range. Guard anyway so a
  // malformed buffer can't index off the end of our typed array.
  if (wordIdx >= sub.length) return;
  const entry = sub[wordIdx]!;

  const id = resolveTableEntry(state, entry);
  if (id === null) return;                              // PTR_SENTINEL_SKIP
  stampCell(state, id);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_decoration_min2x2 ($12:9C11, Bank12.asm:4334).
//
//   REP #$20
//   LDA $2A ; CMP #2 ; BCS .skip ; LDA #2 ; STA $2A   ; force col extent ≥ 2
//   .skip:
//   LDA $2E ; CMP #2 ; BCS .skip2 ; LDA #2 ; STA $2E  ; force row extent ≥ 2
//   .skip2:
//   LDX #(CODE_decoration_min2x2_stamp-1)>>16
//   LDA #CODE_decoration_min2x2_stamp-1
//   JMP walker_setup_trampoline
//
// The "≥ 2" floors give the object its name — the carve always covers
// at least a 2×2 patch so that the first row/col/last row/col classes
// can all distinguish from each other.
// ─────────────────────────────────────────────────────────────────────

function initDecorationMin2x2(state: DecodeState): void {
  if ((state.zp2A & 0xffff) < 2) state.zp2A = 2;
  if ((state.zp2E & 0xffff) < 2) state.zp2E = 2;
  walkerSetupTrampoline(state, decorationMin2x2Stamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installDecorationMin2x2Handlers(): void {
  registerStdObjectHandler(0x7F, initDecorationMin2x2);
}
