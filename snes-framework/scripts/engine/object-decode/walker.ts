// Intra-object walker + setup trampoline.
//
// Ports of:
//   $12:A3DB  walker_setup_trampoline   (entry from per-object init handlers)
//   $12:A3DD  walker_setup_keep_slope   (variant that preserves $17)
//   $12:85EC  intra_object_walker        (the loop)
//   $12:8680  walker_row_wrap            (per-row-end advance)
//   $12:86D5  walker_rewind_nibble       (page-cross helper)
//
// The walker iterates a (rows × cols) rectangle of Map16 cells. For each
// cell it dispatches to ONE of three "handler slots" stashed in DP:
//   - `oddColHandler`  ($1F/$21 in asm) when (column counter & 1) != 0
//   - `evenColHandler` ($22/$24)        when (column counter & 1) == 0
//   - `rowHandler`     ($25/$27)        when at row-end ($2C >= $19)
//
// Most init handlers set all 3 slots to the same handler (via
// `walkerSetupTrampoline`); a few set different handlers for alternating-
// column or row-boundary cells.
//
// **Slope handling:** `$17` is a per-row pitch that the cart adds to the
// per-screen carry `$14` on each row step. Most objects use slope=0
// (rectangle). Diagonal-slope objects use a non-zero slope so the
// rectangle progresses diagonally.
//
// **Sign + width of extents/counters.** The cart runs the walker under REP #$30,
// so its counters are signed 16-bit WORDS (`BPL`/`CMP` test bit 15, INC/DEC are
// 16-bit). The COLUMN counter/extent ($28/$2A) is ported 16-bit (see doRowWrap —
// a left-growing column counts $FFFF,$FFFE,… and `col±1 == $2A` / `col == $2A`
// need the full word). The row EXTENT $2E is likewise kept 16-bit at EVERY write
// site (always `& 0xffff`, never `& 0xff`) so its sign is read 16-bit for the row
// direction: a height-127 floor is $2E=$0080 (+128 → DOWN), which a truncated
// 8-bit value would misread as -128 (UP). The row COUNTER $2C stays 8-bit on
// purpose — termination uses `signed8($2E)` (its low byte, correct for both
// signs), and keeping $2C 8-bit leaves the `$2C >= $19` row-handler dispatch
// unchanged for up-growing objects (widening $2C there regressed ~50 levels in an
// earlier attempt). Negative extent means grow LEFT (cols) / UP (rows). Walker
// handles both directions via the direction tables:
//
//   DATA_walker_cell_byte_delta  +$0020 / -$0020   one Map16 row in buffer
//   DATA_walker_page_wrap_mask  +$0000 / +$01E0   page-wrap mask
//   DATA_walker_slope_advance  +$0010 / +$00F0   slope $14 carry per direction

import { resolveScreenPage } from './fetch.ts';
import { getCurrentMap16Tile } from './fetch.ts';
import type { DecodeState, PerCellHandler } from './state.ts';
import { signed8, signed16 } from './utils.ts';

const CELL_BYTE_DELTA = [0x0020, 0xffe0] as const; // +32, -32 (signed)
const PAGE_WRAP_MASK = [0x0000, 0x01e0] as const;
const SLOPE_ADVANCE = [0x0010, 0x00f0] as const;

/**
 * Walker setup trampoline (CODE_walker_setup_trampoline). The standard entry for per-object
 * init handlers: clears slope to 0, sets all 3 handler slots to the same
 * handler, runs the walker.
 */
export function walkerSetupTrampoline(
  state: DecodeState,
  handler: PerCellHandler
): void {
  state.zp17 = 0;
  walkerSetupKeepSlope(state, handler);
}

/**
 * Walker setup keeping the caller's `$17` slope (CODE_walker_setup_keep_slope). For
 * diagonal-slope handlers that pre-set $17 to their step pitch.
 */
export function walkerSetupKeepSlope(
  state: DecodeState,
  handler: PerCellHandler
): void {
  state.oddColHandler = handler;
  state.evenColHandler = handler;
  state.rowHandler = handler;
  state.zp19 = 0x7fff; // row-walk end = unbounded; termination via $2C==$2E
  intraObjectWalker(state);
}

/**
 * Variant for objects that need different handlers per slot. The init
 * handler typically writes the 3 slots directly then calls this without
 * touching the trampoline.
 */
export function walkerRun(
  state: DecodeState,
  oddCol: PerCellHandler,
  evenCol: PerCellHandler,
  row: PerCellHandler,
  rowsEnd = 0x7fff
): void {
  state.oddColHandler = oddCol;
  state.evenColHandler = evenCol;
  state.rowHandler = row;
  state.zp19 = rowsEnd;
  intraObjectWalker(state);
}

/**
 * Port of `intra_object_walker` at $12:85EC. Iterates the object's
 * rectangle and dispatches per-cell handlers. Returns when row counter
 * reaches `$28 == $2A` (the column counter caught the extent).
 *
 * **Iterative**: the cart asm is a tight BRA-loop with no per-iteration
 * stack consumption; we mirror that with a `while (true)` loop. A
 * recursive (mutual-recursion) variant overflows the JS stack on
 * objects exceeding ~1500 cells (e.g. large floors with shape-aware
 * handler chains adding ~10 frames per cell).
 */
export function intraObjectWalker(state: DecodeState): void {
  state.zp28 = 0;
  state.zp2C = 0;
  state.rewound = 0;

  // perRowSetup: zero per-column slope accumulator + latch current cell.
  state.zp14 = 0;
  getCurrentMap16Tile(state); // sets zp1D, zp12

  while (true) {
    // visitCell — dispatch one of 3 handlers based on $2C vs $19 and $28 parity.
    if (state.zp2C >= state.zp19) {
      state.rowHandler?.(state);
    } else if ((state.zp28 & 1) !== 0) {
      state.oddColHandler?.(state);
    } else {
      state.evenColHandler?.(state);
    }

    // postHandler — advance $2C, then either rowWrap or step one row down.
    // Row DIRECTION is the 16-bit sign of $2E: the cart's `LDA.b $2E ; BPL` runs
    // under REP #$30, so "grows up" is bit 15, NOT bit 7. This is correct ONLY
    // because $2E is now kept 16-bit at every write site (all `& 0xffff`, never
    // `& 0xff`) — a truncated negative extent $FFxx would otherwise collapse to
    // $00xx and read here as positive (down). With $2E intact: a height-127
    // floor ($2E=$0080 = +128) grows DOWN; a negative extent ($FFxx) grows UP.
    // $2C stays 8-bit on purpose: `signed8($2E)` below reads $2E's low byte
    // (correct for both signs), and keeping $2C 8-bit leaves the `$2C >= $19`
    // row-handler dispatch unchanged for up-growing objects — widening $2C
    // there is what regressed ~50 levels in an earlier attempt.
    const dirIdx = signed16(state.zp2E) < 0 ? 1 : 0;
    if (dirIdx === 1) {
      state.zp2C = (state.zp2C - 1) & 0xff;
    } else {
      state.zp2C = (state.zp2C + 1) & 0xff;
    }

    const rowExtent = signed8(state.zp2E);
    const rowCounter = signed8(state.zp2C);
    if (rowCounter === rowExtent) {
      if (doRowWrap(state)) return;
      // perRowSetup again for the new column.
      state.zp14 = 0;
      getCurrentMap16Tile(state);
      continue;
    }

    // Within-column step: compute next cell byte offset, latch it.
    const nextByte = (state.zp1D + signed16(CELL_BYTE_DELTA[dirIdx])) & 0xffff;
    const needsPageWrap =
      (nextByte & 0xfe00) === 0 ||
      (nextByte & 0x01e0) === PAGE_WRAP_MASK[dirIdx];

    if (!needsPageWrap) {
      latchCell(state, nextByte);
      continue;
    }

    // Page-wrap path: allocate or look up the new screen page.
    state.zp00 = nextByte & 0x01ff;
    state.zp14 = (state.zp14 + SLOPE_ADVANCE[dirIdx]) & 0xff;
    const newX = (state.zp14 + state.zp1C) & 0xff;
    const offset = resolveScreenPage(state, newX); // may throw ScreenOverflowError
    latchCell(state, offset);
  }
}

/** Inline cell-latch: store byte offset in $1D, 16-bit Map16 ID in $12. */
function latchCell(state: DecodeState, byteOffset: number): void {
  const off = byteOffset & 0xffff;
  state.zp1D = off;
  const lo = state.levelDataBuffer[off] ?? 0;
  const hi = state.levelDataBuffer[(off + 1) & 0xffff] ?? 0;
  state.zp12 = lo | (hi << 8);
}

/**
 * Port of CODE_walker_row_wrap (row-wrap). Returns `true` if the walker is done
 * (column counter caught the column extent), `false` if a new column
 * should start (caller will run perRowSetup).
 */
function doRowWrap(state: DecodeState): boolean {
  // Cart `LDA $1B` (Bank12.asm:1038) runs in REP #$20 — reads the WORD
  // at $1C:$1B. Our zp1B/zp1C are separate 8-bit fields, so combine
  // them into a 16-bit value before doing the cart's nibble math, then
  // split the result back into both fields. Critical for objects that
  // step right past sub-X = $F (overflow into screen-X nibble of $1C)
  // or step left from sub-X = $0 (underflow borrows from screen-X).
  const word1B = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  const screenKeep = word1B & 0xf0f0;
  state.zp2C = 0;
  state.zp00 = screenKeep;

  let subXLo: number;
  // Column direction = sign of $2A. Cart `LDA $2A ; BPL step_right`
  // (Bank12.asm:1042) runs in REP #$20 (16-bit A), so it branches on bit 15,
  // NOT bit 7 — the same gotcha as the $9B test below. An earlier `& 0x80`
  // (8-bit) read width +128 ($2A = $0080, bit 7 set) as negative and grew the
  // object LEFT, wrapping it around the level — e.g. 6-6's width-128 floor
  // (length byte $7F → $2A = $0080) rendered as two halves flanking its bounds.
  // The 16-bit sign keeps $0080 positive (grows right, inside bounds).
  // $28 (column counter) is a 16-bit word: the cart's `INC.b $28` / `DEC.b $28`
  // run under REP #$30 (16-bit A — see the `AND.w #$F0F0` framing them), so for
  // a left-growing object it counts $FFFF, $FFFE, … down toward $2A, NOT $FF,
  // $FE, …. Masking to 8-bit here used to collapse $FFFC → $FC, so handlers that
  // read $28 as a signed 16-bit column index (e.g. the std-79 stairs' right-edge
  // test `col-1 == $2A`, with $2A = $FFFB) never matched the terminal column and
  // stamped one row too many (the extra tile at the bottom of left-facing stairs).
  if (signed16(state.zp2A) < 0) {
    state.zp28 = (state.zp28 - 1) & 0xffff;
    subXLo = ((word1B & 0x0f0f) - 1) & 0xffff;
  } else {
    state.zp28 = (state.zp28 + 1) & 0xffff;
    subXLo = ((word1B | 0x00f0) + 1) & 0xffff;
  }

  const newWord = ((subXLo & 0x0f0f) | screenKeep) & 0xffff;
  state.zp1B = newWord & 0xff;
  state.zp1C = (newWord >>> 8) & 0xff;

  // Cart `LDA.b $28 ; CMP.b $2A ; BEQ done` — a 16-bit equality test (REP #$30).
  if ((state.zp28 & 0xffff) === (state.zp2A & 0xffff)) {
    return true; // walker done
  }

  if (state.rewound !== 0) {
    rewindNibble(state);
    // Cart Bank12.asm:1067-1068: `LDA $9B ; BMI skip-extent-adjust`.
    // `BMI` runs in REP #$30 (16-bit A) — tests bit 15 of the word at
    // $9B, not bit 7. So $9B = $8000 (lift-track marker) and $9B =
    // $FFFF both skip the $2E bump; $9B = $0080 (positive in 16-bit)
    // would NOT skip in the cart but did in earlier `& 0x80` versions.
    if ((state.rewound & 0x8000) !== 0) {
      return false; // go to next row setup
    }
    state.zp2E = (state.zp2E + state.zp17) & 0xffff;
    if (state.zp2E === 0) return true; // done
  }

  return false; // continue
}

/** Port of CODE_walker_rewind_nibble (walker_rewind_nibble). Cart reads $1B as a
 *  16-bit word (covers $1B:$1C bytes); we combine our two 8-bit fields
 *  before doing the nibble math, then split back. Same rationale as
 *  the `word1B` reconstruction in doRowWrap. */
function rewindNibble(state: DecodeState): void {
  // $02 = $17 & $0F00
  state.zp02 = (state.zp17 & 0x0f00) & 0xffff;
  // $00 = $17 << 4
  state.zp00 = ((state.zp17 << 4) & 0xffff);
  // $1B = ((($1B & $F0F0) | $02) - $00) & $F0F0 | ($1B & $0F0F)
  const word1B = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  let hi = (word1B & 0xf0f0) | state.zp02;
  hi = (hi - state.zp00) & 0xf0f0;
  const newWord = (hi | (word1B & 0x0f0f)) & 0xffff;
  state.zp1B = newWord & 0xff;
  state.zp1C = (newWord >>> 8) & 0xff;
}


