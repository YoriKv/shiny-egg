// Bank13 stamp handlers for std objects $C0-$C3 — the
// "terrain_4variant_height2" family: a fixed-height-2 object whose
// column extent comes from the stream record (length-1) and whose row
// extent is forced to 2. The shared init picks one of four cell-stamp
// routines from a 4-entry variant table indexed by `$15 & 3`. The first
// two variants ($C0, $C1) dispatch via `walker_setup_trampoline` (which
// zeros `$17`); the last two ($C2, $C3) dispatch via
// `walker_setup_keep_slope` (preserves `$17 = $FFFF`).
//
//   $C0 → CODE_stamp_corner_left_with_probe  @ $13:E74C
//          Row 0 (top): left-corner probe via probe_left/right_tile,
//          uses $854B-base offset arithmetic, or 24-tile $82xx remap.
//          Row 1 (bottom): 24-tile DATA_terrain_secondary_anchor_24tiles → $82xx remap or skip.
//   $C1 → CODE_stamp_corner_right_with_probe @ $13:E81D
//          Mirror of $C0 using DATA_corner_right_replacement_13tiles (right replacements) and
//          DATA_corner_top_alt_24tiles ($83xx table); $77D0/$77D1 fallback constants.
//   $C2 → CODE_stamp_top_cap_2tile @ $13:E8A6
//          Height-1 top cap: row 0 always stamps $77BF. Row 1 probes
//          $12 against 2-entry DATA_top_cap_2tile_anchor ($082D, $082E); if match,
//          stamps $7F00. Sets $9B = $FFFF (single-row mode — walker
//          skips the per-row $2E += $17 bump).
//   $C3 → CODE_stamp_top_cap_4tile @ $13:E8D9
//          Mirror of $C2 with $77C0 default + 4-entry DATA_top_cap_4tile_anchor
//          ($0A2D..$0A30) anchor + $8000 replacement.
//
// Shared init at CODE_init_terrain_4variant_height2 (Bank12.asm:4982):
//   $2E = $0002                                     ; row extent forced to 2
//   $17 = $FFFF                                     ; per-row slope = -1
//   y = ($15 & 3) << 1                              ; 4-variant index
//   stamp_ptr = DATA_terrain_4variant_height2_stamps[y]
//   if y < 4:  dispatch via walker_setup_trampoline  (clears $17)
//   else:      dispatch via walker_setup_keep_slope  (preserves $17)
//
// Per-cell stamp shape (common to all 4):
//   Row 0 (top, $2C=0): variant-specific probe / table lookup. May
//     stamp a tile, or skip when no anchor matches.
//   Row 1 (bottom, $2C=1): variant-specific table lookup against the
//     existing $12. May stamp a tile, or skip when no anchor matches.
//   $C2/$C3 epilogue: $9B = $FFFF (= bit-15 set → walker.ts row-wrap
//     skips the $2E += $17 bump, keeping row extent stable at 2).
//
//
// Friendly names from obj-metadata.json:
//   192 ($C0): Sewage flowing left
//   193 ($C1): Sewage flowing right
//   194 ($C2): Sewage flowing downwards left
//   195 ($C3): Sewage flowing downwards right
//
// Surprises:
// - The traces only exercise empty-buffer cells, so $C0/$C1's full
//   anchor-tables + probe-arithmetic paths never actually stamp in the
//   captured traces (every cell falls through to the "no match → skip"
//   branch). The asm logic is ported in full for fidelity but its
//   visible effect is bounded to cells where neighbours have already
//   been stamped by an earlier object (e.g. a sewage flow connecting
//   to existing pipe/door tiles).
// - $C0/$C1's row-1 path uses DATA_terrain_secondary_anchor_24tiles (24-entry $79xx anchor) +
//   DATA_corner_top_24tiles / DATA_corner_top_alt_24tiles ($82xx / $83xx 24-entry replacement) —
//   distinct from row-0's DATA_corner_left_anchor_13tiles (13-entry corner anchor) +
//   DATA_corner_left_replacement_13tiles / DATA_corner_right_replacement_13tiles replacements.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupKeepSlope, walkerSetupTrampoline } from '../walker.ts';
import { getMap16Left, getMap16Right } from '../fetch.ts';
import { stampCell, readBuf16, setProbeToCurrent, scanAnchor } from './_shared.ts';

// ───────────────────────────────────────────────────────────────────────
// DATA_corner_left_anchor_13tiles @ $13:E6E8 (Bank13.asm:12490).
//
// 13-entry anchor for the row-0 fallback path in BOTH $C0 and $C1
// (CODE_13E7A2 / CODE_13E871). When the row-0 probe doesn't return
// $8101, both routines fall through to a DEY-loop CMP against this
// table; on match, they index DATA_corner_left_replacement_13tiles
// ($C0) or DATA_corner_right_replacement_13tiles ($C1) at the same Y.
// ───────────────────────────────────────────────────────────────────────

const DATA_corner_left_anchor_13tiles = [
  0x77AF, 0x77B0, 0x77B4, 0x77B8, 0x77C6, 0x77C7, 0x082D, 0x0A2E,
  0x0A2F, 0x854B, 0x854C, 0x854D, 0x854E,
] as const;

/** DATA_corner_left_replacement_13tiles @ $13:E702 — $C0 row-0 fallback. */
const DATA_corner_left_replacement_13tiles = [
  0x77C2, 0x77C3, 0x77D2, 0x77D3, 0x77D6, 0x77D7, 0x082E, 0x0A2D,
  0x0A30, 0x855A, 0x855B, 0x855C, 0x855D,
] as const;

/** DATA_corner_right_replacement_13tiles @ $13:E7D3 — $C1 row-0 fallback. */
const DATA_corner_right_replacement_13tiles = [
  0x77C4, 0x77C5, 0x77D5, 0x77D4, 0x77D6, 0x77D7, 0x082E, 0x0A2D,
  0x0A30, 0x855E, 0x855F, 0x8560, 0x8561,
] as const;

// ───────────────────────────────────────────────────────────────────────
// DATA_terrain_secondary_anchor_24tiles @ $13:E51F (Bank13.asm:12275).
//
// 24-entry $79xx-family anchor; row-1 fallback for $C0 and $C1.
// Indexed Y in {0, 2, 4, ..., 46}; matches drive into the parallel
// 24-entry replacement tables (DATA_corner_top_24tiles $82xx / DATA_corner_top_alt_24tiles $83xx).
// ───────────────────────────────────────────────────────────────────────

const DATA_terrain_secondary_anchor_24tiles = [
  0x7925, 0x7926, 0x7927, 0x7928, 0x7929, 0x792A, 0x791B, 0x791C,
  0x7962, 0x7963, 0x7966, 0x7968, 0x7969, 0x796A, 0x796D, 0x796F,
  0x7978, 0x7979, 0x797C, 0x797D, 0x7936, 0x7937, 0x7939, 0x793B,
] as const;

/** DATA_corner_top_24tiles @ $13:E71C — $C0 row-1 replacement ($82xx). */
const DATA_corner_top_24tiles = [
  0x8200, 0x8201, 0x8202, 0x8203, 0x8204, 0x8205, 0x8206, 0x8207,
  0x8208, 0x8209, 0x820A, 0x820B, 0x820C, 0x820D, 0x820E, 0x820F,
  0x8210, 0x8211, 0x8212, 0x8213, 0x8215, 0x8215, 0x8214, 0x8214,
] as const;

/** DATA_corner_top_alt_24tiles @ $13:E7ED — $C1 row-1 replacement ($83xx). */
const DATA_corner_top_alt_24tiles = [
  0x8300, 0x8301, 0x8302, 0x8303, 0x8304, 0x8305, 0x8306, 0x8307,
  0x8308, 0x8309, 0x830A, 0x830B, 0x830C, 0x830D, 0x830E, 0x830F,
  0x8310, 0x8311, 0x8312, 0x8313, 0x8315, 0x8315, 0x8314, 0x8314,
] as const;

/** DATA_top_cap_2tile_anchor @ $13:E8A2 — $C2 row-1 anchor. */
const DATA_top_cap_2tile_anchor = [0x082D, 0x082E] as const;

/** DATA_top_cap_4tile_anchor @ $13:E8D1 — $C3 row-1 anchor. */
const DATA_top_cap_4tile_anchor = [0x0A2D, 0x0A2E, 0x0A2F, 0x0A30] as const;

// ───────────────────────────────────────────────────────────────────────
// Anchor+replacement DEY-loop. `scanAnchor` (in `_shared.ts`) mirrors the
// cart's backwards walk; on hit, fetch the paired replacement directly.
// ───────────────────────────────────────────────────────────────────────

function anchorLookup(
  current: number,
  anchor: readonly number[],
  replacement: readonly number[],
): number | null {
  const idx = scanAnchor(anchor, current);
  return idx >= 0 ? (replacement[idx] ?? null) : null;
}

// ───────────────────────────────────────────────────────────────────────
// $C0 — CODE_stamp_corner_left_with_probe @ $13:E74C.
//
// Row 0 (top, $2C=0):
//   - $12 == $854A? stamp $8550. else:
//   - $28 == 0?  probe LEFT  → if $8101, base-offset arithmetic
//                              from $12-$854B (range 0..3) + $8556.
//                              else fall through to anchor table.
//   - $28 != 0?  probe RIGHT → if $8101, base-offset arithmetic
//                              from $12-$854B (range 0..3) + $856A.
//                              else fall through to anchor table.
//   - Anchor fallback: 13-tile lookup; replacement on match,
//                      $77EB ($28==0) or $77D0 ($28!=0) on miss.
// Row 1 (bottom, $2C!=0):
//   - 24-tile DATA_terrain_secondary_anchor_24tiles lookup;
//     replacement DATA_corner_top_24tiles on match, skip on miss.
// ───────────────────────────────────────────────────────────────────────

const stampCornerLeftWithProbe: PerCellHandler = (state) => {
  const cur = state.zp12 & 0xffff;

  if ((state.zp2C & 0xffff) !== 0) {
    // Row 1: 24-tile anchor → $82xx replacement, skip on miss.
    const hit = anchorLookup(
      cur,
      DATA_terrain_secondary_anchor_24tiles,
      DATA_corner_top_24tiles,
    );
    if (hit !== null) stampCell(state, hit);
    return;
  }

  // Row 0:
  if (cur === 0x854A) {
    stampCell(state, 0x8550);
    return;
  }

  if ((state.zp28 & 0xff) === 0) {
    // Probe LEFT.
    setProbeToCurrent(state);
    const off = getMap16Left(state);
    const neighbour = readBuf16(state, off);
    if (neighbour === 0x8101) {
      const delta = (cur - 0x854B) & 0xffff;
      if (delta < 0x0004) {
        stampCell(state, (delta + 0x8556) & 0xffff);
        return;
      }
      stampCell(state, 0x77EB);
      return;
    }
    // Fall through to 13-tile anchor.
  } else {
    // Probe RIGHT.
    setProbeToCurrent(state);
    const off = getMap16Right(state);
    const neighbour = readBuf16(state, off);
    if (neighbour === 0x8101) {
      const delta = (cur - 0x854B) & 0xffff;
      if (delta < 0x0004) {
        stampCell(state, (delta + 0x856A) & 0xffff);
        return;
      }
      stampCell(state, 0x77D0);
      return;
    }
    // Fall through to 13-tile anchor.
  }

  // 13-tile anchor lookup; on miss, skip stamp entirely (cart's
  // BRA CODE_13E7D0 path falls past the STA).
  const hit = anchorLookup(
    cur,
    DATA_corner_left_anchor_13tiles,
    DATA_corner_left_replacement_13tiles,
  );
  if (hit !== null) stampCell(state, hit);
};

// ───────────────────────────────────────────────────────────────────────
// $C1 — CODE_stamp_corner_right_with_probe @ $13:E81D.
//
// Mirror of $C0 with different sentinel constants:
//   $12 == $8546 → stamp $8551
//   probe LEFT  $8101 → ($12-$854B in [0,4)) + $856E, else $77D1
//   probe RIGHT $8101 → ($12-$854B in [0,4)) + $8552, else $77D0
//   13-tile fallback uses DATA_corner_right_replacement_13tiles.
//   Row-1 uses DATA_corner_top_alt_24tiles ($83xx).
// ───────────────────────────────────────────────────────────────────────

const stampCornerRightWithProbe: PerCellHandler = (state) => {
  const cur = state.zp12 & 0xffff;

  if ((state.zp2C & 0xffff) !== 0) {
    // Row 1: 24-tile anchor → $83xx replacement, skip on miss.
    const hit = anchorLookup(
      cur,
      DATA_terrain_secondary_anchor_24tiles,
      DATA_corner_top_alt_24tiles,
    );
    if (hit !== null) stampCell(state, hit);
    return;
  }

  if (cur === 0x8546) {
    stampCell(state, 0x8551);
    return;
  }

  if ((state.zp28 & 0xff) === 0) {
    // Probe LEFT.
    setProbeToCurrent(state);
    const off = getMap16Left(state);
    const neighbour = readBuf16(state, off);
    if (neighbour === 0x8101) {
      const delta = (cur - 0x854B) & 0xffff;
      if (delta < 0x0004) {
        stampCell(state, (delta + 0x856E) & 0xffff);
        return;
      }
      stampCell(state, 0x77D1);
      return;
    }
  } else {
    // Probe RIGHT.
    setProbeToCurrent(state);
    const off = getMap16Right(state);
    const neighbour = readBuf16(state, off);
    if (neighbour === 0x8101) {
      const delta = (cur - 0x854B) & 0xffff;
      if (delta < 0x0004) {
        stampCell(state, (delta + 0x8552) & 0xffff);
        return;
      }
      stampCell(state, 0x77D0);
      return;
    }
  }

  const hit = anchorLookup(
    cur,
    DATA_corner_left_anchor_13tiles,
    DATA_corner_right_replacement_13tiles,
  );
  if (hit !== null) stampCell(state, hit);
};

// ───────────────────────────────────────────────────────────────────────
// $C2 — CODE_stamp_top_cap_2tile @ $13:E8A6.
//
// Row 0: stamp $77BF unconditionally.
// Row 1: probe $12 against DATA_top_cap_2tile_anchor ($082D, $082E);
//        if match, stamp $7F00; else skip.
// Epilogue: $9B = $FFFF (walker single-row mode — skips $2E += $17).
// ───────────────────────────────────────────────────────────────────────

const stampTopCap2tile: PerCellHandler = (state) => {
  if ((state.zp2C & 0xffff) === 0) {
    stampCell(state, 0x77BF);
  } else {
    const cur = state.zp12 & 0xffff;
    // Cart loads Y=#$0002 (= last-entry word index), then DEY-loops.
    if (DATA_top_cap_2tile_anchor.includes(cur as 0x082D | 0x082E)) {
      stampCell(state, 0x7F00);
    }
    // else: BRA past STA (skip stamp); $9B still gets set below.
  }
  state.rewound = 0xFFFF;
};

// ───────────────────────────────────────────────────────────────────────
// $C3 — CODE_stamp_top_cap_4tile @ $13:E8D9.
//
// Mirror of $C2 with wider 4-entry anchor + different defaults:
//   Row 0: stamp $77C0.
//   Row 1: probe against DATA_top_cap_4tile_anchor ($0A2D..$0A30);
//          if match, stamp $8000; else skip.
//   Epilogue: $9B = $FFFF.
// ───────────────────────────────────────────────────────────────────────

const stampTopCap4tile: PerCellHandler = (state) => {
  if ((state.zp2C & 0xffff) === 0) {
    stampCell(state, 0x77C0);
  } else {
    const cur = state.zp12 & 0xffff;
    if (DATA_top_cap_4tile_anchor.includes(cur as 0x0A2D | 0x0A2E | 0x0A2F | 0x0A30)) {
      stampCell(state, 0x8000);
    }
  }
  state.rewound = 0xFFFF;
};

// ───────────────────────────────────────────────────────────────────────
// DATA_terrain_4variant_height2_stamps @ $12:A04F.
//
// 4-entry variant table indexed by $15 & 3. The first two entries
// dispatch through walker_setup_trampoline (clears $17); the last two
// through walker_setup_keep_slope (preserves $17 = $FFFF set by init).
// ───────────────────────────────────────────────────────────────────────

const TERRAIN_4VARIANT_STAMPS: readonly PerCellHandler[] = [
  stampCornerLeftWithProbe,   // $C0  → trampoline ($17 → 0)
  stampCornerRightWithProbe,  // $C1  → trampoline ($17 → 0)
  stampTopCap2tile,           // $C2  → keep_slope ($17 = $FFFF)
  stampTopCap4tile,           // $C3  → keep_slope ($17 = $FFFF)
];

// ───────────────────────────────────────────────────────────────────────
// Shared init for $C0-$C3 (CODE_init_terrain_4variant_height2, Bank12.asm:4982).
// ───────────────────────────────────────────────────────────────────────

// Merge: object IDs 0xC0, 0xC1, 0xC2, 0xC3 share this handler.
function initTerrain4variantHeight2(state: DecodeState): void {
  // $2E = 2: force row extent to 2 rows regardless of the stream's
  // length-1 byte (which encodes column extent for this family).
  state.zp2E = 0x0002;

  // $17 = $FFFF: per-row slope = -1 (signed). Only persists for the
  // keep_slope dispatch path ($C2, $C3); the trampoline path ($C0, $C1)
  // clears it to 0 on entry.
  state.zp17 = 0xFFFF;

  const variant = state.zp15 & 0x03;
  const stamp = TERRAIN_4VARIANT_STAMPS[variant]!;

  // Cart: CPY #$04 ; BCC trampoline ; else keep_slope. Y here = variant<<1,
  // so variant 0/1 → BCC taken → trampoline; variant 2/3 → keep_slope.
  if (variant < 2) {
    walkerSetupTrampoline(state, stamp);
  } else {
    walkerSetupKeepSlope(state, stamp);
  }
}

// ───────────────────────────────────────────────────────────────────────
// Registration.
// ───────────────────────────────────────────────────────────────────────

export function installTerrain4variantHeight2Handlers(): void {
  // $C0-$C3 share the same init; the per-cell stamp is picked from
  // ($15 & 3) inside initTerrain4variantHeight2. Per obj-metadata:
  //   $C0 (192): "Sewage flowing left"
  //   $C1 (193): "Sewage flowing right"
  //   $C2 (194): "Sewage flowing downwards left"
  //   $C3 (195): "Sewage flowing downwards right"
  registerStdObjectHandler(0xC0, initTerrain4variantHeight2);
  registerStdObjectHandler(0xC1, initTerrain4variantHeight2);
  registerStdObjectHandler(0xC2, initTerrain4variantHeight2);
  registerStdObjectHandler(0xC3, initTerrain4variantHeight2);
}
