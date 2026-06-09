// Standard object $23 — init_jungle_right_wall.
//
// Cart entry: CODE_init_jungle_right_wall @ $12:9502 (yi/Banks/Bank12.asm:3280).
// Per-cell stamp handler: CODE_jungle_right_wall @ $13:91B4
//   (yi/Banks/Bank13.asm:2275).
// Helper subroutine:
//   CODE_jungle_wall_neighbour_classify @ $13:91F9
//     (yi/Banks/Bank13.asm:2316) — shared with init_jungle_left_wall ($22),
//     init_jungle_mud_wall_lr ($25/$26) and several other Bank13 wall
//     handlers (23 callers total). Inlined here for now; parent will hoist
//     into a shared module once the mirror left-wall handler lands.
//
// Per-object init flow (Bank12.asm:3280-3285):
//   REP #$20 ; INC $2A ; ld walker per-cell handler ; JMP walker_setup_trampoline
// → bumps the column extent by 1 so the walker traverses (extent+1) columns
// (the wall's stamp body lives only in the first column; the extra column
// is the "shoulder" the row==1 case stamps a single $964E into).
//
// Per-cell flow (Bank13.asm:2275-2314):
//   col != 0:
//     row == 1 → stamp $964E (the shoulder seam tile)
//     else     → no stamp (RTL early)
//   col == 0:
//     row < 3  → table-lookup DATA_1391A8 by (row*2), stamp result
//     row >= 3 → PRNG-roll a base picked from {$9062, $9063}; consult
//                jungle_wall_neighbour_classify on the existing $12; if the
//                classifier returns Y != $FFFF, replace the base with
//                DATA_1391AE,y; stamp.
//
// jungle_wall_neighbour_classify probes the cell's existing Map16 ID
// ($12) and returns:
//   Y = 0   if $12 in [$9200, $9204)   — adjacent jungle-floor "anchor"
//   Y = 2   if $12 in [$9080, $9084)   — adjacent jungle-floor row-1 tile
//   Y = 4   if $12 in [$9090, $9094)   — adjacent jungle-floor row-2 tile
//   Y = $FFFF (negative) otherwise     — no neighbour blend, stamp base
//
// Spec for trace at (pageX=3,pageY=3,subX=14,subY=0), height $f confirmed
// all 16 col=0 cells (row table lookups for rows 0/1/2; PRNG body for
// rows 3..15 — all cur_tile=$0000 so classifier returns $FFFF and the
// base $9062/$9063 is stamped). Col=1 cells stamp only at row==1 (= $964E)
// and exit otherwise. Matches our port's branch structure exactly.
//
// asm primary; goldenegg notes consulted only as cross-reference (search
// for "Jungle" / "RightWall" found ys_bgsc1.asm naming JNGL_RIGHT — same
// shape, no contradictions).

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { prngNext } from '../prng.ts';
import { stampCell, jungleWallNeighbourClassify } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_1391A8 — JNGL_RT_DAT, 3 entries.
//   Bank13.asm:2263-2264. Row 0/1/2 stamp tiles for col==0 body.
// DATA_1391AE — JNGL_RT_DAT_SB, 3 entries.
//   Bank13.asm:2266-2267. Neighbour-blend overrides indexed by Y from
//   jungle_wall_neighbour_classify (0, 2, 4 -> these 3 entries).
// ─────────────────────────────────────────────────────────────────────

const DATA_1391A8: ReadonlyArray<number> = [0x9205, 0x3512, 0x909D];
const DATA_1391AE: ReadonlyArray<number> = [0x90A1, 0x90A3, 0x9073];

const SHOULDER_SEAM_TILE = 0x964E; // col != 0, row == 1
const RANDOM_BODY_BASE   = 0x9062; // + (prng & 1) gives $9062 / $9063
const NEIGHBOUR_NONE     = 0xFFFF;

// CODE_jungle_wall_neighbour_classify ($13:91F9, Bank13.asm:2316) is
// hoisted to ./_shared.ts (shared with $22 left wall, $25/$26 mud walls,
// $27/$28 slope45). Returns 0/2/4/$FFFF; caller indexes DATA_1391AE by
// (y >>> 1).

// ─────────────────────────────────────────────────────────────────────
// CODE_jungle_right_wall ($13:91B4, Bank13.asm:2275) — per-cell handler.
// ─────────────────────────────────────────────────────────────────────
const jungleRightWallStamp: PerCellHandler = (state) => {
  const col = state.zp28 & 0xffff;
  const row = state.zp2C & 0xffff;

  // CODE_jungle_right_wall: LDA $28 ; BEQ CODE_1391C6  (col==0 → body).
  if (col !== 0) {
    // col != 0 path.
    //   LDA $2C ; CMP #$0001 ; BNE CODE_1391F6  (only row==1 stamps).
    //   LDA #$964E ; BRA CODE_1391F0 (stamp).
    if (row === 0x0001) {
      stampCell(state, SHOULDER_SEAM_TILE);
    }
    return;
  }

  // col == 0 body (CODE_1391C6).
  //   LDA $2C ; CMP #$0003 ; BCS CODE_jungle_right_wall_random_body.
  if (row < 0x0003) {
    // row 0/1/2 — flat table lookup: ASL ; TAY ; LDA DATA_1391A8,y.
    const tile = DATA_1391A8[row]!;
    stampCell(state, tile);
    return;
  }

  // row >= 3 — random-body path.
  //   JSL CODE_prng ; AND #$0001 ; CLC ; ADC #$9062 ; STA $0A.
  const base = (RANDOM_BODY_BASE + (prngNext(state) & 0x0001)) & 0xffff;

  //   JSR CODE_jungle_wall_neighbour_classify ; TYA ; BMI (Y==$FFFF) skip override.
  const y = jungleWallNeighbourClassify(state);
  if (y === NEIGHBOUR_NONE) {
    stampCell(state, base);
    return;
  }

  //   LDA DATA_1391AE,y (y in word units: 0,2,4 -> entries 0,1,2).
  const override = DATA_1391AE[y >>> 1]!;
  stampCell(state, override);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_jungle_right_wall ($12:9502, Bank12.asm:3280).
//
// REP #$20 ; INC $2A ; (load handler ptr) ; JMP walker_setup_trampoline.
// → bumps col extent by 1 (verified by spec: col_extent 0001 → 0002),
// then standard trampoline (slope=0, all 3 walker slots = stamp handler).
// ─────────────────────────────────────────────────────────────────────
function initJungleRightWall(state: DecodeState): void {
  state.zp2A = (state.zp2A + 1) & 0xffff;
  walkerSetupTrampoline(state, jungleRightWallStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent wires this into object-decode/index.ts alongside
// the rest of the jungle family ($21-$36) as they land.
// ─────────────────────────────────────────────────────────────────────
export function installJungleRightWallHandlers(): void {
  registerStdObjectHandler(0x23, initJungleRightWall);
}
