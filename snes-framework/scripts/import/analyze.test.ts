// Unit test for the ROM-import analyzer (plan-rom-import.md). Targets the
// extracted reference cart like the other engine tests; skips cleanly (exit 0)
// when it isn't present, since it's gitignored.
// Run: node snes-framework/scripts/import/analyze.test.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vendoredV10SymbolMap, snesToPC } from '../engine/symbol-map.ts';
import { analyzeForeignRom } from './analyze.ts';
import { resolveAnchors } from './anchors.ts';
import { diffPaletteBlob } from '../palette-edit.ts';
import { readForeignLevelNames, loadFontMap } from '../levels-catalog.ts';
import { readForeignWorldMap } from './foreign-world-map.ts';
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
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all import-analyze tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
