// Unit test: ordered spriteset file placement (sprite-file-sequences.ts).
// Pins placeOrderedSpritesetFiles (chains land in consecutive slots, shared
// files join chains, locked slots are never overwritten) and the shape of the
// curated SPRITE_FILE_CHAINS table. No cart needed.
// Run: node snes-framework/scripts/engine/sprite-file-sequences.test.ts

import { placeOrderedSpritesetFiles, SPRITE_FILE_CHAINS } from './sprite-file-sequences.ts';

let failures = 0;
const assert = (condition: boolean, message: string): void => {
  if (condition) console.log(`  ✓ ${message}`);
  else { console.error(`  ✗ ${message}`); failures++; }
};
const eq = (actual: unknown, expected: unknown, message: string): void =>
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message} (got ${JSON.stringify(actual)})`);
const hasRun = (files: readonly number[], run: readonly number[]): boolean =>
  files.some((_, start) => run.every((f, i) => files[start + i] === f));

console.log('=== placement ===');
{
  const files = [0x2a, 0x33, 0x2b, 0x47, 0x55, 0x56];
  const r = placeOrderedSpritesetFiles(files, [[0x2a, 0x2b], [0x2b, 0x47]], new Set(), new Set([0x2a, 0x2b, 0x33, 0x47]));
  eq(r.conflicts, [], 'overlapping sequences join without conflict');
  assert(hasRun(files, [0x2a, 0x2b, 0x47]), 'A→B + B→C placed as one adjacent A→B→C run');
}
{
  const files = [0x32, 0x55, 0x33, 0x56, 0x34, 0x57];
  const r = placeOrderedSpritesetFiles(files, [[0x32, 0x33, 0x34]], new Set(), new Set([0x32, 0x33, 0x34, 0x55, 0x56, 0x57]));
  eq(r.conflicts, [], 'three-file chain places');
  assert(hasRun(files, [0x32, 0x33, 0x34]), 'three-file chain is adjacent and ordered');
}
{
  const files = [0x3a, 0x22, 0x3b, 0x23, 0x24, 0x25];
  const r = placeOrderedSpritesetFiles(files, [[0x3a, 0x3b]], new Set(), new Set([0x3a, 0x3b, 0x22]));
  eq(r.conflicts, [], 'separated pair is pulled together');
  assert(hasRun(files, [0x3a, 0x3b]), 'pair adjacent after placement');
  // (A displaced required file such as 0x22 is re-placed by resolveLevelSpriteset's
  // missing-file pass, not by the placer.)
}
{
  const files = [0x4f, 0x43, 0x25, 0x29, 0x1a, 0x1a];
  const r = placeOrderedSpritesetFiles(files, [[0x42, 0x43]], new Set(), new Set([0x4f, 0x43, 0x25, 0x29, 0x42]));
  eq(r.conflicts, [], 'duplicate filler slots absorb a chain');
  assert(hasRun(files, [0x42, 0x43]), 'chain placed into filler');
}
{
  const files = [0x10, 0x11, 0x12, 0x13, 0x14, 0x15];
  const r = placeOrderedSpritesetFiles(files, [[0x2a, 0x2b]], new Set([0, 1, 2, 3, 4, 5]), new Set([0x2a, 0x2b]));
  eq(r.conflicts, [0x2a, 0x2b], 'fully locked row reports the chain as a conflict');
  eq(files, [0x10, 0x11, 0x12, 0x13, 0x14, 0x15], 'locked row is left untouched');
}
{
  const files = [0x2a, 0x2b, 0x10, 0x11, 0x12, 0x13];
  const r = placeOrderedSpritesetFiles(files, [[0x2a, 0x2b]], new Set(), new Set([0x2a, 0x2b]));
  assert(!r.changed && r.conflicts.length === 0, 'already-adjacent chain is a no-op');
}

console.log('=== SPRITE_FILE_CHAINS shape ===');
for (const [num, chain] of SPRITE_FILE_CHAINS) {
  const ok = chain.length >= 2 && chain.length <= 6 && new Set(chain).size === chain.length &&
    chain.every((f) => Number.isInteger(f) && f > 0 && f <= 0xff);
  if (!ok) assert(false, `sprite 0x${num.toString(16)} chain is 2..6 distinct byte file ids`);
}
assert(SPRITE_FILE_CHAINS.size > 0, 'every chain is 2..6 distinct byte file ids');

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\n✓ all sprite-file-sequences checks pass');
