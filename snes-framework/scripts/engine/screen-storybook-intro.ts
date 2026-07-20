// Storybook-intro screen (gm$38/gm$39 — the "Once upon a time…" playable
// prologue) — the BG2 story frame + BG3 backdrop as a static scene.
// Composition asm-traced 2026-07-18 (`CODE_gm38_load_intro_cutscene`,
// Bank10.asm:10639; research/graphics-survey/11-vram-loading.md §5):
//
//   gfx     — DP $10-$16 set directly ($23,$23,$23,$B1,$B2,$1A,$17; spriteset
//             slots $AB,$AC,$1A ×4), then the STANDARD in-level program
//             (scene_gfx_layout offset 0) — no per-world variance.
//   BG2/BG3 — LZ2 tilemaps $A8 (→ VRAM word $3800 = byte $7000, 32×64 story
//             frame) and $A9 (→ word $3400 = byte $6800, 32×32 backdrop),
//             staged through $70:5800 + a port-$2118 DMA (CODE_10DC71),
//             OUTSIDE the gfx program.
//   palette — at load, BG colors 0-127 are forced $7FFF (white) and the gm$39
//             cinematic GSU-lerps them (FXCODE_08B4A9 over $702D6C → $702F6C,
//             step $70336C 0→$20) to the settled BG palette `DATA_5FEC4A`;
//             OBJ colors 128-255 come from `DATA_5FED4A` directly. Both live
//             inside the master palette blob → provenance-backed. The context
//             carries the SETTLED (post-fade) palette.
//   regs    — scene index $04: Mode 1; BG2 tm $7000 (32×64) + BG3 tm $6800
//             (32×32), both 16×16 tiles; BG2 char $E000 4bpp, BG3 char $4000
//             2bpp. BG1 ($D000, forced 32×32 by the BG1AddressAndSize=$68
//             override after init_scene_regs) is the prologue LEVEL's own
//             decoded layout (`CODE_load_level_object_stream` on the record
//             for translevel $0A) — level data, not a screen file, so it is
//             not part of this scene export.
//
// FIDELITY + how to read the .M1 preview (verified 2026-07-19 against the live
// gm$39 VRAM/CGRAM capture in ../yi-shiny trace-harness `prologue-render`; every
// exported region — both $A8 halves, $A9, all char files — is byte-identical to
// the running game, and live CGRAM = lerp(white → this settled palette) mid-
// fade, OBJ rows exact):
//   • $A8's UPPER 32 rows are a uniform fill of char $EE — one of the two blank
//     chars in the $19 sheet (the file's authored "empty half", like the
//     mini-battle $17F fill). It displays NOTHING in-game; what shows in the
//     .M1's top half is BG3 $A9 (the page backdrop) through it.
//   • Black regions in a composite preview are TRANSPARENT pixels (index 0):
//     in-game the excluded BG1 level layer (the white book page) and the
//     backdrop sit behind them, and the frame art's checker-dither is a
//     translucency weave over that page — over the .M1's black backdrop it
//     reads as dark noise. Not junk data.

import { loadSceneGfx, loadLz2FileToVram, type GfxFileEntry } from './load-graphics.ts';
import { loadSceneRegsByIndex, type SceneRegs } from './scene-regs.ts';
import { type SymbolMap } from './symbol-map.ts';

const u8 = (rom: Uint8Array, pc: number): number => rom[pc]!;

const SB_GFX_DP_SLOTS = [0x23, 0x23, 0x23, 0xb1, 0xb2, 0x1a, 0x17, 0xab, 0xac, 0x1a, 0x1a, 0x1a, 0x1a] as const;
const SB_REGS_INDEX = 0x04;
/** BG2 story-frame tilemap file (VRAM byte $7000) — hardcoded in gm$38. */
export const STORYBOOK_INTRO_BG2_TM_FILE = 0xa8;
/** BG3 backdrop tilemap file (VRAM byte $6800) — hardcoded in gm$38. */
export const STORYBOOK_INTRO_BG3_TM_FILE = 0xa9;
const SB_BG2_TM_BYTE = 0x7000;
const SB_BG3_TM_BYTE = 0x6800;

export interface StorybookIntroContext {
  vram: Uint8Array;
  cgram: Uint8Array;
  /** CGRAM index → master-palette-blob byte offset (−1 = not blob-backed). */
  provenance: Int32Array;
  regs: SceneRegs;
  manifest: GfxFileEntry[];
  bg2TmFileId: number;
  bg3TmFileId: number;
}

/** Build the storybook-intro scene: VRAM + settled CGRAM + regs + the gfx
 *  manifest, exactly as gm$38 assembles it (module header). */
export function buildStorybookIntroContext(
  rom: Uint8Array,
  symbols: SymbolMap,
  opts: { gfxOverride?: ReadonlyMap<string, Uint8Array> } = {}
): StorybookIntroContext {
  const vram = new Uint8Array(0x10000);
  const manifest: GfxFileEntry[] = [];
  loadSceneGfx(rom, symbols, { startOffset: 0, dpSlots: SB_GFX_DP_SLOTS }, vram, manifest, opts.gfxOverride);
  loadLz2FileToVram(rom, symbols, STORYBOOK_INTRO_BG2_TM_FILE, vram, SB_BG2_TM_BYTE, manifest, opts.gfxOverride);
  loadLz2FileToVram(rom, symbols, STORYBOOK_INTRO_BG3_TM_FILE, vram, SB_BG3_TM_BYTE, manifest, opts.gfxOverride);

  // Settled palette: BG rows from DATA_5FEC4A (the fade target), OBJ rows from
  // DATA_5FED4A — 128 colors each, both blob-backed.
  const cgram = new Uint8Array(512);
  const provenance = new Int32Array(256).fill(-1);
  const blobPC = symbols.pc('DATA_master_palette_rom_blob');
  const bgPC = symbols.pc('DATA_5FEC4A');
  const objPC = symbols.pc('DATA_5FED4A');
  for (let i = 0; i < 128; i++) {
    cgram[i * 2] = u8(rom, bgPC + i * 2);
    cgram[i * 2 + 1] = u8(rom, bgPC + i * 2 + 1);
    provenance[i] = bgPC + i * 2 - blobPC;
    cgram[256 + i * 2] = u8(rom, objPC + i * 2);
    cgram[256 + i * 2 + 1] = u8(rom, objPC + i * 2 + 1);
    provenance[128 + i] = objPC + i * 2 - blobPC;
  }

  const regs = loadSceneRegsByIndex(rom, symbols, SB_REGS_INDEX);
  // gm$38 overrides BG1AddressAndSize to $68 after init_scene_regs (same
  // $D000 base, SC size → 32×32). BG1 itself is level data (module header).
  regs.bg1ScSize = 0;

  return {
    vram, cgram, provenance, regs, manifest,
    bg2TmFileId: STORYBOOK_INTRO_BG2_TM_FILE,
    bg3TmFileId: STORYBOOK_INTRO_BG3_TM_FILE
  };
}
