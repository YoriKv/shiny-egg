// Bank13 stamp handlers for std objects $CC and $CD — the upwards diagonal
// castle BACKGROUND wall (height 1) family: a single-base-row diagonal wall
// object that grows one extra row per column (height=1 init, $17=1 keep-slope
// step). Two variants:
//
//   $CC  CastleWallDiagonalLeft  (left-facing, variant 0)
//                      → CODE_stamp_castle_wall_diag_left @ $13:EB64
//                        tiles from DATA_castle_wall_diag_left_tiles @ $13:EB5E
//                        ($00C9, $00CA, $00C2)
//   $CD  CastleWallDiagonalRight (right-facing, variant 1)
//                      → CODE_stamp_castle_wall_diag_right  @ $13:EA5A
//                        tiles from DATA_castle_wall_diag_right_tiles   @ $13:EA54
//                        ($00CC, $00CB, $00C2)
//
// Shared init at CODE_init_castle_wall_diag (Bank12.asm:5062):
//   STZ $A1        ; zero seam-fix autotile flag (read by castle_wall_corner_top_row_probe)
//   $17 = 1        ; per-column slope step = +1 row (height grows downward)
//   y = ($15 & 1) << 1
//   stamp_ptr = DATA_castle_wall_diag_stamps[y]
//   dispatch via walker_setup_keep_slope (preserves $17)
//
// Per-cell stamp (mirrors both `CODE_stamp_castle_wall_diag_{left,right}`):
//
//   Y = ($2C == 0)     ? 0 :       ; top row    → tiles[0] cap
//       ($2C == $FFFF) ? 2 :       ; row -1     → tiles[1] alt cap (unreachable for $17=1)
//                        4         ; other rows → tiles[2] = $00C2 body
//
//   ;; base stamp (with Y=0 skip-on-occupied guard)
//   if Y == 0 AND $12 != 0: skip stamp
//   else                  : stamp tiles[Y/2]
//   $9B = 1
//
//   ;; post-process dispatch
//   if Y < 4 (top-row cap):
//     $CD: call castle_wall_diag_right_post_process(Y)        ; Y∈{0,2} → seam[0/1]
//     $CC: call castle_wall_diag_right_post_process(Y | 4)    ; Y∈{4,6} → seam[2/3]
//     ; exit (no last-row hook on cap rows)
//   else (body row):
//     ;; edge-fix on body row
//     $CD: if col == 0:           call castle_wall_diag_left_post_process
//     $CC: if ($28-1) == $2A:     call castle_wall_diag_left_post_process
//     ;; last-row hook (row+1 == row_extent)
//     if $12 == $00D5:                  $A1 = 0
//     elif probe above-with-subX-1 in [$0153,$0161): $A1 = 6
//     else (no-match):
//       $CC: $A1 = 0
//       $CD: $A1 unchanged
//     call castle_wall_corner_top_row_probe
//
// The two post-process helpers (CODE_castle_wall_diag_left_post_process @ $13:EADC and
// CODE_castle_wall_diag_right_post_process @ $13:EB2C) handle the wall-meets-wall
// corner connectors when the diagonal wall abuts a wall stamped by a prior object.
// They're now ported faithfully — were previously skipped as "visual
// smoothing not material to the static editor preview" but now that the
// dependent helpers (probeLeftTile, isCeilingShape, castleWallCornerAboveProbe,
// castleWallCornerTopRowProbe) are available in `bank13-castle-wall.ts`,
// they're cheap to wire up.
//
// No trace-harness spec exists for $CC/$CD — primary source is cart asm
// (Bank12.asm:5057-5073 + Bank13.asm:13107-13332) with GoldenEgg ObjCCMain /
// ObjCDMain (Level.cs:7723/7743) as cross-reference.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupKeepSlope } from '../walker.ts';
import {
  isMidSlopeShape,
  probeLeftTile,
  readBuf16,
  setProbeToCurrent,
  signed8,
  stampCell,
} from './_shared.ts';
import { getMap16Above } from '../fetch.ts';
import {
  castleWallCornerAboveProbe,
  castleWallCornerTopRowProbe,
} from './bank13-castle-wall.ts';

// ───────────────────────────────────────────────────────────────────────
// Per-variant tile records.
//
// 3 entries each, laid out as:
//   [0]  top-row cap (only stamped over empty $12==0)
//   [1]  row-(-1) cap (unreachable for $17=1; included for fidelity)
//   [2]  body tile ($00C2 — shared diagonal-wall body Map16 ID)
// ───────────────────────────────────────────────────────────────────────

/** DATA_castle_wall_diag_left_tiles @ $13:EB5E — used by std object $CC. */
const CASTLE_WALL_DIAG_LEFT_TILES = [0x00C9, 0x00CA, 0x00C2] as const;

/** DATA_castle_wall_diag_right_tiles  @ $13:EA54 — used by std object $CD. */
const CASTLE_WALL_DIAG_RIGHT_TILES = [0x00CC, 0x00CB, 0x00C2] as const;

// ───────────────────────────────────────────────────────────────────────
// Post-process seam-tile tables (Bank13.asm:13214 / :13218). Indexed by
// Y/2 where Y is the byte offset passed by the caller. Cart `DATA_castle_wall_diag_seam_above_4tiles`
// fires when the cell ABOVE the diagonal wall is in the mid-slope range; cart
// `DATA_castle_wall_diag_seam_left_4tiles` fires when the LEFT neighbour is mid-slope.
// ───────────────────────────────────────────────────────────────────────

const DATA_CASTLE_WALL_DIAG_SEAM_ABOVE_4TILES = [0x77DD, 0x77DC, 0x77DA, 0x77DB] as const;
const DATA_CASTLE_WALL_DIAG_SEAM_LEFT_4TILES  = [0x77E4, 0x77E2, 0x77E5, 0x77E3] as const;

// ───────────────────────────────────────────────────────────────────────
// Helpers.
// ───────────────────────────────────────────────────────────────────────

// `setProbeToCurrent` and `isMidSlopeShape` are now imported from
// `_shared.ts`. The shared `setProbeToCurrent` composes $0E as the full
// 16-bit `$1B | ($1C << 8)` (fix for the previous byte-only variant) —
// the local `setProbeToCurrent16` that mirrored that composition is
// removed in favour of the shared helper.

/** Probe the cell directly above the current cell, but with sub-X
 *  decremented by 1. Mirrors the asm idiom:
 *    LDA $1B PHA AND #$0F0F DEC AND #$0F0F STA $0E
 *    PLA AND #$F0F0 ORA $0E STA $0E
 *    JSL get_map16_above
 *    LDA buffer,X
 *  Used by `castle_wall_diag_left_post_process` and the last-row hook. */
function probeAboveWithSubXDec(state: DecodeState): number {
  const word1B = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  const subKeep = ((word1B & 0x0F0F) - 1) & 0x0F0F;
  const screenKeep = word1B & 0xF0F0;
  state.zp0E = (screenKeep | subKeep) & 0xffff;
  state.zp0F = (word1B >>> 8) & 0xff;
  const aboveOff = getMap16Above(state);
  return readBuf16(state, aboveOff);
}

/** CODE_castle_wall_diag_left_post_process (Bank13.asm:13182, $13:EADC). Stamps
 *  $00C7 at the current cell if either the LEFT neighbour or the
 *  ABOVE-with-subX-1 neighbour is in the mid-slope range. Always then
 *  calls `castle_wall_corner_above_probe` for an additional connector stamp. */
function castleWallDiagLeftPostProcess(state: DecodeState): void {
  const left = probeLeftTile(state);
  let stampC7 = isMidSlopeShape(left);
  if (!stampC7) {
    const above = probeAboveWithSubXDec(state);
    stampC7 = isMidSlopeShape(above);
  }
  if (stampC7) {
    stampCell(state, 0x00C7);
  }
  // Tail-JSR — `castle_wall_corner_above_probe` does its own probe-and-stamp.
  castleWallCornerAboveProbe(state);
}

/** CODE_castle_wall_diag_right_post_process (Bank13.asm:13222, $13:EB2C). Probes
 *  ABOVE first; if it's mid-slope, stamps `DATA_castle_wall_diag_seam_above[idx]`.
 *  Otherwise probes LEFT; if mid-slope, stamps `DATA_castle_wall_diag_seam_left[idx]`.
 *  `idx` is the byte offset (Y) divided by 2. */
function castleWallDiagRightPostProcess(state: DecodeState, byteY: number): void {
  // Negative-row guard (static-render divergence from the literal asm).
  //
  // The cart's neighbour primitives fold the row counter as
  // `($2C & $000F) << 4` (CODE_get_map16_above, $12:8719) — they DISCARD the
  // sign of $2C. For an upward slope ($2E negative ⇒ $2C runs 0,$FFFF,$FFFE…)
  // the "above" probe at row -1 ($2C=$FFFF) therefore carries into the
  // screen-Y nibble and resolves to the screen *below*, not above. At runtime
  // that wrongly-probed screen usually isn't decoded yet (sliding-window
  // timing), so the seam never fires and the cap stays $00CA. Our whole-level
  // decode has every screen populated, so the probe reads a neighbouring
  // wall tile ($015A/$015B ∈ [$0153,$0161)) and spuriously remaps the cap to
  // a seam tile ($77DB/$77E3).
  //
  // Semantically, the top cap of an upward slope has nothing genuinely above
  // it, so the seam must never fire there. Skipping the remap for negative
  // rows reproduces the game's appearance for every upward slope; downward
  // slopes keep $2C ≥ 0 and are unaffected. (Verified against 4-4's std-CC.)
  if (signed8(state.zp2C) < 0) return;

  const idx = (byteY >> 1) & 0x03;
  setProbeToCurrent(state);
  const aboveOff = getMap16Above(state);
  const above = readBuf16(state, aboveOff);
  if (isMidSlopeShape(above)) {
    stampCell(state, DATA_CASTLE_WALL_DIAG_SEAM_ABOVE_4TILES[idx]!);
    return;
  }
  const left = probeLeftTile(state);
  if (isMidSlopeShape(left)) {
    stampCell(state, DATA_CASTLE_WALL_DIAG_SEAM_LEFT_4TILES[idx]!);
  }
  // else: no stamp.
}

// ───────────────────────────────────────────────────────────────────────
// Per-cell stamp factory. Shared between both variants.
//
// Differences captured by CastleWallDiagConfig:
//   - tiles: per-variant 3-entry tile table
//   - rightHelperYMask: $CC ORs Y with 4 before calling
//     castle_wall_diag_right_post_process (shifts the seam-table index by
//     2 entries); $CD leaves Y alone
//   - bodyRowEdgeTest: $CD fires the left-edge fix on col 0;
//     $CC fires it on ($28-1 == $2A)
//   - defaultStzA1: $CC zeroes $A1 on the "no mid-slope above" branch
//     of the last-row hook; $CD leaves it untouched
// ───────────────────────────────────────────────────────────────────────

interface CastleWallDiagConfig {
  tiles: readonly number[];
  rightHelperYMask: number;
  bodyRowEdgeTest: (state: DecodeState) => boolean;
  defaultStzA1: boolean;
}

function makeCastleWallDiagStamp(cfg: CastleWallDiagConfig): PerCellHandler {
  return (state) => {
    // Row counter $2C is an 8-bit signed value in our walker (masked `& 0xff`),
    // so the cart's `CMP #$FFFF` (row -1) is **$FF** here, not $FFFF. Upward /
    // negative-extent slopes — e.g. 4-4's negative-width std-CC, whose $2E is
    // negative so $2C runs 0, $FF, $FE… — must select tiles[1] (the row-(-1)
    // cap, $00CB/$00CA) on the $FF row, not fall through to the $00C2 body.
    // The old `=== 0xffff` test could never match an 8-bit $2C, making that
    // branch dead and stamping body tiles over the whole row-(-1) diagonal.
    const row = state.zp2C & 0xff;
    let y: number; // byte offset: 0, 2, or 4
    if (row === 0x00) y = 0;
    else if (row === 0xff) y = 2;
    else y = 4;

    // Base stamp. Y == 0 (top row) skips the write if $12 is already set
    // — avoids clobbering a pre-existing tile under the slope's cap.
    if (!(y === 0 && state.zp12 !== 0)) {
      stampCell(state, cfg.tiles[y >> 1]!);
    }

    // $9B = 1 → walker's rewound flag. Combined with $17 = 1 from init,
    // each row wrap rewinds the nibble + bumps $2E, producing the
    // staircase silhouette.
    state.rewound = 0x0001;

    if (y < 4) {
      // Top-row cap (Y∈{0,2}): right-post-process and exit.
      castleWallDiagRightPostProcess(state, y | cfg.rightHelperYMask);
      return;
    }

    // Body row (Y == 4): conditional left-edge fix.
    if (cfg.bodyRowEdgeTest(state)) {
      castleWallDiagLeftPostProcess(state);
    }

    // Last-row hook: row+1 == row_extent → above-probe + castle_wall_corner_top_row_probe.
    const rowPlus1 = (state.zp2C + 1) & 0xff;
    if (rowPlus1 !== (state.zp2E & 0xff)) return;

    if (state.zp12 === 0x00D5) {
      state.zpA1 = 0;
    } else {
      const above = probeAboveWithSubXDec(state);
      if (isMidSlopeShape(above)) {
        state.zpA1 = 0x0006;
      } else if (cfg.defaultStzA1) {
        state.zpA1 = 0;
      }
      // $CD's "no mid-slope above": $A1 unchanged.
    }
    castleWallCornerTopRowProbe(state);
  };
}

// $CC CastleWallDiagonalLeft — mirrors CODE_stamp_castle_wall_diag_left.
const stampCastleWallDiagLeft = makeCastleWallDiagStamp({
  tiles: CASTLE_WALL_DIAG_LEFT_TILES,
  rightHelperYMask: 0x04,
  // $CC's body-row edge-fix test: cart `LDA $28 DEC CMP $2A BNE skip`
  // — fires when `$28 - 1 == $2A` (last col for negative-extent grow).
  bodyRowEdgeTest: (state) =>
    ((state.zp28 - 1) & 0xff) === (state.zp2A & 0xff),
  defaultStzA1: true,
});

// $CD CastleWallDiagonalRight — mirrors CODE_stamp_castle_wall_diag_right.
const stampCastleWallDiagRight = makeCastleWallDiagStamp({
  tiles: CASTLE_WALL_DIAG_RIGHT_TILES,
  rightHelperYMask: 0x00,
  // $CD's body-row edge-fix test: cart `LDA $28 BNE skip` — fires on col 0.
  bodyRowEdgeTest: (state) => (state.zp28 & 0xff) === 0,
  defaultStzA1: false,
});

// ───────────────────────────────────────────────────────────────────────
// Shared init for $CC and $CD (CODE_init_castle_wall_diag, Bank12.asm:5062).
// ───────────────────────────────────────────────────────────────────────

// Merge: object IDs 0xCC, 0xCD share this handler.
function initCastleWallDiag(state: DecodeState): void {
  // Zero $A1 (seam-fix autotile flag — read by castle_wall_corner_top_row_probe).
  state.zpA1 = 0;
  // $17 = 1: per-column slope step = grow downward by 1 row per column.
  state.zp17 = 0x0001;
  // ($15 & 1) selects variant: 0 → $CC (left-facing), 1 → $CD (right-facing).
  // Cart: `LDA $15 ; AND #$0001 ; ASL ; TAY ; LDA DATA_castle_wall_diag_stamps,y`.
  const stamp = (state.zp15 & 0x01) !== 0 ? stampCastleWallDiagRight : stampCastleWallDiagLeft;
  // keep_slope preserves the $17 = 1 we just set; trampoline would zero it.
  walkerSetupKeepSlope(state, stamp);
}

// ───────────────────────────────────────────────────────────────────────
// Registration.
// ───────────────────────────────────────────────────────────────────────

export function installCastleWallDiagHandlers(): void {
  // Both $CC and $CD use the same init; the per-cell stamp is picked
  // from $15 inside initCastleWallDiag.
  registerStdObjectHandler(0xCC, initCastleWallDiag);
  registerStdObjectHandler(0xCD, initCastleWallDiag);
}
