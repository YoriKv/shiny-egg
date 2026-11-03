// Unit test: spriteset file-table codec (spriteset-files.ts).
// Run: node snes-framework/scripts/spriteset-files.test.ts

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FRAMEWORK_ROOT } from './engine/dev-cart.ts';
import {
  SPRITESET_FILES_BANK_FILE,
  parseSpritesetFiles,
  serializeSpritesetFiles,
} from './spriteset-files.ts';

let failures = 0;
const assert = (condition: boolean, message: string): void => {
  if (!condition) { console.error(`  ✗ ${message}`); failures++; }
};
const eq = (actual: unknown, expected: unknown, message: string): void =>
  assert(JSON.stringify(actual) === JSON.stringify(expected), message);

const source = readFileSync(path.join(FRAMEWORK_ROOT, SPRITESET_FILES_BANK_FILE), 'utf8');
const model = parseSpritesetFiles(source);

console.log('=== table shape and little-endian pairs ===');
eq(model.rows.length, 128, '128 sprite tileset rows');
eq(model.rows[0], [0x20, 0x21, 0x2a, 0x2b, 0x5e, 0x29], 'row 0 reads each word low-byte first');
eq(model.rows[127]?.length, 6, 'last row contains six file IDs');

console.log('=== unchanged serialization ===');
{
  const result = serializeSpritesetFiles(source, model);
  assert(result.ok, 'unchanged table serializes');
  if (result.ok) assert(result.text === source, 'unchanged save is byte-identical');
}

console.log('=== edit both bytes of a row ===');
{
  const edited = structuredClone(model);
  edited.rows[0] = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06];
  const result = serializeSpritesetFiles(source, edited);
  assert(result.ok, 'row edit serializes');
  if (result.ok) {
    eq(parseSpritesetFiles(result.text).rows[0], edited.rows[0], 'edited row parses back');
    assert(result.text.length === source.length, 'fixed-size edit preserves source length');
  }
}

console.log('=== invalid edits are rejected ===');
{
  const wrongShape = structuredClone(model);
  wrongShape.rows[0] = [1, 2];
  assert(!serializeSpritesetFiles(source, wrongShape).ok, 'short row rejected');

  const invalidFileId = structuredClone(model);
  invalidFileId.rows[0]![0] = 0x100;
  assert(!serializeSpritesetFiles(source, invalidFileId).ok, 'file ID above 0xFF rejected');
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll spriteset-files checks passed.');
