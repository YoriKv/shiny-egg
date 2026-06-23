// Standard objects $27 / $28 — init_jungle_slope_45deg.
//
// Cart entry:        CODE_init_jungle_slope_45deg @ $12:9532 (yi/Banks/Bank12.asm:3312).
// Per-cell handlers: CODE_jungle_slope_left_down  @ $13:9352 (yi/Banks/Bank13.asm:2512)
//                    CODE_jungle_slope_right_down @ $13:93EA (yi/Banks/Bank13.asm:2601)
// Helpers:           CODE_jungle_floor_random_body         @ $13:9049 (Bank13.asm:2061)
//                    CODE_jungle_wall_neighbour_classify   @ $13:91F9 (Bank13.asm:2316)
//                    CODE_probe_left_tile / right_tile     @ $13:FD54 / $13:FD61
//                    CODE_get_map16_above                  @ $12:8719
// Data tables:       DATA_12952E (handler dispatch, Bank12.asm:3308)
//                    DATA_139348 / DATA_13934C (left-down  row-0/1/2 tiles, Bank13.asm:2497)
//                    DATA_1393E0 / DATA_1393E4 (right-down row-0/1/2 tiles, Bank13.asm:2588)
//                    DATA_138FE1               (16-entry random-foliage pool, shared with $21)
//
// Diagonal foliage-slope used by world-1 jungle levels. The two object IDs
// share one init: bit 3 of the object byte ($15) selects between two stamp
// handlers (LDRU vs LURD orientation) — $27 = left-down (slopes from
// upper-left to lower-right), $28 = right-down (mirror). After init,
// $15 holds 0 (left-down) or 2 (right-down) — preserved for downstream
// consumers but no longer read by this handler family.
//
// Init body:
//   REP #$20 ; LDA $15 ; AND #$0008 ; LSR LSR ; TAY ; STA $15
//   LDA #$FFFF ; STA $17                ; slope = -1 per row (diagonal up)
//   LDX #(jungle_slope_left_down-1)>>16 ; bank = $13 (both handlers live there)
//   LDA DATA_12952E,Y                   ; handler ptr-1
//   JMP CODE_walker_setup_keep_slope    ; (does NOT clear $17 unlike trampoline)
//
// Per-cell handler (both left & right share the same algorithm; only
// data tables, the probe direction, and the neighbour-edge detect differ):
//
//   REP #$30 ; LDA #$0001 ; STA $9B    ; rewound flag set (lift-style mode)
//   if $2C >= 3: JMP jungle_floor_random_body
//                  (prng + $2C, AND $1E, index DATA_138FE1 → stamp)
//   else (body):
//     if col $28 != 0: → CODE_1393A2 (the per-row tile path)
//     else (left edge column):
//       inspect $12 (already-stamped tile under us):
//         $12 in [$9080, $9084) → run "stamp seam-pair above + probe-side"
//                                  branch (CODE_13937F / CODE_139417);
//                                  stamps $9204 (left) / $9205 (right) at
//                                  the cell ABOVE, $964D (left) / $964E (right)
//                                  at the cell to the LEFT (or RIGHT for $28),
//                                  and $330D (left) / $3512 (right) into the
//                                  CURRENT cell — then RTL.
//         $12 in [$9090, $9094) → stamp $908F (left) / $907F (right) and RTL.
//         else                  → fall through to CODE_1393A2.
//
//   CODE_1393A2 / CODE_13943A — the per-row tile path:
//     JSL prng ; AND #$0001 ; STA $00      ; cosmetic 1-bit jitter
//     LDA $2C ; ASL ; TAY
//     LDA DATA_139348,Y / DATA_1393E0,Y    ; per-row base tile (rows 0/1/2)
//     CLC ; ADC $00 ; STA $0A              ; stamp = base + jitter
//     LDA $28 ; (DEC for left / INC for right) ; CMP $2A
//     BNE row2_fallthrough                  ; not on the slope-tail edge
//     JSR jungle_wall_neighbour_classify    ; classify $12 → Y or $FFFF
//     BMI row2_fallthrough
//     LDA DATA_13934C,Y / DATA_1393E4,Y     ; per-classify override
//     STA $0A
//     BRA store
//   row2_fallthrough:
//     LDA $2C ; CMP #$0002 ; BNE store      ; row 2 specifically falls into
//     JMP jungle_floor_random_body          ; the random-pool path instead
//   store:
//     LDA $0A ; LDX $1D ; STA buffer,X ; RTL
//
// Left-vs-right diffs:
//   - DATA_139348 ($9400,$905C)         vs DATA_1393E0 ($9501,$905E)   (rows 0/1 base)
//   - DATA_13934C ($9402,$90A2,$9072)   vs DATA_1393E4 ($9500,$90A3,$9073)
//                                                                    (row-2 classify table)
//   - Seam-pair tiles ($13937F/$139417):
//       above:   $9204 vs $9205
//       side:    $964D (left)  vs $964E (right)  via probe_left vs probe_right
//       current: $330D vs $3512
//   - Row-1 deterministic alt ($13939D/$139435): $908F vs $907F
//   - Edge detect: left uses `LDA $28 ; DEC` (col-1 == $2A → at left edge of
//                  the new tile stripe under the slope's overhang);
//                  right uses `LDA $28 ; INC` (mirror — col+1 == $2A).
//
// Spec cross-check: per-cell traces for std-27 (left) and std-28 (right)
// confirmed byte-exact for the deterministic row-0/1/2 path that's
// exercised in the harness ($12 stays $0000 because the buffer is fresh,
// so the body's three `if $12 in [...]` checks all fall through to the
// CODE_1393A2 path). Random-body cells produce variants from the 16-entry
// foliage pool — set is correct, exact pick depends on prng stream.
//
// **Consolidation candidates** (shared with $21 jungle_floor + $22/$23
// jungle_left/right_wall + $24-$26 mud variants):
//   - DATA_138FE1 (16-entry random pool) — already in bank13-jungle-floor.ts
//   - jungleWallNeighbourClassify       — already in bank13-jungle-left-wall.ts
//   - jungleFloorRandomBody (prng + $2C, AND $1E, idx DATA_138FE1)
//                                         shared by 18 callers; promote
//                                         to _shared.ts when the rest of
//                                         the family lands.
// Both are duplicated inline here per the project's "no premature
// consolidation" convention until the family is complete.
//
// asm primary; goldenegg notes consulted as a cross-reference (the LDRU /
// LURD orientation labels confirm the bit-3 dispatch).

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupKeepSlope } from '../walker.ts';
import { prngNext, RNG_SITE } from '../prng.ts';
import {
  stampCell,
  stampAboveTile,
  stampLeftTile,
  stampRightTile,
  jungleFloorRandomBody,
  jungleWallNeighbourClassify,
} from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Per-handler tile tables (Bank13.asm:2497, 2500, 2588, 2591).
//
// DATA_139348 / DATA_1393E0 — row 0/1 base tiles for the prng-jitter path.
//   left-down  rows 0/1 → $9400 / $905C
//   right-down rows 0/1 → $9501 / $905E
//
// DATA_13934C / DATA_1393E4 — row-2 edge-classify override tiles
// (indexed by classify result Y = 0/2/4 mapped to elements 0/1/2).
//   left  Y=0 → $9402, Y=2 → $90A2, Y=4 → $9072
//   right Y=0 → $9500, Y=2 → $90A3, Y=4 → $9073
// ─────────────────────────────────────────────────────────────────────

const DATA_139348 = [0x9400, 0x905C] as const;
const DATA_13934C = [0x9402, 0x90A2, 0x9072] as const;

const DATA_1393E0 = [0x9501, 0x905E] as const;
const DATA_1393E4 = [0x9500, 0x90A3, 0x9073] as const;

// jungleWallNeighbourClassify + jungleFloorRandomBody are shared with
// $21 jungle_floor, $22/$23 jungle walls, $24 mud floor, $25/$26
// mud walls — see ./_shared.ts. The classifier returns 0/2/4/$FFFF;
// callers index per-handler override tables with `y >>> 1`.
const CLASSIFY_NONE = 0xFFFF;

// ─────────────────────────────────────────────────────────────────────
// Direction-specific tile constants for the col-0 "seam-pair" branch
// (CODE_13937F for left, CODE_139417 for right) and the row-1 alt
// (CODE_13939D / CODE_139435).
// ─────────────────────────────────────────────────────────────────────

interface DirConfig {
  readonly row01Base:   readonly [number, number];        // DATA_139348 / DATA_1393E0
  readonly row2Classify: readonly [number, number, number]; // DATA_13934C / DATA_1393E4
  readonly seamAbove:   number;                            // $9204 / $9205
  readonly seamSide:    number;                            // $964D / $964E
  readonly seamCurrent: number;                            // $330D / $3512
  readonly row1Alt:     number;                            // $908F / $907F
  readonly stampSide:   (state: DecodeState, id: number) => void; // stampLeftTile / stampRightTile
  readonly edgeDelta:   1 | -1;                            // INC ($28+1) for right, DEC ($28-1) for left
  readonly prngSite:    number;                            // CODE_1393A2 (left) / CODE_13943A (right) roll PC
}

const LEFT_DOWN: DirConfig = {
  row01Base:    DATA_139348,
  row2Classify: DATA_13934C,
  seamAbove:    0x9204,
  seamSide:     0x964D,
  seamCurrent:  0x330D,
  row1Alt:      0x908F,
  stampSide:    stampLeftTile,
  edgeDelta:    -1, // DEC $28
  prngSite:     RNG_SITE.jungleSlopeLeftDownBody,
};

const RIGHT_DOWN: DirConfig = {
  row01Base:    DATA_1393E0,
  row2Classify: DATA_1393E4,
  seamAbove:    0x9205,
  seamSide:     0x964E,
  seamCurrent:  0x3512,
  row1Alt:      0x907F,
  stampSide:    stampRightTile,
  edgeDelta:    +1, // INC $28
  prngSite:     RNG_SITE.jungleSlopeRightDownBody,
};

// ─────────────────────────────────────────────────────────────────────
// Common per-cell handler body. The two cart routines differ only in
// the data above plus the edge-detect direction ($28-1 vs $28+1) — we
// factor that into one parameterised function rather than duplicating
// the 50-line body.
// ─────────────────────────────────────────────────────────────────────

function makeStampHandler(cfg: DirConfig): PerCellHandler {
  return (state) => {
    // REP #$30 ; LDA #$0001 ; STA $9B
    // The init pre-set $17 = $FFFF; we also flag $9B so the walker's
    // row-wrap path runs rewindNibble. (For our slope objects the
    // handler explicitly forces $9B=1 every cell — the walker zeros it
    // on entry, so we need to re-arm it each call.)
    state.rewound = 0x0001;

    // if $2C >= 3: JMP jungle_floor_random_body
    if ((state.zp2C & 0xffff) >= 0x0003) {
      jungleFloorRandomBody(state);
      return;
    }

    // body: if $28 != 0: skip to per-row prng-jitter path (CODE_1393A2/13943A).
    const col = state.zp28 & 0xff;
    let stamp: number | null = null;

    if (col === 0) {
      // Inspect the already-stamped $12 — three windowed checks.
      const cur = state.zp12 & 0xffff;
      // CODE_jungle_slope_*_body fall-through chain (Bank13.asm:2521-2534):
      //   if $12 < $9080 → fall through to CODE_139373/CODE_13940B chain
      //   if $12 in [$9080, $9084) → CODE_13937F / CODE_139417 (seam pair)
      //   else → fall through to CODE_139373/CODE_13940B chain
      //
      //   CODE_139373 / CODE_13940B:
      //     if $12 < $9090 → CODE_1393A2 / CODE_13943A (prng path)
      //     if $12 in [$9090, $9094) → CODE_13939D / CODE_139435 (row1 alt)
      //     else → prng path
      if (cur >= 0x9080 && cur < 0x9084) {
        // Seam-pair branch: stamp above, stamp side, stamp current.
        stampAboveTile(state, cfg.seamAbove);
        cfg.stampSide(state, cfg.seamSide);
        stamp = cfg.seamCurrent;
      } else if (cur >= 0x9090 && cur < 0x9094) {
        // Row-1 alt branch.
        stamp = cfg.row1Alt;
      }
      // else: fall through to prng path below.
    }

    if (stamp === null) {
      // CODE_1393A2 / CODE_13943A — prng-jitter per-row base.
      const jitter = prngNext(state, cfg.prngSite) & 0x01;
      const rowIdx = (state.zp2C & 0xff) & 0x7f; // Y = $2C * 2; word table
      // Bank13.asm:2557-2559: LDA $2C ; ASL ; TAY ; LDA DATA_139348,y.
      // The table has 2 entries (rows 0/1 base). For row 2, the indexing
      // walks PAST the end into DATA_13934C — see the row-2 fallthrough
      // logic below. The body explicitly checks for $2C==2 after the
      // edge-detect miss and jumps to jungle_floor_random_body instead,
      // so the "out of range" read only fires on the slope-tail edge
      // (where the override wins).
      const baseTile = rowIdx < cfg.row01Base.length
        ? cfg.row01Base[rowIdx]!
        : cfg.row2Classify[0]!; // row 2: cart over-reads DATA_139348[2] = DATA_13934C[0]
      stamp = (baseTile + jitter) & 0xffff;

      // Edge detect: LDA $28 ; (DEC for left | INC for right) ; CMP $2A.
      // If equal → we're at the slope-tail edge → run classify; else
      // → row2_fallthrough path.
      const edgeCol = (col + cfg.edgeDelta) & 0xff;
      const colExtent = state.zp2A & 0xff;

      if (edgeCol === colExtent) {
        // JSR jungle_wall_neighbour_classify
        const y = jungleWallNeighbourClassify(state);
        if (y !== CLASSIFY_NONE) {
          // LDA DATA_13934C,Y / DATA_1393E4,Y ; STA $0A ; BRA store
          stamp = cfg.row2Classify[y >>> 1]!;
        } else {
          // BMI row2_fallthrough → if row 2, JMP jungle_floor_random_body.
          if ((state.zp2C & 0xffff) === 0x0002) {
            jungleFloorRandomBody(state);
            return;
          }
          // else: store the prng-jitter stamp.
        }
      } else {
        // row2_fallthrough: if row 2, JMP jungle_floor_random_body.
        if ((state.zp2C & 0xffff) === 0x0002) {
          jungleFloorRandomBody(state);
          return;
        }
      }
    }

    // store: LDA $0A ; LDX $1D ; STA buffer,X ; RTL
    stampCell(state, stamp);
  };
}

const jungleSlopeLeftDown:  PerCellHandler = makeStampHandler(LEFT_DOWN);
const jungleSlopeRightDown: PerCellHandler = makeStampHandler(RIGHT_DOWN);

// ─────────────────────────────────────────────────────────────────────
// CODE_init_jungle_slope_45deg ($12:9532, Bank12.asm:3312).
//
// Bit 3 of $15 picks the stamp handler:
//   bit3 = 0 ($15 = $27) → jungleSlopeLeftDown
//   bit3 = 1 ($15 = $28) → jungleSlopeRightDown
// After this re-encode, $15 holds 0 or 2 (matches spec post-init value).
//
// Slope $17 = $FFFF (-1 per row) → each new column starts one row higher
// than the previous, producing the diagonal slope.
//
// `walkerSetupKeepSlope` does NOT zero $17 (unlike walkerSetupTrampoline),
// preserving our $FFFF preset. It also leaves all 3 handler slots set
// to the same `handler` arg, runs the walker, and terminates via
// $2C == $2E (the row extent — width=$10 in the spec).
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x27, 0x28 share this handler.
const initJungleSlope45deg: InitHandler = (state) => {
  const orientBit = state.zp15 & 0x08;
  // LSR LSR — bit3 → bit1 (so Y=0 or 2). Then STA $15.
  const reencoded = orientBit >>> 2; // 0 or 2
  state.zp15 = reencoded;
  state.zp17 = 0xFFFF; // slope = -1 per row

  const handler = reencoded === 0 ? jungleSlopeLeftDown : jungleSlopeRightDown;
  walkerSetupKeepSlope(state, handler);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent (object-decode/index.ts) wires this in alongside
// the rest of the jungle family ($22-$36).
// ─────────────────────────────────────────────────────────────────────

export function installJungleSlope45degHandlers(): void {
  registerStdObjectHandler(0x27, initJungleSlope45deg);
  registerStdObjectHandler(0x28, initJungleSlope45deg);
}
