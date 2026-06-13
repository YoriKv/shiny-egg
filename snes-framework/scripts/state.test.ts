// Unit test for the out-of-date-extract check (state.ts checkExtractFreshness)
// — the extract-side analogue of the outdated-overlay checker. Synthetic temp
// workRoot only; no cart, no Electron.
// Run: node snes-framework/scripts/state.test.ts

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  checkExtractFreshness,
  EXTRACT_PIPELINE_VERSION,
  writeExtractionState,
} from './state.ts';
import type { ExtractionState } from './types.ts';

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${msg}`);
    process.exitCode = 1;
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shiny-egg-state-test-'));
const outputs = ['level-map.json', 'levels.json', 'instance-index.json'].map((f) =>
  path.join(root, 'editor-data', 'yi', f)
);
const baseState: ExtractionState = {
  romVersion: 'YI_U1',
  extractedAt: '2026-06-12T00:00:00.000Z',
  sourceCart: '/carts/YI_USA1.sfc',
  sourceCartMd5: 'cb472164c5a71ccd3739963390ec6a50',
  extractedFiles: 1234,
  emptyFiles: 0,
};

console.log('=== checkExtractFreshness ===');

// Never extracted: no state file at all.
let v = checkExtractFreshness(root);
assert(v.status === 'none', `no state file → 'none' (got ${v.status})`);
assert(v.reasons.length === 0, 'no state file → no reasons');

// Pre-versioning extract (state without pipelineVersion) → stale.
writeExtractionState(root, baseState);
v = checkExtractFreshness(root);
assert(v.status === 'stale', `state without pipelineVersion → 'stale' (got ${v.status})`);
assert(
  v.reasons.some((r) => r.includes('pipeline')),
  'pre-versioning staleness names the pipeline'
);

// Current version but the editor-data outputs are missing → stale, one reason each.
writeExtractionState(root, { ...baseState, pipelineVersion: EXTRACT_PIPELINE_VERSION });
v = checkExtractFreshness(root);
assert(v.status === 'stale', `current version, outputs missing → 'stale' (got ${v.status})`);
assert(
  v.reasons.length === outputs.length &&
    v.reasons.every((r) => r.startsWith('missing ')),
  `one 'missing …' reason per absent output (got ${JSON.stringify(v.reasons)})`
);
assert(
  v.reasons.some((r) => r.includes('levels.json')),
  'a missing levels.json is named'
);

// All expected outputs present + current version → fresh.
fs.mkdirSync(path.join(root, 'editor-data', 'yi'), { recursive: true });
for (const p of outputs) fs.writeFileSync(p, '{}');
v = checkExtractFreshness(root);
assert(v.status === 'fresh', `current version + all outputs → 'fresh' (got ${v.status})`);
assert(v.reasons.length === 0, 'fresh → no reasons');

// Deleting one output (the user's stale-levels.json example) flips it back.
fs.rmSync(path.join(root, 'editor-data', 'yi', 'levels.json'));
v = checkExtractFreshness(root);
assert(v.status === 'stale', `levels.json removed → 'stale' (got ${v.status})`);
assert(
  v.reasons.length === 1 && v.reasons[0].includes('levels.json'),
  `exactly one reason, naming levels.json (got ${JSON.stringify(v.reasons)})`
);
fs.writeFileSync(path.join(root, 'editor-data', 'yi', 'levels.json'), '{}');

// A version MISMATCH is stale in either direction (strict equality, not <).
writeExtractionState(root, { ...baseState, pipelineVersion: EXTRACT_PIPELINE_VERSION + 1 });
v = checkExtractFreshness(root);
assert(v.status === 'stale', `future pipelineVersion → 'stale' (got ${v.status})`);

// Corrupt state file reads as null → 'none' (the first-run flow handles it).
fs.writeFileSync(path.join(root, '.extraction-state.json'), 'not json');
v = checkExtractFreshness(root);
assert(v.status === 'none', `corrupt state file → 'none' (got ${v.status})`);

fs.rmSync(root, { recursive: true, force: true });

console.log(`\nstate.test: ${fail === 0 ? 'OK' : 'FAIL'} — ${pass} passed, ${fail} failed.`);
