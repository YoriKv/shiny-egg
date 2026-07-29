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

// ── Relocated level data in a free bank tail must read as level-data, not
//    "Other data tables" (the EGGCELLENT bucket the Ptrs-target rule fixes). A
//    hack points a level stream into vanilla filler; the stream's zero-fill
//    padding + edges would otherwise fall to data-other.
console.log('\n=== import inventory: relocated-stream free-space reclassification ===');
{
  const SZ = 0x200000;
  const b = new Uint8Array(SZ);
  for (let i = 0; i < SZ; i++) b[i] = i & 0xff;
  // A vanilla free-space tail (all 0xFF) at 0xC0000 — no coarse band, no symbol,
  // so a diff here defaults to data-other without the fix.
  const REGION = 0xc0000;
  for (let i = REGION; i < REGION + 0x1000; i++) b[i] = 0xff;
  const f = b.slice();
  // Relocated stream at +0x400 (real bytes) with 0x00 zero-fill padding before it.
  for (let i = REGION; i < REGION + 0x400; i++) f[i] = 0x00; // padding (0xFF→0x00)
  for (let i = REGION + 0x400; i < REGION + 0x600; i++) f[i] = 0x37; // stream body
  const target = REGION + 0x400; // the Ptrs obj/spr pointer lands here
  const DIFFS = 0x600;

  const withPtr = diffInventory(Buffer.from(f), Buffer.from(b), {
    levelExtents: [],
    levelPtrTargets: [target]
  });
  const lvl = withPtr.categories.find((x) => x.key === 'level-data');
  const other = withPtr.categories.find((x) => x.key === 'data-other');
  assert(!!lvl && lvl.bytes >= DIFFS, `padding + stream → [level-data] (${lvl?.bytes ?? 0} B)`);
  assert(!other || other.bytes === 0, `no [data-other] bytes when a Ptrs target is in the block`);

  // Without the Ptrs target, the same bytes stay data-other (no level evidence).
  const noPtr = diffInventory(Buffer.from(f), Buffer.from(b), { levelExtents: [] });
  const other2 = noPtr.categories.find((x) => x.key === 'data-other');
  assert(!!other2 && other2.bytes >= DIFFS, `no Ptrs target → bytes stay [data-other] (${other2?.bytes ?? 0} B)`);
}

// ── An extended string table spilling into bank $51's free tail must read as
//    strings, not "Other data tables". Vanilla's string region ends at $51:5348
//    (just past DATA_level_name_garbage_sentinel), so a hack whose message /
//    level-name text outgrows it repoints slots into the bank's filler tail — and
//    the spill has no containing band or later symbol (the EGGCELLENT report's
//    "Other data tables at DATA_level_name_garbage_sentinel+0x19").
console.log('\n=== import inventory: extended string table in the bank $51 tail ===');
{
  const SZ = 0x200000;
  const b = new Uint8Array(SZ);
  for (let i = 0; i < SZ; i++) b[i] = i & 0xff;
  const TAIL = 0x115348; // $51:5348 — vanilla filler from here to the bank end
  for (let i = TAIL; i < 0x120000; i++) b[i] = 0xff;
  // Give both pointer tables vanilla-plausible in-region targets — the `i & 0xff`
  // pattern would otherwise read as pointers scattered across the whole bank.
  const MSG_PTRS = snesToPC(0x5110db);
  const NAME_PTRS = sym.pc('DATA_level_name_string_ptrs');
  for (let i = 0; i < 300; i++) {
    b[MSG_PTRS + i * 2] = 0x00;
    b[MSG_PTRS + i * 2 + 1] = 0x14; // $51:1400 — inside the vanilla region
  }
  for (let i = 0; i < 72; i++) {
    b[NAME_PTRS + i * 2] = 0x2f;
    b[NAME_PTRS + i * 2 + 1] = 0x53; // the garbage sentinel, $51:532F
  }
  const f = b.slice();
  // A message body the hack appended at $51:5400, and the pointer slot that
  // targets it (message ptr table at $51:10DB, slot 3).
  const BODY = 0x5400;
  const DIFFS = 0x80;
  for (let i = 0; i < DIFFS; i++) f[snesToPC(0x510000 | BODY) + i] = 0x42;
  const slotPc = snesToPC(0x5110db) + 3 * 2;
  f[slotPc] = BODY & 0xff;
  f[slotPc + 1] = BODY >> 8;

  const inv = diffInventory(Buffer.from(f), Buffer.from(b), { levelExtents: [], symbols: sym });
  const str = inv.categories.find((x) => x.key === 'strings');
  const other = inv.categories.find((x) => x.key === 'data-other');
  assert(!!str && str.bytes >= DIFFS, `spilled message body → [strings] (${str?.bytes ?? 0} B)`);
  assert(!other || other.bytes === 0, `no [data-other] bytes for the spill`);

  // No pointer into the tail ⇒ no evidence it's string data; it stays data-other.
  const f2 = b.slice();
  for (let i = 0; i < DIFFS; i++) f2[snesToPC(0x510000 | BODY) + i] = 0x42;
  const inv2 = diffInventory(Buffer.from(f2), Buffer.from(b), { levelExtents: [], symbols: sym });
  const other2 = inv2.categories.find((x) => x.key === 'data-other');
  assert(
    !!other2 && other2.bytes >= DIFFS,
    `unreferenced tail bytes stay [data-other] (${other2?.bytes ?? 0} B)`
  );

  // The claim must not bleed past the bank into the $52 raw-CHR band (the vanilla
  // filler run runs two bytes into it).
  const f3 = f.slice();
  f3[0x120000] ^= 0xff;
  const inv3 = diffInventory(Buffer.from(f3), Buffer.from(b), { levelExtents: [], symbols: sym });
  const raw = inv3.categories.find((x) => x.key === 'graphics-raw');
  assert(!!raw && raw.bytes >= 1, `bank $52 byte stays [graphics-raw], not swallowed by the spill`);
}
