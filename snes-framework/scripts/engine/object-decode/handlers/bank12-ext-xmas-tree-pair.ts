// Ports CODE_extobj_handler_xmas_tree_pair ($12:A5C0) — ext objects 0xA5 + 0xA6.
//
// Shape 2 (walker-driven). BOTH ext ids share one init handler; it dispatches
// on the orientation byte $15 (= the extID the parser stuffed in `state.zp15`):
//   0xA5 → "top half"    → $15 re-encoded to 1, col extent 5, row extent 9,
//                          value table DATA_12BF7E (row stride 0x0A = 5 cols)
//   0xA6 → "bottom half" → $15 re-encoded to 0, col extent 3, row extent 5,
//                          value table DATA_12BF60 (row stride 0x06 = 3 cols)
// (init DP-diff in both specs: $2A/$2E/$15 all change from the stream's raw 1/1/
// extID to these values; $1B is also re-aligned by the walker setup.)
//
// Per-cell stamper CODE_12BFF4 ($12:BFF4) — verbatim shape from the spec
// timeline (CODE_12BFF4 → C011 → C01D → C023):
//     REP #$30
//     LDX $2C                ; X = row counter
//     LDA DATA_12BFE2,x      ; A = row*stride  (stride table, x = row*2)
//     CLC : ADC $28 (×2)     ; A = row*stride + col*2   (col index, $28 = col)
//     TAY
//     LDA DATA_12BF7E,y      ; value table (per $15: BF7E for A5, BF60 for A6)
//     BEQ .done              ; 0 → no stamp
//     LDX $1D : STA buffer,x ; stamp the value DIRECTLY (single-tier, the value
//                              IS the Map16 id — every spec record_value equals
//                              the stamped output_mapid, no second deref)
//   .done: SEP #$30 : RTL
//
// The stride table (DATA_12BFE2 for A5, DATA_12BFD8 for A6) is just
// `[0, colExtent*2, colExtent*4, …]` (A5: 0,0A,14,…; A6: 0,06,0C,…) — i.e. the
// row-major stride of the value table. We model that implicitly by storing the
// value tables as `[row][col]` arrays; index math is `tbl[row][col]`.
//
// DATA tables: bank12.asm in this checkout is a stub, so the authoritative
// source for DATA_12BF7E / DATA_12BF60 is the trace spec.json (which is also
// what verify-handler diffs against). The two tables below transcribe every
// non-zero `record_value` at its (row,col), with 0 = "no stamp" (cart's BEQ).
//
// VERIFIED cell-for-cell against ext-A5 (50 walker cells, 27 stamps) and ext-A6
// (18 walker cells, 11 stamps) spec.json — every stamped buf_addr/mapid matches.

import type { DecodeState, PerCellHandler } from '../state.ts';
import { stampCell } from './_shared.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { registerExtObjectHandler } from './index.ts';

// DATA_12BF7E (0xA5 "top"): 5 cols × 9 rows, row-major. 0 = skip (cart BEQ).
const TABLE_A5: ReadonlyArray<ReadonlyArray<number>> = [
  /* row 0 */ [0x0000, 0x0000, 0x3dde, 0x0000, 0x0000],
  /* row 1 */ [0x0000, 0x3ddf, 0x8b04, 0x3de0, 0x0000],
  /* row 2 */ [0x0000, 0x8b0a, 0x8b01, 0x8b0c, 0x0000],
  /* row 3 */ [0x3de1, 0x8b07, 0x8b08, 0x8b09, 0x0000],
  /* row 4 */ [0x3de2, 0x8b0e, 0x8b0f, 0x8b10, 0x3de3],
  /* row 5 */ [0x8b02, 0x8b0b, 0x8b15, 0x8b16, 0x8b0c],
  /* row 6 */ [0x8b12, 0x8b19, 0x8b1a, 0x8b1b, 0x8b14],
  /* row 7 */ [0x0000, 0x0000, 0x3de4, 0x0000, 0x0000],
  /* row 8 */ [0x0000, 0x0000, 0x6a25, 0x0000, 0x0000],
];

// DATA_12BF60 (0xA6 "bottom"): 3 cols × 5 rows, row-major. 0 = skip.
const TABLE_A6: ReadonlyArray<ReadonlyArray<number>> = [
  /* row 0 */ [0x0000, 0x3dde, 0x0000],
  /* row 1 */ [0x3ddf, 0x8b04, 0x3de0],
  /* row 2 */ [0x8b0a, 0x8b0b, 0x8b0c],
  /* row 3 */ [0x8b12, 0x8b13, 0x8b14],
  /* row 4 */ [0x0000, 0x6a24, 0x0000],
];

// CODE_12BFF4 — shared per-cell stamper, parameterised by the value table.
function makeStamp(table: ReadonlyArray<ReadonlyArray<number>>): PerCellHandler {
  return (state) => {
    const col = state.zp28 & 0xffff;
    const row = state.zp2C & 0xffff;
    const value = table[row]?.[col] ?? 0;
    if (value === 0) return; // cart's BEQ → no stamp
    stampCell(state, value); // value IS the Map16 id (single-tier)
  };
}

const stampA5 = makeStamp(TABLE_A5);
const stampA6 = makeStamp(TABLE_A6);

// CODE_extobj_handler_xmas_tree_pair init ($12:8F3A, Bank12.asm:2511).
// Dispatch on the extID the parser placed in $15 (0xA5 top / 0xA6 bottom).
// The cart RE-ANCHORS the origin word before walking (this was previously
// omitted — the tree stamped sub_x+2 / 8 (top) or 4 (bottom) rows too low):
//
//   LDA $15 : AND #$0001 : STA $15 : ASL : TAX    ; X = (id & 1)*2 → 0 (A6) / 2 (A5)
//   LDA $1B : AND #$0F0F : SEC : SBC DATA_128F2A,x : AND #$0F0F : STA $00
//   LDA $1B : AND #$F0F0 : SEC : SBC DATA_128F2E,x : AND #$F0F0 : ORA $00 : STA $1B
//   $2A = DATA_128F32,x ; $2E = DATA_128F36,x
//
// (LDA $1B is REP #$20, so it reads the full $1C:$1B word; the two SBCs
// are independent subtractions on the sub ($0F0F) and screen ($F0F0)
// nibble groups, each re-masked so a borrow can cross within its group
// — sub-X into screen-X for the low group, sub-Y into screen-Y for the
// high group — but not between groups.) Per-variant deltas, indexed by
// X (byte offset into the word tables):
//   DATA_128F2A (sub delta): dw $0001,$0002   → A6: subX-1,  A5: subX-2
//   DATA_128F2E (screen delta, in $F0F0): dw $0040,$0080
//                                          → A6: subY-4 rows, A5: subY-8 rows
//   DATA_128F32 (cols): dw $0003,$0005 ; DATA_128F36 (rows): dw $0005,$0009
// Merge: object IDs 0xA5, 0xA6 share this handler.
const XMAS_SUB_DELTA = [0x0001, 0x0002] as const; // DATA_128F2A — A6, A5
const XMAS_SCREEN_DELTA = [0x0040, 0x0080] as const; // DATA_128F2E — A6, A5

function shiftXmasOrigin(state: DecodeState, variantIdx: number): void {
  const subDelta = XMAS_SUB_DELTA[variantIdx]!;
  const screenDelta = XMAS_SCREEN_DELTA[variantIdx]!;
  const word = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  const lo = ((word & 0x0f0f) - subDelta) & 0x0f0f; // SEC : SBC : AND #$0F0F
  const hi = ((word & 0xf0f0) - screenDelta) & 0xf0f0; // SEC : SBC : AND #$F0F0
  const shifted = (hi | lo) & 0xffff;
  state.zp1B = shifted & 0xff;
  state.zp1C = (shifted >>> 8) & 0xff;
}

function initXmasTreePair(state: DecodeState): void {
  if ((state.zp15 & 0xff) === 0xa6) {
    state.zp15 = 0x0000; // bottom: $15 re-encoded to 0 (DATA_12BF60 selector); X=0
    shiftXmasOrigin(state, 0); // DATA_128F2A/2E[0]
    state.zp2A = 0x0003; // col extent 3
    state.zp2E = 0x0005; // row extent 5
    walkerSetupTrampoline(state, stampA6);
  } else {
    state.zp15 = 0x0001; // top: $15 re-encoded to 1 (DATA_12BF7E selector); X=2
    shiftXmasOrigin(state, 1); // DATA_128F2A/2E[1]
    state.zp2A = 0x0005; // col extent 5
    state.zp2E = 0x0009; // row extent 9
    walkerSetupTrampoline(state, stampA5);
  }
}

export function installExtXmasTreePairHandlers(): void {
  registerExtObjectHandler(0xa5, initXmasTreePair);
  registerExtObjectHandler(0xa6, initXmasTreePair);
}
