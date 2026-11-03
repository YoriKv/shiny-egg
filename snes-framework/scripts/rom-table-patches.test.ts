// Unit test: ROM table patch registry (rom-table-patches.ts).
// Pins, for every registered table: its bytes from the base asm equal the built
// V1.0 ROM at its label (so the label, size and encoder agree with what the
// assembler emits); an edited overlay region and the editor model produce the
// same bytes; a region-less file yields null; applying writes exactly the
// table's span. The ROM comparison is build-gated and skips without a build.
// Run: node snes-framework/scripts/rom-table-patches.test.ts

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { FRAMEWORK_ROOT, devCartPaths, loadDevCart } from './engine/dev-cart.ts';
import { ROM_TABLE_PATCHES, applyRomTablePatch, romTablePatch } from './rom-table-patches.ts';
import { parseSpritesetFiles, serializeSpritesetFiles } from './spriteset-files.ts';

let failures = 0;
const assert = (condition: boolean, message: string): void => {
  if (condition) console.log(`  ✓ ${message}`);
  else { console.error(`  ✗ ${message}`); failures++; }
};
const same = (a: Uint8Array | null, b: Uint8Array | null): boolean =>
  !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);

const cartPaths = devCartPaths();
const cart = existsSync(cartPaths.cartPath) && existsSync(cartPaths.symPath) ? loadDevCart() : null;
if (!cart) console.log('  (no V1.0 build: skipping ROM comparisons)');

for (const patch of ROM_TABLE_PATCHES) {
  console.log(`=== ${patch.kind} ===`);
  const text = readFileSync(path.join(FRAMEWORK_ROOT, patch.file), 'utf8');
  const baseBytes = patch.fromAsm(text);
  assert(baseBytes?.length === patch.size, `base asm yields ${patch.size} bytes`);
  assert(romTablePatch(patch.kind) === patch, 'lookup by kind');

  if (cart) {
    const pc = cart.symbols.pc(patch.label);
    assert(same(baseBytes, cart.rom.subarray(pc, pc + patch.size)), 'base asm bytes == built ROM at the label');

    const rom = cart.rom.slice();
    const edited = baseBytes!.slice();
    edited[0] ^= 0xff;
    applyRomTablePatch(rom, cart.symbols, patch, edited);
    let outside = 0;
    for (let i = 0; i < rom.length; i++) if ((i < pc || i >= pc + patch.size) && rom[i] !== cart.rom[i]) outside++;
    assert(rom[pc] === edited[0] && outside === 0, 'apply writes the table span only');
    let threw = false;
    try { applyRomTablePatch(rom, cart.symbols, patch, edited.subarray(1)); } catch { threw = true; }
    assert(threw, 'wrong-size bytes are rejected');
  }

  const stripped = text.replace(new RegExp(`;@editable:${patch.region} (begin|end)`, 'g'), ';');
  assert(patch.fromAsm(stripped) === null, 'file without the region yields null');
}

console.log('=== spriteset-files: overlay text and model agree ===');
{
  const patch = romTablePatch('spriteset-files');
  const text = readFileSync(path.join(FRAMEWORK_ROOT, patch.file), 'utf8');
  const model = parseSpritesetFiles(text);
  model.rows[0x35] = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06];
  const saved = serializeSpritesetFiles(text, model);
  assert(saved.ok, 'edited model serializes');
  if (saved.ok) assert(same(patch.fromAsm(saved.text), patch.fromModel(model)), 'fromAsm(saved overlay) == fromModel(draft)');
  let threw = false;
  try { patch.fromModel({ rows: model.rows.slice(1) }); } catch { threw = true; }
  assert(threw, 'malformed model is rejected');
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\n✓ all rom-table-patches checks pass');
