// Standard object $22 — init_jungle_left_wall.
//
// Cart entry: CODE_init_jungle_left_wall @ $12:94F6 (yi/Banks/Bank12.asm:3272).
// Per-cell stamp handler: CODE_jungle_left_wall @ $13:9165 (yi/Banks/Bank13.asm:2223).
// Helper sub-routine:
//   CODE_jungle_wall_neighbour_classify @ $13:91F9 (Bank13.asm:2316).
//
// World-1 "jungle left-edge wall": a 2-column-wide stripe whose column 0
// is mostly blank (except for one tip tile at row 1) and whose column 1
// is a 9-row vertical wall. Rows 0..2 of column 1 are deterministic from
// a 3-entry table (DATA_139159), rows 3+ pick between two base tiles
// $909E/$909F via PRNG and (when the existing $12 says we're already
// abutting another jungle tile family) optionally swap in a join tile
// from DATA_13915F based on the neighbour-classify helper.
//
// The init just bumps $2A from 1 to 2 (extra column for the wall tip)
// and tail-calls the walker trampoline; slope is 0; all 3 handler slots
// receive CODE_jungle_left_wall.
//
// Sibling-family consolidation: $23 (right wall) is the mirror image
// with its own tile-table pair (DATA_1391A8 / DATA_1391AE). The neighbour-
// classify helper CODE_jungle_wall_neighbour_classify is shared between
// left/right wall + mud variants and is a clear consolidation candidate
// once the rest of the family lands.
//
// asm primary; trace harness output cross-checked against the random-body
// branch ($A_low values $54/$85/$EA/$88/$B2/$90 → $909E/$909F/$909E/...).

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { prngNext, RNG_SITE } from '../prng.ts';
import { stampCell, jungleWallNeighbourClassify } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Stamp-handler tile tables (Bank13.asm:2208-2212).
//
//   DATA_139159 (= JNGL_LT_DAT, 3 entries): per-row deterministic tiles
//     for column 1, rows 0..2. Indexed by Y = row*2.
//     Row 0 → $9204, Row 1 → $330D, Row 2 → $909C.
//
//   DATA_13915F (= JNGL_LT_DAT_SB, 3 entries): "side-bound" join tiles
//     selected by CODE_jungle_wall_neighbour_classify when the existing
//     cell ($12) sits in one of the jungle-floor / jungle-wall neighbour
//     pages. Indexed by Y = 0/2/4.
//     Y=0 → $90A0, Y=2 → $90A2, Y=4 → $9072.
// ─────────────────────────────────────────────────────────────────────

const DATA_139159 = [0x9204, 0x330D, 0x909C] as const;
const DATA_13915F = [0x90A0, 0x90A2, 0x9072] as const;

// The fixed "wall tip" tile stamped at (col=0, row=1) only.
const JUNGLE_LEFT_WALL_TIP = 0x964D;

// Base tiles for the row-3+ random body. PRNG low bit picks between them.
const JUNGLE_WALL_BODY_BASE = 0x909E; // & 0 → $909E, & 1 → $909F

const NEIGHBOUR_CLASSIFY_NONE = 0xFFFF;

// CODE_jungle_wall_neighbour_classify ($13:91F9, Bank13.asm:2316) is
// hoisted to ./_shared.ts (shared with $23 right wall, $25/$26 mud walls,
// $27/$28 slope45). It returns 0/2/4/$FFFF; we index DATA_13915F by
// (y >>> 1).

// ─────────────────────────────────────────────────────────────────────
// CODE_jungle_left_wall ($13:9165, Bank13.asm:2223) — per-cell handler.
//
// Dispatch by column ($28) then row ($2C):
//
//   col == 0:  only row 1 stamps anything; stamp the tip $964D, all
//              other rows return without stamping (leaves the previous
//              cell tile alone — typically zero for a fresh buffer).
//
//   col != 0 (the wall column):
//     row 0..2: ASL row, TAY, LDA DATA_139159,y → stamp.
//     row 3+:   call PRNG, AND #$0001, ADC #$909E → base in $909E/$909F.
//               Call jungleWallNeighbourClassify; if Y != $FFFF, replace
//               the base with DATA_13915F[Y/2]. Stamp result.
//
// Stamp is unconditional in the col-1 branches — even if the
// neighbour-classify returned an override, we stamp the override; if it
// returned $FFFF, we stamp the random base.
// ─────────────────────────────────────────────────────────────────────
const jungleLeftWallStamp: PerCellHandler = (state) => {
  const col = state.zp28 & 0xff;
  const row = state.zp2C & 0xffff;

  if (col === 0) {
    // Only row 1 stamps. Bank13.asm:2226-2232.
    if (row === 0x0001) {
      stampCell(state, JUNGLE_LEFT_WALL_TIP);
    }
    return;
  }

  // CODE_139177 (Bank13.asm:2234): col != 0 — the wall column.
  if (row < 0x0003) {
    // Rows 0..2: deterministic per-row table.
    stampCell(state, DATA_139159[row & 0xff]!);
    return;
  }

  // Rows 3+: random body with optional neighbour-override.
  // Cart pattern: JSL prng ; AND #$0001 ; CLC ; ADC #$909E (CLC present → carry 0).
  // Tagged for per-site replay — aligns exactly for fully-on-screen walls; see the
  // RNG_SITE.jungleLeftWallBody note re: off-screen rows / contaminated sub-rooms.
  const rand = prngNext(state, RNG_SITE.jungleLeftWallBody) & 0x01;
  let stamp = (JUNGLE_WALL_BODY_BASE + rand) & 0xffff;

  const y = jungleWallNeighbourClassify(state);
  if (y !== NEIGHBOUR_CLASSIFY_NONE) {
    stamp = DATA_13915F[y >>> 1]!;
  }

  stampCell(state, stamp);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_jungle_left_wall ($12:94F6, Bank12.asm:3272).
//
// REP #$20 ; INC $2A — bump the column extent by 1 so the parser-supplied
// width=1 becomes width=2 (col 0 = tip column, col 1 = wall body), then
// tail into the walker trampoline with CODE_jungle_left_wall as the
// per-cell handler. Slope = 0; all 3 handler slots receive the same fn.
// ─────────────────────────────────────────────────────────────────────
const initJungleLeftWall: InitHandler = (state) => {
  state.zp2A = (state.zp2A + 1) & 0xffff;
  walkerSetupTrampoline(state, jungleLeftWallStamp);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent wires this into object-decode/index.ts alongside
// the rest of the jungle family ($22-$36).
// ─────────────────────────────────────────────────────────────────────
export function installJungleLeftWallHandlers(): void {
  registerStdObjectHandler(0x22, initJungleLeftWall);
}
