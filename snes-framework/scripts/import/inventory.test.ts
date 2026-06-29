// Pins the import-inventory categorization. The regression this guards: the
// now-imported fixed-address regions (gfx pointer tables, title-screen tilemaps,
// gradient tables, cutscene text) must be attributed to IMPORTED categories — not
// the not-imported "tileset/spriteset selection tables" bucket (the EGGCELLENT
// false positive where 2011 B of relocated gfx pointers + logo tilemap showed as
// "Graphics-selection tables, not imported"). The genuine selection tables must
// stay not-imported. Run: node snes-framework/scripts/import/inventory.test.ts

import { diffInventory } from './inventory.ts';
import { snesToPC, vendoredV10SymbolMap } from '../engine/symbol-map.ts';

function assert(cond: boolean, msg: string): void {
  if (cond) console.log('  ✓ ' + msg);
  else {
    console.error('  ✗ ' + msg);
    process.exitCode = 1;
  }
}

const SIZE = 0x200000;
const base = new Uint8Array(SIZE);
for (let i = 0; i < SIZE; i++) base[i] = i & 0xff; // deterministic pattern
const sym = vendoredV10SymbolMap();

interface Case {
  pc: number;
  key: string;
  imported: boolean;
  name: string;
}
const cases: Case[] = [
  { pc: snesToPC(0x06f95e), key: 'gfx-ptrs', imported: true, name: 'gfx LZ2 pointer table' },
  { pc: snesToPC(0x06fc79), key: 'gfx-ptrs', imported: true, name: 'gfx LZ16 pointer table' },
  { pc: snesToPC(0x5f9800), key: 'screen-tilemap', imported: true, name: 'title-island tilemap' },
  { pc: snesToPC(0x0ffc80), key: 'screen-tilemap', imported: true, name: 'title-logo tilemap' },
  { pc: 0x1fd64c, key: 'gradient', imported: true, name: 'backdrop gradient tables' },
  { pc: 0x120000, key: 'graphics-raw', imported: true, name: 'raw CHR (bank $52)' },
  { pc: 0x16ffff, key: 'graphics-raw', imported: true, name: 'raw CHR (bank $56 tail)' },
  { pc: 0x7cf78, key: 'cutscene-text', imported: true, name: 'intro storybook text' },
  { pc: 0x6f3e8, key: 'cutscene-text', imported: true, name: 'ending text' },
  // The genuine selection tables stay NOT imported (needs the sym for tier-3).
  { pc: snesToPC(0x00af39), key: 'gfx-tables', imported: false, name: 'BG1 tileset-files table' },
  { pc: snesToPC(0x00b039), key: 'gfx-tables', imported: false, name: 'spriteset-files table' }
];

console.log('\n=== import inventory: fixed-address region categorization ===');
for (const c of cases) {
  const foreign = base.slice();
  foreign[c.pc] = base[c.pc] ^ 0xff; // one differing byte in the region
  const inv = diffInventory(Buffer.from(foreign), Buffer.from(base), { levelExtents: [], symbols: sym });
  const cat = inv.categories.find((x) => x.key === c.key);
  assert(
    !!cat && cat.bytes >= 1 && cat.imported === c.imported,
    `${c.name} → [${c.key}] imported=${c.imported}`
  );
}
