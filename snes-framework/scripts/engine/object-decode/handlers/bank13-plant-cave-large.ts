// Standard object $9A — PlantCaveLarge: a large cave plant, drawn as a
// 4-wide PRNG-decorated floor block.
//
// Cart entry: CODE_init_plant_cave_large @ $12:9DEF (yi/Banks/Bank12.asm:4611).
// Per-cell stamp:  CODE_stamp_floor_4wide  @ $13:D855 (yi/Banks/Bank13.asm:10560).
//
// 4-wide-by-N tall PRNG-decorated floor block, $7700-$774F tile range.
//
// Init:
//   - Forces $2A (col extent) = 4.
//   - Shifts $1B origin LEFT by 2 sub-screen-X nibbles (so the visible
//     anchor sits at the user-placed cell with 1 cell of bleed on each
//     side; col-2 + col-1 of the cart's 0..3 walker correspond to the
//     stream cell's $1B and $1B+1).
//   - PRNGs a variant index: $15 = prng & 3 (0..3), and $A1 = (3 XOR $15) * 2
//     (a 16-bit byte index used by the col1/col2 mirror sub-handlers).
//   - Trampoline-walks CODE_stamp_floor_4wide.
//
// Stamp dispatch (CODE_stamp_floor_4wide, see closure for the asm):
//   Picks one of 4 sub-handlers from DATA_13D845 (when $2E odd) or
//   DATA_13D84D (when $2E even) by an X-index computed from $2C:
//
//     $2C in 0..1            → X=0 → body_pick     (DATA_13D80D / DATA_13D81D)
//     $2C >= 2, $2C+1 == $2E → X=2 → col_c         (DATA_13D83D)
//     $2C >= 2, $2C+1 odd    → X=4 → col_b         (DATA_13D835)
//     $2C >= 2, $2C+1 even   → X=6 → col_a         (DATA_13D82D)
//
//   For $2E even (the common case — row extent multiple of 2), the
//   DATA_13D84D table is selected (counter-intuitively the asm names
//   it "odd_col" — refers to the column-1 mirror inside the stamp routine).
//
// body_pick:
//   Y = ($28 << 1) | (($2C & 1) << 3)
//   word = TABLE[Y]   (DATA_13D80D for even-$2E variant, DATA_13D81D for odd-$2E)
//   If word == 0: skip stamp (some entries are explicit gaps so the
//     walker leaves the previous tile alone).
//   Else: stamp word + 4 * $15  (the $15 variant adds 4*N to step through
//     a 4-entry colour/decor band per cell — the "random" axis).
//
// col_a / col_b / col_c:
//   Only fire on a specific column ($28 == 2 for the DATA_13D845 set;
//   $28 == 1 for the DATA_13D84D set). On match: Y = $A1, read word from
//   the appropriate DATA_13D82D/35/3D table (same set of 4 anchor tiles
//   in each, just at different column offsets). Stamp directly (no $15
//   addition; the $A1-indexed pick already covers variant rotation).
//   Off-column: stamp nothing.
//
// Result for the spec test ($2C row in 0..15, $2E=$10, $15=3, $A1=0):
//   - rows 0..1: body_pick on every column. Some entries are $0000 so a
//     few cells are blank.
//   - rows 2..14: col_a/col_b/col_c fire only on $28 == 1 (since DATA_13D84D
//     is selected); rows alternate between $7733 / $7700 (b vs a).
//   - row 15 ($2C=15, $2C+1 == $2E): col_c fires on $28 == 1, stamps $7723.
//   The remaining 32 cells (cols 0, 2, 3 on rows 2+) get no stamp (they
//   keep whatever was previously in the buffer — for a fresh floor, that's
//   zero, hence the `$????` markers in the trace).

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { prngNext } from '../prng.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Per-column tile tables (Bank13.asm:10533-10546).
//
// Two body-pick tables (one per $2E parity); three column anchor
// tables shared by col_a/col_b/col_c handlers.
// ─────────────────────────────────────────────────────────────────────

/** DATA_13D80D (Bank13.asm:10533). 8 words. Base tiles for body cells
 *  when $2E is odd; indexed by Y = ($28 << 1) | (($2C & 1) << 3).
 *  Zero entries mean "skip stamp" (leave previous tile). */
const DATA_13D80D = [
  0x0000, 0x7701, 0x7702, 0x7703,
  0x7710, 0x7711, 0x7712, 0x7713,
] as const;

/** DATA_13D81D (Bank13.asm:10536). 8 words. Body base tiles when $2E
 *  is even. Same Y-indexing as DATA_13D80D. */
const DATA_13D81D = [
  0x7730, 0x7731, 0x7732, 0x0000,
  0x7740, 0x7741, 0x7742, 0x7743,
] as const;

/** DATA_13D82D (Bank13.asm:10539). 4 words. Anchor tiles for col_a;
 *  indexed by Y = $A1 (PRNG-derived). */
const DATA_13D82D = [0x7700, 0x7704, 0x7708, 0x770C] as const;

/** DATA_13D835 (Bank13.asm:10542). 4 words. Anchor tiles for col_b. */
const DATA_13D835 = [0x7733, 0x7737, 0x773B, 0x773F] as const;

/** DATA_13D83D (Bank13.asm:10545). 4 words. Anchor tiles for col_c. */
const DATA_13D83D = [0x7723, 0x7727, 0x772B, 0x772F] as const;

// ─────────────────────────────────────────────────────────────────────
// Sub-pickers (Bank13.asm:10602-10703).
//
// Each returns a 16-bit Map16 ID or 0 (= "no stamp"). The cart returns
// the value in Y; we just return it directly.
// ─────────────────────────────────────────────────────────────────────

/** CODE_floor_4wide_even_body_pick / CODE_floor_4wide_odd_body_pick
 *  (Bank13.asm:10602 / 10652). Identical bodies; differ only in which
 *  base table they index. */
function bodyPick(state: DecodeState, table: readonly number[]): number {
  const dollar00 = ((state.zp2C & 1) << 3) & 0xff;
  const y = (((state.zp28 << 1) & 0xff) | dollar00) & 0x0f;
  const base = table[y >>> 1] ?? 0;
  if (base === 0) return 0;
  // ADC $15 four times = base + 4 * ($15 & 0xff).
  return (base + ((state.zp15 & 0xff) << 2)) & 0xffff;
}

/** CODE_floor_4wide_*_col*_a/b/c (Bank13.asm:10618 / 10632 / 10642 /
 *  10671 / 10685 / 10695). On match-column, read DATA_*[$A1] and return
 *  it. Off-column, return 0. The match-column differs between the
 *  DATA_13D845 set ($28 == 2) and the DATA_13D84D set ($28 == 1). */
function colPick(state: DecodeState, matchCol: number, table: readonly number[]): number {
  if ((state.zp28 & 0xff) !== matchCol) return 0;
  const y = (state.zpA1 & 0xff) >>> 1;
  return table[y] ?? 0;
}

// ─────────────────────────────────────────────────────────────────────
// Cell stamp — CODE_stamp_floor_4wide (Bank13.asm:10560, $13:D855).
// ─────────────────────────────────────────────────────────────────────

const stampPlantCaveLarge: PerCellHandler = (state) => {
  const row = state.zp2C & 0xff;
  const rowExt = state.zp2E & 0xff;

  // X-index into the 4-entry sub-handler ptr table:
  //   row 0..1               → 0 (body)
  //   row+1 == $2E (last)    → 2 (col_c)
  //   else, row+1 odd        → 4 (col_b)
  //   else                   → 6 (col_a)
  // (Encoded as the per-2-word entry index in the source.)
  let idx: 0 | 1 | 2 | 3;
  if (row < 2) {
    idx = 0;
  } else if (((row + 1) & 0xff) === rowExt) {
    idx = 1; // col_c
  } else if (((row + 1) & 1) !== 0) {
    idx = 2; // col_b
  } else {
    idx = 3; // col_a
  }

  // $2E parity selects which set of 4 sub-handlers:
  //   $2E & 1 == 0 (BEQ taken) → DATA_13D84D set ("odd_*" in asm names;
  //                              the match-column is 1 — i.e. col-1 of
  //                              the 4-wide block)
  //   $2E & 1 == 1             → DATA_13D845 set (match-column = 2)
  //
  // body_pick differs only in the base table used.
  let pick: number;
  if ((rowExt & 1) === 0) {
    // DATA_13D84D dispatch (Bank13.asm:10554).
    switch (idx) {
      case 0: pick = bodyPick(state, DATA_13D81D); break;
      case 1: pick = colPick(state, 1, DATA_13D83D); break;
      case 2: pick = colPick(state, 1, DATA_13D835); break;
      case 3: pick = colPick(state, 1, DATA_13D82D); break;
    }
  } else {
    // DATA_13D845 dispatch (Bank13.asm:10548).
    switch (idx) {
      case 0: pick = bodyPick(state, DATA_13D80D); break;
      case 1: pick = colPick(state, 2, DATA_13D83D); break;
      case 2: pick = colPick(state, 2, DATA_13D835); break;
      case 3: pick = colPick(state, 2, DATA_13D82D); break;
    }
  }

  // CODE_floor_4wide_apply_pick (Bank13.asm:10593): TYA / BEQ skip /
  // STA buffer,X — i.e. only stamp if the pick is non-zero.
  if (pick !== 0) stampCell(state, pick);
};

// ─────────────────────────────────────────────────────────────────────
// Init handler — CODE_init_plant_cave_large (Bank12.asm:4611).
// ─────────────────────────────────────────────────────────────────────

function initPlantCaveLarge(state: DecodeState): void {
  // Force col extent = 4.
  state.zp2A = 0x0004;

  // Shift $1B origin's sub-position LEFT by 2 sub-X cells. The cart's
  // op is a 16-bit `DEC; DEC` on the masked sub-nibbles of the $1B:$1C
  // word — compose from both bytes so an underflow from sub-X $00 → $FF
  // (which gets masked back to $0E) doesn't corrupt the screen-Y nibble.
  const word1B = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  const subKeep = word1B & 0x0F0F;
  const screenKeep = word1B & 0xF0F0;
  const decTwice = (subKeep - 2) & 0x0F0F;
  const newWord = (screenKeep | decTwice) & 0xffff;
  state.zp1B = newWord & 0xff;
  state.zp1C = (newWord >>> 8) & 0xff;

  // PRNG-derived variant index in $15, mirror in $A1.
  //   $15 = prng & 3
  //   $A1 = ($15 XOR 3) << 1     (a byte index into a 4-word table)
  const roll = prngNext(state) & 0x0003;
  state.zp15 = roll;
  state.zpA1 = ((roll ^ 0x0003) << 1) & 0xff;

  // Trampoline-walker into CODE_stamp_floor_4wide.
  walkerSetupTrampoline(state, stampPlantCaveLarge);
}

// ─────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────

export function installPlantCaveLargeHandlers(): void {
  registerStdObjectHandler(0x9A, initPlantCaveLarge);
}
