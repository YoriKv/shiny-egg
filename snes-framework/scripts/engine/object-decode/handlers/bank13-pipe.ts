// Bank13 generic pipe stamp + Bank12 init wrapper.
//
// Covers standard objects $A5 (vertical pipe) and $A6 (horizontal pipe).
// Both objects share `CODE_init_pipe` ($12:9EB0) which picks one of four
// sub-dispatches via the orientation byte `$15`:
//
//   $15 bit 1 = 0 → vertical pipe  ($A5)
//   $15 bit 1 = 1 → horizontal pipe ($A6)
//   $15 bit 2 = 0 → land variant   (any tileset != $03)
//   $15 bit 2 = 1 → water variant  (BG1 tileset == $03 only)
//
// Init also forces a 2-cell extent on the cross-axis (col for vert, row
// for horiz) — see DP-diff. In the water-tileset path the override comes
// from DATA_pipe_extent_override = { $0002, $0004 } so the water-pipe
// shapes can have 4 rows / 4 cols instead of 2.
//
//
// Asm references:
//   yi/Banks/Bank12.asm:4718   DATA_pipe_extent_override          ($12:9EAC)
//   yi/Banks/Bank12.asm:4723   CODE_init_pipe                     ($12:9EB0)
//   yi/Banks/Bank13.asm:11035  CODE_pipe_dispatch                 ($13:DB17)
//   yi/Banks/Bank13.asm:11020  DATA_13DB0F (sub-dispatch pointers)
//   yi/Banks/Bank13.asm:11047  DATA_13DB2A (vert  cap/mid/cap ptr table)
//   yi/Banks/Bank13.asm:11073  DATA_13DB4E (vert top-cap   tiles)
//   yi/Banks/Bank13.asm:11092  DATA_13DB66 (vert mid       tiles)
//   yi/Banks/Bank13.asm:11105  DATA_13DB7C (vert bottom-cap tiles)
//   yi/Banks/Bank13.asm:11124  DATA_13DB94 (horiz cap/mid/cap ptr table)
//   yi/Banks/Bank13.asm:11150  DATA_13DBB8 (horiz left-cap  tiles)
//   yi/Banks/Bank13.asm:11169  DATA_13DBD0 (horiz mid       tiles)
//   yi/Banks/Bank13.asm:11182  DATA_13DBE7 (horiz right-cap tiles)
//   yi/Banks/Bank13.asm:11213  CODE_pipe_water_horiz_sub_dispatch
//   yi/Banks/Bank13.asm:11268  CODE_pipe_water_vert_sub_dispatch
//   yi/Banks/Bank13.asm:11232  DATA_13DC1E (water-horiz left  tiles)
//   yi/Banks/Bank13.asm:11240  DATA_13DC2A (water-horiz mid   tiles)
//   yi/Banks/Bank13.asm:11256  DATA_13DC4C (water-horiz right tiles)
//   yi/Banks/Bank13.asm:11264  DATA_13DC58 (water-vert        tiles)
//
// Init handler ($12:9EB0) pseudocode (REP #$20):
//   $15 &= $0002              ; keep only the vert/horiz selector bit
//   X = $15 << 1              ; X = 0 (vert) or 4 (horiz)
//   A = $0002                 ; default extent
//   if header.bg1Tileset == 3:
//     $15 |= $0004             ; promote to water sub-dispatch (4 or 6)
//     A = DATA_pipe_extent_override[$15 & $0002]   ; $0002 or $0004
//   $2A,x = A                 ; X=0 → write $2A (vert col-extent),
//                              ; X=4 → write $2E (horiz row-extent)
//   tail-call CODE_walker_setup_trampoline w/ stamp = CODE_pipe_dispatch
//
// Per-cell stamp `CODE_pipe_dispatch` ($13:DB17):
//   X = $15                                ; sub-dispatch selector (0/2/4/6)
//   JSR (DATA_13DB0F,x)                    ; vert / horiz / water-vert / water-horiz
//     → returns tile in Y; Y=0 means "suppress stamp"
//   if Y != 0: STAMP Y
//
// Each sub-dispatch picks one of 3 "shape" handlers (top/left cap, mid,
// bottom/right cap) based on whether $2C/$28 is at the start, middle, or
// end of its extent — and the cap handlers further gate on `$12` so they
// don't blank a cell that's already a "ground" tile (zero / $1600 = the
// "skip" sentinel used elsewhere in the stamping pipeline).

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Extent-override table for the water-tileset path
// (DATA_pipe_extent_override, $12:9EAC).
// ─────────────────────────────────────────────────────────────────────

const DATA_pipe_extent_override = [0x0002, 0x0004] as const;

// ─────────────────────────────────────────────────────────────────────
// Tile tables — vertical (land) pipe.
// ─────────────────────────────────────────────────────────────────────

// DATA_13DB4E — vertical pipe TOP CAP (top-left, top-right).
const DATA_pipe_vert_top_tiles    = [0x7D02, 0x7D03] as const;
// DATA_13DB66 — vertical pipe MID body (left-even, left-odd, right-even, right-odd row).
const DATA_pipe_vert_mid_tiles    = [0x01C9, 0x01CA, 0x01C7, 0x01C8] as const;
// DATA_13DB7C — vertical pipe BOTTOM CAP (bottom-left, bottom-right).
const DATA_pipe_vert_bot_tiles    = [0x7D06, 0x7D07] as const;

// ─────────────────────────────────────────────────────────────────────
// Tile tables — horizontal (land) pipe.
// ─────────────────────────────────────────────────────────────────────

// DATA_13DBB8 — horiz pipe LEFT CAP (top-row, bottom-row).
const DATA_pipe_horiz_left_tiles  = [0x7D00, 0x7D01] as const;
// DATA_13DBD0 — horiz pipe MID body (top-even, bottom-even, top-odd, bottom-odd column).
const DATA_pipe_horiz_mid_tiles   = [0x01C4, 0x01C3, 0x01C5, 0x01C6] as const;
// DATA_13DBE7 — horiz pipe RIGHT CAP (top-row, bottom-row).
const DATA_pipe_horiz_right_tiles = [0x7D04, 0x7D05] as const;

// ─────────────────────────────────────────────────────────────────────
// Tile tables — water variants. Only consumed when BG1 tileset == $03.
// No spec-trace coverage; ported directly from the cart's tables.
// ─────────────────────────────────────────────────────────────────────

// DATA_13DC1E — water-horiz LEFT-cap tiles (4 entries, row-indexed).
const DATA_pipe_water_horiz_left_tiles  = [0x3D2B, 0x7D1E, 0x7D1F, 0x9056] as const;
// DATA_13DC2A — water-horiz MID tiles (8 entries; (row, col-parity) phase).
const DATA_pipe_water_horiz_mid_tiles   = [
  0x3D2C, 0x3D2D, 0x9052, 0x9053,
  0x9054, 0x9055, 0x9057, 0x9058,
] as const;
// DATA_13DC4C — water-horiz RIGHT-cap tiles (4 entries, row-indexed).
const DATA_pipe_water_horiz_right_tiles = [0x3D2E, 0x7D20, 0x7D21, 0x9059] as const;
// DATA_13DC58 — water-vert tiles (4 entries; row-bucket 0..3 selects, $28
// added at the end for the per-column variant).
const DATA_pipe_water_vert_tiles        = [0x905A, 0x3D29, 0x7D1C, 0x9050] as const;

// ─────────────────────────────────────────────────────────────────────
// Cap-tile gating helper (shared by all 4 vert/horiz cap handlers).
//
// The cart's cap handlers (CODE_pipe_vert_top_cap, _bottom_cap,
// CODE_pipe_horiz_left_cap, _right_cap) all share the same shape:
//   if $12 == $0000 OR $12 == $1600: stamp table[y]
//   else:                            return $0000  (Y = 0 → suppress stamp)
// `$12` is the current cell's Map16 ID (latched by getCurrentMap16Tile);
// $0000 = empty buffer, $1600 = a "skip"/transparent sentinel used by
// pipe shapes to avoid clobbering ground tiles.
// ─────────────────────────────────────────────────────────────────────

function capTileOrZero(state: DecodeState, table: readonly number[], y: number): number {
  const cur = state.zp12 & 0xffff;
  if (cur === 0x0000 || cur === 0x1600) {
    return table[y] ?? 0;
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────────
// Vertical sub-dispatch (CODE_pipe_vert_sub_dispatch, $13:DB30).
//
// Y latch:   $28 & 1 << 1   (col-parity: even=0, odd=2)
// Cap select via $2C:
//   $2C == 0          → top-cap     (DATA_pipe_vert_top_tiles)
//   $2C + 1 == $2E    → bottom-cap  (DATA_pipe_vert_bot_tiles)
//   otherwise         → mid body    (DATA_pipe_vert_mid_tiles)
//
// Cap handlers gate on $12; mid handler always stamps. Returns Map16 ID
// in Y; Y=0 suppresses the stamp.
// ─────────────────────────────────────────────────────────────────────

function pipeVertSubDispatch(state: DecodeState): number {
  const colParityIdx = (state.zp28 & 0x0001) << 1;
  const row = state.zp2C & 0xffff;
  const rowExtent = state.zp2E & 0xffff;

  if (row === 0) {
    // CODE_pipe_vert_top_cap — DATA_13DB4E[colParityIdx>>1].
    return capTileOrZero(state, DATA_pipe_vert_top_tiles, colParityIdx >>> 1);
  }
  if (((row + 1) & 0xffff) === rowExtent) {
    // CODE_pipe_vert_bottom_cap — DATA_13DB7C[colParityIdx>>1].
    return capTileOrZero(state, DATA_pipe_vert_bot_tiles, colParityIdx >>> 1);
  }
  // CODE_pipe_vert_middle_tile — DATA_13DB66[ (row&1)<<2 | colParityIdx ].
  // The asm `LDA $2C ; AND #$0001 ; ASL ; ASL ; ORA $00` builds Y from
  // bit 0 of row (shifted to bit 2) ORed with the cached col-parity byte
  // ($00 = col-parity << 1). Then `LDA DATA_13DB66,y` is byte-indexed so
  // entries are 2 bytes apart; our word-array index = Y / 2.
  const yByte = (((row & 0x01) << 1) << 1) | colParityIdx;
  return DATA_pipe_vert_mid_tiles[yByte >>> 1] ?? 0;
}

// ─────────────────────────────────────────────────────────────────────
// Horizontal sub-dispatch (CODE_pipe_horiz_sub_dispatch, $13:DB9A).
//
// Mirror of the vertical case, with $28/$2A and $2C/$2E swapped:
//   $28 == 0          → left-cap   (DATA_pipe_horiz_left_tiles)
//   $28 + 1 == $2A    → right-cap  (DATA_pipe_horiz_right_tiles)
//   otherwise         → mid body   (DATA_pipe_horiz_mid_tiles)
//
// Y latch built from row-parity ($2C & 1); mid additionally factors in
// col-parity ($28 & 1).
// ─────────────────────────────────────────────────────────────────────

function pipeHorizSubDispatch(state: DecodeState): number {
  const rowParityIdx = (state.zp2C & 0x0001) << 1;
  const col = state.zp28 & 0xffff;
  const colExtent = state.zp2A & 0xffff;

  if (col === 0) {
    // CODE_pipe_horiz_left_cap — DATA_13DBB8[rowParityIdx>>1].
    return capTileOrZero(state, DATA_pipe_horiz_left_tiles, rowParityIdx >>> 1);
  }
  if (((col + 1) & 0xffff) === colExtent) {
    // CODE_pipe_horiz_right_cap — DATA_13DBE7[rowParityIdx>>1].
    return capTileOrZero(state, DATA_pipe_horiz_right_tiles, rowParityIdx >>> 1);
  }
  // CODE_pipe_horiz_middle_tile. The asm pattern is:
  //   ASL $00                         ; row-parity *= 2 (was already <<1)
  //   LDA $28 ; AND #$0001 ; ASL ; ORA $00 ; TAY
  //   LDA DATA_13DBD0,y               ; byte-indexed lookup
  // So Y = (rowParity << 2) | (colParity << 1) — 4 entries × 2 bytes.
  const yByte = (rowParityIdx << 1) | ((col & 0x0001) << 1);
  return DATA_pipe_horiz_mid_tiles[yByte >>> 1] ?? 0;
}

// ─────────────────────────────────────────────────────────────────────
// Water-vertical sub-dispatch (CODE_pipe_water_vert_sub_dispatch, $13:DC60).
//
// 4-bucket row classifier:
//   $2C == 0        → bucket 0 (top cap)
//   $2C + 1 == $2E  → bucket 1 (penultimate row)
//   $2C + 2 == $2E  → bucket 2 (mid)
//   otherwise       → bucket 3 (default mid)
// final tile = DATA_pipe_water_vert_tiles[bucket] + $28      (per-column shift)
// No $12 gating — water-pipe always stamps.
// ─────────────────────────────────────────────────────────────────────

function pipeWaterVertSubDispatch(state: DecodeState): number {
  const row = state.zp2C & 0xffff;
  const rowExtent = state.zp2E & 0xffff;
  let bucket = 0;
  if (row === 0) {
    bucket = 0;
  } else if (((row + 1) & 0xffff) === rowExtent) {
    bucket = 1;
  } else if (((row + 2) & 0xffff) === rowExtent) {
    bucket = 2;
  } else {
    bucket = 3;
  }
  const base = DATA_pipe_water_vert_tiles[bucket] ?? 0;
  // Cart `CLC ; ADC $28 ; TAY ; RTS` — add column for the per-col variant.
  return (base + (state.zp28 & 0xffff)) & 0xffff;
}

// ─────────────────────────────────────────────────────────────────────
// Water-horizontal sub-dispatch (CODE_pipe_water_horiz_sub_dispatch, $13:DC05).
//
// Same cap/mid/cap shape as the land horiz pipe, but the cap handlers
// don't gate on $12 — they unconditionally stamp from DATA_13DC1E /
// DATA_13DC4C, and the mid handler uses an 8-entry table indexed by
// (row, col-parity).
// ─────────────────────────────────────────────────────────────────────

function pipeWaterHorizSubDispatch(state: DecodeState): number {
  // Asm `LDA $2C ; ASL ; TAY` — Y = row * 2 (byte-indexed).
  const rowByte = (state.zp2C & 0xffff) << 1;
  const col = state.zp28 & 0xffff;
  const colExtent = state.zp2A & 0xffff;

  if (col === 0) {
    // CODE_pipe_water_horiz_left_tile — DATA_13DC1E[row].
    return DATA_pipe_water_horiz_left_tiles[(rowByte >>> 1) & 0x03] ?? 0;
  }
  if (((col + 1) & 0xffff) === colExtent) {
    // CODE_pipe_water_horiz_right_tile — DATA_13DC4C[row].
    return DATA_pipe_water_horiz_right_tiles[(rowByte >>> 1) & 0x03] ?? 0;
  }
  // CODE_pipe_water_horiz_middle_tile:
  //   $00 = $28 & 1
  //   y = (($2C << 1) | $00) << 1 ; word-index into DATA_13DC2A
  // → effective index into our word array = (($2C << 1) | colParity).
  const yByte = (((state.zp2C & 0xffff) << 1) | (col & 0x0001)) << 1;
  return DATA_pipe_water_horiz_mid_tiles[(yByte >>> 1) & 0x07] ?? 0;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_pipe_dispatch ($13:DB17). Reads $15 (0/2/4/6), picks the
// sub-dispatch, then stamps if the returned tile != 0.
// ─────────────────────────────────────────────────────────────────────

const pipeDispatch: PerCellHandler = (state) => {
  const sel = state.zp15 & 0x0006;
  let tile = 0;
  switch (sel) {
    case 0: tile = pipeVertSubDispatch(state); break;
    case 2: tile = pipeHorizSubDispatch(state); break;
    case 4: tile = pipeWaterVertSubDispatch(state); break;
    case 6: tile = pipeWaterHorizSubDispatch(state); break;
    default: tile = 0;
  }
  if ((tile & 0xffff) !== 0) {
    stampCell(state, tile & 0xffff);
  }
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_pipe ($12:9EB0). Shared init for std $A5 (vert) + $A6 (horiz).
//
// Mirrors the cart routine literally — see the file-header pseudocode.
// BG1 tileset comes from `state.header[1] & 0x0F` (matches templates.ts).
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0xA5, 0xA6 share this handler.
const initPipe: InitHandler = (state) => {
  // REP #$20 ; LDA $15 ; AND #$0002 ; STA $15 — keep only the vert/horiz bit.
  state.zp15 = state.zp15 & 0x0002;
  // ASL ; TAX — X = $15 << 1 = 0 (vert) or 4 (horiz). Used to pick
  // between writing $2A (col-extent) and $2E (row-extent).
  const writeRowExtent = state.zp15 !== 0;

  // Default extent for both axes.
  let extent = 0x0002;

  // Water-tileset override path (BG1 tileset == $03).
  const bg1Tileset = state.header[1]! & 0x0F;
  if (bg1Tileset === 0x03) {
    // LDA $15 ; TAY ; ORA #$0004 ; STA $15 — promote to water sub-dispatch.
    // Y still holds the pre-ORA $15 (0 or 2) for the table read.
    const yPre = state.zp15;
    state.zp15 = state.zp15 | 0x0004;
    // LDA DATA_pipe_extent_override,y — y is byte-indexed into a word-table, so the
    // effective word-array index is y >> 1 (0 or 1).
    extent = DATA_pipe_extent_override[yPre >>> 1] ?? 0x0002;
  }

  // STA $2A,x — write to $2A (X=0, vert) or $2E (X=4, horiz).
  if (writeRowExtent) {
    state.zp2E = extent;
  } else {
    state.zp2A = extent;
  }

  walkerSetupTrampoline(state, pipeDispatch);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Both $A5 and $A6 dispatch to CODE_init_pipe at $12:9EB0.
// ─────────────────────────────────────────────────────────────────────

export function installPipeHandlers(): void {
  registerStdObjectHandler(0xA5, initPipe);
  registerStdObjectHandler(0xA6, initPipe);
}
