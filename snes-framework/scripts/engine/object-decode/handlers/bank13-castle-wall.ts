// Bank13 castle-wall (corner-aware block) stamp handler + Bank12 init wrapper.
//
// Standard object $44 — castle_wall ("KABEKADO" / corner-aware wall
// block). Stamps a uniform body of $00C2 across the rectangle, then
// runs three "decorator" passes only on the rectangle's outer edges
// so that the wall's left side, right side, and top row blend with
// whatever neighbour tiles were already stamped:
//
//   - column 0   → castle_wall_corner_left_probe (fix left-neighbour seam)
//   - last col   → castle_wall_corner_right_probe (fix right-neighbour seam)
//   - col 0      → castle_wall_corner_above_probe (rewrite this cell if the
//                                           tile above + tile left
//                                           form a wall-top corner)
//   - row 0      → castle_wall_corner_top_row_probe (rewrite this cell if the
//                                             tile above is a ceiling
//                                             pattern; uses $A1 as a
//                                             1-cell autotile latch)
//
// Asm sources:
//   CODE_init_castle_wall          Bank12.asm:3559  ($12:96BF)
//   CODE_stamp_castle_wall_corner         Bank13.asm:4856  ($13:A412)
//   CODE_castle_wall_corner_left_probe          Bank13.asm:4885  ($13:A443)
//   CODE_castle_wall_corner_right_probe         Bank13.asm:4897  ($13:A45B)
//   CODE_castle_wall_corner_above_probe         Bank13.asm:4917  ($13:A47E)
//   CODE_castle_wall_corner_top_row_probe       Bank13.asm:4980  ($13:A4F8)
//   DATA_castle_wall_corner_side_handlers       Bank13.asm:4852  ($13:A40E)
//   DATA_castle_wall_corner_above_tiles         Bank13.asm:4913  ($13:A478)
//   DATA_castle_wall_corner_top_tiles           Bank13.asm:4976  ($13:A4F0)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { getMap16Above, getMap16Left, getMap16Right } from '../fetch.ts';
import {
  probeLeftTile,
  readBuf16,
  setProbeToCurrent,
  stampCell,
  writeBuf16,
} from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Static data tables.
//
// DATA_castle_wall_corner_above_tiles ($13:A478, Bank13.asm:4913) — 3-entry
// "wall-meets-ceiling" connector pool indexed by Y in
// {0,2,4} from CODE_castle_wall_corner_above_probe:
//   Y = 0  → $00C4 (matches left-tile-is-ceiling branch)
//   Y = 2  → $00C7 (matches "neither" branch)
//   Y = 4  → $00C5 (matches above-tile == $00C5)
//
// DATA_castle_wall_corner_top_tiles ($13:A4F0, Bank13.asm:4976) — 4-entry
// pool indexed by Y in {0,2} for CODE_castle_wall_corner_top_row_probe.
//   Y = 0  → $00C3
//   Y = 2  → $00C6
// Entries 2/3 ($00C6 / $00C7) are reachable only via the autotile
// latch path (LDA $A1 / BNE).
// ─────────────────────────────────────────────────────────────────────

const DATA_castle_wall_corner_above_tiles: ReadonlyArray<number> = [0x00C4, 0x00C5, 0x00C7];
const DATA_castle_wall_corner_top_tiles:   ReadonlyArray<number> = [0x00C3, 0x00C6, 0x00C6, 0x00C7];

const CASTLE_WALL_BASE_TILE = 0x00C2;

// ─────────────────────────────────────────────────────────────────────
// Helpers shared by all three decorator probes.
// ─────────────────────────────────────────────────────────────────────

// `probeLeftTile` (cart `CODE_probe_left_tile` $13:FD54) is imported
// from `_shared.ts`. The shared version composes $0E as the full 16-bit
// `$1B | ($1C << 8)`; the previous local copy only set the low byte of
// $0E, which broke cross-page probes.

/** Range-check used in both "above" probes: returns true if the
 *  supplied Map16 ID is one of the cart's recognised ceiling/wall-top
 *  shapes. Asm uses CMP+BEQ/BCC ladder against $0151, $0152, and the
 *  range $0153..$0160 (BCC #$0161 reads as "< $0161").
 *  Exported for reuse by `bank13-slope-h1.ts` post-process helpers.
 *
 *  Note: this is a SUPERSET of `_shared.ts::isMidSlopeShape`, which
 *  covers only the `[$0153, $0161)` range. The wall-corner family
 *  additionally treats $0151/$0152 (wall-top tiles) as ceilings. */
export function isCeilingShape(tile: number): boolean {
  if (tile === 0x0151 || tile === 0x0152) return true;
  return tile >= 0x0153 && tile < 0x0161;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_castle_wall_corner_left_probe ($13:A443) / CODE_castle_wall_corner_right_probe
// ($13:A45B).
//
// Left-probe path:
//   1. read tile to the left
//   2. if it equals $015A → goto rewrite
//   3. otherwise, if this cell is the *rightmost* column (col+1 == 2A),
//      fall through into the right-probe body (cart fall-through;
//      reproduced here as a single combined routine).
//
// Right-probe path:
//   1. read tile to the right; if not $015B → bail
//   2. rewrite: tile = (((tile - $015A) ^ 1) + $0151) — swaps the low
//      bit so $015A→$0152, $015B→$0153 (cart uses SEC/SBC/EOR/CLC/ADC).
//
// Important: the cart's left-then-right fallthrough is governed by the
// (DATA_castle_wall_corner_side_handlers, X) JSR indirection — X is 0 for
// interior/leftmost, 2 for rightmost, so the rightmost cell jumps
// directly into the right-probe. We model both call sites explicitly.
// ─────────────────────────────────────────────────────────────────────

/** Rewrite an existing left/right neighbour tile that matched $015A or
 *  $015B with the corresponding corner-mate ($0152 or $0153). Asm:
 *  `SEC ; SBC #$015A ; EOR #$0001 ; CLC ; ADC #$0151`. */
function rewriteCornerMate(state: DecodeState, off: number, neighbour: number): void {
  const remapped = (((neighbour - 0x015A) ^ 0x0001) + 0x0151) & 0xffff;
  writeBuf16(state, off, remapped);
}

/** Right-probe body: reads cell to the right, on $015B match rewrites. */
function castleWallCornerRightProbeBody(state: DecodeState): void {
  setProbeToCurrent(state);
  const off = getMap16Right(state);
  const neighbour = readBuf16(state, off);
  if (neighbour !== 0x015B) return;
  rewriteCornerMate(state, off, neighbour);
}

/** Cart CODE_castle_wall_corner_left_probe ($13:A443). Probes left and, if
 *  this cell is also the rightmost column, falls through to the right
 *  probe. */
export function castleWallCornerLeftProbe(state: DecodeState): void {
  setProbeToCurrent(state);
  const leftOff = getMap16Left(state);
  const left = readBuf16(state, leftOff);
  if (left === 0x015A) {
    rewriteCornerMate(state, leftOff, left);
    return;
  }
  // Cart: LDA $28 ; INC ; CMP $2A ; BNE done. Only fall through into
  // the right-probe if this cell *is* the rightmost column — which for
  // a 1-wide object means column 0 is both leftmost and rightmost.
  const col = state.zp28 & 0xff;
  const colExt = state.zp2A & 0xff;
  if (((col + 1) & 0xff) !== colExt) return;
  // Fall through to right-probe — asm sets $0E ← $1B before fall-through.
  castleWallCornerRightProbeBody(state);
}

/** Cart CODE_castle_wall_corner_right_probe ($13:A45B) standalone entry. */
export function castleWallCornerRightProbe(state: DecodeState): void {
  castleWallCornerRightProbeBody(state);
}

// ─────────────────────────────────────────────────────────────────────
// CODE_castle_wall_corner_above_probe ($13:A47E).
//
// Runs only on the leftmost column. Two-stage decision:
//   1. probe LEFT neighbour. If it's a ceiling shape ($0151/$0152 or
//      $0153..$0160) → enter the "ceiling-on-left" branch (Y=0 base):
//        - read tile ABOVE; if also a ceiling shape → write $00D5.
//        - else if above is $00C2 / $77E6 / $77E7 → write $00C4 (Y=0).
//        - else → write $00C7 (Y=2).
//   2. otherwise (left is *not* a ceiling) → enter the "ceiling-on-above"
//      branch (CODE_13A495):
//        - read tile ABOVE; if it equals $00C5 → write $00C5 (Y=4).
//        - else → no-op (cart BNEs to RTS).
//
// We rewrite the current cell (offset = $1D) with the chosen tile.
// ─────────────────────────────────────────────────────────────────────

export function castleWallCornerAboveProbe(state: DecodeState): void {
  const left = probeLeftTile(state);

  if (!isCeilingShape(left)) {
    // CODE_13A495 — "no ceiling on the left" path.
    setProbeToCurrent(state);
    const aboveOff = getMap16Above(state);
    const above = readBuf16(state, aboveOff);
    if (above !== 0x00C5) return;
    // Y = 4 → $00C5.
    stampCell(state, DATA_castle_wall_corner_above_tiles[2]!);
    return;
  }

  // CODE_13A4AB — "ceiling on the left" path.
  setProbeToCurrent(state);
  const aboveOff = getMap16Above(state);
  const above = readBuf16(state, aboveOff);

  // CODE_13A4DF: above is itself a ceiling → write $00D5.
  if (isCeilingShape(above)) {
    stampCell(state, 0x00D5);
    return;
  }

  // CODE_13A4CE: ceiling-on-left + non-ceiling above → discriminate by
  // body-tile signatures. Y = 0 base; CODE_13A4E4 (INY/INY → Y = 2)
  // for "anything else". The cart indexes DATA_castle_wall_corner_above_tiles as a `dw` table
  // with Y in {0,2,4} (asar's `dw` = 2 bytes per entry), so:
  //   Y = 0 → DATA[0] = $00C4
  //   Y = 2 → DATA[1] = $00C5
  if (above === 0x00C2 || above === 0x77E6 || above === 0x77E7) {
    stampCell(state, DATA_castle_wall_corner_above_tiles[0]!);
  } else {
    stampCell(state, DATA_castle_wall_corner_above_tiles[1]!);
  }
}

// ─────────────────────────────────────────────────────────────────────
// CODE_castle_wall_corner_top_row_probe ($13:A4F8).
//
// Runs only on the top row. Reads tile ABOVE, dispatches:
//
//   above is a ceiling shape ($0151/$0152 / $0153..$0160) → CODE_13A521:
//     Y = 2 base.
//     If $A1 != 0 → keep Y = 2.
//     If $A1 == 0 → set $A1 = 6, set Y = 0.
//     Then continue at CODE_13A530.
//
//   above is anything else → CODE_13A518:
//     If $A1 == 0 → RTS (no rewrite).
//     If $A1 != 0 → Y = $A1, $A1 ← 0, continue at CODE_13A530.
//
// CODE_13A530 then:
//   - If Y != 0 → fetch DATA_castle_wall_corner_top_tiles[Y] and stamp current cell.
//   - If Y == 0 →
//       - if current cell is $00D5 → RTS (no rewrite).
//       - else probe LEFT tile; if it equals $00C6 → Y = 2; else fall
//         through (still Y = 0).
//       - Then fetch DATA_castle_wall_corner_top_tiles[Y] and stamp.
//
// Note the use of $A1 as a 1-cell autotile latch — it's nonzero only
// when the previous cell's probe set it to $0006 (carry from
// CODE_13A521 falling into the "Y = 0 first time" path). The
// CODE_init_castle_wall init zeroes $A1 before the walker, so the
// first top-row cell never enters the latched branch.
// ─────────────────────────────────────────────────────────────────────

export function castleWallCornerTopRowProbe(state: DecodeState): void {
  setProbeToCurrent(state);
  const aboveOff = getMap16Above(state);
  const above = readBuf16(state, aboveOff);
  const aboveIsCeiling = isCeilingShape(above);

  let y: number;
  if (aboveIsCeiling) {
    // CODE_13A521.
    if ((state.zpA1 & 0xffff) !== 0) {
      y = 0x0002;
    } else {
      state.zpA1 = 0x0006;
      y = 0x0000;
    }
  } else {
    // CODE_13A518.
    const a1 = state.zpA1 & 0xffff;
    if (a1 === 0) return; // no rewrite
    y = a1;
    state.zpA1 = 0;
  }

  // CODE_13A530.
  if (y === 0) {
    // Y == 0 — check the cell we're about to overwrite + the left
    // neighbour before committing.
    const curOff = state.zp1D & 0x7fff;
    const cur = readBuf16(state, curOff);
    if (cur === 0x00D5) return;
    const left = probeLeftTile(state);
    if (left === 0x00C6) {
      y = 0x0002;
    }
  }

  // CODE_13A549 — stamp DATA_castle_wall_corner_top_tiles[Y/2] at current cell. Y is a byte
  // index into a dw-table; divide by 2 for our number-typed array.
  const tile = DATA_castle_wall_corner_top_tiles[(y >>> 1) & 0x03]!;
  stampCell(state, tile);
}

// ─────────────────────────────────────────────────────────────────────
// Per-cell handler — CODE_stamp_castle_wall_corner ($13:A412).
//
//   1. Stamp $00C2 at the current cell.
//   2. Compute X for the side-handler dispatch (X = 0 for leftmost or
//      interior, X = 2 for rightmost — interior cells skip the side
//      probe entirely).
//   3. col == 0           → left-probe + above-probe + (top-row probe if row 0)
//      col+1 == colExt    → right-probe + (top-row probe if row 0)
//      interior           → (top-row probe if row 0)
//   4. Always run top-row probe on row 0 (asm: LDA $2C ; BNE epilogue
//      ; JSR top_row).
// ─────────────────────────────────────────────────────────────────────

const stampCastleWallCorner: PerCellHandler = (state) => {
  stampCell(state, CASTLE_WALL_BASE_TILE);

  const col = state.zp28 & 0xff;
  const colExt = state.zp2A & 0xff;
  const row = state.zp2C & 0xffff;

  // Asm: LDX #$0000 ; LDA $28 ; BEQ side_probe (X=0 = left).
  //      Otherwise INC, CMP $2A; BNE skip_side; INX/INX (X=2 = right).
  let runSide: 'left' | 'right' | 'none';
  if (col === 0) {
    runSide = 'left';
  } else if (((col + 1) & 0xff) === colExt) {
    runSide = 'right';
  } else {
    runSide = 'none';
  }

  if (runSide === 'left') {
    castleWallCornerLeftProbe(state);
    // Asm: after side probe, "LDA $28 ; BNE top_row" — col == 0
    // continues into castle_wall_corner_above_probe.
    castleWallCornerAboveProbe(state);
  } else if (runSide === 'right') {
    castleWallCornerRightProbe(state);
  }

  // Top-row probe runs on row 0 regardless of column.
  if (row === 0) {
    castleWallCornerTopRowProbe(state);
  }
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_castle_wall ($12:96BF, Bank12.asm:3559).
//
//   REP #$20
//   STZ $A1                       ; clear autotile latch
//   LDX #(CODE_stamp_castle_wall_corner-1)>>16
//   LDA #CODE_stamp_castle_wall_corner-1
//   JMP walker_setup_trampoline
//
// Identical to a plain trampoline init except for the $A1=0 prelude.
// ─────────────────────────────────────────────────────────────────────

function initCastleWall(state: DecodeState): void {
  state.zpA1 = 0;
  walkerSetupTrampoline(state, stampCastleWallCorner);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installCastleWallHandlers(): void {
  registerStdObjectHandler(0x44, initCastleWall);
}
