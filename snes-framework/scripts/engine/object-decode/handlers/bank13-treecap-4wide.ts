// Bank13 stamp handler for std object $93 — 4-wide tree-cap / mushroom-cap
// decoration.
//
//
// Init (Bank12.asm:4552, CODE_init_treecap_4wide @ $12:9D85):
//   REP #$20
//   LDA #$0004 ; STA $2A             ; force col extent to 4
//   ; --- shift cell origin one column to the left ---
//   LDA $1B                          ; 16-bit read of $1B/$1C
//   PHA
//   AND #$F0F0 ; STA $00             ; preserve screen-page nibbles
//   PLA
//   AND #$0F0F                       ; isolate sub-nibbles
//   DEC                              ; subX -= 1 (subY borrows if subX==0)
//   AND #$0F0F                       ; reapply mask
//   ORA $00                          ; merge with preserved screen nibbles
//   STA $1B
//   LDX #(CODE_stamp_grass_tuft_2x2_corner-$01)>>16       ; bank byte of per-cell handler
//   LDA #CODE_stamp_grass_tuft_2x2_corner-$01             ; ptr-1 of per-cell handler
//   JMP walker_setup_trampoline      ; all 3 handler slots = CODE_stamp_grass_tuft_2x2_corner
//
// Per-cell stamp (Bank13.asm:10348, CODE_stamp_grass_tuft_2x2_corner @
// $13:D6D2):
//   REP #$30
//   LDX $1D
//   LDA $2C ; CMP #2 ; BCS .body     ; if row >= 2, take seam/body path
//
//   ; Corner path (rows 0..1):
//   LDA $28 ; ASL ; STA $00          ; col*2
//   LDA $2C ; ASL ; ASL ; ASL        ; row*8
//   ORA $00 ; TAY                    ; Y = row*8 | col*2
//   LDA DATA_grass_tuft_corner_tiles,y
//   BEQ .exit                        ; entry $0000 -> skip stamp
//   BRA .stamp
//
// .body  (rows 2+):                  ; CODE_13D6F1
//   LDA $28 ; BEQ .exit              ; col 0 -> skip (left margin)
//   INC ; CMP $2A ; BEQ .exit        ; col == colExtent-1 -> skip (right margin)
//   LDY $2C ; INY ; CPY $2E ; BEQ .bot
//   CMP #$0003 ; BCS .exit           ; (col+1) >= 3 -> skip (rightmost interior)
//   LDA #$3DD5 ; BRA .stamp          ; interior body tile
// .bot:                              ; CODE_13D70B
//   AND #$0001 ; CLC ; ADC #$3DD6    ; (col+1)&1 + $3DD6 → $3DD6 / $3DD7
// .stamp:
//   STA.l !RAM_YI_Level_LevelDataBuffer,x
// .exit:
//   SEP #$30 ; RTL
//
// DATA_grass_tuft_corner_tiles (Bank13.asm:10344) — 8 words.
//   col\row   0     1
//     0      3DCE  3DD1
//     1      3DCF  3DD2
//     2      3DD0  3DD3
//     3      0000  3DD4   ← entry $0000 at row=0 col=3 → no stamp
//
// Init DP diff (from spec):
//   - col_extent ($2A): 0001 → 0004 (forced).
//   - xy_lo ($1B): 33 → 32 (subX decremented; subY/$1C unchanged in the
//     no-underflow case captured by the trace).
// xy_hi, row_extent and orientation byte are untouched.
//
// The orientation byte ($15) is NOT consumed by the per-cell stamp —
// CODE_stamp_grass_tuft_2x2_corner never reads $15. The same stamp is
// reachable via CODE_init_grass_tuft_2x2 ($94-$97) which DOES vary by
// orientation, but those handlers route to CODE_stamp_number_platform (a separate
// table-driven stamp), not the $93 path.
//
// No GoldenEgg counterpart — "Treecap" / "Tree4Wide" / "GrassTuft" all
// return zero hits in the ReSharper-loaded ge solution.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_grass_tuft_corner_tiles (Bank13.asm:10344) — 8-entry
// word table consumed by the rows-0/1 path. Indexed by
// `Y = row*8 | col*2` (word offset). Entry $0000 acts as a "no-stamp"
// sentinel (BEQ .exit). Row=0/col=3 is the only sentinel cell.
// ─────────────────────────────────────────────────────────────────────

const DATA_grass_tuft_corner_tiles = [
  0x3DCE, 0x3DCF, 0x3DD0, 0x0000, // row 0 — col 0..3
  0x3DD1, 0x3DD2, 0x3DD3, 0x3DD4, // row 1 — col 0..3
] as const;

const TILE_INTERIOR_BODY   = 0x3DD5; // rows 2+, interior cells (col 1..2)
const TILE_BOTTOM_EVEN_COL = 0x3DD6; // bottom row (row+1==$2E), (col+1)&1 == 0
const TILE_BOTTOM_ODD_COL  = 0x3DD7; // bottom row (row+1==$2E), (col+1)&1 == 1

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_grass_tuft_2x2_corner ($13:D6D2, Bank13.asm:10348) — per-cell
// stamp. Despite the asm label naming this for the 2x2 grass-tuft objects,
// $93 is the only handler in the cart that actually references it (the
// 2x2 grass-tuft inits route to CODE_stamp_number_platform instead).
// ─────────────────────────────────────────────────────────────────────

const stampTreecap4wide: PerCellHandler = (state) => {
  const col       = state.zp28 & 0xff;
  const row       = state.zp2C & 0xff;
  const colExtent = state.zp2A & 0xff;
  const rowExtent = state.zp2E & 0xff;

  if (row < 2) {
    // --- Corner path (rows 0..1) ---
    const y = ((row & 0x07) << 3) | ((col & 0x03) << 1);
    const word = (y >>> 1);
    const tile = DATA_grass_tuft_corner_tiles[word] ?? 0;
    if (tile === 0) return;            // BEQ .exit
    stampCell(state, tile);
    return;
  }

  // --- Seam / body path (CODE_13D6F1, rows 2+) ---
  if (col === 0) return;               // col 0 -> skip left margin
  const colPlus1 = (col + 1) & 0xff;
  if (colPlus1 === colExtent) return;  // last col -> skip right margin

  const rowPlus1 = (row + 1) & 0xff;
  if (rowPlus1 === rowExtent) {
    // Bottom row (CODE_13D70B): (col+1)&1 + $3DD6.
    const tile = (colPlus1 & 0x0001)
      ? TILE_BOTTOM_ODD_COL
      : TILE_BOTTOM_EVEN_COL;
    stampCell(state, tile);
    return;
  }

  if (colPlus1 >= 3) return;           // rightmost interior column -> skip
  stampCell(state, TILE_INTERIOR_BODY);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_treecap_4wide ($12:9D85, Bank12.asm:4552). Forces col_extent
// = 4, decrements subX (with subY borrow on underflow), then trampolines
// into the walker setup with the per-cell stamp routine. The trampoline
// wires the stamp into all three dispatch slots (even-col / odd-col /
// row), so col-parity and row-end are irrelevant — every cell calls
// stampTreecap4wide.
// ─────────────────────────────────────────────────────────────────────

const initTreecap4wide: InitHandler = (state) => {
  state.zp2A = 0x0004;

  // 16-bit DEC of $1B/$1C low-nibble pair (subX/subY), keeping screen
  // nibbles intact. Mirrors the AND #$F0F0 / DEC / AND #$0F0F / ORA
  // dance in the asm — DEC underflows from $00 to $FF on the low byte,
  // borrowing into the subY nibble in that edge case.
  const word1B = ((state.zp1C & 0xff) << 8) | (state.zp1B & 0xff);
  const screenKeep = word1B & 0xF0F0;
  const subKeep    = ((word1B & 0x0F0F) - 1) & 0x0F0F;
  const merged     = (screenKeep | subKeep) & 0xFFFF;
  state.zp1B = merged & 0xff;
  state.zp1C = (merged >>> 8) & 0xff;

  walkerSetupTrampoline(state, stampTreecap4wide);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent (object-decode/index.ts) wires this in.
// ─────────────────────────────────────────────────────────────────────

export function installTreecap4wideHandlers(): void {
  registerStdObjectHandler(0x93, initTreecap4wide);
}
