// Bank12 extended-object handler: single_tile_variant_3 (ext-obj ID $0C).
//
// Unlike most extended objects (which stamp a fixed inline shape), this ext
// handler uses the SAME rectangle walker as standard objects. The init
// (CODE_extobj_handler_single_tile_variant_3, $12:88C4) bumps the extents to
// 2 cols × 4 rows and tail-calls the walker trampoline with per-cell stamp
// handler CODE_12A4EC. The walker then paints a 2×4 block of Map16 tiles.
//
// Asm sources:
//   CODE_extobj_handler_single_tile_variant_3   Bank12.asm:1569 ($12:88C4)
//   CODE_12A4EC (per-cell stamp)                 Bank12.asm:5848 ($12:A4EC)
//   DATA_12A4E4 (per-row tile table)             Bank12.asm:5843 ($12:A4E4)
//
// Asm (init, verbatim):
//   CODE_extobj_handler_single_tile_variant_3:
//     REP #$20
//     INC $2A                     ; col extent 1 -> 2
//     LDA #$0004 : STA $2E        ; row extent -> 4
//     LDX #(CODE_12A4EC-1)>>16
//     LDA #CODE_12A4EC-1
//     JMP CODE_walker_setup_trampoline   ; slope=0, walk the rectangle
//
// Asm (per-cell stamp, verbatim):
//   DATA_12A4E4: dw $920F,$9066,$9076,$9086   ; per-row base tile
//   CODE_12A4EC:
//     REP #$30
//     LDA $2C : ASL : TAY        ; Y = row*2 (word index)
//     LDA DATA_12A4E4,y          ; A = base tile for this row
//     LDX $12 : CPX #$9216       ; if the cell underneath is $9216 ...
//     BNE CODE_12A4FF
//     LDA #$9213                 ; ... override base with $9213
//   CODE_12A4FF:
//     CLC : ADC $28              ; A += column (each col is base+1)
//     LDX $1D : STA buffer,x     ; stamp
//     SEP #$30 : RTL
//
// Per-cell output is therefore: tile = DATA_12A4E4[row] + col, with a
// shape-aware override (base -> $9213) when the existing tile at the cell is
// $9216. The override depends on what is already stamped underneath; in the
// trace the cells are empty ($0000) so it never fires, but it is modelled
// faithfully here so overlapping objects decode correctly.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// DATA_12A4E4 — per-row base Map16 IDs (Bank12.asm:5843). Indexed by $2C (row).
const ROW_BASE_TILES = [0x920f, 0x9066, 0x9076, 0x9086] as const;

// Cart override: when the cell underneath ($12) is $9216, the per-cell stamp
// substitutes base $9213 for whichever row tile was selected.
const OVERRIDE_TRIGGER_TILE = 0x9216;
const OVERRIDE_BASE_TILE = 0x9213;

// ─────────────────────────────────────────────────────────────────────
// CODE_12A4EC — per-cell stamper (Bank12.asm:5848).
// tile = (cur == $9216 ? $9213 : DATA_12A4E4[row]) + col.
// ─────────────────────────────────────────────────────────────────────
const stampSingleTileVariant3: PerCellHandler = (state) => {
    let base: number = ROW_BASE_TILES[state.zp2C & 0x03];
    if ((state.zp12 & 0xffff) === OVERRIDE_TRIGGER_TILE) {
        base = OVERRIDE_BASE_TILE;
    }
    stampCell(state, (base + (state.zp28 & 0xff)) & 0xffff);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_extobj_handler_single_tile_variant_3 ($12:88C4).
// INC $2A (cols 1->2), $2E = 4 (rows), then the slope-0 walker trampoline.
// The parser seeds $1B/$1C/$15 from the 4-byte ext stream record (extents start
// at 1 each, per CODE_108BAF); $1D (the anchor cell) is resolved by the walker
// trampoline below, NOT by the parser — so this walker-based handler is safe.
// ─────────────────────────────────────────────────────────────────────
function initExtSingleTileVariant3(state: DecodeState): void {
    state.zp2A = (state.zp2A + 1) & 0xffff; // INC $2A: col extent 1 -> 2
    state.zp2E = 0x0004; // STA $2E: row extent -> 4
    walkerSetupTrampoline(state, stampSingleTileVariant3);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Only ext-obj $0C dispatches here; the $10C mirror is
// automatic (getExtObjectHandler masks id & 0xff).
// ─────────────────────────────────────────────────────────────────────
export function installExtSingleTileVariant3Handlers(): void {
    registerExtObjectHandler(0x0c, initExtSingleTileVariant3);
}
