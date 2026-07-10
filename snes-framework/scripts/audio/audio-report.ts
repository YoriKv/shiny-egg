// audio-report — the audio catalog + budget view over the built V1.0 ROM:
// the 20 upload modules (identity, ROM home, ARAM footprint), the 13
// music-set rows with their settings/songs, and the ROM/ARAM headroom the
// future editing features budget against.
//
// Usage: node snes-framework/scripts/audio/audio-report.ts

import { loadDevCart } from '../engine/dev-cart.ts';
import { readAudioCatalog, representativeSettingByRow, SPC_BLOCKS, spcBlockById } from './catalog.ts';
import { parseBlockFromRom, songSlotsOfStream } from './catalog.ts';
import { composeSettingAram } from './aram.ts';
import { songSlotsOfSetting } from './spc.ts';
import { streamAramBytes } from './upload-stream.ts';

const hex = (n: number, w = 2) => '0x' + n.toString(16).toUpperCase().padStart(w, '0');

const { rom, symbols } = loadDevCart();
const catalog = readAudioCatalog(rom, symbols);

console.log('=== SPC upload modules (DATA_SPC_ptr order) ===');
console.log('id    module    kind     ROM PC     bytes   ARAM blocks (dest+len)');
let regionEnd = 0;
for (const b of SPC_BLOCKS) {
  const pc = catalog.blockPc.get(b.blockId)!;
  const { stream, byteLength } = parseBlockFromRom(rom, catalog, b.blockId);
  regionEnd = Math.max(regionEnd, pc + byteLength);
  const blocks = stream.blocks
    .map((bl) => `${hex(bl.dest, 4)}+${bl.data.length}`)
    .join(' ');
  console.log(
    `${hex(b.blockId)}  ${b.module.padEnd(8)}  ${b.kind.padEnd(7)}  ` +
    `0x${pc.toString(16).padStart(6, '0')}  ${String(byteLength).padStart(6)}  ${blocks}`);
  const slots = songSlotsOfStream(stream);
  if (slots.size > 0) {
    const list = [...slots.entries()].sort((a, c) => a[0] - c[0])
      .map(([slot, ptr]) => `${hex(slot)}→${hex(ptr, 4)}`).join(' ');
    console.log(`${' '.repeat(30)}song slots: ${list}`);
  }
}

// FREE_BYTES tail after the engine (Bank50): the audio region's growth space.
const engineInfo = spcBlockById(0x2b);
const enginePc = catalog.blockPc.get(0x2b)!;
const freeStart = enginePc + engineInfo.retailBytes;
console.log(`\naudio region ends at PC 0x${regionEnd.toString(16)} — engine tail free space starts 0x${freeStart.toString(16)} (SNES $50B3FA, 19462 bytes to $50FFFF per %FREE_BYTES)`);

console.log('\n=== Music settings (header field 13 + engine contexts) ===');
console.log('set   name                              row  blocks         init  items  songs');
for (const s of catalog.settings) {
  const slots = songSlotsOfSetting(rom, catalog, s.setting);
  const blocks = s.blockIds.map((id) => spcBlockById(id).module).join('+') || '(engine)';
  console.log(
    `${hex(s.setting)}  ${s.name.padEnd(32)}  ${String(s.blockSetRow).padStart(3)}  ${blocks.padEnd(13)}  ` +
    `${s.initSongId ? hex(s.initSongId) : '  --'}  ${s.itemDenial === 0xff ? ' inh' : s.itemDenial ? 'deny' : '  ok'}   ` +
    `${slots.size ? [...slots.keys()].sort((a, b) => a - b).map((n) => n.toString(16)).join(',') : '-'}`);
}

console.log('\n=== Per-set ARAM baselines ===');
console.log('row  rep-setting          uploaded  highest-dest  headroom-to-$FF8E');
const rowRep = representativeSettingByRow(catalog);
for (const [row, setting] of [...rowRep.entries()].sort((a, b) => a[0] - b[0])) {
  const cfg = catalog.settings[setting];
  const composed = composeSettingAram(rom, catalog, setting);
  let uploaded = 0;
  let highest = 0;
  for (const id of composed.blockIds) {
    const { stream } = parseBlockFromRom(rom, catalog, id);
    uploaded += streamAramBytes(stream);
    for (const bl of stream.blocks) {
      if (bl.dest >= 0x4000 && bl.dest < 0xff8e) highest = Math.max(highest, bl.dest + bl.data.length);
    }
  }
  console.log(
    `${String(row).padStart(3)}  ${cfg.name.padEnd(20)} ${String(uploaded).padStart(8)}  ` +
    `${hex(highest, 4).padStart(12)}  ${String(0xff8e - highest).padStart(6)} bytes`);
}
