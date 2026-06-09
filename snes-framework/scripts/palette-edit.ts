// Palette-colour editing (§B10) — pure text helpers over the master palette
// blob's inline `dw` words in `yi/Banks/Bank57.asm`. The app layer reads/writes
// the files + overlay; these stay Node-free and round-trippable.
//
//   readPaletteEdits  — diff overlay-vs-base → the colour edits (offset→value)
//   applyPaletteEdits — splice an edit set into the BASE text → edited text
//
// A "palette edit" is one BGR-15 word at a byte-offset from the blob base
// (`DATA_master_palette_rom_blob`); the offset is what `loadLevelPalettes`
// provenance reports per CGRAM entry. Editing a word is global — the blob is
// shared by palette index across levels.

import { findDataWords, dataWordEdits } from './asm/data-words.ts';
import { applyEdits } from './asm/text-literals.ts';
import type { PaletteEdit } from './types.ts';

export type { PaletteEdit };

/** The asm file + base label the palette blob lives in. */
export const PALETTE_BLOB_BANK_FILE = 'yi/Banks/Bank57.asm';
export const PALETTE_BLOB_LABEL = 'DATA_master_palette_rom_blob';

/**
 * The palette-colour edits an overlay `Bank57.asm` holds vs the base — every
 * blob word whose value differs. `overlayText === null` (no overlay) ⇒ `[]`.
 * Matched by byte-offset, so it's robust to the splice being format-preserving.
 */
export function readPaletteEdits(baseText: string, overlayText: string | null): PaletteEdit[] {
  if (overlayText === null) return [];
  const baseByOff = new Map(
    findDataWords(baseText, PALETTE_BLOB_LABEL).map((w) => [w.byteOffset, w.value])
  );
  const out: PaletteEdit[] = [];
  for (const w of findDataWords(overlayText, PALETTE_BLOB_LABEL)) {
    const bv = baseByOff.get(w.byteOffset);
    if (bv !== undefined && bv !== w.value) out.push({ offset: w.byteOffset, value: w.value });
  }
  return out;
}

/**
 * Splice `edits` into the BASE blob text → edited text (format-preserving; only
 * changed words touched). Always reborn from base, so the result = base + the
 * full edit set (idempotent re-saves, clean diffs). Empty `edits` ⇒ base
 * unchanged. Throws if an edit's offset isn't a blob word boundary.
 */
export function applyPaletteEdits(baseText: string, edits: readonly PaletteEdit[]): string {
  if (edits.length === 0) return baseText;
  const words = findDataWords(baseText, PALETTE_BLOB_LABEL);
  const changes = new Map(edits.map((e) => [e.offset, e.value & 0xffff]));
  return applyEdits(baseText, dataWordEdits(words, changes));
}

/**
 * Diff the base blob (its inline `dw` words) against the SAME-layout bytes of a
 * foreign cart, returning the colour edits that reproduce the foreign blob. Used
 * by the ROM importer: `foreignAt(byteOffset)` reads the foreign cart's BGR-15
 * word at that byte offset into the blob (the blob sits at a fixed cart address).
 * Only the blob's actual word boundaries are compared, so the result is always a
 * valid `applyPaletteEdits` input.
 */
export function diffPaletteBlob(
  baseText: string,
  foreignAt: (byteOffset: number) => number
): PaletteEdit[] {
  const out: PaletteEdit[] = [];
  for (const w of findDataWords(baseText, PALETTE_BLOB_LABEL)) {
    const fv = foreignAt(w.byteOffset) & 0xffff;
    if (fv !== w.value) out.push({ offset: w.byteOffset, value: fv });
  }
  return out;
}
