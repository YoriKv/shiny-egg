// Standard objects $32/$33 — init_jungle_block_pattern.
//
// Cart entry: CODE_init_jungle_block_pattern @ $12:95CF (yi/Banks/Bank12.asm:3407).
// Variant-A stamp: CODE_jungle_block_pattern_a @ $13:97EB (Bank13.asm:3236).
// Variant-B stamp: CODE_jungle_block_pattern_b @ $13:98F3 (Bank13.asm:3402).
//
// Jungle "patterned-block" — two visually-distinct variants of the same
// rectangular block shape. The init's only job is to pick variant A
// (orientation $32, bit 0 = 0) or variant B (orientation $33, bit 0 = 1)
// via DATA_1295CB and tail-call the walker trampoline with the chosen
// per-cell handler. No DP mutations on either variant (spec confirms
// $1B/$1C/$2A/$2E/$15 all "no change" entering the walker).
//
// Per-cell handler shape (both variants):
//   Row-dispatch by $2C → top / mid / bot via a 3-entry word table:
//     - variant A: DATA_1397E5 → [a_top, a_mid, a_bot]
//     - variant B: DATA_1398ED → [b_top, a_mid, a_bot]
//   Only the *top-row* handler differs between variants; mid/bot are
//   shared. Row classification: row 0 → top; row+1 == $2E → bot; else
//   → mid.
//
//   Top-row (a_top / b_top): col 0 → fixed left-cap tile; col = $2A-1
//   → that tile + 1 (deterministic right-cap); interior cols → prng-picked
//   variant.
//     - a_top base $90A8 (left-cap), interior $90BE + (prng & 1)  → $90BE/$90BF.
//     - b_top base $90AA (left-cap), interior $90C0 + (prng & 3)  → $90C0..$90C3.
//
//   Mid-row (a_mid, shared): prng picks Y in 0..7. Col-dispatch by $28:
//     col 0    → mid_left:   tile = (Y & 3) + $90B6 in $04; if left-neighbour
//                ∈ {$90C4..$90C7} → tile += 4 (jump from $90B6.. block to
//                $90BA.. block).
//     last col → mid_right:  tile = (Y & 3) + $90C4 in $04; if right-neighbour
//                ∈ {$90B6..$90B9} → tile += 4 (jump from $90C4.. to $90C8..).
//     middle   → mid_center: tile = Y + $90D2 in $04 (8-variant random body).
//   All three put the result tile into $04; the parent (a_mid) then
//   loads $04 to A as the stamp value.
//
//   Bot-row (a_bot, shared): inspect $12 (current cell) high byte:
//     - if high byte == $92 (existing tile is in $9200..): left-cap $90CC,
//       right-cap $90CC INC = $90CD, interior prng & 3 + $90CE → $90CE..$90D1.
//     - otherwise:                                  left-cap $90AE,
//       right-cap $90AE INC = $90AF, interior prng & 3 + $90B2 → $90B2..$90B5.
//
// asm primary. No GoldenEgg counterpart (searched JungleBlock /
// JNGL_BLCK / BlockPattern / JunglePatterned — 0 hits).
//
// PRNG carry-flag caveat applies to every `ADC #$xxxx` after `JSL prng`
// (interior tile pick on top/mid/bot rows). Our deterministic LFSR can't
// replicate the cart's stale-carry from HV-counter math, so we treat the
// ADC as carry-clear. The variant pool is correct; individual picks
// won't byte-match a specific cart-snapshot trace. Cosmetic-only impact.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { prngNext } from '../prng.ts';
import { getMap16Left, getMap16Right } from '../fetch.ts';
import { stampCell, setProbeToCurrent, readBuf16 } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Tile constants (Bank13.asm:3255-3434).
// ─────────────────────────────────────────────────────────────────────

// Variant A top-row caps + interior random base.
const A_TOP_LEFT_CAP        = 0x90A8;  // also right-cap via INC → $90A9.
const A_TOP_INTERIOR_BASE   = 0x90BE;  // + (prng & 1) → $90BE/$90BF.
const A_TOP_INTERIOR_MASK   = 0x0001;

// Variant B top-row caps + interior random base.
const B_TOP_LEFT_CAP        = 0x90AA;  // also right-cap via INC → $90AB.
const B_TOP_INTERIOR_BASE   = 0x90C0;  // + (prng & 3) → $90C0..$90C3.
const B_TOP_INTERIOR_MASK   = 0x0003;

// Mid-row col-0 left-cap pool base + neighbour-bump pool base (when left
// neighbour is in the $90C4..$90C7 "right-cap" range).
const MID_LEFT_BASE         = 0x90B6;  // (prng & 3) + $90B6 → $90B6..$90B9.
const MID_LEFT_BUMP         = 4;       // tile += 4 → $90BA..$90BD.
const MID_LEFT_NEIGHBOUR_LO = 0x90C4;
const MID_LEFT_NEIGHBOUR_HI = 0x90C7;

// Mid-row col-last right-cap pool base + neighbour-bump.
const MID_RIGHT_BASE         = 0x90C4; // (prng & 3) + $90C4 → $90C4..$90C7.
const MID_RIGHT_BUMP         = 4;      // tile += 4 → $90C8..$90CB.
const MID_RIGHT_NEIGHBOUR_LO = 0x90B6;
const MID_RIGHT_NEIGHBOUR_HI = 0x90B9;

// Mid-row centre random body: 8 variants $90D2..$90D9.
const MID_CENTER_BASE        = 0x90D2;

// Bot-row "above existing $92xx" branch.
const BOT_92_LEFT_CAP        = 0x90CC;       // also right-cap via INC → $90CD.
const BOT_92_INTERIOR_BASE   = 0x90CE;       // + (prng & 3) → $90CE..$90D1.

// Bot-row default branch (no $92xx underneath).
const BOT_DEFAULT_LEFT_CAP   = 0x90AE;       // also right-cap via INC → $90AF.
const BOT_DEFAULT_INTERIOR_BASE = 0x90B2;    // + (prng & 3) → $90B2..$90B5.

const ROW_RAND_MASK          = 0x0003;       // bot-row & mid right/left random masks.

// ─────────────────────────────────────────────────────────────────────
// Variant-A top row (CODE_jungle_block_pattern_a_top, Bank13.asm:3255).
//
//   LDA #$90A8
//   LDY $28
//   BEQ done                       ; col 0 → keep $90A8 (left-cap)
//   INC                            ; → $90A9 (right-cap candidate)
//   INY
//   CPY $2A
//   BEQ done                       ; col == $2A-1 → keep $90A9
//   ; interior col
//   JSL prng ; AND #$0001 ; CLC ; ADC #$90BE   → $90BE / $90BF
// done:
//   RTS
// ─────────────────────────────────────────────────────────────────────
function topRowVariantA(state: DecodeState): number {
  const col = state.zp28 & 0xff;
  if (col === 0) return A_TOP_LEFT_CAP;
  if (((col + 1) & 0xff) === (state.zp2A & 0xff)) {
    return (A_TOP_LEFT_CAP + 1) & 0xffff;
  }
  return (A_TOP_INTERIOR_BASE + (prngNext(state) & A_TOP_INTERIOR_MASK)) & 0xffff;
}

// ─────────────────────────────────────────────────────────────────────
// Variant-B top row (CODE_jungle_block_pattern_b_top, Bank13.asm:3421).
// Same shape as variant A but base $90AA + (prng & 3) for interior →
// $90C0..$90C3.
// ─────────────────────────────────────────────────────────────────────
function topRowVariantB(state: DecodeState): number {
  const col = state.zp28 & 0xff;
  if (col === 0) return B_TOP_LEFT_CAP;
  if (((col + 1) & 0xff) === (state.zp2A & 0xff)) {
    return (B_TOP_LEFT_CAP + 1) & 0xffff;
  }
  return (B_TOP_INTERIOR_BASE + (prngNext(state) & B_TOP_INTERIOR_MASK)) & 0xffff;
}

// ─────────────────────────────────────────────────────────────────────
// Mid-row (CODE_jungle_block_pattern_a_mid, Bank13.asm:3275). Shared
// across variants. The cart pre-fetches Y = prng & 7, then dispatches
// per column index via DATA_139822 → mid_left / mid_center / mid_right.
//
// The sub-handlers put their tile into $04 then RTS; the parent
// `CODE_139840` reloads `LDA $04` and returns that as the stamp value.
// We mirror that with a TS `let tile` and three branches.
// ─────────────────────────────────────────────────────────────────────
function midRow(state: DecodeState): number {
  const y = prngNext(state) & 0x07;
  const col = state.zp28 & 0xff;

  if (col === 0) {
    // mid_left: tile = (y & 3) + $90B6. If left-neighbour ∈ $90C4..$90C7,
    // bump tile by 4 (jump $90B6.. → $90BA.. block).
    let tile = (MID_LEFT_BASE + (y & 0x03)) & 0xffff;
    setProbeToCurrent(state);
    const leftOff = getMap16Left(state);
    const leftTile = readBuf16(state, leftOff);
    if (leftTile >= MID_LEFT_NEIGHBOUR_LO && leftTile <= MID_LEFT_NEIGHBOUR_HI) {
      tile = (tile + MID_LEFT_BUMP) & 0xffff;
    }
    return tile;
  }

  if (((col + 1) & 0xff) === (state.zp2A & 0xff)) {
    // mid_right: tile = (y & 3) + $90C4. If right-neighbour ∈
    // $90B6..$90B9, bump by 4 ($90C4.. → $90C8..).
    let tile = (MID_RIGHT_BASE + (y & 0x03)) & 0xffff;
    setProbeToCurrent(state);
    const rightOff = getMap16Right(state);
    const rightTile = readBuf16(state, rightOff);
    if (rightTile >= MID_RIGHT_NEIGHBOUR_LO && rightTile <= MID_RIGHT_NEIGHBOUR_HI) {
      tile = (tile + MID_RIGHT_BUMP) & 0xffff;
    }
    return tile;
  }

  // mid_center: tile = y + $90D2 (8 random body variants $90D2..$90D9).
  return (MID_CENTER_BASE + y) & 0xffff;
}

// ─────────────────────────────────────────────────────────────────────
// Bot-row (CODE_jungle_block_pattern_a_bot, Bank13.asm:3355). Shared
// across variants. Two parallel branches based on the high byte of $12
// (current cell's existing Map16 ID): if it's $92xx the block is sitting
// on top of an existing $92.. structure → use the alternate cap/base
// pool ($90CC / $90CE..); otherwise use the default pool ($90AE /
// $90B2..).
// ─────────────────────────────────────────────────────────────────────
function botRow(state: DecodeState): number {
  const onTopOf92 = (state.zp12 & 0xff00) === 0x9200;
  const leftCap = onTopOf92 ? BOT_92_LEFT_CAP        : BOT_DEFAULT_LEFT_CAP;
  const intBase = onTopOf92 ? BOT_92_INTERIOR_BASE   : BOT_DEFAULT_INTERIOR_BASE;

  const col = state.zp28 & 0xff;
  if (col === 0) return leftCap;
  if (((col + 1) & 0xff) === (state.zp2A & 0xff)) {
    return (leftCap + 1) & 0xffff;
  }
  return (intBase + (prngNext(state) & ROW_RAND_MASK)) & 0xffff;
}

// ─────────────────────────────────────────────────────────────────────
// Per-variant stamp handler. Row dispatch is identical between A and B;
// only the top-row sub-handler swaps in.
//
//   row 0           → top
//   row+1 == $2E    → bot
//   else            → mid
// ─────────────────────────────────────────────────────────────────────
function makeStamp(topFn: (s: DecodeState) => number): PerCellHandler {
  return (state) => {
    const row = state.zp2C & 0xffff;
    const rowExt = state.zp2E & 0xffff;

    let tile: number;
    if (row === 0) {
      tile = topFn(state);
    } else if (((row + 1) & 0xffff) === rowExt) {
      tile = botRow(state);
    } else {
      tile = midRow(state);
    }
    stampCell(state, tile);
  };
}

const jungleBlockPatternA: PerCellHandler = makeStamp(topRowVariantA);
const jungleBlockPatternB: PerCellHandler = makeStamp(topRowVariantB);

// ─────────────────────────────────────────────────────────────────────
// CODE_init_jungle_block_pattern ($12:95CF, Bank12.asm:3407).
//
//   REP #$20
//   LDA $15 ; AND #$0001 ; ASL ; TAY    ; bit 0 of orientation byte
//   LDX #(CODE_jungle_block_pattern_a-1)>>16
//   LDA DATA_1295CB,y                   ; A vs B variant ptr-1
//   JMP walker_setup_trampoline         ; slope=0, all 3 slots = chosen variant
//
// $15 is the std-object orientation byte (= the std object ID for these
// two: $32 → bit 0 = 0 → variant A; $33 → bit 0 = 1 → variant B). The
// init makes no DP mutations.
// ─────────────────────────────────────────────────────────────────────
// Merge: object IDs 0x32, 0x33 share this handler.
const initJungleBlockPattern: InitHandler = (state) => {
  const handler = (state.zp15 & 0x01) === 0 ? jungleBlockPatternA : jungleBlockPatternB;
  walkerSetupTrampoline(state, handler);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent wires this into object-decode/index.ts.
// ─────────────────────────────────────────────────────────────────────
export function installJungleBlockPatternHandlers(): void {
  registerStdObjectHandler(0x32, initJungleBlockPattern);
  registerStdObjectHandler(0x33, initJungleBlockPattern);
}
