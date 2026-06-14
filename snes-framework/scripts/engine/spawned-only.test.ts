// Pins the committed `spawnedOnly` flags in obj-metadata.json against a fresh
// derivation from engine/spawned-only.ts (asm spawn-site scan ∩ never-placed).
// This is the "did you forget to regenerate after a sprite-spawn asm change"
// guard: edit the spawn asm (or a sprite gains/loses a placement) and the
// committed metadata silently drifts — this catches it.
//
// Needs the extracted level data (instance index, built in-memory if the cached
// json is absent). Skips cleanly (exit 2) when no extract is present, matching
// the other cart/extract-gated engine tests.
//
// Run: node snes-framework/scripts/engine/spawned-only.test.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { FRAMEWORK_ROOT } from './dev-cart.ts';
import { deriveSpawnedOnly, SPECIAL_SPRITE_BASE, type SpawnedOnlyResult } from './spawned-only.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ ${msg}`); failures++; }
}

let derived: SpawnedOnlyResult;
try {
  derived = deriveSpawnedOnly(FRAMEWORK_ROOT);
} catch (e) {
  console.error(`spawned-only.test: no extract available — ${(e as Error).message}`);
  process.exit(2);
}

const meta = JSON.parse(
  fs.readFileSync(
    path.join(FRAMEWORK_ROOT, '..', 'src', 'renderer', 'src', 'data', 'obj-metadata.json'),
    'utf8'
  )
) as { sprites: Record<string, { spawnedOnly?: boolean }> };

const hex = (id: number): string => '0x' + id.toString(16).toUpperCase().padStart(3, '0');
const committed = new Set(
  Object.entries(meta.sprites)
    .filter(([, e]) => e.spawnedOnly === true)
    .map(([k]) => parseInt(k.slice(2), 16))
);
const want = new Set(derived.spawnedOnly);

console.log(`derived spawnedOnly: ${want.size}; committed: ${committed.size}`);

const missing = [...want].filter((id) => !committed.has(id)).sort((a, b) => a - b);
const extra = [...committed].filter((id) => !want.has(id)).sort((a, b) => a - b);
assert(missing.length === 0, `every derived spawn-only sprite is flagged${missing.length ? ` — MISSING ${missing.map(hex).join(', ')} (regenerate: node tmp/gen-spawned-only.ts --write)` : ''}`);
assert(extra.length === 0, `no extra flags in metadata${extra.length ? ` — STALE ${extra.map(hex).join(', ')}` : ''}`);

// Invariants the definition guarantees, checked against the committed flags.
for (const id of committed) {
  assert(derived.spawned.has(id), `${hex(id)} is actually spawned by another sprite`);
  assert(!derived.placed.has(id), `${hex(id)} has zero base-cart placements`);
  assert(id < SPECIAL_SPRITE_BASE, `${hex(id)} is a normal sprite (< ${hex(SPECIAL_SPRITE_BASE)})`);
}

console.log(failures === 0 ? '\n✓ spawnedOnly metadata matches the asm derivation' : `\n✗ ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
