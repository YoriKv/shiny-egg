// Bank13 decorated-wall-column stamp handler + Bank12 init wrapper.
//
// Standard object $E1 — mushroom_platform: a 3-row-wide vertically
// repeating stone-wall column with a randomised "decorated top" row, a
// per-column alternating-cap body (rows 1..N-1), and a stone-merge
// end-cap on the last row. The init handler PRNG-picks a 0..3 variant
// (mapped {0,3,2,1} via XOR #$3) into $15 (shifted ASL 3) and clears
// $A1 (variant rolls per column inside the stamp).
//
// Stamp ($13:F3E6) per-cell logic:
//
//   1. row 0 (top): index DATA_decorated_wall_top_tiles by
//      `$A1*2 + $15`; if the tile already underneath this cell is in
//      the [$8D2A..$8D2D] stone-cap range, bump the picked tile +1
//      (lets the decorated top blend into a pre-existing stone wall).
//
//   2. row 1+ : split on `$A1 & 1`:
//        - even ($A1 & 1 == 0): fall through to row-bookkeeping; the
//          buffer write is SKIPPED entirely (BEQ CODE_13F44D).
//        - odd  ($A1 & 1 == 1): three sub-cases keyed off $2C:
//            $2C+1 == $2E (last row) → end-cap branch (see below)
//            $2C+1 == 2  (row 1)     → tile = $8D29
//            else                     → tile from
//              DATA_mountain_stone_cap_alt_tiles[(($2C-2) & 3)]
//
//   3. End-cap branch ($A1 odd, last row, CODE_13F42B):
//        tile = ($8D2E + ((($2C & 3) EOR 2)))    — 4-cycle pattern
//
//      The asm here contains a SIZE-MISMATCH BUG that turns into a
//      CONDITIONAL +4. Two `CPY.b` operands are encoded with explicit
//      8-bit width hints even though X/Y are 16-bit (REP #$30 active),
//      so asar emits the 1-byte-operand form `c0 90` / `c0 94`, but the
//      CPU reads 2-byte operands — eating the following `STA $0990` /
//      `STA $04B0` opcodes as operand + branch bytes. The built-ROM
//      bytes `c0 90 8d 90 09 c0 94 8d b0 04 18 69 04 00` execute as:
//
//          CPY #$8D90 ; BCC store ; CPY #$8D94 ; BCS store ; CLC ; ADC #$0004
//
//      where `store` is the shared `LDX $1D ; STA buffer,x` epilogue.
//      Y = $12 = the tile ALREADY under this cell. So the `+ $0004`
//      executes IFF $8D90 <= $12 < $8D94 — i.e. when the end-cap stacks
//      directly on a mushroom-platform body tile ($8D90..$8D93); a
//      "stack-on-self" blend. Outside that window (the common case, e.g.
//      $12 == $0000 over empty terrain) BOTH branches skip to `store`
//      and the cap is the plain `($2C & 3) ^ 2 + $8D2E`. (An earlier note
//      wrongly read $12 as "always $0000" and concluded +4 never fires —
//      it fires for the rec_2e endcaps that sit on $8D9x bodies.) Verified
//      against built-ROM bytes + the rec_2e capture ($8D2E→$8D32 etc.).
//
//   4. End-of-cell bookkeeping (CODE_13F44D): on the very last cell of
//      a column ($2C+1 == $2E) advance $A1 — INC, then wrap back to 0
//      if $A1 reaches 3. Persistent across columns.
//
// Asm sources:
//   CODE_init_mushroom_platform  Bank12.asm:5233 ($12:A1E8)
//   CODE_stamp_mushroom_platform Bank13.asm:14133 ($13:F3E6)
//   DATA_decorated_wall_top_tiles    Bank13.asm:14124 ($13:F3C8)
//   DATA_mountain_stone_cap_alt_tiles Bank13.asm:14129 ($13:F3DE)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { prngNext, RNG_SITE } from '../prng.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_decorated_wall_top_tiles (Bank13.asm:14124).
//
// 11-entry row-0 tile table (3 variant records × 4 word slots, last
// entry of each record is a padding $0000). Layout:
//   variant 0 ($15=0): $2C0C, $1527, $2F0B, $0000   (sky/stone/accent)
//   variant 1 ($15=8): $2C0E, $1528, $2F0D, $0000
//   variant 2 ($15=16): $2C10, $1529, $2F0F
//
// $15 is set by the init's `ASL ASL ASL` of the PRNG-picked variant
// index 0..2 (the 3rd shift effectively multiplies by 8). $A1*2 then
// indexes within the 4-word variant record by column.
// ─────────────────────────────────────────────────────────────────────

const DATA_decorated_wall_top_tiles: ReadonlyArray<number> = [
  0x2C0C, 0x1527, 0x2F0B, 0x0000,
  0x2C0E, 0x1528, 0x2F0D, 0x0000,
  0x2C10, 0x1529, 0x2F0F,
];

// ─────────────────────────────────────────────────────────────────────
// DATA_mountain_stone_cap_alt_tiles — DATA_lava_cave_pool_alt_tiles (Bank13.asm:14129).
//
// 4-entry tile table cycled by `(($2C - 2) & 3)` for the body interior
// (rows 2..N-2, $A1 odd path). Visually: alternating stone-cap
// variants $8D2A..$8D2D.
// ─────────────────────────────────────────────────────────────────────

const DATA_mountain_stone_cap_alt_tiles: ReadonlyArray<number> = [
  0x8D2A, 0x8D2B, 0x8D2C, 0x8D2D,
];

/** Stone-merge sentinel range for the row-0 +1 nudge.
 *  If the pre-existing tile in the cell is in [$8D2A..$8D2D] (inclusive
 *  / exclusive matching the cart's `BCC $8D2A ... BCS $8D2E` window),
 *  bump the picked top-row tile by +1 so the decorated cap connects
 *  smoothly with an already-stamped stone wall underneath. */
const STONE_MERGE_LO = 0x8D2A;
const STONE_MERGE_HI = 0x8D2E; // exclusive upper bound

/** Single-tile fill on the second row of $A1-odd columns. */
const FILL_TILE_8D29 = 0x8D29;

/** Base for the last-row end-cap (4-entry cycle $8D2E..$8D31). */
const ENDCAP_BASE_8D2E = 0x8D2E;

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_mushroom_platform ($13:F3E6).
// ─────────────────────────────────────────────────────────────────────

const mushroomPlatformStamp: PerCellHandler = (state) => {
  const row = state.zp2C & 0xffff;

  if (row === 0) {
    // Row 0: pick from the top-tile table.
    const y = (((state.zpA1 << 1) + state.zp15) & 0xff);
    let tile = DATA_decorated_wall_top_tiles[y >>> 1] ?? 0;
    // Stone-merge nudge: if cell already holds a tile in [$8D2A..$8D2E),
    // bump the picked tile +1.
    const under = state.zp12 & 0xffff;
    if (under >= STONE_MERGE_LO && under < STONE_MERGE_HI) {
      tile = (tile + 1) & 0xffff;
    }
    stampCell(state, tile);
  } else {
    // Row 1+ ($2C != 0): branch on $A1 parity.
    if ((state.zpA1 & 0x0001) !== 0) {
      // $A1 odd — three sub-cases keyed off ($2C + 1) vs $2E.
      const rowExt = state.zp2E & 0xffff;
      const rowPlus1 = (row + 1) & 0xffff;

      let tile: number;
      if (rowPlus1 === rowExt) {
        // End-cap branch (CODE_13F42B): base = (($2C & 3) ^ 2) + $8D2E, then a
        // conditional +4 when this cell STACKS on a mushroom-platform body tile.
        // The cart source reads `LDY $12 ; CPY.b #$90 ; STA $0990 ; CPY.b #$94 ;
        // STA $04B0 ; CLC ; ADC #$0004`, but X/Y are 16-bit (REP #$30) so the
        // 1-byte CPY.b operands desync the instruction stream. The BUILT-ROM
        // bytes are `c0 90 8d 90 09 c0 94 8d b0 04 18 69 04 00`, which the CPU
        // executes as:
        //     CPY #$8D90 ; BCC store ; CPY #$8D94 ; BCS store ; CLC ; ADC #$0004
        // i.e. the `STA $0990/$04B0` opcodes are eaten as CPY operands + branch
        // bytes. Net effect: +4 IFF $8D90 <= $12 < $8D94 (Y = $12 = the tile
        // already under this cell). This is a stack-on-self blend — an earlier
        // note here wrongly concluded "+4 never applies"; that's why applying it
        // unconditionally regressed the ~68 endcaps whose $12 is outside the
        // window. rec_2e's 9 endcaps sit on $8D9x bodies, so they take the +4.
        let endcap = ((((row & 0x0003) ^ 0x0002) + ENDCAP_BASE_8D2E) & 0xffff);
        const under = state.zp12 & 0xffff;
        if (under >= 0x8D90 && under < 0x8D94) {
          endcap = (endcap + 0x0004) & 0xffff;
        }
        tile = endcap;
      } else if (rowPlus1 === 0x0002) {
        // Single-tile fill on row 1.
        tile = FILL_TILE_8D29;
      } else {
        // Interior alt-cap cycle: index by (($2C - 2) & 3).
        const idx = (((row - 2) & 0xffff) & 0x0003);
        tile = DATA_mountain_stone_cap_alt_tiles[idx] ?? 0;
      }
      stampCell(state, tile);
    }
    // $A1 even — no buffer write this cell (BEQ CODE_13F44D in asm).
  }

  // End-of-cell bookkeeping (CODE_13F44D): on last row of column,
  // advance $A1 (wraps 0..2; reset to 0 when $A1 == 3 after INC).
  const rowPlus1 = (row + 1) & 0xffff;
  if (rowPlus1 === (state.zp2E & 0xffff)) {
    const next = (state.zpA1 + 1) & 0xffff;
    state.zpA1 = next < 0x0003 ? next : 0x0000;
  }
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_mushroom_platform ($12:A1E8).
//
//   REP #$20
//   STZ $A1                           ; reset per-column variant roll
//   JSL CODE_prng
//   AND #$0003                        ; A in 0..3
//   BEQ skip_eor                      ; on 0, leave as 0
//   EOR #$0003                        ; else map {1,2,3} → {2,1,0}
// skip_eor:                            ; net mapping {0,1,2,3} → {0,3,2,1}
//   ASL ASL ASL                       ; A *= 8  → table-record byte stride
//   STA $15                           ; orientation byte the stamp re-reads
//   LDX #(stamp-1)>>16
//   LDA #stamp-1
//   JMP walker_setup_trampoline
//
// Spec confirms init mutates $15 (E1 → 00 in the observed run; PRNG
// happened to roll the {0} branch). $A1 zero-init is necessary because
// the stamp's last-row $A1 INC/wrap relies on a known starting value.
// ─────────────────────────────────────────────────────────────────────

function initMushroomPlatform(state: DecodeState): void {
  state.zpA1 = 0;
  // PRNG → AND #3. If non-zero, EOR with 3 (maps 1↔2, 3↔0 via XOR).
  const r = prngNext(state, RNG_SITE.initMushroomPlatform) & 0x0003;
  const mapped = r === 0 ? 0 : (r ^ 0x0003);
  // ASL ASL ASL — multiply by 8 to get the table-record byte stride.
  state.zp15 = (mapped << 3) & 0xff;
  walkerSetupTrampoline(state, mushroomPlatformStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installMushroomPlatformHandlers(): void {
  registerStdObjectHandler(0xE1, initMushroomPlatform);
}
