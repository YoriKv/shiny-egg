// Mini-battle score screens (gm$2E bandit minigames / gm$30 2-player mini
// battles) — the per-sub-mode BG3 in-battle score/HUD overlays (the YOSHI /
// TIME / BANDIT plates) as static scenes. NOT intro/title screens (corrected
// 2026-07-19): CODE_1181D9 calls CODE_118216 on the frame the battle's opening
// message box CLOSES, so these draw during gameplay. $A2 (sub-modes 0/1/2/11)
// and $A4 (pop balloons) are 100% blank fill-char maps — those battles have no
// tilemap HUD. Composition asm-traced 2026-07-18, tile size + semantics
// corrected 2026-07-19 (research/graphics-survey/11-vram-loading.md §5 + the H3
// scene trace in research/graphics-editing/pipeline-evaluation-2026-07.md):
//
//   gfx     — `CODE_load_per_world_variant_gfx` ($00:B49E): DP $10/$11 = the two
//             variant char files (DATA_00B46E/DATA_00B47A[v]), DP $12/$13 = the
//             variant BG1/BG2 tilemaps (DATA_00B486/DATA_00B492[v]); spriteset
//             slots $FF ×5 + slot 4 = $4E; program at scene_gfx_layout $122.
//   BG3     — `CODE_118216` (Bank11): LZ2 tilemap file `DATA_11820A[v]`
//             ($A2-$A7 — the table is mislabeled "music ids" in the asm; the
//             code feeds the values to CODE_00B753 as FILE ids) decompressed and
//             DMA'd to VRAM word $3400 = byte $6800 (the BG3 tilemap).
//   palette — scene palette PROGRAM $C2 (traced 2026-07-19: the gm$2E prepare's
//             `CODE_load_yoshi_color_palette` is not Yoshi-only — it runs
//             `CODE_load_palettes` at X=$C2 with DP $10 = the Yoshi-color
//             pointer): row 0 ← blob $2148, rows 1-3 ← blob $27C, rows 4-7 ←
//             blob $4354 (the result screens' rows 6/7), OBJ rows 8-13 ← blob
//             $1C8, Yoshi row ← DATA_yoshi_palette_ptrs[color]. All inside the
//             master blob → provenance-backed. THEN, when the opening message
//             box closes, CODE_118216 overwrites colors 1-15 from `DATA_5FE3CC`
//             (the score-screen rows); color 0 = backdrop, cleared to black by
//             the gm$2E init (the header background words are zeroed). The old
//             "bandit palette deferral" (per-variant init routines assemble the
//             palette; no scene palette program) was a wrong premise.
//   regs    — scene index $2A (the SAME row the bonus games use): Mode 1; BG3 tm
//             $6800 (32×32, 2bpp char base $4000). The row sets BG3 16×16 tiles,
//             but CODE_118216 TOGGLES BGMODE bit 6 (`EOR #$40` on the mirror)
//             when it draws the score screen — so these screens display in
//             8×8-tile mode (the doubled-letter artifact when rendered 16×16
//             pinned this).
//
// Each of the six distinct screens ($A2-$A7) is SHARED by the sub-modes whose
// `DATA_11820A` entry names it (e.g. $A2 serves sub-modes 0/1/2/11) — an edit
// through one .M1 shows in every battle that uses that screen.
//
// RESULT SCREENS ($9D/$9E, traced 2026-07-19): at battle end the per-game end
// handler stores a result code in `$10E6` and sets `$10E2` = 1; the Bank11
// state machine (`CODE_11922A` → `CODE_1192B6`) then GSU-decompresses LZ2 file
// $9D (result 0) or $9E (result ≠ 0) to $70:4E00, DMAs $800 bytes to VRAM word
// $3C00 = byte $7800 (the lower half of the BG2 region), scrolls it in, and
// REPOINTS BG2SC to $3C — base byte $7800, 32×32 — so the file becomes the
// whole visible BG2 (8×8 tiles, 4bpp, char base $E000; the map's chars wrap
// past $FFFF into the $25/$26 files at $0000-$2000). $9D is the Yoshi-faces
// wallpaper (Yoshi wins), $9E the Bandit-faces wallpaper (palette rows 6 vs 7 —
// the program-$C2 rows above); the result text itself is OAM, not BG. Shared by
// all 12 sub-modes.

import { loadSceneGfx, loadLz2FileToVram, type GfxFileEntry } from './load-graphics.ts';
import { loadScenePalettes } from './load-palettes.ts';
import { loadSceneRegsByIndex, type SceneRegs } from './scene-regs.ts';
import { snesToPC, type SymbolMap } from './symbol-map.ts';
import { u16le } from './rom-read.ts';

const u8 = (rom: Uint8Array, pc: number): number => rom[pc]!;

export const MINI_BATTLE_SUB_MODES = 12;

const MB_GFX_OFFSET = 0x122;
const MB_REGS_INDEX = 0x2a;
/** BG3 tilemap VRAM byte offset (DMA dest word $3400). */
const MB_BG3_TM_BYTE = 0x6800;
/** The scene palette program's byte offset into `scene_palette_layout`
 *  (`CODE_load_yoshi_color_palette`'s `LDX #$00C2`). */
const MB_PALETTE_PROGRAM = 0xc2;
/** Result-screen tilemap VRAM byte offset (CODE_11922A DMA dest word $3C00;
 *  BG2SC is repointed here — $3C — when the screen finishes scrolling in). */
export const MB_RESULT_TM_BYTE = 0x7800;
/** The two battle-end result-screen LZ2 tilemap files (`CODE_119169`:
 *  `$10E6` result code 0 → $9D, otherwise → $9E). */
export const MINI_BATTLE_RESULT_FILES = [0x9d, 0x9e] as const;

export interface MiniBattleSceneContext {
  /** Sub-mode 0-11 (`$7E:03A7 >> 1` order — the DATA table order). */
  subMode: number;
  vram: Uint8Array;
  cgram: Uint8Array;
  /** CGRAM index → master-palette-blob byte offset (−1 = not blob-backed). */
  provenance: Int32Array;
  regs: SceneRegs;
  manifest: GfxFileEntry[];
  /** The sub-mode's BG1 playfield LZ2 tilemap file (byte $D000, 32×32). */
  bg1TmFileId: number;
  /** The sub-mode's BG2 playfield LZ2 tilemap file (byte $7000 — the UPPER
   *  32×32 half; the lower half $7800 is the result screens' home). */
  bg2TmFileId: number;
  /** The sub-mode's BG3 score-screen LZ2 tilemap file (byte $6800, 32×32). */
  bg3TmFileId: number;
}

/** One distinct mini-battle gameplay scene (chars + BG1/BG2 playfield combo)
 *  with the first sub-mode using it. 7 distinct combos across the 12 sub-modes;
 *  BG1 file $96 appears in TWO combos (different char sets + BG2), so scenes
 *  are keyed by the full (chrA, chrB, bg1, bg2) tuple. */
export interface MiniBattlePlayfield {
  bg1TmFileId: number;
  bg2TmFileId: number;
  /** The first sub-mode using this scene (re-derives the full context). */
  subMode: number;
}

export function miniBattleDistinctPlayfields(rom: Uint8Array, symbols: SymbolMap): MiniBattlePlayfield[] {
  const seen = new Set<string>();
  const out: MiniBattlePlayfield[] = [];
  for (let v = 0; v < MINI_BATTLE_SUB_MODES; v++) {
    const tbl = (label: string): number => u8(rom, symbols.pc(label) + v);
    const bg1TmFileId = tbl('DATA_00B486');
    const bg2TmFileId = tbl('DATA_00B492');
    const key = `${tbl('DATA_00B46E')},${tbl('DATA_00B47A')},${bg1TmFileId},${bg2TmFileId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ bg1TmFileId, bg2TmFileId, subMode: v });
  }
  return out;
}

/** The distinct score-screen tilemap file for each sub-mode (`DATA_11820A`). */
export function miniBattleBg3TmFileId(rom: Uint8Array, symbols: SymbolMap, subMode: number): number {
  return u8(rom, symbols.pc('DATA_11820A') + subMode);
}

/** Build one mini-battle sub-mode's score-screen scene: VRAM + CGRAM + regs +
 *  the gfx manifest, exactly as gm$2E/gm$30 assemble it (module header). */
export function buildMiniBattleSceneContext(
  rom: Uint8Array,
  symbols: SymbolMap,
  subMode: number,
  opts: { gfxOverride?: ReadonlyMap<string, Uint8Array> } = {}
): MiniBattleSceneContext {
  if (subMode < 0 || subMode >= MINI_BATTLE_SUB_MODES) {
    throw new RangeError(`mini-battle sub-mode ${subMode} out of range 0-${MINI_BATTLE_SUB_MODES - 1}`);
  }
  const tbl = (label: string): number => u8(rom, symbols.pc(label) + subMode);
  const chrA = tbl('DATA_00B46E');
  const chrB = tbl('DATA_00B47A');
  const bg1Tm = tbl('DATA_00B486');
  const bg2Tm = tbl('DATA_00B492');
  const bg3TmFileId = miniBattleBg3TmFileId(rom, symbols, subMode);

  const vram = new Uint8Array(0x10000);
  const manifest: GfxFileEntry[] = [];
  // The variant scene load (chars + BG1/BG2 tilemaps + the $4E spriteset slot).
  loadSceneGfx(
    rom, symbols,
    { startOffset: MB_GFX_OFFSET, dpSlots: [chrA, chrB, bg1Tm, bg2Tm, 0, 0, 0, 0xff, 0xff, 0xff, 0xff, 0x4e, 0xff] },
    vram, manifest, opts.gfxOverride
  );

  // The BG3 score-screen tilemap (CODE_118216's separate load — not part of
  // the $122 program).
  loadLz2FileToVram(rom, symbols, bg3TmFileId, vram, MB_BG3_TM_BYTE, manifest, opts.gfxOverride);

  // Palette: the scene palette program $C2 (module header), Yoshi slot = color
  // 0 (green), THEN the box-close overwrite of colors 1-15 from DATA_5FE3CC.
  // Color 0 stays black (the gm$2E init zeroes the header background words).
  const cgram = new Uint8Array(512);
  const provenance = new Int32Array(256).fill(-1);
  const yoshiPtr = u16le(rom, symbols.pc('DATA_yoshi_palette_ptrs'));
  loadScenePalettes(rom, symbols, { startOffset: MB_PALETTE_PROGRAM, slots: [yoshiPtr] }, cgram, provenance);
  const palPC = symbols.tryPc('DATA_5FE3CC') ?? snesToPC(0x5fe3cc);
  const blobPC = symbols.pc('DATA_master_palette_rom_blob');
  for (let i = 0; i < 15; i++) {
    cgram[(1 + i) * 2] = u8(rom, palPC + i * 2);
    cgram[(1 + i) * 2 + 1] = u8(rom, palPC + i * 2 + 1);
    provenance[1 + i] = palPC + i * 2 - blobPC;
  }
  return {
    subMode, vram, cgram, provenance,
    regs: loadSceneRegsByIndex(rom, symbols, MB_REGS_INDEX), manifest,
    bg1TmFileId: bg1Tm, bg2TmFileId: bg2Tm, bg3TmFileId
  };
}

/** A mini-battle result-screen scene: the shared battle scene (sub-mode 0 —
 *  the result screens are variant-independent) with the chosen result tilemap
 *  ($9D/$9E) loaded at byte $7800, exactly as `CODE_11922A` stages it. */
export interface MiniBattleResultContext extends MiniBattleSceneContext {
  /** 0 ($9D) or 1 ($9E) — the `$10E6` result-code branch. */
  result: number;
  /** The result screen's LZ2 tilemap file (byte $7800, 32×32). */
  resultTmFileId: number;
}

export function buildMiniBattleResultContext(
  rom: Uint8Array,
  symbols: SymbolMap,
  result: number,
  opts: { gfxOverride?: ReadonlyMap<string, Uint8Array> } = {}
): MiniBattleResultContext {
  if (result !== 0 && result !== 1) throw new RangeError(`mini-battle result ${result} out of range 0-1`);
  const ctx = buildMiniBattleSceneContext(rom, symbols, 0, opts);
  const resultTmFileId = MINI_BATTLE_RESULT_FILES[result]!;
  loadLz2FileToVram(rom, symbols, resultTmFileId, ctx.vram, MB_RESULT_TM_BYTE, ctx.manifest, opts.gfxOverride);
  return { ...ctx, result, resultTmFileId };
}
