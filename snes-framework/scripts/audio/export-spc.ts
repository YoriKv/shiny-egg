// export-spc — synthesize playable .spc files for every song in the built
// V1.0 ROM (or one setting/song), straight from the ROM's upload modules.
// No emulator involved; see spc.ts for the boot recipe.
//
// Usage:
//   node snes-framework/scripts/audio/export-spc.ts                 # all songs
//   node snes-framework/scripts/audio/export-spc.ts --setting 0x0A  # one setting
//   node snes-framework/scripts/audio/export-spc.ts --setting 0x0A --song 0x01
//   node snes-framework/scripts/audio/export-spc.ts --out <dir>     # default tmp/audio-spc
//
// Settings sharing a block-set row (e.g. Boss / Boss-immediate) produce the
// same audio, so the default export walks each of the 13 rows once via a
// representative setting. Files land as
//   <out>/<row>-<setting-name>-song-<slot>.spc  (names slugified).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadDevCart, FRAMEWORK_ROOT } from '../engine/dev-cart.ts';
import { readAudioCatalog, representativeSettingByRow, songDisplayName, songExportFileName } from './catalog.ts';
import { songSlotsOfSetting, synthesizeSongSpc } from './spc.ts';

function parseArgs(argv: string[]): { setting?: number; song?: number; out: string } {
  let setting: number | undefined;
  let song: number | undefined;
  let out = path.resolve(FRAMEWORK_ROOT, '..', 'tmp', 'audio-spc');
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--setting') setting = parseInt(argv[++i], 16);
    else if (argv[i] === '--song') song = parseInt(argv[++i], 16);
    else if (argv[i] === '--out') out = path.resolve(argv[++i]);
    else { console.error(`unknown arg: ${argv[i]}`); process.exit(2); }
  }
  return { setting, song, out };
}

const { setting: onlySetting, song: onlySong, out: outDir } = parseArgs(process.argv);

const { rom, symbols } = loadDevCart();
const catalog = readAudioCatalog(rom, symbols);

const rowRep = representativeSettingByRow(catalog);

const targets: number[] = onlySetting !== undefined
  ? [onlySetting]
  : [...rowRep.values()].sort((a, b) => catalog.settings[a].blockSetRow - catalog.settings[b].blockSetRow);

fs.mkdirSync(outDir, { recursive: true });

let written = 0;
for (const setting of targets) {
  const cfg = catalog.settings[setting];
  if (!cfg) { console.error(`unknown setting 0x${setting.toString(16)}`); process.exit(2); }
  const slots = songSlotsOfSetting(rom, catalog, setting);
  const slotIds = (onlySong !== undefined ? [onlySong] : [...slots.keys()]).sort((a, b) => a - b);
  for (const slot of slotIds) {
    if (!slots.has(slot)) {
      console.error(`setting 0x${setting.toString(16)} (${cfg.name}): song slot 0x${slot.toString(16)} not populated`);
      process.exit(2);
    }
    const title = songDisplayName(cfg.blockSetRow, slot);
    const { spc } = synthesizeSongSpc(rom, catalog, setting, slot, { title, artist: 'Koji Kondo' });
    const file = path.join(outDir, songExportFileName(cfg.blockSetRow, slot, title));
    fs.writeFileSync(file, spc);
    console.log(`${file}  (blocks: ${catalog.settings[setting].blockIds.map((b) => '0x' + b.toString(16)).join(' ') || 'engine'})`);
    written++;
  }
}
console.log(`\n${written} .spc file(s) written to ${outDir}`);
