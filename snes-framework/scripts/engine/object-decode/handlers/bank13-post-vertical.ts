// Bank13 vertical-post stamp handler + Bank12 init wrapper.
//
// Covers standard objects $0C / $0E / $0F — all three dispatch to
// `CODE_init_post_vertical` (Bank12.asm:2994) which is a bare trampoline
// pointing at `CODE_post_vertical_3section` (Bank13.asm:790). The orientation
// byte ($15 = std-obj ID) selects WHICH 3-section variant; the row counter
// ($2C) vs row extent ($2E) selects WHICH section (top / middle / bottom).
//
//
// Asm reference: `CODE_post_vertical_3section` at Bank13.asm:790.
//   REP #$30
//   LDX $1D                 ; cell offset
//   LDA $15 ; AND #$0003 ; ASL ; TAY    ; y = (orientation & 3) << 1
//   LDA $2C
//   BEQ top                 ; row 0      → DATA_138460
//   INC ; CMP $2E
//   BEQ bot                 ; row+1 == extent → DATA_138468
//   LDA DATA_138458,y       ; else middle → DATA_138458
//   ...
//   TAY
//   LDA $0000,y             ; deref entry (WRAM template-slot OR ROM literal)
//   JMP post_horizontal_3section_store   ; STA buffer,x
//
// DATA tables (Bank13.asm:817-836):
//   DATA_138458 (mid) = [$1DD0, $0000, DATA_138476→$0095, DATA_138474→$0094]
//   DATA_138460 (top) = [$1DCE, $0000, DATA_138472→$0091, DATA_138470→$0090]
//   DATA_138468 (bot) = [$1DD2, $0000, $1C72,             $1C70]
//
// For y=0 (orientation $0C, $10, $14, ...): entry is a WRAM template-slot
// addr in the $1Cxx/$1Dxx range — deref via `templateAt`. Spec confirms
// $0C reads `slot_1DCE/$1DD0/$1DD2` = `$6B00/$6B01/$6B02`.
//
// For y=4 (orientation $0E, $12, ...): top/mid entries point to a 1-word
// ROM literal in Bank13 ($0091, $0095); bot entry $1C72 is again a
// template slot. Spec for $0E confirms top/mid stamp literal $0091/$0095
// and bot row reads `slot_1C72` = `$2A0B`.
//
// For y=6 (orientation $0F, $13, ...): top/mid → ROM literals $0090,
// $0094; bot → template slot $1C70. Spec for $0F confirms $0090/$0094
// and bot slot `$1C70` = `$2A0A`.
//
// Init mutates no DP fields — see DP-diff tables in all three spec.md
// files; orientation byte $15 IS the std-obj ID, set by the Bank10
// dispatcher before this init runs.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Per-orientation lookup. The cart stores 4-word tables and indexes
// with `y = (orientation & 3) << 1`. We store the resolved entries
// directly, one per `(orientation & 3)` index. Each entry is the
// 16-bit value the asm's `LDA $0000,y` consumes — i.e. either a WRAM
// template-slot address (deref via templateAt) or a literal Map16 ID
// already loaded from a ROM constant.
//
// Slot $01 (orientation & 3 == 1) is unused — the asm's table holds
// $0000 there; in the cart this resolves to whatever lives at $00:0000
// = DP slot $00 (garbage). No valid std-obj has orientation `0D` going
// through this init (`init_post_horizontal` is a separate handler), so
// the slot is dead code. We mark it as `null` for explicit "never".
// ─────────────────────────────────────────────────────────────────────

type Entry = { kind: 'slot'; addr: number } | { kind: 'literal'; id: number };

// DATA_138460 (top of post — row 0)
const TOP_TABLE: ReadonlyArray<Entry | null> = [
  { kind: 'slot',    addr: 0x1DCE },       // orient $0C: slot_1DCE
  null,                                     // orient $0D: not used (post_horizontal)
  { kind: 'literal', id:   0x0091 },        // orient $0E: DATA_138472 → $0091
  { kind: 'literal', id:   0x0090 },        // orient $0F: DATA_138470 → $0090
];

// DATA_138458 (middle of post — interior rows)
const MID_TABLE: ReadonlyArray<Entry | null> = [
  { kind: 'slot',    addr: 0x1DD0 },        // orient $0C: slot_1DD0
  null,                                     // orient $0D: not used
  { kind: 'literal', id:   0x0095 },        // orient $0E: DATA_138476 → $0095
  { kind: 'literal', id:   0x0094 },        // orient $0F: DATA_138474 → $0094
];

// DATA_138468 (bottom of post — last row)
const BOT_TABLE: ReadonlyArray<Entry | null> = [
  { kind: 'slot',    addr: 0x1DD2 },        // orient $0C: slot_1DD2
  null,                                     // orient $0D: not used
  { kind: 'slot',    addr: 0x1C72 },        // orient $0E: slot_1C72
  { kind: 'slot',    addr: 0x1C70 },        // orient $0F: slot_1C70
];

function resolveEntry(state: DecodeState, entry: Entry | null): number {
  if (entry === null) return 0;
  return entry.kind === 'slot' ? state.templateAt(entry.addr) : entry.id;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_post_vertical_3section (Bank13.asm:790)
//
// Section pick mirrors the asm's BEQ/INC/CMP chain:
//   - row counter $2C == 0      → top
//   - ($2C + 1) == $2E (extent) → bottom
//   - else                      → middle
//
// Note both $2C and $2E are bytes; the cart's compare runs in REP #$20
// (16-bit) but the values fit in a byte for all observed posts. Mask
// to 8 bits before the comparison so an extent of 0 (would be wraparound)
// behaves predictably.
// ─────────────────────────────────────────────────────────────────────

const postVertical3section: PerCellHandler = (state) => {
  const orientIdx = state.zp15 & 0x03;
  const row = state.zp2C & 0xff;
  const ext = state.zp2E & 0xff;

  let entry: Entry | null;
  if (row === 0) {
    entry = TOP_TABLE[orientIdx]!;
  } else if (((row + 1) & 0xff) === ext) {
    entry = BOT_TABLE[orientIdx]!;
  } else {
    entry = MID_TABLE[orientIdx]!;
  }
  stampCell(state, resolveEntry(state, entry));
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_post_vertical (Bank12.asm:2994)
//
//   REP.b #$20
//   LDX.b #(CODE_post_vertical_3section-$01)>>16
//   LDA.w #CODE_post_vertical_3section-$01
//   JMP.w CODE_walker_setup_trampoline
//
// Bare trampoline — no DP mutations. Extent/orientation come straight
// from the Bank10 stream record. Verified against the "Init handler DP
// mutations" diff table in all three spec.md files (all rows "no").
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x0C, 0x0E, 0x0F share this handler.
function initPostVertical(state: DecodeState): void {
  walkerSetupTrampoline(state, postVertical3section);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Object IDs $0C/$0E/$0F all share the same init handler;
// the per-ID variant emerges from $15 (= std-obj ID, set by Bank10's
// dispatcher) inside `postVertical3section`.
// ─────────────────────────────────────────────────────────────────────

export function installPostVerticalHandlers(): void {
  registerStdObjectHandler(0x0C, initPostVertical);
  registerStdObjectHandler(0x0E, initPostVertical);
  registerStdObjectHandler(0x0F, initPostVertical);
}
