// island-tilemap.ts pins — the asm-region edit for the title-island tilemap
// (DATA_5F9800 inline `dw` in Bank57.asm). The load-bearing check: the asm parse
// reproduces the CART's tilemap bytes exactly (else a placement write targets the
// wrong bytes). Plus: an edit applies + reads back, round-trips, and is
// format-preserving (only the touched `dw` changes).
//
// Run: node snes-framework/scripts/island-tilemap.test.ts

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadDevCart, FRAMEWORK_ROOT } from './engine/dev-cart.ts';
import {
  readIslandTilemapBytes, applyIslandTilemapEdits, readIslandTilemapEdits, ISLAND_TILEMAP_LABEL
} from './island-tilemap.ts';

let failures = 0;
const assert = (c: boolean, m: string): void => { if (c) console.log(`  ✓ ${m}`); else { console.error(`  ✗ ${m}`); failures++; } };

const baseText = readFileSync(path.join(FRAMEWORK_ROOT, 'yi/Banks/Bank57.asm'), 'utf8');
const bytes = readIslandTilemapBytes(baseText);
assert(bytes.length === 1024, `DATA_5F9800 parses to 1024 cells (got ${bytes.length})`);

// The parse MUST match the cart byte-for-byte (the write's correctness rests on it).
try {
  const { rom, symbols } = loadDevCart(FRAMEWORK_ROOT);
  const pc = symbols.pc(ISLAND_TILEMAP_LABEL);
  let exact = true;
  for (let i = 0; i < 1024; i++) if (bytes[i] !== rom[pc + i]) { exact = false; break; }
  assert(exact, 'asm parse reproduces the cart DATA_5F9800 bytes exactly');
} catch {
  console.log('  (cart unavailable — skipped the cart-vs-asm check)');
}

// An edit applies + reads back; only the targeted cell changes.
const edited = applyIslandTilemapEdits(baseText, [{ offset: 5, value: 0x42 }, { offset: 1000, value: 0x07 }]);
const eb = readIslandTilemapBytes(edited);
assert(eb[5] === 0x42 && eb[1000] === 0x07, 'edits apply to the right cells');
let othersSame = true;
for (let i = 0; i < 1024; i++) if (i !== 5 && i !== 1000 && eb[i] !== bytes[i]) { othersSame = false; break; }
assert(othersSame, 'no other cell changes');

// Round-trip: the overlay diff recovers exactly the edits.
const back = readIslandTilemapEdits(baseText, edited).sort((a, b) => a.offset - b.offset);
assert(back.length === 2 && back[0]!.offset === 5 && back[0]!.value === 0x42 && back[1]!.offset === 1000 && back[1]!.value === 0x07,
  'overlay-vs-base diff round-trips the edits');

// Format-preserving: editing one cell changes exactly one `dw` line region; the rest
// of the file is byte-identical. (Cells 5 and 1000 are odd-then-even, two distinct words.)
const single = applyIslandTilemapEdits(baseText, [{ offset: 5, value: 0x42 }]);
let diffChars = 0;
for (let i = 0; i < Math.min(single.length, baseText.length); i++) if (single[i] !== baseText[i]) diffChars++;
assert(single.length === baseText.length && diffChars > 0 && diffChars <= 2,
  `a 1-cell edit rewrites only its hex byte (${diffChars} chars differ)`);
// Empty edit set ⇒ base unchanged.
assert(applyIslandTilemapEdits(baseText, []) === baseText, 'empty edit set leaves the asm untouched');

console.log(`\n${failures === 0 ? '✓ all island-tilemap pins pass' : `✗ ${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
