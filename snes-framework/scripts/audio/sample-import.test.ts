// Unit test: base-aware sample import planning.
// Run: node snes-framework/scripts/audio/sample-import.test.ts
//
// Pins, over a self-contained scratch project (synthetic base samples —
// no cart/extract needed):
//  - checksum gate: untouched .wav → 'unchanged', no writes; restored .wav
//    with a stale overlay → 'reverted'.
//  - edited .wav → 'import' with re-encoded BRR ≤ base size; same-length
//    edits flagged `sameSize` (live-splice eligible).
//  - guards: oversized edit rejected with the byte budget in the message;
//    non-PCM16 rejected; loop-offset-past-end warning fires.
//  - parseSampleDirLoopOffsets against the real committed wrapper asm
//    (Global: 24 entries, first +$0012) and the engine file (TitleScreen
//    directory reachable despite the file's other blocks).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { decodeBrr } from './brr.ts';
import { parseWavPcm16, wavFromPcm16 } from './wav.ts';
import { encodeBrr } from './brr-encode.ts';
import {
  parseSampleLoopOffsets,
  planSampleImport,
  sha256Hex,
  type SampleManifest
} from './sample-import.ts';
import { FRAMEWORK_ROOT } from '../engine/dev-cart.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}
function eq<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`  ✗ ${msg}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    failures++;
  }
}

// ── scratch project ─────────────────────────────────────────────────────────
const scratch = path.join(FRAMEWORK_ROOT, '..', 'tmp', 'sample-import-test-scratch');
fs.rmSync(scratch, { recursive: true, force: true });
const baseSamplesDir = path.join(scratch, 'base');
const dirs = {
  exportSamplesDir: path.join(scratch, 'export'),
  overlaySamplesDir: path.join(scratch, 'overlay')
};
const BANK = 'TestBank';
for (const d of [baseSamplesDir, ...Object.values(dirs)]) fs.mkdirSync(path.join(d, BANK), { recursive: true });

const sine = (n: number, amp: number): Int16Array => {
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(amp * Math.sin((i / 32000) * 2 * Math.PI * 500));
  return out;
};
const base00 = encodeBrr(sine(320, 12000));
const base01 = encodeBrr(sine(320, 8000), { loop: true });
fs.writeFileSync(path.join(baseSamplesDir, BANK, '00.brr'), base00);
fs.writeFileSync(path.join(baseSamplesDir, BANK, '01.brr'), base01);

const wavOf = (brr: Uint8Array): Uint8Array => wavFromPcm16(decodeBrr(brr).pcm);
const wav00 = wavOf(base00);
const wav01 = wavOf(base01);
fs.writeFileSync(path.join(dirs.exportSamplesDir, BANK, '00.wav'), wav00);
fs.writeFileSync(path.join(dirs.exportSamplesDir, BANK, '01.wav'), wav01);

const manifest: SampleManifest = {
  version: 1,
  entries: [
    { bank: BANK, file: '00.brr', brrSha256: sha256Hex(base00), wavSha256: sha256Hex(wav00), brrBytes: base00.length, loop: false, loopOffset: null },
    { bank: BANK, file: '01.brr', brrSha256: sha256Hex(base01), wavSha256: sha256Hex(wav01), brrBytes: base01.length, loop: true, loopOffset: 0x5a }
  ]
};

console.log('=== untouched export → all unchanged ===');
{
  const plan = planSampleImport(dirs, manifest);
  eq(plan.items.map((i) => i.action), ['unchanged', 'unchanged'], 'both skipped');
  eq(plan.writes.length, 0, 'no writes');
  eq(plan.reverts.length, 0, 'no reverts');
}

console.log('\n=== edited wav → import (same size, ≤ budget) ===');
{
  const halved = sine(320, 6000);
  fs.writeFileSync(path.join(dirs.exportSamplesDir, BANK, '00.wav'), wavFromPcm16(halved));
  const plan = planSampleImport(dirs, manifest);
  const item = plan.items.find((i) => i.file === '00.brr')!;
  eq(item.action, 'import', 'edited sample imports');
  eq(item.sameSize, true, 'same PCM length → same block count');
  assert(plan.writes.length === 1 && plan.writes[0].bankRel === `${BANK}/00.brr`, 'one write planned');
  assert(plan.writes[0].bytes.length === base00.length, 'encoded size equals base');
  // The re-encode must actually carry the new content.
  const reDecoded = decodeBrr(plan.writes[0].bytes).pcm;
  assert(Math.max(...reDecoded) < 8000, 'halved amplitude survives the round trip');
}

console.log('\n=== restored wav + stale overlay → revert ===');
{
  fs.writeFileSync(path.join(dirs.exportSamplesDir, BANK, '00.wav'), wav00);
  fs.writeFileSync(path.join(dirs.overlaySamplesDir, BANK, '00.brr'), new Uint8Array(base00.length));
  const plan = planSampleImport(dirs, manifest);
  const item = plan.items.find((i) => i.file === '00.brr')!;
  eq(item.action, 'reverted', 'stale overlay reverted');
  eq(plan.reverts, [`${BANK}/00.brr`], 'revert path');
  fs.rmSync(path.join(dirs.overlaySamplesDir, BANK, '00.brr'));
}

console.log('\n=== guards ===');
{
  // Oversized: double the PCM length.
  fs.writeFileSync(path.join(dirs.exportSamplesDir, BANK, '00.wav'), wavFromPcm16(sine(640, 6000)));
  const plan = planSampleImport(dirs, manifest);
  const item = plan.items.find((i) => i.file === '00.brr')!;
  eq(item.action, 'rejected', 'oversized edit rejected');
  assert((item.message ?? '').includes(`${base00.length}-byte slot`), 'message carries the budget');
  fs.writeFileSync(path.join(dirs.exportSamplesDir, BANK, '00.wav'), wav00);
}
{
  // Loop offset past the new end: shrink 01 below 0x5A bytes of BRR (0x5A=90
  // → keep < 10 blocks = 160 samples).
  fs.writeFileSync(path.join(dirs.exportSamplesDir, BANK, '01.wav'), wavFromPcm16(sine(96, 8000)));
  const plan = planSampleImport(dirs, manifest);
  const item = plan.items.find((i) => i.file === '01.brr')!;
  eq(item.action, 'import', 'shrunken sample still imports');
  eq(item.sameSize, false, 'shrunk → not live-spliceable');
  assert(item.warnings.some((w) => w.includes('loop start')), 'loop warning fires');
  fs.writeFileSync(path.join(dirs.exportSamplesDir, BANK, '01.wav'), wav01);
}
{
  // Unparseable wav (32-bit float-ish header).
  const bad = wavFromPcm16(sine(320, 6000)); // valid, then corrupt the bit depth
  new DataView(bad.buffer).setUint16(34, 32, true);
  fs.writeFileSync(path.join(dirs.exportSamplesDir, BANK, '00.wav'), bad);
  const plan = planSampleImport(dirs, manifest);
  const item = plan.items.find((i) => i.file === '00.brr')!;
  eq(item.action, 'rejected', 'bad encoding rejected');
  assert((item.message ?? '').includes('16-bit'), 'actionable message');
  fs.writeFileSync(path.join(dirs.exportSamplesDir, BANK, '00.wav'), wav00);
}

console.log('\n=== wrapper loop-offset parse (committed asm) ===');
{
  const globalAsm = fs.readFileSync(path.join(FRAMEWORK_ROOT, 'yi', 'SPC700', 'GlobalSampleBank.asm'), 'utf8');
  const offsets = parseSampleLoopOffsets(globalAsm);
  eq(offsets.size, 24, 'Global: 24 samples mapped');
  eq(offsets.get('00.brr'), 0x12, 'Global 00.brr loop offset');
  eq(offsets.get('01.brr'), 0x1569, 'Global 01.brr loop offset');
  // Bowser: $FFFF placeholders + duplicate directory entries — the label
  // join must still land one offset per file.
  const bowserAsm = fs.readFileSync(path.join(FRAMEWORK_ROOT, 'yi', 'SPC700', 'BowserSampleBank.asm'), 'utf8');
  const bowser = parseSampleLoopOffsets(bowserAsm);
  eq(bowser.size, 4, 'Bowser: 4 samples mapped');
  eq(bowser.get('00.brr'), 0x7bc, 'Bowser 00.brr loop offset');
  eq(bowser.get('01.brr'), 0x693, 'Bowser 01.brr (duplicated dir entry) loop offset');
  const engineAsm = fs.readFileSync(path.join(FRAMEWORK_ROOT, 'yi', 'SPC700', 'SPC700_Engine_YI.asm'), 'utf8');
  const title = parseSampleLoopOffsets(engineAsm);
  assert(title.size >= 10, `TitleScreen: directory found in the engine file (got ${title.size})`);
}

fs.rmSync(scratch, { recursive: true, force: true });

// --- build-gated: derived ARAM slices must match the extracted files --------
// bankSampleSlices drives both the composer's live-splice addressing and the
// budget math; if its directory-derived boundaries drift from what extract
// sliced to disk, imports would land at wrong ARAM addresses.
try {
  const { loadDevCart } = await import('../engine/dev-cart.ts');
  const { readAudioCatalog, bankSampleSlices, SPC_BLOCK_SAMPLE_DIRS } = await import('./catalog.ts');
  const { rom, symbols } = loadDevCart();
  const catalog = readAudioCatalog(rom, symbols);
  console.log('\n=== bankSampleSlices vs extracted files (built V1.0) ===');
  const samplesRoot = path.join(FRAMEWORK_ROOT, 'assets', 'yi', 'SPC700', 'Samples');
  let checked = 0;
  for (const [blockIdStr, bankDir] of Object.entries(SPC_BLOCK_SAMPLE_DIRS)) {
    const slices = bankSampleSlices(rom, catalog, Number(blockIdStr));
    const dir = path.join(samplesRoot, bankDir);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.brr')).sort();
    eq(slices.length, files.length, `${bankDir}: slice count matches file count`);
    for (let i = 0; i < Math.min(slices.length, files.length); i++) {
      const size = fs.statSync(path.join(dir, files[i])).size;
      assert(slices[i].file.toLowerCase() === files[i].toLowerCase(),
        `${bankDir}[${i}]: file name ${slices[i].file} vs ${files[i]}`);
      eq(slices[i].byteLength, size, `${bankDir}/${files[i]}: slice length`);
      checked++;
    }
  }
  console.log(`  ${checked} slices verified`);
  assert(checked > 50, `expected 60+ slices, saw ${checked}`);
} catch (e) {
  console.log(`\n(skip) slice checks: ${(e as Error).message.split('\n')[0]}`);
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll sample-import checks passed.');
