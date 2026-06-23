// logo-tilemap.ts pins — the asm-region edit for the title-logo tilemap
// (DATA_title_screen_logo_tilemap inline `dw` in Bank0F.asm). Load-bearing check: the
// asm parse reproduces the CART's tilemap words exactly (else a placement write targets
// the wrong words). Plus: an edit applies + reads back, round-trips, and is
// format-preserving (only the touched `dw` changes). One `dw` = one cell (a full BG word).
//
// Run: node snes-framework/scripts/logo-tilemap.test.ts

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadDevCart, FRAMEWORK_ROOT } from './engine/dev-cart.ts';
import {
  readLogoTilemapWords, applyLogoTilemapEdits, readLogoTilemapEdits, LOGO_TILEMAP_LABEL
} from './logo-tilemap.ts';

let failures = 0;
const assert = (c: boolean, m: string): void => { if (c) console.log(`  ✓ ${m}`); else { console.error(`  ✗ ${m}`); failures++; } };

const baseText = readFileSync(path.join(FRAMEWORK_ROOT, 'yi/Banks/Bank0F.asm'), 'utf8');
const words = readLogoTilemapWords(baseText);
assert(words.length === 448, `DATA_title_screen_logo_tilemap parses to 448 words (got ${words.length})`);

// The parse MUST match the cart word-for-word (the write's correctness rests on it).
try {
  const { rom, symbols } = loadDevCart(FRAMEWORK_ROOT);
  const pc = symbols.pc(LOGO_TILEMAP_LABEL);
  let exact = true;
  for (let i = 0; i < 448; i++) if (words[i] !== (rom[pc + i * 2]! | (rom[pc + i * 2 + 1]! << 8))) { exact = false; break; }
  assert(exact, 'asm parse reproduces the cart logo-tilemap words exactly');
} catch {
  console.log('  (cart unavailable — skipped the cart-vs-asm check)');
}

// An edit applies + reads back; only the targeted cells change.
const edited = applyLogoTilemapEdits(baseText, [{ offset: 5, value: 0x4242 }, { offset: 447, value: 0x8307 }]);
const eb = readLogoTilemapWords(edited);
assert(eb[5] === 0x4242 && eb[447] === 0x8307, 'edits apply to the right cells');
let othersSame = true;
for (let i = 0; i < 448; i++) if (i !== 5 && i !== 447 && eb[i] !== words[i]) { othersSame = false; break; }
assert(othersSame, 'no other cell changes');

// Round-trip: the overlay diff recovers exactly the edits.
const back = readLogoTilemapEdits(baseText, edited).sort((a, b) => a.offset - b.offset);
assert(back.length === 2 && back[0]!.offset === 5 && back[0]!.value === 0x4242 && back[1]!.offset === 447 && back[1]!.value === 0x8307,
  'overlay-vs-base diff round-trips the edits');

// Format-preserving: editing one cell rewrites only that `dw`'s 4 hex digits.
const single = applyLogoTilemapEdits(baseText, [{ offset: 5, value: 0x4242 }]);
let diffChars = 0;
for (let i = 0; i < Math.min(single.length, baseText.length); i++) if (single[i] !== baseText[i]) diffChars++;
assert(single.length === baseText.length && diffChars > 0 && diffChars <= 4,
  `a 1-cell edit rewrites only its hex word (${diffChars} chars differ)`);
// A no-op edit (same value) and an empty set both leave the asm untouched.
assert(applyLogoTilemapEdits(baseText, [{ offset: 5, value: words[5]! }]) === baseText, 'a same-value edit leaves the asm untouched');
assert(applyLogoTilemapEdits(baseText, []) === baseText, 'empty edit set leaves the asm untouched');

console.log(`\n${failures === 0 ? '✓ all logo-tilemap pins pass' : `✗ ${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
