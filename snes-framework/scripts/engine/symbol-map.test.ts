// Unit test: parseWlaSymbolMap against synthetic .sym text.
// Run: node --experimental-strip-types snes-framework/scripts/engine/symbol-map.test.ts

import { isFriendlyLabel, mergeSymbolMaps, parseWlaSymbolMap, snesToPC } from './symbol-map.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}

console.log('=== snesToPC ===');
assert(snesToPC(0x008000) === 0x000000, 'LoROM $00:8000 → PC 0');
assert(snesToPC(0x00B78A) === 0x00378A, 'LoROM $00:B78A → PC 0x378A');
assert(snesToPC(0x3FA000) === 0x1FA000, 'LoROM $3F:A000 → PC 0x1FA000');
assert(snesToPC(0x4C32A4) === 0x0C32A4, 'SuperFX $4C:32A4 → PC 0x0C32A4');
assert(snesToPC(0x5FA000) === 0x1FA000, 'SuperFX $5F:A000 → PC 0x1FA000 (= LoROM $3F:A000)');
assert(snesToPC(0xC03000) === 0x003000, 'HiROM mirror $C0:3000 → PC 0x3000');

console.log('\n=== parseWlaSymbolMap ===');
{
  const sym = `; this file was created by asar
[labels]
00:8000 chip_entry
00:378A DATA_scene_palette_layout
00:3874 DATA_bg1_palette_ptrs
3F:A000 palette_blob_base
`;
  const map = parseWlaSymbolMap(sym);
  assert(map.size === 4, `expected 4 labels, got ${map.size}`);
  assert(map.pc('chip_entry') === 0x0000, 'chip_entry @ PC 0');
  assert(map.pc('DATA_scene_palette_layout') === 0x378A, 'DATA_scene_palette_layout @ PC 0x378A');
  assert(map.pc('DATA_bg1_palette_ptrs') === 0x3874, 'DATA_bg1_palette_ptrs @ PC 0x3874');
  assert(map.pc('palette_blob_base') === 0x1FA000, 'palette_blob_base @ PC 0x1FA000');
}

console.log('\n=== missing label ===');
{
  const map = parseWlaSymbolMap('[labels]\n00:0000 foo\n');
  assert(map.tryPc('foo') === 0, 'tryPc foo');
  assert(map.tryPc('bar') === undefined, 'tryPc missing returns undefined');
  let threw = false;
  try { map.pc('bar'); } catch (e) { threw = e instanceof Error; }
  assert(threw, 'pc(missing) throws');
}

console.log('\n=== other sections ignored ===');
{
  const sym = `; comment
[labels]
00:8000 in_labels
[symbols]
00:9000 in_symbols_should_be_ignored
[labels]
00:A000 back_in_labels
`;
  const map = parseWlaSymbolMap(sym);
  assert(map.size === 2, `should have 2 labels (got ${map.size})`);
  assert(map.tryPc('in_labels') === 0x0000, 'in_labels found');
  assert(map.tryPc('in_symbols_should_be_ignored') === undefined, 'symbols section ignored');
  assert(map.tryPc('back_in_labels') === 0x2000, 'back_in_labels found');
}

console.log('\n=== whitespace + comments tolerated ===');
{
  const sym = `[labels]
  00:8000 leading_space  ; trailing comment
00:8002 normal


00:8004 after_blank_lines
`;
  const map = parseWlaSymbolMap(sym);
  assert(map.size === 3, `should have 3 labels (got ${map.size})`);
  assert(map.tryPc('leading_space') === 0, 'leading_space found');
  assert(map.tryPc('after_blank_lines') === 4, 'after_blank_lines found');
}

console.log('\n=== bad hex throws ===');
{
  let threw = false;
  try { parseWlaSymbolMap('[labels]\nzz:0000 broken\n'); } catch (e) { threw = e instanceof Error; }
  assert(threw, 'bad bank hex throws');
}

console.log('\n=== reverseLookup ===');
{
  // PCs: foo=0x0000, bar=0x0100, baz=0x0100 (alias), qux=0x0200
  const sym = `[labels]
00:8000 foo
00:8100 bar
00:8100 baz
00:8200 qux
`;
  const map = parseWlaSymbolMap(sym);
  assert(map.reverseLookup(0x0000)?.delta === 0, 'exact hit → delta 0');
  assert(map.reverseLookup(0x0000)?.label === 'foo', 'exact hit → foo');
  assert(map.reverseLookup(0x00ff)?.label === 'foo', 'just before bar → foo');
  assert(map.reverseLookup(0x00ff)?.delta === 0xff, 'delta 0xff past foo');
  // every label round-trips with delta 0
  for (const l of map.labels()) {
    const r = map.reverseLookup(map.pc(l));
    assert(r !== undefined && r.delta === 0, `${l} round-trips with delta 0`);
  }
  // alias group (both friendly): deterministic alphabetically-first label
  assert(map.reverseLookup(0x0100)?.label === 'bar', 'alias group → alphabetically first (bar)');
  assert(map.reverseLookup(0x0108)?.delta === 8, 'delta 8 into alias-pc region');
  // before every label → undefined (smallest pc here is 0)
  const m2 = parseWlaSymbolMap('[labels]\n00:8100 only\n');
  assert(m2.reverseLookup(0x0000) === undefined, 'pc before all labels → undefined');
  assert(m2.reverseLookup(0x0100)?.delta === 0, 'pc at the only label → delta 0');
}

console.log('\n=== isFriendlyLabel + friendly-alias preference ===');
{
  assert(isFriendlyLabel('YI_NorSpr065_RedCoin_Init'), 'hand-named → friendly');
  assert(isFriendlyLabel('DATA_scene_palette_layout'), 'DATA_ + words → friendly');
  assert(!isFriendlyLabel('CODE_02AD48'), 'CODE_ + 6 hex → auto');
  assert(!isFriendlyLabel('DATA_0AF7E1'), 'DATA_ + 6 hex → auto');
  assert(!isFriendlyLabel('ADDR_0080F8'), 'ADDR_ + 6 hex → auto');
  // auto + friendly alias at one address → reverseLookup returns the friendly one
  const sym = parseWlaSymbolMap(`[labels]
00:8200 CODE_018200
00:8200 init_red_coin
`);
  assert(sym.reverseLookup(0x0205)?.label === 'init_red_coin', 'prefers friendly alias for display');
  assert(sym.reverseLookup(0x0205)?.delta === 5, 'delta preserved through alias preference');
}

console.log('\n=== mergeSymbolMaps (complete map, primary wins, reverseLookup spans both) ===');
{
  const a = parseWlaSymbolMap('[labels]\n00:8000 main_a\n00:8100 shared\n');
  const b = parseWlaSymbolMap('[labels]\n40:0050 fx_b\n00:8100 shared_other\n');
  const m = mergeSymbolMaps(a, b);
  assert(m.tryPc('main_a') === 0x0000 && m.tryPc('fx_b') === 0x0050, 'labels from both maps present');
  // reverseLookup works on the merged map (was the latent bug: shallow merge lacked it)
  assert(m.reverseLookup(0x0055)?.label === 'fx_b', 'merged reverseLookup spans the secondary map');
  assert(typeof m.reverseLookup === 'function', 'merged map carries reverseLookup');
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
