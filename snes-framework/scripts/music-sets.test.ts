// Unit test: music set-table codec (music-sets.ts).
// Run: node snes-framework/scripts/music-sets.test.ts
//
// Runs on the base asm sources (no build needed). Pins:
//  - Parse of the retail tables: known settings' rows / init songs / item
//    flags and the 13 rows' block lists (cross-checked against the audio
//    catalog's SPC_BLOCKS ids).
//  - A no-change serialize round-trips both files byte-identically.
//  - The documented SMWC tweak (setting 0x0E → welcome row + init slot 2)
//    splices exactly the two bytes and parses back.
//  - Validation rejects out-of-range rows, unknown block ids, 4-block rows.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FRAMEWORK_ROOT } from './engine/dev-cart.ts';
import {
  MUSIC_SETS_BANK00_FILE,
  MUSIC_SETS_BANK01_FILE,
  parseMusicSets,
  serializeMusicSets,
} from './music-sets.ts';

let failures = 0;
const assert = (c: boolean, m: string): void => {
  if (!c) { console.error(`  ✗ ${m}`); failures++; }
};
const eq = (a: unknown, b: unknown, m: string): void =>
  assert(JSON.stringify(a) === JSON.stringify(b), `${m} (${JSON.stringify(a)} vs ${JSON.stringify(b)})`);

const bank00 = readFileSync(path.join(FRAMEWORK_ROOT, MUSIC_SETS_BANK00_FILE), 'utf8');
const bank01 = readFileSync(path.join(FRAMEWORK_ROOT, MUSIC_SETS_BANK01_FILE), 'utf8');

console.log('=== parse retail ===');
const model = parseMusicSets(bank00, bank01);
eq(model.settings.length, 20, '20 settings');
eq(model.rows.length, 13, '13 rows');
// Spot checks against the catalog's ground truth (§2.3 set table).
eq(model.settings[0x00], { blockSetRow: 3, initSongId: 1, itemDenial: 0 }, 'Flower Garden');
eq(model.settings[0x01], { blockSetRow: 4, initSongId: 1, itemDenial: 0 }, 'Overworld');
eq(model.settings[0x05], { blockSetRow: 7, initSongId: 9, itemDenial: 1 }, 'Boss (immediate)');
eq(model.settings[0x09], { blockSetRow: 9, initSongId: 0x0c, itemDenial: 1 }, 'Tap-Tap');
eq(model.settings[0x0e], { blockSetRow: 0, initSongId: 0, itemDenial: 0 }, 'unused 0x0E → engine row');
eq(model.settings[0x10], { blockSetRow: 0, initSongId: 0, itemDenial: 0xff }, 'Title');
eq(model.settings[0x12], { blockSetRow: 2, initSongId: 1, itemDenial: null }, 'Map (no item entry)');
eq(model.settings[0x13], { blockSetRow: 12, initSongId: null, itemDenial: null }, 'Ending (no init/item entries)');
eq(model.rows[0], [0x2b], 'row 0 = driver only');
eq(model.rows[3], [0x25, 0x19, 0x13], 'row 3 = globalbank+grasslandbank+flowergarden');
eq(model.rows[11], [0x31, 0x34], 'row 11 = bowserbank+bowser');

console.log('=== no-change round-trip ===');
{
  const r = serializeMusicSets(bank00, bank01, model);
  assert(r.ok, 'serialize ok');
  if (r.ok) {
    assert(r.bank00Text === bank00, 'Bank00 byte-identical on no-change save');
    assert(r.bank01Text === bank01, 'Bank01 byte-identical on no-change save');
  }
}

console.log('=== the SMWC tweak (setting 0x0E → welcome row, init slot 2) ===');
{
  const edited = structuredClone(model);
  edited.settings[0x0e] = { blockSetRow: 1, initSongId: 2, itemDenial: 0 };
  const r = serializeMusicSets(bank00, bank01, edited);
  assert(r.ok, 'tweak serializes');
  if (r.ok) {
    const back = parseMusicSets(r.bank00Text, r.bank01Text);
    eq(back.settings[0x0e], { blockSetRow: 1, initSongId: 2, itemDenial: 0 }, 'tweak parses back');
    // Exactly two hex bytes changed across the two files.
    const diffCount = (a: string, b: string): number => {
      let n = 0;
      for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) n++;
      return n;
    };
    assert(diffCount(r.bank00Text, bank00) === 1, `Bank00: one hex digit changed ($00→$04 differs in 1 char; got ${diffCount(r.bank00Text, bank00)})`);
    assert(diffCount(r.bank01Text, bank01) === 1, `Bank01: one hex digit changed ($00→$02; got ${diffCount(r.bank01Text, bank01)})`);
    assert(r.bank00Text.length === bank00.length && r.bank01Text.length === bank01.length, 'file lengths unchanged');
  }
}

console.log('=== row edit + validation ===');
{
  const edited = structuredClone(model);
  edited.rows[11] = [0x31, 0x34, 0x13]; // add flowergarden to the bowser row
  const r = serializeMusicSets(bank00, bank01, edited);
  assert(r.ok, 'row edit serializes');
  if (r.ok) eq(parseMusicSets(r.bank00Text, bank01).rows[11], [0x31, 0x34, 0x13], 'row edit parses back');

  const badRow = structuredClone(model);
  badRow.settings[0x02] = { ...badRow.settings[0x02]!, blockSetRow: 13 };
  assert(!serializeMusicSets(bank00, bank01, badRow).ok, 'row 13 rejected');

  const badBlock = structuredClone(model);
  badBlock.rows[3] = [0x25, 0x19, 0x12];
  assert(!serializeMusicSets(bank00, bank01, badBlock).ok, 'unknown block id rejected');

  const fourBlocks = structuredClone(model);
  fourBlocks.rows[3] = [0x25, 0x19, 0x13, 0x10];
  assert(!serializeMusicSets(bank00, bank01, fourBlocks).ok, '4-block row rejected');

  const badInit = structuredClone(model);
  badInit.settings[0x00] = { ...badInit.settings[0x00]!, initSongId: 0x15 };
  assert(!serializeMusicSets(bank00, bank01, badInit).ok, 'init slot 0x15 rejected');
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll music-sets checks passed.');
