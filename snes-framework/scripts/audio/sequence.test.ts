// Unit test: N-SPC sequence decoder.
// Run: node snes-framework/scripts/audio/sequence.test.ts
//
// Pins:
//  - Pure grammar: a hand-built track stream exercising every event class
//    (length, length+quantize/velocity, note, tie, rest, percussion, vcmds
//    with 0-3 args, subroutine collection, terminator) decodes to the exact
//    expected events. Runs everywhere, no cart needed.
//  - (Build-gated) The full-ROM decode sweep: 44 songs across the 13
//    music-set baselines, zero failures, with exact part/pattern/track/event
//    counts pinned for four structurally diverse songs (title, a level song,
//    a jingle-table module song, the biggest song in the game). Any codec
//    change that shifts these counts must be understood before re-pinning.

import { decodeTrack, decodeSong, VCMDS } from './sequence.ts';
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

console.log('=== vcmd table ===');
eq(VCMDS.length, 27, '27 vcmds ($E0-$FA)');
eq(VCMDS.map((v) => v.argCount),
  [1, 1, 2, 3, 0, 1, 2, 1, 2, 1, 1, 3, 0, 1, 2, 3, 1, 3, 3, 0, 1, 3, 0, 3, 3, 3, 1],
  'arg counts match DATA_seq_voice_opcode_arg_counts');

console.log('\n=== track grammar (synthetic) ===');
{
  const aram = new Uint8Array(0x10000);
  const stream = [
    0x18,             // length 24 (no qv: next byte is negative)
    0x8c,             // note
    0x0c, 0x7f,       // length 12 + qv (gate 7, velocity 15)
    0x90,             // note
    0xc8,             // tie
    0xc9,             // rest
    0xcc,             // percussion index 2
    0xe0, 0x05,       // setInstrument 5
    0xe4,             // vibratoOff (0 args)
    0xef, 0x00, 0x30, 0x02, // subroutine $3000 ×2
    0xe7, 0x20,       // tempo $20
    0x00,             // end
  ];
  aram.set(stream, 0x2000);
  aram.set([0x0c, 0x8e, 0x00], 0x3000); // subroutine body: len, note, end
  const t = decodeTrack(aram, 0x2000);
  eq(t.byteLength, stream.length, 'byteLength includes terminator');
  eq(t.subroutineAddrs, [0x3000], 'subroutine target collected');
  eq(t.events, [
    { kind: 'length', ticks: 0x18 },
    { kind: 'note', note: 0x8c },
    { kind: 'length', ticks: 0x0c, gate: 7, velocity: 15 },
    { kind: 'note', note: 0x90 },
    { kind: 'tie' },
    { kind: 'rest' },
    { kind: 'perc', index: 2 },
    { kind: 'vcmd', op: 0xe0, name: 'setInstrument', args: [5] },
    { kind: 'vcmd', op: 0xe4, name: 'vibratoOff', args: [] },
    { kind: 'vcmd', op: 0xef, name: 'subroutine', args: [0x00, 0x30, 0x02] },
    { kind: 'vcmd', op: 0xe7, name: 'tempo', args: [0x20] },
  ], 'event stream decodes exactly');

  // Song walk: pattern → loop → end, with a silent voice.
  const song = 0x5000;
  const pattern = 0x5100;
  aram.set([0x00, 0x51, /*loop:*/ 0x02, 0x00, 0x00, 0x50, /*end:*/ 0x00, 0x00], song);
  const trackPtrs = new Uint8Array(16);
  trackPtrs.set([0x00, 0x20], 0); // voice 1 → $2000, rest silent
  aram.set(trackPtrs, pattern);
  const s = decodeSong(aram, song);
  eq(s.parts, [
    { kind: 'pattern', addr: pattern },
    { kind: 'loop', count: 2, target: song },
    { kind: 'end' },
  ], 'song walk: pattern, loop control, end');
  eq(s.patterns.get(pattern)?.trackAddrs, [0x2000, 0, 0, 0, 0, 0, 0, 0], '8 track pointers');
  assert(s.tracks.has(0x2000) && s.tracks.has(0x3000), 'top-level + subroutine tracks decoded');
  assert(s.subroutineAddrs.has(0x3000) && !s.subroutineAddrs.has(0x2000), 'subroutine classified');
}

// --- Build-gated: full-ROM sweep with pinned counts -----------------------
try {
  const { rom, symbols } = loadDevCart();
  const catalog = readAudioCatalog(rom, symbols);
  console.log('\n=== full-ROM decode sweep (built V1.0) ===');

  const rowRep = representativeSettingByRow(catalog);

  const stats = new Map<string, { parts: number; patterns: number; tracks: number; subs: number; events: number }>();
  let songs = 0;
  for (const [row, setting] of rowRep) {
    const { aram } = composeSettingAram(rom, catalog, setting);
    for (const [slot, ptr] of songSlotsOfSetting(rom, catalog, setting)) {
      songs++;
      const song = decodeSong(aram, ptr); // throws on any decode failure
      let events = 0;
      for (const t of song.tracks.values()) events += t.events.length;
      stats.set(`${row}:${slot}`, {
        parts: song.parts.length, patterns: song.patterns.size,
        tracks: song.tracks.size, subs: song.subroutineAddrs.size, events,
      });
    }
  }
  eq(songs, 44, '44 songs across the 13 baselines');
  eq(stats.get('0:1'), { parts: 14, patterns: 9, tracks: 67, subs: 16, events: 2560 }, 'title song 0x01');
  eq(stats.get('3:1'), { parts: 13, patterns: 8, tracks: 65, subs: 16, events: 3814 }, 'Flower Garden song 0x01');
  eq(stats.get('2:6'), { parts: 7, patterns: 5, tracks: 43, subs: 4, events: 4468 }, 'map module song 0x06');
  eq(stats.get('12:1'), { parts: 8, patterns: 7, tracks: 73, subs: 18, events: 10795 }, 'Ending song 0x01 (largest)');
} catch (e) {
  if (failures === 0 && (e as Error).message.includes('Missing build artifact')) {
    console.log(`\n(skip) full-ROM sweep: ${(e as Error).message.split('\n')[0]}`);
  } else {
    console.error(`  ✗ full-ROM sweep threw: ${(e as Error).message}`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll sequence-decoder checks passed.');
