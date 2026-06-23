// Bank13 floor-edge + vertical-wall handlers — std objects $02/$03/$0A/$0B.
//
// All four IDs share `CODE_init_floor_edge_or_wall` ($12:9217) which is a
// 4-variant dispatcher keyed on orientation byte $15. The init parses three
// parallel 10-entry tables (one bank byte, one low-word, one extent word
// each) — `DATA_floor_edge_or_wall_stamp_banks`, `_stamp_ptrs`,
// `_extents` — to wire the per-cell handlers + walker geometry:
//
//   $15  | left/right | object semantics             | stamp handler
//   ─────┼────────────┼──────────────────────────────┼───────────────────────
//   $02  | left edge  | floor LEFT vertical strip    | CODE_floor_edge_left_right
//   $03  | right edge | floor RIGHT vertical strip   | CODE_floor_edge_left_right
//   $0A  | left wall  | vertical wall LEFT face      | CODE_wall_left_right
//   $0B  | right wall | vertical wall RIGHT face     | CODE_wall_left_right
//
// Independent of $15, the row-end (`$25/$27`) handler is always
// `CODE_floor_edge_random_side` — i.e. once the walker passes the
// init-set $19 row threshold ($02/$03: 3, $0A/$0B: 1), all remaining
// cells fall into the random-side variant picker. That's why the spec
// traces show:
//
//   $02/$03: row 0..2 → CODE_floor_edge_left_right,
//            row 3..N → CODE_floor_edge_random_side
//   $0A/$0B: row 0    → CODE_wall_left_right,
//            row 1..N → CODE_floor_edge_random_side
//
// Init also mutates $1B / $2A / $2E for the floor-edge variants ($02/$03)
// per the cart: shift origin up 1 row, INC col extent, INC row extent,
// and for $03 specifically ($15 bit 0 set + CPX #$0006 BCS-not-taken)
// also decrement sub-X and stash the original $2E into $A1 (later used
// by `CODE_floor_edge_left_right` to "restore" $2E when at (col, row)=
// (last, 0) — a width-extension special case). Walls ($0A/$0B) skip the
// $1B/extent mutation entirely (the `CPX #$0008 BCS CODE_129280` early
// branch).
//
// Friendly cart symbols adopted (see yi/Banks/Bank12.asm + Bank13.asm
// and yi-shiny/scripts/rename-log.tsv):
//   CODE_init_floor_edge_or_wall ($12:9217)
//   CODE_floor_edge_left_right    ($13:81CB) — stamp handler ($02/$03)
//   CODE_floor_edge_random_side   ($13:8231) — row-end stamp (all 4)
//   CODE_wall_left_right          ($13:8413) — stamp handler ($0A/$0B)
//   CODE_bg_floor_random_probe_exit ($13:81CA) — handler-pointer anchor
//                                                 (= handler-1 for the
//                                                 walker's PHA/RTL idiom)
//   DATA_floor_edge_or_wall_stamp_ptrs ($12:9290)
//   DATA_floor_edge_or_wall_extents    ($12:92A4)
//   DATA_floor_edge_lr_tile_lut                  — CODE_floor_edge_left_right tile/slot table
//   DATA_floor_edge_random_side_pool                  — CODE_floor_edge_random_side variant pool
//   DATA_wall_left_right_tiles ($13:842C) — wall tile slots

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerRun } from '../walker.ts';
import { TT } from '../template-slots.ts';
import { getMap16Above, getMap16Below } from '../fetch.ts';
import { prngNext, RNG_SITE } from '../prng.ts';
import {
  stampCell,
  readBuf16,
  writeBuf16,
  setProbeToCurrent,
  probeLeftTile,
  probeRightTile,
} from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_floor_edge_lr_tile_lut — CODE_floor_edge_left_right tile/slot table (Bank13.asm:489)
//
//   dw $1D12, FloorRow0_RightLo, FloorRow0_RightLo, $1D14,
//      $1D16, $1CD0, $1CD2, $1D18
//   dw $0000, FlatFloor_NoSeamCheckA, FlatFloor_NoSeamCheckB,
//      FlatFloor_NoSeamAnchorA, FlatFloor_NoSeamAnchorB
//
// Entries 0..7 = primary lookup (indexed by Y = key * 2 where
//   key = (orient&1)*2 + col + row*4, evaluated for rows 0..1 of a
//   width-2 floor edge — so key ∈ {0..7} → Y ∈ {0,2,4,...,14}).
// Entries 8..12 = "self-check overlap" tail at Y=16..24, only entered
//   when row >= 2 (Y >= 16): entry 8 = $0000 (skip-stamp marker), entries
//   9..12 form a 4-cell window that the floor-overlap probe walks via
//   the `INY*4` bump path when $12 matches FloorRow0_Lo/Right.
//
// The unnamed `$1D12 / $1D14 / $1D16 / $1D18 / $1CD0 / $1CD2` slot
// addresses don't have canonical `TT.*` names — they're per-tileset
// floor-edge alt templates the cart's CODE_init_per_tileset_template_slots
// (init_per_tileset_template_slots) writes via the indirect-store
// pattern (`LDA ptr ; TAY ; STA [find],y` — invisible to the
// codegraph; see the asm-analysis skill's "indirect stores" note).
// ─────────────────────────────────────────────────────────────────────

const SLOT_1D12 = 0x001D12;
const SLOT_1D14 = 0x001D14;
const SLOT_1D16 = 0x001D16;
const SLOT_1D18 = 0x001D18;
const SLOT_1CD0 = 0x001CD0;
const SLOT_1CD2 = 0x001CD2;

const DATA_floor_edge_lr_tile_lut = [
  SLOT_1D12,                  // [0] (row 0, col 0, orient 0) — left-edge top
  TT.FloorRow0_RightLo,       // [1] (row 0, col 0, orient 1) — right-edge top
  TT.FloorRow0_RightLo,       // [2] (row 0, col 1, orient 0) — left-edge top (col 1 = far edge)
  SLOT_1D14,                  // [3] (row 0, col 1, orient 1) — right-edge top
  SLOT_1D16,                  // [4] (row 1, col 0, orient 0) — left-edge mid
  SLOT_1CD0,                  // [5] (row 1, col 0, orient 1) — right-edge mid
  SLOT_1CD2,                  // [6] (row 1, col 1, orient 0) — left-edge mid (col 1)
  SLOT_1D18,                  // [7] (row 1, col 1, orient 1) — right-edge mid
  // overlap-tail entries Y=16..24 (only read when row >= 2 via INY*4 bump):
  0x0000,                     // [8]  — skip-stamp marker
  TT.FlatFloor_NoSeamCheckA,  // [9]
  TT.FlatFloor_NoSeamCheckB,  // [10]
  TT.FlatFloor_NoSeamAnchorA, // [11]
  TT.FlatFloor_NoSeamAnchorB, // [12]
] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_floor_edge_left_right ($13:81CB)
//
// Cart asm:
//   REP #$30
//   LDA $28 ; INC ; CMP $2A ; BNE skip_a1_restore
//   LDA $2C ; BNE skip_a1_restore
//   LDA $A1 ; STA $2E              ; (col==max-1 && row==0): restore $2E from $A1
// skip_a1_restore:
//   key = ($15 & 1) * 2 | $28
//   Y = (key | $2C << 2) * 2       ; final shift to byte-index
//   X = DATA_floor_edge_lr_tile_lut[Y]
//   BEQ done                       ; X == 0 → skip stamp (overlap-marker $0000)
//   CPY #$0010 ; BCC stamp         ; Y < 16 → use slot as-is
//   ; Y >= 16 (overlap mode): self-check $12 vs FloorRow0 templates.
//   ; If $12 ∈ {FloorRow0_LeftLo, FloorRow0_RightLo}: Y += 4 then re-read.
//   if $12 == FloorRow0_LeftLo OR $12 == FloorRow0_RightLo:
//     Y += 4
//     X = DATA_floor_edge_lr_tile_lut[Y]
//   stamp DATA_floor_edge_lr_tile_lut[X] (X is the slot; deref via templateAt)
//
// The "Y += 4" is asm `INY * 4` — 4 BYTE increments = 2 word-entries
// (table is `dw`). So overlap-mode picks entries shifted by 2 (e.g.
// {entry 10, 11, 12} from base {8, 9, 10}) when the cell-under-cursor
// is already part of a flat-floor row-0 (FloorRow0_*).
// ─────────────────────────────────────────────────────────────────────

const floorEdgeLeftRight: PerCellHandler = (state) => {
  // Width-extension restore: at (col == max-1, row == 0), restore $2E
  // from $A1 (init stashed original $2E there for $03's single-column
  // case; for $02's regular width-2 case $A1 was set to $0002 = same
  // as the new $2E, so the restore is a no-op).
  if (((state.zp28 + 1) & 0xff) === state.zp2A && state.zp2C === 0) {
    state.zp2E = state.zpA1 & 0xffff;
  }

  const orientBit = state.zp15 & 0x01;
  const col = state.zp28 & 0x01;            // signed col counter & 1 (cart key uses col parity)
  const row = state.zp2C & 0xff;
  // Cart builds the key as (orient<<1 | col) | (row<<2), then doubles
  // for word-byte stride; we use it directly as a word-array index.
  const tableIdx = ((orientBit << 1) | col) | (row << 2);

  if (tableIdx >= DATA_floor_edge_lr_tile_lut.length) return; // out-of-range: no stamp
  let slotAddr = DATA_floor_edge_lr_tile_lut[tableIdx]!;
  if (slotAddr === 0x0000) return; // entry 8 = skip-stamp marker

  if (tableIdx >= 8) {
    // Overlap-mode self-check. Cart's `INY * 4` = +4 BYTES = +2 word
    // entries (table is dw). $12 == FloorRow0_Lo/Right → bump idx by 2.
    const cur = state.zp12 & 0xffff;
    if (
      cur === state.templateAt(TT.FloorRow0_LeftLo) ||
      cur === state.templateAt(TT.FloorRow0_RightLo)
    ) {
      const bumped = tableIdx + 2;
      if (bumped < DATA_floor_edge_lr_tile_lut.length) slotAddr = DATA_floor_edge_lr_tile_lut[bumped]!;
    }
  }

  stampCell(state, state.templateAt(slotAddr));
};

// ─────────────────────────────────────────────────────────────────────
// DATA_floor_edge_random_side_pool — CODE_floor_edge_random_side variant pool (Bank13.asm:561)
//
//   dw $1CD8, $1CDC, $1CE0, $1CD8,    ; orient bit 0 = 0 (left-edge)
//      $1CDA, $1CDE, $1CE2, $1CDA     ; orient bit 0 = 1 (right-edge)
//
// Indexed by Y = (($15 & 1) * 4 | (prng & 3)) * 2 — 4-entry pool per
// side, picked uniformly via PRNG low 2 bits. Pool slot addresses
// $1CD8..$1CE2 are within the flat-floor template family ($1C92+)
// but have no canonical TT.* names (per-tileset row-3 alts).
// ─────────────────────────────────────────────────────────────────────

const SLOT_1CD8 = 0x001CD8;
const SLOT_1CDA = 0x001CDA;
const SLOT_1CDC = 0x001CDC;
const SLOT_1CDE = 0x001CDE;
const SLOT_1CE0 = 0x001CE0;
const SLOT_1CE2 = 0x001CE2;
// $1CE4 is the "pick_anchor" base ($15 & 1 indexed for FloorRow0
// fallback continuation tile).
const SLOT_1CE4 = 0x001CE4;
// $1CC2 / $1CC4 — below-cap tile slots written by the seam helper.
// $1CC2 stamped under a right-edge ($03) seam-fixed cell (left-facing
// cap to round into terrain on the right edge's left flank).
// $1CC4 stamped under a left-edge ($02) seam-fixed cell (mirror).
const SLOT_1CC2 = 0x001CC2;
const SLOT_1CC4 = 0x001CC4;

const DATA_floor_edge_random_side_pool = [
  SLOT_1CD8, SLOT_1CDC, SLOT_1CE0, SLOT_1CD8, // left-edge variants 0..3
  SLOT_1CDA, SLOT_1CDE, SLOT_1CE2, SLOT_1CDA, // right-edge variants 0..3
] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_floor_edge_random_side_seam ($13:82B8) — neighbour-modifier helper
// invoked from `floorEdgeRandomSide` branch 2. Only called from that one
// site in the cart (codegraph: 4 callers, all internal to random_side).
//
// $0A (= $15 & 1) selects the side:
//   $0A == 0 (left-edge $02):  probe RIGHT, write *$1CC4 to BELOW, return
//                              SlopeCapRightLo as new pickVarSlot
//                              (or RndProbeAnchorR if right == RndAdjMatch
//                              — no below write in that case).
//   $0A != 0 (right-edge $03): probe LEFT,  write *$1CC2 to BELOW, return
//                              SlopeCapLeftLo (or RndProbeAnchorL if left
//                              == RndAdjMatch).
//
// The returned slot REPLACES the variant-pool pick the caller started
// with — the seam helper rewrites the cell from a random side-variant
// into a SlopeCap that rounds into adjoining terrain.
// ─────────────────────────────────────────────────────────────────────

function floorEdgeRandomSideSeam(state: DecodeState, sideBit: number): number {
  const sideId = sideBit === 0 ? probeRightTile(state) : probeLeftTile(state);
  const defaultSlot = sideBit === 0
    ? TT.FlatFloor_RndProbeAnchorR
    : TT.FlatFloor_RndProbeAnchorL;

  if (sideId === state.templateAt(TT.FlatFloor_RndAdjMatch)) {
    return defaultSlot;
  }

  const belowWriteSlot = sideBit === 0 ? SLOT_1CC4 : SLOT_1CC2;
  const fallbackSlot   = sideBit === 0
    ? TT.FlatFloor_SlopeCapRightLo
    : TT.FlatFloor_SlopeCapLeftLo;

  setProbeToCurrent(state);
  const belowOff = getMap16Below(state);
  writeBuf16(state, belowOff, state.templateAt(belowWriteSlot));
  return fallbackSlot;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_floor_edge_random_side ($13:8231) — variant picker for rows
// past the row-end threshold. Three early-out branches before stamping:
//
//   1. $12 == FloorRow0_LeftLo/RightLo → "pick_anchor": stamp
//        $1CE4 + ($15 & 1) (the row-0 continuation tile, NOT the
//        variant-pool entry — this preserves seams at the floor-top
//        boundary).
//   2. $12 ∈ {FlatFloor_RndAdjMatch, FlatFloor_Row1LeftLo,
//        FlatFloor_Row1RightLo} → "seam-fix path": probe above for
//        NoSeamAnchor; if no match, write ($1CE4 + orient) to the
//        ABOVE cell. Then unconditionally call
//        `floorEdgeRandomSideSeam` which probes the opposite-side
//        neighbour, may write the BELOW cell, and returns the slot
//        to use for THIS cell (overrides the variant-pool pick).
//        Falls through to "pick_var" with the seam helper's return
//        value as the new slot.
//   3. Otherwise → "pick_var": stamp DATA_floor_edge_random_side_pool[Y] (variant pool).
//
// Exported because thick-post-overlay ($58) also invokes this routine
// (cart JSLs CODE_floor_edge_random_side from CODE_thick_post_*_edge_body
// with $15 forced to the side index). Its current call site uses an
// internal stub — see bank13-thick-post-overlay.ts comment for the
// migration path.
// ─────────────────────────────────────────────────────────────────────

export const floorEdgeRandomSide: PerCellHandler = (state) => {
  // Cart: JSL CODE_prng ; AND #$0003 ; STA $00
  //       LDA $15 ; AND #$0001 ; STA $0A ; ASL ; ASL ; ORA $00 ; ASL ; TAY
  const prngVar = prngNext(state, RNG_SITE.floorEdgeRandomSide) & 0x03;
  const orientBit = state.zp15 & 0x01;
  const poolIdx = (orientBit << 2) | prngVar;
  // STA $00 in the cart saves the variant-pool slot address for the
  // "pick_var" tail; the seam helper can overwrite this in branch 2.
  let pickVarSlot: number = DATA_floor_edge_random_side_pool[poolIdx]!;

  const cur = state.zp12 & 0xffff;
  const floorRow0L = state.templateAt(TT.FloorRow0_LeftLo);
  const floorRow0R = state.templateAt(TT.FloorRow0_RightLo);

  // Branch 1: pick_anchor — $12 matches a FloorRow0 template.
  if (cur === floorRow0L || cur === floorRow0R) {
    // Cart: LDA $1CE4 ; CLC ; ADC $0A → ($1CE4 + orient_bit) as raw 16-bit ID.
    const anchorId = (state.templateAt(SLOT_1CE4) + orientBit) & 0xffff;
    stampCell(state, anchorId);
    return;
  }

  // Branch 2: seam-fix — $12 matches RndAdjMatch / Row1Left / Row1Right.
  const rndAdjMatch = state.templateAt(TT.FlatFloor_RndAdjMatch);
  const row1L       = state.templateAt(TT.FlatFloor_Row1LeftLo);
  const row1R       = state.templateAt(TT.FlatFloor_Row1RightLo);
  if (cur === rndAdjMatch || cur === row1L || cur === row1R) {
    // Above-probe and conditional above-write.
    setProbeToCurrent(state);
    const aboveOff = getMap16Above(state);
    const aboveId = readBuf16(state, aboveOff);
    const noSeamAnchorA = state.templateAt(TT.FlatFloor_NoSeamAnchorA);
    const noSeamAnchorB = state.templateAt(TT.FlatFloor_NoSeamAnchorB);
    if (aboveId !== noSeamAnchorA && aboveId !== noSeamAnchorB) {
      const replaceId = (state.templateAt(SLOT_1CE4) + orientBit) & 0xffff;
      writeBuf16(state, aboveOff, replaceId);
    }
    // Seam helper always runs after the above check (cart: both BEQ
    // and fall-through paths land at CODE_13828C → JSR seam).
    pickVarSlot = floorEdgeRandomSideSeam(state, orientBit);
  }

  // Branch 3 (or fall-through from branch 2): pick_var — deref the
  // (possibly seam-overridden) slot via templateAt + stamp.
  stampCell(state, state.templateAt(pickVarSlot));
};

// ─────────────────────────────────────────────────────────────────────
// DATA_wall_left_right_tiles ($13:842C):  dw $1CA4, $1CA6
// These are unnamed slots in the FlatFloor family ($1C92+). Cart's
// init_per_tileset_template_slots writes them per-tileset (vertical-
// wall left/right cap tiles, distinct from FlatFloor_SlopeCap{L,R}).
// ─────────────────────────────────────────────────────────────────────

const SLOT_1CA4 = 0x001CA4;
const SLOT_1CA6 = 0x001CA6;

const DATA_wall_left_right_tiles = [SLOT_1CA4, SLOT_1CA6] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_wall_left_right ($13:8413)
//   Y = ($15 & 1) * 2
//   slot = DATA_wall_left_right_tiles[Y/2]
//   stamp templateAt(slot)
// ─────────────────────────────────────────────────────────────────────

const wallLeftRight: PerCellHandler = (state) => {
  const idx = state.zp15 & 0x01;
  stampCell(state, state.templateAt(DATA_wall_left_right_tiles[idx]!));
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_floor_edge_or_wall ($12:9217)
//
// Cart sets:
//   $17 = 0 (slope = 0)
//   $A1 = 0 (variant-stash; later mutated for $02/$03 wide-edge)
//   evenColHandler = oddColHandler = stamp picked from DATA_floor_edge_or_wall_stamp_ptrs[orient]
//     ($02/$03 → floor_edge_left_right, $0A/$0B → wall_left_right)
//   rowHandler = floor_edge_random_side (always)
//   $19 = DATA_floor_edge_or_wall_extents[orient]  ($02/$03 → 3, $0A/$0B → 1)
//
// If X (= $15) < 8 (i.e. orient < 8 = $02..$07): also shift origin and
// bump extents:
//   - Shift $1B up 1 row: $00 = (($1B & $F0F0) - $0010) & $F0F0
//   - Save sub-X: $02 = $1B & $0F0F
//   - INC $2A ; INC $2E   (extend width + height by 1 each)
//   - $A1 = $0002 (becomes $2E-restore stash; $02/$03 want $2E=2 at
//     the col=max-1, row=0 cell — the floor_edge_left_right A1-restore
//     path uses this)
//   - If X >= 6 ($07 only — there's no $06): use the simpler branch
//     (skip the extra $02 adjustment).
//   - Else (X ∈ $02..$05 → covers $02, $03, $04, $05; only $02/$03
//     register here since $04/$05 have their own init):
//       $02 -= 1, & $0F0F        (shift sub-X left by 1)
//       $A1 = $2E (stash current height in $A1 — restore target)
//       $2E = $0002 (force height-2 walk for the edge tiles)
//
//   Then write back: $1B = $00 | $02
//
// For walls ($15 ∈ $0A..$0B → X >= 8): skip all origin/extent mutation;
// jump straight to the walker.
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x02, 0x03, 0x0A, 0x0B share this handler.
function initFloorEdgeOrWall(state: DecodeState): void {
  // Resolve walker handlers from $15 (cart reads parallel tables; for
  // our 4 IDs the dispatch is direct on $15 bits 0..3).
  const orient = state.zp15 & 0xff;
  const isWall = orient >= 0x0A;
  const stamp: PerCellHandler = isWall ? wallLeftRight : floorEdgeLeftRight;
  // Cart-resident $19 = walker row-end threshold:
  //   floor edges → 3 (rows 0..2 = stamp, row 3+ = row handler)
  //   walls       → 1 (row 0 = stamp, row 1+ = row handler)
  const rowEnd = isWall ? 1 : 3;

  state.zp17 = 0;
  state.zpA1 = 0;

  if (!isWall) {
    // $02 / $03 — floor-edge origin/extent mutation.
    //
    // Cart-faithful sequence:
    //   LDA $1B (16-bit) ; PHA
    //   AND #$F0F0 ; SEC ; SBC #$0010 ; AND #$F0F0 ; STA $00
    //   PLA ; AND #$0F0F ; STA $02
    //   INC $2A ; INC $2E
    //   LDA #$0002 ; STA $A1
    //   CPX #$0006 ; BCS skip_extra      ; only $07+ skip (so $02/$03 take it)
    //   LDA $02 ; DEC ; AND #$0F0F ; STA $02
    //   LDA $2E ; STA $A1
    //   LDA #$0002 ; STA $2E
    // skip_extra:
    //   LDA $00 ; ORA $02 ; STA $1B
    const word1B = (state.zp1B | (state.zp1C << 8)) & 0xffff;
    const screenKeep = ((word1B & 0xf0f0) - 0x0010) & 0xf0f0;
    let subKeep = word1B & 0x0f0f;
    state.zp2A = (state.zp2A + 1) & 0xff;
    state.zp2E = (state.zp2E + 1) & 0xffff;
    state.zpA1 = 0x0002;
    // Cart compares `X = orient * 2` against $0006 (CPX #$0006 / BCS skip),
    // NOT $15 directly. So the inner clamp branch fires for orient < 3
    // — i.e. ONLY $02. $03 skips it entirely (its $2E stays at the INC'd
    // value and the walker iterates the full height).
    // Trace verification: std-02 post-init $2E = $0002 (clamp fires);
    // std-03 post-init $2E = $0011 (clamp skipped).
    if (orient < 0x03) {
      subKeep = (subKeep - 1) & 0x0f0f;
      state.zpA1 = state.zp2E & 0xff;
      state.zp2E = 0x0002;
    }
    const newWord = (screenKeep | subKeep) & 0xffff;
    state.zp1B = newWord & 0xff;
    state.zp1C = (newWord >>> 8) & 0xff;
  }

  // walker_run with 3 distinct handlers: even-col stamp, odd-col stamp,
  // row-end = floor_edge_random_side. Cart sets even ($22) + odd ($1F)
  // to the SAME handler for these objects — no column-parity dispatch.
  walkerRun(state, stamp, stamp, floorEdgeRandomSide, rowEnd);
}

// ─────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────

export function installFloorEdgeOrWallHandlers(): void {
  // All 4 IDs share CODE_init_floor_edge_or_wall (spec confirmed).
  registerStdObjectHandler(0x02, initFloorEdgeOrWall);
  registerStdObjectHandler(0x03, initFloorEdgeOrWall);
  registerStdObjectHandler(0x0A, initFloorEdgeOrWall);
  registerStdObjectHandler(0x0B, initFloorEdgeOrWall);
}
