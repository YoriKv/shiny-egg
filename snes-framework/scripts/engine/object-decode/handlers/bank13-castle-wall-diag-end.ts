// Bank13 castle-wall-diagonal-end stamp handlers + Bank12 init wrapper.
//
// Standard objects $45 / $46 — the downwards diagonal END of a castle
// wall (two mirror variants: $45 faces right, $46 faces left). Each
// object stamps a 2-column-wide rectangle: the top two rows are a
// diagonal cap pair (DATA_castle_wall_diag_end_diagonal_tiles), the rows below
// are filled with the wall-corner block tile ($00C2) plus left/right/above
// autotile probes shared with object $44 (CODE_init_castle_wall).
//
// The two object IDs differ only by orientation bit $15 & $02:
//   $45 → bit clear → slope = $FFFF (column wraps step LEFT by one)
//   $46 → bit set   → slope = $0001 (column wraps step RIGHT by one)
//
// The orientation bit also picks mirror tiles in
// DATA_castle_wall_diag_end_diagonal_tiles (entries $00C1/$00C0 vs $00BE/$00BF)
// and in the top/mid shadow-overlay tables.
//
// Asm sources:
//   CODE_init_castle_wall_diag_end          Bank12.asm:3567 ($12:96CB)
//   DATA_castle_wall_diag_end_step_signs         Bank12.asm:3603 (DATA_castle_wall_diag_end_step_signs)
//   CODE_stamp_castle_wall_diag_end_diagonal     Bank13.asm:5026 ($13:A553)
//   CODE_castle_wall_diag_end_top_probe          Bank13.asm:5087 ($13:A5BE)
//   CODE_castle_wall_diag_end_mid_probe          Bank13.asm:5134 ($13:A612)
//   DATA_castle_wall_diag_end_diagonal_tiles     Bank13.asm:5079
//   DATA_castle_wall_diag_end_shadow_tiles       Bank13.asm:5083
//   DATA_castle_wall_diag_end_mid_shadow_tiles   Bank13.asm:5130
//   CODE_stamp_castle_wall_corner        Bank13.asm:4856 ($13:A412)
//   DATA_castle_wall_corner_side_handlers      Bank13.asm:4851
//   CODE_castle_wall_corner_left_probe         Bank13.asm:4885
//   CODE_castle_wall_corner_right_probe        Bank13.asm:4897
//   CODE_castle_wall_corner_above_probe        Bank13.asm:4917 ($13:A47E)
//   DATA_castle_wall_corner_above_tiles        Bank13.asm:4913
//   CODE_castle_wall_corner_top_row_probe      Bank13.asm:4980 ($13:A4F8)
//   DATA_castle_wall_corner_top_tiles          Bank13.asm:4976

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerRun } from '../walker.ts';
import { getMap16Above } from '../fetch.ts';
import {
  probeLeftTile,
  readBuf16,
  setProbeToCurrent,
  stampCell,
} from './_shared.ts';
import {
  castleWallCornerAboveProbe,
  castleWallCornerLeftProbe,
  castleWallCornerRightProbe,
  castleWallCornerTopRowProbe,
} from './bank13-castle-wall.ts';

// ─────────────────────────────────────────────────────────────────────
// Tile tables.
// ─────────────────────────────────────────────────────────────────────

/** DATA_castle_wall_diag_end_step_signs — 2-entry step-sign table picked by $15 bit 1.
 *  Cart reads as a WORD via `LDA DATA_castle_wall_diag_end_step_signs,x` with X = $15 & $0002,
 *  so entry 0 = $FFFF (step left), entry 1 (X=2) = $0001 (step right). */
const DATA_castle_wall_diag_end_step_signs: ReadonlyArray<number> = [0xFFFF, 0x0001];

/** DATA_castle_wall_diag_end_diagonal_tiles (Bank13.asm:5079) — 4-entry diagonal-cap tile table.
 *  Indexed by ($15 bit 1) ASL + ($2C bit 0) ASL: variant + row-parity. */
const DATA_castle_wall_diag_end_diagonal_tiles: ReadonlyArray<number> = [
  0x00C1, 0x00C0, 0x00BE, 0x00BF,
];

/** DATA_castle_wall_diag_end_shadow_tiles (Bank13.asm:5083) — 4-entry shadow-overlay tiles for
 *  CODE_castle_wall_diag_end_top_probe. Two pairs; orientation bit picks pair. */
const DATA_castle_wall_diag_end_shadow_tiles: ReadonlyArray<number> = [
  0x77E1, 0x77E6, 0x77DE, 0x77E7,
];

/** DATA_castle_wall_diag_end_mid_shadow_tiles (Bank13.asm:5130) — 2-entry mid-row shadow tiles for
 *  CODE_castle_wall_diag_end_mid_probe. Orientation bit ($15 & $02) picks. */
const DATA_castle_wall_diag_end_mid_shadow_tiles: ReadonlyArray<number> = [
  0x77E8, 0x77E9,
];

// The wall-corner probes shared with object $44 — `castleWallCornerAboveProbe`,
// `castleWallCornerLeftProbe`, `castleWallCornerRightProbe`, `castleWallCornerTopRowProbe`
// + their tile tables `DATA_castle_wall_corner_above_tiles` / `_top_tiles` —
// all live in `bank13-castle-wall.ts` and are imported above.
// `probeLeftTile` is imported from `_shared.ts`.

/** Cart CODE_castle_wall_diag_end_top_probe ($13:A5BE). Returns the shadow-overlay
 *  Map16 ID (or 0 if no match) for the top row of the diagonal cap.
 *
 *  Walks two probes:
 *    1. above-tile vs {$015A,$015B,$0151,$0152} → match → Y=$0000
 *    2. else: left-tile vs same set → match → Y=$0002
 *    3. else: return 0 (no overlay)
 *  Then orientation bit ($15 & $02) toggles Y += $0004, and the result is
 *  DATA_castle_wall_diag_end_shadow_tiles[Y/2]. */
function castleWallDiagEndTopProbe(state: DecodeState): number {
  const matchSet = [0x015A, 0x015B, 0x0151, 0x0152];

  setProbeToCurrent(state);
  const aboveOff = getMap16Above(state);
  const above = readBuf16(state, aboveOff);
  let y = 0;
  let matched = matchSet.includes(above);
  if (!matched) {
    y = 2;
    const left = probeLeftTile(state);
    matched = matchSet.includes(left);
  }
  if (!matched) return 0;
  if ((state.zp15 & 0x02) !== 0) {
    y += 4;
  }
  // Y is 0/2/4/6; divide by 2 for our typed-array index.
  return DATA_castle_wall_diag_end_shadow_tiles[y >>> 1]!;
}

/** Cart CODE_castle_wall_diag_end_mid_probe ($13:A612). Probes the left-tile only;
 *  if it's one of {$015A,$015B,$0151,$0152} returns the orientation-picked
 *  entry from DATA_castle_wall_diag_end_mid_shadow_tiles, else 0. */
function castleWallDiagEndMidProbe(state: DecodeState): number {
  const left = probeLeftTile(state);
  if (left !== 0x015A && left !== 0x015B && left !== 0x0151 && left !== 0x0152) {
    return 0;
  }
  // Cart: LDA $15 ; AND #$0002 ; TAY ; LDA DATA_castle_wall_diag_end_mid_shadow_tiles,y — Y is 0 or 2 (byte
  // index into a 2-entry word table); divide by 2 for the typed-array idx.
  const y = (state.zp15 & 0x02) >>> 1;
  return DATA_castle_wall_diag_end_mid_shadow_tiles[y]!;
}

// `castleWallCornerAboveProbe`, `castleWallCornerTopRowProbe`, `castleWallCornerLeftProbe`,
// `castleWallCornerRightProbe` are imported above from `bank13-castle-wall.ts`
// (object $44 owns the canonical implementation; ~120 LOC of duplicates
// removed from this file).

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_castle_wall_diag_end_diagonal ($13:A553).
//
// Per-cell handler for rows 0 and 1 of the diagonal cap. Picks a base tile
// from DATA_castle_wall_diag_end_diagonal_tiles by orientation+row-parity, then
// dispatches to top-probe (row 0) or mid-probe (row 1). The probe's
// return value (a shadow-overlay tile, or 0 for "no overlay") either
// overrides the cell or — when 0 — runs CODE_castle_wall_corner_above_probe as
// a fallback connector.
//
// Side effect: sets $9B = $0001 (a "non-zero rewound flag" the walker
// uses to take the rewindNibble + $2E-bump path on column wraps).
// ─────────────────────────────────────────────────────────────────────

const stampCastleWallDiagEndDiagonal: PerCellHandler = (state) => {
  // Asm sets $9B = $0001 as a 16-bit store. Walker treats any non-zero
  // $9B as "do nibble rewind", but only $9B with bit 15 set skips the
  // $2E extent bump — $0001 keeps both behaviours active.
  state.rewound = 0x0001;

  // Compose Y = (($15 & 2) << 1) | (($2C & 1) << 1) — both 0/2 shifted
  // into bits 2 and 1. Asm writes the orientation bit << 1 to $00, then
  // ORAs with $2C bit 0 << 1. Result Y ∈ {0,2,4,6} = byte offset into
  // a word table; divide by 2 for typed-array index.
  const orient = (state.zp15 & 0x02) << 1;       // bit 1 → bit 2
  const rowParity = (state.zp2C & 0x01) << 1;    // bit 0 → bit 1
  const yByte = (orient | rowParity) & 0xff;

  // CODE_13A573: BNE skips the "current==$00D6/$00D7/$77D8/$77D9 →
  // suppress base stamp" check. Only when Y == 0 (orient bit 1 clear AND
  // row 0) does the cart consult $12 (current Map16) and skip the stamp
  // if the cell is already one of the shadow-mid tiles. The path that
  // falls through still runs the probe + epilogue.
  let suppressStamp = false;
  if (yByte === 0) {
    const cur = state.zp12 & 0xffff;
    if (cur === 0x00D6 || cur === 0x00D7 || cur === 0x77D8 || cur === 0x77D9) {
      suppressStamp = true;
    }
  }

  if (!suppressStamp) {
    stampCell(state, DATA_castle_wall_diag_end_diagonal_tiles[yByte >>> 1]!);
  }

  // Pick the probe based on row counter:
  //   $2C == 0 → top-probe (row 0)
  //   $2C == 1 (DEC → 0 → BNE not taken) → mid-probe (row 1)
  //   otherwise → CODE_13A5A6 (run only the castle_wall_corner_above_probe)
  const row = state.zp2C & 0xff;
  let overlay: number;
  if (row === 0) {
    overlay = castleWallDiagEndTopProbe(state);
  } else if (row === 1) {
    overlay = castleWallDiagEndMidProbe(state);
  } else {
    // CODE_13A5A6: just run the corner-above probe and exit. (In practice
    // the walker never reaches this branch because $19=$0002 means rows
    // 2+ go to the row handler, not this diagonal-cap stamper.)
    castleWallCornerAboveProbe(state);
    return;
  }

  if (overlay !== 0) {
    // CODE_castle_wall_diag_end_overlay_stamp: overwrite the current cell with the
    // probe's result.
    stampCell(state, overlay);
    return;
  }

  // CODE_13A5A6: probe returned 0 → run the corner-above-probe as the
  // fallback connector for the cell.
  castleWallCornerAboveProbe(state);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_castle_wall_corner ($13:A412).
//
// Per-cell handler for rows 2+ (and shared with object $44's init). Stamps
// base $00C2 unconditionally, then runs:
//   - left-edge probe  (column 0 only) → DATA_castle_wall_corner_side_handlers[0]
//   - right-edge probe (rightmost col) → DATA_castle_wall_corner_side_handlers[1]
//   - above-probe      ($28 == 0)      → CODE_castle_wall_corner_above_probe
//   - top-row probe    ($2C == 0)      → CODE_castle_wall_corner_top_row_probe
//
// The cart uses a CMP-INC pattern to select the side handler:
//   X = 0 if $28 == 0 (left edge)
//   X = 2 if ($28+1) == $2A (right edge)
//   else CODE_13A42B is skipped entirely.
// ─────────────────────────────────────────────────────────────────────

const stampWallCornerBlock: PerCellHandler = (state) => {
  stampCell(state, 0x00C2);

  const col = state.zp28 & 0xff;
  const colExt = state.zp2A & 0xff;

  let sideX = -1; // -1 = no edge probe
  if (col === 0) {
    sideX = 0;
  } else if (((col + 1) & 0xff) === colExt) {
    sideX = 2;
  }

  if (sideX === 0) {
    castleWallCornerLeftProbe(state);
    // CODE_13A431: $28 == 0 → also run above-probe.
    castleWallCornerAboveProbe(state);
  } else if (sideX === 2) {
    castleWallCornerRightProbe(state);
    // $28 != 0 → fall through past above-probe to top-row check.
  } else {
    // No side probe; no above-probe either (above probe gated on $28==0).
  }

  // Top-row autotile probe: only on row 0 of the corner-block portion.
  // The cart checks $2C == 0 here; the walker enters this handler when
  // $2C >= $19 ($2 in our setup), so for our diagonal-end the $2C check
  // never matches and this path is dead. We keep it faithful to the asm
  // since CODE_stamp_castle_wall_corner is shared with object $44.
  if ((state.zp2C & 0xff) === 0) {
    castleWallCornerTopRowProbe(state);
  }
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_castle_wall_diag_end ($12:96CB).
//
// 1. Wire 3 walker slots:
//    - even/odd col + top-of-row handler = stampCastleWallDiagEndDiagonal
//    - row-handler = stampWallCornerBlock
// 2. $19 (row-walk end) = $0002 — first 2 rows go to col handler
//    (diagonal cap), rest go to row handler (corner block).
// 3. $17 (per-row slope) = DATA_castle_wall_diag_end_step_signs[$15 & 2]:
//    $45 → $FFFF (column wraps step LEFT)
//    $46 → $0001 (column wraps step RIGHT)
// 4. $1B row-shift-up: -$10 to the high nibble of the low byte (lift
//    object origin up by one tile row so the cap row appears above the
//    requested anchor).
// 5. $2E += 1 (extend row count to compensate for the upward shift).
// 6. walkerSetupKeepSlope (NOT trampoline — must preserve preset $17).
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x45, 0x46 share this handler.
const initCastleWallDiagEnd: InitHandler = (state) => {
  // $17 (per-row slope): orientation bit picks step direction.
  const stepSignIdx = (state.zp15 & 0x02) >>> 1; // 0 or 1
  state.zp17 = DATA_castle_wall_diag_end_step_signs[stepSignIdx]!;

  // Row-shift-up of $1B: -$10 to the high-nibble-of-low-byte.
  // Asm: PHA / AND #$F0F0 / SEC / SBC #$0010 / AND #$F0F0 / STA $00 /
  // PLA / AND #$0F0F / ORA $00 / STA $1B. Operates on a 16-bit word
  // ($1B/$1C combined); preserve the sub-X/sub-Y nibbles.
  const word1B = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  const subKeep = word1B & 0x0F0F;
  const screenKeep = ((word1B & 0xF0F0) - 0x0010) & 0xF0F0;
  const newWord = (screenKeep | subKeep) & 0xffff;
  state.zp1B = newWord & 0xff;
  state.zp1C = (newWord >>> 8) & 0xff;

  // INC $2E.
  state.zp2E = (state.zp2E + 1) & 0xffff;

  // walkerRun preserves $17 (only walkerSetupTrampoline zeroes it) and
  // lets us set asymmetric col/row handlers + a custom $19 threshold.
  // $19 = $0002 means rows 0/1 go to the col handler (diagonal cap),
  // rows 2+ go to the row handler (corner block).
  walkerRun(
    state,
    /*oddCol*/  stampCastleWallDiagEndDiagonal,
    /*evenCol*/ stampCastleWallDiagEndDiagonal,
    /*row*/     stampWallCornerBlock,
    /*rowsEnd*/ 0x0002,
  );
};

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installCastleWallDiagEndHandlers(): void {
  registerStdObjectHandler(0x45, initCastleWallDiagEnd);
  registerStdObjectHandler(0x46, initCastleWallDiagEnd);
}
