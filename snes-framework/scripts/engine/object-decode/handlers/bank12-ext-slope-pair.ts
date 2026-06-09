// Bank12 extended-object "slope pair" init + per-cell stamp handlers.
//
// Extended objects $14 and $15 share one init handler
// (CODE_extobj_handler_slope_pair). Unlike most extended objects — which
// stamp a single fixed cell inline with NO walker — this one is a
// walker-driven shape: the init mutates the DP extents to a fixed 5-col ×
// 2-row rectangle, sets a per-orientation slope pitch ($17), and hands the
// walker a per-cell stamp via CODE_walker_setup_keep_slope (NOT the bare
// trampoline — the slope pitch must survive). Each per-cell stamp reads a
// per-orientation 10-entry tile table (one slot per column-major cell); a
// `$0000` entry means "leave this cell blank", a non-zero entry is the
// Map16 ID to stamp. The non-zero / zero pattern, combined with the slope
// pitch, traces out a two-tile-thick diagonal slope (hence "slope pair").
//
// Dispatch key: orientation byte `$15` (= the extended-object ID, stuffed
// by the Bank10 ext dispatcher). The init indexes two parallel 2-entry
// tables by `(\$15 & 1) * 2`:
//   $14 → slope pitch DATA_128943[0] = +$0001, table DATA_12A6D4, stamp CODE_12A6E8
//   $15 → slope pitch DATA_128943[2] = -$0001, table DATA_12A704, stamp CODE_12A718
//
// Asm sources (verbatim from Bank12.asm):
//   CODE_extobj_handler_slope_pair  $12:8947  (Bank12.asm:1647) — shared init
//   DATA_12893F / DATA_128943       $12:893F  (Bank12.asm:1640-1644) — ptr + pitch tables
//   CODE_12A6E8 / DATA_12A6D4       $12:A6E8 / $12:A6D4 (Bank12.asm:6004-6020) — ext $14 stamp + table
//   CODE_12A718 / DATA_12A704       $12:A718 / $12:A704 (Bank12.asm:6025-6041) — ext $15 stamp + table
//   CODE_walker_setup_keep_slope    $12:A3DD (Bank12.asm:5693) — generic walker (keeps $17)
//
//   DATA_12893F: dw CODE_12A6E8-1, CODE_12A718-1
//   DATA_128943: dw $0001, $FFFF
//   CODE_extobj_handler_slope_pair:
//     REP #$20
//     LDA #$0002 : STA $2E          ; row extent 1 → 2
//     LDA #$0005 : STA $2A          ; col extent 1 → 5
//     LDA $15 : AND #$0001 : ASL : TAY
//     LDA DATA_128943,y : STA $17   ; slope pitch ($14: +$0001, $15: -$0001)
//     LDA DATA_12893F,y             ; per-cell stamp ptr-1
//     LDX #(CODE_12A6E8-1)>>16
//     JMP CODE_walker_setup_keep_slope
//
//   CODE_12A6E8 (per-cell, ext $14; CODE_12A718 identical w/ DATA_12A704):
//     REP #$30
//     LDA #$FFFF : STA $9B          ; set keep-slope "rewound" marker every cell
//     LDA $28 : ASL : ORA $2C : ASL : TAY   ; Y = ((col<<1)|row)<<1 = (col*2+row)*2
//     LDA DATA_12A6D4,y : BEQ skip  ; $0000 → don't stamp
//     LDX $1D : STA.l buffer,x      ; stamp the table value
//   skip:
//     RTL

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupKeepSlope } from '../walker.ts';
import { stampCell } from './_shared.ts';

// Fixed rectangle this object always lays down. Cart: `LDA #$0005 STA $2A`
// / `LDA #$0002 STA $2E` (the DP-mutation diff in both specs: col 1→5,
// row 1→2).
const SLOPE_PAIR_COL_EXTENT = 0x0005;
const SLOPE_PAIR_ROW_EXTENT = 0x0002;

// DATA_128943 — per-orientation slope pitch stored into $17. Indexed by
// `($15 & 1) * 2`. ext $14 = +$0001 (slope steps down-right), ext $15 =
// -$0001 (mirror). $17 is consumed by the walker's keep-slope row-wrap
// path (added to $2E each column step).
const SLOPE_PAIR_PITCH_14 = 0x0001;
const SLOPE_PAIR_PITCH_15 = 0xFFFF; // -$0001 as a 16-bit word

// ─────────────────────────────────────────────────────────────────────
// Per-orientation tile tables (DATA_12A6D4 / DATA_12A704, verbatim from
// Bank12.asm). 10 entries each, in column-major order:
//   index = col*2 + row, i.e.
//   [c0r0, c0r1, c1r0, c1r1, c2r0, c2r1, c3r0, c3r1, c4r0, c4r1].
// A `0x0000` entry is the cart's "BEQ skip" sentinel — that cell is left
// blank.
// ─────────────────────────────────────────────────────────────────────

// DATA_12A6D4 — ext $14 ($12:A6D4).
const SLOPE_PAIR_TILES_14 = [
  0x96D6, 0x0000, // col 0
  0x96D6, 0x96D7, // col 1
  0x0000, 0x96D7, // col 2
  0x0000, 0x96D4, // col 3
  0x0000, 0x96D4, // col 4
] as const;

// DATA_12A704 — ext $15 ($12:A704).
const SLOPE_PAIR_TILES_15 = [
  0x0000, 0x96D5, // col 0
  0x0000, 0x96D5, // col 1
  0x0000, 0x96D8, // col 2
  0x96D9, 0x96D8, // col 3
  0x96D9, 0x0000, // col 4
] as const;

// ─────────────────────────────────────────────────────────────────────
// Per-cell stamp. Ports CODE_12A6E8 / CODE_12A718 ($12:A6E8 / $12:A718).
//
// Both handlers are byte-identical except for the tile table. Each sets
// the keep-slope "rewound" marker ($9B = $FFFF) on EVERY cell — the
// walker's keep-slope row-wrap path reads it (matches the `flag9B=$FF`
// seen on every cell in both spec timelines) — then indexes the tile
// table by the cart's `LDA $28 : ASL : ORA $2C : ASL : TAY` math, which
// for a 2-row object reduces to `(col*2 + row)` words. Verified against
// every Y value (0x00,0x02,…,0x12) and every stamp/skip in both specs.
// ─────────────────────────────────────────────────────────────────────

function makeSlopePairStamp(tiles: ReadonlyArray<number>): PerCellHandler {
  return (state) => {
    // LDA #$FFFF : STA $9B — keep-slope rewound marker, set every cell.
    state.rewound = 0xFFFF;
    // LDA $28 : ASL : ORA $2C : ASL : TAY → table index (word slot, /2).
    const idx = ((state.zp28 << 1) | (state.zp2C & 0xff)) & 0xffff;
    const tile = tiles[idx];
    // LDA table,y : BEQ skip — $0000 (or off-table) leaves the cell blank.
    if (tile === undefined || tile === 0) return;
    stampCell(state, tile);
  };
}

const slopePairStamp14 = makeSlopePairStamp(SLOPE_PAIR_TILES_14);
const slopePairStamp15 = makeSlopePairStamp(SLOPE_PAIR_TILES_15);

// ─────────────────────────────────────────────────────────────────────
// Init. Ports CODE_extobj_handler_slope_pair. Sets the fixed 5×2
// rectangle and the per-orientation slope pitch ($17), then dispatches
// the keep-slope walker with the orientation-selected per-cell stamp.
// Branch on $15 bit 0 (matches the cart's `LDA $15 : AND #$0001 : ASL`
// index into both 2-entry tables).
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x14, 0x15 share this handler.
function initSlopePair(state: DecodeState): void {
  state.zp2E = SLOPE_PAIR_ROW_EXTENT;
  state.zp2A = SLOPE_PAIR_COL_EXTENT;
  const bit0 = (state.zp15 & 0x01) !== 0;
  state.zp17 = bit0 ? SLOPE_PAIR_PITCH_15 : SLOPE_PAIR_PITCH_14;
  const stamp = bit0 ? slopePairStamp15 : slopePairStamp14;
  walkerSetupKeepSlope(state, stamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Both IDs share initSlopePair; the internal branch on $15
// picks the slope pitch + tile table. (The 0x100 mirror is automatic via
// getExtObjectHandler's `id & 0xff` mask.)
// ─────────────────────────────────────────────────────────────────────

export function installExtSlopePairHandlers(): void {
  registerExtObjectHandler(0x14, initSlopePair);
  registerExtObjectHandler(0x15, initSlopePair);
}
