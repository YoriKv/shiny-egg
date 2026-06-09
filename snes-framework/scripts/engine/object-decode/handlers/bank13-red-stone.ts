// Bank13 stamp handler for the small lava-rock structure (std object $39).
//
// Init: `CODE_init_red_stone` ($12:9626, Bank12.asm:3461). Rounds
// $2A and $2E up to even (forces a 2x2 footprint per "cell group"), then
// tail-calls into the walker setup trampoline pointing at
// `CODE_stamp_red_stone` ($13:9F83, Bank13.asm:4183).
//
// Per-cell stamp `CODE_stamp_red_stone`:
//   y = (($28 & 1) | (($2C & 1) << 1)) << 1   ; 4-quadrant parity index
//   stamp DATA_139F73[y/2]                    ; base tile from $9D08/09/10/11
//   dispatch via DATA_139F7B[y/2] to one of:
//     y=0 (col even, row even) → corner_tl  ; probes above + left + above-left
//     y=2 (col odd,  row even) → corner_tr  ; probes above + right + above-right
//     y=4 (col even, row odd)  → corner_bl  ; probes below + left  + below-left
//     y=6 (col odd,  row odd)  → corner_br  ; probes below + right + below-right
//
// The 4 corner subhandlers — shared with std $38 lava_rock_large — are
// "adjacency detail" stampers: they re-stamp surrounding cells with
// "detail" tiles from DATA_139ACB iff all three probed neighbours are in
// the $9D00..$9DFF range (i.e. already part of THIS lava-rock object).
// At a boundary (probe hits $0000 or non-$9D tile) they bail early, so
// only the inner cells of multi-block clusters get the decoration pass.
//
// Asm sources:
//   yi/Banks/Bank12.asm:3461   CODE_init_red_stone
//   yi/Banks/Bank13.asm:4183   CODE_stamp_red_stone  (per-cell)
//   yi/Banks/Bank13.asm:3743   CODE_lava_rock_large_corner_tl
//   yi/Banks/Bank13.asm:3847   CODE_lava_rock_large_corner_tr
//   yi/Banks/Bank13.asm:3998   CODE_lava_rock_large_corner_bl
//   yi/Banks/Bank13.asm:4102   CODE_lava_rock_large_corner_br
//   yi/Banks/Bank13.asm:4158   CODE_lava_rock_large_stamp_detail
//   yi/Banks/Bank13.asm:3667   DATA_139ACB (adjacency-detail lookup)
//   yi/Banks/Bank13.asm:4166   DATA_139F73 (4 base tiles)
//

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import {
  getMap16Above, getMap16Below, getMap16Left, getMap16Right,
} from '../fetch.ts';
import { readBuf16, setProbeToCurrent, stampCell, writeBuf16 } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_139F73 (Bank13.asm:4166). 4 base tiles indexed by 2-bit parity
// of ($28 & 1) | (($2C & 1) << 1):
//   0 → $9D08 (TL)   1 → $9D09 (TR)
//   2 → $9D10 (BL)   3 → $9D11 (BR)
// Asm uses 16-bit indexing into a word table, so the asm Y values are
// $0000, $0002, $0004, $0006 — we keep the 0..3 quadrant index here.
// ─────────────────────────────────────────────────────────────────────
const DATA_139F73 = [0x9D08, 0x9D09, 0x9D10, 0x9D11] as const;

// ─────────────────────────────────────────────────────────────────────
// DATA_139ACB (Bank13.asm:3667). Byte table consumed by
// CODE_lava_rock_large_stamp_detail: indexed by the LOW BYTE of the
// existing $9D-prefixed neighbour tile, returns a "detail" low-byte
// that gets ORd with $9D00 and re-written into that neighbour cell.
//
// 50 bytes total (covers low bytes $00..$31). Lookups outside this
// range never occur — the corner handlers only invoke stamp_detail
// after confirming the neighbour's high byte is $9D, and live cart
// data only uses $9D00..$9D31 for this object family.
// ─────────────────────────────────────────────────────────────────────
const DATA_139ACB = [
  0x04, 0x05, 0x06, 0x07, 0x04, 0x05, 0x06, 0x07,
  0x08, 0x09, 0x0E, 0x0B, 0x0C, 0x0F, 0x0E, 0x0F,
  0x1A, 0x1B, 0x16, 0x17, 0x18, 0x19, 0x16, 0x17,
  0x18, 0x19, 0x1A, 0x1B, 0x20, 0x21, 0x22, 0x23,
  0x20, 0x21, 0x22, 0x23, 0x28, 0x25, 0x26, 0x29,
  0x28, 0x29, 0x2E, 0x2F, 0x30, 0x31, 0x2E, 0x2F,
  0x30, 0x31,
] as const;

/** Cart `CODE_lava_rock_large_stamp_detail` ($13:9F64, Bank13.asm:4158).
 *  Looks up the low-byte of the existing tile in DATA_139ACB, ORs with
 *  $9D00, writes back at `off`. Caller passes `lowByte = existing & $FF`. */
function stampDetail(state: DecodeState, off: number, lowByte: number): void {
  const idx = lowByte & 0xff;
  const detail = (DATA_139ACB[idx] ?? 0) & 0xff;
  writeBuf16(state, off, 0x9D00 | detail);
}

/** Read the 16-bit Map16 tile at buffer offset `off`. */
function readTile(state: DecodeState, off: number): number {
  return readBuf16(state, off) & 0xffff;
}

/** Returns true iff `tile`'s high byte is $9D (== part of this
 *  lava-rock object family). */
function isLavaRockTile(tile: number): boolean {
  return (tile & 0xff00) === 0x9D00;
}

// ─────────────────────────────────────────────────────────────────────
// Corner subhandlers — common shape, parameterised by direction.
//
// Cart pseudocode (corner_tl shown; others mirror with vertical-direction
// + horizontal-direction probe pairs):
//
//   $0E = $1B                        ; probe coord = current cell
//   $04 = X@above; aboveTile = buf[X]
//   if (aboveTile & $FF00) != $9D00 → exit
//   $06 = aboveTile & $00FF
//   X@left = probe_left(); leftTile = buf[X]
//   $08 = X@left
//   if (leftTile & $FF00) != $9D00 → exit
//   $0A = leftTile & $00FF
//   ; advance probe coord one cell horizontally (DEC for left, INC for right)
//   $0E = ($1B & $F0F0) | (($1B & $0F0F) ±1) & $0F0F
//   X@diag = above($0E);  diagTile = buf[X]
//   if (diagTile & $FF00) != $9D00 → exit
//   ; All three neighbours are $9D-prefix — stamp 4 detail tiles.
//   stamp_detail(X@diag, diagTile & $FF)        ; above-left
//   stamp_detail($04, $06)                      ; above
//   stamp_detail($08, $0A)                      ; left
//   ; And re-stamp the current cell too (lookup using buf[$1D] & $FF).
//   currTile = buf[$1D]
//   if (currTile & $FF00) == $9D00:
//     stamp_detail($1D, currTile & $FF)
//
// Each corner uses a different (vertical, horizontal) probe pair:
//   tl: above + left  + above-left   (DEC sub-x)
//   tr: above + right + above-right  (INC sub-x)
//   bl: below + left  + below-left   (DEC sub-x)
//   br: below + right + below-right  (INC sub-x)
// ─────────────────────────────────────────────────────────────────────

type Vert = 'above' | 'below';
type Horiz = 'left' | 'right';

function vertProbe(state: DecodeState, dir: Vert): number {
  return dir === 'above' ? getMap16Above(state) : getMap16Below(state);
}
function horizProbe(state: DecodeState, dir: Horiz): number {
  return dir === 'left' ? getMap16Left(state) : getMap16Right(state);
}

/** Compute the "diagonal" probe coord by stepping the sub-x nibble of
 *  `$1B` by ±1 (cart uses `AND #$0F0F` after DEC/INC so screen-X is
 *  preserved). Returns the new low-byte for $0E. */
function diagSubX(zp1B: number, horiz: Horiz): number {
  const screenNib = zp1B & 0xf0f0;
  const subNib = zp1B & 0x0f0f;
  if (horiz === 'left') {
    return (screenNib | ((subNib - 1) & 0x0f0f)) & 0xffff;
  }
  // 'right': cart does `ORA #$00F0 ; INC ; AND #$0F0F`.
  const incd = (((subNib | 0x00f0) + 1) & 0x0f0f) & 0xffff;
  return (screenNib | incd) & 0xffff;
}

function lavaRockCorner(state: DecodeState, vert: Vert, horiz: Horiz): void {
  // $0E := full 16-bit composite of $1B:$1C (probe coord — fetch
  // primitives read zp0E as 16-bit). Required for cross-page probes.
  setProbeToCurrent(state);
  const offVert = vertProbe(state, vert);
  const tileVert = readTile(state, offVert);
  if (!isLavaRockTile(tileVert)) return;

  // Probe horizontally. (`probe_left/right` are inline helpers that reset
  // $0E to $1B first — we mirror via setProbeToCurrent + getMap16_xxx.)
  setProbeToCurrent(state);
  const offHoriz = horizProbe(state, horiz);
  const tileHoriz = readTile(state, offHoriz);
  if (!isLavaRockTile(tileHoriz)) return;

  // Advance probe coord to the diagonal cell (vert direction of the
  // horizontal neighbour) and read its tile. `diagSubX` builds a 16-bit
  // coord from the full $1B:$1C word.
  const word1B = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  state.zp0E = diagSubX(word1B, horiz);
  state.zp0F = (state.zp0E >>> 8) & 0xff;
  const offDiag = vertProbe(state, vert);
  const tileDiag = readTile(state, offDiag);
  if (!isLavaRockTile(tileDiag)) return;

  // All three neighbours are part of the rock — write the detail
  // overrides. Order matches the cart (diag, vert, horiz, current).
  stampDetail(state, offDiag,  tileDiag  & 0xff);
  stampDetail(state, offVert,  tileVert  & 0xff);
  stampDetail(state, offHoriz, tileHoriz & 0xff);

  // Current cell — only if it's still $9D-prefix (always true here since
  // we just stamped a $9D0X base tile).
  const currOff = state.zp1D & 0x7fff;
  const currTile = readTile(state, currOff);
  if (isLavaRockTile(currTile)) {
    stampDetail(state, currOff, currTile & 0xff);
  }
}

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_red_stone (Bank13.asm:4183) per-cell handler.
// ─────────────────────────────────────────────────────────────────────
const redStonePerCell: PerCellHandler = (state) => {
  // y = (($28 & 1) | (($2C & 1) << 1))  — 0..3 quadrant index.
  // Cart actually computes ($2C & 1) << 2  then ORA ($28 & 1) << 1 to get
  // a word-table offset $0000/$0002/$0004/$0006; we collapse to 0..3.
  const colBit = state.zp28 & 1;
  const rowBit = state.zp2C & 1;
  const quad = colBit | (rowBit << 1);

  // Stamp base tile from DATA_139F73.
  stampCell(state, DATA_139F73[quad]!);

  // Dispatch to corner subhandler.
  switch (quad) {
    case 0: // TL — even col, even row
      lavaRockCorner(state, 'above', 'left');
      break;
    case 1: // TR — odd col, even row
      lavaRockCorner(state, 'above', 'right');
      break;
    case 2: // BL — even col, odd row
      lavaRockCorner(state, 'below', 'left');
      break;
    case 3: // BR — odd col, odd row
      lavaRockCorner(state, 'below', 'right');
      break;
  }
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_red_stone (Bank12.asm:3461).
//
//   REP #$20
//   $2A = ($2A + 1) & $FFFE       ; round col extent up to even
//   $2E = ($2E + 1) & $FFFE       ; round row extent up to even
//   tail-call walker_setup_trampoline with CODE_stamp_red_stone
//
// The +1-then-mask forces a 2x2 minimum and keeps multi-block clusters
// aligned to a 2-cell grid so the corner-quadrant parity (col&1, row&1)
// classifies cells consistently into TL/TR/BL/BR.
// ─────────────────────────────────────────────────────────────────────

function initRedStone(state: DecodeState): void {
  state.zp2A = ((state.zp2A + 1) & 0xfffe) & 0xffff;
  state.zp2E = ((state.zp2E + 1) & 0xfffe) & 0xffff;
  walkerSetupTrampoline(state, redStonePerCell);
}

export function installRedStoneHandlers(): void {
  registerStdObjectHandler(0x39, initRedStone);
}
