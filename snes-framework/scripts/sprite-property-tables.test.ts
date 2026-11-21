// Unit test: sprite property table codec (sprite-property-tables.ts).
// Run: node snes-framework/scripts/sprite-property-tables.test.ts

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FRAMEWORK_ROOT } from './engine/dev-cart.ts';
import {
  SPRITE_PROPERTIES_BANK_FILE,
  SPRITE_PROPERTY_COUNT,
  SPRITE_PROPERTY_TABLES,
  parseSpriteProperties,
  serializeSpriteProperties,
  spritePropertyTableBytes,
  spritePropertyTableFromAsm,
} from './sprite-property-tables.ts';

let failures = 0;
const assert = (condition: boolean, message: string): void => {
  if (!condition) { console.error(`  ✗ ${message}`); failures++; }
};
const eq = (actual: unknown, expected: unknown, message: string): void =>
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message} (got ${JSON.stringify(actual)})`);

const source = readFileSync(path.join(FRAMEWORK_ROOT, SPRITE_PROPERTIES_BANK_FILE), 'utf8');
const model = parseSpriteProperties(source);

console.log('=== shape ===');
for (const def of SPRITE_PROPERTY_TABLES) {
  eq(model.tables[def.key].length, SPRITE_PROPERTY_COUNT, `${def.key}: 442 words`);
  assert(spritePropertyTableFromAsm(source, def.key) !== null, `${def.key}: region present`);
}
eq(model.tables.collision[0x000], 0x0040, 'LavaLog collision word');
eq(model.tables.collision[0x1b9], 0x0660, 'last collision row');
eq(model.tables.terrain[0x000], 0x4484, 'LavaLog terrain word');
eq(model.tables.gravity[0x000], 0x4010, 'LavaLog gravity word');
eq(model.hitboxShapes.length, 32, '32 hitbox shapes');
eq(model.hitboxShapes[0], { cx: 8, cy: 8, hw: 6, hh: 6 }, 'shape 0 = 12x12');
eq(model.hitboxShapes[3], { cx: 8, cy: -4, hw: 6, hh: 4 }, 'shape 3 has a signed Y offset');

console.log('=== unchanged + edited serialization ===');
{
  const r = serializeSpriteProperties(source, model);
  assert(r.ok && r.text === source, 'unchanged save is byte-identical');
  const edited = structuredClone(model);
  edited.tables.collision[0x01e] = 0x1234;
  edited.tables.spitGraphic[0x1b9] = 0xbeef;
  const r2 = serializeSpriteProperties(source, edited);
  assert(r2.ok, 'edit serializes');
  if (r2.ok) {
    eq(parseSpriteProperties(r2.text).tables, edited.tables, 'edit round-trips');
    const a = source.split('\n'), b = r2.text.split('\n');
    eq(b.filter((l, i) => l !== a[i]).length, 2, 'two lines change');
  }
  const bytes = spritePropertyTableBytes(edited, 'collision');
  eq([bytes[0x01e * 2], bytes[0x01e * 2 + 1]], [0x34, 0x12], 'bytes are little-endian');
}

console.log('=== guards ===');
{
  const bad = structuredClone(model);
  bad.tables.gravity[0] = 0x10000;
  assert(!serializeSpriteProperties(source, bad).ok, 'non-16-bit word refused');
  assert(spritePropertyTableFromAsm('no markers here', 'collision') === null, 'marker-less text yields null');
}

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\n✓ all sprite-property-tables checks pass');
