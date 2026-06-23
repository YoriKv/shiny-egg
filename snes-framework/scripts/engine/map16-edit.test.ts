// Map16 block-definition edit pin (map16-edit.ts) — the structured editor's
// write-back core.
//   1. encodeSubTileWord is the EXACT inverse of the decodeMap16 unpack (every
//      used block's 4 words re-encode byte-identical).
//   2. An edit to one block's sub-tile applies IN PLACE: re-reads as the edit,
//      a neighbour block is untouched, and ONLY the block's 8 bytes change.
//   3. Out-of-range / overflow ids are skipped (never written).
//
// Run: node snes-framework/scripts/engine/map16-edit.test.ts

import { loadDevCart, FRAMEWORK_ROOT } from './dev-cart.ts';
import { loadLevel, isWorld6Record, loadLevelMapPublic } from '../level.ts';
import { decodeLevelById } from './object-decode/index.ts';
import { levelMap16Usage } from './level-tile-usage.ts';
import { loadMap16Tables, decodeMap16, type Map16SubTile } from './map16.ts';
import { encodeSubTileWord, applyMap16BlockEdits, readMap16Block, map16BlockPC } from './map16-edit.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { console.log(`  ✓ ${msg}`); } else { console.error(`  ✗ ${msg}`); failures++; }
}

let cart;
try { cart = loadDevCart(FRAMEWORK_ROOT); } catch (e) {
  console.error((e as Error).message); process.exit(2);
}
const { rom, symbols } = cart;
const levelMap = loadLevelMapPublic(FRAMEWORK_ROOT);
const rec = 0x27;
const base = loadLevel({ workRoot: FRAMEWORK_ROOT, levelRecordId: rec });
const decoded = decodeLevelById({ rom, symbols, workRoot: FRAMEWORK_ROOT, levelRecordId: rec });
const usage = levelMap16Usage(rom, symbols, {
  header: base.header, isWorld6: isWorld6Record(levelMap, rec),
  levelDataBuffer: decoded!.state.levelDataBuffer, screenPageMap: decoded!.state.screenPageMap
});
const ids = usage.blocks.map((b) => b.id).filter((id) => map16BlockPC(rom, symbols, id) !== null);
assert(ids.length > 5, `level 0x27 has editable blocks (${ids.length})`);

const rawWord = (r: Uint8Array, pc: number, i: number): number => r[pc + i * 2]! | (r[pc + i * 2 + 1]! << 8);

// 1. encode == exact inverse of decode, for every used block's 4 words.
let encodeRt = 0, encodeBad = 0;
for (const id of ids) {
  const pc = map16BlockPC(rom, symbols, id)!;
  const sub: Map16SubTile[] = new Array(4) as Map16SubTile[];
  decodeMap16(loadMap16Tables(rom, symbols), id, sub);
  for (let i = 0; i < 4; i++) {
    if (encodeSubTileWord(sub[i]!) === rawWord(rom, pc, i)) encodeRt++; else encodeBad++;
  }
}
assert(encodeBad === 0, `encodeSubTileWord is the exact decode inverse (${encodeRt} words, 0 mismatch)`);

// 2. Edit one block's sub-tile 0 → applies in place; neighbour untouched; 8 bytes change.
const target = ids[0]!;
const neighbour = ids.find((id) => id !== target)!;
const before = readMap16Block(rom, symbols, target)!;
const neighbourBefore = readMap16Block(rom, symbols, neighbour)!;
const edited: Map16SubTile[] = before.map((s) => ({ ...s }));
edited[0] = {
  tileIndex: (before[0]!.tileIndex + 1) & 0x3ff,
  paletteRow: (before[0]!.paletteRow + 1) & 0x07,
  hflip: !before[0]!.hflip,
  vflip: before[0]!.vflip,
  priority: !before[0]!.priority
};
const romCopy = rom.slice();
const { bytesWritten, skipped } = applyMap16BlockEdits(romCopy, symbols, [{ map16Id: target, subtiles: edited }]);
assert(bytesWritten === 8 && skipped.length === 0, `one block edit wrote 8 bytes, 0 skipped`);

const after = readMap16Block(romCopy, symbols, target)!;
const stEq = (a: Map16SubTile, b: Map16SubTile): boolean =>
  a.tileIndex === b.tileIndex && a.paletteRow === b.paletteRow && a.hflip === b.hflip && a.vflip === b.vflip && a.priority === b.priority;
assert(stEq(after[0]!, edited[0]!), `edited sub-tile re-reads as the edit`);
assert(stEq(after[1]!, before[1]!) && stEq(after[2]!, before[2]!) && stEq(after[3]!, before[3]!), `the block's other 3 sub-tiles are unchanged`);
assert(neighbourBefore.every((s, i) => stEq(s, readMap16Block(romCopy, symbols, neighbour)![i]!)), `a neighbour block is untouched`);

const pc = map16BlockPC(rom, symbols, target)!;
let diffs = 0, diffsOutside = 0;
for (let i = 0; i < rom.length; i++) if (rom[i] !== romCopy[i]) { diffs++; if (i < pc || i >= pc + 8) diffsOutside++; }
assert(diffs > 0 && diffsOutside === 0, `only the block's 8 bytes changed (${diffs} byte(s), 0 outside)`);

// 3. Out-of-range / overflow ids are skipped.
const bogus = applyMap16BlockEdits(rom.slice(), symbols, [{ map16Id: 0xfeff, subtiles: edited }]);
assert(bogus.bytesWritten === 0 && bogus.skipped.length === 1, `an out-of-range Map16 id is skipped, nothing written`);

console.log(`\n${failures === 0 ? '✓ all map16-edit pins pass' : `✗ ${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
