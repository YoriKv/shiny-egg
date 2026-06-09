// Ports CODE_extobj_handler_wall_decal_family ($12:8A4E, Bank12.asm:1783)
// + its per-cell stamper CODE_12ABE1 ($12:ABE1, Bank12.asm:6344).
//
// Shared init for the wall-decal family, ext $32-$45 (20 IDs). The spec's
// init_handler symbol is "CODE_extobj_handler_wall_decal_family"; in the
// asm tree the same routine is named ..._diagonal_slope_family_2.
//
// Shape 1 (inline single-cell): each ID stamps exactly ONE Map16 cell at
// the parser-resolved anchor ($1D). No walker (spec walker_setup == null).
//
// Init CODE_extobj_handler_wall_decal_family (Bank12.asm:1802):
//   JSR CODE_get_current_map16_tile   ; re-resolve $1D, latch $12
//   REP #$30
//   LDA $15 : SEC : SBC #$0032 : STA $15   ; $15 = extID - $32
//   JSL CODE_12ABE1
//   SEP #$30 : RTL
//
// Stamper CODE_12ABE1 (Bank12.asm:6344):
//   REP #$30
//   LDX $1D                       ; anchor buffer offset
//   LDA $15 : ASL : TAY           ; ($15 already = extID-$32) * 2
//   LDA DATA_12ABB9,Y : TAY       ; Y = WRAM template-slot address
//   LDA $0000,Y                   ; read16 the slot -> Map16 id
//   STA.l !RAM_YI_Level_LevelDataBuffer,X : SEP #$30 : RTL
//
// So $15 (the ext id) selects, via DATA_12ABB9, which per-tileset template
// slot ($7E:1Cxx/$1Dxx) supplies the decal's Map16 id. The slot is seeded
// at level-load from the active tileset, so the concrete id is
// tileset-dependent — exactly what the traces observe (e.g. ext $32 reads
// slot $1C44 -> $1E00 in that tileset). Verified: all 20 IDs' slot picks +
// stamped mapids match their spec.json timelines.
import type { DecodeState } from '../state.ts';
import { stampCell } from './_shared.ts';
import { getCurrentMap16Tile } from '../fetch.ts';
import { registerExtObjectHandler } from './index.ts';

// DATA_12ABB9 (Bank12.asm:6339-6342, $12:ABB9) — 20-word table of WRAM
// template-slot addresses, indexed by (extID - $32). Copied verbatim from
// the asm `dw` declarations. Not contiguous: $36 -> $1C50 skips $1C52;
// ext $3B/$3C both map to $1DD8 and $3D/$3E both map to $1D88.
const DECAL_SLOTS: readonly number[] = [
  0x001c44, 0x001c4a, 0x001c4c, 0x001c4e, 0x001c50, 0x001c54, 0x001c56, 0x001c58, // ext $32-$39
  0x001c5a, 0x001dd8, 0x001dd8, 0x001d88, 0x001d88, 0x001dda, 0x001ddc, 0x001dde, // ext $3A-$41
  0x001de0, 0x001de2, 0x001de4, 0x001de6,                                         // ext $42-$45
];

const EXT_ID_BASE = 0x32;

function initWallDecalFamily(state: DecodeState): void {
  // JSR CODE_get_current_map16_tile: re-resolve $1D + latch $12. The
  // stamper only uses $1D, but we mirror the cart prologue (and the spec's
  // anchor is the parser-resolved $1D, which this re-confirms).
  getCurrentMap16Tile(state);
  // SBC #$0032: normalize $15 to (extID - $32). The cart writes this back
  // into $15; the stamper then indexes DATA_12ABB9 by $15 * 2.
  const index = (state.zp15 & 0xff) - EXT_ID_BASE;
  state.zp15 = index;
  const slotAddr = DECAL_SLOTS[index]!;
  // LDA DATA_12ABB9,Y : TAY : LDA $0000,Y — read16 the Map16 id out of the
  // per-tileset template slot.
  const mapid = state.templateAt(slotAddr);
  // STA.l !RAM_YI_Level_LevelDataBuffer,X — stamp the single cell at the
  // resolved anchor ($1D).
  stampCell(state, mapid);
}

export function installExtWallDecalFamilyHandlers(): void {
  for (let id = 0x32; id <= 0x45; id++) {
    registerExtObjectHandler(id, initWallDecalFamily);
  }
}
