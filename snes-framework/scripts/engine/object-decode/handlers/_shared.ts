// Shared utilities used by multiple Bank13 stamp/init handler files.
// Each helper mirrors a small piece of the cart's stamp epilogue or
// the floor-init shape; they were copy-pasted across handlers until
// the duplication count made consolidation worthwhile.
//
// Keep this module small and side-effect-free. Handler-family-specific
// state (per-cell tile tables, init mutations, walker dispatch) stays
// in the per-family file.
//
// PORTING PITFALL — dw-table indexing. The cart indexes `dw` (word) tables
// with a BYTE offset (`LDA table,y`, Y = byte index), but our ports hold a
// flat JS array (one entry per word). The faithful conversion is
// `table[byteOffset >> 1]`. Both directions have bitten us: std-88 used the
// raw byte offset → OOB/undefined → unstamped rows; std-A7 applied an extra
// `>>1` to an already-flat index → garbled output. Convention is
// `table[y>>1]`; verify the shift when porting any table-lookup handler (the
// cart table VALUES are usually fine — the bug is in the INDEX).
//
// PORTING PITFALL — a scan that overruns its named table. Some cart scans
// (`LDX DATA_label,y` in a loop) terminate on a `CPY #$xxxx` whose bound is
// LARGER than the named table, deliberately running into the tables laid out
// contiguously after it in memory and treating the whole region as N
// back-to-back tables. The match offset / table-size then encodes WHICH table
// matched. A port that walks only the named array gets a wrong (usually
// index-0) result. Check each scan's `CPY` bound against the named table's
// byte length; if it's a multiple, port the full contiguous region in
// memory-layout order (verify the order entry-for-entry against the asm `dw`
// blocks). Bit us in std-4E `bg_autotile_block` class_subindex ($13:AC15,
// `CPY #$03E0` = 16 contiguous 62-byte tables) — see
// `bank13-bg-autotile-block.ts` CLASS_SCAN_TABLES; the truncated scan mis-
// stamped every overlapping-block cell across 20 levels.

import type { DecodeState, PerCellHandler } from '../state.ts';
import { prngNext, RNG_SITE } from '../prng.ts';
import { TT } from '../template-slots.ts';
import {
  getMap16Left, getMap16Right, getMap16Above, getMap16Below,
  getCurrentMap16Tile,
} from '../fetch.ts';
import { walkerSetupKeepSlope, walkerSetupTrampoline } from '../walker.ts';
// Re-export so handler files can keep importing signed8/signed16 from
// './_shared.ts'. Authoritative definition lives in `../utils.ts` —
// also consumed by walker.ts.
export { signed8, signed16 } from '../utils.ts';

/** Provenance recorder for the object-drag cell-highlight. No-op unless targets
 *  are armed (`provenanceCells !== null`), so the normal decode path pays only a
 *  null check. Classifies each write by a TARGET object as its own FOOTPRINT vs a
 *  NEIGHBOUR touch-up by comparing the written offset to the current cell (`$1D`)
 *  — the cart's `PutTile` (current cell) vs `PutrTile` (offset cell) distinction,
 *  robust to handlers that stamp their own cell through `writeBuf16` (e.g.
 *  no_egg_grass). A later NON-target object overwriting a recorded cell flips it
 *  to buried. With several targets the cell map is last-writer-wins: a later
 *  target re-stamping a buried cell restores it to footprint/neighbour (matching
 *  what the decode renders), and stream order guarantees a non-target writer that
 *  finds an existing entry came after the target that wrote it. */
function recordProvenance(state: DecodeState, off: number): void {
  const m = state.provenanceCells;
  const targets = state.provenanceTargets;
  if (m === null || targets === null) return;
  const idx = state.currentObjectIndex;
  if (targets.has(idx)) {
    m.set(off, { neighbor: off !== (state.zp1D & 0x7fff), buried: false, by: idx });
  } else {
    const e = m.get(off);
    if (e !== undefined && idx > e.by) e.buried = true;
  }
}

/** Cart stamp epilogue (`STA.l !RAM_YI_Level_LevelDataBuffer,x` in REP
 *  #$30). Writes a 16-bit Map16 ID at the walker's current cell
 *  offset (`$1D`), low byte first. */
export function stampCell(state: DecodeState, map16Id: number): void {
  const off = state.zp1D & 0x7fff;
  state.levelDataBuffer[off]     = map16Id & 0xff;
  state.levelDataBuffer[off + 1] = (map16Id >>> 8) & 0xff;
  recordProvenance(state, off);
}

/** Read a 16-bit Map16 ID from LevelDataBuffer at an absolute byte
 *  offset. Used by neighbour-probe consumers (e.g. shape-aware
 *  fallbacks in `bg_floor_random`'s neighbour-fix paths). */
export function readBuf16(state: DecodeState, off: number): number {
  const a = off & 0xffff;
  const lo = state.levelDataBuffer[a] ?? 0;
  const hi = state.levelDataBuffer[(a + 1) & 0xffff] ?? 0;
  return lo | (hi << 8);
}

/** Write a 16-bit Map16 ID at an absolute buffer offset. Mirror of the
 *  `STA.l buffer,x` pattern used by neighbour-fix routines that
 *  override the adjacent cell's previously-stamped tile. */
export function writeBuf16(state: DecodeState, off: number, id: number): void {
  const a = off & 0x7fff;
  state.levelDataBuffer[a]     = id & 0xff;
  state.levelDataBuffer[(a + 1) & 0x7fff] = (id >>> 8) & 0xff;
  recordProvenance(state, a);
}

/** Reset the neighbour-probe coord ($0E/$0F) to the walker's current
 *  cell coord ($1B/$1C). The directional `get_map16_*` primitives read
 *  `zp0E` as a 16-bit composite (zp1B is the low byte, zp1C the high
 *  page byte) — they apply `$0f0f` / `$f0f0` masks across both nibble
 *  pairs of the word. Composing here ensures cross-page probes work
 *  correctly when `$1C` is non-zero. */
export function setProbeToCurrent(state: DecodeState): void {
  state.zp0E = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  state.zp0F = state.zp1C & 0xff;
}

/** Set the neighbour-probe coord ($0E/$0F) to the cell one column to the
 *  RIGHT of the walker's current cell, for a subsequent `getMap16Below`
 *  (i.e. the "below-right" neighbour). Cart
 *  `CODE_wall_h_block_below_right_probe` ($13:A333), in REP #$30:
 *
 *    LDA $1B ; PHA ; ORA #$00F0 ; INC ; AND #$0F0F ; STA $0E
 *    PLA ; AND #$F0F0 ; ORA $0E ; STA $0E
 *
 *  i.e. increment the sub-X nibble (carrying within the page) while
 *  preserving the screen-page nibbles. CRITICAL: `LDA $1B` is a 16-bit
 *  load of the full `$1C:$1B` word, so the `$F0F0` keep-mask retains the
 *  screen-page byte (`zp1C`). Composing from only `zp1B` (the low byte)
 *  zeroes the page and reads the below-right neighbour from screen page 0
 *  instead of the current screen — the diag ($42) / h-block ($41) /
 *  thick-a ($48) wall stamps all share this probe, so the math lives
 *  here once to keep the copies from drifting. */
export function setProbeToBelowRight(state: DecodeState): void {
  const word1B = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  const incLow = ((word1B | 0x00f0) + 1) & 0x0f0f;
  const keepHigh = word1B & 0xf0f0;
  const composed = (keepHigh | incLow) & 0xffff;
  state.zp0E = composed;
  state.zp0F = (composed >>> 8) & 0xff;
}

/** Cart `CODE_probe_left_tile` ($13:FD54). Sets probe coord to current
 *  cell, fetches the LEFT neighbour's buffer offset, returns its 16-bit
 *  Map16 ID. Used pervasively in Bank13 stamp epilogues for edge-blend
 *  decisions. */
export function probeLeftTile(state: DecodeState): number {
  setProbeToCurrent(state);
  return readBuf16(state, getMap16Left(state));
}

/** Cart `CODE_probe_right_tile` ($13:FD61). Mirror of `probeLeftTile`. */
export function probeRightTile(state: DecodeState): number {
  setProbeToCurrent(state);
  return readBuf16(state, getMap16Right(state));
}

/** Cart `CODE_probe_above_tile` (inline pattern). Returns the 16-bit
 *  Map16 ID of the cell directly above the current walker cell. */
export function probeAboveTile(state: DecodeState): number {
  setProbeToCurrent(state);
  return readBuf16(state, getMap16Above(state));
}

/** Cart `CODE_probe_below_tile` (inline pattern). */
export function probeBelowTile(state: DecodeState): number {
  setProbeToCurrent(state);
  return readBuf16(state, getMap16Below(state));
}

// ─────────────────────────────────────────────────────────────────────
// Neighbour-WRITE helpers — the write-side mirror of the probe* readers.
//
// Several ext handlers stamp a tile into an ADJACENT cell (not the current
// `$1D`): the cart pattern is `LDA $1B : STA $0E : JSL get_map16_<dir> :
// LDX result : LDA #tile : STA.l buffer,x`. The probe* helpers above cover
// the read half; these cover the write half so handlers don't re-derive
// `setProbeToCurrent + getMap16_<dir> + writeBuf16` inline.
//
// Used by the grass-seam handlers (tree_left_grass $4B, tree_right_grass
// $4A, no_egg_grass $8D), which paint a joint/blend tile onto the
// left/right/above neighbour after stamping their own cell.
// ─────────────────────────────────────────────────────────────────────

/** Stamp `id` into the cell directly LEFT of the current walker cell. */
export function stampLeftTile(state: DecodeState, id: number): void {
  setProbeToCurrent(state);
  writeBuf16(state, getMap16Left(state), id);
}

/** Stamp `id` into the cell directly RIGHT of the current walker cell. */
export function stampRightTile(state: DecodeState, id: number): void {
  setProbeToCurrent(state);
  writeBuf16(state, getMap16Right(state), id);
}

/** Stamp `id` into the cell directly ABOVE the current walker cell. */
export function stampAboveTile(state: DecodeState, id: number): void {
  setProbeToCurrent(state);
  writeBuf16(state, getMap16Above(state), id);
}

/** Stamp `id` into the cell directly BELOW the current walker cell. */
export function stampBelowTile(state: DecodeState, id: number): void {
  setProbeToCurrent(state);
  writeBuf16(state, getMap16Below(state), id);
}

/** Range-check used by wall-corner and slope seam-fix probes: returns
 *  true if the Map16 ID is in `[$0153, $0161)` — the cart's recognised
 *  mid-slope / wall-top shape range. The wall-corner-block handler
 *  ($44) additionally treats `$0151` / `$0152` as ceilings; this
 *  predicate is the slope-family subset (no $0151/$0152). */
export function isMidSlopeShape(tile: number): boolean {
  return tile >= 0x0153 && tile < 0x0161;
}

/** Cart's `LDA $1B ; AND #$F0F0 ; ADC #<delta> ; AND #$F0F0 ; ORA <subKeep>
 *  ; STA $1B` in REP #$30 mode. Adds `delta` to the screen-position
 *  nibbles ($F0F0 bits — screen-X in low byte, screen-Y in high byte) of
 *  the cell origin word, preserving the sub-position nibbles ($0F0F).
 *  Composes from both `state.zp1B` (low byte) and `state.zp1C` (high
 *  byte), writes back to both — so underflow/overflow from the low
 *  byte's screen-X nibble correctly propagates into the high byte's
 *  screen-Y nibble. Critical when an object is placed near the left
 *  edge of a screen page and the shift causes a borrow into the page
 *  byte. */
export function shiftOriginNibble(state: DecodeState, delta: number): void {
  const word1B = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  const subKeep = word1B & 0x0F0F;
  const screenKeep = ((word1B & 0xF0F0) + delta) & 0xF0F0;
  const newWord = (screenKeep | subKeep) & 0xffff;
  state.zp1B = newWord & 0xff;
  state.zp1C = (newWord >>> 8) & 0xff;
}

/** Cart `CODE_floor_row_shift_up` ($12:933A, Bank12.asm:2977).
 *  Decrements `$1B`'s screen-Y nibble by 1 tile-row (-`$0010` on the
 *  word at $1B:$1C) while preserving the sub-X/sub-Y nibbles, then
 *  bumps row-extent `$2E` by 1 to compensate for the upward origin
 *  shift. Shared by every "floor-with-edge" init that needs the
 *  slope-cap row to render above the body row.
 *
 *  EDGE CASE (cart-faithful, NOT a bug): a floor at y=0 shifts its cap row to
 *  y=-1, underflowing screen-Y to $F → screen index >= $80 → the walker
 *  overflows and stamps nothing. The cart does the same unconditional -$0010
 *  and actually fails to LOAD a level with a floor on the top row, so "y=0
 *  renders nothing" is correct — don't try to "fix" it. */
export function floorRowShiftUp(state: DecodeState): void {
  shiftOriginNibble(state, -0x0010);
  state.zp2E = (state.zp2E + 1) & 0xffff;
}

// ─────────────────────────────────────────────────────────────────────
// Flat-floor random-grass slot pool (DATA_floor_random_grass_8way_pool, Bank13.asm:545).
//
// Cart `CODE_floor_random_8way_pick` (CODE_floor_random_8way_pick) picks one of 8 slot
// addresses from this pool via `prng & 7`, then stamps the slot's
// Map16 ID (via templateAt). The 6 distinct underlying slots are
// flat-floor random-grass variants in the $1CAE-$1CEA family; the pool
// has 2 duplicates ($1CAE and $1CB0 repeated as entries 6-7) so those
// variants are picked 2/8 of the time.
//
// Used by: `bg_floor_random` (object $01), `big_floor_stamp` (object
// $67 non-jungle path), `floor_slope_22deg` row-4+ fallback, and
// `stamp_floor_slope_wide` ($5F/$60) interior fill.
// ─────────────────────────────────────────────────────────────────────

export const SLOT_RND_POOL_0 = 0x001CAE;
export const SLOT_RND_POOL_1 = 0x001CB0;
export const SLOT_RND_POOL_2 = 0x001CB2;
export const SLOT_RND_POOL_3 = 0x001CB4;
export const SLOT_RND_POOL_4 = 0x001CE8;
export const SLOT_RND_POOL_5 = 0x001CEA;

export const DATA_floor_random_grass_8way_pool = [
  SLOT_RND_POOL_0, SLOT_RND_POOL_1, SLOT_RND_POOL_2, SLOT_RND_POOL_3,
  SLOT_RND_POOL_4, SLOT_RND_POOL_5, SLOT_RND_POOL_0, SLOT_RND_POOL_1,
] as const;

/** Cart `CODE_floor_random_8way_pick` (CODE_floor_random_8way_pick). PRNG-picks an
 *  entry from `DATA_floor_random_grass_8way_pool` and stamps the dereferenced template-slot
 *  Map16 ID into the current walker cell. */
export function floorRandom8wayPick(state: DecodeState): void {
  const idx = prngNext(state, RNG_SITE.floorRandom8wayPick) & 0x07;
  const slot = DATA_floor_random_grass_8way_pool[idx]!;
  stampCell(state, state.templateAt(slot));
}

// ─────────────────────────────────────────────────────────────────────
// Jungle floor random-fill — the row≥4 body fill shared by every slope
// family ($E5–$EC). Cart `CODE_jungle_floor_random_fill` ($13:F654, PRNG
// roll at $13:F658): `(prng & $0F) + bias`, clamp to $0F, stamp. Single
// home here; slope handlers import it (it was copy-pasted into 4 files).
// ─────────────────────────────────────────────────────────────────────

/** `DATA_jungle_floor_fill_tiles` ($13:F634) — 16 entries (last 6 are the
 *  weighted "boring" $79E0), indexed by the clamped PRNG pick. */
export const DATA_jungle_floor_fill_tiles = [
  0x79BB, 0x79BC, 0x79BD, 0x79BE, 0x79BF, 0x79C0, 0x79C1, 0x79C2,
  0x79C3, 0x79C4, 0x79E0, 0x79E0, 0x79E0, 0x79E0, 0x79E0, 0x79E0,
] as const;

/** `CODE_jungle_floor_random_fill` — `bias` enters in `$00`; PRNG-pick 0..15,
 *  add bias, clamp to 15, stamp. PRNG site = `jungleFloorFill` ($13:F658). */
export function jungleFloorRandomFillBiased(state: DecodeState, bias: number): void {
  let pick = (prngNext(state, RNG_SITE.jungleFloorFill) & 0x0F) + bias;
  if (pick > 0x0F) pick = 0x0F;
  stampCell(state, DATA_jungle_floor_fill_tiles[pick]!);
}

// ─────────────────────────────────────────────────────────────────────
// Lift-track family shared sentinels.
//
// All three lift-track stamp handlers ($10 30°, $11/$12 45°, $13 static)
// share the rail-joint preserve check: if the existing cell is $00B4 or
// $00A7, overwrite with $00A7 (so an overlap of two lift tracks doesn't
// blank the rail). Bank13.asm: CODE_138505 / CODE_138511 / CODE_138540.
// ─────────────────────────────────────────────────────────────────────

export const LIFT_TRACK_KEEP_CHECK_A = 0x00B4;
export const LIFT_TRACK_KEEP_CHECK_B = 0x00A7;
export const LIFT_TRACK_KEEP_OUT     = 0x00A7;

// ─────────────────────────────────────────────────────────────────────
// Jungle family shared helpers.
//
// Three pieces of the jungle handler family are duplicated across enough
// files ($21 floor, $22/$23 walls, $24 mud floor, $25/$26 mud walls,
// $27/$28 slope45) that consolidation here cuts ~120 LOC and removes
// the risk of drift between callers.
//
//   - DATA_jungle_foliage_pool: 16-entry foliage random-pool (asm name
//     DATA_138FE1, Bank13.asm:2006).
//   - jungleFloorRandomBody:    rows-2/3+ stamp for the foliage body
//     (CODE_jungle_floor_random_body, Bank13.asm:2061 / $13:9049).
//   - jungleWallNeighbourClassify: 3-way page-range classifier on $12
//     (CODE_jungle_wall_neighbour_classify, Bank13.asm:2316 / $13:91F9).
//
// PRNG carry-flag caveat applies to jungleFloorRandomBody (see callers).
// ─────────────────────────────────────────────────────────────────────

/** DATA_138FE1 (Bank13.asm:2000-2008). 16-entry foliage pool used by
 *  every jungle-family per-cell handler that falls through to the
 *  "random body" branch (rows 2+ / 3+ depending on the handler). */
export const DATA_jungle_foliage_pool = [
  0x9068, 0x9069, 0x906A, 0x906D,
  0x906B, 0x906B, 0x906C, 0x906D,
  0x906E, 0x906F, 0x9070, 0x906D,
  0x9071, 0x906D, 0x906D, 0x906D,
] as const;

/** Cart `CODE_jungle_floor_random_body` ($13:9049, Bank13.asm:2061).
 *
 *  PRNG + $2C + 1, AND $1E, index DATA_138FE1 as words → stamp. The asm
 *  uses `ADC $2C` with NO preceding CLC, but the carry-in is NOT noise:
 *  every one of the six entry paths into the routine arrives via a `CMP`
 *  where A >= operand (rows≥3 `CMP #3;BCS`, the mud-floor `CMP #2;BCC;JMP`,
 *  the two slope `CMP #3;BCC;JMP`, the two row-2 `CMP #2;BNE;JMP`), all of
 *  which leave carry SET — and CODE_prng's PHP/PLP preserves it across the
 *  JSL. So the carry-in is a CONSTANT 1; the `+ 1` here is exact, not a
 *  fudge. (DATA_138FE1 = DATA_jungle_foliage_pool, verified byte-identical;
 *  its six $906D duplicates mean ~37% of cells render $906D regardless.) */
export function jungleFloorRandomBody(state: DecodeState): void {
  const idx = ((prngNext(state, RNG_SITE.jungleFloorRandomBody) + (state.zp2C & 0xff) + 1) & 0x1e) >>> 1;
  stampCell(state, DATA_jungle_foliage_pool[idx]!);
}

/** Cart `CODE_jungle_wall_neighbour_classify` ($13:91F9, Bank13.asm:2316).
 *
 *  Classifies the existing $12 (current cell's Map16 ID) into one of
 *  three "adjacency" buckets, returning the Y index callers use into a
 *  per-handler override table. Used by left/right walls, mud-wall-lr,
 *  and slope45.
 *
 *    $12 in [$9200, $9204) → 0
 *    $12 in [$9080, $9084) → 2
 *    $12 in [$9090, $9094) → 4
 *    otherwise             → 0xFFFF (caller's BMI skips override). */
export function jungleWallNeighbourClassify(state: DecodeState): number {
  const cur = state.zp12 & 0xffff;
  if (cur >= 0x9200 && cur < 0x9204) return 0;
  if (cur >= 0x9080 && cur < 0x9084) return 2;
  if (cur >= 0x9090 && cur < 0x9094) return 4;
  return 0xFFFF;
}

// ─────────────────────────────────────────────────────────────────────
// Keep-slope diagonal-strip pattern.
//
// Shared by the diagonal-sewage-pipe family ($B2–$B9) and analogous
// keep-slope strips. Both the init shape and the per-cell stamp shape
// are template-identical across the family — only the row extent and
// the tile table differ.
// ─────────────────────────────────────────────────────────────────────

/** Descriptor for a sentinel/neighbour-probe swap inside a row-indexed
 *  stamp. When the picked tile equals `sentinel`, the stamp probes the
 *  named direction; if the neighbour's Map16 ID matches `matchA` or
 *  `matchB`, the picked tile is replaced with `replacement`.
 *
 *  Cart shape: `LDA $1B ; STA $0E ; JSL get_map16_{above,below} ;
 *  LDA buf,x ; CMP #matchA ; BEQ swap ; CMP #matchB ; BEQ swap`. */
export interface DecoratorProbe {
  sentinel:    number;
  matchA:      number;
  matchB:      number;
  replacement: number;
  probe:       (state: DecodeState) => number;
}

/** Generic factory for the cart's keep-slope row-indexed stamp shape:
 *
 *    REP #$30
 *    LDA $12  BNE skip                ; preserve already-stamped cell
 *    LDA $2C  ASL  TAY                ; row × 2
 *    LDA tiles,y                      ; word lookup
 *    [optional decorator: if pick == sentinel, probe neighbour,
 *                         swap pick when match]
 *    LDX $1D ; STA.l buffer,x         ; stamp
 *  skip:
 *    LDA #$FFFF  STA $9B              ; KEEP-SLOPE rewound flag
 *    RTL
 *
 *  Used by the diagonal-sewage-pipe family ($B2–$B9). Pass `decorator`
 *  to add the sentinel/swap probe step ($B6/$B7/$B8/$B9 use this;
 *  $B2/$B3/$B4/$B5 don't).
 *
 *  Note: the `$9B = $FFFF` epilogue runs even when the stamp is skipped
 *  due to a non-zero `$12` — preserving the cart's row-wrap behaviour. */
export function makeKeepSlopeRowStamp(
  tiles: ReadonlyArray<number>,
  decorator?: DecoratorProbe,
): PerCellHandler {
  return (state) => {
    if ((state.zp12 & 0xffff) !== 0) {
      state.rewound = 0xFFFF;
      return;
    }
    const row = state.zp2C & 0xff;
    const baseTile = tiles[row];
    if (baseTile !== undefined) {
      let pick = baseTile;
      if (decorator !== undefined && pick === decorator.sentinel) {
        setProbeToCurrent(state);
        const neighbour = readBuf16(state, decorator.probe(state));
        if (neighbour === decorator.matchA || neighbour === decorator.matchB) {
          pick = decorator.replacement;
        }
      }
      stampCell(state, pick);
    }
    state.rewound = 0xFFFF;
  };
}

/** Cart-shaped init for the "diagonal keep-slope strip" pattern shared
 *  by the diagonal-sewage-pipe family ($B2–$B9):
 *
 *    REP #$20
 *    LDA #rowExtent  STA $2E
 *    LDA #$FFFF      STA $17
 *    LDA $15 ; AND #$0001 ; ASL ; TAY
 *    LDA body_ptrs,y                    ; 2-entry table [bit0Clear, bit0Set]
 *    JMP CODE_walker_setup_keep_slope
 *
 *  Returns nothing — directly mutates state and dispatches the walker. */
export function initDiagonalKeepSlope(
  state: DecodeState,
  rowExtent: number,
  bodyByBit0Clear: PerCellHandler,
  bodyByBit0Set:   PerCellHandler,
): void {
  state.zp2E = rowExtent & 0xffff;
  state.zp17 = 0xFFFF;
  const body = (state.zp15 & 0x01) !== 0 ? bodyByBit0Set : bodyByBit0Clear;
  walkerSetupKeepSlope(state, body);
}

// ─────────────────────────────────────────────────────────────────────
// Anchor-table linear scan.
//
// Cart pattern (used by many Bank13 stamp routines):
//   LDY #(count-1)*2  ; LDA $12
//   loop: CMP table,y ; BEQ hit ; DEY ; DEY ; BPL loop
//   ; fall through = no match (Y becomes negative)
//
// The cart walks Y from the top of the table down — if duplicates are
// present, the highest-index match wins. This helper mirrors that
// direction faithfully: scan backwards, return the first matching
// index, or `-1` on miss.
//
// Callers that pair an anchor table with a replacement table fetch the
// replacement at the returned index: `replacement[idx]` (idx >= 0).
// ─────────────────────────────────────────────────────────────────────

export function scanAnchor(table: ReadonlyArray<number>, needle: number): number {
  for (let i = table.length - 1; i >= 0; i--) {
    if (table[i] === needle) return i;
  }
  return -1;
}

// NOTE: there is deliberately NO "slim" bg_floor_random variant. The cart
// installs the FULL CODE_bg_floor_random ($13:80B4) everywhere the random-grass
// fill is used — std-01 init_floor_basic, std-87/88 init_floor_no_deco_top, the
// 22°/45° slope row-handlers ($04-$09), and stamp_floor_3wide (rock-in-waterfall).
// All five route through `bank13-floor.ts:bgFloorRandom`. An earlier slim port
// that dropped the last-row branch (slope-cap / exit no-roll cases) desynced the
// per-site PRNG replay at $13:810C — the roll cadence must match the cart exactly.

// ─────────────────────────────────────────────────────────────────────
// Wide-floor seam remap tables + the in-place remapper.
//
// `DATA_floor_left_neighbour_remap` (left) and `DATA_floor_above_neighbour_remap` (right/above) are 46-entry tables of
// WideFloorPage family slot indices (0..45) → Map16 = WideFloorPage_Anchor + idx
// — mostly identity, with deliberate seam remaps. Transcribed from ROM by
// tmp/gen-bigfloor-tables.ts. Shared by two distinct uses:
//   - the big-floor $67 edge fix-ups (bank13-floor.ts) probe a NEIGHBOUR cell
//     and rewrite THAT neighbour when it's a WideFloorPage tile;
//   - the wide-floor `wide_floor_{left,above}_neighbour_fix` seam helpers
//     (CODE_wide_floor_left_neighbour_fix / CODE_wide_floor_above_neighbour_fix, used by $59/$5A/$5B, $5F/$60, $61/$62) remap
//     the CURRENT cell in place when IT already holds a WideFloorPage tile
//     (e.g. a tunnel-stamped $1D-page tile sitting under a slope/extender).
// Both reference the SAME table data; only the read/write target differs.
// ─────────────────────────────────────────────────────────────────────

export const WIDE_FLOOR_REMAP_LEFT = [   // DATA_floor_left_neighbour_remap
  0, 7, 5, 43, 45, 5, 44, 7, 8, 0, 15, 17, 0, 13, 44, 15,
  45, 17, 13, 19, 20, 21, 22, 23, 24, 25, 26, 27, 41, 7, 39, 31,
  32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45,
] as const;
export const WIDE_FLOOR_REMAP_RIGHT = [  // DATA_floor_above_neighbour_remap
  0, 4, 6, 42, 4, 44, 6, 45, 0, 9, 14, 16, 12, 0, 14, 44,
  16, 45, 12, 19, 20, 21, 22, 23, 24, 25, 26, 27, 12, 16, 30, 31,
  32, 33, 34, 35, 36, 37, 38, 39, 40, 0, 42, 43, 44, 45,
] as const;

/** Cart `CODE_wide_floor_{left,above}_neighbour_fix` ($13:C175 / $13:C1F0).
 *  If the CURRENT cell's tile ($12) is in the WideFloorPage family, remap it
 *  in place (stamp to $1D) via `table` — `WIDE_FLOOR_REMAP_LEFT` for the
 *  left/first-col helper, `WIDE_FLOOR_REMAP_RIGHT` for the above/right-col one.
 *  No-op when $12 isn't a WideFloorPage tile (the fresh-decode common case),
 *  matching the cart's `CMP WideFloorPage_Anchor ; BNE skip`. */
export function wideFloorNeighbourFix(
  state: DecodeState,
  table: readonly number[]
): void {
  const cur = state.zp12 & 0xffff;
  if ((cur & 0xff00) !== state.templateAt(TT.WideFloorPage_Anchor)) return;
  const idx = table[cur & 0xff];
  if (idx === undefined) return; // beyond the named 46-entry table — leave as-is
  stampCell(state, state.templateAt(TT.WideFloorPage_Anchor + idx * 2));
}

/** Cart `CODE_big_floor_left_fix` / `CODE_big_floor_right_fix`
 *  ($13:C570 / $13:C64D). DISTINCT from `wideFloorNeighbourFix`: probes the
 *  LEFT/RIGHT *neighbour*; if its PAGE byte matches WideFloorPage_Anchor it
 *  remaps that neighbour via the left/right table and writes the resolved tile
 *  back INTO THE NEIGHBOUR cell (cart `STA buffer,x` with X = the probe's
 *  offset) — NOT the current cell. The overlap-seam fixer: when a slope/tunnel
 *  edge cell abuts a previously-stamped wide-floor tile (e.g. a $14 tunnel's
 *  $1D-page tile), it rewrites that neighbour to the matching connector.
 *  (Was wrongly stubbed as a no-op on the premise neighbours are always $0000 —
 *  true only for a non-overlapping fresh decode; in real levels tunnels abut
 *  these slopes. e.g. record $69 (53,81): left neighbour $1D12 → idx 13 → slot
 *  $1BFA → $1D0D.) */
function bigFloorEdgeFix(state: DecodeState, off: number, table: readonly number[]): void {
  const neighbour = readBuf16(state, off);
  if ((neighbour & 0xff00) !== state.templateAt(TT.WideFloorPage_Anchor)) return;
  const idx = table[neighbour & 0xff];
  if (idx === undefined) return;
  writeBuf16(state, off, state.templateAt(TT.WideFloorPage_Anchor + idx * 2));
}

export function bigFloorLeftEdgeFix(state: DecodeState): void {
  setProbeToCurrent(state);
  bigFloorEdgeFix(state, getMap16Left(state), WIDE_FLOOR_REMAP_LEFT);
}

export function bigFloorRightEdgeFix(state: DecodeState): void {
  setProbeToCurrent(state);
  bigFloorEdgeFix(state, getMap16Right(state), WIDE_FLOOR_REMAP_RIGHT);
}

// ─────────────────────────────────────────────────────────────────────
// Extended-object (Bank12 DATA_extended_object_init_ptrs) shared idioms.
//
// These factor out the most-duplicated shapes across the bank12-ext-*
// handlers. Each reproduces an existing handler body EXACTLY (same field
// reads, same order, same fallbacks) so migrating a hand-written handler to
// one of these is a mechanical, behaviour-preserving refactor.
//
// IMPORTANT field conventions (do NOT confuse with the std-object helpers):
//   - shape-1 single-cell ext handlers re-resolve the anchor tile first
//     (`getCurrentMap16Tile`) then stamp at `$1D`. REQUIRED, not optional:
//     the parser's ext dispatch sets `$15`/`$1B`/`$1C` but NOT `$1D` (only
//     `getCurrentMap16Tile` does), so a single-cell handler that stamps
//     without it lands at the PREVIOUS object's stale offset — a subtle
//     "tile slightly off" bug, not a crash. `extConstStamp` /
//     `extTemplateStamp` bundle the call; use them.
//   - shape-2 walker-driven ext handlers DO NOT call `getCurrentMap16Tile`
//     in the per-cell body — the walker has already latched `$1D`/`$12`.
//     The per-cell body indexes its tile table by the WALKER COUNTERS
//     `state.zp28` (column) and `state.zp2C` (row), NOT cursor coords.
// ─────────────────────────────────────────────────────────────────────

/** Shape-1 const-stamp idiom: re-resolve the anchor's existing tile, then
 *  stamp a fixed Map16 id.
 *
 *    getCurrentMap16Tile(state); stampCell(state, mapid);
 *
 *  Mirrors single_cell_dispatch 0x0F, ice_ramp 0xA7, egg_block 0xC4,
 *  donut_block_small 0x5E, spike_mace_center 0x51, downward_grass 0x4F, etc. */
export function extConstStamp(state: DecodeState, mapid: number): void {
  getCurrentMap16Tile(state);
  stampCell(state, mapid);
}

/** Shape-1 template-stamp idiom: re-resolve the anchor's existing tile, then
 *  stamp the Map16 id read from the per-tileset template slot at `slotAddr`.
 *
 *    getCurrentMap16Tile(state); stampCell(state, state.templateAt(slotAddr));
 *
 *  Mirrors mouse_hole 0x4C. */
export function extTemplateStamp(state: DecodeState, slotAddr: number): void {
  getCurrentMap16Tile(state);
  stampCell(state, state.templateAt(slotAddr));
}

/** Build a shape-2 PerCellHandler that stamps a fixed Map16 id from a
 *  row-major table indexed by the walker counters: `tiles[row*cols + col]`,
 *  where `col = state.zp28 & 0xff` and `row = state.zp2C & 0xff`.
 *
 *  Matches the e0-family idiom (mid_grass_2x2 0x4D, flower_burst_2x2 0xA4,
 *  goal_roof_8x5 0x82, sky_big_base_pair 0xC2/0xC3 …): the body does NOT
 *  call `getCurrentMap16Tile` (the walker already latched the cell).
 *
 *  By default an out-of-range index stamps 0 (matching the existing
 *  `?? 0` fallback). With `{ skipZero: true }` a table value of 0 (or an
 *  out-of-range index) leaves the existing tile untouched. */
export function makeRowMajorTableStamp(
  tiles: readonly number[],
  cols: number,
  opts: { skipZero?: boolean } = {},
): PerCellHandler {
  const skipZero = opts.skipZero ?? false;
  return (state) => {
    const col = state.zp28 & 0xff;
    const row = state.zp2C & 0xff;
    const idx = row * cols + col;
    if (skipZero) {
      const v = tiles[idx];
      if (v === undefined || v === 0) return;
      stampCell(state, v);
      return;
    }
    stampCell(state, tiles[idx] ?? 0);
  };
}

// ── Rock per-cell stamper (cart CODE_12B101) ──────────────────────────
//
// Shared by every rock object (0x5F-0x66) and the flower_rock_art family
// (0xD4-0xDF). The cart's CODE_12B101 indexes a
// per-$15 ROM table of "entry" words by (row, col), then dereferences each
// entry one more time (`LDA $0000,y`, DBR=$12):
//   - entry == 0       → BEQ skip (leave the existing tile)
//   - entry  <  $8000  → WRAM low-RAM mirror = a per-tileset template slot,
//                        resolved at decode time via `state.templateAt(entry)`
//   - entry  >= $8000  → a Bank-12 ROM word whose VALUE is a literal Map16 id
//
// Because the ROM-literal deref is constant, the ported handlers pre-resolve
// each table cell into one of three tagged shapes. `RockEntry` is that
// tag; `makeRockEntryStamp` is the shared CODE_12B101 body. The table
// is 2-D, indexed `table[outer][inner]`: the asm walks `$28` (col) and `$2C`
// (row), so pick `'colMajor'` (`table[col][row]`) or `'rowMajor'`
// (`table[row][col]`) to match how the source table was transcribed.

/** One pre-resolved rock table cell (the cart's once-dereferenced
 *  CODE_12B101 entry). `{ slot }` → `state.templateAt(slot)` (per-tileset);
 *  `{ mapid }` → a constant ROM-literal Map16 id; `{ skip: true }` → the
 *  cart's BEQ (stamp nothing). */
export type RockEntry =
  | { slot: number }
  | { mapid: number }
  | { skip: true };

/** Resolve one {@link RockEntry} to its Map16 id, or `undefined` for a
 *  skip cell (caller must not stamp). */
function resolveRockEntry(
  state: DecodeState,
  entry: RockEntry | undefined,
): number | undefined {
  if (entry === undefined || 'skip' in entry) return undefined;
  if ('slot' in entry) return state.templateAt(entry.slot);
  return entry.mapid;
}

/** Build the shared rock per-cell stamper (cart CODE_12B101) from a
 *  2-D table of pre-resolved {@link RockEntry} cells.
 *
 *    layout 'colMajor' → entry = table[col][row]   (5F/60/65/66 etc.)
 *    layout 'rowMajor' → entry = table[row][col]   (5x4-a/5x4-b etc.)
 *
 *  Skip cells (and out-of-range indices) leave the existing tile untouched,
 *  matching the cart's BEQ. */
export function makeRockEntryStamp(
  table: ReadonlyArray<ReadonlyArray<RockEntry>>,
  layout: 'colMajor' | 'rowMajor',
): PerCellHandler {
  return (state) => {
    const col = state.zp28 & 0xffff;
    const row = state.zp2C & 0xffff;
    const entry = layout === 'colMajor' ? table[col]?.[row] : table[row]?.[col];
    const mapid = resolveRockEntry(state, entry);
    if (mapid !== undefined) stampCell(state, mapid);
  };
}

// ─────────────────────────────────────────────────────────────────────
// Constant-tile trampoline init.
//
// The "single-tile" std object family ($D1 $870F, $D2 $870E, $CF $8A00,
// $9E $7502, $77 single-spike) share the EXACT init shape: a per-cell
// handler that stamps one constant Map16 ID at the walker's current cell,
// wired into all three walker slots via the trampoline. The cart inits
// (CODE_init_single_tile_*, Bank12) differ only in the immediate loaded
// before `JMP walker_setup_trampoline`. This factors out that body so the
// per-family files reduce to one registration line.
//
// NOTE: handlers with a stamp epilogue beyond the bare STA (e.g. $6C
// single_tile_trigger's shadow-merge tail CODE_wall_thick_neighbour_epilogue) are NOT this shape
// and must keep their own per-cell handler.
// ─────────────────────────────────────────────────────────────────────

/** Build the init for a constant-tile trampoline object: every cell stamps
 *  the fixed Map16 `tile`. Mirrors `CODE_init_single_tile_*` →
 *  `walker_setup_trampoline` with a single-`STA` per-cell stamper. */
export function makeConstStampInit(tile: number): (state: DecodeState) => void {
  const stamp: PerCellHandler = (state) => stampCell(state, tile);
  return (state) => walkerSetupTrampoline(state, stamp);
}
