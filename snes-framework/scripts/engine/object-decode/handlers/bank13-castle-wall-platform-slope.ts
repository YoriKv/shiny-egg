// Bank13 castle-wall-platform-slope stamp handler + Bank12 init wrapper.
//
// Standard objects $54 / $55 / $56 — three downward-slanted platform
// variants on a castle wall (slow / medium / steep slope). All three
// share the same init handler `CODE_init_castle_wall_platform_slope`;
// the orientation byte `$15` (= object ID) selects which of three
// sub-stamp routines runs for the "interior" cells:
//
//   $54 → CODE_stamp_castle_wall_platform_slope_mid          (mid-rectangle body)
//   $55 → CODE_stamp_castle_wall_platform_slope_transition   (transition row between
//                                              mid and cap)
//   $56 → CODE_stamp_castle_wall_platform_slope_cap          (top cap row)
//
// Selected via the `($15 & 3) * 2` index into DATA_castle_wall_platform_slope_sub_handlers (3-entry
// sub-handler pointer table). The cart also keys `$17` (per-row slope
// step) off the same low 2 bits: DATA_castle_wall_platform_slope_steps = $FFFF, $FFFF, $FFFE —
// so $54 and $55 step 1 column left per row, $56 steps 2 left.
//
// Cells on the rectangle's "outer column" (col 0 OR col == col-extent
// adjusted for direction) fall through to a "default" branch that
// stamps an under-tile zone overlay (DATA_castle_wall_platform_slope_zone_tiles = $150D/$150E/$150D)
// or a default-tile entry (DATA_castle_wall_platform_slope_default_tiles = $00D1/$00D2/$151B) based on
// the current cell's existing Map16 contents (so the platform can
// graft cleanly onto preceding floor / wall tiles).
//
// Asm sources:
//   CODE_init_castle_wall_platform_slope       Bank12.asm:3764 ($12:982A)
//   DATA_castle_wall_platform_slope_steps         Bank12.asm:3787 (DATA_castle_wall_platform_slope_steps)
//   CODE_stamp_castle_wall_platform_slope      Bank13.asm:6646 ($13:BA20)
//   DATA_castle_wall_platform_slope_default_tiles       Bank13.asm:6716 (DATA_castle_wall_platform_slope_default_tiles)
//   DATA_castle_wall_platform_slope_zone_tiles          Bank13.asm:6720 (DATA_castle_wall_platform_slope_zone_tiles)
//   DATA_castle_wall_platform_slope_sub_handlers        Bank13.asm:6724 (DATA_castle_wall_platform_slope_sub_handlers)
//   CODE_stamp_castle_wall_platform_slope_mid           Bank13.asm:6730 ($13:BAA4)
//   DATA_castle_wall_platform_slope_mid_tiles           Bank13.asm:6761 (DATA_castle_wall_platform_slope_mid_tiles)
//   CODE_stamp_castle_wall_platform_slope_transition    Bank13.asm:6765 ($13:BAE6)
//   DATA_castle_wall_platform_slope_trans_tiles         Bank13.asm:6788 (DATA_castle_wall_platform_slope_trans_tiles)
//   CODE_stamp_castle_wall_platform_slope_cap           Bank13.asm:6792 ($13:BB13)
//   DATA_castle_wall_platform_slope_cap_tiles           Bank13.asm:6816 (DATA_castle_wall_platform_slope_cap_tiles)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupKeepSlope } from '../walker.ts';
import { stampCell } from './_shared.ts';
import { TT } from '../template-slots.ts';

// ─────────────────────────────────────────────────────────────────────
// Per-row slope-step table for the init wrapper.
//
// DATA_castle_wall_platform_slope_steps (Bank12.asm:3787). 3 entries indexed by `($15 & 3) * 2`:
//   $54 → $FFFF  (1 column-unit leftward step per row)
//   $55 → $FFFF  (same — transition variant; visual differs)
//   $56 → $FFFE  (2 column-units leftward step per row — steeper cap)
// ─────────────────────────────────────────────────────────────────────

const DATA_castle_wall_platform_slope_steps: ReadonlyArray<number> = [0xFFFF, 0xFFFF, 0xFFFE];

// ─────────────────────────────────────────────────────────────────────
// Top-level dispatcher tables.
//
// DATA_castle_wall_platform_slope_default_tiles — 3-entry default-tile table for the under-tile fallback
// branch (selected when col is 0 OR col == col-extent end-edge AND
// row 0). Indexed by Y in {0, 2, 4}:
//   Y = 0 → $00D1   (plain corner tile)
//   Y = 2 → $00D2   (mirror corner tile)
//   Y = 4 → $151B   (alt corner — picked when current cell was $00C5)
//
// DATA_castle_wall_platform_slope_zone_tiles — 3-entry zone-overlay tile table. Used when the existing
// cell ($12) is $00D1 / $00D2 (so the platform overlays an existing corner):
//   Y = 0 → $150D
//   Y = 2 → $150E
//   Y = 4 → $150D   (matches the $00D2 branch after INY INY → Y=2; the
//                    third slot is unused in practice — but populated.)
// ─────────────────────────────────────────────────────────────────────

const DATA_castle_wall_platform_slope_default_tiles: ReadonlyArray<number> = [0x00D1, 0x00D2, 0x151B];
const DATA_castle_wall_platform_slope_zone_tiles:    ReadonlyArray<number> = [0x150D, 0x150E, 0x150D];

// ─────────────────────────────────────────────────────────────────────
// Sub-handler tables.
//
// DATA_castle_wall_platform_slope_mid_tiles — 8-entry mid tile table (CODE_stamp_castle_wall_platform_slope_mid).
// Indexed by `Y = (col_parity_even ? 4 : 0) | (col_dir_negative ? 8 : 0)
// | (row & 1) * 2`. Range 0..15; in practice traces only hit 0..7 (the
// `$2A positive` half). The 8 entries store template-slot WRAM
// addresses dereferenced via state.templateAt().
// ─────────────────────────────────────────────────────────────────────

const SLOT_CastleWallPlatformSlopeMid_0 = 0x001A42;
const SLOT_CastleWallPlatformSlopeMid_1 = 0x001A60;
const SLOT_CastleWallPlatformSlopeMid_3 = 0x001A5C;
const SLOT_CastleWallPlatformSlopeMid_4 = 0x001A34;
const SLOT_CastleWallPlatformSlopeMid_7 = 0x001A40;

const DATA_castle_wall_platform_slope_mid_tiles: ReadonlyArray<number> = [
  SLOT_CastleWallPlatformSlopeMid_0,           // Y=0: even col, positive dir, row 0
  SLOT_CastleWallPlatformSlopeMid_1,           // Y=2: even col, positive dir, row 1
  TT.Family1000_Anchor,           // Y=4: odd col,  positive dir, row 0
  SLOT_CastleWallPlatformSlopeMid_3,           // Y=6: odd col,  positive dir, row 1
  SLOT_CastleWallPlatformSlopeMid_4,           // Y=8: even col, negative dir, row 0
  TT.Family1200_Anchor,           // Y=A: even col, negative dir, row 1
  TT.Family0C00_Anchor,           // Y=C: odd col,  negative dir, row 0
  SLOT_CastleWallPlatformSlopeMid_7,           // Y=E: odd col,  negative dir, row 1
];

// DATA_castle_wall_platform_slope_trans_tiles — 4-entry transition tile table (stamp_castle_wall_platform_slope_transition).
// Indexed by `Y = (row & 1) * 2 | (col_dir_negative ? 4 : 0)`.
const SLOT_CastleWallPlatformSlopeTrans_1 = 0x001A28;
const SLOT_CastleWallPlatformSlopeTrans_3 = 0x001A14;

const DATA_castle_wall_platform_slope_trans_tiles: ReadonlyArray<number> = [
  TT.Family0A00_Anchor,           // Y=0: row 0, positive dir
  SLOT_CastleWallPlatformSlopeTrans_1,         // Y=2: row 1, positive dir
  TT.Family0800_Anchor,           // Y=4: row 0, negative dir
  SLOT_CastleWallPlatformSlopeTrans_3,         // Y=6: row 1, negative dir
];

// DATA_castle_wall_platform_slope_cap_tiles — 6-entry cap tile table (stamp_castle_wall_platform_slope_cap).
// Indexed by `Y = (row << 1) + (col_dir_negative ? 6 : 0)`; row in 0..2.
const SLOT_CastleWallPlatformSlopeCap_0 = 0x0019EE;
const SLOT_CastleWallPlatformSlopeCap_1 = 0x0019F6;
const SLOT_CastleWallPlatformSlopeCap_2 = 0x001A00;
const SLOT_CastleWallPlatformSlopeCap_4 = 0x0019E2;
const SLOT_CastleWallPlatformSlopeCap_5 = 0x0019EC;

const DATA_castle_wall_platform_slope_cap_tiles: ReadonlyArray<number> = [
  SLOT_CastleWallPlatformSlopeCap_0,           // Y=0: row 0, positive dir
  SLOT_CastleWallPlatformSlopeCap_1,           // Y=2: row 1, positive dir
  SLOT_CastleWallPlatformSlopeCap_2,           // Y=4: row 2, positive dir
  TT.Family0200_Anchor,           // Y=6: row 0, negative dir
  SLOT_CastleWallPlatformSlopeCap_4,           // Y=8: row 1, negative dir
  SLOT_CastleWallPlatformSlopeCap_5,           // Y=A: row 2, negative dir
];

// ─────────────────────────────────────────────────────────────────────
// Default-branch under-tile sentinels (literal Map16 IDs, not template
// slots — these are compared against the existing cell's `state.zp12`).
// ─────────────────────────────────────────────────────────────────────

const SENTINEL_NoStamp_A = 0x150D;
const SENTINEL_NoStamp_B = 0x150E;
const SENTINEL_Corner_A  = 0x00D1; // → zone overlay (DATA_castle_wall_platform_slope_zone_tiles)
const SENTINEL_Corner_B  = 0x00D2; // → zone overlay (DATA_castle_wall_platform_slope_zone_tiles), shifted index
const SENTINEL_AltCorner = 0x00C5; // → default tile (DATA_castle_wall_platform_slope_default_tiles) row index $04

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_castle_wall_platform_slope_mid ($13:BAA4, Bank13.asm:6730).
//
// Rows 0/1 only (CMP #$0002 / BCS done). Sets $9B = !(zp28 & 1) — the
// walker's "rewound" latch — then builds an 8-way index:
//   Y = (row << 1) | ((zp28 & 1)==0 ? 4 : 0) | ((zp2A neg) ? 8 : 0)
// Reads `DATA_castle_wall_platform_slope_mid_tiles[y]` as a WRAM template-slot, dereferences to a
// Map16 ID, and stamps.
//
// $2A sign-bit caveat: like other Bank13 handlers, our zp2A is the
// signed-byte model; the cart's BPL after REP #$30 checks bit 15. We
// use `& 0x80` for the same effect (see bank13-graffiti-rail-diagonal.ts L82).
// ─────────────────────────────────────────────────────────────────────

const stampCastleWallPlatformSlopeMid: PerCellHandler = (state) => {
  const row = state.zp2C & 0xff;
  if (row >= 2) return;

  // $9B = (zp28 ^ 1) & 1 — toggle of column parity (low bit). Asm:
  //   LDA $28 ; EOR #$0001 ; AND #$0001 ; STA $9B
  state.rewound = ((state.zp28 ^ 0x01) & 0x01) & 0xffff;

  // Entry index into the 8-word DATA_castle_wall_platform_slope_mid_tiles table. The cart assembles a
  // BYTE offset `Y = row*2 | $9B<<2 | neg<<3` (ASL ASL on $9B, ORA #$0008
  // for neg, ORA row*2) and the `LDA DATA_castle_wall_platform_slope_mid_tiles,y` word read halves it.
  // We index entries directly, so the entry index is that Y >> 1:
  //   bit0 = row & 1, bit1 = $9B (= !(zp28 & 1)), bit2 = zp2A negative.
  // (Range 0..7. The previous code shifted the whole word left one extra
  // time, doubling the $9B/neg weights — correct only for the odd-col /
  // positive-width corner; even columns mis-indexed and negative width
  // ran off the end of the table.)
  let yHalf = row & 0x01;
  if (state.rewound) yHalf |= 0x02;
  if ((state.zp2A & 0x80) !== 0) yHalf |= 0x04;

  const slotAddr = DATA_castle_wall_platform_slope_mid_tiles[yHalf]!;
  // Defensive: indices 4..7 (positive-dir-odd through negative-dir
  // pairs) are only used when $2A is negative; traces only hit 0..3.
  // The table is fully populated, so any in-range Y stamps correctly.
  stampCell(state, state.templateAt(slotAddr));
};

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_castle_wall_platform_slope_transition ($13:BAE6, Bank13.asm:6765).
//
// Force-sets $9B = 1 (always treat as post-rewind for this row), then
// for rows 0/1 only:
//   Y = (row & 1) << 1 | ((zp2A neg) ? 4 : 0)
//   load DATA_castle_wall_platform_slope_trans_tiles[y], deref template-slot, stamp.
// ─────────────────────────────────────────────────────────────────────

const stampCastleWallPlatformSlopeTransition: PerCellHandler = (state) => {
  state.rewound = 0x0001;

  const row = state.zp2C & 0xff;
  if (row >= 2) return;

  let yHalf = row & 0x01;
  if ((state.zp2A & 0x80) !== 0) yHalf |= 0x02;

  const slotAddr = DATA_castle_wall_platform_slope_trans_tiles[yHalf]!;
  stampCell(state, state.templateAt(slotAddr));
};

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_castle_wall_platform_slope_cap ($13:BB13, Bank13.asm:6792).
//
// Force-sets $9B = 1 (always treat as post-rewind). For rows 0..2:
//   Y = (row << 1) + ((zp2A neg) ? 6 : 0)
//   load DATA_castle_wall_platform_slope_cap_tiles[y], deref template-slot, stamp.
//
// Note the +6 (vs +4 in transition / |0x08 in mid) — the cap table is
// 6 entries (3 rows × 2 directions), packed sequentially.
// ─────────────────────────────────────────────────────────────────────

const stampCastleWallPlatformSlopeCap: PerCellHandler = (state) => {
  state.rewound = 0x0001;

  const row = state.zp2C & 0xff;
  if (row >= 3) return;

  let yHalf = row;
  if ((state.zp2A & 0x80) !== 0) yHalf += 3;

  const slotAddr = DATA_castle_wall_platform_slope_cap_tiles[yHalf]!;
  stampCell(state, state.templateAt(slotAddr));
};

// ─────────────────────────────────────────────────────────────────────
// 3-entry sub-handler dispatch table (DATA_castle_wall_platform_slope_sub_handlers).
// Indexed by `($15 & 3) * 2`:
//   x=0 → $54 → mid
//   x=2 → $55 → transition
//   x=4 → $56 → cap
// ─────────────────────────────────────────────────────────────────────

const CASTLE_WALL_PLATFORM_SLOPE_SUB_HANDLERS: ReadonlyArray<PerCellHandler> = [
  stampCastleWallPlatformSlopeMid,
  stampCastleWallPlatformSlopeTransition,
  stampCastleWallPlatformSlopeCap,
];

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_castle_wall_platform_slope ($13:BA20, Bank13.asm:6646).
//
// Top-level per-cell dispatcher. Two paths:
//
//   1. INTERIOR path (col != 0 AND col != col-extent-end-edge):
//      Compute `x = ($15 & 3) * 2`, JSR through DATA_castle_wall_platform_slope_sub_handlers,x →
//      one of mid/transition/cap. The sub-handler does the actual
//      stamp.
//
//   2. DEFAULT path (col == 0  OR  col+1 == col-extent-adjusted):
//      Only acts on row 0. Inspects the existing cell ($12, latched by
//      the walker's per-col `getCurrentMap16Tile`) to choose between:
//
//        - Skip entirely if $12 in [Family0200_Anchor, Family1200_Anchor)
//          (zone-range — the platform already grafted onto a previous one)
//        - Skip if $12 == $150D or $150E (overlay sentinels)
//        - Stamp DATA_castle_wall_platform_slope_zone_tiles[y] if $12 == $00D1 / $00D2
//          (existing corner — overlay the zone tile). Y picks {0,2} by
//          which of the two corner sentinels matched.
//        - Otherwise stamp DATA_castle_wall_platform_slope_default_tiles[y]. Y starts
//          0, becomes 4 if $12 == $00C5 (alt-corner override),
//          XOR-flipped low bit if $2A is negative.
//
// The "col-extent end edge" detection mirrors the asm:
//   IF $2A >= 0: end-edge is at col == $2A
//   ELSE:        end-edge is at col == $2A + 2  (signed-byte adjust
//                                                to compensate for the
//                                                reversed direction)
// ─────────────────────────────────────────────────────────────────────

const stampCastleWallPlatformSlope: PerCellHandler = (state) => {
  // The cart's REP #$30 -> LDY #$0000 is implicit in our model. Y
  // here tracks the default-branch sub-index (0 or 2) used after
  // the "interior?" check fails.
  let yIdx = 0;

  // Compute col-extent end-edge check value (asm $00).
  let edgeCheck = state.zp2A & 0xff;
  if ((edgeCheck & 0x80) !== 0) {
    // $2A negative: A += 2 (cart `INC INC` after `BPL`).
    edgeCheck = (edgeCheck + 2) & 0xff;
  }

  const col = state.zp28 & 0xff;
  if (col !== 0) {
    yIdx = 2;
    // Asm: INC (A holds the prev edgeCheck value? — no, A holds $28
    // at this point, just-incremented). Actual sequence:
    //   LDA $28 ; BEQ default ; INY ; INY ; INC ; CMP $00 ; BEQ default
    // So we compare (col + 1) against edgeCheck.
    if (((col + 1) & 0xff) !== edgeCheck) {
      // INTERIOR path — dispatch to mid/transition/cap.
      const variantIdx = state.zp15 & 0x03;
      const sub = CASTLE_WALL_PLATFORM_SLOPE_SUB_HANDLERS[variantIdx];
      sub?.(state);
      return;
    }
    // Fall through to default branch with yIdx=2 (the cart's Y after
    // the two INY's).
  }

  // ── DEFAULT branch ($13:BA44) ─────────────────────────────────────
  // Only operates on row 0.
  if ((state.zp2C & 0xff) !== 0) return;

  const cur = state.zp12 & 0xffff;
  const fam0200 = state.templateAt(TT.Family0200_Anchor);
  const fam1200 = state.templateAt(TT.Family1200_Anchor);

  // CMP Family0200 ; BCC check1 ; CMP Family1200 ; BCC done
  // I.e.: if Family0200 <= $12 < Family1200, skip stamp.
  if (cur >= fam0200 && cur < fam1200) return;

  // check1 — sentinel checks.
  if (cur === SENTINEL_NoStamp_A) return;
  if (cur === SENTINEL_NoStamp_B) return;

  // Zone-tile path: cart `LDA DATA_13BA98,Y` reads at the BYTE offset Y (so the
  // word index is Y/2). `yIdx` is that byte offset (0 col-0, 2 col-edge), so the
  // word index is `yIdx >>> 1` — the same byte→word conversion the default-tiles
  // path below uses (`altY >>> 1`). (An earlier port indexed `zone_tiles[yIdx]`
  // directly, treating the byte offset as a word index: harmless for col-0
  // (yIdx 0), but col-edge picked the wrong entry, and $00D2+col-edge ran off the
  // 3-entry table → no stamp, leaving the under-tile — record $0C cell (24,122).)
  if (cur === SENTINEL_Corner_A) {
    // BEQ zone_path (Y unchanged) → word index yIdx/2.
    stampCell(state, DATA_castle_wall_platform_slope_zone_tiles[yIdx >>> 1]!);
    return;
  }
  if (cur === SENTINEL_Corner_B) {
    // INY INY (Y += 2) then read → word index (yIdx+2)/2.
    stampCell(state, DATA_castle_wall_platform_slope_zone_tiles[(yIdx + 2) >>> 1]!);
    return;
  }

  // alt_path: $2A sign flips low bit of Y.
  let altY = yIdx;
  if ((state.zp2A & 0x80) !== 0) altY ^= 0x02;

  // Defence: asm re-checks $2C == 0 here (BNE done). Already guarded
  // above, so no-op.

  // $12 == $00C5 force-overrides altY to 4 (asm `LDY #$0004`).
  if (cur === SENTINEL_AltCorner) altY = 4;

  // altY indexes DATA_castle_wall_platform_slope_default_tiles as words; 3 entries cover Y = 0/2/4.
  const tableIdx = altY >>> 1;
  if (tableIdx < DATA_castle_wall_platform_slope_default_tiles.length) {
    stampCell(state, DATA_castle_wall_platform_slope_default_tiles[tableIdx]!);
  }
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_castle_wall_platform_slope ($12:982A, Bank12.asm:3764).
//
//   STA $21/$22/$24/$25/$27 ← CODE_stamp_castle_wall_platform_slope (all 3 slots)
//   STA $19 ← $7FFF         (row handler unreachable; col handlers
//                            terminate via $2C==$2E extent match)
//   x = ($15 & 3) * 2
//   STA $17 ← DATA_castle_wall_platform_slope_steps[x]  (per-row slope step: $FFFF, $FFFF, $FFFE)
//   JSR object_stream_walk
//
// Use walkerSetupKeepSlope so the pre-set $17 survives — the
// trampoline form would zero it. No DP-field mutations (extents +
// orientation come straight from the stream record per spec.md).
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x54, 0x55, 0x56 share this handler.
function initCastleWallPlatformSlope(state: DecodeState): void {
  const x = (state.zp15 & 0x03) << 1;
  state.zp17 = DATA_castle_wall_platform_slope_steps[x >>> 1]!;
  walkerSetupKeepSlope(state, stampCastleWallPlatformSlope);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. $54/$55/$56 all route through the same init; the per-
// variant divergence is driven by the orientation byte (= object ID)
// at stamp time.
// ─────────────────────────────────────────────────────────────────────

export function installCastleWallPlatformSlopeHandlers(): void {
  registerStdObjectHandler(0x54, initCastleWallPlatformSlope);
  registerStdObjectHandler(0x55, initCastleWallPlatformSlope);
  registerStdObjectHandler(0x56, initCastleWallPlatformSlope);
}
