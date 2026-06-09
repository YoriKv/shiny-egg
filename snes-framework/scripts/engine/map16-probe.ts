// Map16 tile-coverage probe for a level: for every distinct Map16 ID in the
// decoded buffer, show its page/tile split, the page's cell count, whether the
// tile index overflows the page, the 4 sub-tiles (tile index / palette / flips),
// each sub-tile's VRAM offset, and whether that VRAM is actually covered by the
// loaded gfx (`!MISS` = nothing loaded there, `~anim` = filled by tile
// animation). Surfaces "this object stamps a Map16 ID whose graphics aren't in
// VRAM" bugs.
//
//   node snes-framework/scripts/engine/map16-probe.ts 0x1E
//
// Engine-side, no native deps (works from WSL), targets the built V1.0 ROM.

import { loadDevCart, FRAMEWORK_ROOT } from './dev-cart.ts';
import { loadLevel, isWorld6RecordDeep } from '../level.ts';
import { decodeLevelById } from './object-decode/index.ts';
import { loadMap16Tables, decodeMap16Alloc } from './map16.ts';
import { loadSceneRegs } from './scene-regs.ts';
import { loadLevelGfx, type GfxFileEntry } from './load-graphics.ts';
import { loadTileAnimation } from './load-tile-animation.ts';
import { parseHexId } from './cli-util.ts';
import { hex } from '../hex.ts';

const hx = (n: number, w = 2) => hex(n, w);

const id = parseHexId(process.argv[2], {
  label: 'level record id',
  onError: () => console.error('Usage: map16-probe.ts <levelRecordId>   e.g. map16-probe.ts 0x1E')
});
const { rom, symbols } = loadDevCart();
const level = loadLevel({ workRoot: FRAMEWORK_ROOT, levelRecordId: id });
if (level.empty || level.special) {
  console.error(`Level ${hx(id)} is empty/special — nothing to probe.`);
  process.exit(2);
}
const decoded = decodeLevelById({ rom, symbols, workRoot: FRAMEWORK_ROOT, levelRecordId: id });
if (!decoded) {
  console.error(`Level ${hx(id)} did not decode.`);
  process.exit(2);
}
const { state } = decoded;
const h = level.header;
const isWorld6 = isWorld6RecordDeep(FRAMEWORK_ROOT, id);

const tables = loadMap16Tables(rom, symbols);
const regs = loadSceneRegs(rom, symbols, h[9]);

// Load gfx (+ animation) into VRAM with a manifest, so we can cross-check which
// VRAM ranges each Map16 sub-tile reads against what's actually present.
const vram = new Uint8Array(0x10000);
const gfxManifest: GfxFileEntry[] = [];
loadLevelGfx(rom, symbols, { bg1Tileset: h[1], bg2Tileset: h[3], bg3Tileset: h[5], spriteTileset: h[7], isWorld6 }, vram, gfxManifest);
loadTileAnimation(rom, symbols, { animationTileset: h[10], bg1Tileset: h[1], levelMode: h[9] }, vram);
const gfxRanges: Array<[number, number]> = gfxManifest.map((e) => [e.vramByteOffset, e.vramByteOffset + e.sizeBytes]);
const coveredGfx = (off: number, len = 32) => gfxRanges.some(([s, e]) => off >= s && off + len <= e);
const nonZeroVram = (off: number, len = 32) => {
  for (let k = 0; k < len; k++) if (vram[off + k] !== 0) return true;
  return false;
};

console.log(`level ${hx(id)}  bg1CharAddr=$${hx(regs.bg1CharAddr, 4)}  levelMode=$${hx(h[9])}  isWorld6=${isWorld6}`);
console.log(`GFX manifest (${gfxManifest.length} chunks):`);
for (const e of gfxManifest.slice().sort((a, b) => a.vramByteOffset - b.vramByteOffset)) {
  console.log(`  dp${e.dpSlot ?? '?'} ${e.format} src$${hx(e.srcPC, 6)} -> VRAM $${hx(e.vramByteOffset, 4)}..$${hx(e.vramByteOffset + e.sizeBytes, 4)} (${e.sizeBytes}b)`);
}
console.log(`page cell counts [0..3]: ${[0, 1, 2, 3].map((p) => tables.pageCellCounts[p]).join(', ')}`);

// Distinct Map16 IDs across allocated screens.
const counts = new Map<number, number>();
const buf = state.levelDataBuffer;
for (let s = 0; s < state.screenPageMap.length; s++) {
  const slot = state.screenPageMap[s];
  if (slot === 0x80) continue;
  const page = slot & 0x3f;
  if (page === 0) continue;
  const base = page * 512;
  for (let i = 0; i < 512; i += 2) {
    const mid = buf[base + i] | (buf[base + i + 1] << 8);
    if (mid === 0) continue;
    counts.set(mid, (counts.get(mid) ?? 0) + 1);
  }
}

console.log(`\nID     pg tile  pgCells  inPage  tileBase   subtiles(tileIdx/pal h v @vram)                  count`);
for (const mid of [...counts.keys()].sort((a, b) => a - b)) {
  const page = (mid >>> 8) & 0xff;
  const tile = mid & 0xff;
  const pgCells = page < tables.pageCellCounts.length ? tables.pageCellCounts[page] : -1;
  const inPage = tile < pgCells ? 'ok ' : 'OVER';
  const pageBase = tables.indexTable[page * 2] | (tables.indexTable[page * 2 + 1] << 8);
  const tileBase = pageBase + tile * 8;
  let subs = '';
  try {
    const st = decodeMap16Alloc(tables, mid);
    subs = st
      .map((s) => {
        const v = (regs.bg1CharAddr + s.tileIndex * 32) & 0xffff;
        const cov = coveredGfx(v) ? '' : nonZeroVram(v) ? '~anim' : '!MISS';
        return `${hx(s.tileIndex, 3)}/${s.paletteRow}${s.hflip ? 'H' : ' '}${s.vflip ? 'V' : ' '}@$${hx(v, 4)}${cov}`;
      })
      .join(' ');
  } catch (e) {
    subs = 'THREW ' + (e instanceof Error ? e.message : e);
  }
  console.log(
    `$${hx(mid, 4)}  ${hx(page)} ${hx(tile)}    ${String(pgCells).padStart(4)}    ${inPage}   ` +
      `$${hx(tileBase, 4)}   ${subs.padEnd(46)} ${String(counts.get(mid) ?? 0).padStart(5)}`
  );
}
