// Unit test: graphics reinsert layout logic.
// Run: node --experimental-strip-types snes-framework/scripts/gfx-reinsert.test.ts
//
// Pure logic + parsing against the committed asm; no cart/build needed. The
// boundary-move rewrite is pinned to the exact string the end-to-end asar build
// accepted (tmp/reinsert-e2e-growth.ts), tying this to the proven mechanism.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { rewriteFreeBytesText } from './boundary-move.ts';
import { lz2 } from './engine/decompress/lz2.ts';
import { lz16 } from './engine/decompress/lz16.ts';
import {
  GFX_ARENA,
  gfxFileForLabel,
  parseGfxPtrTable,
  gfxBlobFileForId,
  readArenaFill,
  planGfxLayout,
  applyGfxLayout,
  computeGfxGrowth,
  relocateGfxBlobs,
  encodeGfxBlob,
  writeGfxEdit,
} from './gfx-reinsert.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}
function eq<T>(a: T, b: T, msg: string): void {
  if (JSON.stringify(a) !== JSON.stringify(b)) { console.error(`  ✗ ${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); failures++; }
}

const yiRoot = path.resolve('snes-framework/yi');

console.log('=== gfxFileForLabel ===');
eq(gfxFileForLabel('DATA_5CBA89', 'lz16'), 'GFX_5CBA89.lz16', 'lz16 label → file');
eq(gfxFileForLabel('DATA_573C00', 'lz2'), 'GFX_573C00.lz2', 'lz2 label → file');

console.log('\n=== parseGfxPtrTable (against committed Bank06.asm) ===');
const bank06 = fs.readFileSync(path.join(yiRoot, GFX_ARENA.ptrBankFile), 'utf8');
const lz2Labels = parseGfxPtrTable(bank06, 'lz2');
const lz16Labels = parseGfxPtrTable(bank06, 'lz16');
eq(lz2Labels.length, 265, 'lz2 table has 265 entries');
eq(lz16Labels.length, 187, 'lz16 table has 187 entries');
eq(lz2Labels[0], 'DATA_573C00', 'lz2[0] label');
eq(lz16Labels[0], 'DATA_5CBA89', 'lz16[0] label');

console.log('\n=== gfxBlobFileForId (resolves real graphics + tilemap blobs, assets/yi-relative) ===');
eq(gfxBlobFileForId(yiRoot, 'lz16', 0), 'Graphics/GFX_5CBA89.lz16', 'lz16 id 0 → Graphics blob');
eq(gfxBlobFileForId(yiRoot, 'lz2', 0), 'Graphics/GFX_573C00.lz2', 'lz2 id 0 → Graphics blob');
// Some LZ2 table slots are tilemaps → resolve to Tilemaps/ (e.g. the title island's
// Mode-7 char, file $B1, which the extract classifies as a tilemap — editing it must
// resolve so the import can write it back, not error "not a graphics blob").
{
  const island = gfxBlobFileForId(yiRoot, 'lz2', 0xb1);
  assert(island !== null && island.startsWith('Tilemaps/'), `lz2 id $B1 (island char) → a Tilemaps blob (got ${island})`);
  let sawTilemap = false;
  for (let i = 0; i < lz2Labels.length; i++) { const f = gfxBlobFileForId(yiRoot, 'lz2', i); if (f?.startsWith('Tilemaps/')) { sawTilemap = true; break; } }
  assert(sawTilemap, 'lz2 table resolves at least one tilemap-dir blob');
}

console.log('\n=== readArenaFill (committed Bank57.asm slack) ===');
const fill = readArenaFill(yiRoot);
eq(fill, 2378, 'arena slack = 2378');

console.log('\n=== planGfxLayout (three modes) ===');
eq(planGfxLayout(0, 2378).mode, 'data-only', 'no growth → data-only');
eq(planGfxLayout(-500, 2378).mode, 'data-only', 'shrink → data-only');
{
  const p = planGfxLayout(143, 2378);
  eq(p.mode, 'boundary-move', 'small growth → boundary-move');
  eq(p.move!.boundary, GFX_ARENA.boundary, 'move boundary = arena boundary');
  eq(p.move!.growth, 143, 'move growth');
  eq(p.move!.fillSize, 2378, 'move fillSize');
}
eq(planGfxLayout(2378, 2378).mode, 'boundary-move', 'growth == slack still fits');
{
  const p = planGfxLayout(2379, 2378);
  eq(p.mode, 'overflow', 'growth > slack → overflow');
  eq(p.overflowBy, 1, 'overflow amount');
}

console.log('\n=== boundary-move rewrite pinned to the proven e2e string ===');
{
  // The growth e2e built successfully with growth=143 → ($5F8AC5, 2235).
  const base = fs.readFileSync(path.join(yiRoot, GFX_ARENA.bankFile), 'utf8');
  const p = planGfxLayout(143, fill);
  const out = rewriteFreeBytesText(base, p.move!);
  assert(out.includes('%FREE_BYTES($5F8AC5, 2235, $FF)'), 'rewrite → $5F8AC5, 2235 (matches e2e build)');
  assert(!out.includes('%FREE_BYTES($5F8A36, 2378, $FF)'), 'original macro replaced');
  // Idempotent + reversible: growth 0 yields the pristine text.
  eq(planGfxLayout(0, fill).mode, 'data-only', 'growth 0 → no asm edit');
}

console.log('\n=== computeGfxGrowth (temp base/overlay trees) ===');
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gfxgrow-'));
  const baseG = path.join(root, 'base/Graphics');
  const ovG = path.join(root, 'overlay/Graphics');
  fs.mkdirSync(baseG, { recursive: true });
  fs.mkdirSync(ovG, { recursive: true });
  fs.writeFileSync(path.join(baseG, 'GFX_A.lz16'), Buffer.alloc(100));
  fs.writeFileSync(path.join(baseG, 'GFX_B.lz2'), Buffer.alloc(200));
  // Edit A larger (+50), B smaller (−30): net +20.
  fs.writeFileSync(path.join(ovG, 'GFX_A.lz16'), Buffer.alloc(150));
  fs.writeFileSync(path.join(ovG, 'GFX_B.lz2'), Buffer.alloc(170));
  const r = computeGfxGrowth(path.join(root, 'base'), path.join(root, 'overlay'));
  eq(r.growth, 20, 'net growth = +20');
  eq(r.blobs.length, 2, 'two edited blobs');
  // A brand-new overlay blob with no base counterpart counts as pure growth.
  fs.writeFileSync(path.join(ovG, 'GFX_C.lz16'), Buffer.alloc(64));
  eq(computeGfxGrowth(path.join(root, 'base'), path.join(root, 'overlay')).growth, 84, 'new blob adds full size');
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('\n=== relocateGfxBlobs (overflow → free region) ===');
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gfxreloc-'));
  const banks = path.join(root, 'Banks');
  fs.mkdirSync(banks, { recursive: true });
  // Synthetic arena bank: two gfx blobs + the arena tail.
  fs.writeFileSync(path.join(banks, 'Bank57.asm'), [
    'DATA_5CBA89:', '\tincbin "Graphics/GFX_5CBA89.lz16"', '',
    'DATA_5CC342:', '\tincbin "Graphics/GFX_5CC342.lz16"', '',
    '\t%FREE_BYTES($5F8A36, 2378, $FF)', ''
  ].join('\n'));
  // Synthetic free-region bank (FreeRegion51 in Bank51.asm).
  fs.writeFileSync(path.join(banks, 'Bank51.asm'), 'SomeCode:\n\tdb $00\n\t%FREE_BYTES($515348, 44216, $FF)\n');
  const region51 = { id: 'FreeRegion51', bankFile: 'Banks/Bank51.asm', boundary: 0x515348, capacityBytes: 44216 };

  relocateGfxBlobs(root, [{ file: 'Graphics/GFX_5CBA89.lz16', overlaySize: 1500, baseSize: 1132 }], [region51]);

  const bank57 = fs.readFileSync(path.join(banks, 'Bank57.asm'), 'utf8');
  const bank51 = fs.readFileSync(path.join(banks, 'Bank51.asm'), 'utf8');
  assert(!bank57.includes('DATA_5CBA89:'), 'relocated blob removed from arena');
  assert(bank57.includes('DATA_5CC342:'), 'untouched arena blob stays');
  assert(bank51.includes('DATA_5CBA89:\n\tincbin "Graphics/GFX_5CBA89.lz16"'), 'relocated blob appended to free region (Graphics path)');
  assert(bank51.includes('%InsertMacroAtXPosition($515348)'), 'region org anchor inserted');
  assert(bank51.includes('%FREE_BYTES($515924, 42716, $FF)'), 'region tail shrunk by 1500B (boundary $515348+1500=$515924, fill 44216-1500)');

  // Overflow that exceeds the region throws.
  fs.writeFileSync(path.join(banks, 'Bank57.asm'), 'DATA_X:\n\tincbin "Graphics/GFX_X.lz16"\n\n\t%FREE_BYTES($5F8A36, 2378, $FF)\n');
  fs.writeFileSync(path.join(banks, 'Bank51.asm'), 'X:\n\t%FREE_BYTES($515348, 100, $FF)\n');
  let threw = false;
  try { relocateGfxBlobs(root, [{ file: 'Graphics/GFX_X.lz16', overlaySize: 500, baseSize: 0 }], [{ ...region51, capacityBytes: 100 }]); } catch { threw = true; }
  assert(threw, "doesn't-fit relocation throws");
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('\n=== applyGfxLayout (boundary move composes with overlay edits in Bank57) ===');
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gfxapply-'));
  const banks = path.join(root, 'Banks');
  fs.mkdirSync(banks, { recursive: true });
  // The build-tree's Bank57 = base ⊕ overlay: palette / gradient / island edits
  // (a `dw` line whose value differs from base) live in the SAME bank as the gfx
  // arena tail. Regression: the boundary move must KEEP that edit (it used to
  // re-read the bank from pristine base and silently drop every Bank57 overlay edit).
  const EDIT_LINE = '\tdw $01AB,$02CF,$03F5,$5951,$7A7B,$7AFF,$1D58,$467F';
  const bankWith = (freeBytes: string): string =>
    ['DATA_master_palette_rom_blob:', EDIT_LINE, '',
     'DATA_gfx_blob:', '\tincbin "Graphics/GFX_X.lz2"', '',
     `\t${freeBytes}`, ''].join('\n');

  // growth 143 → the proven e2e boundary ($5F8AC5, 2235).
  const plan = planGfxLayout(143, 2378);
  eq(plan.mode, 'boundary-move', 'growth 143 within 2378 slack → boundary-move');

  fs.writeFileSync(path.join(banks, 'Bank57.asm'), bankWith('%FREE_BYTES($5F8A36, 2378, $FF)'));
  applyGfxLayout(root, plan);
  let out = fs.readFileSync(path.join(banks, 'Bank57.asm'), 'utf8');
  assert(out.includes('%FREE_BYTES($5F8AC5, 2235, $FF)'), 'boundary moved ($5F8A36+143, 2378-143)');
  assert(!out.includes('%FREE_BYTES($5F8A36, 2378, $FF)'), 'pristine macro replaced');
  assert(out.includes(EDIT_LINE), 'overlay palette/gradient/island edit PRESERVED through the move');

  // Idempotent: re-applying onto a tree that already carries a stale move (the
  // no-Bank57-overlay repeat-build case) normalizes back to pristine, then moves
  // — same result, edit still intact.
  fs.writeFileSync(path.join(banks, 'Bank57.asm'), bankWith('%FREE_BYTES($5F8AC5, 2235, $FF)'));
  applyGfxLayout(root, plan);
  out = fs.readFileSync(path.join(banks, 'Bank57.asm'), 'utf8');
  assert(out.includes('%FREE_BYTES($5F8AC5, 2235, $FF)'), 'stale boundary normalized + re-moved → same value');
  assert((out.match(/%FREE_BYTES/g) ?? []).length === 1, 'still exactly one %FREE_BYTES (no double-move)');
  assert(out.includes(EDIT_LINE), 'overlay edit preserved on the idempotent re-apply too');

  // data-only plan touches nothing (the merged tree is already correct).
  fs.writeFileSync(path.join(banks, 'Bank57.asm'), bankWith('%FREE_BYTES($5F8A36, 2378, $FF)'));
  applyGfxLayout(root, planGfxLayout(-10, 2378));
  out = fs.readFileSync(path.join(banks, 'Bank57.asm'), 'utf8');
  assert(out.includes('%FREE_BYTES($5F8A36, 2378, $FF)') && out.includes(EDIT_LINE), 'data-only leaves the merged tree untouched');
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('\n=== writeGfxEdit (save side: edited tiles → overlay blob → decode) ===');
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gfxsave-'));
  const overlayAssets = path.join(root, 'assets/yi');
  // lz16: synthetic rc=4 tiles round-trip through the written overlay blob.
  const tiles = Uint8Array.from({ length: 4 * 512 }, (_, i) => (i * 7) & 0xff);
  const rel = writeGfxEdit(yiRoot, overlayAssets, 'lz16', 0, tiles, 4);
  eq(rel, 'Graphics/GFX_5CBA89.lz16', 'lz16 id 0 → overlay path');
  const wrote16 = new Uint8Array(fs.readFileSync(path.join(overlayAssets, rel)));
  const dec16 = new Uint8Array(4 * 512);
  lz16(wrote16, 0, dec16, 0, 4);
  assert(dec16.every((v, i) => v === tiles[i]), 'written lz16 overlay decodes to the edited tiles');
  // lz2: arbitrary bytes round-trip.
  const data = Uint8Array.from({ length: 1000 }, (_, i) => (i * 13) & 0xff);
  const rel2 = writeGfxEdit(yiRoot, overlayAssets, 'lz2', 0, data);
  eq(rel2, 'Graphics/GFX_573C00.lz2', 'lz2 id 0 → overlay path');
  const wrote2 = new Uint8Array(fs.readFileSync(path.join(overlayAssets, rel2)));
  const dec2 = new Uint8Array(1100);
  const r2 = lz2(wrote2, 0, dec2, 0);
  assert(r2.destEnd === data.length && dec2.subarray(0, data.length).every((v, i) => v === data[i]), 'written lz2 overlay decodes to the edited bytes');
  // lz16 without a rowCount is rejected.
  let threw = false;
  try { encodeGfxBlob('lz16', tiles); } catch { threw = true; }
  assert(threw, 'encodeGfxBlob lz16 requires rowCount');
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
