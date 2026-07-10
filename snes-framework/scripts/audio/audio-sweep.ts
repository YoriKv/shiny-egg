// audio-sweep — decode every song sequence reachable from every music
// setting's composed ARAM baseline; exit 1 on any decode failure. The
// post-edit gate for the sequence codec (the audio analogue of sweep-levels).
//
// Usage: node snes-framework/scripts/audio/audio-sweep.ts [-v]
//   -v  print per-song stats (parts/patterns/tracks/events)

import { loadDevCart } from '../engine/dev-cart.ts';
import { readAudioCatalog, representativeSettingByRow } from './catalog.ts';
import { composeSettingAram } from './aram.ts';
import { songSlotsOfSetting } from './spc.ts';
import { decodeSong } from './sequence.ts';

const verbose = process.argv.includes('-v');

const { rom, symbols } = loadDevCart();
const catalog = readAudioCatalog(rom, symbols);

const rowRep = representativeSettingByRow(catalog);

let songs = 0;
let failures = 0;
const seen = new Set<string>(); // `${row}:${slot}` dedupe (defensive)

for (const [row, setting] of [...rowRep.entries()].sort((a, b) => a[0] - b[0])) {
  const cfg = catalog.settings[setting];
  const { aram } = composeSettingAram(rom, catalog, setting);
  const slots = songSlotsOfSetting(rom, catalog, setting);
  for (const [slot, ptr] of [...slots.entries()].sort((a, b) => a[0] - b[0])) {
    const key = `${row}:${slot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    songs++;
    try {
      const song = decodeSong(aram, ptr);
      let events = 0;
      for (const t of song.tracks.values()) events += t.events.length;
      if (verbose) {
        console.log(
          `row ${row} (${cfg.name}) song 0x${slot.toString(16).padStart(2, '0')} @0x${ptr.toString(16)}: ` +
          `${song.parts.length} parts, ${song.patterns.size} patterns, ${song.tracks.size} tracks ` +
          `(${song.subroutineAddrs.size} subs), ${events} events`);
      }
    } catch (e) {
      failures++;
      console.error(`FAIL row ${row} (${cfg.name}) song 0x${slot.toString(16)} @0x${ptr.toString(16)}: ${(e as Error).message}`);
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures}/${songs} songs failed to decode`);
  process.exit(1);
}
console.log(`${verbose ? '\n' : ''}all ${songs} songs decoded cleanly across ${rowRep.size} music-set baselines`);
