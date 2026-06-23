// Giant ext-object setpieces — large FIXED terrain blocks for boss / cutscene
// rooms (hundreds of Map16 cells each).
//
//   0x10  extobj_handler_16x32_block          (16x32 block — IMPLEMENTED below)
//   0x18  extobj_handler_demo_setpiece_16x16   (intro demo set — still STUBBED)
//   0x19  extobj_handler_finalboss_setpiece_24x3   (see bank12-ext-finalboss-setpiece.ts)
//   0x1A  extobj_handler_finalboss_setpiece_32x12  (see bank12-ext-finalboss-setpiece.ts)
//
// $10 fills a 16-wide × 32-tall rectangle from a tiny 4×4 repeating offset
// pattern (record $C9 — Bowser's-castle-style sub-room, a single $10 fills the
// whole 512-cell room). $19/$1A (final-boss room) use a different, larger
// stamper and live in their own file. $18 (intro demo) is still a documented
// no-op — it only appears in the non-level intro/demo and renders nothing in the
// editor's level view.
//
// Render note — record $C9 is NOT statically reproducible (and that's fine).
// Its $10 decode is byte-exact (sweep-clean, matches the live cart's Map16
// buffer), but its BG1 char data + palette are GSU-generated at runtime: the
// cart's *static* VRAM/CGRAM hold a pure-magenta $7C1F placeholder that the GSU
// overwrites once the room is live, so the editor's static render shows a flat
// magenta room (verified: editor BG1 == the cart's captured gm0f BG1, both
// magenta). This is the same GSU-placeholder family as the BG2 tileset-$16
// cones documented in load-bg-tilemaps.ts — left as-is rather than special-cased,
// since reproducing it means running the GSU (out of scope).

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler, InitHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Ext object $10 — CODE_extobj_handler_16x32_block ($12:88FC).
//
//   LDA #$0010 ; STA $2A      ; col extent = 16
//   ASL ; STA $2E             ; row extent = 32
//   JMP walker_setup_trampoline  (per-cell = CODE_12A665)
//
// Per-cell stamp CODE_12A665 ($12:A665):
//   X = (($2C & 3) << 2) | ($28 & 3)        ; 4×4 cell within the repeat
//   tile = DATA_12A655[X] + $84C2
// DATA_12A655 ($12:A655) is a 16-byte 4×4 offset pattern. The +$84C2 base lands
// in the castle-block tile family ($84C2..$84C5).
// ─────────────────────────────────────────────────────────────────────

const DATA_12A655: ReadonlyArray<number> = [
  0x00, 0x01, 0x00, 0x01,
  0x02, 0x03, 0x02, 0x03,
  0x01, 0x00, 0x01, 0x00,
  0x03, 0x02, 0x03, 0x02,
];

const stamp16x32Block: PerCellHandler = (state) => {
  const x = (((state.zp2C & 0x0003) << 2) | (state.zp28 & 0x0003)) & 0x000f;
  stampCell(state, (0x84C2 + DATA_12A655[x]!) & 0xffff);
};

const initExt16x32Block: InitHandler = (state) => {
  state.zp2A = 0x0010; // col extent = 16
  state.zp2E = 0x0020; // row extent = 32 (cart: $2A ASL)
  walkerSetupTrampoline(state, stamp16x32Block);
};

// ─────────────────────────────────────────────────────────────────────
// Ext object $18 — extobj_handler_demo_setpiece_16x16.
// Intro/demo-only setpiece; renders nothing in the editor's level view.
// Documented no-op (the object-outline overlay still shows its bounds).
// ─────────────────────────────────────────────────────────────────────

function demoSetpieceStub(_state: DecodeState): void {
  /* deferred — intro/demo-only, intentional no-op */
}

export function installExtGiantStubHandlers(): void {
  registerExtObjectHandler(0x10, initExt16x32Block);
  registerExtObjectHandler(0x18, demoSetpieceStub);
}
