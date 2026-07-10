// Unit test: SFX script codec + chain resolution.
// Run: node snes-framework/scripts/audio/sfx-decode.test.ts
//
// Pins:
//  - Synthetic grammar: duration/volume prefixes (stereo + mono), the three
//    opcodes, tie/rest, encode validation, byte identity.
//  - (Build-gated) THE identity gate over the real cart: every named sound
//    id (0x01-0xA2) resolves its remap chain against the engine+global
//    baseline; every reachable script decodes and re-encodes byte-identical;
//    every script pointer lands in the engine's SFX data region; every
//    assigned voice is 1-7 (never the reserved voice 8). Reports chain and
//    stream counts + multi-voice SFX found via remap chains.

import { decodeSfxScript, encodeSfxScript, resolveSfxChain, buildSfxTimeline } from './sfx-decode.ts';
import { loadDevCart } from '../engine/dev-cart.ts';
import { readAudioCatalog } from './catalog.ts';
import { composeSettingAram } from './aram.ts';

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

console.log('=== synthetic grammar ===');
{
  const bytes = new Uint8Array([
    0x0a, 0x40, 0x30, 0x8c, // dur 10, volL 0x40, volR 0x30, note
    0x05, 0x20, 0x90,       // dur 5, mono vol 0x20, note
    0xe0, 0x03,             // instrument 3
    0xc8, 0xc9,             // tie, rest
    0xf1, 0x02, 0x08, 0x95, // slide
    0xf9, 0x8e, 0x01, 0x04, 0x99, // key-on slide
    0x00
  ]);
  const aram = new Uint8Array(0x10000);
  aram.set(bytes, 0x1200);
  const d = decodeSfxScript(aram, 0x1200);
  eq(d.byteLength, bytes.length, 'consumes exactly the stream');
  eq(d.events[0], { kind: 'duration', ticks: 10 }, 'duration');
  eq(d.events[1], { kind: 'volume', left: 0x40, right: 0x30, mono: false }, 'stereo volume');
  eq(d.events[4], { kind: 'volume', left: 0x20, right: 0x20, mono: true }, 'mono volume');
  eq(d.events[6], { kind: 'instrument', index: 3 }, 'instrument opcode');
  eq(d.events[9], { kind: 'slide', delay: 2, ticks: 8, note: 0x95 }, 'slide opcode');
  eq(d.events[10], { kind: 'keyOnSlide', note: 0x8e, delay: 1, ticks: 4, target: 0x99 }, 'key-on slide');
  eq([...encodeSfxScript(d.events)], [...bytes], 'decode→encode byte identity (synthetic)');

  let threw = false;
  try { encodeSfxScript([{ kind: 'volume', left: 8, right: 8, mono: true }]) } catch { threw = true }
  assert(threw, 'volume without duration rejected');
}
{
  // Regression (the Unpause/0xB1 truncation bug): $00 terminates ONLY in
  // step-head position — after a duration it's a volume-ZERO write, and the
  // post-stereo head byte is consumed with no sign check.
  const bytes = new Uint8Array([
    0x08, 0x00, 0xb0,       // dur 8, MONO VOLUME 0, note (the silent prime)
    0x10, 0x00, 0x28, 0x10, // dur 16, stereo vol 0/0x28, POSITIVE head-as-note
    0x30, 0x8c,             // dur 48, note
    0x00
  ]);
  const aram = new Uint8Array(0x10000);
  aram.set(bytes, 0x1300);
  const d = decodeSfxScript(aram, 0x1300);
  eq(d.byteLength, bytes.length, 'volume-zero does not terminate the script');
  eq(d.events[1], { kind: 'volume', left: 0, right: 0, mono: true }, 'zero mono volume');
  eq(d.events[4], { kind: 'volume', left: 0, right: 0x28, mono: false }, 'zero stereo volL');
  eq(d.events[5], { kind: 'note', note: 0x10 }, 'positive head after stereo volume is a note');
  eq([...encodeSfxScript(d.events)], [...bytes], 'regression round-trip identity');

  let threw = false;
  try {
    encodeSfxScript([
      { kind: 'duration', ticks: 8 },
      { kind: 'volume', left: 0, right: 0, mono: true },
      { kind: 'note', note: 0x10 }
    ]);
  } catch { threw = true }
  assert(threw, 'positive head after MONO volume rejected (would re-parse as stereo)');
}

// --- build-gated: every shipped SFX ------------------------------------------
try {
  const { rom, symbols } = loadDevCart();
  const catalog = readAudioCatalog(rom, symbols);
  // SFX resolve against the engine + global bank (the SFX preview baseline);
  // any setting works since the engine block carries all SFX data — use the
  // Map setting's composition for a fully-populated ARAM.
  const { aram } = composeSettingAram(rom, catalog, 0x12);
  console.log('\n=== identity over all shipped SFX (built V1.0) ===');
  const seenScripts = new Map<number, number>(); // addr → byteLength
  let chains = 0;
  let multiVoice = 0;
  for (let id = 0x01; id <= 0xa2; id++) {
    const chain = resolveSfxChain(aram, id);
    assert(chain.length >= 1, `sound 0x${id.toString(16)}: empty chain`);
    chains++;
    if (chain.length > 1) multiVoice++;
    for (const entry of chain) {
      assert(entry.voice >= 0 && entry.voice <= 6,
        `sound 0x${id.toString(16)}: voice ${entry.voice} outside SFX range 0-6`);
      if (entry.scriptAddr === 0) continue;
      assert(entry.scriptAddr >= 0x0eb0 && entry.scriptAddr < 0x1f00,
        `sound 0x${id.toString(16)}: script 0x${entry.scriptAddr.toString(16)} outside the engine SFX region`);
      if (seenScripts.has(entry.scriptAddr)) continue;
      const d = decodeSfxScript(aram, entry.scriptAddr);
      const re = encodeSfxScript(d.events);
      const original = aram.subarray(entry.scriptAddr, entry.scriptAddr + d.byteLength);
      let same = re.length === original.length;
      if (same) for (let i = 0; i < re.length; i++) if (re[i] !== original[i]) { same = false; break }
      assert(same, `script @0x${entry.scriptAddr.toString(16)} (sound 0x${id.toString(16)}): re-encode differs`);
      seenScripts.set(entry.scriptAddr, d.byteLength);
    }
    // Timeline must build for every id without throwing.
    const tl = buildSfxTimeline(aram, id);
    assert(tl.totalTicks >= 0, `sound 0x${id.toString(16)}: timeline`);
  }
  const bytes = [...seenScripts.values()].reduce((a, b) => a + b, 0);
  console.log(`  ${chains} sound ids, ${multiVoice} multi-voice chains, ${seenScripts.size} unique scripts (${bytes} bytes) byte-identical`);
  assert(seenScripts.size > 80, `expected 100+ unique scripts, saw ${seenScripts.size}`);
} catch (e) {
  if ((e as Error).message.includes('Missing build artifact')) {
    console.log(`\n(skip) SFX sweep: ${(e as Error).message.split('\n')[0]}`);
  } else {
    console.error(`  ✗ SFX sweep threw: ${(e as Error).message}`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll sfx-decode checks passed.');
