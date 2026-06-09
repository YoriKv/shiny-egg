// Bank13 wall-block-random stamp handler + Bank12 init wrapper.
//
// Standard object $47 — lava_castle ("random-fill wall block").
// Top-row cells stamp either a PRNG-picked tile from an 8-entry pool
// (offset by +5 in the base case) OR — when the cell directly above
// matches one of three wall-cap continuations ($00C2/$00C5/$00C4) —
// stamp a deterministic "wall continues downward" pair: the cap above
// is rewritten to $002E/$002F/$0030, and the current cell becomes
// either a raw pool tile ($00C2 path) or $0031 ($00C5/$00C4 path).
//
// Non-top-row cells alternate between $7E00/$7E01 based on column
// parity. The leftmost / rightmost columns invoke side-merge probes
// (CODE_wall_random_left_probe / CODE_wall_random_right_probe), and the
// bottom row invokes CODE_wall_random_below_probe — each probes the
// neighbour against a shared 4-entry match table (DATA_wall_random_neighbour_match) and on a
// hit rewrites the neighbour with the matching entry from a per-edge
// remap table (DATA_wall_random_left_tiles / DATA_wall_random_right_tiles / DATA_wall_random_below_tiles).
//
// Asm sources:
//   CODE_init_lava_castle      Bank12.asm:3607  ($12:9716)
//   CODE_stamp_lava_castle     Bank13.asm:5166  ($13:A64C)
//   CODE_wall_random_left_probe      Bank13.asm:5245  ($13:A6DE)
//   CODE_wall_random_right_probe     Bank13.asm:5266  ($13:A701)
//   CODE_wall_random_below_probe     Bank13.asm:5287  ($13:A724)
//   DATA_wall_random_top_tiles       Bank13.asm:5157  ($13:A638)
//   DATA_wall_random_side_handlers   Bank13.asm:5161  ($13:A648)
//   DATA_wall_random_left_tiles      Bank13.asm:5237  ($13:A6CE)
//   DATA_wall_random_neighbour_match Bank13.asm:5241  ($13:A6D6)
//   DATA_wall_random_right_tiles     Bank13.asm:5262  ($13:A6F9)
//   DATA_wall_random_below_tiles     Bank13.asm:5283  ($13:A71C)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { getMap16Above, getMap16Below, getMap16Left, getMap16Right } from '../fetch.ts';
import { prngNext } from '../prng.ts';
import { readBuf16, setProbeToCurrent, stampCell, writeBuf16 } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_wall_random_top_tiles (Bank13.asm:5157).
//
// 8-entry PRNG-weighted random pool for top-row cells. The PRNG result
// is masked with #$000E (effectively prng >> 1 & 7 in word form) so all
// 8 entries are reachable. Duplicates skew the distribution toward
// $0084 (2/8) and $0086 (2/8); $0085 also appears twice.
//
// In the base "no continuation" branch, the result is added to $00=$0005
// → final IDs are $0089-$008D ($008D is $0088+$0005), matching the spec.
// In the "$00C2 continuation" branch, $00 is zeroed → final IDs stay in
// the raw $0084-$0088 range.
// ─────────────────────────────────────────────────────────────────────

const DATA_wall_random_top_tiles: ReadonlyArray<number> = [
  0x0084, 0x0085, 0x0085, 0x0086, 0x0084, 0x0086, 0x0087, 0x0088,
];

// ─────────────────────────────────────────────────────────────────────
// Neighbour-probe match + remap tables.
//
// DATA_wall_random_neighbour_match — 4-entry match list, shared across all three probes
//   (left / right / below). Looks for wall-cap edge tiles in the
//   adjacent cell.
// DATA_wall_random_left_tiles — left-neighbour remap (overwrites the cell on the left).
// DATA_wall_random_right_tiles — right-neighbour remap (overwrites the cell on the right).
// DATA_wall_random_below_tiles — below-neighbour remap (overwrites the cell below).
//
// Match miss is a no-op — the asm falls past the STA at CODE_13A748.
// ─────────────────────────────────────────────────────────────────────

const DATA_wall_random_neighbour_match: ReadonlyArray<number> = [
  0x015A, 0x015B, 0x0151, 0x0152,
];
const DATA_wall_random_left_tiles: ReadonlyArray<number> = [
  0x01A3, 0x01A1, 0x01A3, 0x01A3,
];
const DATA_wall_random_right_tiles: ReadonlyArray<number> = [
  0x01A2, 0x01A4, 0x01A4, 0x01A4,
];
const DATA_wall_random_below_tiles: ReadonlyArray<number> = [
  0x01A5, 0x01A6, 0x01A5, 0x01A6,
];

// ─────────────────────────────────────────────────────────────────────
// Probe helpers — each mirrors a small neighbour-fix routine.
//
// Pattern (matches wall_h_block's probeAndRemap):
//   1. set $0E/$0F = $1B/$1C (probe coord = walker's current cell)
//   2. compute the neighbour buffer offset via get_map16_<dir>
//   3. read the existing Map16 ID
//   4. linear-search the match table
//   5. on hit, overwrite the neighbour with the matching remap entry
// ─────────────────────────────────────────────────────────────────────

function probeAndRemap(
  state: DecodeState,
  off: number,
  matchTable: ReadonlyArray<number>,
  remapTable: ReadonlyArray<number>,
): void {
  const cur = readBuf16(state, off);
  const idx = matchTable.indexOf(cur);
  if (idx < 0) return;
  writeBuf16(state, off, remapTable[idx]!);
}

/** Cart CODE_wall_random_left_probe ($13:A6DE).
 *
 *  Note: unlike the below/right probes, the asm at $13:A6DE does NOT
 *  re-set $0E/$0F before calling get_map16_left. Instead, the dispatch
 *  site at CODE_13A6B7 does `LDA $1B ; STA $0E` once before the indirect
 *  jump through DATA_wall_random_side_handlers — so probe coord is current at entry. */
function wallRandomLeftProbe(state: DecodeState): void {
  const off = getMap16Left(state);
  probeAndRemap(state, off, DATA_wall_random_neighbour_match, DATA_wall_random_left_tiles);
}

/** Cart CODE_wall_random_right_probe ($13:A701). Same as the left probe
 *  re: probe coord — dispatch-site sets $0E before the indirect jump. */
function wallRandomRightProbe(state: DecodeState): void {
  const off = getMap16Right(state);
  probeAndRemap(state, off, DATA_wall_random_neighbour_match, DATA_wall_random_right_tiles);
}

/** Cart CODE_wall_random_below_probe ($13:A724). Self-contained: starts
 *  with `LDA $1B ; STA $0E` so it works correctly regardless of caller. */
function wallRandomBelowProbe(state: DecodeState): void {
  setProbeToCurrent(state);
  const off = getMap16Below(state);
  probeAndRemap(state, off, DATA_wall_random_neighbour_match, DATA_wall_random_below_tiles);
}

// ─────────────────────────────────────────────────────────────────────
// DATA_wall_random_side_handlers (Bank13.asm:5161).
//
// 2-entry indirect-jump table used at CODE_13A6B7:
//   X = 0  → CODE_wall_random_left_probe   (leftmost column)
//   X = 2  → CODE_wall_random_right_probe  (rightmost column)
// ─────────────────────────────────────────────────────────────────────

const DATA_wall_random_side_handlers: ReadonlyArray<(s: DecodeState) => void> = [
  wallRandomLeftProbe,
  wallRandomRightProbe,
];

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_lava_castle ($13:A64C).
//
// Top row ($2C == 0):
//   1. Read tile-above (set $0E=$1B, JSL get_map16_above).
//   2. If tile-above is $00C2 (Y=0), $00C5 (Y=1), or $00C4 (Y=2):
//      - Rewrite tile-above with $002E + Y (continuation cap).
//      - $00C2 path: zero $00, fall through to PRNG pool branch with
//        zero offset → pool tile lands at the *current* cell.
//      - $00C5/$00C4 paths: stamp $0031 at the current cell.
//   3. Else (no match): stamp PRNG-pool tile + $0005 at current cell.
//
// Non-top rows ($2C != 0): stamp $7E00 (even col) or $7E01 (odd col).
//
// Side dispatch (CODE_13A6B7 via indirect-JSR through DATA_wall_random_side_handlers):
//   - col 0       → left probe
//   - col+1 == 2A → right probe (rightmost)
//   - else        → no side probe
//
// Bottom row ($2C + 1 == $2E): unconditional below probe.
//
// Note: the cell-above stamp in the match branch uses the X returned by
// CODE_get_map16_above (offset of the cell above current). We thread
// that explicitly via writeBuf16(state, aboveOff, …) since stampCell
// always writes to $1D (current cell).
// ─────────────────────────────────────────────────────────────────────

const lavaCastleStamp: PerCellHandler = (state) => {
  const row = state.zp2C & 0xff;
  let stampValue: number;

  if (row !== 0) {
    // Non-top rows: alternate $7E00 / $7E01 by column parity.
    stampValue = (0x7E00 + (state.zp28 & 0x0001)) & 0xffff;
  } else {
    // Top row: probe the cell above against $00C2/$00C5/$00C4.
    setProbeToCurrent(state);
    const aboveOff = getMap16Above(state);
    const aboveTile = readBuf16(state, aboveOff);

    let pickOffset = 0x0005; // $00 default
    let matchY = -1;
    if (aboveTile === 0x00C2) matchY = 0;
    else if (aboveTile === 0x00C5) matchY = 1;
    else if (aboveTile === 0x00C4) matchY = 2;

    if (matchY >= 0) {
      // Continuation cap: overwrite the cell above with $002E + Y.
      writeBuf16(state, aboveOff, (0x002E + matchY) & 0xffff);
      pickOffset = 0;
      if (matchY !== 0) {
        // $00C5 / $00C4: stamp $0031 at current cell, skip PRNG pool.
        stampValue = 0x0031;
        stampCell(state, stampValue);
        runSideAndBelowProbes(state);
        return;
      }
      // $00C2: fall through to PRNG pool with offset 0.
    }

    // PRNG pool pick (with $0005 or 0 offset).
    const y = prngNext(state) & 0x000E;
    const idx = y >>> 1;
    stampValue = (DATA_wall_random_top_tiles[idx]! + pickOffset) & 0xffff;
  }

  stampCell(state, stampValue);
  runSideAndBelowProbes(state);
};

// ─────────────────────────────────────────────────────────────────────
// Side + below probe dispatch.
//
// Asm: after the current cell is stamped at CODE_13A6A3:
//   LDX #$0000
//   LDA $28
//   BEQ CODE_13A6B7        ; col==0 → X=0 (left handler)
//   INX INX                ; X=2
//   INC                    ; A=col+1
//   CMP $2A
//   BNE CODE_13A6C1        ; not rightmost → skip side probe
//   ; fall through with X=2 (right handler)
// CODE_13A6B7:
//   LDA $1B / STA $0E       ; reset probe coord (used by both side probes)
//   LDY #$0000
//   JSR (DATA_wall_random_side_handlers,x)    ; indirect through 2-entry pointer table
// CODE_13A6C1:
//   LDA $2C / INC / CMP $2E
//   BNE epilogue
//   JSR CODE_wall_random_below_probe        ; below probe (bottom row only)
//
// The leftmost cell of a 1-wide column ($28=0, $2A=1) takes the BEQ
// branch and runs only the left probe. ✓
// ─────────────────────────────────────────────────────────────────────

function runSideAndBelowProbes(state: DecodeState): void {
  const col = state.zp28 & 0xff;
  const colExt = state.zp2A & 0xff;
  const rowExt = state.zp2E & 0xff;

  let sideIdx = -1;
  if (col === 0) sideIdx = 0;
  else if (((col + 1) & 0xff) === colExt) sideIdx = 1;

  if (sideIdx >= 0) {
    setProbeToCurrent(state);
    DATA_wall_random_side_handlers[sideIdx]!(state);
  }

  if ((((state.zp2C & 0xff) + 1) & 0xff) === rowExt) {
    wallRandomBelowProbe(state);
  }
}

// ─────────────────────────────────────────────────────────────────────
// CODE_init_lava_castle ($12:9716).
//
//   LDX #(CODE_stamp_lava_castle-$01)>>16
//   LDA #CODE_stamp_lava_castle-$01
//   JMP walker_setup_trampoline
//
// Plain trampoline init — same per-cell handler in every walker slot
// (even-col, odd-col, row). No DP mutations (spec confirms 5 walker
// fields unchanged from entry to walker time).
// ─────────────────────────────────────────────────────────────────────

function initLavaCastle(state: DecodeState): void {
  walkerSetupTrampoline(state, lavaCastleStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installLavaCastleHandlers(): void {
  registerStdObjectHandler(0x47, initLavaCastle);
}
