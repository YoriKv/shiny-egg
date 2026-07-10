// Unit test: SFX MML codec (AMY-dialect text ⇄ SFX scripts).
// Run: node snes-framework/scripts/audio/sfx-mml.test.ts
//
// Pins:
//  - Synthetic: directives, note letters/octaves, =N tick durations (sticky
//    byte ⇄ explicit suffix), v L[,R] direct DSP volume + its positional
//    rules, @N, & key-on slides, raw $XX heads ($F1 passthrough, perc bytes,
//    the post-stereo positive head), grammar errors with line numbers.
//  - (Build-gated) THE round-trip gate over the real cart: every shipped
//    SFX script formats to MML, parses back, and re-encodes BYTE-IDENTICAL
//    to the engine's original bytes — the exporter/importer contract.

import { decodeSfxScript, encodeSfxScript, resolveSfxChain } from './sfx-decode.ts';
import { formatSfxMml, parseSfxMml, compileSfxMml, SfxMmlError } from './sfx-mml.ts';
import { loadDevCart } from '../engine/dev-cart.ts';
import { readAudioCatalog, composeSettingAram } from './index.ts';

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
function throwsWith(fn: () => void, needle: string, msg: string): void {
  try {
    fn();
    assert(false, `${msg} (did not throw)`);
  } catch (e) {
    assert(e instanceof SfxMmlError && e.message.includes(needle), `${msg} (threw "${(e as Error).message}")`);
  }
}

console.log('=== directives + basics ===');
{
  const p = parseSfxMml('#sfx 0x2D\n#priority $58\n#chain 0x2E\no4 c=6 d ^ r=2\n');
  eq(p.soundId, 0x2d, '#sfx parsed');
  eq(p.priority, 0x58, '#priority parsed');
  eq(p.chain, 0x2e, '#chain parsed');
  eq(p.events, [
    { kind: 'duration', ticks: 6 },
    { kind: 'note', note: 0xa4 },
    { kind: 'note', note: 0xa6 },
    { kind: 'tie' },
    { kind: 'duration', ticks: 2 },
    { kind: 'rest' },
  ], 'bare note reuses the sticky duration (no duration byte)');

  const min = parseSfxMml('#sfx 1\nc=4');
  eq(min.priority, null, 'absent #priority stays null');
  eq(min.chain, null, 'absent #chain stays null');
  throwsWith(() => parseSfxMml('c=4'), 'missing #sfx', '#sfx directive required');
}

console.log('=== volume, instrument, slides, raw heads ===');
{
  const p = parseSfxMml('#sfx 2\nv96 c=6 v80,32 o4 d=3 @12=2 $F1 $03 $0A $A6 c=6&$A8,3,10 $CD=4');
  eq(p.events, [
    { kind: 'duration', ticks: 6 },
    { kind: 'volume', left: 96, right: 96, mono: true },
    { kind: 'note', note: 0xa4 },
    { kind: 'duration', ticks: 3 },
    { kind: 'volume', left: 80, right: 32, mono: false },
    { kind: 'note', note: 0xa6 },
    { kind: 'duration', ticks: 2 },
    { kind: 'instrument', index: 12 },
    { kind: 'slide', delay: 3, ticks: 10, note: 0xa6 },
    { kind: 'duration', ticks: 6 },
    { kind: 'keyOnSlide', note: 0xa4, delay: 3, ticks: 10, target: 0xa8 },
    { kind: 'duration', ticks: 4 },
    { kind: 'note', note: 0xcd },
  ], 'volume/instrument/slide/raw event stream');
  // Letter slide target uses the current octave.
  const s = parseSfxMml('#sfx 3\no4 c=6&e,0,12');
  eq(s.events[1], { kind: 'keyOnSlide', note: 0xa4, delay: 0, ticks: 12, target: 0xa8 }, 'letter slide target');

  throwsWith(() => parseSfxMml('#sfx 4\nv96 c'), 'explicit =N', 'volume without a duration rejected');
  throwsWith(() => parseSfxMml('#sfx 4\nv96 v80 c=2'), 'two v commands', 'stacked volumes rejected');
  throwsWith(() => parseSfxMml('#sfx 4\nv300 c=2'), 'out of range', 'volume > 127 rejected');
  throwsWith(() => parseSfxMml('#sfx 4\n@300 c=2'), 'byte range', 'instrument index > 255 rejected');
  throwsWith(() => parseSfxMml('#sfx 4\n$00'), 'terminator', 'explicit $00 rejected');
  throwsWith(() => parseSfxMml('#sfx 4\nv96'), 'no note to carry', 'trailing volume rejected');
}

console.log('=== compile validation (encodeSfxScript rules) ===');
{
  const ok = compileSfxMml('#sfx 5\nv96,80 $23=6');
  eq([...ok.bytes], [6, 96, 80, 0x23, 0], 'post-stereo positive head encodes');
  // Positive head after a MONO volume violates the byte grammar — the
  // parser passes it through and the encoder rejects it.
  let threw = false;
  try { compileSfxMml('#sfx 5\nv96 $23=6'); } catch { threw = true; }
  assert(threw, 'positive head after mono volume rejected at encode');
}

console.log('=== format ⇄ parse round-trip (synthetic) ===');
{
  const bytes = new Uint8Array([
    6, 96, 80, 0x23,          // dur, stereo vol, positive head
    0xe0, 0x0c,               // instrument
    3, 0x70, 0xa4,            // dur, mono vol, note
    0xa6,                     // sticky-duration note
    0xf1, 3, 10, 0xa6,        // slide
    4, 0xf9, 0xa4, 0, 12, 0xa8, // dur + key-on slide
    0xc8, 2, 0xc9,            // tie, dur+rest
    0xcd,                     // perc-style switch
    0,
  ]);
  const d = decodeSfxScript(bytes, 0);
  const text = formatSfxMml(d.events, { soundId: 0x2d, priority: 0x58, chain: 0, name: 'synthetic' });
  const p = parseSfxMml(text);
  eq([...encodeSfxScript(p.events)], [...bytes], 'format→parse→encode reproduces the bytes');
  eq(p.soundId, 0x2d, 'round-tripped sound id');
  eq(p.priority, 0x58, 'round-tripped priority');
}

// --- build-gated: every shipped SFX round-trips through MML ------------------
try {
  const { rom, symbols } = loadDevCart();
  const catalog = readAudioCatalog(rom, symbols);
  const { aram } = composeSettingAram(rom, catalog, 0x12);
  console.log('\n=== MML round-trip over all shipped SFX (built V1.0) ===');
  const seen = new Set<number>();
  let scripts = 0;
  let bytesTotal = 0;
  for (let id = 0x01; id <= 0xa2; id++) {
    for (const entry of resolveSfxChain(aram, id)) {
      if (entry.scriptAddr === 0 || seen.has(entry.scriptAddr)) continue;
      seen.add(entry.scriptAddr);
      const d = decodeSfxScript(aram, entry.scriptAddr);
      const original = aram.subarray(entry.scriptAddr, entry.scriptAddr + d.byteLength);
      const text = formatSfxMml(d.events, {
        soundId: entry.soundId,
        priority: entry.priority,
        chain: aram[0x3eba + entry.soundId],
      });
      let re: Uint8Array;
      try {
        re = encodeSfxScript(parseSfxMml(text).events);
      } catch (e) {
        assert(false, `script @0x${entry.scriptAddr.toString(16)} (sound 0x${id.toString(16)}): ${(e as Error).message}\n--- MML ---\n${text}`);
        continue;
      }
      let same = re.length === original.length;
      if (same) for (let i = 0; i < re.length; i++) if (re[i] !== original[i]) { same = false; break; }
      assert(same, `script @0x${entry.scriptAddr.toString(16)} (sound 0x${id.toString(16)}): MML round-trip differs\n--- MML ---\n${text}`);
      scripts++;
      bytesTotal += d.byteLength;
    }
  }
  console.log(`  ${scripts} unique scripts (${bytesTotal} bytes) round-trip byte-identical through MML`);
  assert(scripts > 80, `expected 100+ unique scripts, saw ${scripts}`);
} catch (e) {
  if ((e as Error).message.includes('Missing build artifact')) {
    console.log(`\n(skip) MML sweep: ${(e as Error).message.split('\n')[0]}`);
  } else {
    console.error(`  ✗ MML sweep threw: ${(e as Error).message}`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log('\nAll sfx-mml checks passed.');
