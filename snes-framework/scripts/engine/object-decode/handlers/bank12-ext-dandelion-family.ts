// Bank12 ext-object handler family: dandelion_family ($BA-$BF).
//
// Six extIDs ($BA..$BF) share ONE init handler
// (CODE_extobj_handler_dandelion_family, $12:9067, Bank12.asm:2662)
// and ONE per-cell stamp handler (CODE_12C29C, $12:C29C, Bank12.asm:8614).
//
// Shape: WALKER-DRIVEN single-column vertical strip (col extent stays 1
// from the parser default; row extent per-variant).
//
// Init (CODE_extobj_handler_dandelion_family, $12:9067):
//     REP #$20
//     LDA $15 : SEC : SBC #$00BA : ASL : STA $15 : TAY   ; $15 = 2×variant
//     LDA DATA_12905B,y : STA $2E                        ; row extent
//     JSL CODE_prng : AND #$0003 : BEQ + : EOR #$0003    ; A1 = 0..3
//   + STA $A1                                            ; per-tile add-offset
//     LDX #(CODE_12C29C-1)>>16 : LDA #CODE_12C29C-1
//     JMP CODE_walker_setup_trampoline
//
//   DATA_12905B (row extents, indexed by $15 = 2×variant) = $02,$03,$04,$04,
//   $03,$02 per variant $BA..$BF (confirmed against the six spec.json
//   row-extent diffs AND the ROM byte region at $12:905B).
//
//   $A1 is a PRNG-derived 0..3 offset that the stamper ADDs to every Map16
//   ID (`CLC : ADC $A1`). The cart's PRNG reads HV-counter noise we can't
//   replicate statically (see prng.ts); in every captured trace $A1 was 0,
//   so the deterministic-LFSR offset is cosmetic and matches the traces.
//   We still call prngNext to keep the call order faithful.
//
// Per-cell stamp (CODE_12C29C, $12:C29C):
//     REP #$30
//     LDA $2C : BNE row_ge1
//     LDA #$8D36 : LDY $15 : CPY #$0006 : BCC stamp      ; row 0 "cap"
//     LDA #$8D45 : BRA stamp                             ;  ($15<6 → A, else B)
//   row_ge1:
//     LDY $15 : LDA DATA_12C290,y : STA $00              ; body-table ptr
//     LDA $2C : ASL : TAY : LDA ($00),y                  ; body[row] (word idx)
//   stamp:
//     CLC : ADC $A1 : LDX $1D : STA buffer,x
//
//   DATA_12C290 → per-variant body word tables. body[row] indexed by the
//   raw row counter $2C (entry [0] is unused — row 0 takes the cap path).
//   The body tile words below are taken from the six spec.json per-cell
//   traces and cross-checked against the ROM word region $12:C26E..$12:C28F.
//   Two species: $BA/$BB/$BC use cap $8D36 (variants 0-2); $BD/$BE/$BF use
//   cap $8D45 (variants 3-5).

import type { DecodeState, PerCellHandler } from '../state.ts';
import { stampCell } from './_shared.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { prngNext, RNG_SITE } from '../prng.ts';
import { registerExtObjectHandler } from './index.ts';

const FIRST_ID = 0xBA;

// DATA_12905B ($12:905B): row extent per variant ($BA..$BF).
const ROW_EXTENT = [0x02, 0x03, 0x04, 0x04, 0x03, 0x02] as const;

// Per-variant body tile tables, indexed by the raw row counter $2C (so
// index 0 is unused — row 0 uses the cap path below). From ext-B[A-F]
// spec.json per-cell traces.
//   $BA(v0,ext2): r1=$8D42
//   $BB(v1,ext3): r1=$8D39 r2=$8D3F
//   $BC(v2,ext4): r1=$8D39 r2=$8D3C r3=$8D3F
//   $BD(v3,ext4): r1=$8D48 r2=$8D4B r3=$8D4E
//   $BE(v4,ext3): r1=$8D48 r2=$8D4E
//   $BF(v5,ext2): r1=$8D51
const BODY_TILES: ReadonlyArray<ReadonlyArray<number>> = [
  [0x0000, 0x8D42],                   // $BA (v0)
  [0x0000, 0x8D39, 0x8D3F],           // $BB (v1)
  [0x0000, 0x8D39, 0x8D3C, 0x8D3F],   // $BC (v2)
  [0x0000, 0x8D48, 0x8D4B, 0x8D4E],   // $BD (v3)
  [0x0000, 0x8D48, 0x8D4E],           // $BE (v4)
  [0x0000, 0x8D51],                   // $BF (v5)
];

// Ports per-cell stamp CODE_12C29C ($12:C29C). `state.zp15` = 2×variant;
// `state.zp2C` = row counter; `state.zpA1` = PRNG add-offset.
const slimeMushroomPerCell: PerCellHandler = (state) => {
  const row = state.zp2C & 0xff;
  let tile: number;
  if (row === 0) {
    // row-0 cap: $8D36 if $15 < 6 (variants 0-2), else $8D45 (variants 3-5).
    tile = (state.zp15 & 0xff) < 0x06 ? 0x8D36 : 0x8D45;
  } else {
    const variant = (state.zp15 >> 1) & 0xff;
    const body = BODY_TILES[variant] ?? BODY_TILES[0]!;
    tile = body[row] ?? body[body.length - 1]!;
  }
  // CLC : ADC $A1 — PRNG-derived per-tile offset (0 in all captured traces).
  stampCell(state, (tile + (state.zpA1 & 0xff)) & 0xffff);
};

// Ports CODE_extobj_handler_dandelion_family init ($12:9067).
// Merge: object IDs 0xBA, 0xBB, 0xBC, 0xBD, 0xBE, 0xBF share this handler.
function initDandelionFamily(state: DecodeState): void {
  const variant = (state.zp15 - FIRST_ID) & 0xff;  // extID - $BA → 0..5
  state.zp15 = (variant << 1) & 0xff;              // $15 = 2×variant
  state.zp2E = ROW_EXTENT[variant] ?? ROW_EXTENT[0]!;
  // JSL CODE_prng : AND #$0003 : BEQ + : EOR #$0003 → $A1 = 0..3.
  const p = prngNext(state, RNG_SITE.initDandelionFamily) & 0x03;
  state.zpA1 = p === 0 ? 0 : p ^ 0x03;
  // col extent ($2A) stays 1 (parser default; init never writes it).
  walkerSetupTrampoline(state, slimeMushroomPerCell);
}

export function installExtDandelionFamilyHandlers(): void {
  registerExtObjectHandler(0xBA, initDandelionFamily);
  registerExtObjectHandler(0xBB, initDandelionFamily);
  registerExtObjectHandler(0xBC, initDandelionFamily);
  registerExtObjectHandler(0xBD, initDandelionFamily);
  registerExtObjectHandler(0xBE, initDandelionFamily);
  registerExtObjectHandler(0xBF, initDandelionFamily);
}
