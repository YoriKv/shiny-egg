// Bank13 Raven's-platform stamp handler + Bank12 init wrapper.
//
// Standard object $9F — Raven's platform, a 2-row raised step. Renders a
// 2-row strip in repeating 2-column groups: each pair of columns stamps a
// top/bottom cap pair from a 4-entry direct-Map16 lookup, and every
// other pair of columns is skipped (no stamp) so the result reads as
// regular gaps between step segments. Both the row extent and the
// column-extent parity are forced by the init so the stream's
// length-1 byte only controls the total width.
//
//
// Asm sources:
//   CODE_init_raven_platform    Bank12.asm:4673 ($12:9E5A)
//   CODE_stamp_raven_platform        Bank13.asm:10954 ($13:DAA4)
//   DATA_raven_platform_tiles        Bank13.asm:10951 ($13:DA9C)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_raven_platform_tiles (Bank13.asm:10951). 4 direct Map16
// IDs (no template-slot indirection). Index layout below is the entry
// index (yIdx = byte-Y / 2), not the asm's raw byte-Y:
//
//   yIdx 0 (row 0, col-pair left)  $3308  top-left cap
//   yIdx 1 (row 0, col-pair right) $3508  top-right cap
//   yIdx 2 (row 1, col-pair left)  $0004  bottom-left cap
//   yIdx 3 (row 1, col-pair right) $0005  bottom-right cap
// ─────────────────────────────────────────────────────────────────────

const DATA_raven_platform_tiles: ReadonlyArray<number> = [
  0x3308, // row 0, col-pair left   (top-left cap)
  0x3508, // row 0, col-pair right  (top-right cap)
  0x0004, // row 1, col-pair left   (bottom-left cap)
  0x0005, // row 1, col-pair right  (bottom-right cap)
];

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_raven_platform ($13:DAA4, Bank13.asm:10954).
//
//   REP #$30
//   LDA $28 ; AND #$0002 ; BNE skip       ; col & 2 → gap, skip stamp
//   LDA $28 ; AND #$0001 ; ASL ; STA $00  ; partial Y = (col & 1) << 1
//   LDA $2C ; ASL ; ASL                   ; row << 2
//   ORA $00 ; TAY                         ; Y = (row << 2) | ((col & 1) << 1)
//   LDX $1D ; LDA DATA_raven_platform_tiles,y           ; word table — entry = Y/2
//   STA.l levelDataBuffer,x
// skip: SEP #$30 ; RTL
//
// In other words: columns are walked in groups of 4 — `col & 2 == 0`
// stamps a 2-wide step (left + right caps), `col & 2 == 2` leaves the
// 2-wide gap untouched. Each stamped column then picks its row-0 cap
// (top) or row-1 cap (bottom) via $2C.
// ─────────────────────────────────────────────────────────────────────

const stampRavenPlatform: PerCellHandler = (state) => {
  const col = state.zp28 & 0xff;
  // col bit 1 set → interior gap, skip the stamp.
  if ((col & 0x02) !== 0) return;
  const row = state.zp2C & 0xff;
  // Entry index = (row << 1) | (col & 1). 0..3.
  const yIdx = ((row & 1) << 1) | (col & 1);
  stampCell(state, DATA_raven_platform_tiles[yIdx]!);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_raven_platform ($12:9E5A, Bank12.asm:4673).
//
//   REP #$20
//   LDA #$0002 ; STA $2E              ; force row extent = 2 rows
//   LDA $2A ; INC ; AND #$FFFE ; STA $2A
//                                     ; round col extent UP to even
//   LDX #(stamp-1)>>16 ; LDA #stamp-1
//   JMP CODE_walker_setup_trampoline
//
// Forces a 2-row tall object regardless of the stream record (spec
// confirms $2E 0001 → 0002). Then rounds $2A up to the next even value
// so the col-pair stamp pattern stays aligned — odd-width inputs gain
// one extra column on the right rather than chopping the final pair.
// ─────────────────────────────────────────────────────────────────────

function initRavenPlatform(state: DecodeState): void {
  // Cart `LDA #$0002 / STA $2E` — pin row extent at exactly 2 rows.
  state.zp2E = 0x0002;
  // Cart `LDA $2A / INC / AND #$FFFE / STA $2A` — round col extent up
  // to the next even value (already-even stays, odd bumps by 1).
  state.zp2A = ((state.zp2A + 1) & 0xfffe) & 0xffff;
  walkerSetupTrampoline(state, stampRavenPlatform);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installRavenPlatformHandlers(): void {
  registerStdObjectHandler(0x9F, initRavenPlatform);
}
