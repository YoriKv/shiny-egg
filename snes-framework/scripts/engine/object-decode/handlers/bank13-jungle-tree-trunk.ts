// Standard objects $30 / $31 — init_jungle_tree_trunk.
//
// Cart entry: CODE_init_jungle_tree_trunk @ $12:95AA (yi/Banks/Bank12.asm:3386).
// Per-cell stamp handlers (shared init; bit 0 of $15 picks which):
//   CODE_jungle_tree_trunk_with_branches @ $13:96B2 (Bank13.asm:3032)
//     — JNGL_TLUP0 analogue. Base trunk + branch-junction tiles, with
//        row-0 "above-blend" decoration that may re-write the cell
//        directly above to a $9B04..$9B07 trunk-meets-foliage variant.
//   CODE_jungle_tree_trunk_with_leaves @ $13:9769 (Bank13.asm:3146)
//     — JNGL_TLUP1 analogue. JSLs _with_branches first, then on
//        non-edge rows rolls a PRNG byte; on hit overlays the centre
//        cell with a leaf tile and side-stamps 1-2 neighbouring leaf
//        cells via DATA_139763 (left / right / both).
//
// Init handler is shared between two object IDs:
//
//   $30 — trunk with branches.  Per-cell = CODE_jungle_tree_trunk_with_branches.
//   $31 — trunk with leaves.    Per-cell = CODE_jungle_tree_trunk_with_leaves.
//
// The init seeds $A1 with either $0000 (no leaf-tint) or $000B (leaf-
// tint bias) via PRNG bit 1, then picks the per-cell handler by
// bit-0 of $15 via DATA_1295A6. The $A1 value is read by both per-cell
// handlers to recolor foliage variants:
//   * _with_branches's "miss" fallback paths add $0 (no leaf) or $2
//     (leaf-tint) to the $00AC base via CODE_139745.
//   * _with_branches's $920F-edge override adds $A1 to the tile via
//     CODE_139757 (ADC $A1 after CLC).
//   * _with_leaves's overlay-leaf addition uses ADC $A1 after the
//     base offset; side leaf picks (left $9672/$9674, right $9673/
//     $9675) INC by 4 when $A1 != 0.
//
// asm primary; trace harness spec.md outputs cross-checked for $30/$31.
// $36 (CODE_init_jungle_tree_leaves_only) reuses _with_leaves via a
// separate init; the per-cell handler is exported so the $36 file
// can wire it directly without duplicating the body.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { prngNext, RNG_SITE } from '../prng.ts';
import {
  getMap16Above,
  getMap16Left,
  getMap16Right,
} from '../fetch.ts';
import {
  stampCell,
  readBuf16,
  writeBuf16,
  setProbeToCurrent,
} from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Tables consumed by the trunk-with-branches per-cell handler
// (Bank13.asm:3019, 3180, 3200).
//
//   DATA_1396AA (= JNGL_TL0_LT_DT analogue, 4 entries): per-page-offset
//     branch-junction tile lookup for $920F+ trunk-edge cells. Indexed
//     by (($12 - $920F) << 1).
//   DATA_1397A9 (2 entries): leaf-left tiles, indexed by ($0A & 1) * 2.
//   DATA_1397C7 (2 entries): leaf-right tiles, indexed by ($0A & 1) * 2.
//
// The two leaf tables look like 4-entry arrays in the cart because of
// the `INC INC INC INC` ($A1 != 0) bias path; we just add 4 explicitly
// when leaf-tint is in effect (see below).
// ─────────────────────────────────────────────────────────────────────

const DATA_1396AA = [0x9213, 0x9214, 0x9213, 0x9216] as const;
const DATA_1397A9_LEAF_LEFT  = [0x9672, 0x9674] as const;
const DATA_1397C7_LEAF_RIGHT = [0x9673, 0x9675] as const;

// Leaf-side picker dispatch from DATA_139763. Bit-1/2 of (prng & 7) =
// 0/2/4 picks both / left-only / right-only. The cart `JSR (ptr,x)`
// uses a 3-entry pointer table; we encode it as the 3 side functions
// below and dispatch by index.
const LeafSide = {
  Both:  0,
  Left:  1,
  Right: 2,
} as const;
type LeafSide = typeof LeafSide[keyof typeof LeafSide];

// ─────────────────────────────────────────────────────────────────────
// CODE_jungle_tree_trunk_with_branches ($13:96B2, Bank13.asm:3032).
//
// Per-cell handler invoked at every walker step. Decision tree mirrors
// the cart prose:
//
//   if row == 0:
//     if $12 is in [$9B00, $9B04) → fall through ("ABOVE-blend" skip).
//     else: ABOVE-blend pass — probe the cell directly above, and
//       if it equals one of $963B / $963C / $960E / $961D, overwrite
//       it with $9B04 + matchIndex.
//
//   "current-cell pick" (always runs):
//     if $12 == $960F → stamp $9900 (no-match branch-junction-left).
//     elif $12 == $961C → stamp $9901 (no-match branch-junction-right).
//     else:
//       roll prng & 1.
//       if row == extent - 1 ("LAST row"):
//         if $12 hi-byte == $9200..$92FF:
//           if $12 < $920F → stamp $9215 (special trunk-base).
//           else          → stamp DATA_1396AA[($12 - $920F) << 1].
//         else:
//           stamp ($00AC + roll); if $A1 != 0, stamp ($00AE + roll) (leaf-tint).
//       else (non-LAST):
//         stamp $9908 + roll + $A1 (so $9908/$9909 base, +$0B for leaf).
//
// The cart's "current-cell pick" reuses the same prng roll latched into
// $00 in two places ($A1 = $0B leaf-bias add for non-LAST rows, then
// the $00AC base + roll for non-trunk-edge LAST rows). We mirror that
// by keeping the rolled bit in a local.
// ─────────────────────────────────────────────────────────────────────
export const jungleTreeTrunkWithBranchesStamp: PerCellHandler = (state) => {
  const row = state.zp2C & 0xffff;
  const extent = state.zp2E & 0xffff;
  const cur = state.zp12 & 0xffff;

  // Row-0 ABOVE-blend gate. The cart explicitly skips the blend if the
  // current cell is ALREADY in [$9B00, $9B04) (i.e. we're stamping over
  // a previously-placed tree-meets-foliage tile pair).
  if (row === 0) {
    if (cur >= 0x9B00 && cur < 0x9B04) {
      // CODE_jungle_tree_trunk_exit: SEP #$30 / RTL. Nothing else
      // happens this cell — caller's `_with_leaves` decorator handles
      // the leaf overlay separately.
      return;
    }

    // CODE_jungle_tree_trunk_above_blend.
    setProbeToCurrent(state);
    const aboveOff = getMap16Above(state);
    const aboveTile = readBuf16(state, aboveOff);

    let matchIdx = -1;
    if (aboveTile === 0x963B) matchIdx = 0;
    else if (aboveTile === 0x963C) matchIdx = 1;
    else if (aboveTile === 0x960E) matchIdx = 2;
    else if (aboveTile === 0x961D) matchIdx = 3;

    if (matchIdx >= 0) {
      // Stamp $9B04 + matchIdx into the above cell. Falls through to
      // the current-cell pick afterwards (CODE_1396F6).
      writeBuf16(state, aboveOff, (0x9B04 + matchIdx) & 0xffff);
    }
    // Whether matched or not, the cart falls through to CODE_1396F6
    // for the current-cell pick.
  }

  // ── CODE_1396F6 — current-cell pick ──
  // Check $12 for the two "no-match branch-junction" markers; if
  // either matches, stamp $9900+match and return early.
  if (cur === 0x960F) {
    stampCell(state, 0x9900);
    return;
  }
  if (cur === 0x961C) {
    stampCell(state, 0x9901);
    return;
  }

  // CODE_13970D — main random body. Roll one PRNG bit.
  const roll = prngNext(state, RNG_SITE.jungleTrunkBranches) & 0x01;

  // CODE_139725 — "is this the LAST row?" branch. Cart does
  // `LDA $2C ; INC ; CMP $2E ; BEQ → LAST handler`.
  const rowPlus1 = (row + 1) & 0xffff;
  const isLastRow = rowPlus1 === extent;

  if (!isLastRow) {
    // Non-LAST row: stamp $9908 + roll + $A1 (leaf-tint bias). The
    // cart's ADC sequence is `LDA $00 ; CLC ; ADC #$9908 ; ... ; CLC
    // ; ADC $A1` (CODE_139757). $A1 is 0 or $0B.
    const tile = (0x9908 + roll + (state.zpA1 & 0xff)) & 0xffff;
    stampCell(state, tile);
    return;
  }

  // LAST row branch (CODE_139725). Decision on the high byte of $12.
  if ((cur & 0xff00) === 0x9200) {
    // $12 is in $9200..$92FF — trunk-base territory.
    if (cur < 0x920F) {
      // Below-$920F: stamp $9215.
      stampCell(state, 0x9215);
      return;
    }
    // At-or-above $920F: index DATA_1396AA by ($12 - $920F) << 1.
    // The cart's `SBC #$920F` runs after a CMP that set carry — so
    // there's no off-by-one here; ($12 - $920F) is the literal index.
    // Then ASL → word index, but DATA_1396AA is already declared as
    // dw (16-bit words), so a TS array index by ($12 - $920F) does
    // the right thing.
    const idx = (cur - 0x920F) & 0x03; // 4-entry table guard
    stampCell(state, DATA_1396AA[idx]!);
    return;
  }

  // CODE_139745 — non-$92xx LAST row: stamp ($00AC + roll), plus
  // ($00AE + roll) overlay if $A1 != 0 (leaf-tint).
  // The cart explicitly does both writes: first STA buffer,X with
  // $00AC+roll, then BEQ → exit OR fall through to LDA #$00AE+roll
  // and STA buffer,X. In both branches the FINAL write wins (same
  // $1D), so this is effectively "stamp $00AE+roll if $A1, else
  // $00AC+roll".
  const baseTile = (state.zpA1 & 0xff) === 0
    ? (0x00AC + roll) & 0xffff
    : (0x00AE + roll) & 0xffff;
  stampCell(state, baseTile);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_jungle_tree_leaves_left ($13:97AB, Bank13.asm:3183).
//
// Probe LEFT neighbour, then stamp DATA_1397A9[(prng_roll & 1) * 2]
// at the neighbour offset. If $A1 != 0 (leaf-tint), add 4 to the
// stamped tile (i.e. $9676 / $9678 instead of $9672 / $9674).
// ─────────────────────────────────────────────────────────────────────
function jungleTreeLeavesLeft(state: DecodeState, roll: number): void {
  setProbeToCurrent(state);
  const leftOff = getMap16Left(state);
  const idx = roll & 0x01;
  let tile: number = DATA_1397A9_LEAF_LEFT[idx]!;
  if ((state.zpA1 & 0xff) !== 0) tile = (tile + 4) & 0xffff;
  writeBuf16(state, leftOff, tile);
}

// ─────────────────────────────────────────────────────────────────────
// CODE_jungle_tree_leaves_right ($13:97CC, Bank13.asm:3203). Mirror of
// the left version, indexing DATA_1397C7.
// ─────────────────────────────────────────────────────────────────────
function jungleTreeLeavesRight(state: DecodeState, roll: number): void {
  setProbeToCurrent(state);
  const rightOff = getMap16Right(state);
  const idx = roll & 0x01;
  let tile: number = DATA_1397C7_LEAF_RIGHT[idx]!;
  if ((state.zpA1 & 0xff) !== 0) tile = (tile + 4) & 0xffff;
  writeBuf16(state, rightOff, tile);
}

// CODE_jungle_tree_leaves_both_sides ($13:97A5, Bank13.asm:3175).
function jungleTreeLeavesBothSides(state: DecodeState, roll: number): void {
  jungleTreeLeavesLeft(state, roll);
  jungleTreeLeavesRight(state, roll);
}

// ─────────────────────────────────────────────────────────────────────
// CODE_jungle_tree_trunk_with_leaves ($13:9769, Bank13.asm:3146).
//
// JSL into the base _with_branches first (which produces the trunk
// stamp + above-blend). Then, on non-edge rows, roll a fresh PRNG
// byte. The cart's gate is:
//
//   if $2C == 0          → skip (row 0).
//   if $2C == 1          → skip (row 1).
//   if $2C + 1 == $2E    → skip (last row).
//
// On non-skipped rows:
//   roll = prng & 0x0007
//   if roll >= 6        → skip ($9908..$990D variants only; 6/8 = 75%).
//   stamp ($9902 + roll + $A1) at the current cell  ← overlays the
//     trunk stamp the base just wrote.
//   side = (roll & 0x0E) >> 1                       ← 0,1,2,3 by spec
//     but only 0..2 are valid in DATA_139763; with `roll < 6` the
//     usable values of (roll & 0x0E) are {0, 2, 4} (when roll ∈ 0..5).
//     (roll & 0x0E) → 0: both; 2: left-only; 4: right-only.
//
// Side picks consume the LOW BIT of roll (carried in $0A) to choose
// between the two-entry leaf table.
//
// The "overlay" current-cell stamp uses A1 the same way the base does:
// $A1 == 0 → no bias, $A1 == $0B → +$0B (so $990D..$9912 leaf variants).
// ─────────────────────────────────────────────────────────────────────
export const jungleTreeTrunkWithLeavesStamp: PerCellHandler = (state) => {
  // Base trunk pass first.
  jungleTreeTrunkWithBranchesStamp(state);

  // Row gating: skip rows 0, 1, and the LAST row. Cart reads $2C as
  // 8-bit here (SEP #$30 from base's RTL); extents fit in low byte.
  const row = state.zp2C & 0xff;
  if (row === 0 || row === 1) return;
  const rowPlus1 = (row + 1) & 0xff;
  if (rowPlus1 === (state.zp2E & 0xff)) return;

  // PRNG roll. Cart pre-loads REP #$30 then `JSL prng ; AND #$0007`.
  const roll = prngNext(state, RNG_SITE.jungleTrunkLeaves) & 0x07;
  if (roll >= 0x06) {
    // CODE_13979F — fall through to SEP #$30 / RTL. No overlay this cell.
    return;
  }

  // Overlay leaf tile at current cell: $9902 + roll + $A1.
  // Note `STA $0A` happens before the ADC sequence; we just keep
  // `roll` in scope.
  const overlayTile = (0x9902 + roll + (state.zpA1 & 0xff)) & 0xffff;
  stampCell(state, overlayTile);

  // Side dispatch from DATA_139763 via (roll & 0x0E). With roll in
  // 0..5, the resulting Y indices are {0, 2, 4} which correspond to
  // the 3 side handlers (both / left / right).
  const sideY = roll & 0x0E;
  const side: LeafSide =
    sideY === 0 ? LeafSide.Both :
    sideY === 2 ? LeafSide.Left :
    LeafSide.Right; // sideY == 4

  // The side handlers consume $0A's low bit (= roll & 1) to pick
  // between the two-entry side tables. We pass `roll` directly.
  switch (side) {
    case LeafSide.Both:  jungleTreeLeavesBothSides(state, roll); break;
    case LeafSide.Left:  jungleTreeLeavesLeft(state, roll); break;
    case LeafSide.Right: jungleTreeLeavesRight(state, roll); break;
  }
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_jungle_tree_trunk ($12:95AA, Bank12.asm:3386) — shared init
// for objects $30 / $31.
//
//   REP #$20
//   STZ $A1                                ; default no-leaf-tint
//   JSL CODE_prng ; AND #$0002 ; BEQ skip
//   LDA #$000B ; STA $A1                    ; PRNG bit 1 set → leaf-tint bias
// skip:
//   LDA $15 ; AND #$0001 ; ASL ; TAY        ; Y = orient bit-0 doubled
//   LDX #(CODE_jungle_tree_trunk_with_branches-$01)>>16
//   LDA DATA_1295A6,y                       ; pick branches vs leaves variant
//   JMP CODE_walker_setup_trampoline
//
// DATA_1295A6 (Bank12.asm:3382):
//   dw CODE_jungle_tree_trunk_with_branches-1, CODE_jungle_tree_trunk_with_leaves-1
//
// So orientation bit-0 selects:
//   $30 (bit-0 == 0) → branches stamp handler.
//   $31 (bit-0 == 1) → leaves   stamp handler.
//
// The init does NOT mutate any of $1B/$1C/$2A/$2E/$15 (spec confirms),
// so the walker reads the stream's raw extents (1 col × 16 rows after
// the parser's height-1 cap to $f).
// ─────────────────────────────────────────────────────────────────────
// Merge: object IDs 0x30, 0x31 share this handler.
const initJungleTreeTrunk: InitHandler = (state) => {
  // Seed $A1: 0 (no leaf-tint) or $000B (leaf-tint bias).
  state.zpA1 = (prngNext(state, RNG_SITE.jungleTrunkInit) & 0x02) !== 0 ? 0x000B : 0x0000;

  // Bit-0 of $15 picks between branches and leaves stamp handler.
  const handler = (state.zp15 & 0x01) === 0
    ? jungleTreeTrunkWithBranchesStamp
    : jungleTreeTrunkWithLeavesStamp;

  walkerSetupTrampoline(state, handler);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Both std IDs share the same init; the init branches
// internally on $15 to pick the per-cell handler. Parent wires this
// into object-decode/index.ts.
//
// `jungleTreeTrunkWithLeavesStamp` is exported separately so the
// future $36 (init_jungle_tree_leaves_only) port can wire it
// directly — that init bypasses the branches variant and seeds $A1
// directly to $000B.
// ─────────────────────────────────────────────────────────────────────
export function installJungleTreeTrunkHandlers(): void {
  registerStdObjectHandler(0x30, initJungleTreeTrunk);
  registerStdObjectHandler(0x31, initJungleTreeTrunk);
}
