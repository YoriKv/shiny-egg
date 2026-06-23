// Bank13 sewer-water-pool stamp handler + Bank12 init wrapper.
//
// Standard object $CA — SewerWaterPool: a large sewer water pool drawn by
// a large-LUT, two-stage shape-aware stamp:
//
//   - Row 0 (top row): probe the left/right neighbours for a "grow-into"
//     marker tile ($8103) and, if present, scan a 44-entry anchor table
//     of "known terrain pieces" against the current cell ($12) to pick a
//     replacement tile from one of two parallel 44-entry tables (one for
//     "left side has marker → use right-side variants", one for "right
//     side has marker → use left-side variants"). If no match — or the
//     replacement is $0000 — leave the cell untouched. The $8101 marker
//     on the current cell short-circuits to stamping $8103 directly.
//
//   - Rows 1..N (body rows): unconditional binary pick. Stamp $161F if
//     the current cell already holds $0001, else stamp $1620. This is
//     the "fill the body of the pool" pass.
//
// The stamp uses the cart's go-to "extend an existing piece of terrain to
// fit a player-placed rectangle" idiom — see
// CODE_stamp_terrain_lookup_left ($13:E583) for the much larger 4-region
// variant; this one is the simplified "single anchor table" form.
//
// Asm sources:
//   CODE_init_sewer_water_pool        Bank12.asm:5043  ($12:A0BD)
//   CODE_stamp_sewer_water_pool       Bank13.asm:12809 ($13:E9F6)
//   DATA_terrain_anchor_45tiles         Bank13.asm:12257 ($13:E46F)
//   DATA_sewer_water_pool_grow_left_44tiles      Bank13.asm:12787 ($13:E942)
//   DATA_sewer_water_pool_grow_right_44tiles     Bank13.asm:12796 ($13:E99A)
//   DATA_sewer_water_pool_grow_pointer_pair      Bank13.asm:12805 ($13:E9F2)
//   CODE_probe_left_tile                Bank13.asm:15275 ($13:FD54)
//   CODE_probe_right_tile               Bank13.asm:15288 ($13:FD61)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { probeLeftTile, probeRightTile, stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Marker tiles.
//
// $8101 / $8103 are sentinel Map16 IDs used by terrain-family handlers
// to flag "this cell is a stitch point". $8101 = "stamp $8103 here";
// $8103 = "the neighbour-side variant should be picked when the
// adjacent cell is filled in". Both are produced by other terrain
// stamp handlers and only persist long enough for follow-up objects to
// observe them.
// ─────────────────────────────────────────────────────────────────────

const MARKER_STITCH_HERE  = 0x8101;
const MARKER_STITCH_NEIGH = 0x8103;

// Body-row stamps (cart `CODE_13EA23`):
//   $2C (row) == $0001 → $161F
//   otherwise          → $1620
// NB: the cart reaches CODE_13EA23 via `LDA $2C ; BNE`, so A still holds the
// ROW counter at the `CMP #$0001` — the binary pick is on the row, NOT $12.
const BODY_TILE_WHEN_ROW_IS_ONE = 0x161F;
const BODY_TILE_DEFAULT         = 0x1620;

// ─────────────────────────────────────────────────────────────────────
// DATA_terrain_anchor_45tiles ($13:E46F, Bank13.asm:12257). 45 entries.
//
// Scanned by row-0 growth path: Y starts at $56 (byte offset 86 → entry
// index 43) and decrements by 2 looking for the current cell's Map16 ID.
// The 45th entry ($854E, index 44) is past Y's starting position and
// only ever consulted by the parallel CODE_stamp_terrain_lookup_left
// handler — this stamp does not see it.
//
// Indices 0..43 cover the cart's library of "known terrain edge/face
// pieces" ($7799-$77BE plus $77C9-$77CC plus $854B-$854E). When the
// current cell already holds one of these tiles, the same index is used
// to fetch the new stamp from the grow_{left,right} parallel tables.
// ─────────────────────────────────────────────────────────────────────

const DATA_terrain_anchor_45tiles: ReadonlyArray<number> = [
  0x7799, 0x779A, 0x779B, 0x779C, 0x779D, 0x779E, 0x779F, 0x77A0,
  0x77A1, 0x77A2, 0x77A3, 0x77A4, 0x77A5, 0x77A6, 0x77A7, 0x77A8,
  0x77A9, 0x77AA, 0x77AB, 0x77AC, 0x77AD, 0x77AE, 0x77AF, 0x77B0,
  0x77B1, 0x77B2, 0x77B3, 0x77B4, 0x77B5, 0x77B6, 0x77B7, 0x77B8,
  0x77B9, 0x77BA, 0x77BB, 0x77BE, 0x77C9, 0x77CA, 0x77CC, 0x77CE,
  0x854B, 0x854C, 0x854D, 0x854E,
  // Index 44 ($854E) - not reached: scan starts at index 43 and decrements
  // We keep it for completeness; runtime never indexes here.
];

// Cart scan starts at Y = $56 (byte offset 86 = 43 × 2). Use 43 as the
// highest entry index reached (44 entries: 0..43 inclusive).
const ANCHOR_SCAN_MAX_INDEX = 43;

// ─────────────────────────────────────────────────────────────────────
// DATA_sewer_water_pool_grow_left_44tiles ($13:E942, Bank13.asm:12787). 44 entries.
//
// Parallel to DATA_terrain_anchor_45tiles[0..43]. When the right
// neighbour is $8103 (= Y=$0000 path; cart's pointer table picks
// DATA_sewer_water_pool_grow_left_44tiles), this is the replacement-tile table. Zero entries mean
// "no stamp" (the cart's `BEQ CODE_13EA51` branch after `TAY`).
//
// The "left" half of the cart's naming refers to the **side of the
// generated terrain** that this table provides faces for — when growing
// rightward into existing terrain, we stamp the left-face variants.
// ─────────────────────────────────────────────────────────────────────

const DATA_sewer_water_pool_grow_left_44tiles: ReadonlyArray<number> = [
  0x0000, 0x0000, 0x77BC, 0x77BC, 0x77BD, 0x77BD, 0x0000, 0x0000,
  0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
  0x0000, 0x0000, 0x77BC, 0x77BC, 0x77BD, 0x77BD, 0x0000, 0x0000,
  0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
  0x77BC, 0x77BD, 0x77BC, 0x77BC, 0x77BC, 0x77BD, 0x77BC, 0x77BC,
  0x8572, 0x8573, 0x8574, 0x8575,
];

// ─────────────────────────────────────────────────────────────────────
// DATA_sewer_water_pool_grow_right_44tiles ($13:E99A, Bank13.asm:12796). 44 entries.
//
// Parallel to DATA_terrain_anchor_45tiles[0..43]. When the left
// neighbour is $8103 (= Y=$0002 path; cart's pointer table picks
// DATA_sewer_water_pool_grow_right_44tiles), this is the replacement-tile table. Shape mirrors
// DATA_sewer_water_pool_grow_left_44tiles but with right-face Map16 IDs
// ($77CB/$77CD/$8576-$8579).
// ─────────────────────────────────────────────────────────────────────

const DATA_sewer_water_pool_grow_right_44tiles: ReadonlyArray<number> = [
  0x0000, 0x0000, 0x77CB, 0x77CB, 0x77CD, 0x77CD, 0x0000, 0x0000,
  0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
  0x0000, 0x0000, 0x77CB, 0x77CB, 0x77CD, 0x77CD, 0x0000, 0x0000,
  0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
  0x77CB, 0x77CD, 0x77CB, 0x77CB, 0x77CB, 0x77CD, 0x77CB, 0x77CB,
  0x8576, 0x8577, 0x8578, 0x8579,
];

// `probeLeftTile` / `probeRightTile` (cart `CODE_probe_left_tile` $13:FD54
// / `CODE_probe_right_tile` $13:FD61) are imported from `_shared.ts`.

// ─────────────────────────────────────────────────────────────────────
// Row-0 path (CODE_stamp_sewer_water_pool prologue + CODE_13EA30
// growth-table scan).
//
// Returns the Map16 ID to stamp, or `null` to leave the cell alone
// (cart's BRA CODE_13EA51 fall-throughs without writing the buffer).
// ─────────────────────────────────────────────────────────────────────

function row0Pick(state: DecodeState): number | null {
  const cur = state.zp12 & 0xffff;

  // CMP #$8101 / BEQ CODE_13EA4A — current cell is itself a stitch
  // marker; stamp $8103 directly (Y was preloaded at $13EA0F).
  if (cur === MARKER_STITCH_HERE) {
    return MARKER_STITCH_NEIGH;
  }

  // Probe left first. If left neighbour is $8103, take Y=$0002 path
  // (pointer table → DATA_sewer_water_pool_grow_right_44tiles).
  const left = probeLeftTile(state);
  if (left === MARKER_STITCH_NEIGH) {
    return scanAndPick(cur, DATA_sewer_water_pool_grow_right_44tiles);
  }

  // Otherwise probe right. If right neighbour is $8103 OR $8101, take
  // Y=$0000 path (pointer table → DATA_sewer_water_pool_grow_left_44tiles).
  const right = probeRightTile(state);
  if (right === MARKER_STITCH_NEIGH || right === MARKER_STITCH_HERE) {
    return scanAndPick(cur, DATA_sewer_water_pool_grow_left_44tiles);
  }

  // No stitch marker on either side — fall through with no stamp.
  return null;
}

/** Cart `CODE_13EA30..CODE_13EA45` scan: look up `cur` in
 *  DATA_terrain_anchor_45tiles (Y = $56 down to $0 in 2-byte steps),
 *  and if found, return the parallel entry from `growTable`. Zero
 *  entries — and a not-found result — both leave the cell untouched. */
function scanAndPick(cur: number, growTable: ReadonlyArray<number>): number | null {
  for (let i = ANCHOR_SCAN_MAX_INDEX; i >= 0; i--) {
    if (DATA_terrain_anchor_45tiles[i] === cur) {
      const pick = growTable[i] ?? 0;
      if (pick === 0) {
        return null;
      }
      return pick & 0xffff;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Per-cell handler entry point (CODE_stamp_sewer_water_pool, $13:E9F6).
// ─────────────────────────────────────────────────────────────────────

const sewerWaterPoolStamp: PerCellHandler = (state) => {
  const row = state.zp2C & 0xffff;
  let pick: number | null;
  if (row !== 0) {
    // CODE_13EA23: body-row binary pick on the ROW counter ($2C), not $12.
    pick = row === 0x0001 ? BODY_TILE_WHEN_ROW_IS_ONE : BODY_TILE_DEFAULT;
  } else {
    pick = row0Pick(state);
  }
  if (pick !== null) {
    stampCell(state, pick);
  }
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_sewer_water_pool ($12:A0BD).
//
//   REP #$20
//   LDX #(CODE_stamp_sewer_water_pool-1)>>16
//   LDA #CODE_stamp_sewer_water_pool-1
//   JMP walker_setup_trampoline
//
// Plain trampoline-walker init: identical handler for even-col /
// odd-col / row slots, $19 = $7FFF, slope = 0. Spec confirms no DP
// mutations — walker reads the stream's raw $1B/$1C/$2A/$2E/$15
// unchanged.
// ─────────────────────────────────────────────────────────────────────

function initSewerWaterPool(state: DecodeState): void {
  walkerSetupTrampoline(state, sewerWaterPoolStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installSewerWaterPoolHandlers(): void {
  registerStdObjectHandler(0xCA, initSewerWaterPool);
}
