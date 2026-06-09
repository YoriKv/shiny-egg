// Bank13 stamp handler for std object $78 — orientation-aware 4-tile
// "spike quad" (a 2-row spike band with rotation-sensitive tile picks,
// plus left-edge cap row and right-edge interior suppression).
//
//
// Asm sources:
//   yi/Banks/Bank12.asm:4254   CODE_init_twisted_tree_slanted         ($12:9B85)
//   yi/Banks/Bank13.asm:8492   CODE_stamp_twisted_tree_slanted (stamper)    ($13:C941)
//   yi/Banks/Bank13.asm:8501   DATA_twisted_tree_slanted_tiles        ($13:C94D)
//   yi/Banks/Bank13.asm:8518   CODE_red_stairs_select      ($13:C969)
//
// Stamper just loads `DATA_twisted_tree_slanted_tiles` into `$00/$01` and
// tail-calls `CODE_red_stairs_select` (shared with the $79 red-stairs
// stamp). The picker mutates the walker's `$9B` rewind-flag and
// picks one of the 4 table entries based on column index, row index,
// and the sign of `$2A` — see asm below for the exact logic.
//
// Init forces row extent = 2 (so the spike band is exactly 2 tiles
// tall) and pre-seeds `$17 = $FFFF` (-1). The -1 slope step would
// shrink `$2E` by 1 on every row-wrap; the picker counteracts this by
// re-stamping `$9B = $8000` on every $2C=1 bottom-row cell (for
// $28 != 0), which sets the walker's "skip-$2E-shrink" branch in
// `doRowWrap`. Net effect: row extent stays at 2 throughout. The
// dance is a no-op in the observed positive-$2A trace; presumably it
// matters for negative-$2A (right-to-left growth) placements where
// the picker's column-0 branch (`STZ $9B`) doesn't fire on the
// terminating column. We mirror the asm 1:1 so any odd corner-case
// placement decodes identically.
//
// No GoldenEgg counterpart — case 0x78 / "oriented spike" / "spike quad"
// searches all empty in the loaded "ge" solution (matches the rest of
// the spike family). Picker is shared with $79 (red stairs); when that
// lands, lift the picker into a shared helper.

import { registerStdObjectHandler } from './index.ts';
import type { InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupKeepSlope } from '../walker.ts';
import { redStairsSelect } from './bank13-red-stairs.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_twisted_tree_slanted_tiles (Bank13.asm:8501) —
// 4-entry word table indexed by the picker's computed Y/2:
//   [0] $3D3E   (interior / row 0, positive $2A)
//   [1] $3D3D   (left-cap top / interior row 1, positive $2A)
//   [2] $3D3F   (interior row 0, negative $2A)
//   [3] $3D40   (left-cap top / interior row 1, negative $2A)
// Observed trace ($2A positive) only stamps $3D3E / $3D3D.
// ─────────────────────────────────────────────────────────────────────

const DATA_twisted_tree_slanted_tiles: ReadonlyArray<number> = [
  0x3D3E, 0x3D3D, 0x3D3F, 0x3D40,
];

// ─────────────────────────────────────────────────────────────────────
// CODE_red_stairs_select ($13:C969, Bank13.asm:8518).
//
// Cart asm (REP #$30 throughout):
//   LDA $2C ; CLC ; ROR ; ROR ; STA $9B          ; $9B = ($2C>>2) | ((2C&1)<<15)
//   LDA $28
//   BNE col_nonzero
//     STZ $9B                                    ; first column: clear $9B
//     LDA $2C ; BNE done                         ; first col, $2C != 0 -> SKIP
//     LDY #1 ; LDA $2A ; BPL stamp               ; first col top: Y=1 (pos) / 3 (neg)
//     LDY #3 ; BRA stamp
//   col_nonzero:
//     BPL +
//     DEC                                        ; $28 < 0 (16-bit): adjusted = $28-1
//     BRA cmp
//     + INC                                      ; $28 >= 0:        adjusted = $28+1
//   cmp:
//     CMP $2A                                    ; adjusted == $2A?
//     BNE pick                                   ;   no -> stamp
//     LDA $2C ; BNE done                         ;   yes, and $2C != 0 -> SKIP
//                                                ;   (else fall through and stamp)
//   pick:
//     LDA $2C ; TAY                              ; Y = $2C
//     LDA $2A ; BPL stamp                        ; $2A pos: Y as-is
//     INY ; INY                                  ; $2A neg: Y += 2
//   stamp:
//     TYA ; ASL ; TAY                            ; Y *= 2 (word index)
//     LDA ($00),y                                ; tile from table
//     LDX $1D ; STA buffer,x
//   done: RTS
//
// $9B writes mirror to `state.rewound` (cart $9B is the walker's
// "rewound" / row-extent-skip flag — see walker.ts:doRowWrap).
//
// IMPLEMENTATION: this picker is the shared `redStairsSelect`, defined in
// `bank13-red-stairs.ts` (the $79 owner — the cart's single
// CODE_red_stairs_select is named after red_stairs and JSR'd by both the $79
// stamp and this $78 stamp). We import it and pass our own 4-entry tile table.
// ─────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_twisted_tree_slanted ($13:C941, Bank13.asm:8492) — per-cell stamp.
// Cart loads DATA_twisted_tree_slanted_tiles into $00/$01 and JSRs the
// shared picker.
// ─────────────────────────────────────────────────────────────────────

const stampTwistedTreeSlanted: PerCellHandler = (state) => {
  redStairsSelect(state, DATA_twisted_tree_slanted_tiles);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_twisted_tree_slanted ($12:9B85, Bank12.asm:4254).
//
// Cart asm (slot-write pattern: 3 dispatch slots all = stamper):
//   STA $24, $21, $27        ← (CODE_stamp_twisted_tree_slanted-1)>>16
//   REP #$30
//   STA $22, $1F, $25        ← CODE_stamp_twisted_tree_slanted-1
//   LDA #$0002 ; STA $2E     ← force row extent = 2
//   LDA #$7FFF ; STA $19     ← row-walk end unbounded
//   LDA #$FFFF ; STA $17     ← per-row slope step = -1
//   JSR object_stream_walk
//
// Spec-confirmed DP mutation:
//   $2E: $0010 → $0002 (delta $FFF2)
//   (xy_lo / xy_hi / col_extent / orientation unchanged)
//
// `walkerSetupKeepSlope` wires all 3 dispatch slots to the same handler
// (matching the cart's identical-write to $22/$1F/$25) and sets
// $19 = $7FFF. We pre-set $17 = $FFFF before that call so it survives
// (the trampoline form would zero it).
//
// The $17 = -1 logic interacts with the picker's $9B writes during
// row-wrap — see picker comment above. Trace-observed end state is
// stable $2E = 2 across all 16 column wraps.
// ─────────────────────────────────────────────────────────────────────

const initTwistedTreeSlanted: InitHandler = (state) => {
  state.zp2E = 0x0002;
  state.zp17 = 0xFFFF;
  walkerSetupKeepSlope(state, stampTwistedTreeSlanted);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent (object-decode/index.ts) wires this in.
// ─────────────────────────────────────────────────────────────────────

export function installTwistedTreeSlantedHandlers(): void {
  registerStdObjectHandler(0x78, initTwistedTreeSlanted);
}
