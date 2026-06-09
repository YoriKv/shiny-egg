// Bank13 graffiti-rail-diagonal stamp handler + Bank12 init wrapper.
//
// Standard object $52 — diagonal graffiti rail (decorative). A 2-row-tall
// "corner-cap" decorator: rows 0/1 stamp a 2x2 diagonal shape (TL/TR top,
// BL/BR bottom), with the row-0/row-1 + orientation-direction combination
// choosing which corner each cell receives. Rows 2+ stamp nothing (the
// walker still visits them; the stamp handler early-returns).
//
// The init wrapper differs from the bare trampoline used by neighbouring
// decor objects ($50/$51/$7D etc.) by pre-loading `$17 = $FFFF` (left-
// stepping per-row slope, for the diagonal shape), `$19 = $7FFF` (row
// handler unreachable — everything goes through col handlers), and wiring
// all three walker slots (even/odd/row) to the same stamp routine.
//
//
// Asm sources:
//   CODE_init_graffiti_rail_diagonal       Bank12.asm:3738 ($12:97FD)
//   CODE_stamp_graffiti_rail_diagonal      Bank13.asm:6540 ($13:B95C)
//   DATA_graffiti_rail_diagonal_tiles      Bank13.asm:6565 (DATA_graffiti_rail_diagonal_tiles)
//     dw $1C50, $1C4E, $1C4A, $1C4C   ; TL / TR / BL / BR (4 template-slot addrs)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerRun } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Unnamed template-slot addresses used only by the graffiti-rail-diagonal
// family. None currently have canonical TT.* names; if a parent sweep finds
// other handlers reading them, promote to TT.* there.
// ─────────────────────────────────────────────────────────────────────
const SLOT_GraffitiRailDiagonal_TL = 0x001C50; // row 0, $2A positive (grows right)
const SLOT_GraffitiRailDiagonal_TR = 0x001C4E; // row 1, $2A positive
const SLOT_GraffitiRailDiagonal_BL = 0x001C4A; // row 0, $2A negative (grows left)
const SLOT_GraffitiRailDiagonal_BR = 0x001C4C; // row 1, $2A negative

// DATA_graffiti_rail_diagonal_tiles (Bank13.asm:6565). Word table
// indexed by `Y = (row << 1) | ((zp2A negative) ? 4 : 0)`; entries are
// WRAM template-slot addrs. Caller dereferences via state.templateAt().
const GRAFFITI_RAIL_DIAGONAL_TILES: ReadonlyArray<number> = [
  SLOT_GraffitiRailDiagonal_TL,
  SLOT_GraffitiRailDiagonal_TR,
  SLOT_GraffitiRailDiagonal_BL,
  SLOT_GraffitiRailDiagonal_BR,
];

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_graffiti_rail_diagonal ($13:B95C, Bank13.asm:6540).
//
// REP #$30
// LDA #$0001 ; STA $9B           ; force "rewound" flag for the walker's
//                                  ; nibble-rewind + row-extent path
// LDA $2C ; CMP #$0002 ; BCS done ; rows 2+ stamp nothing
// ASL ; TAY                       ; Y = row * 2 (0 for row 0, 2 for row 1)
// LDA $2A ; BPL skip              ; if zp2A positive (grows right) → no flip
//   TYA ; ORA #$0004 ; TAY        ; else Y |= 4 (use BL/BR half of table)
// skip:
// LDX $1D ; LDA DATA_graffiti_rail_diagonal_tiles,y     ; slot addr from table
// TAY ; LDA $0000,y               ; deref template-slot at WRAM addr Y
// STA.l levelDataBuffer,x         ; stamp Map16 ID
// ─────────────────────────────────────────────────────────────────────

const stampGraffitiRailDiagonal: PerCellHandler = (state) => {
  // Asm `LDA #$0001 / STA $9B` — sets walker's nibble-rewind flag. Mirrors
  // bank13-castle-wall-diag-end's stampCastleWallDiagEndDiagonal: $0001 keeps both
  // the rewind behaviour AND the $2E extent bump active on column wraps.
  state.rewound = 0x0001;

  // Rows 2+ stamp nothing (asm `CMP #$0002 ; BCS CODE_13B982 ; RTL`).
  const row = state.zp2C & 0xff;
  if (row >= 2) return;

  // Y = (row << 1) | ((zp2A sign bit) ? 4 : 0). The 4 cases mirror
  // TL / TR / BL / BR corner picks.
  //
  // Note on $2A sign: the cart's `LDA $2A ; BPL` is a 16-bit BPL after REP #$30
  // (bit 15); $2A is a 16-bit word in our state too (see doRowWrap). This
  // handler checks `$2A & 0x80` (low-byte bit 7), which agrees with the 16-bit
  // sign for every real width; only $2A=$0080 (a width-128 object) would
  // disagree, which no level using this object hits. Same convention as
  // bank13-lift-track-30deg.ts.
  let yIdx = row & 0x01; // 0 or 1 — we use a TS half-index (asm Y / 2)
  if ((state.zp2A & 0x80) !== 0) {
    yIdx += 2;
  }

  const slotAddr = GRAFFITI_RAIL_DIAGONAL_TILES[yIdx]!;
  stampCell(state, state.templateAt(slotAddr));
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_graffiti_rail_diagonal ($12:97FD, Bank12.asm:3738).
//
//   STA $21/$22/$24/$25/$27 ← all three walker slots = stampGraffitiRailDiagonal
//   STA $19 ← $7FFF         (row handler is unreachable; everything goes
//                            through col handlers — but cart wires it
//                            anyway for safety)
//   STA $17 ← $FFFF         (per-row slope: column wraps step LEFT by one)
//   JSR object_stream_walk  (equivalent to walkerRun w/ asymmetric slots)
//
// Bare full walker setup — no DP mutations. Extent/orientation come
// straight from the Bank10 stream record. Spec.md DP-diff table confirms
// all entry-DP fields are unchanged at walker-time.
//
// Use walkerRun (NOT walkerSetupTrampoline) so the pre-set $17 is
// preserved — trampoline zeroes $17, which would break the diagonal
// shape's left-stepping advance.
// ─────────────────────────────────────────────────────────────────────

function initGraffitiRailDiagonal(state: DecodeState): void {
  // $17 = $FFFF — left-stepping per-row slope for the diagonal shape.
  state.zp17 = 0xFFFF;

  // All three walker slots dispatch to stampGraffitiRailDiagonal; $19 = $7FFF
  // means the row handler is never reached (termination via $2C == $2E
  // / extent-count walking). Mirrors the cart's STA $19 ← $7FFF.
  walkerRun(
    state,
    /*oddCol*/  stampGraffitiRailDiagonal,
    /*evenCol*/ stampGraffitiRailDiagonal,
    /*row*/     stampGraffitiRailDiagonal,
    /*rowsEnd*/ 0x7FFF,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installGraffitiRailDiagonalHandlers(): void {
  registerStdObjectHandler(0x52, initGraffitiRailDiagonal);
}
