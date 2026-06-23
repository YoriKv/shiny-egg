// Standard objects $EE + $EF — `CODE_init_stone_3d` init handler family
// ("pipe-body shape-fixup variants of the shore_or_pool stamp").
//
// Despite the spec naming both IDs `walker_setup_trampoline`, the asm
// dispatch tables route them through a thin Bank12 wrapper at $12:A328
// that computes a nibble-parity $A1 bit AND sets `$15` to either
// $0001 (for $EE, even ID) or $FFFF (for $EF, odd ID) BEFORE jumping
// to the actual trampoline. Both then use `CODE_stone_3d_stamp`
// ($13:FBA0 / `CODE_stone_3d_stamp`) as the per-cell handler — the same one
// `bank13-lava-or-shore-pool.ts` wires up for object $20 — but with a
// non-zero $15 the stamper takes additional pipe-body fixup paths
// (`CODE_stone_3d_body_shape_select` + `CODE_stone_3d_neighbour_fixup`) that
// the $20 path explicitly skips (because $20's init clears $15 to 0).
//
// The two IDs differ only by the BMI gate inside the deep-body path:
//   $EE ($15 = $0001, positive) → runs both `pipe_body_shape_select`
//      AND `pipe_neighbour_fixup` → produces the $778C..$7793 joint
//      tiles instead of raw $79E1..$79E7 body tiles.
//   $EF ($15 = $FFFF, negative) → runs `pipe_body_shape_select` only,
//      `pipe_neighbour_fixup` is skipped by `BMI` → keeps the raw
//      $79E1..$79E7 body tiles.
//
//
// Asm references:
//   yi/Banks/Bank12.asm:5409   CODE_init_stone_3d (init wrapper)         ($12:A328)
//   yi/Banks/Bank13.asm:15013  CODE_stone_3d_stamp           ($13:FBA0)
//   yi/Banks/Bank13.asm:15081  CODE_stone_3d_cap_select               ($13:FC0F)
//   yi/Banks/Bank13.asm:15141  CODE_stone_3d_body_check_left          ($13:FC72)
//   yi/Banks/Bank13.asm:15150  CODE_stone_3d_body_check_right         ($13:FC81)
//   yi/Banks/Bank13.asm:15171  CODE_stone_3d_body_shape_select        ($13:FCAC)
//   yi/Banks/Bank13.asm:15231  CODE_stone_3d_neighbour_fixup          ($13:FD18)
//   yi/Banks/Bank13.asm:15065  DATA_stone_3d_cap_tiles            ($13:FBF7)
//   yi/Banks/Bank13.asm:15069  DATA_stone_3d_cap_tiles_alt            ($13:FBFD)
//   yi/Banks/Bank13.asm:15073  DATA_stone_3d_cap_tiles_wall         ($13:FC03)
//   yi/Banks/Bank13.asm:15077  DATA_stone_3d_cap_tiles_wall_alt     ($13:FC09)
//   yi/Banks/Bank13.asm:15163  DATA_stone_3d_body_main_tiles          ($13:FC94)
//   yi/Banks/Bank13.asm:15167  DATA_stone_3d_body_alt_tiles           ($13:FCA4)
//   yi/Banks/Bank13.asm:15227  DATA_stone_3d_joint_tiles              ($13:FD12)
//
// No GoldenEgg counterpart — ReSharper "ge" search returned zero hits
// for `PipeBody`, `ShoreOrPool`, `PipeCap`, `PipeVertical`, `Pipe`,
// `walker_setup`, or `0xEE`.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { getMap16Left, getMap16Right } from '../fetch.ts';
import { prngNext, RNG_SITE } from '../prng.ts';
import { readBuf16, setProbeToCurrent, stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Cap-row tile groups (Bank13.asm:15065-15079).
//
// Used for rows 0..2 (Y = $2C * 2 < 6) of the shore_or_pool stamper.
// Indexed by Y/2 (= row).
// ─────────────────────────────────────────────────────────────────────

const DATA_stone_3d_cap_tiles        = [0x0028, 0x0100, 0x0103] as const;
const DATA_stone_3d_cap_tiles_alt        = [0x002D, 0x010A, 0x0105] as const;
const DATA_stone_3d_cap_tiles_wall     = [0x0028, 0x9C00, 0x0103] as const;
const DATA_stone_3d_cap_tiles_wall_alt = [0x002D, 0x9C03, 0x0105] as const;

// ─────────────────────────────────────────────────────────────────────
// Body-row tile tables (Bank13.asm:15163-15169).
//
// DATA_stone_3d_body_main_tiles is 8 entries spanning the "main" body
// variants; DATA_stone_3d_body_alt_tiles is 4 entries for `$0106` →
// substitute shape branch. Both are word-indexed in cart Y-offset
// space; convert to word index by dividing the cart Y by 2.
// ─────────────────────────────────────────────────────────────────────

const DATA_stone_3d_body_main_tiles = [
  0x0108, 0x0108, 0x0108, 0x79E2, 0x79E2, 0x79E5, 0x79E5, 0x79E7,
] as const;
const DATA_stone_3d_body_alt_tiles  = [0x0106, 0x79E1, 0x79E4, 0x79E7] as const;

// Joint-replacement table for CODE_stone_3d_neighbour_fixup. Three entries
// keyed by X={0,2,4}: $0108 → $7792, $0109 → $7793, $79E7 → $0000.
const DATA_stone_3d_joint_tiles     = [0x7792, 0x7793, 0x0000] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_stone_3d_cap_select (Bank13.asm:15081 / $13:FC0F).
//
//   $04 = DATA_stone_3d_cap_tiles[y] + $A1            ; default
//   if $28 == 0 (first col):
//     if $15 == $8000 → wallet branch (no — falls through CODE_13FC4D)
//     else if $A1 != 0 → CODE_13FC60 alt branch
//   else if $28+1 == $2A (last col):
//     probe left; if edge-marker → CODE_13FC60 alt branch
//                  else → INC default
//   else (middle col):
//     if $15 == $8000 → wallet candidate
//
//   CODE_13FC60 alt branch:
//     if $15 == $8000 → DATA_stone_3d_cap_tiles_wall_alt[y]
//     else            → DATA_stone_3d_cap_tiles_alt[y]
//
// Returns the resolved 16-bit Map16 ID.
// ─────────────────────────────────────────────────────────────────────

const EDGE_MARKERS = new Set<number>([0x0029, 0x002D, 0x0101, 0x010A, 0x0104, 0x0105]);

function pipeCapSelect(state: DecodeState, y: number): number {
  const yIdx = (y >>> 1) & 0xff;
  const yClamp = Math.min(yIdx, DATA_stone_3d_cap_tiles.length - 1);
  const a1 = state.zpA1 & 0xffff;
  const orient = state.zp15 & 0xffff;
  const col = state.zp28 & 0xff;
  const colExtent = state.zp2A & 0xff;

  // Top-of-routine default ($04 = top[y] + $A1).
  let candidate = (DATA_stone_3d_cap_tiles[yClamp]! + a1) & 0xffff;

  if (col === 0) {
    // CODE_13FC4D: first column.
    if (orient === 0x8000) {
      // CODE_13FC54: wallet group.
      candidate = (DATA_stone_3d_cap_tiles_wall[yClamp]! + a1) & 0xffff;
      return candidate;
    }
    // CODE_13FC5C: not wallet — check $A1.
    if (a1 === 0) return candidate;
    // CODE_13FC60: A1 != 0 → alt branch (orient != $8000 here, so alt).
    return DATA_stone_3d_cap_tiles_alt[yClamp]!;
  }

  if (((col + 1) & 0xff) === colExtent) {
    // CODE_13FC34: last column. Probe left and dispatch.
    setProbeToCurrent(state);
    const leftOff = getMap16Left(state);
    const leftTile = readBuf16(state, leftOff) & 0xffff;
    if (EDGE_MARKERS.has(leftTile)) {
      // CODE_13FC60: alt branch.
      return orient === 0x8000
        ? DATA_stone_3d_cap_tiles_wall_alt[yClamp]!
        : DATA_stone_3d_cap_tiles_alt[yClamp]!;
    }
    // No edge match — the cart's `INC` here operates on A, which still holds the
    // PROBED LEFT-NEIGHBOUR tile (from CODE_probe_left_tile), NOT the default
    // candidate ($04). So the stamped tile is leftTile + 1, not candidate + 1.
    return (leftTile + 1) & 0xffff;
  }

  // CODE_13FC44: middle column.
  if (orient === 0x8000) {
    candidate = (DATA_stone_3d_cap_tiles_wall[yClamp]! + a1) & 0xffff;
  }
  // else: keep default (top+$A1).
  return candidate;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_stone_3d_body_check_left (Bank13.asm:15141 / $13:FC72).
//
//   if $04 == $0109 and left neighbour != $0108: $04 = $0106
// ─────────────────────────────────────────────────────────────────────

function pipeBodyCheckLeft(state: DecodeState, cand: number): number {
  if (cand !== 0x0109) return cand;
  setProbeToCurrent(state);
  const leftOff = getMap16Left(state);
  const leftTile = readBuf16(state, leftOff) & 0xffff;
  return leftTile === 0x0108 ? cand : 0x0106;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_stone_3d_body_check_right (Bank13.asm:15150 / $13:FC81).
//
//   if $04 == $0108 and right neighbour != $0109: $04 = $0106
// ─────────────────────────────────────────────────────────────────────

function pipeBodyCheckRight(state: DecodeState, cand: number): number {
  if (cand !== 0x0108) return cand;
  setProbeToCurrent(state);
  const rightOff = getMap16Right(state);
  const rightTile = readBuf16(state, rightOff) & 0xffff;
  return rightTile === 0x0109 ? cand : 0x0106;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_stone_3d_body_shape_select (Bank13.asm:15171 / $13:FCAC).
//
//   if $04 == $0106:                     (CODE_13FCD2)
//     y = (($2C-3)*1 capped: if ($2C-3) < 6 → use as-is, else PRNG-pick {4 or 6})
//     y &= 6
//     $04 = DATA_stone_3d_body_alt_tiles[y/2]
//   elif $04 in {$0109, $79E3, $79E6}:   (CODE_13FCC2)
//     probe left:
//       == $0000 || $79E7 → keep $04
//       else              → INC $04
//   else:                                (CODE_13FCF0)
//     a = PRNG & 3
//     y = (a + $2C) * 2
//     if y >= $0016: PRNG & 2; y = +$12 [+0 or +2]
//     $04 = DATA_stone_3d_body_main_tiles[(y - $06) / 2]
// ─────────────────────────────────────────────────────────────────────

function pipeBodyShapeSelect(state: DecodeState, cand: number): number {
  if (cand === 0x0106) {
    // CODE_13FCD2.
    // $2C - 3 (16-bit signed; with DEC ; DEC ; DEC produces wraparound on
    // small rows). For our case $2C is small unsigned and DEC..DEC..DEC
    // takes us into negative space → CMP #$0006 with BCC fails on negatives
    // (unsigned compare wraps), so we follow the PRNG branch when ($2C-3)
    // exceeds 5 unsigned.
    const adjusted = (state.zp2C - 3) & 0xffff;
    let y: number;
    if (adjusted < 0x0006) {
      y = adjusted;
    } else {
      // PRNG branch: A = (PRNG & $0002) + $0004 → {4, 6}.
      y = ((prngNext(state, RNG_SITE.stone3dBodyAlt) & 0x02) + 0x04) & 0xffff;
    }
    y &= 0x06;
    return DATA_stone_3d_body_alt_tiles[y >>> 1]!;
  }

  if (cand === 0x0109 || cand === 0x79E3 || cand === 0x79E6) {
    // CODE_13FCC2: store the PROBE-LEFT tile (not the candidate). The cart
    // does `JSR probe_left ; CMP #0/CMP #$79E7 BEQ store ; INC ; store` where
    // `store` is `STA $04` — A holds the probe result throughout, so $04
    // becomes the left tile ($0000 / $79E7 kept as-is) or left+1 otherwise.
    // This mirrors the odd-column body cell onto its left neighbour to form
    // the 3D pipe pair ($79E2→$79E3, $79E5→$79E6, $0108→$0109). The earlier
    // port returned `cand`/`cand+1`, collapsing every odd cell to $0109/$010A.
    setProbeToCurrent(state);
    const leftOff = getMap16Left(state);
    const leftTile = readBuf16(state, leftOff) & 0xffff;
    if (leftTile === 0x0000 || leftTile === 0x79E7) return leftTile;
    return (leftTile + 1) & 0xffff;
  }

  // CODE_13FCF0: main-table dispatch.
  //   a = PRNG & 3
  //   y = (a + $2C) * 2          ; ASL after ADC
  //   if y >= $0016 → y = (PRNG & 2) + $12 → {$12, $14}
  //   tile = DATA_stone_3d_body_main_tiles[(y - 6) / 2]
  let y2 = (((prngNext(state, RNG_SITE.stone3dBodyMain) & 0x03) + (state.zp2C & 0xff)) << 1) & 0xffff;
  if (y2 >= 0x0016) {
    y2 = ((prngNext(state, RNG_SITE.stone3dBodyMainHi) & 0x02) + 0x12) & 0xffff;
  }
  const mainIdx = ((y2 - 6) >>> 1) & 0xff;
  // Cart `LDA DATA_stone_3d_body_main_tiles-$06,y` resolves to DATA_stone_3d_body_main_tiles[(y-6)/2].
  // y ranges in {$06, $08, $0A, $0C, $0E, $10, $12, $14}, giving idx 0..7.
  // Defensive clamp in case of unexpected $2C.
  const idx = Math.min(Math.max(mainIdx, 0), DATA_stone_3d_body_main_tiles.length - 1);
  return DATA_stone_3d_body_main_tiles[idx]!;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_stone_3d_neighbour_fixup (Bank13.asm:15231 / $13:FD18).
//
//   if ($04 & $FF00) == $7700: return $04 (no fix)
//   if $04 == 0x0000 or $04 == $0106: return $04 (no fix)
//   if $04 == $0108: $04 = DATA_stone_3d_joint_tiles[0] = $7792
//   elif $04 == $0109: $04 = DATA_stone_3d_joint_tiles[1] = $7793
//   elif $04 == $79E7: $04 = DATA_stone_3d_joint_tiles[2] = $0000
//   else: $04 = ($04 - $79E1) + $778C
// ─────────────────────────────────────────────────────────────────────

function pipeNeighbourFixup(cand: number): number {
  if ((cand & 0xff00) === 0x7700) return cand;
  if (cand === 0x0000 || cand === 0x0106) return cand;
  if (cand === 0x0108) return DATA_stone_3d_joint_tiles[0]!;
  if (cand === 0x0109) return DATA_stone_3d_joint_tiles[1]!;
  if (cand === 0x79E7) return DATA_stone_3d_joint_tiles[2]!;
  // CODE_13FD49: SEC ; SBC #$79E1 ; CLC ; ADC #$778C.
  return ((cand - 0x79E1 + 0x778C) & 0xffff);
}

// ─────────────────────────────────────────────────────────────────────
// CODE_stone_3d_stamp (Bank13.asm:15013 / $13:FBA0) — full port.
//
// `bank13-lava-or-shore-pool.ts` has a $20-only variant of this routine
// that explicitly omits the `$15 != 0` branches (because $20's init
// clears $15). $EE/$EF need those branches AND the BMI gate that
// suppresses `pipe_neighbour_fixup` for negative $15.
// ─────────────────────────────────────────────────────────────────────

const shoreOrPoolStampPipeFixup: PerCellHandler = (state) => {
  const row = state.zp2C & 0xff;
  const y = (row << 1) & 0xffff;
  let candidate: number;

  if (y < 0x0006) {
    // Rows 0..2 (cap branch).
    candidate = pipeCapSelect(state, y);
  } else {
    // CODE_stone_3d_stamp_body:
    //   $04 = (($2C ^ $A1) & 1) + $0108
    candidate = (((row ^ (state.zpA1 & 0xff)) & 1) + 0x0108) & 0xffff;

    // Sub-handler dispatch based on column position:
    //   $28 == 0       → CODE_13FBCB → pipe_body_check_left  (X=0)
    //   $28+1 == $2A   → pipe_body_check_right (X=2)
    //   else           → no sub-handler (BNE skip leaves $04 alone)
    const col = state.zp28 & 0xff;
    const colExtent = state.zp2A & 0xff;
    if (col === 0) {
      candidate = pipeBodyCheckLeft(state, candidate);
    } else if (((col + 1) & 0xff) === colExtent) {
      candidate = pipeBodyCheckRight(state, candidate);
    }
    // else: middle column, no sub-handler.

    // CODE_13FBD0: $15 != 0 paths.
    const orient = state.zp15 & 0xffff;
    if (orient !== 0) {
      candidate = pipeBodyShapeSelect(state, candidate);
      // After shape_select, re-read $15 (it wasn't mutated, but cart
      // re-loads it). BMI tests the sign bit (15) of the 16-bit word.
      if ((orient & 0x8000) === 0) {
        candidate = pipeNeighbourFixup(candidate);
      }
      // else: BMI taken → skip neighbour_fixup (matches $EF: $15 = $FFFF).
    }
  }

  // CODE_stone_3d_stamp_store: at end-of-column ($2C+1 == $2E), toggle $A1.
  const rowExtent = state.zp2E & 0xff;
  if (((row + 1) & 0xff) === rowExtent) {
    state.zpA1 = (state.zpA1 ^ 0x0001) & 0xffff;
  }

  stampCell(state, candidate);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_stone_3d (Bank12.asm:5409 / $12:A328) — init wrapper for $EE/$EF.
//
//   REP #$20
//   LDA $1B ; LSR x4 ; EOR $1B ; AND #$0001 ; STA $A1   ; nibble-XOR parity
//   LDA $15 ; AND #$0001 ; EOR #$0001
//   BNE +     ; if non-zero ($15 even) → store as-is
//     DEC     ; else ($15 odd) → A becomes $FFFF
//   +: STA $15
//   LDX #(CODE_stone_3d_stamp-1)>>16 ; LDA #CODE_stone_3d_stamp-1
//   JMP walker_setup_trampoline                ; all 3 slots = shore_or_pool_stamp
//
// Effect for our two callers:
//   $EE: $15 starts 0xEE (even) → $15 = $0001 (positive, runs both
//        shape_select AND neighbour_fixup → joint tiles $778C..$7793)
//   $EF: $15 starts 0xEF (odd)  → $15 = $FFFF (negative, runs only
//        shape_select → raw body tiles $79E1..$79E7)
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0xEE, 0xEF share this handler.
const initPipeBodyFixup: InitHandler = (state) => {
  // $A1 = (($1B >> 4) XOR $1B) & 1.
  state.zpA1 = (((state.zp1B >>> 4) ^ state.zp1B) & 0x0001);

  // $15 = (($15 & 1) ^ 1) ? 0x0001 : 0xFFFF.
  // Equivalent: $EE (even) → 0x0001; $EF (odd) → 0xFFFF.
  const lsbInverted = ((state.zp15 & 0x0001) ^ 0x0001) & 0xffff;
  state.zp15 = lsbInverted !== 0 ? lsbInverted : 0xffff;

  walkerSetupTrampoline(state, shoreOrPoolStampPipeFixup);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent (object-decode/index.ts) wires this in via the
// installer entry point.
// ─────────────────────────────────────────────────────────────────────

export function installStone3dHandlers(): void {
  registerStdObjectHandler(0xEE, initPipeBodyFixup);
  registerStdObjectHandler(0xEF, initPipeBodyFixup);
}
