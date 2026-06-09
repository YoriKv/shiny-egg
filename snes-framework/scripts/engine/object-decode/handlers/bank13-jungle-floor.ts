// Standard object $21 — init_jungle_floor.
//
// Cart entry: CODE_init_jungle_floor @ $12:94EA (yi/Banks/Bank12.asm:3264).
// Per-cell stamp handler: CODE_jungle_floor @ $13:9001 (yi/Banks/Bank13.asm:2020).
// Helper sub-routines:
//   CODE_jungle_floor_row0_blend @ $13:90EE (Bank13.asm:2154)
//   CODE_jungle_floor_row1_blend @ $13:906F (Bank13.asm:2086)
//
// Multi-row dispatcher for the dense foliage-floor pattern used by the
// world-1 jungle levels. The top row (row 0) picks a "seed" variant via
// PRNG and consults a blend helper that checks the cell below for an
// already-stamped jungle-page tile; row 1 runs a similar blend that
// also probes left/right neighbours; rows 2+ stamp a base tile (or
// PRNG-selected variant) from a flat 16-entry foliage table. The init
// just zeroes the cross-cell seed slot ($A1) and tail-calls the walker
// trampoline — slope is 0, all 3 handler slots get the same stamp
// routine.
//
// First port of the jungle family ($21-$36). Parent will consolidate
// shared jungle tables / blend helpers when the rest of the family
// lands; for now everything lives in this file.
//
// asm primary; goldenegg notes consulted only as cross-reference and
// found no contradictions.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { getMap16Below } from '../fetch.ts';
import { prngNext } from '../prng.ts';
import {
  stampCell,
  writeBuf16,
  stampAboveTile,
  stampBelowTile,
  stampLeftTile,
  stampRightTile,
  jungleFloorRandomBody,
} from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Stamp-handler tile tables (Bank13.asm:2000-2008).
//
//   DATA_138FCF: 6 "already-jungle-floor" tiles. Per-cell handler
//     short-circuits (no stamp) when the existing $12 matches one of
//     these — the cell is already part of a neighbouring jungle floor
//     and we don't want to clobber it. These cover the row-0/1/2
//     seam tiles that the row0/row1 blend helpers stamp into adjacent
//     cells. Layout: top-of-page $9072/$9073, $907F, $908F, $90A2/$90A3.
//
//   DATA_138FDB: 3 base tiles for rows 0/1/2 (indexed by Y = row*2).
//     Row 0 → $9200, Row 1 → $9080, Row 2 → $9090.
//     Caller adds $A1 (= prng & 3 latched at row 0) to pick variant
//     0..3 of the row's base ($9200..$9203, $9080..$9083, $9090..$9093).
//
//   DATA_138FE1: 16 entries for the row-3+ random-foliage body. Stamped
//     directly without offset. Mostly $906A-$9071 (8 distinct foliage
//     variants, with $906D appearing 5 times for higher pick weight).
//     Hoisted to ./_shared.ts as DATA_jungle_foliage_pool and consumed
//     via the shared jungleFloorRandomBody helper.
// ─────────────────────────────────────────────────────────────────────

const DATA_138FCF = [0x9072, 0x9073, 0x907F, 0x908F, 0x90A2, 0x90A3] as const;
const DATA_138FDB = [0x9200, 0x9080, 0x9090] as const;

// ─────────────────────────────────────────────────────────────────────
// Row-0 blend tables (Bank13.asm:2145-2152).
//
// CODE_jungle_floor_row0_blend probes the cell BELOW. If the below cell
// belongs to the jungle-floor mid-row family ($94xx or $95xx), the
// helper stamps an "edge override" pair into the two cells DIRECTLY
// BELOW the current cell (the down-step plus one tile to its right —
// the cart shifts the second probe's X coord by +$10 in the screen-X
// nibble). Y selects between the two columns:
//
//   Y=0  → "below current is $94xx"  ($9500/$90A3/$9073)
//   Y=2  → "below current is $95xx"  ($9402/$90A2/$9072)
//
// X register on return:
//   $FFFF = "no blend happened, fall through to template match"
//   else  = the override tile to stamp directly at the current cell
//           (DATA_1390E3 entries — see asm).
//
// The body-stamp pair is at $1390E7 ($90A3/$90A2) + $1390EB ($9073/$9072).
// ─────────────────────────────────────────────────────────────────────

const DATA_1390E3 = [0x9500, 0x9402] as const;
const DATA_1390E7 = [0x90A3, 0x90A2] as const;
const DATA_1390EB = [0x9073, 0x9072] as const;

// ─────────────────────────────────────────────────────────────────────
// Row-1 blend tables (Bank13.asm:2074-2084).
//
// CODE_jungle_floor_row1_blend probes the cell ABOVE. If above belongs
// to the jungle-floor top-row family ($94xx or $95xx), the helper
// stamps a 3-tile seam-fix:
//   - replacement above current     → DATA_139063,y
//   - replacement below current     → DATA_139067,y
//   - replacement left/right of cur → DATA_13906B,y  (left if Y=0, right if Y=2)
// Y is chosen by an extra column-edge check: Y=0 for left edge,
// Y=2 for right edge ($28+1 == $2A).
//
// X register on return:
//   $FFFF = no blend; caller falls through to template match
//   else  = DATA_13905F,y  ← per-row-1 override tile to stamp at current.
// ─────────────────────────────────────────────────────────────────────

const DATA_13905F = [0x330D, 0x3512] as const;
const DATA_139063 = [0x9204, 0x9205] as const;
const DATA_139067 = [0x908F, 0x907F] as const;
const DATA_13906B = [0x964D, 0x964E] as const;

const MAP16_PAGE_94XX = 0x9400;
const MAP16_PAGE_95XX = 0x9500;
const BLEND_NONE = 0xFFFF;

// ─────────────────────────────────────────────────────────────────────
// CODE_jungle_floor_row0_blend ($13:90EE, Bank13.asm:2154).
//
// Probes the existing $12 page byte: $94xx → Y=0, $95xx → Y=2, else
// returns BLEND_NONE. If hit, applies an edge-aware check ($28 == 0 or
// $28 == $2A-1 → fall through to BLEND_NONE), otherwise stamps the
// two-cell "row-0 staircase below" into the buffer and returns the
// row-0 override tile for the current cell.
//
// Returns: the Map16 ID to stamp at the current cell (caller stamps
//   via $1D), or BLEND_NONE for "no stamp here, fall through to the
//   template-match search loop".
// ─────────────────────────────────────────────────────────────────────
function jungleFloorRow0Blend(state: DecodeState): number {
  // CODE_jungle_floor entry gate: the page test on $12 is just a yes/no for
  // entering CODE_139105. The page-test X (0 or 2) is then DISCARDED —
  // CODE_139105 reloads X=0 and decides 0-vs-2 purely from the column
  // counter $28. So we only need to check whether the page matched.
  const page = state.zp12 & 0xff00;
  if (page !== MAP16_PAGE_94XX && page !== MAP16_PAGE_95XX) {
    return BLEND_NONE;
  }

  // CODE_139105: edge check on column counter.
  //   $28 == 0       → X=0 (left edge)
  //   $28+1 == $2A   → X=2 (right edge)
  //   else           → BLEND_NONE
  const col = state.zp28 & 0xff;
  let x: 0 | 2;
  if (col === 0) {
    x = 0;
  } else if (((col + 1) & 0xff) === (state.zp2A & 0xff)) {
    x = 2;
  } else {
    return BLEND_NONE;
  }

  const idx = x >>> 1;
  const overrideTile = DATA_1390E3[idx]!;
  const belowTileA  = DATA_1390E7[idx]!;
  const belowTileB  = DATA_1390EB[idx]!;

  // Probe one cell below the current cell, stamp DATA_1390E7,x.
  stampBelowTile(state, belowTileA);

  // Re-probe with $0E bumped by +$10 in screen-X nibble (cart pattern:
  // LDA $1B ; AND #$F0F0 ; CLC ; ADC #$0010 ; AND #$F0F0 ; STA $00 ;
  //  LDA $1B ; AND #$0F0F ; ORA $00 ; STA $0E). Compose from both
  // bytes so an overflow from screen-X $F → wrap into screen-Y of the
  // high byte is handled correctly (and the high byte ends up in the
  // 16-bit zp0E word, where the fetch primitives read it).
  const word1B = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  const sub  = word1B & 0x0F0F;
  const high = ((word1B & 0xF0F0) + 0x0010) & 0xF0F0;
  state.zp0E = (high | sub) & 0xffff;
  state.zp0F = (state.zp0E >>> 8) & 0xff;
  // Custom-probe neighbour write: the $0E +$10 bump above means we can't use
  // stampBelowTile (it re-probes from the current cell, erasing the bump) —
  // write the fetched offset directly via the shared writeBuf16 primitive.
  const belowOff = getMap16Below(state);
  writeBuf16(state, belowOff, belowTileB);

  return overrideTile;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_jungle_floor_row1_blend ($13:906F, Bank13.asm:2086).
//
// Mirror of row0_blend for row 1. Probes the cell ABOVE (page test
// against $94xx / $95xx), then runs an extra inner column-edge check:
//   $28 == 0       → inner-X = 0
//   $28+1 == $2A   → inner-X = 2
//   else           → BLEND_NONE
// On match, stamps an above-replacement + below-replacement + left or
// right neighbour replacement, and returns DATA_13905F,y as the row-1
// override Map16 ID for the current cell.
// ─────────────────────────────────────────────────────────────────────
function jungleFloorRow1Blend(state: DecodeState): number {
  // Page-test on $12 produces X=0 ($94xx) or X=2 ($95xx); else BLEND_NONE.
  // Unlike row0_blend, row1_blend DOES use the page-test result — it
  // indexes DATA_13905F by it for the override tile.
  const page = state.zp12 & 0xff00;
  let pageIdx: 0 | 1;
  if (page === MAP16_PAGE_94XX) {
    pageIdx = 0;
  } else if (page === MAP16_PAGE_95XX) {
    pageIdx = 1;
  } else {
    return BLEND_NONE;
  }

  // CODE_139088 entry: LDA DATA_13905F,y ; STA $04 (saved override tile).
  const overrideTile = DATA_13905F[pageIdx]!;

  // Inner column-edge check.
  const col = state.zp28 & 0xff;
  let innerIdx: 0 | 1;
  if (col === 0) {
    innerIdx = 0;
  } else if (((col + 1) & 0xff) === (state.zp2A & 0xff)) {
    innerIdx = 1;
  } else {
    return BLEND_NONE;
  }

  const aboveTile = DATA_139063[innerIdx]!;
  const belowTile = DATA_139067[innerIdx]!;
  const sideTile  = DATA_13906B[innerIdx]!;

  // Stamp the seam-fix tiles into the above / below / side neighbour cells.
  stampAboveTile(state, aboveTile);   // DATA_139063,x
  stampBelowTile(state, belowTile);   // DATA_139067,x
  if (innerIdx === 0) stampLeftTile(state, sideTile);   // DATA_13906B,x (left)
  else stampRightTile(state, sideTile);                 // DATA_13906B,x (right)

  return overrideTile;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_jungle_floor ($13:9001, Bank13.asm:2020) — per-cell handler.
//
// Dispatch by row counter $2C:
//   row 0:   prng-roll → $A1 (seed for the entire object), then run
//            row0_blend; if it returns BLEND_NONE → fall through to
//            template-match (search DATA_138FCF; if no match, stamp
//            DATA_138FDB[0] + $A1 = $9200..$9203).
//   row 1:   run row1_blend; same BLEND_NONE / template-match logic.
//            Template-match stamps DATA_138FDB[1] + $A1 = $9080..$9083.
//   row 2:   no blend; template-match stamps DATA_138FDB[2] + $A1 =
//            $9090..$9093.
//   row 3+:  random body — prng + $2C, AND $1E, index DATA_138FE1 as
//            words → stamp.
//
// "Template-match" loop scans DATA_138FCF for the current cell's $12.
// On hit → don't stamp (cell is already a valid jungle-floor tile).
// On miss → stamp the row's base + variant seed.
//
// Note: per asm, the random-body branch uses `ADC $2C` with NO `CLC`
// — the carry from CODE_prng is whatever happens to be set after the
// HV-counter math, which our deterministic LFSR port can't replicate.
// We use `(prngNext + row) & $1E`; the variant pick will be byte-stable
// across our runs but won't exactly match a specific cart-snapshot trace.
// Cosmetic-only impact (foliage variant within the 16-entry pool).
// ─────────────────────────────────────────────────────────────────────
const jungleFloorStamp: PerCellHandler = (state) => {
  const row = state.zp2C & 0xffff;

  // Row 3+ random body — shared with $24 mud floor and $27/$28 slope45.
  if (row >= 0x0003) {
    jungleFloorRandomBody(state);
    return;
  }

  // Row 0 only: prng-roll a per-object 4-way seed into $A1.
  let y: 0 | 2 | 4; // row << 1
  if (row === 0) {
    y = 0;
    state.zpA1 = prngNext(state) & 0x0003;
  } else if (row === 1) {
    y = 2;
  } else {
    y = 4;
  }

  // Row 0/1 blend; row 2 has no blend (Y == 4 → skip).
  let blendOverride = BLEND_NONE;
  if (row === 0) {
    blendOverride = jungleFloorRow0Blend(state);
  } else if (row === 1) {
    blendOverride = jungleFloorRow1Blend(state);
  }

  // CODE_jungle_floor_template_match: if blend returned a real tile,
  // skip the search loop and just stamp it. Note the asm's CPX #$FFFF
  // path: a blend hit puts an X != $FFFF, control falls THROUGH the
  // CODE_139030 search loop entry (X stays as the blend's stamp tile),
  // then LDX $1D ; STA buffer,x stamps the override.
  if (blendOverride !== BLEND_NONE) {
    stampCell(state, blendOverride);
    return;
  }

  // Template-match search: scan DATA_138FCF for $12; if hit → no stamp.
  const cur = state.zp12 & 0xffff;
  for (const probe of DATA_138FCF) {
    if (cur === probe) return;
  }

  // No match: stamp DATA_138FDB[y>>1] + $A1 variant seed.
  const base = DATA_138FDB[y >>> 1]!;
  stampCell(state, (base + (state.zpA1 & 0xffff)) & 0xffff);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_jungle_floor ($12:94EA, Bank12.asm:3264).
//
// Tiny init: clear $A1 (cleared again on row 0's prng-roll inside the
// stamp handler — the explicit clear here keeps $A1 deterministic if
// the object somehow stamps row 2 first), then tail into the standard
// walker trampoline with CODE_jungle_floor as the per-cell handler.
// ─────────────────────────────────────────────────────────────────────
function initJungleFloor(state: DecodeState): void {
  state.zpA1 = 0;
  walkerSetupTrampoline(state, jungleFloorStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent wires this into object-decode/index.ts as the
// rest of the jungle family ($22-$36) lands.
// ─────────────────────────────────────────────────────────────────────
export function installJungleFloorHandlers(): void {
  registerStdObjectHandler(0x21, initJungleFloor);
}
