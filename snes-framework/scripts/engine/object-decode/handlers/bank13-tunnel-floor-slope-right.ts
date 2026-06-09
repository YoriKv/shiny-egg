// Bank13 tunnel-floor-slope-right stamp handlers (std objects $59 / $5A /
// $5B — tunnel floor sloping down-right: gradual / medium / steep).
//
// (The per-cell stamp routines + tile tables carry a `v0/v1/v2` variant
// suffix — `tunnel_floor_slope_v0/v1/v2` — mirroring the asm.)
//
// Cart entry points:
//   CODE_init_tunnel_floor_slope_right ($12:989C, Bank12.asm:3828)
//   CODE_stamp_tunnel_floor_slope_v0      ($13:BD80, Bank13.asm:7113) — std $59
//   CODE_stamp_tunnel_floor_slope_v1      ($13:BE07, Bank13.asm:7188) — std $5A
//   CODE_stamp_tunnel_floor_slope_v2      ($13:BE78, Bank13.asm:7254) — std $5B
//   DATA_tunnel_floor_slope_variant_stamps ($12:98E9) — 3-entry stamp-ptr table.
//   DATA_tunnel_floor_slope_right_steps ($12:98EF) — 3-entry $17 slope table.
//   DATA_tunnel_floor_slope_v0_tiles ($13:BDF7) — 8-entry tile table for v0.
//   DATA_tunnel_floor_slope_v1_tiles ($13:BE70) — 4-entry tile table for v1.
//   DATA_tunnel_floor_slope_v2_tiles ($13:BEE7) — 7-entry tile table for v2.
//
// Init handler (CODE_init_tunnel_floor_slope_right):
//   - Reads `$15 & 3`, DECs, ASLs into X (so $59→0, $5A→2, $5B→4).
//   - Picks stamp pointer from DATA_tunnel_floor_slope_variant_stamps and writes
//     it to all 3 walker handler slots ($22 even-col / $1F odd-col / $25
//     row) — trampoline-style — alongside the bank byte in $24/$21/$27.
//   - $19 = $7FFF (unbounded row counter, walker terminates on $2C==$2E).
//   - $17 = DATA_tunnel_floor_slope_right_steps[X] ($FFFF / $FFFF / $FFFE).
//   - $2E += 1, $2A += 2 (one extra row above for the slope cap; two
//     extra columns for the slope's diagonal sweep).
//   - $1B's screen-Y nibble -= $10 (row-up by one cell) AND $1B's sub-X
//     nibble -= 1 (one cell to the left). The cart reads $1B as a 16-bit
//     word covering $1B:$1C, so the nibble math wraps correctly. Trace
//     deltas: $91→$80 ($59), $4C→$3B ($5A), $5B→$4A ($5B) — all match.
//
// Per-cell stamp (v0 / v1 / v2): the three variants share a common
// structure but differ in:
//   - width gating ($2C < 2 for v0/v1, $2C < 3 for v2 — controls when
//     the interior body table is consulted vs. CODE_floor_random_8way_pick).
//   - body table indexing math.
//   - body table contents and size.
//
// Shared per-cell decision tree (all three variants):
//   1. $28 == 0 (first col): JSR CODE_wide_floor_left_neighbour_fix.
//      Then $9B = $15 & $0004 (latch orientation bit 2 for row-wrap).
//   2. $28 + 1 == $2A (right col): if ($15 & $0004) == 0 AND $2C == 0:
//        skip above-fix (top-right corner is empty).
//        v2 special-case: also skip when $2C == 1.
//      Else: JSR CODE_wide_floor_above_neighbour_fix.
//   3. Interior:
//        v0: if $2C >= 2 → CODE_floor_random_8way_pick.
//        v1: if $2C >= 2 → CODE_floor_random_8way_pick.
//        v2: if $2C >= 3 → CODE_floor_random_8way_pick.
//      Otherwise: bail out if $12 == $1CF4 or $12 == $1CF6 (the
//      FlatFloor_RndBound sentinels — leaves the prior tile in place).
//      Else dereference body table entry (templateAt-style: table value
//      is a WRAM slot address, LDA $0000,y resolves to the Map16 ID).
//   4. Exit epilogue: if ($28+2) != $2A, leave $9B; else STZ $9B (clear
//      the orientation latch on the rightmost column-pair).
//
// Body-table indexing per variant:
//   v0 (8-entry, DATA_tunnel_floor_slope_v0_tiles):
//     $00 = $2C * 2                       ; row bit
//     $9B = (($28 & 1) ^ 1)               ; col-parity-inverted, latched
//                                         ; — also feeds bit 2 of Y
//     Y = (($9B << 2) | $00) | (($15 & 4) << 1)  // bit 3 = orientation
//   v1 (4-entry, DATA_tunnel_floor_slope_v1_tiles):
//     Y = ($2C * 2) | ($15 & 4)           ; bit 2 = orientation
//     $9B = 1                             ; force row-wrap rewind
//   v2 (7-entry, DATA_tunnel_floor_slope_v2_tiles):
//     Y = ($2C * 2) | (($15 & 4) << 1)    ; bit 3 = orientation
//     $9B = 1
//
// The body-table cells in v0/v1/v2 are WRAM template-slot addresses
// (e.g. $1D5A, $1CB2). The cart does `LDA DATA,y ; TAY ; LDA $0000,y`
// — i.e. the table entry IS an address, the second LDA dereferences it
// to fetch the Map16 ID. We mirror this via state.templateAt(slotAddr).
// v2's table has a $0000 gap entry which would dereference to $0000 if
// reached; the index math never lands on it under the documented
// (orientation bit-2 == 0/1, row 0/1/2) inputs.
//
// Trace verification:
//   - std $59 (v0): 243 cells stamped; we match the silhouette mix of
//     `$390E/$390F/$3910/$3911/$392B/$392C/$4400/$4500` via templateAt
//     of $1D42/$1CB2/$1D44/$1CB4/$1D3A/$1CB2/$1D3C/$1CB4.
//   - std $5A (v1): 6 cells. Interior (col 1) reads `$3931` / `$3932`
//     sentinels and dereferences $1D5A → $5000, $1CB2 → $3910.
//   - std $5B (v2): 12 cells. Interior (col 1) dereferences $1D50 →
//     $4B00, $1D52 → $4C00, $1CB2 → $3910, plus a row-3 PRNG fallback
//     via CODE_floor_random_8way_pick.
//
// `wide_floor_left/above_neighbour_fix` (CODE_wide_floor_left_neighbour_fix / CODE_wide_floor_above_neighbour_fix) remap the
// CURRENT cell in place via DATA_floor_left_neighbour_remap / DATA_floor_above_neighbour_remap when $12 already holds a
// WideFloorPage tile. This IS reached in real levels: when a slope overlaps a
// neighbouring wide-floor object (e.g. a $14 tunnel's $1D-page tiles), the seam
// remap is what decorates the slope's edge. (A prior version stubbed these as
// no-ops on the false assumption $12 is always 0 in a fresh decode — that left
// the right edge of $5B undecorated in 4-7. The shared port lives in _shared.ts
// `wideFloorNeighbourFix`.)
//
// Consolidation candidates (cross-file):
//   - $5C / $5D / $5E share CODE_init_tunnel_floor_slope_left ($12:98F5)
//     which reuses the same DATA_tunnel_floor_slope_variant_stamps but with a
//     positive slope table ($0001/$0001/$0002) and skips the row-up
//     screen-Y shift. The 3 stamp handlers (v0/v1/v2) are the same. A
//     follow-up port could share `stampTunnelFloorSlopeV0/V1/V2` between the
//     two init wrappers; only the init math differs.
//   - `wide_floor_left/above_neighbour_fix` minimal early-outs are now
//     repeated in this file + `bank13-slope-wide.ts`. A `_shared.ts`
//     helper would deduplicate ~10 LOC; deferred until a third caller
//     surfaces.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupKeepSlope } from '../walker.ts';
import { TT } from '../template-slots.ts';
import {
  stampCell, floorRandom8wayPick,
  wideFloorNeighbourFix, WIDE_FLOOR_REMAP_LEFT, WIDE_FLOOR_REMAP_RIGHT,
} from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Shared sub-routines used by all three variants.
// ─────────────────────────────────────────────────────────────────────

/** CODE_wide_floor_left_neighbour_fix: when the current cell
 *  ($12) already holds a WideFloorPage tile (e.g. a tunnel stamped a $1D-page
 *  tile underneath this slope), remap it in place via DATA_floor_left_neighbour_remap. Shared
 *  helper — see _shared.ts. */
function wideFloorLeftNeighbourFix(state: DecodeState): void {
  wideFloorNeighbourFix(state, WIDE_FLOOR_REMAP_LEFT);
}

/** CODE_wide_floor_above_neighbour_fix: mirror via DATA_floor_above_neighbour_remap. */
function wideFloorAboveNeighbourFix(state: DecodeState): void {
  wideFloorNeighbourFix(state, WIDE_FLOOR_REMAP_RIGHT);
}

/** Test whether $12 equals one of the FlatFloor random-pool bound
 *  sentinels ($1CF4 or $1CF6 dereferenced). When true the variant
 *  stamps bail out without modifying the buffer. */
function isRndBoundSentinel(state: DecodeState): boolean {
  const cur = state.zp12 & 0xffff;
  const a = state.templateAt(TT.FlatFloor_RndBoundA);
  const b = state.templateAt(TT.FlatFloor_RndBoundB);
  return cur === a || cur === b;
}

/** Shared epilogue: if ($28 + 2) != $2A leave $9B alone; on the last
 *  column-pair clear $9B so the orientation latch resets for the
 *  next-object row. Per Bank13.asm:7173 / 7239 / 7308 — identical
 *  across v0/v1/v2. */
function stampEpilogue(state: DecodeState): void {
  if (((state.zp28 + 2) & 0xff) === (state.zp2A & 0xff)) {
    state.rewound = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────
// DATA_tunnel_floor_slope_v0_tiles (Bank13.asm:7184). 8-entry
// table of WRAM template-slot addresses, indexed in v0 by
//   Y = ((($28 & 1) ^ 1) << 2) | ($2C * 2) | (($15 & 4) << 1)
// which yields 0/2/4/6 + 8 (orientation bit). Entries dereference via
// state.templateAt() to obtain the Map16 ID.
// ─────────────────────────────────────────────────────────────────────

const DATA_tunnel_floor_slope_v0_tiles = [
  0x001D42, 0x001CB2, 0x001D44, 0x001CB4,
  0x001D3A, 0x001CB2, 0x001D3C, 0x001CB4,
] as const;

// DATA_tunnel_floor_slope_v1_tiles (Bank13.asm:7250). 4-entry
// table. Indexed by Y = ($2C * 2) | ($15 & 4).
const DATA_tunnel_floor_slope_v1_tiles = [
  0x001D5A, 0x001CB2, 0x001D56, 0x001CB4,
] as const;

// DATA_tunnel_floor_slope_v2_tiles (Bank13.asm:7319). 7-entry
// table (with a $0000 gap at index 3). Indexed by
// Y = ($2C * 2) | (($15 & 4) << 1) — i.e. 0/2/4 + 8 (orientation).
const DATA_tunnel_floor_slope_v2_tiles = [
  0x001D50, 0x001D52, 0x001CB2, 0x000000,
  0x001D4A, 0x001D4C, 0x001CB4,
] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_tunnel_floor_slope_v0 (Bank13.asm:7113).
// Std object $59. Width-2 row gate.
// ─────────────────────────────────────────────────────────────────────

export const stampTunnelFloorSlopeV0: PerCellHandler = (state) => {
  const col = state.zp28 & 0xff;
  const row = state.zp2C & 0xff;
  const colExtent = state.zp2A & 0xff;
  const orientBit = state.zp15 & 0x0004;

  // ───── first_col path ($28 == 0) ─────
  if (col === 0) {
    wideFloorLeftNeighbourFix(state);
    // $9B = $15 & $0004 (latch orientation bit for row-wrap).
    state.rewound = orientBit;
    stampEpilogue(state);
    return;
  }

  // ───── right_col path ($28+1 == $2A) ─────
  if (((col + 1) & 0xff) === colExtent) {
    // ($15 & 4) == 0 AND row 0 → skip above-fix.
    if (orientBit === 0 && row === 0) {
      stampEpilogue(state);
      return;
    }
    wideFloorAboveNeighbourFix(state);
    stampEpilogue(state);
    return;
  }

  // ───── interior path ─────
  if (row >= 2) {
    floorRandom8wayPick(state);
    stampEpilogue(state);
    return;
  }

  // Body-table lookup. The asm builds Y as:
  //   $00 = $2C << 1                         (row bit: 0 or 2)
  //   A   = ($28 & 1) ^ 1                    (col parity, inverted)
  //   $9B = A                                (latched for row-wrap)
  //   A   = A << 2                           (now 0 or 4 — col-pair bit)
  //   A   = A | $00                          (combine row + col-pair)
  //   $00 = ($15 & 4) << 1                   (orientation bit → bit 3)
  //   Y   = A | $00
  const colParityInv = ((col & 1) ^ 1) & 0xff;
  state.rewound = colParityInv;
  // yByteOffset ∈ {0,2,4,6,8,10,12,14} — convert to word index 0..7.
  const yByteOffset = ((colParityInv << 2) | (row << 1) | (orientBit << 1)) & 0x0f;
  const wordIdx = yByteOffset >>> 1;

  if (isRndBoundSentinel(state)) {
    stampEpilogue(state);
    return;
  }

  const slotAddr = DATA_tunnel_floor_slope_v0_tiles[wordIdx]!;
  stampCell(state, state.templateAt(slotAddr));
  stampEpilogue(state);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_tunnel_floor_slope_v1 (Bank13.asm:7188).
// Std object $5A. Width-2 row gate; force-rewind $9B in interior.
// ─────────────────────────────────────────────────────────────────────

export const stampTunnelFloorSlopeV1: PerCellHandler = (state) => {
  const col = state.zp28 & 0xff;
  const row = state.zp2C & 0xff;
  const colExtent = state.zp2A & 0xff;
  const orientBit = state.zp15 & 0x0004;

  if (col === 0) {
    wideFloorLeftNeighbourFix(state);
    state.rewound = orientBit;
    stampEpilogue(state);
    return;
  }

  if (((col + 1) & 0xff) === colExtent) {
    if (orientBit === 0 && row === 0) {
      stampEpilogue(state);
      return;
    }
    wideFloorAboveNeighbourFix(state);
    stampEpilogue(state);
    return;
  }

  if (row >= 2) {
    floorRandom8wayPick(state);
    stampEpilogue(state);
    return;
  }

  // Body-table lookup. The asm:
  //   $00 = $2C << 1                 ; byte offset 0 or 2
  //   A   = $15 & 4                  ; orientation bit (value 0 or 4)
  //   Y   = A | $00                  ; byte offset ∈ {0,2,4,6}
  //   $9B = 1
  const yByteOffset = ((row << 1) | orientBit) & 0x07;
  const wordIdx = yByteOffset >>> 1;
  state.rewound = 1;

  if (isRndBoundSentinel(state)) {
    stampEpilogue(state);
    return;
  }

  const slotAddr = DATA_tunnel_floor_slope_v1_tiles[wordIdx]!;
  stampCell(state, state.templateAt(slotAddr));
  stampEpilogue(state);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_tunnel_floor_slope_v2 (Bank13.asm:7254).
// Std object $5B. Width-3 row gate; row-1 also skips above-fix.
// ─────────────────────────────────────────────────────────────────────

export const stampTunnelFloorSlopeV2: PerCellHandler = (state) => {
  const col = state.zp28 & 0xff;
  const row = state.zp2C & 0xff;
  const colExtent = state.zp2A & 0xff;
  const orientBit = state.zp15 & 0x0004;

  if (col === 0) {
    wideFloorLeftNeighbourFix(state);
    state.rewound = orientBit;
    stampEpilogue(state);
    return;
  }

  if (((col + 1) & 0xff) === colExtent) {
    // v2-specific: skip above-fix when orientBit == 0 AND row in {0, 1}.
    if (orientBit === 0 && (row === 0 || row === 1)) {
      stampEpilogue(state);
      return;
    }
    wideFloorAboveNeighbourFix(state);
    stampEpilogue(state);
    return;
  }

  if (row >= 3) {
    floorRandom8wayPick(state);
    stampEpilogue(state);
    return;
  }

  // Body-table lookup. The asm:
  //   $00 = $2C << 1                 ; byte offset 0/2/4
  //   A   = ($15 & 4) << 1           ; orientation bit at bit-3 (value 8)
  //   Y   = A | $00                  ; byte offset ∈ {0,2,4,8,10,12}
  //   $9B = 1
  const yByteOffset = ((row << 1) | (orientBit << 1)) & 0x0f;
  const wordIdx = yByteOffset >>> 1;
  state.rewound = 1;

  if (isRndBoundSentinel(state)) {
    stampEpilogue(state);
    return;
  }

  const slotAddr = DATA_tunnel_floor_slope_v2_tiles[wordIdx];
  if (slotAddr === undefined || slotAddr === 0) {
    // $0000 gap entry — cart would dereference $0000:$0000 → 0 and
    // stamp 0. The trace specs never land on this index, so we leave
    // the cell untouched (no stamp) rather than blank a prior tile.
    stampEpilogue(state);
    return;
  }

  stampCell(state, state.templateAt(slotAddr));
  stampEpilogue(state);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_tunnel_floor_slope_right (Bank12.asm:3828).
// Shared init for std $59 / $5A / $5B.
// ─────────────────────────────────────────────────────────────────────

const VARIANT_STAMPS: readonly PerCellHandler[] = [
  stampTunnelFloorSlopeV0,
  stampTunnelFloorSlopeV1,
  stampTunnelFloorSlopeV2,
];

// DATA_tunnel_floor_slope_right_steps (Bank12.asm:3872).
// Per-variant $17 slope step. v0 ($59) and v1 ($5A) descend 1 row per
// column ($FFFF = -1). v2 ($5B) descends 2 rows per column ($FFFE).
const DATA_tunnel_floor_slope_right_steps = [0xFFFF, 0xFFFF, 0xFFFE] as const;

// Merge: object IDs 0x59, 0x5A, 0x5B share this handler.
function initTunnelFloorSlopeRight(state: DecodeState): void {
  // Step 1: pick variant index from $15 bits 0-1.
  //   X = (($15 & 3) - 1) << 1 → 0 / 2 / 4 for $59 / $5A / $5B.
  const variantWordIdx = ((state.zp15 & 0x03) - 1) & 0xff;
  // variantWordIdx is 0, 1, or 2 — direct array index.
  const stamp = VARIANT_STAMPS[variantWordIdx];
  if (!stamp) {
    // ($15 & 3) == 0 is impossible for legitimate std $59/$5A/$5B
    // (all have low bits set). Bail to keep us from indexing into junk.
    return;
  }

  // Step 2: $19 = $7FFF (handled by walkerSetupKeepSlope).
  // Step 3: $17 = DATA_tunnel_floor_slope_right_steps[X].
  state.zp17 = DATA_tunnel_floor_slope_right_steps[variantWordIdx]!;

  // Step 4: $2E += 1; $2A += 2.
  state.zp2E = (state.zp2E + 1) & 0xffff;
  state.zp2A = (state.zp2A + 2) & 0xff;

  // Step 5: Adjust $1B as a 16-bit word — screen-Y nibble -= $10
  // (row-up by one cell) AND sub-X nibble -= 1 (one cell to the left).
  // Cart reads $1B as a 16-bit value covering $1B:$1C.
  const word1B = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  const screenKeep = ((word1B & 0xf0f0) - 0x0010) & 0xf0f0;
  const subKeep = (word1B & 0x0f0f);
  const subDec = (subKeep - 1) & 0x0f0f;
  const newWord = (screenKeep | subDec) & 0xffff;
  state.zp1B = newWord & 0xff;
  state.zp1C = (newWord >>> 8) & 0xff;

  // Step 6: walker_setup with $17 preserved (cart trampoline writes the
  // same stamp to all 3 slots manually — equivalent to keep-slope with
  // a single handler).
  walkerSetupKeepSlope(state, stamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────

export function installTunnelFloorSlopeRightHandlers(): void {
  registerStdObjectHandler(0x59, initTunnelFloorSlopeRight);
  registerStdObjectHandler(0x5A, initTunnelFloorSlopeRight);
  registerStdObjectHandler(0x5B, initTunnelFloorSlopeRight);
}
