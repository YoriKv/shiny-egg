// Bank13 cloud-block stamp handler + Bank12 init wrapper.
//
// Standard object $15 — cloud-block platform. A 2-row-tall rectangular
// cloud-platform made of literal Map16 IDs (no template-slot indirection).
//
// Sibling shapes init_snow_cloud_block ($3D) and init_cloud_random ($DB)
// use their own stamp routines and are deferred to separate handlers.
//
// Asm sources:
//   CODE_init_cloud_block       Bank12.asm:3055  ($12:93B2)
//   CODE_cloud_block_stamp      Bank13.asm:1518  ($13:8CB6)
//   DATA_138CA8 (KUMOKUMO_DAT)  Bank13.asm:1507  ($13:8CA8)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_138CA8 — 7-entry Map16-ID table (KUMOKUMO_DAT).
//
// Indexed by Y = ($2C * 4 + col_flag) * 2, where col_flag is:
//   0  → leftmost column   ($28 == 0)
//   1  → interior column   ($28 != 0  and  $28 + 1 != $2A)
//   2  → rightmost column  ($28 != 0  and  $28 + 1 == $2A)
//
// Layout in cart:
//   row 0: $00DB (L)  $00DD (mid)  $00DC (R)  $0000 (unused)
//   row 1: $150F (L)  $1511 (mid)  $1510 (R)
//
// We index by the (already word-doubled) flat row*4+col_flag offset and
// dereference the value directly (cart's `LDA DATA_138CA8,y` with y in
// word units).
// ─────────────────────────────────────────────────────────────────────

const DATA_138CA8: ReadonlyArray<number> = [
  0x00DB, 0x00DD, 0x00DC, 0x0000,   // row 0: left, mid, right, unused
  0x150F, 0x1511, 0x1510,            // row 1: left, mid, right
];

// ─────────────────────────────────────────────────────────────────────
// CODE_cloud_block_stamp ($13:8CB6)
//
//   REP #$30
//   LDA $2C ; ASL ; ASL ; STA $00   ; $00 = row * 4
//   LDA $28 ; BEQ store              ; col == 0 → flag 0 (skip INCs)
//   INC $00                          ; col != 0 → flag = 1
//   INC ; CMP $2A ; BNE store        ; col + 1 == width? no → keep 1
//   INC $00                          ; yes → flag = 2 (rightmost)
//   store:
//     LDA $00 ; ASL ; TAY
//     LDA DATA_138CA8,y
//     LDX $1D ; STA buffer,x
// ─────────────────────────────────────────────────────────────────────

const cloudBlockStamp: PerCellHandler = (state) => {
  let idx = (state.zp2C & 0xff) << 2;           // $00 = $2C * 4
  const col = state.zp28 & 0xff;
  if (col !== 0) {
    idx += 1;                                    // first INC: flag = 1 (interior)
    if (((col + 1) & 0xff) === (state.zp2A & 0xff)) {
      idx += 1;                                  // second INC: flag = 2 (rightmost)
    }
  }
  const mapId = DATA_138CA8[idx & 0x07] ?? 0;
  stampCell(state, mapId);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_cloud_block ($12:93B2)
//
//   REP #$20
//   LDA #$0002 ; STA $2E                  ; force row-extent to exactly 2
//   LDX #(handler-1)>>16
//   LDA #handler-1
//   JMP walker_setup_trampoline           ; → CODE_cloud_block_stamp
//
// The literal store of 2 (not an increment) means any stream-supplied
// $2E gets clobbered — cloud blocks are always exactly 2 rows tall.
// Spec DP-diff confirms `row_extent 0001 → 0002`.
// ─────────────────────────────────────────────────────────────────────

function initCloudBlock(state: DecodeState): void {
  state.zp2E = 0x0002;
  walkerSetupTrampoline(state, cloudBlockStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installCloudBlockHandlers(): void {
  registerStdObjectHandler(0x15, initCloudBlock);
}
