// Unit test for the import gate's DECODED-level plausibility check
// (`implausibleLevelHeader`). Cart-free — runs anywhere. Pins the gate against
// BOTH failure directions: a real vanilla-shaped header must pass (too-strict
// regression), and the garbage signatures of an abandoned/clobbered record slot
// must be rejected (too-loose regression — the silent ROM-import corruption this
// gate exists to stop). See import/anchors.ts + analyze.ts.
// Run: node snes-framework/scripts/import/anchors.test.ts

import { implausibleLevelHeader } from './anchors.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

// A representative real vanilla header (record 0x05's, inside the envelope) with
// sane counts — must pass (returns null).
console.log('=== a real vanilla-shaped level passes ===');
{
  const header = [25, 12, 9, 29, 27, 27, 19, 110, 0, 5, 11, 0, 6, 0, 0];
  assert(implausibleLevelHeader(header, 125, 48) === null, 'vanilla header + counts ⇒ plausible');
  // Edge: a field sitting exactly AT its vanilla maximum is still in-envelope.
  const atMax = [31, 15, 29, 31, 49, 46, 53, 127, 15, 15, 17, 27, 20, 13, 3];
  assert(implausibleLevelHeader(atMax, 447, 98) === null, 'every field at its vanilla max ⇒ still plausible');
  // A legitimately large hacked level (above vanilla, below the caps) passes.
  assert(implausibleLevelHeader(header, 500, 150) === null, 'large-but-bounded counts ⇒ plausible');
}

// The real reported corruption: bad ROM import of record 0x05 decoded to this
// garbage header (field 2 = 31 > 29, field 10 = 53 > 17) with 271 obj / 256 spr.
console.log('=== the reported corrupt 0x05 import is rejected ===');
{
  const corrupt = [31, 15, 31, 28, 38, 17, 36, 3, 0, 17, 53, 16, 11, 1, 2];
  const why = implausibleLevelHeader(corrupt, 271, 256);
  assert(why !== null, 'corrupt 0x05 header ⇒ implausible');
  assert(/field 2 /.test(why ?? ''), `reason names the first out-of-range field (got: ${why})`);
}

console.log('=== garbage signatures are rejected ===');
{
  const ENV = [31, 15, 29, 31, 49, 46, 53, 127, 15, 15, 17, 27, 20, 13, 3];
  // All-0xFF region → every field at its bit-width max; field 2 (max 31 > env 29)
  // is over the envelope.
  const allMax = [31, 15, 31, 31, 63, 63, 63, 127, 15, 31, 63, 31, 31, 15, 3];
  assert(implausibleLevelHeader(allMax, 0, 0) !== null, 'all-bits-set header ⇒ implausible');
  // A single out-of-range field is enough.
  const oneOver = [...ENV];
  oneOver[10] = ENV[10] + 1;
  assert(implausibleLevelHeader(oneOver, 100, 50) !== null, 'one field over the envelope ⇒ implausible');
  // Sane header but absurd counts (over-read past the real terminators).
  assert(implausibleLevelHeader(ENV, 0, 50) !== null, 'zero objects ⇒ implausible');
  assert(implausibleLevelHeader(ENV, 5000, 50) !== null, 'absurd object count ⇒ implausible');
  assert(implausibleLevelHeader(ENV, 100, 5000) !== null, 'absurd sprite count ⇒ implausible');
  // A truncated/empty header (decode produced fewer than 15 fields).
  assert(implausibleLevelHeader([], 10, 0) !== null, 'short header ⇒ implausible');
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all anchors gate tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
