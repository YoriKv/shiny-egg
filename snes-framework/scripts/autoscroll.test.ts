// Unit test: autoscroll table codec (autoscroll.ts).
// Run: node snes-framework/scripts/autoscroll.test.ts

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FRAMEWORK_ROOT } from './engine/dev-cart.ts';
import {
  AUTOSCROLL_BANK_FILE,
  AUTOSCROLL_VALUES_SIZE,
  autoscrollBytes,
  autoscrollBytesUsed,
  decodeAutoscroll,
  parseAutoscroll,
  serializeAutoscroll,
  validateAutoscroll,
} from './autoscroll.ts';

let failures = 0;
const assert = (condition: boolean, message: string): void => {
  if (!condition) { console.error(`  ✗ ${message}`); failures++; }
};
const eq = (actual: unknown, expected: unknown, message: string): void =>
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message} (got ${JSON.stringify(actual)})`);

const source = readFileSync(path.join(FRAMEWORK_ROOT, AUTOSCROLL_BANK_FILE), 'utf8');
const model = parseAutoscroll(source);

console.log('=== vanilla layout ===');
eq(model.sequences.length, 10, '10 sequences');
eq(model.sequences.map((s) => s.checkpoints.length), [4, 16, 27, 10, 4, 17, 2, 18, 3, 21], 'sequence lengths');
eq(model.sequences.map((s) => s.end), [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe, 0xfe, 0xff, 0xff], 'end commands');
eq(model.tracks.map((t) => t.sequence), [0, 1, 1, 2, 4, 2, 3, 5, 6, 7, 8, 9], 'every track\'s sequence');
eq(model.tracks[0], { sequence: 0, checkpoint: 0 }, '$1CA starts sequence 0');
eq(model.tracks[1], { sequence: 1, checkpoint: 0 }, '$1CB starts sequence 1');
eq(model.tracks[2], { sequence: 1, checkpoint: 9 }, '$1CC shares $1CB\'s sequence (midway ring)');
eq(model.tracks[3], { sequence: 2, checkpoint: 26 }, '$1CD is the tail of $1CF\'s sequence');
eq(model.tracks[5], { sequence: 2, checkpoint: 0 }, '$1CF starts sequence 2');
eq(model.sequences[0]!.checkpoints[0], { x: 0x20, y: 0x00, speed: 0x04 }, 'first checkpoint');
eq(autoscrollBytesUsed(model.sequences), AUTOSCROLL_VALUES_SIZE, 'vanilla fills the stream exactly');
eq(validateAutoscroll(model), null, 'vanilla validates');

console.log('=== unchanged serialization ===');
{
  const r = serializeAutoscroll(source, model);
  assert(r.ok && r.text === source, 'unchanged save is byte-identical');
}

console.log('=== edit + round trip ===');
{
  const edited = structuredClone(model);
  edited.sequences[0]!.checkpoints[1]!.speed = 0x10;
  const r = serializeAutoscroll(source, edited);
  assert(r.ok, 'speed edit serializes');
  if (r.ok) {
    eq(parseAutoscroll(r.text), edited, 'speed edit round-trips');
    const changed = r.text.split('\n').filter((l, i) => l !== source.split('\n')[i]);
    eq(changed.length, 1, 'only one line changes');
  }
}

console.log('=== shrink pads with $FF; offsets follow ===');
{
  const edited = structuredClone(model);
  edited.sequences[0]!.checkpoints.splice(1, 2); // -6 bytes, shifts every later track
  const { indices, values } = autoscrollBytes(edited);
  eq(values.length, AUTOSCROLL_VALUES_SIZE, 'stream stays 376 bytes');
  eq(values.slice(-6), [0xff, 0xff, 0xff, 0xff, 0xff, 0xff], 'tail padded with $FF');
  eq(indices[1], 0x0d - 6, '$1CB offset shifted');
  const r = serializeAutoscroll(source, edited);
  assert(r.ok, 'shrunk model serializes');
  if (r.ok) eq(parseAutoscroll(r.text), edited, 'padding is dropped on re-parse');
}

console.log('=== guards ===');
{
  const over = structuredClone(model);
  over.sequences[0]!.checkpoints.push({ x: 1, y: 1, speed: 1 });
  assert(validateAutoscroll(over)?.includes('379 of 376') ?? false, 'over budget is refused');
  assert(!serializeAutoscroll(source, over).ok, 'over budget does not serialize');

  const fe = structuredClone(model);
  fe.sequences[0]!.checkpoints[0]!.x = 0xfe;
  assert(validateAutoscroll(fe) !== null, 'X $FE is refused (reads as end command)');

  const badStart = structuredClone(model);
  badStart.tracks[0] = { sequence: 0, checkpoint: 99 };
  assert(validateAutoscroll(badStart) !== null, 'track past its sequence is refused');

  let threw = false;
  try { decodeAutoscroll([1, ...Array(11).fill(0)], [0x10, 0x10, 0x04, 0xff]); } catch { threw = true; }
  assert(threw, 'mid-record track offset is refused at decode');
}

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\n✓ all autoscroll checks pass');
