// Standard object $35 — init_jungle_water.
//
// Cart entry: CODE_init_jungle_water @ $12:95EE (yi/Banks/Bank12.asm:3427).
// Per-cell stamp handler: CODE_jungle_water @ $13:99F9 (yi/Banks/Bank13.asm:3559).
//
// Jungle-tinted waterline. Shape: a rectangle whose top 2 rows form a
// 4-column-repeating waterline pattern (with PRNG variant selection),
// and whose row 2+ is the flat "underwater" tile $1628. Row 0 and 1
// stamps are also gated by the current cell's existing Map16 page —
// if the cell already holds foliage ($90xx) / jungle border ($93xx)
// / platform-tip ($6B00) / jungle-floor mid-row ($94xx/$95xx), an
// overlay tile is substituted to keep the waterline visually coherent
// with the underlying terrain.
//
//   - col extent: $0010 (16 wide); row extent: $0003 (3 tall)
//   - orientation byte ($15): $35 → $00 (init zeroes $15)
//   - all 3 walker handler slots → CODE_jungle_water @ $1399F8(-1)
//   - 48 cells stamped, output Map16: $1619,$161A,$161B,$161C,
//     $1626,$1627,$1628 (no overrides exercised — placement cells
//     are all empty in the trace fixture).
//
// asm primary; goldenegg notes consulted only as cross-reference and
// found no contradictions.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { prngNext } from '../prng.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Waterline tile tables (Bank13.asm:3539-3549).
//
//   DATA_1399D9: 4 waterline tiles for the "even-variant" 2x2 pattern.
//     row 0: $1619 (col0), $161A (col1)
//     row 1: $1626 (col0), $1627 (col1)
//
//   DATA_1399E1: 4 waterline tiles for the "odd-variant" 2x2 pattern.
//     row 0: $161B (col0), $161C (col1)
//     row 1: $1628 (col0), $1628 (col1)
//
//   DATA_1399E9: 4-entry pointer table indexed by `$15` (in
//     {$00,$02,$04,$06}) — picks which of the two patterns to use
//     for the current column pair. Entries 0/2/3 → DATA_1399E1 (odd),
//     entry 1 → DATA_1399D9 (even). So PRNG `$15==$02` is the only
//     "even" pick; the other 3 of 4 PRNG outcomes give the odd pattern.
//
//   DATA_1399F1: 4 waterline-overlay tiles used when the existing
//     cell is in the foliage ($90xx) page family and row 1 is at the
//     "mid waterline" position. Picked by PRNG `$15 & $0006`.
// ─────────────────────────────────────────────────────────────────────

const DATA_1399D9 = [0x1619, 0x161A, 0x1626, 0x1627] as const; // "even" pattern
const DATA_1399E1 = [0x161B, 0x161C, 0x1628, 0x1628] as const; // "odd" pattern
const DATA_1399E9 = [DATA_1399E1, DATA_1399D9, DATA_1399E1, DATA_1399E1] as const;
const DATA_1399F1 = [0x9098, 0x9099, 0x909A, 0x9098] as const;

// Map16 page sentinels read from the existing cell ($12). The cart
// uses high-byte comparisons (`AND #$FF00 ; CMP #$xx00`) — pages, not
// individual tiles.
const PAGE_PLATFORM_TIP = 0x6B00; // jungle platform tip → foliage overlay path
const PAGE_JUNGLE_BORDER = 0x9300; // jungle border → foliage overlay path
const PAGE_FOLIAGE_BASE = 0x9000; // foliage top → foliage overlay path
const PAGE_JUNGLE_FLOOR_MID_94 = 0x9400; // jungle-floor mid (variant A) → $9700/$9701
const PAGE_JUNGLE_FLOOR_MID_95 = 0x9500; // jungle-floor mid (variant B) → $9800/$9801

// Row 2+ flat underwater body tile (cart `LDA #$1628 ; BRA stamp`).
const TILE_UNDERWATER_FLAT = 0x1628;

// Foliage-overlay-path constants (CODE_139A43 subtree).
const TILE_FOLIAGE_OVERLAY_TOP = 0x9061; // row 0 cap
const TILE_FOLIAGE_OVERLAY_BODY = 0x909B; // row >= 2 body
const TILE_JUNGLE_FLOOR_94_OVERLAY = 0x9700; // $94xx, row 0
const TILE_JUNGLE_FLOOR_95_OVERLAY = 0x9800; // $95xx, row 0
// Row 1+ adds +1 to either of the above — see CODE_139A77 (BEQ skips INC).

// ─────────────────────────────────────────────────────────────────────
// CODE_jungle_water ($13:99F9, Bank13.asm:3559) — per-cell handler.
//
// Phase 1: pick a "base" tile A from the per-pattern tables.
//   row >= 2  →  A = $1628 (flat underwater)
//   row == 1  →  A = DATA_1399E9[$15>>1][row*2 + col_parity]  (no prng roll)
//   row == 0  →  on even column ($28 bit 0 == 0): prng-roll
//                  new $15 = prng & $0006, then read the same table.
//                on odd column: reuse the latched $15 from the prior
//                  even-column cell. (This is how every column-pair
//                  ends up using the same variant pattern, and how
//                  consecutive pairs randomise independently.)
//
// Phase 2: apply optional override based on the existing cell's
// Map16 page ($12 & $FF00):
//   $6B00 / $9300 / $90xx ("foliage overlay" path, CODE_139A43):
//     STZ $15 (clear latched variant — the foliage overlay path
//     resets state so a downstream column-pair starts fresh)
//     row == 0  → A = $9061  (foliage cap)
//     row == 1  → A = DATA_1399F1[(prng & $0006) >> 1]
//     row >= 2  → A = $909B  (foliage body)
//   $9400 ("jungle floor mid" variant A): A = $9700 (+1 if row > 0)
//   $9500 ("jungle floor mid" variant B): A = $9800 (+1 if row > 0)
//   otherwise: keep A from Phase 1.
//
// Phase 3: stamp A at the current cell.
//
// Trace observation: in the std-35 fixture the existing $12 is always
// $0000, so Phase 2 always falls through to "keep A". The overlay
// paths are exercised when the object is placed on top of jungle
// terrain — common in world-1 cave/lake stages.
// ─────────────────────────────────────────────────────────────────────
const jungleWaterStamp: PerCellHandler = (state) => {
  // REP #$30 ; LDA $28 ; AND #$0001 ; STA $00 — column parity.
  const colParity = state.zp28 & 0x0001;
  state.zp00 = colParity;

  // Phase 1: pick base tile A from per-pattern tables (or use the
  // flat row-2+ fallback).
  let a: number;
  const row = state.zp2C & 0xff;
  if (row >= 2) {
    // LDA #$1628 ; BRA stamp_epilogue
    a = TILE_UNDERWATER_FLAT;
  } else {
    // Row 0 even-column path: prng-roll a new $15 in {$00,$02,$04,$06}.
    // CODE_139A10: LDA $00 ; BNE table_pick — odd-column skips the prng.
    if (row === 0 && colParity === 0) {
      state.zp15 = prngNext(state) & 0x0006;
    }
    // CODE_139A1D: LDX $15 ; LDA DATA_1399E9,x ; STA $02 ;
    //              LDA $2C ; ASL ; ADC $00 ; ASL ; TAY ; LDA ($02),y
    // $15 is a byte index into a word table → divide by 2 for our
    // pointer table; inner index is (row*2 + col_parity)*2 / 2 (words).
    const tablePtr = DATA_1399E9[(state.zp15 & 0x0006) >>> 1]!;
    const innerIdx = (row * 2) + colParity; // {0,1,2,3}
    a = tablePtr[innerIdx]!;
  }

  // Phase 2: page-based override (CODE_139A2D onward).
  //
  // CMP order from asm: $6B00 → $9300 → $9000 (all → CODE_139A43);
  // then $9400 → $9500. The $9000 check is `CMP #$9000` which only
  // matches the exact $90xx page (the foliage top-row family), not
  // $94xx / $95xx — those have their own branches.
  const page = state.zp12 & 0xff00;
  if (
    page === PAGE_PLATFORM_TIP ||
    page === PAGE_JUNGLE_BORDER ||
    page === PAGE_FOLIAGE_BASE
  ) {
    // CODE_139A43 — foliage overlay path. STZ $15 first.
    state.zp15 = 0;
    if (row === 0) {
      // CODE_139A4B: LDA #$9061
      a = TILE_FOLIAGE_OVERLAY_TOP;
    } else if (row < 2) {
      // CODE_139A4E: prng-roll, AND #$0006, index DATA_1399F1.
      // Note: row==1 here.
      const idx = (prngNext(state) & 0x0006) >>> 1;
      a = DATA_1399F1[idx]!;
    } else {
      // CODE_139A60: LDA #$909B (row >= 2 foliage body).
      a = TILE_FOLIAGE_OVERLAY_BODY;
    }
  } else if (page === PAGE_JUNGLE_FLOOR_MID_94) {
    // CODE_139A74: LDA #$9700 ; (LDY $2C ; BEQ → skip INC ; else INC)
    a = TILE_JUNGLE_FLOOR_94_OVERLAY + (row === 0 ? 0 : 1);
  } else if (page === PAGE_JUNGLE_FLOOR_MID_95) {
    // CODE_139A6A: LDA #$9800 ; (LDY $2C ; BEQ → skip INC ; else INC)
    a = TILE_JUNGLE_FLOOR_95_OVERLAY + (row === 0 ? 0 : 1);
  }

  // Phase 3: STA $00 ; LDX $1D ; STA buffer,x ; SEP #$30 ; RTL.
  stampCell(state, a & 0xffff);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_jungle_water ($12:95EE, Bank12.asm:3427).
//
// Cart (verbatim):
//   REP #$20
//   STZ $15
//   LDX #(CODE_jungle_water-$01)>>16
//   LDA #CODE_jungle_water-$01
//   JMP CODE_walker_setup_trampoline
//
// Effect: clear $15 (so the stamp handler's row-0 even-column prng
// roll is the first thing to write a non-zero variant index), then
// tail into the standard walker trampoline. Spec confirms the DP-diff
// table: only $15 changes ($35 → $00), nothing else.
// ─────────────────────────────────────────────────────────────────────
function initJungleWater(state: DecodeState): void {
  state.zp15 = 0;
  walkerSetupTrampoline(state, jungleWaterStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Object $35 (jungle-tinted waterline) shares its
// "page-aware override" idiom with the rest of the water family
// ($16-$1E), but the table layout (4-pointer indirection + PRNG-driven
// variant index in $15) is unique. If a future water-family
// consolidation extracts a common "page-aware overlay" mini-DSL, this
// handler is a candidate caller; for now it stays self-contained.
// ─────────────────────────────────────────────────────────────────────
export function installJungleWaterHandlers(): void {
  registerStdObjectHandler(0x35, initJungleWater);
}
