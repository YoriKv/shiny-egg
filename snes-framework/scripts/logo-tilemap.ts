// Title-logo tilemap PLACEMENT editing — pure text helpers over the logo tilemap's
// inline `dw` words in `yi/Banks/Bank0F.asm` (`DATA_title_screen_logo_tilemap`, the
// 448-word 32×14 Mode-0 BG tilemap). Unlike the island (two Mode-7 cells per `dw`),
// each logo `dw` is ONE full BG word `vhopppcc cccccccc`, so a cell edit rewrites one
// whole word. Same `findDataWords`/`dataWordEdits` mechanism as island-tilemap.ts /
// palette-edit.ts; the app layer writes it as the Bank0F overlay (saveLogoTilemap).
//
//   readLogoTilemapWords  — the asm text's DATA_title_screen_logo_tilemap as 448 words
//   applyLogoTilemapEdits — splice cell edits (wordIndex→word) into the BASE text
//   readLogoTilemapEdits  — diff overlay-vs-base → the cell edits an overlay holds

import { findDataWords, dataWordEdits } from './asm/data-words.ts';
import { applyEdits } from './asm/text-literals.ts';

/** The asm file + label the logo tilemap lives in. */
export const LOGO_TILEMAP_BANK_FILE = 'yi/Banks/Bank0F.asm';
export const LOGO_TILEMAP_LABEL = 'DATA_title_screen_logo_tilemap';
/** 32×14 = 448 words. `findDataWords` keeps reading `dw` runs past the table, so cap
 *  to this (the words are contiguous from the base, so 0..447 are exactly the logo). */
const LOGO_TILEMAP_WORDS = 448;

/** One logo placement edit: the BG word `value` (`vhopppcc cccccccc`) at cell `offset`
 *  (0..447, row-major into the 32×14 tilemap). */
export interface LogoTilemapEdit { offset: number; value: number }

/** The logo tilemap as 448 BG words from the asm `dw` table. */
export function readLogoTilemapWords(text: string): Uint16Array {
  const out = new Uint16Array(LOGO_TILEMAP_WORDS);
  for (const w of findDataWords(text, LOGO_TILEMAP_LABEL)) {
    const i = w.byteOffset >> 1; // one cell per dw word
    if (i >= LOGO_TILEMAP_WORDS) break; // past the logo table into the next run
    out[i] = w.value & 0xffff;
  }
  return out;
}

/**
 * Splice cell edits into the BASE text → edited text (format-preserving; only the `dw`
 * words whose value changes are touched). Reborn from base, so the result = base + exactly
 * these edits. An edit's `offset` outside the tilemap is ignored.
 */
export function applyLogoTilemapEdits(baseText: string, edits: readonly LogoTilemapEdit[]): string {
  if (edits.length === 0) return baseText;
  const words = findDataWords(baseText, LOGO_TILEMAP_LABEL);
  const editByWord = new Map(edits.map((e) => [e.offset, e.value & 0xffff]));
  const changes = new Map<number, number>(); // byteOffset → new value
  for (const w of words) {
    const i = w.byteOffset >> 1;
    if (i >= LOGO_TILEMAP_WORDS) break; // never touch words past the logo table
    if (editByWord.has(i)) { const nv = editByWord.get(i)!; if (nv !== w.value) changes.set(w.byteOffset, nv); }
  }
  return applyEdits(baseText, dataWordEdits(words, changes));
}

/**
 * Diff the base logo tilemap against a foreign cart's logo words → the cell edits
 * reproducing the foreign tilemap. Used by the ROM importer: `foreignWord(wordIndex)`
 * reads the foreign cart's BG word at that cell (the tilemap sits at a fixed cart
 * address, `DATA_title_screen_logo_tilemap`). Mirrors palette-edit.ts `diffPaletteBlob`;
 * the result is always a valid {@link applyLogoTilemapEdits} input.
 */
export function diffForeignLogoTilemap(
  baseText: string,
  foreignWord: (wordIndex: number) => number
): LogoTilemapEdit[] {
  const base = readLogoTilemapWords(baseText);
  const out: LogoTilemapEdit[] = [];
  for (let i = 0; i < base.length; i++) {
    const fv = foreignWord(i) & 0xffff;
    if (fv !== base[i]) out.push({ offset: i, value: fv });
  }
  return out;
}

/** The cell edits an overlay `Bank0F.asm` holds vs base (every cell whose word differs). */
export function readLogoTilemapEdits(baseText: string, overlayText: string | null): LogoTilemapEdit[] {
  if (overlayText === null) return [];
  const base = readLogoTilemapWords(baseText);
  const over = readLogoTilemapWords(overlayText);
  const out: LogoTilemapEdit[] = [];
  for (let i = 0; i < LOGO_TILEMAP_WORDS; i++) if (base[i] !== over[i]) out.push({ offset: i, value: over[i]! });
  return out;
}
