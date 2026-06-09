// Bank13 stamp handler for the 45-degree lift-track rails (objects $11 / $12).
//
// Cart entry points:
//   CODE_init_lift_track_45deg     ($12:937C, Bank12.asm:3019)
//   CODE_lift_track_45deg          ($13:854D, Bank13.asm:991)
//   DATA_lift_track_45deg_extents  (DATA_lift_track_45deg_extents) — row extents per variant
//   DATA_lift_track_45deg_steps    (DATA_lift_track_45deg_steps) — $17 step per variant
//   DATA_1384C9                    — left-edge row-0 tile table
//   DATA_1384D5                    — right-edge row-0 tile table
//   DATA_1384D9                    — col-step direction control
//   DATA_1385BF                    — middle-cell tile table (LIFT45_DT)
//
// Two registered standard-object IDs ($11 / $12) dispatch to the SAME init
// (cart's `DATA_standard_object_init_ptrs`); the variant is selected via
// `$15 & $0002` — and `$15` here is the OBJECT ID, so this is just "which
// of the two objects," NOT an orientation flag. Despite both being named
// "45deg", they are two different STEEPNESSES (both descend left-to-right):
//   $15 bit 1 == 0 ($11): extents=$0002, step=$FFFF → 1:1 slope = 45°
//                          (real-ROM trace: 1 tile down per 1 across)
//   $15 bit 1 == 1 ($12): extents=$0003, step=$FFFE → 2:1 slope ≈ 63°
//                          (real-ROM trace: 2 tiles down per 1 across)
// `$15` is also read at stamp-time to pick the per-row offset within
// DATA_1385BF — so the stamp behaviour depends on the object ID passed
// in (matches the spec's diff: only $2E mutates, $15 is preserved).
//
// Algorithm (cart-faithful):
//
//   init:
//     X = ($15 & $0002)                                ; → 0 or 2 (byte-spaced index)
//     $2E = DATA_lift_track_45deg_extents[X >> 1]      ; row extent (2 or 3)
//     $17 = DATA_lift_track_45deg_steps[X >> 1]        ; slope step ($FFFF or $FFFE)
//     walker_setup_keep_slope(CODE_lift_track_45deg)
//
//   per-cell stamp (CODE_lift_track_45deg):
//     $9B = $8000                                       ; rewind marker (bit 15 → no $2E bump)
//     Y = 0 ; if ($2A < 0): Y = 2                       ; direction-table base
//     if $28 == 0:
//         ; ── LEFT EDGE column ──
//         $9B = 0                                       ; clear rewind marker
//         if $2C != 0: skip (no stamp)
//         if $12 == $00B4 or $12 == $00A7: stamp $00A7   ; preserve already-stamped rail
//         else: stamp DATA_1384C9[Y]                    ; row-0 left cap
//     elif ($28 + DATA_1384D9[Y]) == $2A:
//         ; ── RIGHT EDGE column ──
//         if $2C != 0: skip
//         if $12 == $00B4 or $12 == $00A7: stamp $00A7
//         else: stamp DATA_1384D5[Y]                    ; row-0 right cap
//     else:
//         ; ── MIDDLE column ──
//         tmp = ($2C << 1)
//         tmp += ($15 & $0002) << 1                     ; orientation row-stride
//         tmp <<= 1                                     ; ×2 for dw spacing
//         Y |= tmp                                      ; OR in direction base
//         stamp DATA_1385BF[Y]
//
// Both register the SAME init function; per-cell branching uses `$15` to
// pick the right per-row slot within DATA_1385BF (the asm folds the
// `$15 & $0002` into the offset arithmetic, so $11 vs $12 yield different
// table rows during the middle-column path).
//
// Note on $9B: the cart sets $9B = $8000 on every stamp call, then clears
// it back to 0 ONLY when $28 == 0 (left-edge column). In walker.ts, the
// row-wrap path checks bit 15 of $9B: if set, skip the $2E increment that
// would extend the row-walk. This is the cart's mechanism for "the
// diagonal walker keeps a constant row extent" — the walker would
// normally extend rows when wrapping due to keep-slope, but lift-track
// suppresses that on middle/right-edge cells.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupKeepSlope } from '../walker.ts';
import {
  stampCell,
  LIFT_TRACK_KEEP_CHECK_A,
  LIFT_TRACK_KEEP_CHECK_B,
  LIFT_TRACK_KEEP_OUT,
} from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Orientation-pair tables consumed by CODE_init_lift_track_45deg.
//
// Cart asm (Bank12.asm:3032):
//   DATA_lift_track_45deg_extents:  dw $0002, $0003
//   DATA_lift_track_45deg_steps:    dw $FFFF, $FFFE
//
// Indexed by `($15 & $0002) >> 1` (cart indexes by byte-spaced X=$0002,
// so entries are dw-spaced; we use the natural [0]/[1]).
// ─────────────────────────────────────────────────────────────────────

const DATA_lift_track_45deg_extents = [0x0002, 0x0003] as const;
const DATA_lift_track_45deg_steps   = [0xFFFF, 0xFFFE] as const;

// ─────────────────────────────────────────────────────────────────────
// Tables consumed by CODE_lift_track_45deg (per-cell stamp).
//
// Cart asm (Bank13.asm:892-902, 1061):
//   DATA_1384C9: dw $0093, $0092       ; left-edge row-0 (Y=0: $11 / Y=2: $12 ...
//                                        wait — Y selects direction base, not variant.
//                                        For $2A >= 0: Y=0 → $0093 (descending L-cap)
//                                        For $2A <  0: Y=2 → ... but DATA_1384C9 only
//                                        has 2 dw entries. The cart's BPL on $2A
//                                        sets Y=2 for negative extents — landing at
//                                        DATA_1384CB = $0092 (the OTHER cap).
//   DATA_1384D5: dw $0092, $0093       ; right-edge row-0 (mirrored)
//   DATA_1384D9: dw $0001, $FFFF       ; col-step direction control
//   DATA_1385BF: dw $0097, $0098, $0096, $0099,
//                   $00A5, $00A0, $00A3, $00A2,
//                   $00A4, $00A1        ; middle-cell tiles, 10 entries
//
// The cart indexes ALL of these by BYTE offset (the values are dw); we
// expose them as flat arrays and index by `byteOff >>> 1`.
// ─────────────────────────────────────────────────────────────────────

const DATA_1384C9 = [0x0093, 0x0092] as const;
const DATA_1384D5 = [0x0092, 0x0093] as const;
const DATA_1384D9 = [0x0001, 0xFFFF] as const;
const DATA_1385BF = [
  0x0097, 0x0098, 0x0096, 0x0099,
  0x00A5, 0x00A0, 0x00A3, 0x00A2,
  0x00A4, 0x00A1,
] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_lift_track_45deg (Bank13.asm:991) — per-cell stamp.
// ─────────────────────────────────────────────────────────────────────

const liftTrack45deg: PerCellHandler = (state) => {
  // $9B = $8000 (rewind marker — suppresses $2E auto-bump on row wrap).
  state.rewound = 0x8000;

  // Y = 0; if ($2A bit 7 set): Y += 2.
  // Direction-table base index. $2A is the column extent — when negative
  // the object grows LEFT and the direction tables use mirrored entries.
  const yBase = (state.zp2A & 0x80) !== 0 ? 2 : 0;

  const col = state.zp28 & 0xff;
  if (col === 0) {
    // ── LEFT EDGE column ──
    state.rewound = 0;
    if ((state.zp2C & 0xff) !== 0) return; // not row 0 → no stamp
    const cur = state.zp12 & 0xffff;
    if (cur === LIFT_TRACK_KEEP_CHECK_A || cur === LIFT_TRACK_KEEP_CHECK_B) {
      stampCell(state, LIFT_TRACK_KEEP_OUT);
      return;
    }
    // DATA_1384C9 indexed by Y (byte offset) → word at [yBase >> 1].
    stampCell(state, DATA_1384C9[yBase >>> 1]!);
    return;
  }

  // Compute ($28 + DATA_1384D9[Y]) & 0xFF and compare with $2A.
  // Cart: REP #$30 throughout, but $28 and $2A are read as byte values;
  // the ADC happens in 16-bit but only the low byte matters for the CMP
  // against $2A (also a byte). signed8($2A) for negative case is fine —
  // wraparound matches the 8-bit truncation.
  const dirStep = DATA_1384D9[yBase >>> 1]!;
  const sum = (col + dirStep) & 0xff;
  if (sum === (state.zp2A & 0xff)) {
    // ── RIGHT EDGE column ──
    if ((state.zp2C & 0xff) !== 0) return;
    const cur = state.zp12 & 0xffff;
    if (cur === LIFT_TRACK_KEEP_CHECK_A || cur === LIFT_TRACK_KEEP_CHECK_B) {
      stampCell(state, LIFT_TRACK_KEEP_OUT);
      return;
    }
    stampCell(state, DATA_1384D5[yBase >>> 1]!);
    return;
  }

  // ── MIDDLE column ──
  // tmp = ($2C << 1)
  // tmp += ($15 & $0002) << 1   ; orientation-stride offset (0 or 4)
  // tmp <<= 1                   ; ×2 for dw spacing
  // Y = yBase | tmp
  // stamp DATA_1385BF[Y / 2]
  let tmp = (state.zp2C & 0xff) << 1;          // $00 = $2C ASL
  tmp = (tmp + ((state.zp15 & 0x0002) << 1)) & 0xffff; // + ($15&2 ASL)
  tmp = (tmp << 1) & 0xffff;                   // ASL → ×2 for dw
  const yByte = (yBase | tmp) & 0xff;
  stampCell(state, DATA_1385BF[yByte >>> 1]!);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_lift_track_45deg (Bank12.asm:3019).
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x11, 0x12 share this handler.
function initLiftTrack45deg(state: DecodeState): void {
  // X = ($15 & $0002). Cart indexes by byte-spaced X; we use natural index.
  const variant = (state.zp15 & 0x0002) >>> 1; // 0 or 1
  state.zp2E = DATA_lift_track_45deg_extents[variant]!;
  state.zp17 = DATA_lift_track_45deg_steps[variant]!;
  walkerSetupKeepSlope(state, liftTrack45deg);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Both $11 and $12 share the same init; the variant
// branching is `$15 & $0002`-driven inside the init + stamp.
// ─────────────────────────────────────────────────────────────────────

export function installLiftTrack45degHandlers(): void {
  registerStdObjectHandler(0x11, initLiftTrack45deg);
  registerStdObjectHandler(0x12, initLiftTrack45deg);
}
