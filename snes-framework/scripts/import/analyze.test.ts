// Unit test for the ROM-import analyzer (plan-rom-import.md). Targets the
// extracted reference cart like the other engine tests; skips cleanly (exit 0)
// when it isn't present, since it's gitignored.
// Run: node snes-framework/scripts/import/analyze.test.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mergeSymbolMaps,
  parseWlaSymbolMap,
  snesToPC,
  vendoredV10SymbolMap,
  type SymbolMap
} from '../engine/symbol-map.ts';
import { outputSfcName } from '../rom-versions.ts';
import { analyzeForeignRom } from './analyze.ts';
import { resolveAnchors } from './anchors.ts';
import { diffPaletteBlob } from '../palette-edit.ts';
import { readForeignLevelNames, loadFontMap } from '../levels-catalog.ts';
import { mergeForeignIndexWords, readForeignWorldMap } from './foreign-world-map.ts';
import { parseEntranceTable, loadLevelIdSymbols } from '../world-map.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORK_ROOT = path.join(here, '..', '..');
const BASE = path.join(here, '..', '..', 'reference', 'reference.sfc');

if (!fs.existsSync(BASE)) {
  console.log(`SKIP: reference cart not found at ${BASE} (run extract first).`);
  process.exit(0);
}

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

const base = fs.readFileSync(BASE);

console.log('=== anchors resolve at vanilla addresses (base vs base) ===');
{
  const { anchors, resolved, baseDerived } = resolveAnchors(base, base);
  assert(resolved !== null, 'level pointer table resolves');
  assert(baseDerived, 'base is V1.0-derived');
  const levelPtrs = anchors.find((a) => a.key === 'levelPtrs');
  assert(levelPtrs?.method === 'vanilla-addr', 'levelPtrs via vanilla-addr');
  assert(levelPtrs?.pc !== null, 'levelPtrs has an address');
  for (const key of ['headerBitWidths', 'objectPropertyTable']) {
    const a = anchors.find((x) => x.key === key);
    assert(a?.pc !== null && a?.confidence === 1, `${key} resolves with full confidence`);
  }
}

console.log('=== self-diff is empty (base vs base) ===');
{
  const { analysis, items } = analyzeForeignRom(base, base);
  assert(analysis.levelPtrsResolved, 'levelPtrsResolved');
  assert(analysis.levels.length === 0, `0 changed levels, got ${analysis.levels.length}`);
  assert(items.length === 0, '0 apply items');
  assert(analysis.foreignMd5 === 'cb472164c5a71ccd3739963390ec6a50', 'foreign md5 = V1.0');
  assert(analysis.inventory !== undefined, 'inventory present');
  assert(analysis.inventory!.totalDiffBytes === 0, 'self-diff inventory is empty');
  assert(analysis.inventory!.categories.length === 0, 'no inventory categories on self-diff');
}

console.log('=== diff inventory classifies synthetic edits by cart structure ===');
{
  const sym = vendoredV10SymbolMap();
  // The full base-build .sym (when present) refines label attribution — load it
  // like the app layer does; the band assertions below don't depend on it.
  let full: SymbolMap | undefined;
  try {
    const sfc = outputSfcName('YI_U1');
    const main = path.join(WORK_ROOT, 'build', sfc.replace(/\.sfc$/, '.sym'));
    const fx = path.join(WORK_ROOT, 'build', sfc.replace(/\.sfc$/, '-superfx.sym'));
    if (fs.existsSync(main)) {
      full = parseWlaSymbolMap(fs.readFileSync(main, 'utf8'));
      if (fs.existsSync(fx)) full = mergeSymbolMaps(full, parseWlaSymbolMap(fs.readFileSync(fx, 'utf8')));
    }
  } catch {
    /* attribution falls back to bands */
  }

  const hack = Buffer.from(base);
  hack[0x180000] ^= 0xff; // LZ2 graphics band ($58:0000)
  hack[0x1b8000] ^= 0xff; // tilemap band ($5B:8000)
  hack[0x7fdc] ^= 0xff; // ROM header checksum
  const palettePc = sym.pc('DATA_master_palette_rom_blob');
  hack[palettePc + 0x100] ^= 0x01; // master palette blob (imported category)

  const { analysis } = analyzeForeignRom(hack, base, full ? { symbols: full } : {});
  const inv = analysis.inventory!;
  assert(inv !== undefined, 'inventory present');
  const byKey = new Map(inv.categories.map((c) => [c.key, c]));
  assert(byKey.get('graphics')?.bytes === 1, `1 graphics byte, got ${byKey.get('graphics')?.bytes}`);
  assert(byKey.get('tilemaps')?.bytes === 1, `1 tilemap byte, got ${byKey.get('tilemaps')?.bytes}`);
  assert(byKey.get('rom-header')?.bytes === 1, `1 header byte, got ${byKey.get('rom-header')?.bytes}`);
  const pal = byKey.get('palette');
  assert(pal?.bytes === 1 && pal.imported, `1 imported palette byte, got ${pal?.bytes}`);
  assert(inv.totalDiffBytes === 4, `4 diff bytes total, got ${inv.totalDiffBytes}`);

  if (full) {
    // With the full .sym, a palette-pointer-table edit names its category (the
    // RI5b "repointed palette" detection).
    const hack2 = Buffer.from(base);
    hack2[sym.pc('DATA_bg1_palette_ptrs')] ^= 0x01;
    const inv2 = analyzeForeignRom(hack2, base, { symbols: full }).analysis.inventory!;
    const cat = inv2.categories.find((c) => c.key === 'palette-ptrs');
    assert(cat?.bytes === 1, `palette-ptrs byte attributed, got ${JSON.stringify(inv2.categories)}`);
    assert(cat?.imported === false, 'palette-ptrs is a not-imported category');
  } else {
    console.log('  (no build .sym — skipping label-attribution assertions)');
  }
}

console.log('=== synthetic 1-byte sprite edit → exactly one full-importable level ===');
{
  const sym = vendoredV10SymbolMap();
  const ptrs = sym.pc('YI_LevelDataPtrsAndEntranceData_Ptrs');
  const r24 = (b: Buffer, o: number): number => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);

  // First record with a non-empty, non-sentinel sprite stream.
  let target = -1;
  let sprPc = -1;
  for (let id = 0; id < 222; id++) {
    const sprSnes = r24(base, ptrs + id * 6 + 3);
    if (sprSnes === 0 || sprSnes === 0x15ffd5) continue;
    const pc = snesToPC(sprSnes);
    if (pc + 3 <= base.length && !(base[pc] === 0xff && base[pc + 1] === 0xff)) {
      target = id;
      sprPc = pc;
      break;
    }
  }
  assert(target >= 0, 'found a record with a sprite stream');

  const hack = Buffer.from(base);
  hack[sprPc + 2] = (hack[sprPc + 2] ^ 0x10) & 0xff; // flip a bit in sprite[0].x
  const { analysis, items } = analyzeForeignRom(hack, base);

  assert(analysis.levels.length === 1, `exactly 1 changed level, got ${analysis.levels.length}`);
  const l = analysis.levels[0];
  assert(l?.recordId === target, `changed record is 0x${target.toString(16)}, got 0x${l?.recordId.toString(16)}`);
  assert(l?.sprChanged === true && l?.objChanged === false, 'only the sprite stream changed');
  assert(l?.importability === 'full', `full importable, got ${l?.importability}`);
  assert(items.length === 1 && items[0]?.recordId === target, 'one apply item for the target record');
  // The same edit lands in the inventory as level data (covered by the import).
  const lvlCat = analysis.inventory?.categories.find((c) => c.key === 'level-data');
  assert(lvlCat?.bytes === 1 && lvlCat.imported, `1 imported level-data byte, got ${lvlCat?.bytes}`);
}

console.log('=== a NEW level in a sentinel slot (0xDA) imports as full + relocated ===');
{
  // Synthesize a hack that put a real level in the empty seed-contest slot: copy
  // record 0x00's streams into FreeRegion51's $FF tail and point row $DA there.
  const sym = vendoredV10SymbolMap();
  const ptrs = sym.pc('YI_LevelDataPtrsAndEntranceData_Ptrs');
  const r24 = (b: Buffer, o: number): number => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
  const w24 = (b: Buffer, o: number, v: number): void => {
    b[o] = v & 0xff;
    b[o + 1] = (v >> 8) & 0xff;
    b[o + 2] = (v >> 16) & 0xff;
  };
  const srcObjPc = snesToPC(r24(base, ptrs + 0x00 * 6));
  const srcSprPc = snesToPC(r24(base, ptrs + 0x00 * 6 + 3));
  // Stream lengths via the analyzer's own walkers (already imported transitively
  // by analyzeForeignRom) — just slice generously and let decode find the ends:
  // copy 2 KB of obj + 1 KB of spr (well past any real terminator).
  const hack = Buffer.from(base);
  const objDest = 0x115348; // PC of $51:5348 (FreeRegion51 start, $FF in base)
  const sprDest = 0x117000;
  base.copy(hack, objDest, srcObjPc, srcObjPc + 0x800);
  base.copy(hack, sprDest, srcSprPc, srcSprPc + 0x400);
  w24(hack, ptrs + 0xda * 6, 0x515348);
  w24(hack, ptrs + 0xda * 6 + 3, 0x517000);

  const { analysis, items } = analyzeForeignRom(hack, base);
  const l = analysis.levels.find((x) => x.recordId === 0xda);
  assert(l !== undefined, '0xDA appears in the change set');
  assert(l?.importability === 'full', `0xDA imports full, got ${l?.importability}`);
  assert(l?.relocated === true, '0xDA is flagged relocated (repointed row)');
  assert(l?.base === null, '0xDA has no base side (sentinel slot)');
  const item = items.find((i) => i.recordId === 0xda);
  assert(item !== undefined && item.level.objects.length > 0, '0xDA decodes a real level');
}

console.log('=== a corrupted pointer table fails validation (not "the table") ===');
{
  const ptrsPc = vendoredV10SymbolMap().pc('YI_LevelDataPtrsAndEntranceData_Ptrs');
  const corrupt = Buffer.from(base);
  corrupt.fill(0x00, ptrsPc, ptrsPc + 222 * 6); // zero every pointer → none resolve to a level
  const { anchors, resolved } = resolveAnchors(corrupt, base);
  const lp = anchors.find((a) => a.key === 'levelPtrs');
  assert(lp?.pc === null && lp?.method === 'unresolved', 'zeroed table → levelPtrs unresolved');
  assert(resolved === null, 'no resolved anchors when the level table fails validation');
}

console.log('=== P4: palette blob offsets align (asm dw words ↔ cart bytes) ===');
{
  // diffPaletteBlob compares the base Bank57 asm words to cart bytes at the blob
  // address; base-vs-base MUST be empty, else the import would emit phantom edits.
  const blobPC = vendoredV10SymbolMap().pc('DATA_master_palette_rom_blob');
  const bank57 = fs.readFileSync(path.join(WORK_ROOT, 'yi', 'Banks', 'Bank57.asm'), 'utf8');
  const self = diffPaletteBlob(bank57, (off) => base.readUInt16LE(blobPC + off));
  assert(self.length === 0, `palette base self-diff is empty (got ${self.length})`);
}

console.log('=== P4: foreign-name gate accepts real names, rejects garbage ===');
{
  const sym = vendoredV10SymbolMap();
  const fm = loadFontMap(WORK_ROOT);
  const baseNames = readForeignLevelNames(base, sym, fm);
  assert(baseNames.size > 0, 'base cart yields level names');
  const allWellFormed = [...baseNames.values()].every((n) => n.wellFormed && n.lines.length > 0);
  assert(allWellFormed, 'every base name is well-formed');

  // Point slot 0's name pointer at a non-$FF byte run → must read as not-well-formed.
  const garbled = Buffer.from(base);
  const tablePC = sym.pc('DATA_level_name_string_ptrs');
  garbled.writeUInt16LE(0x0001, tablePC); // bank-$51 offset $0001 → bytes that don't start with $FF
  const g = readForeignLevelNames(garbled, sym, fm);
  assert(g.get(0)?.wellFormed === false, 'a clobbered name pointer is rejected (wellFormed=false)');
}

console.log('=== world-map: foreign entrance read aligns with the asm model (base self-diff empty) ===');
{
  const sym = vendoredV10SymbolMap();
  const dtText = fs.readFileSync(
    path.join(WORK_ROOT, 'yi', 'Routines', 'DATATABLE_YI_LevelDataPtrsAndEntranceData.asm'),
    'utf8'
  );
  const model = parseEntranceTable(dtText, loadLevelIdSymbols(WORK_ROOT));
  const wm = readForeignWorldMap(base, sym, model.entrances.length, model.midway.length);
  assert(wm.resolved, 'world-map symbols resolve');
  assert(wm.entrances.length === model.entrances.length, 'entrance count matches the asm model');
  assert(wm.midway.length === model.midway.length, 'midway count matches the asm model');

  // The cart bytes at the vanilla address MUST equal the parsed asm model (base
  // == V1.0 cart == base asm) — proves the symbol address is the right one, so a
  // base-vs-base import wouldn't emit phantom changes.
  const entOk = model.entrances.every((m, i) => {
    const f = wm.entrances[i]!;
    return (
      f.levelDataId === m.levelDataId &&
      f.spawnX === m.spawnX &&
      f.spawnY === m.spawnY &&
      f.progTarget === m.progTarget
    );
  });
  assert(entOk, 'foreign entrance read byte-matches the parsed asm entrance records');
  const midOk = model.midway.every((m, i) => {
    const f = wm.midway[i]!;
    return (
      f.levelDataId === m.levelDataId &&
      f.spawnX === m.spawnX &&
      f.spawnY === m.spawnY &&
      f.entranceState === m.entranceState
    );
  });
  assert(midOk, 'foreign midway read byte-matches the parsed asm midway records');

  // A 1-byte spawnX edit on one entrance record → exactly that record differs.
  const mainPc = sym.pc('YI_LevelDataPtrsAndEntranceData_DATA_map_level_entrances');
  const target = 3;
  const hack = Buffer.from(base);
  hack[mainPc + target * 4 + 1] = (hack[mainPc + target * 4 + 1]! ^ 0x01) & 0xff; // flip spawnX bit
  const hwm = readForeignWorldMap(hack, sym, model.entrances.length, model.midway.length);
  const changed = hwm.entrances.filter((f, i) => f.spawnX !== wm.entrances[i]!.spawnX);
  assert(changed.length === 1 && changed[0]?.index === target, `exactly entrance #${target} changed`);

  // RI4: the INDEX tables read at their vanilla addresses and byte-match the
  // parsed asm words (base == cart), and a remapped slot word is detected.
  const idxCount = model.entranceIndexWords?.length ?? 0;
  const midIdxCount = model.midwayIndexWords?.length ?? 0;
  assert(idxCount > 0 && midIdxCount > 0, 'asm model carries raw index words');
  const wmIdx = readForeignWorldMap(base, sym, model.entrances.length, model.midway.length, idxCount, midIdxCount);
  assert(
    wmIdx.entranceIndexWords.length === idxCount &&
      wmIdx.entranceIndexWords.every((w, i) => w === model.entranceIndexWords![i]),
    'foreign entrance-index read byte-matches the parsed asm words'
  );
  assert(
    wmIdx.midwayIndexWords.every((w, i) => w === model.midwayIndexWords![i]),
    'foreign midway-index read byte-matches the parsed asm words'
  );
  const idxPc = sym.pc('YI_LevelDataPtrsAndEntranceData_DATA_level_entrance_indexes');
  const hack2 = Buffer.from(base);
  hack2.writeUInt16LE(0x0008, idxPc + 2); // translevel 1 → record 2
  const hwm2 = readForeignWorldMap(hack2, sym, model.entrances.length, model.midway.length, idxCount, midIdxCount);
  const idxChanged = hwm2.entranceIndexWords.filter((w, i) => w !== wmIdx.entranceIndexWords[i]);
  assert(idxChanged.length === 1 && hwm2.entranceIndexWords[1] === 0x0008, 'exactly the remapped index word differs');

  // Merge gates (Flutter-shaped): genuine remaps import even next to $00FF
  // "disabled slot" fills; a wholesale-clobbered table imports NOTHING.
  const baseWords = [0x0000, 0x0004, 0x0008, 0x000c, 0x0010, 0x0014];
  {
    // 1 genuine remap + 4 disabled fills → 1 imported, 4 skipped, not clobbered.
    const modelWords = [...baseWords];
    const foreignW = [0x0000, 0x0008, 0x00ff, 0x00ff, 0x00ff, 0x00ff];
    const r = mergeForeignIndexWords(modelWords, foreignW, baseWords, 56);
    assert(r.remapped === 1 && r.skipped === 4 && !r.clobbered, `fill-heavy table: 1 remap + 4 skips (got ${JSON.stringify(r)})`);
    assert(modelWords[1] === 0x0008 && modelWords[2] === 0x0008, 'the genuine remap lands; fills leave vanilla');
  }
  {
    // Random garbage majority → clobbered: even the in-range $0000 is rejected.
    const modelWords = [...baseWords];
    const foreignW = [0x5a4e, 0x7b82, 0x0000, 0x18b6, 0x7072, 0x29a6];
    const r = mergeForeignIndexWords(modelWords, foreignW, baseWords, 122);
    assert(r.clobbered && r.remapped === 0, `clobbered table imports nothing (got ${JSON.stringify(r)})`);
    assert(modelWords.every((w, i) => w === baseWords[i]), 'clobbered table leaves the model untouched');
  }
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all import-analyze tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
