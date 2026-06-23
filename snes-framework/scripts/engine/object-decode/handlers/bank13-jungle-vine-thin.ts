// Standard objects $2D / $2E — init_jungle_vine_thin.
//
// Cart entry: CODE_init_jungle_vine_thin @ $12:9583 (yi/Banks/Bank12.asm:3363).
// Per-cell stamp handlers:
//   CODE_jungle_vine_thin              @ $13:9588  (Bank13.asm:2841)
//   CODE_jungle_vine_thin_plus_extras  @ $13:95FE  (Bank13.asm:2922)   [decorator]
// Helper picks dispatched by the side-pick table (DATA_139576):
//   CODE_jungle_vine_thin_left_pick    @ $13:95CE  (Bank13.asm:2882)
//   CODE_jungle_vine_thin_right_pick   @ $13:95EA  (Bank13.asm:2899)
// Stamp neighbour-probe primitives: CODE_get_map16_left / _right.
//
// World-1 "thin jungle vine": a 1-column, 16-row vertical vine.
// Cart symbol notes (matching JNGL_TULU0 / JNGL_TULU1 in ys_bgsc1.asm,
// "turu" / "tulu" = vine/tendril).
//
// Init handler is shared between two object IDs:
//
//   $2D — base vine. Per-cell handler = CODE_jungle_vine_thin.
//   $2E — vine "with extras". Per-cell handler =
//         CODE_jungle_vine_thin_plus_extras, which wraps the base and
//         adds a mid-stretch (rows 4 .. extent-2) 50/50 PRNG-decorated
//         leaf/branch on either side.
//
// The init picks between them by looking at bit-1 of the stream
// orientation byte ($15): $2D & $02 == 0 → base, $2E & $02 == 2 →
// decorated. It also seeds $A1 with a fresh PRNG bit-1 (0 or 2) which
// the per-cell handler reuses to pick LEFT vs RIGHT "side" tables when
// the cell sits in the row-0..3 "top knob" band.
//
// Per-cell dispatch is by row position:
//
//   row 0..3   : "top knob" — JSR via DATA_139576[side] to pick from a
//                per-side double-indirect table at DATA_13957A (left)
//                or DATA_13957E (right). Row 0 has a special "abut
//                $9214" override (left → $9213, right → $9216). Rows
//                1..3 just index DATA_1395C6 (left) or DATA_1395E2
//                (right) by row*2.
//   row (extent-2)+ : "tail" — index DATA_139582[side] (= DATA_13957A
//                /DATA_13957E indirected) by row*2 to pick the closing
//                tile.
//   middle rows: alternating $9064 / $9074 trunk from DATA_139586,
//                seeded by the PRNG bit-1 in $A1 + (row & 1)*2.
//
// The "plus_extras" decorator first runs the base then, if we're in the
// rows 4..(extent-2) middle band, rolls a 50/50 PRNG. On hit it probes
// the adjacent cell — if the trunk just stamped is unchanged ($9064 →
// fresh side, no prior decoration) it stamps a left-going branch pair
// ($907A current / $907B left); otherwise it stamps a right-going leaf
// pair ($9089 current / $908A right).
//
// asm primary; trace harness spec.md outputs cross-checked for both IDs.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { prngNext, RNG_SITE } from '../prng.ts';
import { getMap16Left, getMap16Right } from '../fetch.ts';
import { stampCell, readBuf16, writeBuf16, setProbeToCurrent } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Per-side tile tables (Bank13.asm:2823-2833, 2879, 2896).
//
//   DATA_13957A (= JNGL_TL0_LT_DT, 2 entries): left-side tail tiles
//     indexed by row*2.  Row 0 → $9094, Row 1 → $9084.
//   DATA_13957E (= JNGL_TL0_RT_DT, 2 entries): right-side tail tiles
//     indexed by row*2.  Row 0 → $908E, Row 1 → $907E.
//   DATA_139582 (= JNGL_TL0_DT_ADR, 2 entries): pointers to the two
//     above; indexed by side ($A1 = 0 left / 2 right).
//   DATA_139586 (= JNGL_TL0_DT2, 3 entries): mid-rows trunk tiles
//     indexed by (rowParity*2 + sidePRNGBit).  $9064 / $9074 / $9064.
//   DATA_1395C6 (= JNGL_TL0_LT_KNOB, 4 entries): top-knob LEFT tiles
//     for rows 0..3 (Y = row*2).
//   DATA_1395E2 (= JNGL_TL0_RT_KNOB, 4 entries): top-knob RIGHT tiles
//     for rows 0..3 (Y = row*2).
//
// Notes on the cart's indirection: the per-cell handler does
//   LDA DATA_139582,x ; STA $00 ; LDA ($00),y
// where X = $A1 (0 or 2) and Y = row*2. We collapse this to a direct
// `[DATA_13957A, DATA_13957E][sideIdx][rowIdx]` lookup.
// ─────────────────────────────────────────────────────────────────────

const DATA_13957A_LEFT_TAIL  = [0x9094, 0x9084] as const;
const DATA_13957E_RIGHT_TAIL = [0x908E, 0x907E] as const;
const DATA_139582_TAIL_BY_SIDE = [DATA_13957A_LEFT_TAIL, DATA_13957E_RIGHT_TAIL] as const;

const DATA_139586_TRUNK = [0x9064, 0x9074, 0x9064] as const;

const DATA_1395C6_LEFT_KNOB  = [0x9211, 0x9065, 0x9075, 0x9085] as const;
const DATA_1395E2_RIGHT_KNOB = [0x9212, 0x9078, 0x9088, 0x9079] as const;

// "Abut $9214" overrides at row 0 (Bank13.asm:2882-2898).
//   left: existing $12 == $9214 → stamp $9213 (instead of $9211).
//   right: existing $12 == $9214 → stamp $9216 (instead of $9212).
const ABUT_TILE_MATCH         = 0x9214;
const LEFT_ROW0_ABUT_OVERRIDE  = 0x9213;
const RIGHT_ROW0_ABUT_OVERRIDE = 0x9216;

// Decorator overlay tiles (Bank13.asm:2944-2953).
//   $9064 base on current → write $907A current, $907B left.
//   anything else         → write $9089 current, $908A right.
const TRUNK_BASE_FOR_LEFT_BRANCH = 0x9064;
const LEFT_BRANCH_CURRENT  = 0x907A;
const LEFT_BRANCH_NEIGHBOUR = 0x907B;
const RIGHT_LEAF_CURRENT  = 0x9089;
const RIGHT_LEAF_NEIGHBOUR = 0x908A;

// ─────────────────────────────────────────────────────────────────────
// CODE_jungle_vine_thin_left_pick / _right_pick (Bank13.asm:2882, 2899).
//
// Row 0 (`$2C == 0`) checks the existing $12 against $9214; on match
// substitutes the abut-override tile, else falls through to the knob
// table. Rows 1..3 just index the per-side knob table by Y=row*2.
// ─────────────────────────────────────────────────────────────────────
function vineThinSidePickLeft(state: DecodeState, rowIdx: number): number {
  if (rowIdx === 0 && (state.zp12 & 0xffff) === ABUT_TILE_MATCH) {
    return LEFT_ROW0_ABUT_OVERRIDE;
  }
  return DATA_1395C6_LEFT_KNOB[rowIdx]!;
}

function vineThinSidePickRight(state: DecodeState, rowIdx: number): number {
  if (rowIdx === 0 && (state.zp12 & 0xffff) === ABUT_TILE_MATCH) {
    return RIGHT_ROW0_ABUT_OVERRIDE;
  }
  return DATA_1395E2_RIGHT_KNOB[rowIdx]!;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_jungle_vine_thin ($13:9588, Bank13.asm:2841) — base per-cell.
//
// Dispatch by row position within the rectangle. Note both checks are
// in 16-bit (REP #$30) so $2C / $2E are full words; observed extents
// never exceed $10 ($f+1).
//
//   tailLeft  = $2E - $2C ; if tailLeft < 2 → "tail" branch
//   else if $2C >= 4 → "middle" branch
//   else → "top knob" branch (rows 0..3 with side pick).
//
// The cart stores the per-cell stamp in A then falls through to a
// shared epilogue (CODE_1395BD) that does `LDX $1D ; STA buffer,X ;
// SEP #$30 ; RTL`. We emulate the epilogue with a single stampCell()
// call.
// ─────────────────────────────────────────────────────────────────────
const jungleVineThinStamp: PerCellHandler = (state) => {
  const sideIdx = (state.zpA1 & 0x02) >>> 1; // 0 = left, 1 = right
  const row = state.zp2C & 0xffff;
  const extent = state.zp2E & 0xffff;

  // tailLeft = extent - row - 1. The cart does `CLC ; SBC $2C`, and on
  // 65816 SBC with carry-clear performs `A - M - 1` (carry is the
  // *borrow* complement). So the comparison `tailLeft < 2` actually
  // means "row in the last two rows" — i.e. row == extent-1 (last) or
  // row == extent-2 (second-to-last). Spec cells 14/15 (row 0E/0F with
  // extent = 0x10) confirm this is the tail branch entry condition.
  const tailLeft = (extent - row - 1) & 0xffff;

  // CODE_1395B4 — "tail" rows (within 2 of extent). The cart preserves
  // A from the CMP and uses it as the Y index after ASL, so the tail
  // table is indexed by `tailLeft` (0 = last row, 1 = second-to-last),
  // not by `row`.
  if (tailLeft < 0x0002) {
    stampCell(state, DATA_139582_TAIL_BY_SIDE[sideIdx]![tailLeft]!);
    return;
  }

  // CODE_1395A8 — "middle" rows (row >= 4).
  if (row >= 0x0004) {
    // AND #$0001 ; ASL ; ADC $A1 ; TAY ; LDA DATA_139586,y
    // — row parity * 2 + $A1 (which is 0 or 2). Y ∈ {0, 2, 4}.
    const rowParity = (row & 0x0001) << 1; // 0 or 2
    const y = (rowParity + (state.zpA1 & 0xff)) & 0xff;
    stampCell(state, DATA_139586_TRUNK[y >>> 1]!);
    return;
  }

  // CODE_jungle_vine_thin row 0..3 ("top knob"): per-side pick.
  // Cart: ASL ; TAY ; JSR (DATA_139576,x). The two pick subs accept Y
  // (= row*2) and X (= side*2 already implicit in their selection).
  // We pass rowIdx (= row, 0..3) directly.
  const stamp = sideIdx === 0
    ? vineThinSidePickLeft(state, row)
    : vineThinSidePickRight(state, row);
  stampCell(state, stamp);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_jungle_vine_thin_plus_extras ($13:95FE, Bank13.asm:2922) — the
// $2E decorator. JSLs into the base, then conditionally overlays a
// side-decoration. Row gating in 8-bit mode (SEP #$30 from base RTL):
//
//   if $2C < 4 → skip (CODE_139651 fall-through to RTL).
//   tailLeft = $2E - $2C ; if tailLeft < 2 → skip.
//   REP #$30 ; JSL prng ; AND #$0002 ; BEQ → skip (50/50 chance).
//   On hit: LDA $1B ; STA $0E (set probe = current cell coords).
//           LDA buffer,$1D
//           if (== $9064): JSL get_map16_left → buffer,X = $907A,
//                          A = $907B (target left-neighbour stamp);
//                          fall through to STA buffer,X (X = $1D).
//                          Net: current cell = $907A, LEFT = $907B.
//                          Wait — re-read: $907A is written via
//                          STA buffer,X where X is the LEFT offset
//                          (set by JSL get_map16_left). Then LDA
//                          #$907B falls through to CODE_139649 which
//                          LDX $1D ; STA buffer,X — so $907B stamps
//                          at CURRENT. (Spec confirms: cell 5 shows
//                          stamps $9074 @ off, $908A @ off+2, $9089
//                          @ off — the RIGHT path. The LEFT path is
//                          symmetric.)
//           else: JSL get_map16_right → buffer,X = $908A,
//                 A = $9089; STA buffer,$1D. Net: current = $9089,
//                 RIGHT = $908A.
//
// Reading the asm carefully (Bank13.asm:2937-2956):
//   $9064 path:  LDA #$907A ; STA buffer,X  ← X still left-neighbour
//                LDA #$907B ; BRA CODE_139649 ; LDX $1D ; STA buffer,X
//                → LEFT cell = $907A, CURRENT cell = $907B.
//   other path:  LDA #$908A ; STA buffer,X  ← X still right-neighbour
//                LDA #$9089 ; (fall through to CODE_139649)
//                → RIGHT cell = $908A, CURRENT cell = $9089.
//
// The spec ("decorator overwrite pattern") confirms:
//   STAMP $908A → off+2 (right neighbour), STAMP $9089 → off (current).
// ─────────────────────────────────────────────────────────────────────
const jungleVineThinPlusExtrasStamp: PerCellHandler = (state) => {
  // First: base stamp.
  jungleVineThinStamp(state);

  // Row gating (8-bit equivalents — extents fit in low byte). Same
  // `CLC ; SBC` cart pattern as the base handler, so `tailLeft =
  // extent - row - 1` (skip last two rows).
  const row = state.zp2C & 0xff;
  if (row < 0x04) return;
  const tailLeft = ((state.zp2E & 0xff) - row - 1) & 0xff;
  if (tailLeft < 0x02) return;

  // 50/50 chance: PRNG bit 1.
  const roll = prngNext(state, RNG_SITE.jungleVineThinExtras) & 0x0002;
  if (roll === 0) return;

  // Set probe coords to current cell. The asm's `LDA $1B ; STA $0E`
  // is 16-bit (REP #$30 still in effect), copying $1B/$1C → $0E/$0F.
  setProbeToCurrent(state);

  // Read the current cell's freshly-stamped tile.
  const curOff = state.zp1D & 0x7fff;
  const curTile = readBuf16(state, curOff);

  if (curTile === TRUNK_BASE_FOR_LEFT_BRANCH) {
    // Left-going branch overlay.
    const leftOff = getMap16Left(state);
    writeBuf16(state, leftOff, LEFT_BRANCH_CURRENT);   // $907A → LEFT
    writeBuf16(state, curOff, LEFT_BRANCH_NEIGHBOUR);  // $907B → CURRENT
  } else {
    // Right-going leaf overlay.
    const rightOff = getMap16Right(state);
    writeBuf16(state, rightOff, RIGHT_LEAF_NEIGHBOUR); // $908A → RIGHT
    writeBuf16(state, curOff, RIGHT_LEAF_CURRENT);     // $9089 → CURRENT
  }
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_jungle_vine_thin ($12:9583, Bank12.asm:3363) — shared init
// for objects $2D / $2E.
//
//   REP #$20
//   JSL CODE_prng ; AND #$0002 ; STA $A1   ; seed per-side PRNG bit
//   LDA $15 ; AND #$0002 ; TAY              ; Y = orientation bit-1
//   LDX #(CODE_jungle_vine_thin-$01)>>16   ; bank byte = $13
//   LDA DATA_12957F,y                      ; ptr to base or _plus_extras
//   JMP CODE_walker_setup_trampoline
//
// DATA_12957F (Bank12.asm:3359):
//   dw CODE_jungle_vine_thin-$01, CODE_jungle_vine_thin_plus_extras-$01
//
// So orientation bit-1 selects:
//   $2D (bit-1 == 0) → base stamp handler.
//   $2E (bit-1 == 2) → decorated stamp handler.
//
// The init does NOT mutate any of $1B/$1C/$2A/$2E/$15 (spec confirms),
// so the walker reads the stream record's raw extents (1 col × 16 rows
// after the parser's height-1 cap to $f).
// ─────────────────────────────────────────────────────────────────────
// Merge: object IDs 0x2D, 0x2E share this handler.
const initJungleVineThin: InitHandler = (state) => {
  // Seed $A1 with PRNG bit 1 (0 or 2). The base per-cell handler uses
  // this for the middle-row L/R parity pick.
  state.zpA1 = prngNext(state, RNG_SITE.initJungleVineThin) & 0x0002;

  // Bit-1 of $15 picks between base and decorated stamp handler.
  const handler = (state.zp15 & 0x02) === 0
    ? jungleVineThinStamp
    : jungleVineThinPlusExtrasStamp;

  walkerSetupTrampoline(state, handler);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Both std IDs use the same init; the init branches
// internally on $15 to pick the per-cell handler. Parent wires this
// into object-decode/index.ts.
// ─────────────────────────────────────────────────────────────────────
export function installJungleVineThinHandlers(): void {
  registerStdObjectHandler(0x2D, initJungleVineThin);
  registerStdObjectHandler(0x2E, initJungleVineThin);
}
