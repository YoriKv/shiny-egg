// Bank13 vertical-pipe stamp + Bank12 init wrapper.
//
// Covers standard object $3C (and $F4 — both map to
// `CODE_init_pipe_vertical`; $F4 will be registered when its spec comes
// up). The init masks the orientation byte $15 down to bit 7 only
// (cap-vs-wallet variant), forces a 2-column footprint by writing
// `$2A = $0002`, and tail-calls into `CODE_walker_setup_trampoline`
// with the per-cell handler `CODE_pipe_vertical_dispatch`.
//
// Per-cell dispatcher picks one of four 3-entry Map16 tables based on
// the sign of `$2E` (direction: up vs down) and on `$15` (cap variant:
// normal vs wallet/sb), then uses Y as the row-selector (top / mid /
// bottom) inside the table, finally adding `$28` (column index 0..1)
// to the table entry to yield the right-column tile.
//
//
// Asm references:
//   yi/Banks/Bank12.asm:3502   CODE_init_pipe_vertical            ($12:9667)
//   yi/Banks/Bank13.asm:4312   CODE_pipe_vertical_dispatch        ($13:A033)
//   yi/Banks/Bank13.asm:4288   DATA_13A017..DATA_13A02F (tables)
//
// Dispatcher pseudocode (REP #$30 throughout):
//   x = ($2E negative) ? 2 : 0           ; DOWN-pointing pipe vs UP
//   if $2C == 0:           y = 0          ; row 0 = top cap
//   else:
//     y = 2                                ; mid by default
//     $2C += DATA_13A02F[x]                ; +1 if up, -1 if down
//     if $2C == $2E: y = 4                 ; last row = bottom cap
//   table =
//     x==0, $15==0 → DATA_13A017          ; TTDKN_UPDWN     (normal)
//     x==0, $15!=0 → DATA_13A01D          ; TTDKN_UPDWN_SB  (wallet/cap-B)
//     x==2, $15==0 → DATA_13A023          ; TTDKN_DWNUP
//     x==2, $15!=0 → DATA_13A029          ; TTDKN_DWNUP_SB
//   tile = table[y/2] + $28               ; +0 left col, +1 right col
//   STAMP tile

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { signed8, stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Per-direction × per-variant tile tables (Bank13.asm:4288-4301).
// Three entries each: index 0 = top cap, 1 = mid segment, 2 = bottom
// cap. Stored as the LEFT-column Map16 ID; the dispatcher adds `$28`
// (column 0 or 1) before stamping to yield the per-column variant.
// ─────────────────────────────────────────────────────────────────────

// DATA_13A017 / TTDKN_UPDWN: pipe pointing up, normal cap.
const DATA_pipe_vertical_up_normal   = [0x7D08, 0x9D32, 0x9D34] as const;
// DATA_13A01D / TTDKN_UPDWN_SB: pipe pointing up, wallet ("SB") cap.
const DATA_pipe_vertical_up_wallet   = [0x79F1, 0x79F3, 0x79F5] as const;
// DATA_13A023 / TTDKN_DWNUP: pipe pointing down, normal cap.
const DATA_pipe_vertical_down_normal = [0x7D0A, 0x9D32, 0x9D36] as const;
// DATA_13A029 / TTDKN_DWNUP_SB: pipe pointing down, wallet cap.
const DATA_pipe_vertical_down_wallet = [0x79A8, 0x79F3, 0x79A0] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_pipe_vertical_dispatch (Bank13.asm:4312 / $13:A033).
//
// Note on $2E sign: the cart's `LDA $2E ; BPL` is a 16-bit BPL after REP #$30
// (bit 15), and the walker now reads it the same way (`signed16`) for the row
// direction. This handler uses `signed8($2E)` (the low byte) to pick up- vs
// down-pipe tiles, which agrees with the 16-bit sign for every real pipe extent
// (small positive, or $FFxx negative for down-pipes). The lone value where
// 8-bit and 16-bit signs disagree is $2E=$0080 — a 127-tall vertical pipe — which
// no level uses; if one ever does, switch these reads to `signed16($2E)`.
// ─────────────────────────────────────────────────────────────────────

const pipeVerticalDispatch: PerCellHandler = (state) => {
  const downPipe = signed8(state.zp2E) < 0;
  const wallet = (state.zp15 & 0xffff) !== 0;

  // Row index inside the 3-entry table.
  //   row 0       → top    (y/2 = 0)
  //   last row    → bottom (y/2 = 2)
  //   otherwise   → mid    (y/2 = 1)
  let rowIdx: number;
  const row = state.zp2C & 0xff;
  if (row === 0) {
    rowIdx = 0;
  } else {
    // Cart `ADC DATA_13A02F,x` = +1 for up-pipes, -1 for down-pipes.
    // We compare the adjusted value to $2E to decide "is this the last
    // row?". Use signed8 because $2E can be negative (down-pipes).
    const adjusted = downPipe
      ? signed8((row - 1) & 0xff)
      : signed8((row + 1) & 0xff);
    rowIdx = adjusted === signed8(state.zp2E) ? 2 : 1;
  }

  let table: readonly number[];
  if (downPipe) {
    table = wallet ? DATA_pipe_vertical_down_wallet : DATA_pipe_vertical_down_normal;
  } else {
    table = wallet ? DATA_pipe_vertical_up_wallet   : DATA_pipe_vertical_up_normal;
  }

  // Cart `CLC ; ADC $28` — add column index (0 = left, 1 = right).
  const tile = (table[rowIdx]! + (state.zp28 & 0xff)) & 0xffff;
  stampCell(state, tile);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_pipe_vertical (Bank12.asm:3502 / $12:9667).
//
//   REP #$20
//   LDA $15 ; AND #$0080 ; STA $15          ; keep only the cap-variant bit
//   LDA #$0002 ; STA $2A                    ; force 2-col footprint
//   LDX #(CODE_pipe_vertical_dispatch-$01)>>16
//   LDA #CODE_pipe_vertical_dispatch-$01
//   JMP CODE_walker_setup_trampoline
//
// DP diff (matches spec):
//   $2A: 0001 → 0002 (forces 2 cols)
//   $15: 3C   → 00   (= $3C & $80; cap-variant bit is clear → normal cap)
// For object $F4 (when registered): $15 = $F4 & $80 = $80, selecting the
// SB/wallet cap tables.
// ─────────────────────────────────────────────────────────────────────

// Merge: object IDs 0x3C, 0xF4 share this handler.
function initPipeVertical(state: DecodeState): void {
  state.zp15 = state.zp15 & 0x0080;
  state.zp2A = 0x0002;
  walkerSetupTrampoline(state, pipeVerticalDispatch);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Only $3C for now; $F4 maps to the same init and will be
// registered by the parent once its spec lands.
// ─────────────────────────────────────────────────────────────────────

export function installPipeVerticalHandlers(): void {
  registerStdObjectHandler(0x3C, initPipeVertical);
  // $F4 shares the same init/stamper; $15 bit 7 picks the SB-cap variant.
  registerStdObjectHandler(0xF4, initPipeVertical);
}
