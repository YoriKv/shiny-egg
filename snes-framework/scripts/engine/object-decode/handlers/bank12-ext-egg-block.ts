// Bank12 EXTENDED-object handler: egg block / "!" switch ground decoration
// (ext $C4).
//
// Single-cell inline stamp — same shape as bank12-ext-special-coin.ts. No
// walker: the init re-resolves the anchor cell ($1D) and stamps exactly one
// fixed Map16 id ($5F04) there. spec.json confirms (walker_setup: null,
// one cell, mapid $5F04 → $7F82AA).
//
// Asm sources:
//   CODE_extobj_handler_egg_block   Bank12.asm:2721 ($12:90CD, alias CODE_extobj_handler_egg_block)
//   CODE_12C38E (inline stamper)    Bank12.asm:8720 ($12:C38E)
//
// Asm (verbatim):
//   CODE_extobj_handler_egg_block:        ; ext-obj ID $C4: egg-block (!switch)
//     JSR.w CODE_get_current_map16_tile   ; re-resolves $1D from $1B/$1C, latches $12
//     REP.b #$30
//     JSL.l CODE_12C38E
//     SEP.b #$30
//     RTL
//
//   CODE_12C38E:
//     LDX.b $1D
//     LDA.w #$5F04
//     STA.l !RAM_YI_Level_LevelDataBuffer,x
//     RTL
//
// No savefile/flag gate, no second cell, no column/row indexing — the
// stamper writes one unconditional fixed tile. (The friendly name "egg
// block" is the cart's comment; it is the ground "!" switch decoration.)

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState } from '../state.ts';
import { extConstStamp } from './_shared.ts';

// Cart asm: `LDA.w #$5F04`. The egg-block / "!" switch Map16 tile.
const EGG_BLOCK_TILE = 0x5F04;

// ─────────────────────────────────────────────────────────────────────
// CODE_extobj_handler_egg_block ($12:90CD) + CODE_12C38E ($12:C38E).
//
// Single-cell inline stamp. `getCurrentMap16Tile` re-resolves the anchor
// cell's buffer offset into $1D (may throw ScreenOverflowError — let it
// propagate; the parser catches it), then we stamp $5F04 there.
// ─────────────────────────────────────────────────────────────────────

function extEggBlock(state: DecodeState): void {
  // JSR CODE_get_current_map16_tile — re-resolves $1D (and latches $12).
  extConstStamp(state, EGG_BLOCK_TILE);
}

// ─────────────────────────────────────────────────────────────────────
// Registration. Ext id $C4 only (the $1C4 mirror is automatic —
// getExtObjectHandler masks id & 0xff).
// ─────────────────────────────────────────────────────────────────────

export function installExtEggBlockHandlers(): void {
  registerExtObjectHandler(0xC4, extEggBlock);
}
