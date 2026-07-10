// Unit test: N-SPC track encoder round-trip identity.
// Run: node snes-framework/scripts/audio/sequence-encode.test.ts
//
// Pins:
//  - Synthetic grammar: every event kind serializes to the expected bytes;
//    the positive-note-after-len+qv quirk is preserved; illegal streams
//    (bare positive note, wrong vcmd arity, out-of-range values) throw.
//  - (Build-gated) THE identity gate for the future sequence editor:
//    encode(decode(track)) is byte-identical to the original ARAM slice for
//    every track and subroutine of every song in every music-set baseline
//    (44 songs, several hundred deduped tracks).

import { decodeTrack, decodeSong } from './sequence.ts';
import { encodeTrack } from './sequence-encode.ts';
import { loadDevCart } from '../engine/dev-cart.ts';
import { readAudioCatalog, representativeSettingByRow } from './catalog.ts';
import { composeSettingAram } from './aram.ts';
import { songSlotsOfSetting } from './spc.ts';

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
const throws = (fn: () => void, msg: string): void => {
  let threw = false;
  try { fn() } catch { threw = true }
  assert(threw, msg);
};

console.log('=== synthetic grammar ===');
{
  const bytes = new Uint8Array([
    0x18, 0x8c,             // len, note
    0x0c, 0x7f, 0x10,       // len + qv, positive byte in note position
    0xc8, 0xc9, 0xcc,       // tie, rest, perc 2
    0xe0, 0x05,             // setInstrument 5
    0xe4,                   // vibratoOff
    0xef, 0x00, 0x30, 0x02, // subroutine
    0x00
  ]);
  const aram = new Uint8Array(0x10000);
  aram.set(bytes, 0x2000);
  aram.set([0x00], 0x3000);
  const track = decodeTrack(aram, 0x2000);
  eq([...encodeTrack(track.events)], [...bytes], 'decode→encode byte identity (synthetic)');
}
{
  throws(() => encodeTrack([{ kind: 'note', note: 0x10 }]), 'bare positive note rejected');
  throws(() => encodeTrack([{ kind: 'vcmd', op: 0xe0, name: 'setInstrument', args: [] }]), 'wrong vcmd arity rejected');
  throws(() => encodeTrack([{ kind: 'length', ticks: 0 }]), 'zero length rejected');
  throws(() => encodeTrack([{ kind: 'length', ticks: 12, gate: 9, velocity: 0 }]), 'gate range enforced');
  // Legal: positive note directly after len+qv.
  const ok = encodeTrack([
    { kind: 'length', ticks: 12, gate: 7, velocity: 15 },
    { kind: 'note', note: 0x10 }
  ]);
  eq([...ok], [12, 0x7f, 0x10, 0x00], 'len+qv positive-note quirk encodes');
}

// --- build-gated: identity over every shipped track --------------------------
try {
  const { rom, symbols } = loadDevCart();
  const catalog = readAudioCatalog(rom, symbols);
  console.log('\n=== identity over all shipped tracks (built V1.0) ===');
  const rowRep = representativeSettingByRow(catalog);
  let tracks = 0;
  let bytes = 0;
  for (const [, setting] of rowRep) {
    const { aram } = composeSettingAram(rom, catalog, setting);
    for (const [, ptr] of songSlotsOfSetting(rom, catalog, setting)) {
      const song = decodeSong(aram, ptr);
      for (const track of song.tracks.values()) {
        const original = aram.subarray(track.addr, track.addr + track.byteLength);
        const encoded = encodeTrack(track.events);
        let same = encoded.length === original.length;
        if (same) {
          for (let i = 0; i < encoded.length; i++) {
            if (encoded[i] !== original[i]) { same = false; break }
          }
        }
        assert(same, `track @0x${track.addr.toString(16)} (setting 0x${setting.toString(16)}): re-encode differs`);
        tracks++;
        bytes += track.byteLength;
      }
    }
  }
  console.log(`  ${tracks} tracks re-encoded byte-identical (${bytes} bytes)`);
  assert(tracks > 300, `expected several hundred tracks, saw ${tracks}`);
} catch (e) {
  if ((e as Error).message.includes('Missing build artifact')) {
    console.log(`\n(skip) identity sweep: ${(e as Error).message.split('\n')[0]}`);
  } else {
    console.error(`  ✗ identity sweep threw: ${(e as Error).message}`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll sequence-encode checks passed.');
