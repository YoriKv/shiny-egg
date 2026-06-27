// Storybook (gm$05 attract STORY cutscene) per-(file,tile) palette-row facts.
//
// The storybook is a runtime-streamed, multi-page scripted cutscene (gm$05 load
// -> gm$07 tick, `CODE_gm05_load_cutscene` $0F:BDBE; 51 story beats). Its art
// lives in shared char files — f87/f88 (BG 4bpp), f8A/f4A (OBJ sprites), f27
// (BG3 2bpp) — that EACH scene colours with DIFFERENT palette rows. A static
// decode only reproduces the initial Nintendo-logo frame, so most char tiles
// would default to row 0 (the wrong palette, and for the OBJ sprite sheets the
// wrong HALF of CGRAM entirely). This is the same runtime-streamed-tilemap
// situation as the world map (research/graphics-editing/world-map-screens.md):
// the per-tile rows come from a capture, not a static tilemap.
//
// `storybook-palette-facts.json` is the bake target — accumulated across the
// whole cutscene by the yi-shiny `storybook-render` trace (walks each shown BG
// tilemap cell -> (word>>10)&7 = BG row 0-7, and each OAM record -> (attr>>1)&7
// = OBJ palette -> CGRAM row 8-15, mapping every char/OBJ tile back to its gfx
// file). The storybook is BG **Mode 1** (BG1/BG2 4bpp, BG3 2bpp), so a BG cell's
// field reads CGRAM at base 0 (no per-BG offset) and OBJ at row 8+P — unlike the
// Mode-0 title logo (BG2 -> CGRAM 32). The captured rows ARE the per-tile fact;
// only the palette HALF (BG 0-7 vs OBJ 8-15) is fixed per file class.
//
// COLOURS: the export uses the cart's static palette-$50 load (no captured
// colours committed, provenance-clean like the world map). The settled intro
// frames are byte-identical to that load, but the cutscene STREAMS page-specific
// colours into most BG rows (2-7) and OBJ row 0 as illustrations appear — so a
// tile on a re-streamed row (e.g. f87's rows 2-3, the clouds) shows the settled
// placeholder colours, not its per-page colours. That's a known limit of a static
// export of a streamed cutscene; editing is INDEX-based so it round-trips byte-exact
// regardless (paletteAnimated). f89 is omitted: loaded into VRAM but never referenced
// across the entire cutscene (the storybook analogue of the world-map fold-only files).
import facts from './storybook-palette-facts.json' with { type: 'json' };

/** Display class of a storybook char file — fixes which CGRAM half + transparency
 *  the export uses: `bg`/`bg3` = BG rows 0-7, opaque index 0; `obj` = OBJ palette
 *  rows 8-15, transparent index 0 (sprite tiles composite index 0 transparent). */
export type StorybookFileClass = 'bg' | 'obj' | 'bg3';

export interface StorybookFileFacts {
  class: StorybookFileClass;
  /** "covered/total" displayed-tile coverage from the capture (documentation). */
  coverage: string;
  /** Palette row for tiles the cutscene never displayed (fall-back). */
  defaultRow: number;
  /** fileTile (decimal string) -> the captured dominant palette row. */
  tileRows: Record<string, number>;
}

export const STORYBOOK_FILE_FACTS: Record<string, StorybookFileFacts> =
  (facts as { files: Record<string, StorybookFileFacts> }).files;

const factsFor = (fileId: number): StorybookFileFacts | undefined =>
  STORYBOOK_FILE_FACTS[`0x${fileId.toString(16)}`];

/** The storybook display class of a loaded char file, or `null` when the file
 *  isn't a displayed storybook char sheet (tilemap-data f73/f74/f75, or the
 *  never-referenced f89) — those are skipped by the export. */
export function storybookFileClass(fileId: number): StorybookFileClass | null {
  return factsFor(fileId)?.class ?? null;
}

/** The palette row a storybook char tile draws with: its captured dominant row,
 *  else the file's default. `null` when the file isn't a displayed char sheet. */
export function storybookTileRow(fileId: number, tile: number): number | null {
  const f = factsFor(fileId);
  if (!f) return null;
  return f.tileRows[String(tile)] ?? f.defaultRow;
}
