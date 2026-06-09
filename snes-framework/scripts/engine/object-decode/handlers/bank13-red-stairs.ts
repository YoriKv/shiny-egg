// Bank13 stamp handler + Bank12 init wrapper for std object $79 — the editor's
// "Red stairs": a 2-row-tall DIAGONAL staircase (styled like object $37;
// negative width faces it left). The init's $17 = $FFFF slope plus the stamp's
// $9B write make the walker drop the column origin one row per column
// (doRowWrap), so each 2-tile step sits one row below (right-facing) /
// above-left (left-facing) the previous one, forming a single staircase.
//
// Asm references:
//   CODE_init_red_stairs    ($12:9BAD)  init: 3 slots, $2E=2, $17=$FFFF
//   CODE_red_stairs_stamp   ($13:C955)  per-cell stamp
//   CODE_red_stairs_select  ($13:C969)  tile pick + $9B write
//   DATA_red_stairs_tiles   ($13:C961)  4-entry tile table
//
// Init (Bank12): sets $2E=2, $19=$7FFF, AND $17=$FFFF (the diagonal pitch),
// then runs the walker DIRECTLY — NOT via the trampoline, which would zero $17.
// (The original "only $2E moves" reading missed the $17/$19 writes.)
//
// Per-cell selector (REP #$30; $28 is the cart's 16-bit SIGNED column counter,
// so a left-growing object counts $FFFF,$FFFE,… — not 8-bit; see walker.ts):
//   $9B = ($2C ror 2)                     ; rewound (drives the diagonal step);
//                                         ;   then 0 on the col==0 branch
//   if $28 == 0:
//     if $2C != 0: return                 ; left col, lower row -> skip
//     y = ($2A >= 0) ? 1 : 3              ; the cap
//   else:
//     adjusted = ($28 >= 0) ? $28+1 : $28-1   ; branches on sign of $28
//     if adjusted == $2A:                 ; terminal (far) column
//       if $2C != 0: return               ;   lower row -> skip (this is what
//       fallthrough as interior (row 0)   ;   keeps the far end from over-running)
//     y = $2C ; if $2A < 0: y += 2        ; mirror for left-facing objects
//   tile = table[y]                       ; word-indexed via TYA;ASL;TAY
//
// DATA_red_stairs_tiles = { $3D5A, $6700, $3D59, $6600 }:
//   y=0 $3D5A / y=1 $6700  — a step's two tiles (right-facing)
//   y=2 $3D59 / y=3 $6600  — mirror (left-facing / negative width)
//
// The terminal-column lower-row suppression (`adjusted == $2A`) is what stops a
// left-facing staircase from stamping one tile too many at the bottom — it
// depends on $28 being 16-bit signed (the old 8-bit $28 collapsed $FFFC→$FC so
// the test never matched $2A=$FFFB; fixed in walker.ts:doRowWrap).

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupKeepSlope } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_red_stairs_tiles (Bank13.asm:8514).
// 4-entry word table; selector indexes by (row,col) shape (see below).
// ─────────────────────────────────────────────────────────────────────

const DATA_red_stairs_tiles = [
  0x3D5A, // y=0 — interior top
  0x6700, // y=1 — left-cap top (col=0 row=0) / interior bottom (col!=0 row=1)
  0x3D59, // y=2 — interior top (mirrored, neg-extent objects)
  0x6600, // y=3 — left-cap top (mirrored)
] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_red_stairs_select ($13:C969, Bank13.asm:8518).
//
// The asm stashes `$2C` rotated-right-2 into `$9B` (the walker's "rewound"
// flag), then zeroes it on the col==0 branch. Together with the init's
// `$17 = $FFFF` slope, `$9B` drives the walker's per-column diagonal step in
// doRowWrap — that is what makes the staircase climb instead of laying flat as
// three horizontal rows. (Same $2C-ror-2 pattern as twisted_tree_slanted/$78.)
// It MUST be written before the early-out returns, exactly as the cart sets it
// before its skip branches.
//
// SHARED: the cart's single CODE_red_stairs_select is JSR'd by both the $79
// red-stairs stamp (here) and the $78 twisted_tree_slanted stamp. The latter
// imports this function (passing its own 4-entry tile table) rather than
// duplicating it — `bank13-twisted-tree-slanted.ts`.
// ─────────────────────────────────────────────────────────────────────

/**
 * CODE_red_stairs_select — write the walker `$9B` rewind flag, then pick one of
 * `table`'s 4 entries by (row, col) shape. `$28` is the cart's 16-bit SIGNED
 * column counter; `$2A` the signed column extent.
 */
export function redStairsSelect(
  state: DecodeState,
  table: ReadonlyArray<number>,
): void {
  const col = state.zp28 & 0xffff;
  const row = state.zp2C & 0xffff;
  const extent = state.zp2A & 0xffff;
  const extentNeg = (extent & 0x8000) !== 0;

  // Cart `LDA $2C : CLC : ROR : ROR : STA $9B`, then `STZ $9B` when col==0.
  state.rewound = col === 0
    ? 0
    : (((row >>> 2) & 0x3fff) | ((row & 1) << 15)) & 0xffff;

  let y: number;
  if (col === 0) {
    // Left-most column. Only row 0 stamps; lower rows are suppressed.
    if (row !== 0) return;
    y = extentNeg ? 3 : 1;
  } else {
    // Check if this is the right-edge column (one past the cap on
    // positive-extent objects, one before on negative). If so AND we're
    // on a non-zero row, suppress; otherwise fall through to the
    // interior-cell branch. Cart `LDA $28 : BPL` — branch on sign of $28.
    const colNeg = (col & 0x8000) !== 0;
    const adjusted = (colNeg ? col - 1 : col + 1) & 0xffff;
    if (adjusted === extent && row !== 0) return;
    // Interior cell: y = row, plus +2 for negative-extent objects.
    y = row & 0x03;
    if (extentNeg) y += 2;
  }

  // Cart `TYA ; ASL ; TAY ; LDA ($00),y` — table is word-indexed, but
  // our TS array is already word-typed so we use y as-is.
  stampCell(state, table[y] ?? table[0]!);
}

const stampRedStairs: PerCellHandler = (state) => {
  redStairsSelect(state, DATA_red_stairs_tiles);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_red_stairs ($12:9BAD, Bank12.asm:4275).
//
//   STA $24/$21/$27 + $22/$1F/$25  ; all 3 walker slots = the stamp handler
//   LDA #$0002 ; STA $2E           ; force 2-row footprint (per step)
//   LDA #$7FFF ; STA $19           ; row-walk end = unbounded
//   LDA #$FFFF ; STA $17           ; slope = -1  ← the DIAGONAL pitch
//   JSR object_stream_walk         ; called DIRECTLY, not via the trampoline
//
// $17 = $FFFF is the per-column diagonal step: on each column wrap the walker's
// doRowWrap reads $9B (set by the stamp from $2C) and, when it's non-zero,
// shifts the column origin by $17 and bumps $2E — climbing the staircase one
// step per column. The cart deliberately bypasses the trampoline (which zeros
// $17). An earlier port used `walkerSetupTrampoline` and skipped the $9B write,
// dropping BOTH halves of the slope — the object then laid flat as three
// horizontal rows instead of a diagonal staircase. Use `walkerSetupKeepSlope`
// (preserves the pre-set $17) and set $9B in the stamp.
// ─────────────────────────────────────────────────────────────────────

const initRedStairs: InitHandler = (state) => {
  state.zp2E = 0x0002;
  state.zp17 = 0xffff; // slope = -1 (diagonal); preserved by walkerSetupKeepSlope
  walkerSetupKeepSlope(state, stampRedStairs);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent (object-decode/index.ts) wires this in.
// ─────────────────────────────────────────────────────────────────────

export function installRedStairsHandlers(): void {
  registerStdObjectHandler(0x79, initRedStairs);
}
