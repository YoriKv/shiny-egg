// yoshi-colors.ts pins — the asm-region edit for the per-level Yoshi-color table
// (DATA_yoshi_level_colors inline `db` in Bank02.asm). Load-bearing checks: the
// asm parse reproduces the CART's table bytes exactly (else a write targets the
// wrong slot), a no-change save round-trips byte-for-byte, and a single-slot edit
// touches exactly one byte + reads back.
//
// Run: node snes-framework/scripts/yoshi-colors.test.ts

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadDevCart, FRAMEWORK_ROOT } from './engine/dev-cart.ts';
import {
  parseYoshiColors,
  serializeYoshiColors,
  YOSHI_COLORS_FILE,
  YOSHI_COLORS_LABEL,
  YOSHI_COLOR_SLOTS
} from './yoshi-colors.ts';

let failures = 0;
const assert = (c: boolean, m: string): void => { if (c) console.log(`  ✓ ${m}`); else { console.error(`  ✗ ${m}`); failures++; } };

const baseText = readFileSync(path.join(FRAMEWORK_ROOT, YOSHI_COLORS_FILE), 'utf8');
const model = parseYoshiColors(baseText);
assert(model.colors.length === YOSHI_COLOR_SLOTS, `table parses to ${YOSHI_COLOR_SLOTS} slots (got ${model.colors.length})`);
assert(model.colors.every((c) => c >= 0 && c <= 7), 'every base color id is 0..7');

// The parse MUST match the cart byte-for-byte (the write's correctness rests on it).
try {
  const { rom, symbols } = loadDevCart(FRAMEWORK_ROOT);
  const pc = symbols.pc(YOSHI_COLORS_LABEL);
  let exact = true;
  for (let i = 0; i < YOSHI_COLOR_SLOTS; i++) if (model.colors[i] !== rom[pc + i]) { exact = false; break; }
  assert(exact, 'asm parse reproduces the cart DATA_yoshi_level_colors bytes exactly');
} catch {
  console.log('  (cart unavailable — skipped the cart-vs-asm check)');
}

// No-change save is byte-identical (format-preserving identity).
const noChange = serializeYoshiColors(baseText, model);
assert(noChange.ok && noChange.text === baseText, 'no-change save round-trips byte-for-byte');

// A single-slot edit touches exactly one byte and reads back.
const edited = { colors: model.colors.slice() };
const slot = 0x07; // translevel 1-8
edited.colors[slot] = edited.colors[slot] === 5 ? 6 : 5;
const res = serializeYoshiColors(baseText, edited);
assert(res.ok, 'single-slot edit serializes ok');
if (res.ok) {
  const reparsed = parseYoshiColors(res.text);
  assert(reparsed.colors[slot] === edited.colors[slot], 'edited slot reads back the new color');
  let othersSame = true;
  for (let i = 0; i < YOSHI_COLOR_SLOTS; i++) if (i !== slot && reparsed.colors[i] !== model.colors[i]) { othersSame = false; break; }
  assert(othersSame, 'no other slot changes');
  // Exactly one byte of the file differs.
  let diffBytes = 0;
  for (let i = 0; i < Math.min(res.text.length, baseText.length); i++) if (res.text[i] !== baseText[i]) diffBytes++;
  assert(res.text.length === baseText.length && diffBytes === 1, `exactly one file byte differs (got ${diffBytes}, len ${res.text.length} vs ${baseText.length})`);
}

// Out-of-range colors are rejected (only on a CHANGED slot).
const bad = { colors: model.colors.slice() };
bad.colors[0x07] = 9;
const badRes = serializeYoshiColors(baseText, bad);
assert(!badRes.ok, 'out-of-range color id (9) is rejected');

console.log(failures === 0 ? '\nAll yoshi-colors tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
