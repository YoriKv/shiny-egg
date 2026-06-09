// Bank13 horizontal-wall-pair stamp handlers + Bank12 init wrapper.
//
// Standard objects $AC / $AD — wall_horizontal_pair (KABEHYOKO "wall
// horizontal", two mirror orientations). The pair stamps a horizontal
// strip of wall tiles whose top vs bottom edge tile-set is picked by
// `$15` bit 0:
//
//   $AC (orient bit clear) → CODE_stamp_wall_htop    (DATA_wall_htop_tiles)
//   $AD (orient bit set)   → CODE_stamp_wall_hbottom (DATA_wall_hbottom_tiles)
//
// Each per-cell handler picks one of four corner tiles via a 2x2 lookup
// keyed by ($28 & 1) + 2*($2C & 1), with an extra column-range clamp:
// columns 0/1 use the "left cap" pair (Y=$0000), columns near the right
// end use the "right cap" pair (Y=$0002), interior columns use the
// "body" pair (Y=$0004). The selected tile then runs through
// CODE_remap_tile_to_template ($13:E0F4) to swap out wall edges when
// the cell already overlaps a foreign-tileset shape underneath.
//
// Outside BG1 tileset $0B (Castle 1 / cave), both stamp handlers escape
// to CODE_12ABFF — a generic 4-way prng pick of {$5F00,$5F01,$5F03,
// $5F03}. That branch shows up in the AC spec because the test level
// uses a non-$0B tileset.
//
// Init handler ($12:9F4F) has one extra wrinkle: when BG1 tileset == $0B
// it forces $2E (row extent) to $0002 — the cart-time decision that
// turns Castle 1's "wall" object into a 2-row strip regardless of the
// stream-supplied length-1.
//
// Asm sources:
//   DATA_wall_horizontal_body_ptrs   Bank12.asm:4812
//   CODE_init_wall_horizontal_pair   Bank12.asm:4817
//   DATA_wall_htop_tiles           (DATA_wall_htop_tiles)   Bank13.asm:11562
//   CODE_stamp_wall_htop           (CODE_stamp_wall_htop)   Bank13.asm:11566
//   DATA_wall_hbottom_tiles        (DATA_wall_hbottom_tiles)   Bank13.asm:11608
//   CODE_stamp_wall_hbottom        (CODE_stamp_wall_hbottom)   Bank13.asm:11613
//   CODE_12ABFF (generic 4-way prng pick)          Bank12.asm:6231
//   DATA_12ABF7 (4-entry prng pool)                Bank12.asm:6228
//   CODE_remap_tile_to_template    (CODE_remap_tile_to_template)   Bank13.asm:11776
//   DATA_13DF94 / DATA_13DFB4 / DATA_13DFC4 + ...  Bank13.asm:11728-11774

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { prngNext } from '../prng.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Corner-tile lookup tables.
//
// Both tables are 4-entry word arrays, indexed by
//   Y = (($28 & 1) << 1) | (($2C & 1) << 2)
// after a column-range clamp adds 0/2/4 in the high two bits. The
// resulting Y is one of {$0, $1, $2, $3} (after the >>>1 for our typed
// view), each picking one of four corner tiles.
// ─────────────────────────────────────────────────────────────────────

/** DATA_wall_htop_tiles — htop variant (objects $AC orient 0 path).
 *  Used when BG1 tileset == $0B. */
const DATA_wall_htop_tiles: ReadonlyArray<number> = [
  0x7915, 0x7916, 0x77A9, 0x77AA,
];

/** DATA_wall_hbottom_tiles — hbottom variant (objects $AD orient 1 path).
 *  Used when BG1 tileset == $0B. */
const DATA_wall_hbottom_tiles: ReadonlyArray<number> = [
  0x77AF, 0x77B0, 0x7925, 0x7926,
];

// ─────────────────────────────────────────────────────────────────────
// CODE_12ABFF — generic 4-way prng pick.
//
// `prng & 3` picks an index into DATA_12ABF7 = {$5F00,$5F01,$5F03,$5F03}
// and writes the result at the walker's current buffer offset.
// Called by every wall-stamp handler when BG1 tileset != $0B.
//
// Local to this file for now — if another handler family needs the same
// pool, lift to `_shared.ts`.
// ─────────────────────────────────────────────────────────────────────

const DATA_default_horiz_wall_pool: ReadonlyArray<number> = [
  0x5F00, 0x5F01, 0x5F03, 0x5F03,
];

function defaultHorizWallStamp(state: DecodeState): void {
  const idx = prngNext(state) & 0x03;
  stampCell(state, DATA_default_horiz_wall_pool[idx]!);
}

// ─────────────────────────────────────────────────────────────────────
// CODE_remap_tile_to_template ($13:E0F4).
//
// Shared Bank13 helper for the wall-stamp family ($AA-$AD). After a
// stamp candidate is chosen in $00, this routine attempts to remap it
// to a tileset-correct replacement based on the current cell's existing
// Map16 ID ($12) — preventing visible wall-vs-terrain seams.
//
// Algorithm:
//   1. If $12 == 0 (empty cell) → return (no remap, keep $00 as-is).
//   2. Linear-search DATA_13DF94 (16 words) for an entry == $00.
//      Asm walks Y from $001E down to $0000 with `DEY:DEY:BRA`, so this
//      loop unconditionally trusts the table to contain $00; out-of-table
//      values cause undefined behaviour in the cart (we mirror that
//      faithfully — return early on miss instead of looping forever).
//   3. Index = (matchY >> 1) & $000E → pick two parallel 8-entry ptr
//      tables: DATA_13DFB4 (matchPtr) + DATA_13DFC4 (remapPtr).
//   4. matchPtr is an 8-word match column. Search it linearly for $12.
//      No match → return (keep $00).
//   5. Compose Y' = ((innerMatchY >> 2) << 1) | $02 (the column-range
//      class set by the caller). Reads remapPtr[Y'] as a word.
//   6. If word == $FFFF → return (keep $00).
//      If word == $0000 → set $00 = $12 (preserve underneath tile).
//      Else → set $00 = word.
//
// 13DFB4 has only 2 distinct pointers (13DFD4, 13DFE4); 13DFC4 has 8
// distinct 32-byte tables (13DFF4 .. 13E0D4). We model the data inline
// rather than translating the pointer indirection — the lookup is O(1)
// once you've reduced both tables to TS arrays.
// ─────────────────────────────────────────────────────────────────────

/** DATA_13DF94 — 16 stamp-candidate Map16 IDs the remap recognises. */
const DATA_remap_outer_match: ReadonlyArray<number> = [
  0x7915, 0x7916, 0x7925, 0x7926, 0x790F, 0x791F, 0x7910, 0x7920,
  0x77A9, 0x77AA, 0x77AF, 0x77B0, 0x7799, 0x779A, 0x779F, 0x77A0,
];

/** DATA_13DFD4 — 8-entry inner-match column for outer entries 0-3 and 4-7. */
const DATA_remap_inner_match_A: ReadonlyArray<number> = [
  0x790F, 0x791F, 0x7910, 0x7920, 0x7799, 0x779A, 0x779F, 0x77A0,
];

/** DATA_13DFE4 — 8-entry inner-match column for outer entries 8-11 and 12-15. */
const DATA_remap_inner_match_B: ReadonlyArray<number> = [
  0x7915, 0x7916, 0x7925, 0x7926, 0x77A9, 0x77AA, 0x77AF, 0x77B0,
];

/** DATA_13DFB4 — 8 selector entries picking between match_A and match_B.
 *  Asm stored pointers DATA_13DFD4 / DATA_13DFE4; we encode as 0/1. */
const DATA_remap_inner_match_pick: ReadonlyArray<number> = [0, 0, 1, 1, 0, 0, 1, 1];

/** DATA_13DFF4 / DATA_13E014 / DATA_13E034 / DATA_13E054 /
 *  DATA_13E074 / DATA_13E094 / DATA_13E0B4 / DATA_13E0D4 — eight
 *  16-entry replacement tables, indexed by inner-match index (0..7)
 *  shifted to bit 1+ ORed with the column-range class ($02 = 0/2/4).
 *  Listed in the order DATA_13DFC4 references them. */
const DATA_remap_replace_tables: ReadonlyArray<ReadonlyArray<number>> = [
  [0x7931, 0x792C, 0x792C, 0x0000, 0x792B, 0x7931, 0x792B, 0x0000,
   0x792E, 0x0000, 0x0000, 0x0000, 0x0000, 0x792D, 0x0000, 0x0000],
  [0x7931, 0x791C, 0x791C, 0x0000, 0x791B, 0x7931, 0x791B, 0x0000,
   0x791E, 0x0000, 0x0000, 0x0000, 0x0000, 0x791D, 0x0000, 0x0000],
  [0x7931, 0x792C, 0x792C, 0x0000, 0x791C, 0x7931, 0x791C, 0x0000,
   0x792E, 0x0000, 0x0000, 0x0000, 0x0000, 0x791E, 0x0000, 0x0000],
  [0x7931, 0x792B, 0x792B, 0x0000, 0x791B, 0x7931, 0x791B, 0x0000,
   0x792D, 0x0000, 0x0000, 0x0000, 0x0000, 0x791D, 0x0000, 0x0000],
  [0x792E, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0x792D, 0xFFFF, 0xFFFF,
   0x5D09, 0x77B9, 0x77B9, 0x0000, 0x77CC, 0x5B0D, 0x77CC, 0x0000],
  [0x791E, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0x791D, 0xFFFF, 0xFFFF,
   0x0A2F, 0x77BB, 0x77BB, 0x0000, 0x77BA, 0x082D, 0x77BA, 0x0000],
  [0x792E, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0x791E, 0xFFFF, 0xFFFF,
   0x5D09, 0x77B9, 0x77B9, 0x0000, 0x77BB, 0x0A2F, 0x77BB, 0x0000],
  [0x792D, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0x791D, 0xFFFF, 0xFFFF,
   0x5B0D, 0x77CC, 0x77CC, 0x0000, 0x77BA, 0x082D, 0x77BA, 0x0000],
];

/** Port of CODE_remap_tile_to_template ($13:E0F4). Takes the proposed
 *  stamp tile + the column-range class ($02, one of 0/2/4) and returns
 *  the (possibly remapped) tile to actually stamp. */
function remapTileToTemplate(state: DecodeState, proposed: number, colClass: number): number {
  const cur = state.zp12 & 0xffff;
  if (cur === 0) return proposed;

  // Outer match: find proposed in DATA_remap_outer_match (16 entries).
  const outerIdx = DATA_remap_outer_match.indexOf(proposed);
  if (outerIdx < 0) return proposed; // cart would loop forever; safe early-return

  // Inner-match table selector: (outerIdx >> 1) & 7 — picks one of
  // 8 entries in DATA_remap_inner_match_pick, which picks A vs B.
  const innerSel = (outerIdx >>> 1) & 0x07;
  const innerMatch =
    DATA_remap_inner_match_pick[innerSel]! === 0
      ? DATA_remap_inner_match_A
      : DATA_remap_inner_match_B;

  // Linear-search innerMatch for $12. Cart walks Y from $000E down with
  // `DEY:DEY:BPL`, so on miss it falls through past the table — we model
  // that as "no remap".
  const innerIdx = innerMatch.indexOf(cur);
  if (innerIdx < 0) return proposed;

  // Compose Y' = ((innerIdx & $0C) << 1) | colClass. Asm:
  //   TYA ; AND #$000C ; ASL ; ORA $02 → table-byte offset (word index ×2).
  // innerIdx is a typed-array word index, so (innerIdx*2 & $0C) << 1
  // collapses to (innerIdx & $06) << 1; cart's expression in word units
  // becomes ((innerIdx << 1) & 0xC) << 1 → (innerIdx & 6) << 2. Then
  // ORA $02 stays in byte units; convert back to word index by >>>1.
  const yByte = (((innerIdx << 1) & 0x0C) << 1) | (colClass & 0xff);
  const replace = DATA_remap_replace_tables[innerSel]![yByte >>> 1]!;

  if (replace === 0xFFFF) return proposed;
  if (replace === 0x0000) return cur;
  return replace;
}

// ─────────────────────────────────────────────────────────────────────
// Common stamp body shared by htop / hbottom.
//
// Both routines have identical control flow (CODE_wall_htop_stamp_body
// and CODE_stamp_wall_hbottom diverge only in the 4-entry tile table).
// Picks a column-range class:
//
//   $28 <  2                     → class 0 (left cap)
//   $28 + 1 < ($2A - 2)          → class 4 (interior body)
//   else                         → class 2 (right cap)
//
// Then composes Y = (($28 & 1) << 1) | (($2C & 1) << 2) → pick into
// the 4-entry tile table → remap via remapTileToTemplate.
//
// The class composition in asm (lines 11581-11600):
//   LDY #0           ; default class 0
//   LDA $28 ; CMP #2 ; BCC out
//   LDY #4           ; class 4 default
//   INC ; STA $00    ; $00 = $28 + 1
//   LDA $2A ; SEC ; SBC $00 ; CMP #2 ; BCS out
//   LDY #2           ; class 2 only when ($2A - ($28+1)) < 2
// ─────────────────────────────────────────────────────────────────────

function wallHorizStamp(
  state: DecodeState,
  tiles: ReadonlyArray<number>,
  bg1Tileset0B: boolean,
): void {
  if (!bg1Tileset0B) {
    defaultHorizWallStamp(state);
    return;
  }

  // Column-range class.
  const col = state.zp28 & 0xff;
  const colExt = state.zp2A & 0xff;
  let colClass: number;
  if (col < 2) {
    colClass = 0;
  } else {
    // $00 = col + 1; class default $0004; if $2A - $00 >= 2 stay at 4,
    // else class becomes 2.
    const diff = (colExt - (col + 1)) & 0xff;
    colClass = diff >= 2 ? 4 : 2;
  }

  // 2x2 cell-position index (Y in asm).
  const yByte = ((col & 0x01) << 1) | ((state.zp2C & 0x01) << 2);
  const proposed = tiles[yByte >>> 1]!;

  const remapped = remapTileToTemplate(state, proposed, colClass);
  stampCell(state, remapped);
}

// ─────────────────────────────────────────────────────────────────────
// Per-cell handlers for the two body variants.
// ─────────────────────────────────────────────────────────────────────

const stampWallHTop: PerCellHandler = (state) => {
  const tilesetIs0B = ((state.header[1] ?? 0) & 0x0F) === 0x0B;
  wallHorizStamp(state, DATA_wall_htop_tiles, tilesetIs0B);
};

const stampWallHBottom: PerCellHandler = (state) => {
  const tilesetIs0B = ((state.header[1] ?? 0) & 0x0F) === 0x0B;
  wallHorizStamp(state, DATA_wall_hbottom_tiles, tilesetIs0B);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_wall_horizontal_pair ($12:9F4F).
//
// 1. If BG1 tileset == $0B → force $2E (row extent) = $0002 so Castle 1
//    walls always render as 2-row strips. Other tilesets keep the
//    stream-supplied length.
// 2. Select body handler by $15 bit 0:
//      bit clear → stampWallHTop    (object $AC)
//      bit set   → stampWallHBottom (object $AD)
// 3. walkerSetupTrampoline (standard, slope=0).
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0xAC, 0xAD share this handler.
const initWallHorizontalPair: InitHandler = (state) => {
  const tilesetIs0B = ((state.header[1] ?? 0) & 0x0F) === 0x0B;
  if (tilesetIs0B) {
    state.zp2E = 0x02;
  }

  const handler = (state.zp15 & 0x01) === 0 ? stampWallHTop : stampWallHBottom;
  walkerSetupTrampoline(state, handler);
};

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installWallHorizontalPairHandlers(): void {
  registerStdObjectHandler(0xAC, initWallHorizontalPair);
  registerStdObjectHandler(0xAD, initWallHorizontalPair);
}
