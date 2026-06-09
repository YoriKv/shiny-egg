// Standard object $CE — init_col_base_8700_off1.
//
// Cart entries:
//   CODE_init_col_base_8700_off1  @ $12:A0EF (yi/Banks/Bank12.asm:5076)
//   CODE_12A0FC                   @ $12:A0FC (fall-through tail; sets $17 then
//                                              JMP walker_setup_keep_slope)
//   CODE_stamp_col_base_8700      @ $13:EC4C (yi/Banks/Bank13.asm:13140)
//
// One-tile constant-column stamp. The init's job is purely to encode a
// per-cell stamp constant into the orientation byte ($15), set the
// "single-row" slope marker in $17, and dispatch via walker_setup_keep_slope
// to the shared Bank13 stamper. The stamper takes $15 (as a 16-bit word)
// and stamps `$8700 + $15` at every walker cell.
//
// Init re-encodes $15:
//   $15 = $0001  (i.e. stamp constant = $8701) -- the "off1" of the family
//   if signed8($2A) < 0:           ; width grows LEFT → flip to "off0"
//     $15 = $0000  (stamp = $8700)
//
// $17 = $FFFF: the slope advance per row. The walker only consults $17 in
// `doRowWrap` after stamping; CODE_stamp_col_base_8700 ALSO stores $FFFF
// into $9B (state.rewound) on every cell. The combined effect for objects
// where row_extent=$0001 (a single tile row stamped repeatedly across the
// column extent) is that doRowWrap's `(state.rewound & 0x8000) !== 0` guard
// skips the $2E += $17 bump, leaving the walker to step one new column per
// "row" and terminate via $28 == $2A (the column extent). This matches the
// 16-cell single-row trace in the spec (col_ext=$10, row_ext=$1).
//
// DP diff from spec:
//   $15 : CE → 01     (yes — init re-encodes from object ID to stamp index)
//   $17 : ?  → FFFF   (preset for walker_setup_keep_slope; spec doesn't
//                       sample $17 explicitly but the trace timeline confirms
//                       single-row behaviour)
//   $2A / $2E / $1B / $1C : unchanged
//
// Family siblings (NOT shared with this file — different stamp routines):
//   $CF init_col_base_8700_off2 → CODE_stamp_col_pair_8702_8704 ($13:EC66)
//                                 -- 2-tile alternating column pair, indexed
//                                    by $15+column parity
//   $D0 init_col_base_8700_off3 → CODE_stamp_col_pair_8706_870A ($13:EC81)
//                                 -- 2-tile pair, different base tiles
// They share the same init shape (set $15 to a constant; if $2A<0 zero $15;
// set $17=$FFFF; walker_setup_keep_slope) but each routes to a different
// stamp handler with its own tile rules, so they live in their own files.
// If we ever want to consolidate, the candidate is a `makeColBaseInit(stamp,
// orient)` factory in _shared.ts that returns an init closure — currently
// only $CE uses CODE_stamp_col_base_8700, so consolidating is premature.
//
// No GoldenEgg counterpart — ReSharper search across `ge.sln` for
// "ColBase8700" / "col_base_8700" / "InitColBase" / "StampColBase" / "Off1"
// returns zero hits.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupKeepSlope } from '../walker.ts';
import { stampCell, signed8 } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_col_base_8700 ($13:EC4C, Bank13.asm:13140).
//
//   REP #$30
//   LDA #$FFFF
//   STA $9B               ; force "single-row" mode for row-wrap math
//   LDX $1D               ; cell byte offset
//   LDA $15               ; stamp index (1 or 0; could be 2 for siblings)
//   CLC ; ADC #$8700      ; → $8701 (or $8700 if init zeroed $15)
//   STA.l buffer,X
//   SEP #$30 ; RTL
//
// Both the stamp constant and the $9B write happen on every cell.
// ─────────────────────────────────────────────────────────────────────
const stampColBase8700: PerCellHandler = (state) => {
  state.rewound = 0xFFFF;
  const tile = (0x8700 + (state.zp15 & 0xFFFF)) & 0xFFFF;
  stampCell(state, tile);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_col_base_8700_off1 ($12:A0EF, Bank12.asm:5076).
//
//   REP #$20
//   LDA #$0001 ; STA $15
//   LDA $2A    ; BPL +     ; $2A signed; >=0 keeps $15=1
//   STZ $15                ; <0 (width grows left) → $15=0
// +: LDA #$FFFF ; STA $17  ; slope marker = -1 (single-row hint)
//   LDX/LDA = ptr-1 of CODE_stamp_col_base_8700
//   JMP walker_setup_keep_slope
// ─────────────────────────────────────────────────────────────────────
function initColBase8700Off1(state: DecodeState): void {
  state.zp15 = signed8(state.zp2A) < 0 ? 0x0000 : 0x0001;
  state.zp17 = 0xFFFF;
  walkerSetupKeepSlope(state, stampColBase8700);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent (object-decode/index.ts) wires this in.
// ─────────────────────────────────────────────────────────────────────
export function installColBase8700Off1Handlers(): void {
  registerStdObjectHandler(0xCE, initColBase8700Off1);
}
