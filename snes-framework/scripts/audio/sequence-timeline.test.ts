// Unit test: song timeline expansion.
// Run: node snes-framework/scripts/audio/sequence-timeline.test.ts
//
// Pins:
//  - Synthetic song: note timing, tie extension, rest gaps, subroutine
//    inlining with repeat count, pattern resync, loop-part mapping.
//  - (Build-gated) all 44 shipped songs expand without throwing; sane
//    structural invariants (positive span, notes on used voices, bounded
//    warnings); Flower Garden's expanded stats sanity-checked.

import { decodeSong } from './sequence.ts';
import { buildSongTimeline } from './sequence-timeline.ts';
import { loadDevCart } from '../engine/dev-cart.ts';
import { readAudioCatalog, representativeSettingByRow, songDisplayName } from './catalog.ts';
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

console.log('=== synthetic timeline ===');
{
  const aram = new Uint8Array(0x10000);
  // Song at $5000: pattern $5100, loop ×2 back to part 0, end.
  aram.set([0x00, 0x51, 0x02, 0x00, 0x00, 0x50, 0x00, 0x00], 0x5000);
  // Pattern: voice 1 → $2000, voice 2 → $2100.
  const pat = new Uint8Array(16);
  pat.set([0x00, 0x20, 0x00, 0x21], 0);
  aram.set(pat, 0x5100);
  // Voice 1: len 10 + note, tie 10, rest 10, note 10 = 40 ticks.
  aram.set([0x0a, 0x8c, 0xc8, 0xc9, 0x90, 0x00], 0x2000);
  // Voice 2: len 5 + note, subroutine ×3 (len 5 + note each), rest 20 = 40.
  aram.set([0x05, 0x8e, 0xef, 0x00, 0x30, 0x03, 0x14, 0xc9, 0x00], 0x2100);
  aram.set([0x05, 0x92, 0x00], 0x3000);

  const song = decodeSong(aram, 0x5000);
  const tl = buildSongTimeline(song);
  eq(tl.totalTicks, 40, 'pattern span');
  eq(tl.patterns.length, 1, 'one pattern');
  eq(tl.loop, { targetPartIndex: 0, count: 2 }, 'loop mapped to part 0');
  const v1 = tl.voices[0];
  eq(v1.notes.length, 2, 'voice 1: two notes (tie merged)');
  eq(v1.notes[0], { startTick: 0, ticks: 20, note: 0x8c, kind: 'note' }, 'tie extends note to 20 ticks');
  eq(v1.notes[1].startTick, 30, 'rest gap before second note');
  const v2 = tl.voices[1];
  eq(v2.notes.length, 4, 'voice 2: intro note + 3 subroutine repeats');
  eq(v2.notes.map((n) => n.startTick), [0, 5, 10, 15], 'subroutine repeats laid out in time');
  eq(v2.vcmds.filter((c) => c.op === 0xef).length, 1, 'subroutine call recorded once');
  assert(tl.voices[2].used === false, 'voice 3 unused');
  eq(tl.warnings, [], 'no warnings on clean data');
  assert(tl.seconds > 0, 'seconds computed');
  // No $E7 in the synthetic song → one segment at the driver default tempo.
  eq(tl.tempoSegments, [{ tick: 0, seconds: 0, ticksPerSecond: 31.25 }], 'default tempo segment');
}

// --- build-gated: all shipped songs ------------------------------------------
try {
  const { rom, symbols } = loadDevCart();
  const catalog = readAudioCatalog(rom, symbols);
  console.log('\n=== expand all shipped songs (built V1.0) ===');
  const rowRep = representativeSettingByRow(catalog);
  let songs = 0;
  let totalWarnings = 0;
  for (const [row, setting] of [...rowRep.entries()].sort((a, b) => a[0] - b[0])) {
    const { aram } = composeSettingAram(rom, catalog, setting);
    for (const [slot, ptr] of [...songSlotsOfSetting(rom, catalog, setting).entries()].sort((a, b) => a[0] - b[0])) {
      const tl = buildSongTimeline(decodeSong(aram, ptr));
      songs++;
      totalWarnings += tl.warnings.length;
      assert(tl.totalTicks > 0, `${songDisplayName(row, slot)}: zero-length timeline`);
      const noteCount = tl.voices.reduce((n, v) => n + v.notes.length, 0);
      assert(noteCount > 0, `${songDisplayName(row, slot)}: no notes`);
      for (const w of tl.warnings) {
        console.log(`  (warn) row ${row} ${songDisplayName(row, slot)}: ${w}`);
      }
    }
  }
  console.log(`  ${songs} songs expanded, ${totalWarnings} warnings`);
  eq(songs, 44, '44 songs');
  assert(totalWarnings < 20, `warning count ${totalWarnings} unexpectedly high`);

  // Flower Garden sanity: a real level song should be minutes-scale with
  // melodic content on most voices.
  const fg = buildSongTimeline(
    decodeSong(composeSettingAram(rom, catalog, 0x00).aram,
      songSlotsOfSetting(rom, catalog, 0x00).get(1)!)
  );
  const fgUsed = fg.voices.filter((v) => v.used).length;
  console.log(`  Flower Garden: ${fg.totalTicks} ticks ≈ ${fg.seconds.toFixed(1)}s, ${fgUsed} voices, tempo ${fg.initialTempo}`);
  assert(fg.seconds > 20 && fg.seconds < 300, `Flower Garden seconds ${fg.seconds.toFixed(1)} implausible`);
  assert(fgUsed >= 5, 'Flower Garden uses most voices');
  // tempoSegments invariants: ascending, consistent with the total.
  assert(fg.tempoSegments.length >= 1, 'tempo segments present');
  for (let i = 1; i < fg.tempoSegments.length; i++) {
    assert(
      fg.tempoSegments[i].tick > fg.tempoSegments[i - 1].tick &&
      fg.tempoSegments[i].seconds >= fg.tempoSegments[i - 1].seconds,
      'tempo segments ascend'
    );
  }
  const last = fg.tempoSegments[fg.tempoSegments.length - 1];
  const endSec = last.seconds + (fg.totalTicks - last.tick) / last.ticksPerSecond;
  assert(Math.abs(endSec - fg.seconds) < 0.01, `segment map end ${endSec.toFixed(2)} != seconds ${fg.seconds.toFixed(2)}`);
} catch (e) {
  if ((e as Error).message.includes('Missing build artifact')) {
    console.log(`\n(skip) shipped-song sweep: ${(e as Error).message.split('\n')[0]}`);
  } else {
    console.error(`  ✗ shipped-song sweep threw: ${(e as Error).message}`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll sequence-timeline checks passed.');
