// Bonus-game screens (gm$2A) — the six end-of-level bonus challenges as static
// scenes. Composition asm-traced 2026-07-02 (research/graphics-editing/
// minigame-screens.md; loader `CODE_gm2a_load_bonus_game` @ $10:9AE8):
//
//   gfx     — `scene_gfx_layout` @ $F3 with DP slots from per-game word tables:
//             DP $10 = DATA_109AB8[game] → the BG1 TILEMAP (VRAM byte $D000),
//             DP $12 = DATA_109AC4[game] → the BG2 tilemap (byte $7000),
//             DP $14 = DATA_109AD0[game] → the shared BG3 tilemap $95 (byte $6800),
//             + 9 literal files (the shared char sheets / OBJ / HUD).
//   palette — `scene_palette_layout` @ $94 with pointer slots
//             $10/$12 = DATA_109A88/109A94[game], $14/$16 = DATA_109AA0/109AAC
//             (= $2860 for every game), $18 = DATA_yoshi_palette_ptrs[yoshiColor].
//   regs    — scene index $2A: Mode 1; BG1 tm $D000 + BG2 tm $7000 (32×64 each,
//             8×8 tiles, SHARED char base $E000 — M1TE-friendly); BG3 tm $6800
//             (32×32, 16×16 tiles, 2bpp char base $4000).
//
// The per-game tilemaps are ordinary LZ2 blobs (`Tilemaps/`), so placement edits
// round-trip via saveGfxEdit exactly like the world-map terrain. The BG3 tilemap
// ($95) is SHARED by all six games — an edit through any game's screen shows in
// the other five (the importer merges word edits across files before saving).

import { loadSceneGfx, type GfxFileEntry } from './load-graphics.ts';
import { loadScenePalettes } from './load-palettes.ts';
import { loadSceneRegsByIndex, type SceneRegs } from './scene-regs.ts';
import { u16le } from './rom-read.ts';
import { type SymbolMap } from './symbol-map.ts';

export const BONUS_GAME_COUNT = 6;

/** Scene-program / palette-program entry points (see the module header). */
const BONUS_GFX_OFFSET = 0xf3;
const BONUS_PAL_OFFSET = 0x94;
const BONUS_REGS_INDEX = 0x2a;

export interface BonusSceneContext {
  /** Bonus-game index 0-5 (`!RAM_YI_Level_CurrentBonusGame` order — the DATA
   *  table order; in-game menu names aren't asserted here). */
  game: number;
  vram: Uint8Array;
  cgram: Uint8Array;
  /** CGRAM index → master-palette-blob byte offset (−1 = not blob-backed). */
  provenance: Int32Array;
  regs: SceneRegs;
  manifest: GfxFileEntry[];
  /** Per-game BG1 tilemap LZ2 file (VRAM byte $D000, 32×64 words). */
  bg1TmFileId: number;
  /** Per-game BG2 tilemap LZ2 file (byte $7000, 32×64 words). */
  bg2TmFileId: number;
  /** The SHARED BG3 tilemap LZ2 file ($95 for every game; byte $6800, 32×32). */
  bg3TmFileId: number;
}

/** Build one bonus game's scene: VRAM + CGRAM + regs + the gfx manifest, exactly
 *  as `CODE_gm2a_load_bonus_game` assembles it. `yoshiColor` only tints the OBJ
 *  rows (display); defaults to 0 (green). */
export function buildBonusSceneContext(
  rom: Uint8Array,
  symbols: SymbolMap,
  game: number,
  opts: { yoshiColor?: number; gfxOverride?: ReadonlyMap<string, Uint8Array> } = {}
): BonusSceneContext {
  if (game < 0 || game >= BONUS_GAME_COUNT) throw new RangeError(`bonus game ${game} out of range 0-${BONUS_GAME_COUNT - 1}`);
  const word = (label: string): number => u16le(rom, symbols.pc(label) + game * 2);
  const bg1TmFileId = word('DATA_109AB8') & 0xff;
  const bg2TmFileId = word('DATA_109AC4') & 0xff;
  const bg3TmFileId = word('DATA_109AD0') & 0xff;

  const vram = new Uint8Array(0x10000);
  const manifest: GfxFileEntry[] = [];
  loadSceneGfx(
    rom, symbols,
    { startOffset: BONUS_GFX_OFFSET, dpSlots: [bg1TmFileId, 0, bg2TmFileId, 0, bg3TmFileId] },
    vram, manifest, opts.gfxOverride
  );

  const yoshiColor = Math.max(0, Math.min(7, opts.yoshiColor ?? 0));
  const yoshiPtr = u16le(rom, symbols.pc('DATA_yoshi_palette_ptrs') + yoshiColor * 2);
  const cgram = new Uint8Array(512);
  const provenance = new Int32Array(256);
  loadScenePalettes(
    rom, symbols,
    { startOffset: BONUS_PAL_OFFSET, slots: [word('DATA_109A88'), word('DATA_109A94'), word('DATA_109AA0'), word('DATA_109AAC'), yoshiPtr] },
    cgram, provenance
  );

  return { game, vram, cgram, provenance, regs: loadSceneRegsByIndex(rom, symbols, BONUS_REGS_INDEX), manifest, bg1TmFileId, bg2TmFileId, bg3TmFileId };
}
