// Bank13 complex-terrain 2-variant stamp handlers + Bank12 init wrapper.
//
// Standard objects $BE / $BF — two "tall vertical terrain strip with
// border-aware tile substitution" variants. Both share
// `CODE_init_terrain_2variant_complex` ($12:A03E); orientation byte $15
// bit 0 picks the per-cell stamper via DATA_terrain_2variant_complex_stamps:
//
//   $15 bit 0 == 0  ($BE) →  CODE_stamp_terrain_lookup_left  ($13:E583)
//   $15 bit 0 == 1  ($BF) →  CODE_stamp_terrain_lookup_right ($13:E62D)
//
// The init does no DP mutation — it loads the stamp pointer from
// DATA_terrain_2variant_complex_stamps indexed by `($15 & 1) << 1`, then tail-calls the walker
// trampoline with that single handler wired into all three slots
// (even-col / odd-col / row-end). Walker reads the stream's raw extents
// directly.
//
// Both stampers branch on the row position relative to the row-extent:
// row 0, row==extent-2 ("second-to-last"), row==extent-1 ("last"),
// and the "interior" fallback. Each branch performs a linear scan of
// a small anchor table (DATA_terrain_anchor_45tiles / DATA_terrain_secondary_anchor_24tiles / DATA_terrain_door_anchor_6tiles /
// DATA_terrain_extra_anchor) against the existing cell ($12); a hit picks a paired
// replacement tile from DATA_terrain_replacement_45tiles / DATA_terrain_secondary_replacement_20tiles / DATA_terrain_extra_replacement, a
// miss falls back to a fixed default ($8101 / $8103 / $1517) or
// (left-only) skips the stamp entirely.
//

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { getMap16Below } from '../fetch.ts';
import { stampCell, readBuf16, setProbeToCurrent, scanAnchor } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Anchor + replacement tables shared by both stampers.
//
// Cart asm: DATA_terrain_anchor_45tiles .. DATA_terrain_extra_replacement (Bank13.asm:12257-12377). All
// tables are word-arrays addressed by Y in the asm; the asm steps Y
// down by 2 per iteration (16-bit pitch), so the highest valid Y is
// `(count - 1) * 2`. We flatten to 1-entry-per-index here and convert
// Y → idx as `Y >>> 1` at the call site.
// ─────────────────────────────────────────────────────────────────────

/** DATA_terrain_anchor_45tiles. 44-entry row-0 anchor
 *  scanned by stamp_terrain_lookup_left at row 0. Asm uses Y=$56 max
 *  (= idx 43, so 44 entries effective; the trailing $77CE/$854B-$854E
 *  pairs ride along). */
const DATA_terrain_anchor_45tiles = [
  0x7799, 0x779A, 0x779B, 0x779C, 0x779D, 0x779E, 0x779F, 0x77A0,
  0x77A1, 0x77A2, 0x77A3, 0x77A4, 0x77A5, 0x77A6, 0x77A7, 0x77A8,
  0x77A9, 0x77AA, 0x77AB, 0x77AC, 0x77AD, 0x77AE, 0x77AF, 0x77B0,
  0x77B1, 0x77B2, 0x77B3, 0x77B4, 0x77B5, 0x77B6, 0x77B7, 0x77B8,
  0x77B9, 0x77BA, 0x77BB, 0x77BE, 0x77C9, 0x77CA, 0x77CC, 0x77CE,
  0x854B, 0x854C, 0x854D, 0x854E,
] as const;

/** DATA_terrain_replacement_45tiles. Replacement parallel
 *  to DATA_terrain_anchor_45tiles. */
const DATA_terrain_replacement_45tiles = [
  0x77CF, 0x77CF, 0x77CF, 0x77CF, 0x77C8, 0x77C8, 0x77C8, 0x77C8,
  0x77CF, 0x77CF, 0x77C8, 0x77C8, 0x77CF, 0x77CF, 0x77C8, 0x77C8,
  0x77CF, 0x77CF, 0x77CF, 0x77CF, 0x77C8, 0x77C8, 0x77C8, 0x77C8,
  0x77CF, 0x77CF, 0x77C8, 0x77C8, 0x77CF, 0x77CF, 0x77C8, 0x77C8,
  0x77CF, 0x77C8, 0x77CF, 0x77CF, 0x77CF, 0x77C8, 0x77CF, 0x77CF,
  0x854F, 0x854F, 0x854F, 0x854F,
] as const;

/** DATA_terrain_secondary_anchor_24tiles. Scanned at
 *  Y=$2E max (= idx 23) by both stampers on the "last row" branch
 *  (and by the right stamper's "second-to-last with below probe"). */
const DATA_terrain_secondary_anchor_24tiles = [
  0x7925, 0x7926, 0x7927, 0x7928, 0x7929, 0x792A, 0x791B, 0x791C,
  0x7962, 0x7963, 0x7966, 0x7968, 0x7969, 0x796A, 0x796D, 0x796F,
  0x7978, 0x7979, 0x797C, 0x797D, 0x7936, 0x7937, 0x7939, 0x793B,
] as const;

/** DATA_terrain_secondary_replacement_20tiles. Asm
 *  declares 20 entries; the loop max Y=$2E (idx 23) reads 4 entries
 *  past the end into whatever follows ($1513 ../$1516 in
 *  DATA_terrain_door_anchor_6tiles). We pad explicitly with the
 *  trailing bytes the cart sees to preserve byte-exact behaviour at
 *  the high indices. */
const DATA_terrain_secondary_replacement_20tiles = [
  0x7805, 0x7806, 0x7807, 0x7808, 0x7809, 0x780A, 0x780B, 0x780C,
  0x780D, 0x780E, 0x780F, 0x7810, 0x7811, 0x7812, 0x7813, 0x7814,
  0x7815, 0x7816, 0x7817, 0x7818,
  // Tail (4 entries) read from DATA_terrain_door_anchor_6tiles
  // ($1513 .. $1516) when Y indexes past the declared 20 entries.
  0x1513, 0x1514, 0x1515, 0x1516,
] as const;

/** DATA_terrain_door_anchor_6tiles. Scanned at Y=$A max
 *  (= idx 5) on the interior branch; a match stamps the door-cap
 *  tile $1517. */
const DATA_terrain_door_anchor_6tiles = [
  0x1513, 0x1514, 0x1515, 0x1516, 0x1518, 0x1519,
] as const;

/** DATA_terrain_extra_anchor. Scanned at Y=$1A max (=
 *  idx 13) on the "second-to-last row" branch. */
const DATA_terrain_extra_anchor = [
  0x7925, 0x7926, 0x7927, 0x7928, 0x7929, 0x792A, 0x791B, 0x791C,
  0x082D, 0x082E, 0x0A2D, 0x0A2E, 0x0A2F, 0x0A30,
] as const;

/** DATA_terrain_extra_replacement. Replacement parallel
 *  to DATA_terrain_extra_anchor. */
const DATA_terrain_extra_replacement = [
  0x7805, 0x7806, 0x7807, 0x7808, 0x7809, 0x780A, 0x780B, 0x780C,
  0x7F01, 0x7F01, 0x8001, 0x8001, 0x8001, 0x8001,
] as const;

// Defaults stamped when an anchor scan misses.
const TERRAIN_DEFAULT_INTERIOR = 0x8101; // interior fallback
const TERRAIN_DEFAULT_2ND_LAST = 0x8103; // second-to-last-row fallback
const TERRAIN_DOOR_CAP = 0x1517;         // door-anchor match output
// Right-stamper row-0 + row-1 literals
const TERRAIN_R_ROW0_77BA_OUT = 0x77BF;
const TERRAIN_R_ROW0_DEFAULT = 0x77C0;
const TERRAIN_R_ROW1_DEFAULT = 0x8102;
const TERRAIN_R_ROW1_8100 = 0x8100;

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_terrain_lookup_left ($13:E583) — $BE.
//
//   row == 0           → DATA_terrain_anchor_45tiles → DATA_terrain_replacement_45tiles[y] / skip
//   row+2 == extent    → DATA_terrain_extra_anchor   → DATA_terrain_extra_replacement[y]   / $8103
//   row+1 == extent    → DATA_terrain_secondary_anchor_24tiles → DATA_terrain_secondary_replacement_20tiles[y] / skip
//   else (interior)    → DATA_terrain_door_anchor_6tiles → $1517 / $8101
// ─────────────────────────────────────────────────────────────────────
const stampTerrainLookupLeft: PerCellHandler = (state) => {
  const row = state.zp2C & 0xffff;
  const ext = state.zp2E & 0xffff;
  const cur = state.zp12 & 0xffff;

  if (row === 0) {
    // Row 0 — asm Y max = $56 → idx 43 (44 entries; table is exactly 44).
    const idx = scanAnchor(
      DATA_terrain_anchor_45tiles as unknown as number[],
      cur,
    );
    if (idx >= 0) {
      stampCell(state, DATA_terrain_replacement_45tiles[idx]!);
    }
    // miss → skip stamp
    return;
  }

  if (((row + 2) & 0xffff) === ext) {
    // Second-to-last row — Y max = $1A → idx 13 (14 entries).
    const idx = scanAnchor(
      DATA_terrain_extra_anchor as unknown as number[],
      cur,
    );
    if (idx >= 0) {
      stampCell(state, DATA_terrain_extra_replacement[idx]!);
    } else {
      stampCell(state, TERRAIN_DEFAULT_2ND_LAST);
    }
    return;
  }

  if (((row + 1) & 0xffff) === ext) {
    // Last row — Y max = $2E → idx 23 (24 entries).
    const idx = scanAnchor(
      DATA_terrain_secondary_anchor_24tiles as unknown as number[],
      cur,
    );
    if (idx >= 0) {
      stampCell(state, DATA_terrain_secondary_replacement_20tiles[idx]!);
    }
    // miss → skip stamp
    return;
  }

  // Interior — Y max = $A → idx 5 (6 entries).
  const idx = scanAnchor(
    DATA_terrain_door_anchor_6tiles as unknown as number[],
    cur,
  );
  if (idx >= 0) {
    stampCell(state, TERRAIN_DOOR_CAP);
  } else {
    stampCell(state, TERRAIN_DEFAULT_INTERIOR);
  }
};

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_terrain_lookup_right ($13:E62D) — $BF.
//
// Different row-0 and row-1 special cases than the left stamper; uses
// the same DATA_terrain_secondary_anchor_24tiles + DATA_terrain_extra_anchor scans for
// last / second-to-last but in different roles:
//
//   row == 0        → cur==$77BA → $77BF ; (cur & $FF00)==$8500 → skip ; else $77C0
//   row == 1        → cur==$779F → $8100 ; cur==$77A0 → $8100 ;
//                     cur==$1513 → $1517 ; cur==$1516 → $1517 ; else $8102
//   row+1 == extent → DATA_terrain_extra_anchor → DATA_terrain_extra_replacement[y] / DATA_terrain_secondary_anchor_24tiles → DATA_terrain_secondary_replacement_20tiles[y] / $8101
//   row+2 == extent → probe Map16 below ; DATA_terrain_secondary_anchor_24tiles hit → $8103 / $8101
//   else (interior) → DATA_terrain_door_anchor_6tiles hit → $1517 / $8101
// ─────────────────────────────────────────────────────────────────────
const stampTerrainLookupRight: PerCellHandler = (state) => {
  const row = state.zp2C & 0xffff;
  const ext = state.zp2E & 0xffff;
  const cur = state.zp12 & 0xffff;

  if (row === 0) {
    if (cur === 0x77BA) {
      stampCell(state, TERRAIN_R_ROW0_77BA_OUT);
      return;
    }
    if ((cur & 0xff00) === 0x8500) {
      // skip stamp (asm: JMP exit_only)
      return;
    }
    stampCell(state, TERRAIN_R_ROW0_DEFAULT);
    return;
  }

  if (row === 1) {
    if (cur === 0x779F || cur === 0x77A0) {
      stampCell(state, TERRAIN_R_ROW1_8100);
      return;
    }
    if (cur === 0x1513 || cur === 0x1516) {
      stampCell(state, TERRAIN_DOOR_CAP);
      return;
    }
    stampCell(state, TERRAIN_R_ROW1_DEFAULT);
    return;
  }

  if (((row + 1) & 0xffff) === ext) {
    // Last row — try DATA_terrain_extra_anchor first (Y max $1A → 14 entries),
    // then DATA_terrain_secondary_anchor_24tiles (Y max $2E → 24 entries), else $8101.
    let idx = scanAnchor(
      DATA_terrain_extra_anchor as unknown as number[],
      cur,
    );
    if (idx >= 0) {
      stampCell(state, DATA_terrain_extra_replacement[idx]!);
      return;
    }
    idx = scanAnchor(
      DATA_terrain_secondary_anchor_24tiles as unknown as number[],
      cur,
    );
    if (idx >= 0) {
      stampCell(state, DATA_terrain_secondary_replacement_20tiles[idx]!);
      return;
    }
    stampCell(state, TERRAIN_DEFAULT_INTERIOR);
    return;
  }

  if (((row + 2) & 0xffff) === ext) {
    // Second-to-last row — probe the cell BELOW the current cell, then
    // scan DATA_terrain_secondary_anchor_24tiles against THAT tile (not $12). Asm:
    //   LDA $1B ; STA $0E ; JSL get_map16_below
    //   LDY #$002E ; LDA buffer,x
    //   CMP DATA_terrain_secondary_anchor_24tiles,y / BEQ → $8103 ; else $8101
    setProbeToCurrent(state);
    const belowOff = getMap16Below(state);
    const belowTile = readBuf16(state, belowOff);
    const idx = scanAnchor(
      DATA_terrain_secondary_anchor_24tiles as unknown as number[],
      belowTile,
    );
    stampCell(state, idx >= 0 ? TERRAIN_DEFAULT_2ND_LAST : TERRAIN_DEFAULT_INTERIOR);
    return;
  }

  // Interior — door-anchor probe → $1517 ; else $8101.
  const idx = scanAnchor(
    DATA_terrain_door_anchor_6tiles as unknown as number[],
    cur,
  );
  stampCell(state, idx >= 0 ? TERRAIN_DOOR_CAP : TERRAIN_DEFAULT_INTERIOR);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_terrain_2variant_complex ($12:A03E).
//
//   REP #$20
//   LDA $15 ; AND #$0001 ; ASL ; TAY
//   LDX #(handler_bank-1)>>16 ; LDA DATA_terrain_2variant_complex_stamps,y
//   JMP walker_setup_trampoline
//
// No DP mutation; the variant bit ($15 & 1) picks the per-cell stamp
// handler from DATA_terrain_2variant_complex_stamps.
// ─────────────────────────────────────────────────────────────────────

/** DATA_terrain_2variant_complex_stamps ($12:A03A). 2-entry stamp-handler table. */
const DATA_terrain_2variant_complex_stamps: ReadonlyArray<PerCellHandler> = [
  stampTerrainLookupLeft,   // $BE  ($15 & 1 = 0)
  stampTerrainLookupRight,  // $BF  ($15 & 1 = 1)
];

// Merge: object IDs 0xBE, 0xBF share this handler.
function initTerrain2variantComplex(state: DecodeState): void {
  const variant = state.zp15 & 0x01;
  const stamp = DATA_terrain_2variant_complex_stamps[variant]!;
  walkerSetupTrampoline(state, stamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installTerrain2variantComplexHandlers(): void {
  registerStdObjectHandler(0xBE, initTerrain2variantComplex);
  registerStdObjectHandler(0xBF, initTerrain2variantComplex);
}
