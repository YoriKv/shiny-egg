// Bank13 stamp handler + Bank12 init wrapper for std object $7C —
// the "slope decoration dual" / paired drip overlay. A column-by-column
// diagonal decoration shape: each new column trims one row off the
// bottom (right-edge skip pattern), producing a triangular drip. Rows
// alternate $1D8C / $1D8E (interior body, family-$6800 slots), with the
// last two rows of each column drawing slot-pair caps:
//
//   $2A positive (col_extent>0)  → DATA_slope_decoration_dual_tiles_b
//                                  {$1DA8, $1DA6, $1D8C, $1D8E}
//   $2A negative                 → DATA_slope_decoration_dual_tiles_a
//                                  {$1DA2, $1DA4, $1D8C, $1D8E}
//
// The last-row cell additionally runs a ceiling-probe gate against the
// current cell's existing Map16 ID:
//   - matches `slot_1D92` ($1D92) → force Y=0 (cap)
//   - matches `slot_1D98` ($1D98) → force Y=0 (cap)
//   - high byte == Family6800_Anchor ($1D8A) page (i.e. ID in $68xx) →
//     skip the stamp entirely (already part of the drip family)
//   - else → Y=0 (cap)
//
//     - 16-col × variable-row (16,15,...,1) = 136 cells
//     - body alternation: $6801 / $6802 (= templateAt $1D8C / $1D8E)
//     - column-tail cap pair: $680E / $680F (= templateAt $1DA6 / $1DA8
//       for the $2A-positive test case)
//
// Asm sources:
//   CODE_init_slope_decoration_dual   Bank12.asm:4312 ($12:9BEE)
//   CODE_129BF8                       Bank12.asm:4318 ($12:9BF8)
//   CODE_slope_decoration_dual_stamp  Bank13.asm:9017 ($13:CCBE)
//   DATA_slope_decoration_dual_tiles_a Bank13.asm:9078 ($13:CD22)
//   DATA_slope_decoration_dual_tiles_b Bank13.asm:9082 ($13:CD2A)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell, signed8 } from './_shared.ts';
import { TT } from '../template-slots.ts';

// ─────────────────────────────────────────────────────────────────────
// Per-variant template-slot tables. Each entry is a WRAM addr that the
// caller dereferences via state.templateAt() to obtain the actual Map16
// ID — matches the cart's `LDA ($00),y / TAX / LDA $0000,x` indirection.
//
// Layout (4 entries, word-indexed by Y/2 in cart asm):
//   [0] last row (Y=0)         — slope-tip cap
//   [1] penultimate row (Y=2)  — slope-end transition
//   [2] body, even-row XOR even-col / odd-row XOR odd-col (Y=4)
//   [3] body, complementary parity (Y=6)
// ─────────────────────────────────────────────────────────────────────

const SLOT_SlopeDecorDualA_LastRow = 0x001DA2;
const SLOT_SlopeDecorDualA_PenultRow = 0x001DA4;
const SLOT_SlopeDecorDualB_LastRow = 0x001DA8;
const SLOT_SlopeDecorDualB_PenultRow = 0x001DA6;
const SLOT_SlopeDecorDual_BodyEven = 0x001D8C;
const SLOT_SlopeDecorDual_BodyOdd = 0x001D8E;

/** DATA_slope_decoration_dual_tiles_a ($13:CD22) — used when $2A negative. */
const DATA_slope_decoration_dual_tiles_a: ReadonlyArray<number> = [
  SLOT_SlopeDecorDualA_LastRow,
  SLOT_SlopeDecorDualA_PenultRow,
  SLOT_SlopeDecorDual_BodyEven,
  SLOT_SlopeDecorDual_BodyOdd,
];

/** DATA_slope_decoration_dual_tiles_b ($13:CD2A) — used when $2A positive. */
const DATA_slope_decoration_dual_tiles_b: ReadonlyArray<number> = [
  SLOT_SlopeDecorDualB_LastRow,
  SLOT_SlopeDecorDualB_PenultRow,
  SLOT_SlopeDecorDual_BodyEven,
  SLOT_SlopeDecorDual_BodyOdd,
];

// ─────────────────────────────────────────────────────────────────────
// Last-row ceiling-probe sentinels. The cart asm reads them inline as
// `CMP.w $1D92` / `CMP.w $1D98` — no named TT slot for either, but they
// sit immediately inside the Family6800 page anchored at $1D8A. Promote
// to TT.* if a future handler reads them.
// ─────────────────────────────────────────────────────────────────────
const SLOT_SlopeDecorDual_CeilingProbeA = 0x001D92;
const SLOT_SlopeDecorDual_CeilingProbeB = 0x001D98;

// ─────────────────────────────────────────────────────────────────────
// CODE_slope_decoration_dual_stamp ($13:CCBE, Bank13.asm:9017).
//
//   REP #$30
//   if $2C == 0 AND $28 != 0: DEC $2E    ; right-edge skip — trims 1 row
//                                         ; per column after the first
//   $00 = ($2A negative) ? DATA_..._tiles_a : DATA_..._tiles_b
//   A = $2C + 1
//   if A == $2E: goto last_row             ; current row IS the last row
//   A = $2C + 2
//   if A == $2E: Y = 2 (penultimate)
//   else:
//     ; interior body — checkerboard pick
//     $02 = (($2C & 1) + 2) << 1          ; row even → 4, row odd → 6
//     A   = ($28 & 1) << 1                 ; col even → 0, col odd → 2
//     Y   = A XOR $02
//   stamp_y:
//     A = ($00),y                          ; WRAM template-slot addr
//     X = A
//     A = $0000,x                          ; deref → Map16 ID
//     STA.l levelDataBuffer,[$1D]
//   last_row:
//     if $12 == [$1D92] or [$1D98]:
//       Y = 0; stamp Y
//     elif ($12 & $FF00) == [$1D8A] (Family6800_Anchor):
//       RTL                                ; skip stamp — already drip
//     else:
//       Y = 0; stamp Y
//
// Note: $2C / $28 / $2E are 16-bit (REP #$30). $2E (the row extent) is kept
// 16-bit on mutation (`& 0xffff`, NOT `& 0xff`) so the walker can read its sign
// as a 16-bit word for the row direction (see walker.ts — an 8-bit truncation
// would misread a height-127 $0080 / a negative $FFxx extent). The right-edge
// DEC produces -1 ($FFFF) only if init set $2E = 0, which it doesn't (it's
// |zp2A|, zp2A != 0 for any valid object).
// ─────────────────────────────────────────────────────────────────────

const stampSlopeDecorationDual: PerCellHandler = (state) => {
  // Right-edge skip: first row of each non-first column trims $2E by 1.
  // This is what produces the diagonal triangle silhouette — each new
  // column walks one fewer row than the previous.
  if ((state.zp2C & 0xff) === 0 && (state.zp28 & 0xff) !== 0) {
    state.zp2E = (state.zp2E - 1) & 0xffff;
  }

  // Variant table select. $2A is the col extent (signed); the cart
  // checks the 16-bit value (REP #$30 then LDX $2A; BMI). We use the
  // 8-bit sign bit, matching bank13-overhang-decor's convention.
  const tiles = (state.zp2A & 0x80) !== 0
    ? DATA_slope_decoration_dual_tiles_a
    : DATA_slope_decoration_dual_tiles_b;

  // Row classification. $2E may have been DEC'd above; use it AS-IS
  // (the asm does the DEC before this compare too).
  const row = state.zp2C & 0xff;
  const extent = state.zp2E & 0xff;
  const rowPlus1 = (row + 1) & 0xff;
  const rowPlus2 = (row + 2) & 0xff;

  let slotIdx: number;
  if (rowPlus1 === extent) {
    // Last row — ceiling probe gate.
    const cur = state.zp12 & 0xffff;
    const probeA = state.templateAt(SLOT_SlopeDecorDual_CeilingProbeA);
    const probeB = state.templateAt(SLOT_SlopeDecorDual_CeilingProbeB);
    if (cur !== probeA && cur !== probeB) {
      // Check Family6800 page (high byte): if the existing tile is
      // already a $68xx family member, leave it untouched.
      const family6800 = state.templateAt(TT.Family6800_Anchor);
      if ((cur & 0xFF00) === (family6800 & 0xFF00) && (family6800 & 0xFF00) !== 0) {
        // Already part of the drip family — skip stamp (cart CODE_13CD1F).
        return;
      }
      // Note the second branch of the asm's `CMP $1D8A` test is also
      // a write — when the high-byte matches, the cart skips the stamp
      // (BEQ CODE_13CD1F → RTL). Other paths (cur matches probeA/B,
      // or high-byte mismatch) fall through to Y=0 stamp.
    }
    slotIdx = 0;
  } else if (rowPlus2 === extent) {
    // Penultimate row.
    slotIdx = 1;
  } else {
    // Interior body — checkerboard.
    //   $02 = (($2C & 1) + 2) << 1   ; row even → $04, row odd → $06
    //   A   = ($28 & 1) << 1          ; col even → $00, col odd → $02
    //   Y   = A XOR $02               ; byte offset into word table
    // Convert byte-offset Y to word-index (entry pick): Y / 2.
    const rowParityTerm = (((state.zp2C & 0x01) + 2) << 1) & 0xff; // 4 or 6
    const colParityTerm = ((state.zp28 & 0x01) << 1) & 0xff;        // 0 or 2
    const yByte = colParityTerm ^ rowParityTerm;                    // 4 or 6
    slotIdx = yByte >>> 1;                                          // 2 or 3
  }

  const slotAddr = tiles[slotIdx]!;
  stampCell(state, state.templateAt(slotAddr));
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_slope_decoration_dual ($12:9BEE, Bank12.asm:4312).
//
//   REP #$20
//   LDA $2A
//   BPL skip
//     EOR #$FFFF ; INC                ; abs() — 16-bit two's complement
//   skip:
//   STA $2E                            ; row extent = |col extent|
//   JMP walker_setup_trampoline(stamp_slope_decoration_dual)
//
// The init sets row_extent = |col_extent| so the column-walk and row-
// walk both step the same number of cells (16×16 in the spec test).
// The stamp then trims via right-edge skip to produce the triangle.
//
// Note: cart compute is 16-bit, but our zp2A/zp2E are bytes. Use
// signed8 to widen-then-negate so a $80 col-extent maps to $80 |abs|.
// (Real data has col-extent < $80 anyway for any realistic object.)
// ─────────────────────────────────────────────────────────────────────

function initSlopeDecorationDual(state: DecodeState): void {
  const cols = state.zp2A & 0xff;
  const absCols = cols & 0x80
    ? ((-signed8(cols)) & 0xff)
    : cols;
  state.zp2E = absCols;
  walkerSetupTrampoline(state, stampSlopeDecorationDual);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installSlopeDecorationDualHandlers(): void {
  registerStdObjectHandler(0x7C, initSlopeDecorationDual);
}
