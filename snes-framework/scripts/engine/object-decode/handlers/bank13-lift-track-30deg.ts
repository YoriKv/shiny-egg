// Bank13 stamp handler for the 30-degree moving-platform rail/track
// (standard object $10 — "lift track 30deg").
//
// Cart entry points:
//   CODE_init_lift_track_30deg  ($12:9368, Bank12.asm:3008)
//   CODE_lift_track_30deg       ($13:84E1, Bank13.asm:918)
//   DATA_1384C1 .. DATA_1384DD  per-row / per-orientation tile + sign tables
//
// Init handler (Bank12.asm:3008):
//   REP #$20
//   LDA #$0002 ; STA $2E              ; force row extent to 2
//   LDA #$FFFF ; STA $17               ; per-row slope step = -1 (rises)
//   JMP walker_setup_keep_slope(CODE_lift_track_30deg)
//
// Per-cell stamp (CODE_lift_track_30deg, Bank13.asm:918) — picks one of
// 12 tile templates from DATA_1384C1 / DATA_1384CD by combining:
//   - object orientation ($2A sign flag → which half-table for the Y pick)
//   - column parity ($28 & 1) shifted into X (0 or 2)
//   - "at last column" check ($28 + sign == $2A) — toggles the $9B
//     lift-track marker (= $8000 / $0000 from DATA_1384DD,x) which the
//     keep-slope walker reads to skip the $2E adjustment on row-wrap
//   - row $2C (0 or 1) producing Y in {0..6} or {8} for the "interior"
//     special-case
//   - special-case: at col 0 / last-col with row 0 and an existing tile
//     ($12 == $00A7 or $00B4) → stamp $00A7
//
// (test params: col-extent=5, row-extent=2 after init, cur_tile=$0000 on
//  every cell; expected stamps verified cell-by-cell against this port.)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupKeepSlope } from '../walker.ts';
import {
  stampCell,
  LIFT_TRACK_KEEP_CHECK_A, LIFT_TRACK_KEEP_CHECK_B, LIFT_TRACK_KEEP_OUT,
} from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Per-row / per-orientation tile tables (Bank13.asm:889-905).
//
// Cart layout (word entries):
//   DATA_1384C1: $009C $009B $009A $0000 $0093 $0092   (Y=0..10)
//   DATA_1384CD: $009D $009E $009F $0000 $0092 $0093   (Y=0..10, orientation BMI)
//   DATA_1384D9: $0001 $FFFF                            (col-sign sentinel)
//   DATA_1384DD: $8000 $0000                            ($9B lift-track flag)
//
// DATA_1384C1 and DATA_1384C9 share their underlying storage — the cart
// indexes Y up to 8 into DATA_1384C1 and the spill-over hits DATA_1384C9.
// We flatten the two ranges into one 6-entry table here (Y = 0,2,4,6,8,10).
// Likewise DATA_1384CD / DATA_1384D5.
// ─────────────────────────────────────────────────────────────────────

// Y is always a word-index in the asm; we use halved (Y/2) indices in TS.
const DATA_1384C1_orientation_pos = [0x009C, 0x009B, 0x009A, 0x0000, 0x0093, 0x0092] as const;
const DATA_1384CD_orientation_neg = [0x009D, 0x009E, 0x009F, 0x0000, 0x0092, 0x0093] as const;

// DATA_1384D9 — sign byte added to $28 to test "at last column"
// (entry 0 = +1 for positive extent, entry 1 = -1 for negative).
const DATA_1384D9_col_sign = [0x0001, 0xFFFF] as const;

// DATA_1384DD — the $9B "lift-track marker" written when we're not at
// the last column. x = (col & 1) * 2 → entry 0 ($8000) or 1 ($0000).
// $9B & $8000 != 0 → walker_row_wrap skips the $2E adjustment, keeping
// the 2-row strip from collapsing as the diagonal advances.
const DATA_1384DD_lift_marker = [0x8000, 0x0000] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_lift_track_30deg (Bank13.asm:918) — per-cell stamp.
// ─────────────────────────────────────────────────────────────────────

const liftTrack30deg: PerCellHandler = (state) => {
  // REP #$30 — both A and X/Y operate as 16-bit in this routine.
  // LDY #$0000 ; LDA $2A ; BPL skip ; INY INY  (Y = 2 if $2A negative).
  const yOrient = (state.zp2A & 0x80) !== 0 ? 1 : 0; // signed-byte sign → table half-index

  // LDA $28 ; AND #$0001 ; ASL ; STA $00 ; TAX.
  // $00 / X = col_parity * 2 (0 or 2 in asm; we keep TS half-index).
  const colParity = state.zp28 & 0x01;
  let scratch00 = colParity << 1; // mirrors $00 (word value), still asm-style
  const xParity = colParity;       // 0 or 1 in TS terms

  // LDA $28 ; BEQ first_col_path
  //   else CLC ADC DATA_1384D9,y ; CMP $2A ; BNE not_last_col.
  let atFirstOrLast = false;
  let writeLiftMarker = false;
  if ((state.zp28 & 0xffff) === 0) {
    // First-column path: drop to CODE_138501 (no $9B write).
    atFirstOrLast = true;
  } else {
    // Last-column test = (col + DATA_1384D9[y]) == $2A, all 16-bit.
    //
    // PORTING TRAP — the cart reloads the FULL column counter here, NOT
    // $00. The asm is:
    //   LDA $28 ; AND #$0001 ; ASL ; STA $00 ; TAX   ; $00 = colParity*2
    //   LDA $28                                       ; ** reload $28 (col) **
    //   CLC ; ADC DATA_1384D9,y ; CMP $2A
    // An earlier port mistook the second `LDA $28` for the stashed $00 and
    // compared `colParity*2 + sign` against $2A. That only ever matches for
    // objects ≤3 cells wide, so a wide 30° lift track (e.g. object $10 at
    // 20 cells) NEVER detected its right edge — every interior AND terminal
    // column took the middle-cell path, clobbering whatever terrain join
    // sat under the last column with a plain rail tile ($009B…) instead of
    // running the $00B4/$00A7 keep-check that preserves a ski-lift pole.
    // Symptom: where a 30° wire's far end overlaps a "2 poles" support
    // ($3E) that a later steep ($11) wire then anchors onto, the pole
    // rendered as a single post (the $11 left-edge keep-check saw the rail
    // tile, not a pole, and stamped its own end-cap). See room 0x88.
    const probe = ((state.zp28 & 0xffff) + DATA_1384D9_col_sign[yOrient]!) & 0xffff;
    if (probe === (state.zp2A & 0xffff)) {
      // BEQ falls through (BNE not taken) → join CODE_138501 path.
      atFirstOrLast = true;
    } else {
      // BNE not_last_col → CODE_138521: write the lift marker into $9B.
      writeLiftMarker = true;
    }
  }

  // CODE_138501: at first col (or last col). Row 0 only — for row != 0
  // the routine just returns without stamping.
  if (atFirstOrLast) {
    // LDA $2C ; BNE return.
    if ((state.zp2C & 0xff) !== 0) return;
    // CODE_138505 — at row 0 of first/last col, check existing cell.
    const cur = state.zp12 & 0xffff;
    if (cur === LIFT_TRACK_KEEP_CHECK_A || cur === LIFT_TRACK_KEEP_CHECK_B) {
      // Stamp $00A7 (CODE_138511 → CODE_138540).
      stampCell(state, LIFT_TRACK_KEEP_OUT);
      return;
    }
    // CODE_138516: TXA ; ORA #$0008 ; STA $00 ; AND #$0002 ; BEQ join.
    // After this branch $00 = (col_parity*2) | $0008 (still 0 or 2 in
    // the parity bit, but bit 3 set so Y-pick = 8 or 10). The AND #$0002
    // tests the parity bit: if 0, skip the lift marker store; if 2,
    // fall through to CODE_138521 (write $9B and continue).
    scratch00 = (xParity << 1) | 0x08;
    if (((xParity << 1) & 0x02) !== 0) {
      writeLiftMarker = true;
    }
    // Either way, drop into CODE_138526 (Y-pick + stamp).
  }

  // CODE_138521 — write the $9B lift-track marker (skipped when we
  // arrived via the BEQ-skip in CODE_138516).
  if (writeLiftMarker) {
    state.rewound = DATA_1384DD_lift_marker[xParity]!;
  }

  // CODE_138526: LDA $2C ; AND #$0001 ; ASL ASL ; ADC $00 ; TAY.
  // Y = ((row & 1) * 4) + scratch00. Y enumerates the word-spaced
  // table; we convert to half-index.
  const rowBit = state.zp2C & 0x01;
  const yWord = ((rowBit << 2) + scratch00) & 0xffff;
  const yHalf = yWord >>> 1;

  // LDA $2A ; BMI orientation_neg ; LDA DATA_1384C1,y else DATA_1384CD,y.
  const tileTable = (state.zp2A & 0x80) !== 0
    ? DATA_1384CD_orientation_neg
    : DATA_1384C1_orientation_pos;
  const mapId = yHalf < tileTable.length ? tileTable[yHalf]! : 0;

  // BEQ return (no stamp on $0000 entries).
  if (mapId === 0) return;
  // STA.l !RAM_YI_Level_LevelDataBuffer,x.
  stampCell(state, mapId);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_lift_track_30deg (Bank12.asm:3008).
// ─────────────────────────────────────────────────────────────────────

function initLiftTrack30deg(state: DecodeState): void {
  // REP #$20 ; LDA #$0002 ; STA $2E  — force 2-row strip.
  state.zp2E = 0x02;
  // LDA #$FFFF ; STA $17 — slope step = -1 (the track rises right-to-left).
  state.zp17 = 0xFFFF;
  // JMP walker_setup_keep_slope(CODE_lift_track_30deg).
  walkerSetupKeepSlope(state, liftTrack30deg);
}

// ─────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────

export function installLiftTrack30degHandlers(): void {
  registerStdObjectHandler(0x10, initLiftTrack30deg);
}
