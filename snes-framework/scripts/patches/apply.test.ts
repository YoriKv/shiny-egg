// Unit test: custom-patch apply core (hex codec / build-time remap / apply).
// Run: node snes-framework/scripts/patches/apply.test.ts

import { parseWlaSymbolMap } from '../engine/symbol-map.ts';
import { storedSnesChecksum } from './checksum.ts';
import {
  applyPatches,
  bytesToHex,
  hexToBytes,
  chunksToStored,
  remapChunk,
  resolveChunkTarget,
  storedToChunks,
  validateChunkAddressing,
  type AppliedPatch
} from './apply.ts';
import type { PatchChunk } from '../types.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}
const bytes = (...b: number[]): Uint8Array => Uint8Array.from(b);

// Reference symbols (where a patch's offsets are valid): foo@PC0x0040, bar@PC0x0100.
const refSym = parseWlaSymbolMap('[labels]\n00:8040 foo\n00:8100 bar\n');
// A drifted build: bar moved +0x20 (e.g. asm inserted before it), foo unchanged.
const buildSym = parseWlaSymbolMap('[labels]\n00:8040 foo\n00:8120 bar\n');

console.log('=== hex codec + PatchFile chunk round-trip ===');
{
  assert(bytesToHex(bytes(0xea, 0x00, 0xff)) === 'EA00FF', 'bytesToHex uppercase');
  assert(Array.from(hexToBytes('ea00ff')).join(',') === '234,0,255', 'hexToBytes (lowercase ok)');
  const threw = (f: () => unknown): boolean => { try { f(); return false; } catch { return true; } };
  assert(threw(() => hexToBytes('abc')), 'odd-length hex throws');
  assert(threw(() => hexToBytes('zz')), 'non-hex throws');
  const chunks: PatchChunk[] = [{ offset: 0x100, bytes: bytes(0xaa, 0xbb) }, { offset: 0x200, bytes: bytes(0xcc) }];
  const stored = chunksToStored(chunks);
  assert(stored[0].offset === '0x100' && stored[0].bytes === 'AABB', 'stored chunk = hex offset + hex bytes');
  const back = storedToChunks(stored);
  assert(back[0].bytes[1] === 0xbb && back[1].offset === 0x200 && back[1].bytes[0] === 0xcc, 'round-trips');
}

console.log('\n=== $NN / 0xNN hex formats are equivalent across patch fields ===');
{
  // bytes: packed, $NN-prefixed, 0xNN-prefixed, and separated all decode the same.
  const want = '170,187,204'; // AA BB CC
  assert(Array.from(hexToBytes('AABBCC')).join(',') === want, 'bytes: packed');
  assert(Array.from(hexToBytes('$AA $BB $CC')).join(',') === want, 'bytes: $NN-prefixed + spaces');
  assert(Array.from(hexToBytes('0xAA, 0xBB, 0xCC')).join(',') === want, 'bytes: 0xNN-prefixed + commas');
  assert(Array.from(hexToBytes('AA bb,CC')).join(',') === want, 'bytes: bare with mixed separators');
  // offset: "$.." and "0x.." parse to the same number (treated identically).
  const oa = storedToChunks([{ offset: '$66971', bytes: '80' }])[0].offset;
  const ob = storedToChunks([{ offset: '0x66971', bytes: '80' }])[0].offset;
  assert(oa === 0x66971 && oa === ob, 'offset: "$NN" === "0xNN"');
  // labelOffset: "$.." and "0x.." parse to the same number.
  const la = storedToChunks([{ label: 'bar', labelOffset: '$1F', bytes: '80' }])[0].labelOffset;
  const lb = storedToChunks([{ label: 'bar', labelOffset: '0x1F', bytes: '80' }])[0].labelOffset;
  assert(la === 0x1f && la === lb, 'labelOffset: "$NN" === "0xNN"');
}

console.log('\n=== remapChunk (build-time drift tracking) ===');
{
  // identity when ref === build: foo@0x40, reference 0x48 → foo+8 → 0x48.
  const same = remapChunk(0x0048, refSym, refSym);
  assert(same.offset === 0x0048 && same.resolvedVia === 'label' && same.label === 'foo', 'identity remap → same offset');
  // drift: reference 0x108 → bar+8; bar moved to 0x120 → 0x128.
  const drifted = remapChunk(0x0108, refSym, buildSym);
  assert(drifted.offset === 0x0128 && drifted.label === 'bar', 'drift remap shifts by the label move');
  // before any label → absolute, raw offset.
  assert(remapChunk(0x0010, refSym, buildSym).resolvedVia === 'absolute', 'offset before all labels → absolute');
  // no reference symbols → raw offset.
  assert(remapChunk(0x0048, null, buildSym).offset === 0x0048, 'no refSym → raw offset');
  // anchor label vanished from the build → fall back + flag.
  const gone = parseWlaSymbolMap('[labels]\n00:8040 foo\n');
  const r = remapChunk(0x0108, refSym, gone);
  assert(r.offset === 0x0108 && r.unresolvedLabel === 'bar', 'vanished anchor → reference offset + unresolved flag');
}

console.log('\n=== applyPatches: drift tracking end-to-end ===');
{
  const rom = new Uint8Array(0x8000);
  const patches: AppliedPatch[] = [{ id: 'p', chunks: [{ offset: 0x0108, bytes: bytes(0x11) }] }];
  const rep = applyPatches(rom, refSym, buildSym, patches);
  assert(rom[0x0128] === 0x11 && rom[0x0108] === 0, 'byte lands at the drifted address, not the reference one');
  assert(rep.chunks[0].resolvedVia === 'label' && rep.chunks[0].offset === 0x0128, 'report records the remap');
  assert(rep.checksum === storedSnesChecksum(rom), 'checksum fixed in place');
}

console.log('\n=== applyPatches: identity (ref === build) writes at raw offset ===');
{
  const rom = new Uint8Array(0x8000);
  applyPatches(rom, refSym, refSym, [{ id: 'p', chunks: [{ offset: 0x0200, bytes: bytes(0x22) }] }]);
  assert(rom[0x0200] === 0x22, 'un-drifted build → reference offset honoured');
}

console.log('\n=== applyPatches: out-of-bounds skipped ===');
{
  const rom = new Uint8Array(0x8000);
  const rep = applyPatches(rom, refSym, refSym, [{ id: 'p', chunks: [{ offset: 0x7fff, bytes: bytes(1, 2, 3) }] }]);
  assert(rep.bytesWritten === 0 && rep.skipped.length === 1, 'oob chunk skipped, nothing written');
  assert(rep.applied.length === 0, 'patch with only-oob chunks not marked applied');
}

console.log('\n=== applyPatches: nothing applied → ROM untouched ===');
{
  const rom = new Uint8Array(0x8000);
  rom[0x7fdc] = 0xde; rom[0x7fdd] = 0xad; rom[0x7fde] = 0xbe; rom[0x7fdf] = 0xef;
  const rep = applyPatches(rom, refSym, buildSym, []);
  assert(rep.bytesWritten === 0 && rom[0x7fdc] === 0xde && rom[0x7fdf] === 0xef, 'no patches → byte-exact');
}

console.log('\n=== applyPatches: conflict detection (last wins) ===');
{
  const rom = new Uint8Array(0x8000);
  const patches: AppliedPatch[] = [
    { id: 'a', chunks: [{ offset: 0x0400, bytes: bytes(1, 1, 1, 1) }] }, // [0x400,0x404)
    { id: 'b', chunks: [{ offset: 0x0402, bytes: bytes(2, 2, 2, 2) }] }  // [0x402,0x406)
  ];
  const rep = applyPatches(rom, refSym, refSym, patches);
  assert(rom[0x0401] === 1 && rom[0x0403] === 2, 'b overwrites a in the overlap');
  assert(rep.conflicts.length === 1 && rep.conflicts[0].offset === 0x0402 && rep.conflicts[0].length === 2, 'overlap reported');
  assert(sameSet(rep.conflicts[0].patchIds, ['a', 'b']), 'both patches credited');
}
function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && new Set([...a, ...b]).size === a.length;
}

console.log('\n=== applyPatches: version mismatch warning (no remap available) ===');
{
  const rom = new Uint8Array(0x8000);
  // null refSym → no remap → absolute; authored-vs-target mismatch warns.
  const rep = applyPatches(rom, null, buildSym, [{ id: 'v', chunks: [{ offset: 0x0500, bytes: bytes(1) }], romVersionAuthored: 'YI_U1' }], 'YI_U2');
  assert(rep.warnings.some((w) => w.includes('YI_U1') && w.includes('YI_U2')), 'warned on cross-version apply without remap');
}

console.log('\n=== label-addressed chunks (sym label + labelOffset, resolved against build) ===');
{
  const threw = (f: () => unknown): boolean => { try { f(); return false; } catch { return true; } };
  // addressing validation: exactly one of offset / label.
  assert(threw(() => validateChunkAddressing({ offset: 1, label: 'x' })), 'both offset+label → throws');
  assert(threw(() => validateChunkAddressing({})), 'neither offset nor label → throws');
  assert(!threw(() => validateChunkAddressing({ label: 'bar' })), 'label-only → ok');
  assert(!threw(() => validateChunkAddressing({ offset: 1 })), 'offset-only → ok');
  // round-trip preserves label+labelOffset (labelOffset stored as a hex string).
  const st = chunksToStored([{ label: 'bar', labelOffset: 0x1f, bytes: bytes(0x99) }]);
  assert(st[0].label === 'bar' && st[0].labelOffset === '0x1F' && st[0].offset === undefined, 'stored label-chunk keeps label + hex labelOffset, no offset');
  const back = storedToChunks(st);
  assert(back[0].label === 'bar' && back[0].labelOffset === 0x1f && back[0].bytes[0] === 0x99, 'label-chunk round-trips');
  // legacy decimal-number labelOffset still parses (back-compat with older files).
  const legacy = storedToChunks([{ label: 'bar', labelOffset: 4 as unknown as string, bytes: '99' }]);
  assert(legacy[0].labelOffset === 4, 'legacy decimal labelOffset still parses to its number');
  // resolve: bar lives at 0x120 in the build; +4 → 0x124. NO reverse-lookup, NO ref needed.
  const r = resolveChunkTarget({ label: 'bar', labelOffset: 4, bytes: bytes(0) }, null, buildSym);
  assert(r.offset === 0x0124 && r.resolvedVia === 'label' && r.label === 'bar', 'label+labelOffset resolves directly against the build symbols');
  // labelOffset defaults to 0.
  assert(resolveChunkTarget({ label: 'bar', bytes: bytes(0) }, null, buildSym).offset === 0x0120, 'label without labelOffset → label address');
  // missing label → unresolvable (offset -1), flagged.
  const miss = resolveChunkTarget({ label: 'nope', bytes: bytes(0) }, null, buildSym);
  assert(miss.offset === -1 && miss.unresolvedLabel === 'nope' && miss.resolvedVia === 'label', 'missing label → offset -1 + unresolved flag');
}

console.log('\n=== applyPatches: label-addressed chunk lands at the build label (drift-immune) ===');
{
  const rom = new Uint8Array(0x8000);
  // bar@0x120 in build; +8 → 0x128. Same target as the drifted offset-form, but stated directly.
  const rep = applyPatches(rom, refSym, buildSym, [{ id: 'L', chunks: [{ label: 'bar', labelOffset: 8, bytes: bytes(0x77) }] }]);
  assert(rom[0x0128] === 0x77, 'label-form byte lands at build label + labelOffset');
  assert(rep.chunks[0].resolvedVia === 'label' && rep.chunks[0].label === 'bar', 'report records the label resolution');
  // a vanished label is FATAL (no silent skip): applyPatches throws, ROM untouched.
  const rom2 = new Uint8Array(0x8000);
  let missingErr: Error | null = null;
  try {
    applyPatches(rom2, refSym, buildSym, [{ id: 'M', chunks: [{ label: 'ghost', bytes: bytes(0x55) }] }]);
  } catch (e) {
    missingErr = e as Error;
  }
  assert(missingErr !== null && missingErr.message.includes('ghost'), 'missing label → throws naming the label');
  assert(rom2.every((b) => b === 0), 'missing label → ROM left untouched');
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
