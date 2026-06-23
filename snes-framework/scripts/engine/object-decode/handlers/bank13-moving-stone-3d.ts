// Bank13 enterable-pipe stamp + Bank12 init wrapper.
//
// Covers standard objects $F0, $F1, $F2, $F3 — the four warp-pipe
// orientations (right / down / up / left). All four IDs route through
// the same `CODE_init_moving_stone_3d` ($12:A350) and the same
// Bank13 per-cell stamp `CODE_stone_3d_stamp` (alias of
// `CODE_stone_3d_stamp` at $13:FBA0). The per-orientation
// difference is captured in the `DATA_moving_stone_3d_amplitudes` byte that the
// cart writes into the enterable-pipe table at $70:449E for the
// gameplay code to consume (entrance direction at runtime).
//
//
// Asm references:
//   yi/Banks/Bank12.asm:5430  DATA_moving_stone_3d_amplitudes             ($12:A34C)
//   yi/Banks/Bank12.asm:5435  CODE_init_moving_stone_3d ($12:A350)
//   yi/Banks/Bank13.asm:15013 CODE_stone_3d_stamp          ($13:FBA0)
//                             (alias of CODE_stone_3d_stamp)
//   yi/Banks/Bank13.asm:15065 DATA_stone_3d_cap_tiles           ($13:FBF7)
//   yi/Banks/Bank13.asm:15069 DATA_stone_3d_cap_tiles_alt           ($13:FBFD)
//   yi/Banks/Bank13.asm:15073 DATA_stone_3d_cap_tiles_wall        ($13:FC03)
//   yi/Banks/Bank13.asm:15077 DATA_stone_3d_cap_tiles_wall_alt    ($13:FC09)
//   yi/Banks/Bank13.asm:15081 CODE_stone_3d_cap_select              ($13:FC0F)
//   yi/Banks/Bank13.asm:15141 CODE_stone_3d_body_check_left         ($13:FC72)
//   yi/Banks/Bank13.asm:15150 CODE_stone_3d_body_check_right        ($13:FC81)
//   yi/Banks/Bank13.asm:15163 DATA_stone_3d_body_main_tiles         ($13:FC94)
//   yi/Banks/Bank13.asm:15167 DATA_stone_3d_body_alt_tiles          ($13:FCA4)
//   yi/Banks/Bank13.asm:15171 CODE_stone_3d_body_shape_select       ($13:FCAC)
//   yi/Banks/Bank13.asm:15227 DATA_stone_3d_joint_tiles             ($13:FD12)
//   yi/Banks/Bank13.asm:15231 CODE_stone_3d_neighbour_fixup         ($13:FD18)
//
// Init pseudocode ($12:A350, REP/SEP per cart):
//   ; Pack {sub_x_nibble, sub_y_nibble, page_x_nibble, page_y_nibble} of
//   ; (X=$1B, Y=$1C) into two bytes ($00, $02) — the locX/locY pair that
//   ; the enterable-pipe gameplay code consumes.
//   ;
//   ; Search $70449E table (12 slots, 6-byte stride) for an empty entry
//   ; via the $7044A0,x ($2A-1 field) slot==0 probe; clamp to last slot
//   ; on overflow.
//   ;
//   ; Write {locX, locY, $2A-1, $2E-1, dir-byte} into the slot, where
//   ; dir-byte = DATA_moving_stone_3d_amplitudes[$15 & $0F]:
//   ;   $F0 -> $20 (right), $F1 -> $40 (down),
//   ;   $F2 -> $E0 (up),    $F3 -> $C0 (left).
//   ;
//   ; Derive $A1 = (lo_nibble($1B) ^ hi_nibble($1B)) & 1 — parity bit
//   ; that selects the "even" vs "odd" column variant for the cap row
//   ; (DATA_pipe_cap_tiles_*[y] + $A1).
//   ;
//   ; Set $15 = $8000 (selects DATA_stone_3d_cap_tiles_wall path in
//   ; pipe_cap_select; also gates neighbour_fixup via BMI).
//   ;
//   ; All four orientations leave the walker fields ($1B/$1C/$2A/$2E)
//   ; unchanged — per spec DP-diff only $15 changes (F0..F3 → 00 at the
//   ; byte level, since $8000 stored low-byte-first leaves $15=$00,
//   ; $16=$80 in the cart's WRAM; we model it as 16-bit `state.zp15 =
//   ; 0x8000`).
//
// Per-cell stamp ($13:FBA0, REP #$30):
//   Y = $2C * 2 (byte offset into 3-entry word tables)
//   if Y < 6: cap_row branch (rows 0..2) → JSR pipe_cap_select
//   else:     body branch (rows 3+)      → see below
//   store $04 into LevelDataBuffer[$1D]
//   if (row + 1) == $2E: toggle $A1 (end-of-column flip)
//
// Body branch (CODE_stone_3d_stamp_body):
//   $04 = $0108 + (($2C ^ $A1) & 1)
//   X = 0
//   if col == 0:          JSR (DATA_stone_3d_body_subhandlers,x)  ; X=0 → check_left
//   else if col+1 == $2A: X = 2 ; JSR (...)                    ; X=2 → check_right
//   else:                 skip check
//   then: if $15 != 0: JSR pipe_body_shape_select
//         if $15 not negative: JSR pipe_neighbour_fixup
//
// For our $15 = $8000:
//   $15 != 0 → shape_select always runs
//   $15 high bit set → neighbour_fixup skipped (BMI taken)
// So for $F0-$F3 we can omit the neighbour_fixup branch entirely.
//
// PRNG sites (shared with bank13-stone-3d.ts — same cart routine):
//   `CODE_stone_3d_body_shape_select` calls `JSL CODE_prng` then `AND #$0002`
//   or `AND #$0003` before mixing into Y. The cart's `ADC $2C` IS preceded by
//   an explicit `CLC` (verified in Bank13.asm: `AND #$0003 ; CLC ; ADC $2C`),
//   so `(prng&3)+$2C` is exact — no carry-in uncertainty. The three rolls are
//   tagged with `RNG_SITE.stone3dBody{Alt,Main,MainHi}` (cart PCs $13FCE0 /
//   $13FCF4 / $13FD04) for per-site replay against a `bg1-render` capture, which
//   reproduces the live variant pick exactly. Untagged, they fall to the LFSR
//   and the cosmetic variant differs from a specific cart-snapshot trace.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { prngNext, RNG_SITE } from '../prng.ts';
import { probeLeftTile, probeRightTile, stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Tile tables — DATA_pipe_cap_tiles_* (3 words each, used by
// CODE_stone_3d_cap_select). Indexed by byte offset Y = row*2 (rows 0..2).
// ─────────────────────────────────────────────────────────────────────

// DATA_stone_3d_cap_tiles — "plain" cap (no wall embed, no rotated variant).
const DATA_stone_3d_cap_tiles         = [0x0028, 0x0100, 0x0103] as const;
// DATA_stone_3d_cap_tiles_alt — alt cap (selected when neighbour-fix triggers and $15 != $8000).
const DATA_stone_3d_cap_tiles_alt         = [0x002D, 0x010A, 0x0105] as const;
// DATA_stone_3d_cap_tiles_wall — wallet (wall-embedded) cap — selected when $15 == $8000.
const DATA_stone_3d_cap_tiles_wall      = [0x0028, 0x9C00, 0x0103] as const;
// DATA_stone_3d_cap_tiles_wall_alt — wallet-alt — selected when last-col neighbour probe
// matches one of the pipe-edge tiles AND $15 == $8000.
const DATA_stone_3d_cap_tiles_wall_alt  = [0x002D, 0x9C03, 0x0105] as const;

// ─────────────────────────────────────────────────────────────────────
// Tile tables — DATA_pipe_body_*  (consumed by CODE_stone_3d_body_shape_select).
// ─────────────────────────────────────────────────────────────────────

// DATA_stone_3d_body_main_tiles — 8-entry main body tile table. Indexed by word index
// `(Y - 6) / 2`; the cart's `LDA DATA_stone_3d_body_main_tiles-$06,y` lets it index from
// byte offset 6 directly.
const DATA_stone_3d_body_main_tiles = [
  0x0108, 0x0108, 0x0108, 0x79E2,
  0x79E2, 0x79E5, 0x79E5, 0x79E7,
] as const;
// DATA_stone_3d_body_alt_tiles — 4-entry alt body table (used when $04 == $0106).
const DATA_stone_3d_body_alt_tiles  = [0x0106, 0x79E1, 0x79E4, 0x79E7] as const;

// ─────────────────────────────────────────────────────────────────────
// DATA_moving_stone_3d_amplitudes (Bank12.asm:5430).
// Indexed by $15 & $0F at init time (objects $F0..$F3 set $15 to their
// ID before dispatch, so the low nibble is the orientation 0..3).
// The cart stores this byte into the enterable-pipe table at $70:449E+4
// (slot offset 4); the editor doesn't model runtime gameplay state so
// we capture it as a constant for documentation / parity only.
// ─────────────────────────────────────────────────────────────────────

const DATA_moving_stone_3d_amplitudes = [0x20, 0x40, 0xE0, 0xC0] as const;
void DATA_moving_stone_3d_amplitudes; // unused at decode time; here for documentation parity.

// ─────────────────────────────────────────────────────────────────────
// Probe helpers — `probeLeftTile` / `probeRightTile` (ports of cart
// CODE_probe_left_tile / CODE_probe_right_tile at $13:FD54 / $13:FD61)
// are imported from `_shared.ts`. Each sets $0E/$0F to the walker's
// current cell then calls get_map16_(left|right) and reads the buffer
// word at the returned offset.
//
// Callers compare the returned tile against a small set of "is the cell
// to my side a pipe-edge?" sentinel values.
// ─────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────
// CODE_stone_3d_cap_select ($13:FC0F, Bank13.asm:15081).
//
// Picks a tile from the four DATA_pipe_cap_tiles_* tables based on
// (col-position, $15, $A1, last-col probe-left). Returns the tile by
// writing to $04 (which the caller's store-epilogue then commits to
// LevelDataBuffer).
//
// Decision tree (Y = row * 2, $15 is 16-bit):
//   base = DATA_stone_3d_cap_tiles[Y/2] + $A1       ; default $04
//   if col == 0:
//     if $15 == $8000: $04 = DATA_stone_3d_cap_tiles_wall[Y/2] + $A1
//     else if $A1 != 0:
//       if $15 == $8000: $04 = DATA_stone_3d_cap_tiles_wall_alt[Y/2]
//       else:            $04 = DATA_stone_3d_cap_tiles_alt[Y/2]
//     else:              (leave default)
//   else if col+1 == $2A:                              ; last col
//     probe = probe_left_tile()
//     if probe in {$0029,$002D,$0101,$010A,$0104,$0105}:
//       if $15 == $8000: $04 = DATA_stone_3d_cap_tiles_wall_alt[Y/2]
//       else:            $04 = DATA_stone_3d_cap_tiles_alt[Y/2]
//     else:
//       $04 = probe + 1
//   else:                                              ; interior col
//     if $15 == $8000: $04 = DATA_stone_3d_cap_tiles_wall[Y/2] + $A1
//     else:            (leave default = base)
// ─────────────────────────────────────────────────────────────────────

const PIPE_EDGE_TILES: ReadonlySet<number> = new Set([
  0x0029, 0x002D, 0x0101, 0x010A, 0x0104, 0x0105,
]);

function pipeCapSelect(state: DecodeState, rowIdx: number): number {
  const a1 = state.zpA1 & 0xffff;
  const wallet = (state.zp15 & 0xffff) === 0x8000;
  const col = state.zp28 & 0xff;
  const colExtent = state.zp2A & 0xff;

  // Default $04 = DATA_stone_3d_cap_tiles[Y/2] + $A1 (CODE_stone_3d_cap_select prologue).
  let tile = (DATA_stone_3d_cap_tiles[rowIdx]! + a1) & 0xffff;

  if (col === 0) {
    // CODE_13FC4D path.
    if (wallet) {
      tile = (DATA_stone_3d_cap_tiles_wall[rowIdx]! + a1) & 0xffff;
    } else if (a1 !== 0) {
      // CODE_13FC5C: $A1 != 0 falls through into CODE_13FC60.
      tile = DATA_stone_3d_cap_tiles_alt[rowIdx]!;
    }
    // a1 == 0, non-wallet: keep default.
  } else if (((col + 1) & 0xff) === colExtent) {
    // CODE_13FC44 last-col branch — probe-left and INC or pick alt.
    const probe = probeLeftTile(state) & 0xffff;
    if (PIPE_EDGE_TILES.has(probe)) {
      // CODE_13FC60: neighbour is pipe-edge → pick alt cap.
      tile = wallet
        ? DATA_stone_3d_cap_tiles_wall_alt[rowIdx]!
        : DATA_stone_3d_cap_tiles_alt[rowIdx]!;
    } else {
      // No-match: $04 = probe + 1. (Cart `INC ; BRA store`.)
      tile = (probe + 1) & 0xffff;
    }
  } else {
    // CODE_13FC44 interior: only wallet path mutates.
    if (wallet) {
      tile = (DATA_stone_3d_cap_tiles_wall[rowIdx]! + a1) & 0xffff;
    }
  }
  return tile;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_stone_3d_body_shape_select ($13:FCAC, Bank13.asm:15171).
//
// Branches on the candidate tile ($04):
//   $0106          → CODE_13FCD2 (alt-tiles, row-N based)
//   $0109/$79E3/$79E6 → CODE_13FCC2 (probe-left, keep / INC by 1)
//   else           → CODE_13FCF0 (PRNG + $2C + main-tiles)
// Writes back to $04.
// ─────────────────────────────────────────────────────────────────────

function pipeBodyShapeSelect(state: DecodeState, candidate: number): number {
  const v = candidate & 0xffff;
  if (v === 0x0106) {
    // CODE_13FCD2: alt-tiles indexed by ($2C - 3), with PRNG re-roll
    // when ($2C - 3) >= 6 (i.e., row >= 9 — happens for tall pipes).
    let y: number;
    const rowMinus3 = (state.zp2C & 0xff) - 3;
    if (rowMinus3 < 6) {
      y = rowMinus3 & 0x06;
    } else {
      // JSL prng ; AND #$0002 ; CLC ; ADC #$0004 → y ∈ {4, 6}.
      y = ((prngNext(state, RNG_SITE.stone3dBodyAlt) & 0x02) + 0x04) & 0x06;
    }
    return DATA_stone_3d_body_alt_tiles[y >>> 1]!;
  }
  if (v === 0x0109 || v === 0x79E3 || v === 0x79E6) {
    // CODE_13FCC2: store the PROBE-LEFT tile (not the candidate). The cart's
    // `JSR probe_left ; CMP #0/CMP #$79E7 BEQ store ; INC ; store` keeps A (the
    // probe result) all the way to `STA $04`, so $04 becomes the left tile
    // ($0000 / $79E7 as-is) or left+1 — mirroring the odd-column body cell onto
    // its left neighbour to form the 3D pipe pair ($79E2→$79E3, $79E5→$79E6,
    // $0108→$0109). The earlier port returned `v`/`v+1`, collapsing every odd
    // cell to $0109/$010A.
    const probe = probeLeftTile(state) & 0xffff;
    if (probe === 0x0000 || probe === 0x79E7) return probe;
    return (probe + 1) & 0xffff;
  }
  // CODE_13FCF0: PRNG-driven main-table pick.
  // Y = ((prng & 3) + $2C) * 2 — byte offset into a word-table starting
  // at FC94, but the asm indexes from FC94-$06 so callers can use $2C
  // directly. We fold that into a (Y/2 - 3) word index.
  let yByte = (((prngNext(state, RNG_SITE.stone3dBodyMain) & 0x03) + (state.zp2C & 0xff)) << 1) & 0xffff;
  if (yByte >= 0x16) {
    // Re-roll between entries 6 and 7 (Y = $12 or $14).
    yByte = (((prngNext(state, RNG_SITE.stone3dBodyMainHi) & 0x02) + 0x12)) & 0xffff;
  }
  // (Y - 6) / 2 = the word-array index into DATA_stone_3d_body_main_tiles.
  // For yByte = 6 → idx 0; yByte = $14 → idx 7. Clamp to table size.
  const idx = ((yByte - 6) >>> 1) & 0x07;
  return DATA_stone_3d_body_main_tiles[idx]!;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_stone_3d_body_check_left ($13:FC72) — body sub-handler for col==0.
//   if candidate == $0109 and probe_left != $0108: demote to $0106.
//
// CODE_stone_3d_body_check_right ($13:FC81) — body sub-handler for col==last.
//   if candidate == $0108 and probe_right != $0109: demote to $0106.
// ─────────────────────────────────────────────────────────────────────

function pipeBodyCheckLeft(state: DecodeState, candidate: number): number {
  if ((candidate & 0xffff) !== 0x0109) return candidate;
  const probe = probeLeftTile(state) & 0xffff;
  if (probe === 0x0108) return candidate;
  return 0x0106;
}

function pipeBodyCheckRight(state: DecodeState, candidate: number): number {
  if ((candidate & 0xffff) !== 0x0108) return candidate;
  const probe = probeRightTile(state) & 0xffff;
  if (probe === 0x0109) return candidate;
  return 0x0106;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_stone_3d_stamp ($13:FBA0).
//
// Per-cell stamp dispatched by the walker via slots $21/$24/$27.
// REP #$30 throughout.
//
// Note on neighbour_fixup: with $15 = $8000 (high bit set) the cart's
// `LDA $15 ; BMI store` always taken — neighbour_fixup never runs for
// objects $F0..$F3. We omit the path entirely (see file header).
// ─────────────────────────────────────────────────────────────────────

const stampPipeVertical: PerCellHandler = (state) => {
  const row = state.zp2C & 0xff;
  const rowExtent = state.zp2E & 0xff;
  const col = state.zp28 & 0xff;
  const colExtent = state.zp2A & 0xff;
  const a1 = state.zpA1 & 0xffff;

  let tile: number;
  if (row < 3) {
    // Cap row (Y = row*2 < 6): pipe_cap_select.
    tile = pipeCapSelect(state, row);
  } else {
    // Deep body (CODE_stone_3d_stamp_body):
    //   $04 = $0108 + (($2C ^ $A1) & 1)
    let candidate = (0x0108 + ((row ^ a1) & 0x01)) & 0xffff;
    if (col === 0) {
      // body_check_left (X=0).
      candidate = pipeBodyCheckLeft(state, candidate);
    } else if (((col + 1) & 0xff) === colExtent) {
      // body_check_right (X=2) — also falls through to the same JSR site.
      candidate = pipeBodyCheckRight(state, candidate);
    }
    // CODE_13FBD0: $15 != 0 → shape_select. $15 == $8000 here, always taken.
    candidate = pipeBodyShapeSelect(state, candidate);
    // CODE_stone_3d_neighbour_fixup (neighbour_fixup): gated by BMI on $15. $15=$8000 → BMI
    // taken → skip. (Spec confirms: no neighbour_fixup table reads.)
    tile = candidate;
  }

  // Store epilogue (CODE_stone_3d_stamp_store):
  //   if row + 1 == rowExtent: $A1 ^= 1
  //   STA $04 → LevelDataBuffer[$1D]
  if (((row + 1) & 0xff) === rowExtent) {
    state.zpA1 = a1 ^ 0x0001;
  }
  stampCell(state, tile & 0xffff);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_moving_stone_3d ($12:A350, Bank12.asm:5435).
//
// The cart's prologue (lines 5436-5466) packs the {locX, locY, $2A-1,
// $2E-1, dir-byte} tuple and writes it into the enterable-pipe slot
// table at $70:449E for runtime gameplay. The editor doesn't simulate
// gameplay — we skip the slot-table write entirely. The init's
// observable effect on the decoder is limited to the final REP #$20
// block (lines 5467-5474):
//
//   REP #$20
//   LDA $1B ; LSR LSR LSR LSR ; EOR $1B ; AND #$0001 ; STA $A1
//   LDA #$8000 ; STA $0015
//   LDX #(CODE_stone_3d_stamp-$01)>>16
//   LDA #CODE_stone_3d_stamp-$01
//   JMP CODE_walker_setup_trampoline
//
// Spec DP-diff confirms only $15 changes (F0..F3 → $00 at the byte
// level, $8000 in 16-bit). $1B/$1C/$2A/$2E pass through untouched.
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0xF0, 0xF1, 0xF2, 0xF3 share this handler.
const initMovingStone3d: InitHandler = (state) => {
  // $A1 = (lo_nibble($1B) ^ hi_nibble($1B)) & 1.
  // Cart: LDA $1B (16-bit, but high byte $1C is irrelevant — masked out
  // by the final AND #$0001), LSR x4, EOR $1B, AND #$0001.
  const xy = state.zp1B & 0xff;
  state.zpA1 = ((xy >>> 4) ^ xy) & 0x0001;

  // $15 = $8000 — selects wallet-cap tile group AND gates off neighbour_fixup.
  state.zp15 = 0x8000;

  walkerSetupTrampoline(state, stampPipeVertical);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Std IDs $F0/$F1/$F2/$F3 all share this init (the
// orientation-byte differentiation only matters for the gameplay-side
// enterable-pipe slot table, which the editor doesn't model).
// ─────────────────────────────────────────────────────────────────────

export function installMovingStone3dHandlers(): void {
  registerStdObjectHandler(0xF0, initMovingStone3d);
  registerStdObjectHandler(0xF1, initMovingStone3d);
  registerStdObjectHandler(0xF2, initMovingStone3d);
  registerStdObjectHandler(0xF3, initMovingStone3d);
}
