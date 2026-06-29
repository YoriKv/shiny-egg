// Backdrop-gradient editing — pure text helpers over the 16 BG color-gradient
// tables' inline `dw` words in `yi/Banks/Bank57.asm`. The numeric twin of
// palette-edit.ts (same data-words splice), but for the 24-stop gradient tables
// (`DATA_5FD64C`, `DATA_5FD67C`, …) that `backdrop.ts` reads for a level whose
// BackgroundColor header byte is $10..$1F. The app layer reads/writes the files +
// overlay; these stay Node-free and round-trippable.
//
//   gradientLabels    — the 16 table labels, in BackgroundColor order, parsed
//                       from the `DATA_bg_gradient_ptrs` pointer table (Bank01)
//   readGradientTables— the 16×24 base colors (pristine, for the live preview)
//   readGradientEdits — diff overlay-vs-base → the stop edits (offset→value)
//   applyGradientEdits— splice an edit set into the BASE text → edited text
//
// A "gradient edit" is one BGR-15 stop at a flat byte offset across the 16 tables:
//   offset = gradientId * GRADIENT_STRIDE_BYTES + stopIndex * 2   (gradientId 0..15)
// Editing a stop is global — the table is shared by every level using that
// BackgroundColor. The tables are contiguous in Bank57, so `findDataWords` reads
// PAST a table's own 24 words into the next; we always cap to the first 24.

import { findDataWords, dataWordEdits } from './asm/data-words.ts';
import { applyEdits, stripComment } from './asm/text-literals.ts';
import type { GradientEdit } from './types.ts';

export type { GradientEdit };

/** Bank57 (the gradient tables) + Bank01 (the pointer table that names them). */
export const GRADIENT_BLOB_BANK_FILE = 'yi/Banks/Bank57.asm';
export const GRADIENT_PTR_BANK_FILE = 'yi/Banks/Bank01.asm';
const GRADIENT_PTR_LABEL = 'DATA_bg_gradient_ptrs';

/** Stops per gradient table (24 BGR-15 words). */
export const GRADIENT_STOPS = 24;
/** Gradient tables (one per BackgroundColor $10..$1F). */
export const GRADIENT_TABLES = 16;
/** Bytes per table in the flat gradient-edit offset space (24 words × 2). */
export const GRADIENT_STRIDE_BYTES = GRADIENT_STOPS * 2;

/** Split a flat gradient-edit offset into its table + stop indices. */
export function gradientOffset(gradientId: number, stop: number): number {
  return gradientId * GRADIENT_STRIDE_BYTES + stop * 2;
}

/**
 * The 16 gradient-table label names, in BackgroundColor order ($10..$1F), parsed
 * from the `DATA_bg_gradient_ptrs` run in Bank01. Each entry is
 * `dw DATA_XXXX>>16,DATA_XXXX`; we take the second operand's `DATA_…` token so we
 * never depend on the address-encoded label-naming convention. Throws if the
 * table isn't found or doesn't hold 16 entries.
 */
export function gradientLabels(ptrText: string): string[] {
  const lines = ptrText.split('\n');
  const start = lines.findIndex((l) => stripComment(l).trim().startsWith(`${GRADIENT_PTR_LABEL}:`));
  if (start < 0) throw new Error(`gradientLabels: "${GRADIENT_PTR_LABEL}" not found`);
  const labels: string[] = [];
  for (let i = start; i < lines.length && labels.length < GRADIENT_TABLES; i++) {
    const code = stripComment(lines[i]!).trim();
    if (code === '' || code === `${GRADIENT_PTR_LABEL}:`) continue;
    const rest = code.replace(/^[A-Za-z_]\w*:\s*/, '');
    if (rest === '') continue;
    if (!/^dw\b/i.test(rest)) break; // first non-dw line ends the pointer run
    // `dw <bankExpr>,<addrExpr>` — the second operand carries the table label.
    const m = rest.match(/,\s*(DATA_\w+)/);
    if (!m) throw new Error(`gradientLabels: entry ${labels.length} has no DATA_ label: "${rest}"`);
    labels.push(m[1]!);
  }
  if (labels.length !== GRADIENT_TABLES) {
    throw new Error(`gradientLabels: expected ${GRADIENT_TABLES} tables, found ${labels.length}`);
  }
  return labels;
}

/** The 24 base BGR-15 stops for one gradient table. (`findDataWords` over-reads
 *  into the following table; cap to the first 24.) */
function readTable(blobText: string, label: string): number[] {
  return findDataWords(blobText, label)
    .slice(0, GRADIENT_STOPS)
    .map((w) => w.value);
}

/**
 * The 16×24 pristine gradient colors from the BASE Bank57 text. The render path
 * re-sources the live preview from these (BASE ⊕ draft, independent of the built
 * ROM) so a reset shows base immediately — the gradient twin of `basePaletteWords`.
 */
export function readGradientTables(blobText: string, labels: readonly string[]): number[][] {
  return labels.map((label) => readTable(blobText, label));
}

/**
 * The gradient stop edits an overlay `Bank57.asm` holds vs the base — every table
 * stop whose value differs, as a flat `{offset,value}`. `overlayText === null`
 * (no overlay) ⇒ `[]`. Matched by stop index, so it's robust to the splice being
 * format-preserving.
 */
export function readGradientEdits(
  baseText: string,
  overlayText: string | null,
  labels: readonly string[]
): GradientEdit[] {
  if (overlayText === null) return [];
  const out: GradientEdit[] = [];
  labels.forEach((label, gradientId) => {
    const base = readTable(baseText, label);
    const over = readTable(overlayText, label);
    for (let stop = 0; stop < GRADIENT_STOPS; stop++) {
      if (over[stop] !== undefined && over[stop] !== base[stop]) {
        out.push({ offset: gradientOffset(gradientId, stop), value: over[stop]! });
      }
    }
  });
  return out;
}

/**
 * Splice `edits` into the BASE blob text → edited text (format-preserving; only
 * changed words touched). Always reborn from base (idempotent re-saves, clean
 * diffs). Empty `edits` ⇒ base unchanged. Edits are grouped by table and applied
 * via each table's own `dw` run; an edit whose offset isn't a valid table stop
 * throws (via `dataWordEdits`).
 */
export function applyGradientEdits(
  baseText: string,
  edits: readonly GradientEdit[],
  labels: readonly string[]
): string {
  if (edits.length === 0) return baseText;
  // Group changes by table → byte offset within that table's `dw` run.
  const byTable = new Map<number, Map<number, number>>();
  for (const e of edits) {
    const gradientId = Math.floor(e.offset / GRADIENT_STRIDE_BYTES);
    const within = e.offset - gradientId * GRADIENT_STRIDE_BYTES;
    if (gradientId < 0 || gradientId >= labels.length || within < 0 || within >= GRADIENT_STRIDE_BYTES) {
      throw new Error(`applyGradientEdits: offset 0x${e.offset.toString(16)} out of gradient range`);
    }
    let m = byTable.get(gradientId);
    if (!m) byTable.set(gradientId, (m = new Map()));
    m.set(within, e.value & 0xffff);
  }
  const textEdits = [];
  for (const [gradientId, changes] of byTable) {
    const label = labels[gradientId]!;
    const words = findDataWords(baseText, label).slice(0, GRADIENT_STOPS);
    textEdits.push(...dataWordEdits(words, changes));
  }
  return applyEdits(baseText, textEdits);
}

/**
 * Diff the base gradient tables against a foreign cart's gradient stops, returning
 * the stop edits that reproduce the foreign gradients. Used by the ROM importer:
 * `foreignStop(gradientId, stop)` reads the foreign cart's BGR-15 word for that
 * table + stop (the importer resolves each table's foreign address by FOLLOWING
 * the foreign cart's `DATA_bg_gradient_ptrs` table, so a hack that relocated the
 * gradient blobs still aligns), or `undefined` when that table's address can't be
 * resolved (→ the table is skipped). The gradient twin of palette-edit.ts
 * `diffPaletteBlob`; the result is always a valid {@link applyGradientEdits} input.
 */
export function diffForeignGradient(
  baseText: string,
  labels: readonly string[],
  foreignStop: (gradientId: number, stop: number) => number | undefined
): GradientEdit[] {
  const out: GradientEdit[] = [];
  labels.forEach((label, gradientId) => {
    const base = readTable(baseText, label);
    for (let stop = 0; stop < GRADIENT_STOPS; stop++) {
      const fv = foreignStop(gradientId, stop);
      if (fv !== undefined && (fv & 0xffff) !== base[stop]) {
        out.push({ offset: gradientOffset(gradientId, stop), value: fv & 0xffff });
      }
    }
  });
  return out;
}
