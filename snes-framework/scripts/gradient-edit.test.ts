// Unit test: backdrop-gradient edit layer (gradient-edit.ts). Verifies label
// parsing from the pointer table, base-table reads (capped to 24 stops despite
// the contiguous over-read), overlay-vs-base diffing, and a format-preserving
// round-trip (no-op save == base byte-for-byte; an edit touches only its stop).
// Run: node snes-framework/scripts/gradient-edit.test.ts

import {
  gradientLabels,
  readGradientTables,
  readGradientEdits,
  applyGradientEdits,
  gradientOffset,
  GRADIENT_STOPS,
  GRADIENT_TABLES
} from './gradient-edit.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}
function eq<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`  ✗ ${msg}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    failures++;
  }
}

// A synthetic Bank01 pointer table: 16 entries, `dw DATA_X>>16,DATA_X`, with a
// leading comment and a real statement that ends the run.
const PTR_LINES = ['DATA_bg_gradient_ptrs:\t; the table'];
for (let g = 0; g < GRADIENT_TABLES; g++) {
  const label = `DATA_5FD${(0x64c + g * 0x30).toString(16).toUpperCase()}`;
  PTR_LINES.push(`\tdw ${label}>>16,${label}`);
}
PTR_LINES.push('\tRTL');
const PTR_TEXT = PTR_LINES.join('\n');

// A synthetic Bank57: each of the 16 gradient tables = a label + 3 `dw` lines of
// 8 words (24 stops), tables contiguous (so a table's read over-reads into the
// next — the cap-to-24 must hold). Distinct values per (table, stop) so diffs are
// unambiguous. Trailing non-dw statement ends the final run.
const labels = gradientLabels(PTR_TEXT);
eq(labels.length, GRADIENT_TABLES, 'parses 16 gradient labels');
eq(labels[0], 'DATA_5FD64C', 'first label');
eq(labels[15], 'DATA_5FD91C', 'last label (16th, +0x30×15)');

const BLOB_LINES: string[] = [];
const expectTables: number[][] = [];
for (let g = 0; g < GRADIENT_TABLES; g++) {
  BLOB_LINES.push(`${labels[g]}:`);
  const table: number[] = [];
  for (let row = 0; row < 3; row++) {
    const words: string[] = [];
    for (let c = 0; c < 8; c++) {
      const stop = row * 8 + c;
      const v = (g * 0x100 + stop) & 0x7fff; // unique, in BGR-15 range
      table.push(v);
      words.push('$' + v.toString(16).toUpperCase().padStart(4, '0'));
    }
    BLOB_LINES.push('\tdw ' + words.join(','));
  }
  expectTables.push(table);
}
BLOB_LINES.push('\tRTL'); // ends the last table's run
const BASE = BLOB_LINES.join('\n');

// 1. readGradientTables: 16×24, capped to 24 despite contiguous over-read.
const tables = readGradientTables(BASE, labels);
eq(tables.length, GRADIENT_TABLES, 'readGradientTables → 16 tables');
eq(tables[0]!.length, GRADIENT_STOPS, 'each table has 24 stops');
eq(tables[0], expectTables[0], 'table 0 stops match');
eq(tables[7], expectTables[7], 'table 7 stops match (mid-blob, over-read capped)');
eq(tables[15], expectTables[15], 'table 15 stops match');

// 2. No-op: readGradientEdits(base, base) → [] ; applyGradientEdits(base, []) === base.
eq(readGradientEdits(BASE, BASE, labels), [], 'no edits when overlay == base');
eq(readGradientEdits(BASE, null, labels), [], 'no overlay ⇒ []');
assert(applyGradientEdits(BASE, [], labels) === BASE, 'empty edits ⇒ base unchanged');

// 3. Apply an edit set across multiple tables, then re-read the diff → identity.
const edits = [
  { offset: gradientOffset(0, 0), value: 0x1234 },
  { offset: gradientOffset(0, 23), value: 0x7abc },
  { offset: gradientOffset(15, 5), value: 0x0fed }
];
const edited = applyGradientEdits(BASE, edits, labels);
assert(edited !== BASE, 'edit changes the text');
// Only the three target stops differ; everything else byte-identical.
const reread = readGradientEdits(BASE, edited, labels);
eq(
  [...reread].sort((a, b) => a.offset - b.offset),
  [...edits].sort((a, b) => a.offset - b.offset),
  'round-trip: re-read edits == applied edits'
);

// 4. Format-preserving: the edited text differs from base ONLY in the 3 hex words
//    (same length, so length is unchanged; exactly 3 differing 4-char windows).
eq(edited.length, BASE.length, 'edit is length-preserving (4-hex-digit splice)');
let diffWords = 0;
for (let i = 0; i < BASE.length; i++) if (BASE[i] !== edited[i]) { diffWords++; while (i < BASE.length && BASE[i] !== edited[i]) i++; }
eq(diffWords, 3, 'exactly 3 contiguous differing regions (one per edited stop)');

// 5. Idempotent re-save: applying the re-read edits onto base reproduces `edited`.
assert(applyGradientEdits(BASE, reread, labels) === edited, 'reborn-from-base is idempotent');

// 6. Capped read isolation: editing table 0's last stop must not bleed into table 1.
eq(readGradientTables(edited, labels)[1], expectTables[1], 'table 1 untouched by table 0 edit');

if (failures === 0) console.log('✓ gradient-edit: all assertions passed');
else { console.error(`\n${failures} assertion(s) failed`); process.exit(1); }
