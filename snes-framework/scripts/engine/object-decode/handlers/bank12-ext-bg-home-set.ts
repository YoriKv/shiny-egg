// Extended object $47 — `CODE_extobj_handler_bg_home_set`
// ("BG 'home' decorative set" — a 4x4 fixed-tile block stamped from a
// 16-entry Map16 table, with the anchor shifted UP by 3 screen-coord
// units before the walk).
//
// WALKER-DRIVEN extended object (shape 2). The init handler
// (CODE_extobj_handler_bg_home_set, $12:8A6E) does TWO things before the
// walk: (1) mutates the $1B coord — subtract $0030 from the screen-coord
// (high) nibbles of $1B while preserving the sub-screen (low) nibbles —
// and (2) sets a fixed 4x4 rectangle, then tail-calls the shared walker
// trampoline with per-cell stamper CODE_12AC17:
//
//   REP #$20
//   LDA $1B : AND #$0F0F : STA $00       ; save sub-screen nibbles
//   LDA $1B : AND #$F0F0 : SEC : SBC #$0030 : AND #$F0F0  ; screen Y -= 3
//   ORA $00 : STA $1B                    ; recombine
//   LDA #$0004 : STA $2A : STA $2E       ; col extent = 4, row extent = 4
//   LDX #(CODE_12AC17-1)>>16             ; per-cell stamper bank
//   LDA #CODE_12AC17-1                   ; per-cell stamper ptr
//   JMP CODE_walker_setup_trampoline     ; slope 0; all 3 walker slots = stamper
//
// The walker visits a 4-col x 4-row grid in COLUMN-MAJOR order (outer =
// column 0..3, inner = row 0..3), confirmed against the spec.json
// timeline (16 stamping cells + 4 row-wrap sentinels via CODE_128874).
//
// Per-cell stamper (CODE_12AC17, $12:AC17):
//
//   Y = ($28 << 1) | ($2C << 3)          ; col*2 + row*8 → 0,2,..,$1E
//   if Y == 0 or Y == 6:   (no stamp — RTL; "blank" corner cells)
//   else:  tile = DATA_12AC39[Y]         ; word table indexed by byte offset
//          stamp tile at $1D
//
// So col0/row0 (Y=0) and col3/row0 (Y=6) are deliberately blank — matches
// the spec (cells with no `stamp` event). Every other cell stamps the
// 16-bit Map16 ID from the embedded DATA_12AC39 table at index Y/2.
//
// DATA_12AC39 ($12:AC39) is read verbatim from the asm `dw` declaration —
// version-stable. The table reproduces every spec.json `table_lookup`
// record_value 1:1.
//
// No PRNG, no neighbour probes, no savefile/flag gates: a pure
// (col, row) → table → Map16 lookup. The init reads
// !RAM_YI_Global_FrameCounterLo per the codegraph, but the actual code
// never consumes it (no live state we model); the stamp is fully
// deterministic. The $1B mutation is reproduced exactly so the walker's
// resolved buffer offsets match the spec's per-cell buf_addr values.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Cart tile table DATA_12AC39 ($12:AC39), 16 words. Indexed by the byte
// offset Y = (col << 1) | (row << 3), i.e. word index (col + row*4).
// $0000 entries at Y=0 and Y=6 are the blank corners the stamper skips
// explicitly (the BEQ checks); they're never actually read.
// ─────────────────────────────────────────────────────────────────────
const TILES_12AC39: readonly number[] = [
  0x0000, 0x3D18, 0x3D19, 0x0000, // row 0: cols 0..3
  0x3D1A, 0x3D1B, 0x3D1C, 0x3D1D, // row 1
  0x3D1E, 0x3D26, 0x3D27, 0x3D21, // row 2
  0x3D22, 0x6300, 0x3D28, 0x3D25, // row 3
] as const;

const BLOCK_COLS = 0x0004; // col extent (STA $2A)
const BLOCK_ROWS = 0x0004; // row extent (STA $2E)

// ─────────────────────────────────────────────────────────────────────
// Per-cell stamper. Ports CODE_12AC17 ($12:AC17).
//
// Y = ($28 << 1) | ($2C << 3). The cart skips Y == 0 and Y == 6 (the two
// blank corner cells); all other Y index DATA_12AC39 as a word table.
// ─────────────────────────────────────────────────────────────────────
const stampBgHomeSet: PerCellHandler = (state: DecodeState): void => {
  const y = (((state.zp28 & 0xff) << 1) | ((state.zp2C & 0xff) << 3)) & 0xffff;
  if (y === 0x0000 || y === 0x0006) return; // blank corner cells (BEQ → skip)
  stampCell(state, TILES_12AC39[y >>> 1]!);
};

// ─────────────────────────────────────────────────────────────────────
// Init handler. Ports CODE_extobj_handler_bg_home_set ($12:8A6E):
// shift the $1B screen-Y nibbles up by 3, set a fixed 4x4 rectangle,
// then dispatch the walker (slope 0) with the stamper in all slots.
// ─────────────────────────────────────────────────────────────────────
const initExtBgHomeSet: InitHandler = (state: DecodeState): void => {
  // Cart CODE_extobj_handler_bg_home_set ($12:8A6E), in REP #$20 — so
  // `LDA $1B` reads the FULL 16-bit $1C:$1B word:
  //   LDA $1B : AND #$0F0F : STA $00                       ; keep sub nibbles
  //   LDA $1B : AND #$F0F0 : SEC : SBC #$0030 : AND #$F0F0 ; subtract 3 from
  //           : ORA $00 : STA $1B                          ;   sub-Y ($1B high
  //                                                        ;   nibble), borrow
  //                                                        ;   into screen-Y
  // The $0030 delta sits in the sub-Y nibble ($1B high). When sub-Y < 3 the
  // SBC borrows into the screen-Y nibble (the HIGH byte $1C) — so the shift
  // MUST be done on the composed word and split back into BOTH bytes.
  // (The earlier port operated on `state.zp1B` alone as if it were the whole
  // word: it dropped the screen-Y borrow and never wrote `zp1C`, so a
  // bg-home placed with sub-Y < 3 stamped one full screen-row too low.)
  const word = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  const subNibbles = word & 0x0f0f;
  const screenNibbles = ((word & 0xf0f0) - 0x0030) & 0xf0f0;
  const shifted = (screenNibbles | subNibbles) & 0xffff;
  state.zp1B = shifted & 0xff;
  state.zp1C = (shifted >>> 8) & 0xff;
  state.zp2A = BLOCK_COLS;
  state.zp2E = BLOCK_ROWS;
  walkerSetupTrampoline(state, stampBgHomeSet);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Single ID $47; the $147 mirror is automatic
// (getExtObjectHandler masks id & 0xff). Parent (object-decode/index.ts)
// wires this installer in.
// ─────────────────────────────────────────────────────────────────────
export function installExtBgHomeSetHandlers(): void {
  registerExtObjectHandler(0x47, initExtBgHomeSet);
}
