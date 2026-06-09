// Bank12 extended-object handler family: stalactite_rock_pair.
//
// Ext objects 0x68 AND 0x69 share ONE init handler,
// CODE_extobj_handler_stalactite_rock_pair ($12:8C9B / CODE_extobj_handler_stalactite_rock_pair,
// Bank12.asm:2161). SHAPE 1 — inline single-cell: it re-resolves the
// anchor, picks one of two Map16 IDs by bit 0 of the extID, and stamps
// that single cell. NO walker.
//
// Asm (verbatim, init — Bank12.asm:2161):
//
//   CODE_extobj_handler_stalactite_rock_pair:
//     JSR.w CODE_get_current_map16_tile   ; re-resolve $1D, latch tile→$12
//     REP #$30
//     JSL.l CODE_12B179                    ; stamp at $1D
//     SEP #$30
//     RTL
//
// Asm (verbatim, stamper CODE_12B179 — Bank12.asm:7119):
//
//   CODE_12B179:
//     REP #$30
//     LDX $1D
//     LDA $15 : AND #$0001 : ASL : TAY    ; Y = (extID & 1) * 2
//     LDA.w DATA_12B175,y
//     STA.l !RAM_YI_Level_LevelDataBuffer,x
//     SEP #$30
//     RTL
//
// Tile table (Bank12.asm:7115, byte-verified):
//   DATA_12B175:  db $5E,$77, $5F,$77, $0C,$30, ...
//   → little-endian words: [0]=$775E, [1]=$775F, [2]=$300C, ...
//   Only Y=0 and Y=2 (extID bit 0) are reachable from this family, so
//   the first two words are the whole story.
//
// Dispatch key: bit 0 of $15 (the extID). 0x68 (even) → $775E,
// 0x69 (odd) → $775F. Confirmed cell-for-cell against both specs:
//   ext-68: Y=0x0000 → DATA_12B175[word 0] = $775E  @ buf 7F838C
//   ext-69: Y=0x0002 → DATA_12B175[word 1] = $775F  @ buf 7F8388
//
// Cell offset: single cell at the re-resolved anchor $1D (no delta, no
// neighbour probe). The parser's re-resolved $1D is where we stamp.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState } from '../state.ts';
import { getCurrentMap16Tile } from '../fetch.ts';
import { stampCell } from './_shared.ts';

// DATA_12B175 ($12:B175), word entries. Indexed by bit 0 of the extID.
const STALACTITE_TILES = [0x775e, 0x775f] as const;

// ─────────────────────────────────────────────────────────────────────
// CODE_extobj_handler_stalactite_rock_pair — single-cell init+stamp
// (Bank12.asm:2161, stamper Bank12.asm:7119). Re-resolves the anchor via
// getCurrentMap16Tile (cart `JSR CODE_get_current_map16_tile`), picks the
// table word by (extID & 1), and stamps it at the resolved $1D (cart
// `JSL CODE_12B179`).
// ─────────────────────────────────────────────────────────────────────
// Merge: object IDs 0x68, 0x69 share this handler.
function initStalactiteRockPair(state: DecodeState): void {
  // Cart: JSR CODE_get_current_map16_tile — re-resolves $1D, latches the
  // pre-existing tile into $12 (latch observed but unused by the stamp).
  getCurrentMap16Tile(state);

  // Cart stamper: LDA $15 : AND #$0001 : ASL : TAY → word index by bit 0.
  const tile = STALACTITE_TILES[state.zp15 & 0x01];

  // Cart: LDX $1D : STA buffer,x.
  stampCell(state, tile);
}

export function installExtStalactiteRockPairHandlers(): void {
  registerExtObjectHandler(0x68, initStalactiteRockPair);
  registerExtObjectHandler(0x69, initStalactiteRockPair);
}
