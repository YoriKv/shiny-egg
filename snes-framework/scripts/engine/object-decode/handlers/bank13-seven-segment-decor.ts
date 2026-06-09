// Bank13 seven-segment-decor stamp handler + Bank12 init wrapper.
//
// Covers standard objects $57 AND $7E — both route to the same init
// `CODE_init_seven_segment_decor` ($12:985A, Bank12.asm:3791) via the
// DATA_standard_object_init_ptrs dispatch table (DATA_standard_object_init_ptrs). The
// per-ID variant is selected inside the stamp handler by inspecting
// `$15` (orientation byte = std-obj ID): `$57` picks the v57 tile
// table, anything else (i.e. `$7E` in practice) picks the default
// table.
//
//
// Asm sources:
//   CODE_init_seven_segment_decor   Bank12.asm:3791 ($12:985A)
//   CODE_stamp_seven_segment_decor  Bank13.asm:6819 ($13:BB45)
//   DATA_seven_segment_decor_v57    Bank13.asm:6865 (DATA_seven_segment_decor_v57)
//     dw $1D30, $1D32, $1D34, $0000, $1D36, $1D32, $1D38
//   DATA_seven_segment_decor_default Bank13.asm:6869 (DATA_seven_segment_decor_default)
//     dw $1C8C, $1C8E, $1C90, $0000, $1C8C, $1C8E, $1C90
//
// Init mutates no DP fields — confirmed by both spec.md DP-diff tables
// (all rows "no"). Bare trampoline using even/odd/row = same handler.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Template-slot addresses used only by the seven-segment-decor family.
// None currently have canonical TT.* names; if a parent sweep finds
// other handlers reading them, promote to TT.* there.
//
// The under-tile probe addresses $1BF8 / $1BFA are raw template-slot
// addresses (NOT TT.FlatFloor_NoSeamCheckA/B — those are at $1CD4/$1CD6,
// a different probe pair). bank13-bg-autotile-block.ts also reads
// $1BF8 / $1BFA directly via raw slot addrs; if a parent sweep finds
// them used in 3+ places, promote to a TT.* name there.
// ─────────────────────────────────────────────────────────────────────
const SLOT_SevenSeg_UnderProbe_Left  = 0x001BF8; // left-edge under-tile probe (asm CMP $1BF8)
const SLOT_SevenSeg_UnderProbe_Right = 0x001BFA; // right-edge under-tile probe (asm CMP $1BFA)

const SLOT_SevenSeg_v57_Left           = 0x001D30; // Y=0:  left edge, no under-match
const SLOT_SevenSeg_v57_Interior       = 0x001D32; // Y=2:  interior (also Y=5 dup)
const SLOT_SevenSeg_v57_Right          = 0x001D34; // Y=4:  right edge, no under-match
const SLOT_SevenSeg_v57_LeftUnderMatch = 0x001D36; // Y=8:  left edge, under-tile == $1BF8
const SLOT_SevenSeg_v57_RightUnderMatch = 0x001D38; // Y=12: right edge, under-tile == $1BFA

const SLOT_SevenSeg_Def_Left           = 0x001C8C; // Y=0/8: left edge (default table reuses entry for under-match)
const SLOT_SevenSeg_Def_Interior       = 0x001C8E; // Y=2/5 dup
const SLOT_SevenSeg_Def_Right          = 0x001C90; // Y=4/12

// DATA_seven_segment_decor_v57. 7-entry word table; cart
// indexes by Y-in-bytes (so even indices 0/2/4/8/12 are the live picks;
// Y=6 / entry at idx 3 is `$0000` and unreached because the dispatch
// only produces Y ∈ {0, 2, 4, 8, 12}). Stored as TS slot addresses;
// caller dereferences via state.templateAt().
const DATA_seven_segment_decor_v57: ReadonlyArray<number> = [
  SLOT_SevenSeg_v57_Left,            // idx 0 (Y=0)
  SLOT_SevenSeg_v57_Interior,        // idx 1 (Y=2)
  SLOT_SevenSeg_v57_Right,           // idx 2 (Y=4)
  0x000000,                          // idx 3 (Y=6) — unreached gap entry
  SLOT_SevenSeg_v57_LeftUnderMatch,  // idx 4 (Y=8)
  SLOT_SevenSeg_v57_Interior,        // idx 5 (Y=10) — dup, unreached
  SLOT_SevenSeg_v57_RightUnderMatch, // idx 6 (Y=12)
];

// DATA_seven_segment_decor_default. Same shape as v57 but
// the under-tile match entries (idx 4 / idx 6) repeat the no-match
// edge slots — i.e. the default variant ignores the $1BF8/$1BFA probe
// result (it stamps the same tile either way for edges).
const DATA_seven_segment_decor_default: ReadonlyArray<number> = [
  SLOT_SevenSeg_Def_Left,      // idx 0 (Y=0)
  SLOT_SevenSeg_Def_Interior,  // idx 1 (Y=2)
  SLOT_SevenSeg_Def_Right,     // idx 2 (Y=4)
  0x000000,                    // idx 3 (Y=6) — unreached
  SLOT_SevenSeg_Def_Left,      // idx 4 (Y=8) — same as Y=0
  SLOT_SevenSeg_Def_Interior,  // idx 5 (Y=10) — dup, unreached
  SLOT_SevenSeg_Def_Right,     // idx 6 (Y=12) — same as Y=4
];

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_seven_segment_decor ($13:BB45, Bank13.asm:6819).
//
// REP #$30
// LDY #$0000
// LDA $28 ; BEQ leftEdge          ; col==0 → left edge path
// INY INY                          ; Y=2 (interior default)
// INC ; CMP $2A ; BNE table        ; (col+1)!=extent → interior, skip probes
// INY INY                          ; Y=4 (right edge)
// BRA rightEdgeProbe
// leftEdge:
//   LDA $12 ; CMP $1BF8 ; BNE table  ; under-tile == slot_1BF8?
//   BRA underMatch
// rightEdgeProbe:
//   LDA $12 ; CMP $1BFA ; BNE table  ; under-tile == slot_1BFA?
// underMatch:
//   TYA ; ORA #$0008 ; TAY            ; Y |= 8  (selects under-match column)
// table:
//   LDA $15 ; CMP #$0057 ; BEQ v57
//     LDA DATA_seven_segment_decor_default,y ; default variant
//     BRA stamp
//   v57: LDA DATA_seven_segment_decor_v57,y    ; $57 variant
//   stamp: TAY ; LDX $1D ; LDA $0000,y ; STA buffer,x
//
// The Y dispatch produces one of {0, 2, 4, 8, 12} in bytes (entry idx
// 0, 1, 2, 4, 6). The Y=6 gap entry ($0000) is unreached.
// ─────────────────────────────────────────────────────────────────────

const stampSevenSegmentDecor: PerCellHandler = (state) => {
  const col    = state.zp28 & 0xffff;
  const extent = state.zp2A & 0xffff;
  const cur    = state.zp12 & 0xffff;
  const orient = state.zp15 & 0xffff;

  // yIdx ∈ {0, 1, 2, 4, 6} — entry index into the 7-slot table. Cart
  // builds equivalent Y byte-offsets {0, 2, 4, 8, 12}; idx 3 / Y=6 is
  // the unreached $0000 gap. yIdx |= 3 logic: bit-2 (idx 4 → Y=8) is
  // the "under-match" promotion done by the OR #$0008 in asm.
  let yIdx: number;
  if (col === 0) {
    const probeLeft = state.templateAt(SLOT_SevenSeg_UnderProbe_Left);
    yIdx = (cur === probeLeft) ? 4 : 0;
  } else if (((col + 1) & 0xffff) === extent) {
    const probeRight = state.templateAt(SLOT_SevenSeg_UnderProbe_Right);
    yIdx = (cur === probeRight) ? 6 : 2;
  } else {
    yIdx = 1;
  }

  const table = orient === 0x0057
    ? DATA_seven_segment_decor_v57
    : DATA_seven_segment_decor_default;

  stampCell(state, state.templateAt(table[yIdx]!));
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_seven_segment_decor ($12:985A, Bank12.asm:3791).
//
//   REP #$30
//   LDA #(CODE_stamp_seven_segment_decor-$01) ...
//   STA $21/$22/$24/$25/$27   ; even/odd/row all same handler
//   LDA #$7FFF ; STA $19      ; row-handler unreachable; termination via extent
//   STZ $17                   ; flat (no per-row slope)
//   JSR walker_setup_trampoline equivalent
//
// Bare trampoline — no DP mutations. Spec.md confirms ($1B/$1C/$2A/$2E/$15
// all unchanged at walker time, both $57 and $7E).
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x57, 0x7E share this handler.
function initSevenSegmentDecor(state: DecodeState): void {
  walkerSetupTrampoline(state, stampSevenSegmentDecor);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Object IDs $57 and $7E share the same init handler;
// the per-ID tile-table choice emerges from $15 (= std-obj ID, set by
// Bank10's dispatcher) inside `stampSevenSegmentDecor`.
// ─────────────────────────────────────────────────────────────────────

export function installSevenSegmentDecorHandlers(): void {
  registerStdObjectHandler(0x57, initSevenSegmentDecor);
  registerStdObjectHandler(0x7E, initSevenSegmentDecor);
}
