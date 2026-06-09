// Bank13 breakable-rock 2x2-block stamp handler + Bank12 init wrapper.
//
// Standard objects $A3 (BreakableRock) and $A4 (BreakableRockCracked) — a
// 2x2 breakable-rock block whose tile page is selected by orientation byte
// $15 bit 2. Both IDs share the same init + stamp routines in the cart;
// the only delta is what $15 looks like on entry:
//
//   $A3 BreakableRock        ($10100011): $15 & $0004 = $00 -> tile-page offset 0, stamps $7B00..$7B03
//   $A4 BreakableRockCracked ($10100100): $15 & $0004 = $04 -> tile-page offset 4, stamps $7B04..$7B07
//
// Within the (cols x rows) rectangle, each cell picks one of 4 corner
// tiles from `DATA_breakable_rock_tiles` ($7B00..$7B03) by 2x2 phase:
//
//   (col%2, row%2) = (0, 0) -> $7B00 + $15
//   (col%2, row%2) = (1, 0) -> $7B01 + $15
//   (col%2, row%2) = (0, 1) -> $7B02 + $15
//   (col%2, row%2) = (1, 1) -> $7B03 + $15
//
// Init handler does two structural fix-ups:
//   - Reduce $15 to just bit 2 (per-variant offset, 0 or 4) so the
//     stamp's `ADC $15` adds the correct page offset.
//   - Round the column extent ($2A) and row extent ($2E) UP to the next
//     even value via `INC ; AND #$FFFE`. Both extents must be even so
//     the 2x2 motif stamps cleanly without leaving a half-block at the
//     bottom-right edge. (Spec traces show 4/4 and 16/16 which are
//     already even — the round-up is a no-op for those, but odd inputs
//     would otherwise mis-align the phase pattern.)
//
// Note: the cart's "round up" is `INC ; AND #$FFFE`, which is "next
// even >= n if n odd, else n" — i.e. extent stays the same when already
// even, bumps by 1 when odd. Different shape from the $70/$71 spike/
// structural blocks, which only INC when odd (so even values are
// untouched in both forms — the two idioms are functionally equivalent
// for extents in [1, 0xFFFE]).
//
// Asm sources:
//   CODE_init_breakable_rock   Bank12.asm:4701  ($12:9E8B)
//   CODE_stamp_breakable_rock_offset   Bank13.asm:10999 ($13:DAEC)
//   DATA_breakable_rock_tiles          Bank13.asm:10995 ($13:DAE4)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_breakable_rock_tiles ($13:DAE4, Bank13.asm:10995).
//
//   dw $7B00, $7B01, $7B02, $7B03
//
// Indexed by `((rowParity << 1) | colParity) << 1` (i.e. word index
// 0/1/2/3). The cart's stamp adds `$15` to the loaded value, where $15
// has been pre-masked to bit 2 only (0 for $A3, 4 for $A4).
// ─────────────────────────────────────────────────────────────────────

const DATA_breakable_rock_tiles: ReadonlyArray<number> = [0x7B00, 0x7B01, 0x7B02, 0x7B03];

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_breakable_rock_offset ($13:DAEC, Bank13.asm:10999).
//
//   REP #$30
//   LDX $1D
//   LDA $28 ; AND #$0001 ; ASL ; STA $00      ; $00 = colParity << 1
//   LDA $2C ; AND #$0001 ; ASL ; ASL          ; A   = rowParity << 2
//   ORA $00                                    ; A   = (row<<2) | (col<<1)
//   TAY
//   LDA DATA_breakable_rock_tiles,y                  ; word-fetch corner tile
//   CLC ; ADC $15                              ; add per-variant offset (0 or 4)
//   STA.l LevelDataBuffer,x
//   SEP #$30 ; RTL
//
// Effective index into the dw table = `(rowParity << 1) | colParity`
// after the trailing shifts cancel the ASL doubling. Spec-confirmed:
// $A3 with $15=0 stamps $7B00/$7B01/$7B02/$7B03; $A4 with $15=4 stamps
// $7B04/$7B05/$7B06/$7B07.
// ─────────────────────────────────────────────────────────────────────

const stampBreakableRock: PerCellHandler = (state) => {
  const colParity = state.zp28 & 0x01;
  const rowParity = state.zp2C & 0x01;
  const idx = ((rowParity << 1) | colParity) & 0x03;
  const baseTile = DATA_breakable_rock_tiles[idx]!;
  const variantOffset = state.zp15 & 0x0004;
  stampCell(state, (baseTile + variantOffset) & 0xffff);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_breakable_rock ($12:9E8B, Bank12.asm:4701).
//
//   REP #$20
//   LDA $15 ; AND #$0004 ; STA $15            ; keep only variant bit
//   LDA $2A ; INC ; AND #$FFFE ; STA $2A      ; round col extent up to even
//   LDA $2E ; INC ; AND #$FFFE ; STA $2E      ; round row extent up to even
//   LDX #(CODE_stamp_breakable_rock_offset-1)>>16
//   LDA #CODE_stamp_breakable_rock_offset-1
//   JMP walker_setup_trampoline
//
// The "INC ; AND #$FFFE" idiom rounds an odd value up by 1 and leaves
// even values unchanged. Equivalent to `(n + 1) & ~1`.
//
// Spec-confirmed DP mutations:
//   $A3: $15 $A3 -> $00, $2A/$2E both stay $0010 (already even)
//   $A4: $15 $A4 -> $04, $2A/$2E both stay $0004 (already even)
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0xA3 (BreakableRock), 0xA4 (BreakableRockCracked)
// share this handler.
function initBreakableRock(state: DecodeState): void {
  state.zp15 = state.zp15 & 0x0004;
  state.zp2A = (state.zp2A + 1) & 0xFFFE;
  state.zp2E = (state.zp2E + 1) & 0xFFFE;
  walkerSetupTrampoline(state, stampBreakableRock);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Both $A3 and $A4 share the same init+stamp pair; the
// orientation byte's bit 2 (which equals the low nibble of the object
// ID for these two values) is what produces the visual difference.
// ─────────────────────────────────────────────────────────────────────

export function installBreakableRockHandlers(): void {
  registerStdObjectHandler(0xA3, initBreakableRock);
  registerStdObjectHandler(0xA4, initBreakableRock);
}
