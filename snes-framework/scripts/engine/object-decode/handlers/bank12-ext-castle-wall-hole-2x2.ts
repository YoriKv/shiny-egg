// Bank12 EXTENDED-object handler: "castle wall hole 2x2" (ext $30).
//
// WALKER-DRIVEN extended object that carves a hole into an existing wall.
// The init handler (CODE_extobj_handler_castle_wall_hole_2x2, $12:8A14) shifts the
// anchor one cell LEFT, fixes a 4-col x 2-row rectangle, points all three
// walker slots at the per-cell stamper CODE_12AB64 ($12:AB64), and
// tail-calls the shared walker trampoline.
//
// CARVE BEHAVIOUR (flagged explicitly per the porting brief):
//   This IS a read-modify-write carve — the stamper reads the EXISTING cell
//   ($12, latched by the walker's getCurrentMap16Tile) and behaves
//   differently on the two OUTER ("wall edge") columns vs the two INNER
//   columns:
//     * Interior columns (col 1, col 2): stamp the hole-interior tile
//       UNCONDITIONALLY from DATA_12AB56[ row*4 + (col-1)*2 ].
//     * Edge columns (col 0 = left, col 3 = last): stamp ONLY IF the
//       existing cell already holds the matching wall-edge tile
//       (DATA_12AB60[Y]: left edge $015A, right edge $015B). If it matches,
//       overwrite with the hole-edge tile DATA_12AB56[$08] = $015C;
//       otherwise leave the cell untouched (no stamp). This is what makes
//       the object a "hole in a wall" rather than a free-standing block —
//       the rounded hole edges only appear where wall actually exists.
//   The trace's test cell sits on empty terrain ($12 == $0000), so both
//   edge columns take the BNE-out (no-stamp) branch — matching the spec's
//   per-cell timeline (only the 4 interior cells stamp: $015D/$015E/$015F/
//   $0160). The carve branch is honoured per the asm, NOT simplified away.
//
// Per-cell stamper (CODE_12AB64, $12:AB64). Verbatim asm:
//
//   CODE_12AB64:
//     REP #$30
//     LDX $1D                 ; buffer offset
//     LDY #$0000
//     LDA $28                 ; col counter
//     BEQ CODE_12AB76         ; col == 0 -> edge path, Y = 0 (left edge)
//     INC
//     CMP $2A                 ; (col+1) == col_extent (=4)? i.e. last col
//     BNE CODE_12AB82         ; interior column -> stamp path
//     INY : INY               ; last col -> Y = 2 (right edge)
//   CODE_12AB76: (edge path)
//     LDA $12                 ; existing cell tile
//     CMP DATA_12AB60,y       ; matches wall-edge tile for this side?
//     BNE CODE_12AB96         ; no -> RTL (no stamp)
//     LDY #$0008              ; yes -> index $08 (hole-edge tile $015C)
//     BRA CODE_12AB8F
//   CODE_12AB82: (interior path)
//     LDA $28 : DEC : ASL : STA $00        ; (col-1)*2
//     LDA $2C : ASL : ASL : ORA $00 : TAY  ; Y = row*4 + (col-1)*2
//   CODE_12AB8F:
//     LDA DATA_12AB56,y
//     STA buffer,x            ; stamp
//   CODE_12AB96:
//     SEP #$30 : RTL
//
//   DATA_12AB56 ($12:AB56), dw $015D,$015E,$015F,$0160,$015C
//     => interior tiles at word offsets 0,1,2,3 and the hole-EDGE tile
//        $015C at word offset 4 (byte offset $08).
//   DATA_12AB60 ($12:AB60), dw $015A,$015B
//     => wall-edge match tiles: left ($015A) at Y=0, right ($015B) at Y=2.
//   Both read verbatim from Bank12.asm (NOT the ROM); version-stable.
//
// Walker counters: the engine walker drives `state.zp28` (col 0..3) and
// `state.zp2C` (row 0..1) in column-major order, matching the cart loop,
// and the cart's stamper consumes exactly those (col/row). $2A holds the
// col extent (4), so the cart's `(col+1) == $2A` last-column test maps to
// `col == col_extent - 1` here. No PRNG, no neighbour probes, no savefile
// gates — exact port.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Cart DATA tables, read verbatim from Bank12.asm (see header). Stored as
// 16-bit words; the cart indexes by byte offset so word index = byteY >> 1.
// ─────────────────────────────────────────────────────────────────────

/** DATA_12AB56 ($12:AB56): interior tiles [0..3] + hole-edge tile at [4]. */
const HOLE_TILES: readonly number[] = [
  0x015d, // word 0 — interior, row0 col1
  0x015e, // word 1 — interior, row0 col2
  0x015f, // word 2 — interior, row1 col1
  0x0160, // word 3 — interior, row1 col2
  0x015c, // word 4 (byte $08) — hole-EDGE tile (edge-column carve result)
] as const;

/** DATA_12AB60 ($12:AB60): wall-edge match tiles — left (Y=0), right (Y=2). */
const WALL_EDGE_MATCH: readonly number[] = [
  0x015a, // Y=0 (byte $0): left wall edge
  0x015b, // Y=2 (byte $2): right wall edge
] as const;

const BLOCK_COLS = 0x04; // col extent (STA $2A)
const BLOCK_ROWS = 0x02; // row extent (STA $2E)

// Index $08 (byte) -> word 4 -> the hole-edge tile $015C.
const HOLE_EDGE_WORD = 0x08 >> 1;

// ─────────────────────────────────────────────────────────────────────
// Per-cell stamper. Ports CODE_12AB64 ($12:AB64).
//
// `state.zp28` = col, `state.zp2C` = row, `state.zp1D` = buffer offset,
// `state.zp12` = existing tile (all latched by the walker before this call).
// ─────────────────────────────────────────────────────────────────────

const stampCastleWallHole2x2: PerCellHandler = (state: DecodeState): void => {
  const col = state.zp28 & 0xffff;
  const row = state.zp2C & 0xffff;
  const colExtent = state.zp2A & 0xffff;

  // CODE_12AB64: LDA $28 : BEQ ... INC : CMP $2A : BNE (interior).
  // col == 0 -> left edge (Y=0); (col+1) == colExtent -> right edge (Y=2);
  // otherwise interior.
  const isLeftEdge = col === 0;
  const isRightEdge = col + 1 === colExtent;

  if (isLeftEdge || isRightEdge) {
    // CODE_12AB76 (edge path): carve only where a wall edge already exists.
    const matchWord = isLeftEdge ? 0 : 1; // DATA_12AB60: Y=0 left, Y=2 right.
    if ((state.zp12 & 0xffff) !== WALL_EDGE_MATCH[matchWord]) return; // BNE -> no stamp.
    // Matched the wall edge -> overwrite with the hole-edge tile ($015C).
    stampCell(state, HOLE_TILES[HOLE_EDGE_WORD]!);
    return;
  }

  // CODE_12AB82 (interior path): Y = row*4 + (col-1)*2  -> word index
  //   = (row*4 + (col-1)*2) / 2 = row*2 + (col-1).
  const wordIdx = (row << 1) + (col - 1);
  stampCell(state, HOLE_TILES[wordIdx]!);
};

// ─────────────────────────────────────────────────────────────────────
// Init handler. Ports CODE_extobj_handler_castle_wall_hole_2x2 ($12:8A14):
// anchor xy_lo -= 1 (carve begins one cell left of the placement anchor),
// fixed 4x2 rectangle, single stamper in all walker slots, slope 0.
// ─────────────────────────────────────────────────────────────────────

const initExtCastleWallHole2x2: InitHandler = (state: DecodeState): void => {
  // Shift the anchor one cell LEFT (sub-screen-X -= 1) so the 4-wide
  // footprint straddles the placement point (spec: $1B $88 -> $87). The cart
  // does a NIBBLE-ISOLATED decrement on the 16-bit word at $1B:$1C, not a
  // flat byte DEC (Bank12.asm:1773-1782):
  //   REP #$20
  //   LDA $1B : AND #$0F0F : DEC : AND #$0F0F : STA $00  ; (subX - 1), borrow
  //                                                      ; contained in the nibble
  //   LDA $1B : AND #$F0F0 : ORA $00 : STA $1B           ; keep screen nibbles
  // Only the low byte's low nibble (sub-screen-X) changes, so operating on
  // `zp1B` alone is faithful (`getCurrentMap16Tile` reads zp1B/zp1C as
  // separate bytes). The walker re-derives each column's buffer offset from
  // this anchor, so the single decrement propagates to every column's
  // buf_addr (spec: col0 -> $7F830E, col1 -> $7F8310, ...).
  // The cart op is on the 16-bit $1C:$1B word (REP #$20). The DEC of the
  // $0F0F-masked word decrements sub-X (the $1B low nibble); when sub-X is
  // 0 the borrow propagates THROUGH $1B's high nibble into $1C's low nibble
  // (screen-X), i.e. the anchor steps into the previous screen-page column.
  // Operating on the `zp1B` byte alone drops that cross-byte borrow, so a
  // hole anchored at sub-X == 0 would land a full screen-column (16 tiles)
  // off in X. Compose the word, decrement, split back (same shape as the
  // $49/$52/$53 siblings, which share this exact cart prologue).
  const word1B = (state.zp1B | (state.zp1C << 8)) & 0xffff;
  const subDec = ((word1B & 0x0f0f) - 1) & 0x0f0f; // AND #$0F0F : DEC : AND #$0F0F
  const newWord = ((word1B & 0xf0f0) | subDec) & 0xffff; // ORA back screen nibbles
  state.zp1B = newWord & 0xff;
  state.zp1C = (newWord >>> 8) & 0xff;
  state.zp2A = BLOCK_COLS; // col extent = 4
  state.zp2E = BLOCK_ROWS; // row extent = 2
  walkerSetupTrampoline(state, stampCastleWallHole2x2);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Ext id $30 only (the $130 mirror is automatic —
// getExtObjectHandler masks id & 0xff).
// ─────────────────────────────────────────────────────────────────────

export function installExtCastleWallHole2x2Handlers(): void {
  registerExtObjectHandler(0x30, initExtCastleWallHole2x2);
}
