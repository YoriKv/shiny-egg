// Smoke test: decode a few Map16 IDs from the real V1.1 YI cart and assert
// basic sanity (page 0 tile 0 decodes without error, fields are in range).
//
// Run: node --experimental-strip-types snes-framework/scripts/engine/map16.test.ts

import * as fs from 'node:fs';
import { decodeMap16, decodeMap16Alloc, loadMap16Tables } from './map16.ts';
import { vendoredV10SymbolMap } from './symbol-map.ts';

const cartPath = '/mnt/d/Dev/SNES/YI_USA1.sfc'; // V1.0 reference cart
let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}

if (!fs.existsSync(cartPath)) {
  console.error(`cart not found at ${cartPath}; skipping integration tests`);
  process.exit(0);
}
const rom = new Uint8Array(fs.readFileSync(cartPath));
const tables = loadMap16Tables(rom, vendoredV10SymbolMap());

console.log(`indexTable: ${tables.indexTable.length} bytes (${tables.indexTable.length / 2} pages)`);
console.log(`pageData:   ${tables.pageData.length} bytes`);

// --- Test 1: page 0, tile 0 — the "default" map16 cell, should decode -----
{
  const sub = decodeMap16Alloc(tables, 0x0000);
  assert(sub.length === 4, 'always returns 4 sub-tiles');
  for (let i = 0; i < 4; i++) {
    assert(sub[i].tileIndex >= 0 && sub[i].tileIndex < 1024, `[${i}] tileIndex in [0..1023]`);
    assert(sub[i].paletteRow >= 0 && sub[i].paletteRow < 8, `[${i}] paletteRow in [0..7]`);
  }
  console.log(`Map16 0x0000 sub-tiles:`);
  sub.forEach((st, i) => {
    console.log(
      `  [${i}] tile=0x${st.tileIndex.toString(16).padStart(3, '0')} pal=${st.paletteRow} ` +
      `${st.hflip ? 'H' : '-'}${st.vflip ? 'V' : '-'} prio=${st.priority ? 1 : 0}`
    );
  });
}

// --- Test 2: sweep across pages to ensure no crashes on reasonable IDs ----
{
  let ok = 0, bad = 0;
  for (let page = 0; page < 0xa7; page++) {
    for (const tile of [0, 1, 5, 0x10, 0x20]) {
      try {
        const id = (page << 8) | tile;
        const sub = decodeMap16Alloc(tables, id);
        if (sub.length === 4 && sub.every(s => s.tileIndex < 1024 && s.paletteRow < 8)) ok++;
        else bad++;
      } catch {
        bad++;
      }
    }
  }
  console.log(`Sweep: ${ok} ok, ${bad} bad / ${ok + bad} attempts across pages 0..A6`);
  assert(ok > 500, `most sweep attempts should decode without error (got ${ok})`);
}

// --- Test 3: out-of-range page index throws ----------------------------
{
  let threw = false;
  try { decodeMap16Alloc(tables, 0xff00); } catch (e) { threw = e instanceof RangeError; }
  assert(threw, 'page 0xFF (past 0xA6) throws RangeError');
}

// --- Test 4: in-place decode matches Alloc variant -----------------------
{
  const a = decodeMap16Alloc(tables, 0x0123);
  const b: any[] = new Array(4);
  decodeMap16(tables, 0x0123, b);
  for (let i = 0; i < 4; i++) {
    assert(
      a[i].tileIndex === b[i].tileIndex &&
      a[i].paletteRow === b[i].paletteRow &&
      a[i].hflip === b[i].hflip &&
      a[i].vflip === b[i].vflip &&
      a[i].priority === b[i].priority,
      `in-place [${i}] matches alloc`
    );
  }
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
