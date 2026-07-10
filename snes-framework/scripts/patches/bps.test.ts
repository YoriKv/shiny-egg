// Unit test: BPS codec. Encoder cases round-trip through applyBps; the decoder's
// SourceCopy/TargetCopy actions (which our linear encoder never emits) are pinned
// with hand-built patches, so foreign patches from delta encoders stay covered.
// Run: node snes-framework/scripts/patches/bps.test.ts

import { applyBps, bpsInfo, crc32, diffSpans, encodeBps } from './bps.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}

const bytes = (...b: number[]): Uint8Array => Uint8Array.from(b);
const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));
const eq = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);
const threw = (f: () => unknown): string | null => {
  try { f(); return null; } catch (e) { return (e as Error).message; }
};

/** The BPS varint (little-endian base-128, +shift bias, high bit = final byte) —
 *  reimplemented here so the hand-built patches don't lean on the encoder under test. */
function vint(value: number): number[] {
  const out: number[] = [];
  let data = value;
  for (;;) {
    const x = data & 0x7f;
    data = Math.floor(data / 128);
    if (data === 0) { out.push(0x80 | x); break; }
    out.push(x);
    data--;
  }
  return out;
}

/** Assemble a raw BPS from parts, computing the three footer CRCs. */
function buildBps(source: Uint8Array, target: Uint8Array, commands: number[]): Uint8Array {
  const body = [...ascii('BPS1'), ...vint(source.length), ...vint(target.length), ...vint(0), ...commands];
  const u32 = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
  body.push(...u32(crc32(source)), ...u32(crc32(target)));
  body.push(...u32(crc32(Uint8Array.from(body))));
  return Uint8Array.from(body);
}

const cmd = (action: number, length: number): number[] => vint((length - 1) * 4 + action);
const signedOff = (n: number): number[] => vint(n < 0 ? -n * 2 + 1 : n * 2);

console.log('=== crc32 known vector ===');
{
  assert(crc32(bytes(...ascii('123456789'))) === 0xcbf43926, 'crc32("123456789") = 0xCBF43926');
  assert(crc32(bytes()) === 0, 'crc32(empty) = 0');
}

console.log('\n=== encode → apply round-trips ===');
{
  const cases: Array<[string, Uint8Array, Uint8Array]> = [
    ['identical files', bytes(1, 2, 3, 4, 5, 6, 7, 8), bytes(1, 2, 3, 4, 5, 6, 7, 8)],
    ['fully different', bytes(1, 2, 3, 4), bytes(9, 8, 7, 6)],
    ['scattered edits', Uint8Array.from({ length: 64 }, (_, i) => i), (() => {
      const t = Uint8Array.from({ length: 64 }, (_, i) => i);
      t[5] = 0xaa; t[6] = 0xbb; t[40] = 0xcc; t[63] = 0xdd; // short-gap edits fold into one TargetRead
      return t;
    })()],
    ['short match folded into literals', bytes(1, 2, 3, 4, 5, 6), bytes(9, 2, 3, 8, 5, 7)],
    ['target longer (append)', bytes(1, 2, 3), bytes(1, 2, 3, 4, 5, 6)],
    ['target shorter (truncate)', bytes(1, 2, 3, 4, 5, 6), bytes(1, 2, 3)],
    ['empty source', bytes(), bytes(1, 2, 3)],
    ['empty target', bytes(1, 2, 3), bytes()]
  ];
  for (const [name, source, target] of cases) {
    const patch = encodeBps(source, target);
    const { target: applied } = applyBps(patch, source);
    assert(eq(applied, target), `${name}: applies back to the target`);
    const info = bpsInfo(patch);
    assert(info.sourceSize === source.length && info.targetSize === target.length, `${name}: sizes in header`);
    assert(info.patchCrcOk, `${name}: patch CRC self-consistent`);
  }

  // An identical-files patch should be one SourceRead — a handful of bytes, not O(size).
  const same = Uint8Array.from({ length: 4096 }, (_, i) => i & 0xff);
  assert(encodeBps(same, same).length < 24, 'identical 4 KB files → tiny patch');
}

console.log('\n=== metadata ===');
{
  const source = bytes(1, 2, 3);
  const target = bytes(4, 5, 6);
  const meta = Uint8Array.from(ascii('<hello/>'));
  const patch = encodeBps(source, target, meta);
  const r = applyBps(patch, source);
  assert(eq(r.metadata, meta), 'metadata rides through encode → apply');
  assert(eq(r.target, target), 'metadata does not disturb the target');
}

console.log('\n=== hand-built SourceCopy + TargetCopy ===');
{
  // source: 10 20 30 40 50 → target: 10 20 10 20 10 20 30 99
  //   SourceRead 2            → 10 20
  //   TargetCopy 4 @ +0       → 10 20 10 20  (reads bytes 0-3 while writing 2-5: overlap)
  //   SourceCopy 1 @ +2       → 30           (source cursor jumps 0 → 2)
  //   TargetRead 1: 99        → 99
  const source = bytes(10, 20, 30, 40, 50);
  const target = bytes(10, 20, 10, 20, 10, 20, 30, 99);
  const patch = buildBps(source, target, [
    ...cmd(0, 2),
    ...cmd(3, 4), ...signedOff(0),
    ...cmd(2, 1), ...signedOff(2),
    ...cmd(1, 1), 99
  ]);
  const { target: applied } = applyBps(patch, source);
  assert(eq(applied, target), 'all four actions compose correctly');
}
{
  // TargetCopy forward-overlap = RLE: write one byte, then copy 5 from offset 0.
  const source = bytes();
  const target = bytes(0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa);
  const patch = buildBps(source, target, [
    ...cmd(1, 1), 0xaa,
    ...cmd(3, 5), ...signedOff(0)
  ]);
  const { target: applied } = applyBps(patch, source);
  assert(eq(applied, target), 'TargetCopy forward overlap RLE-repeats');
}
{
  // Negative offset delta: source cursor advances then jumps back.
  // source: 1 2 3 4 → target: 3 4 1 2
  const source = bytes(1, 2, 3, 4);
  const target = bytes(3, 4, 1, 2);
  const patch = buildBps(source, target, [
    ...cmd(2, 2), ...signedOff(2),  // cursor 0 → 2, copy 3 4 (cursor now 4)
    ...cmd(2, 2), ...signedOff(-4)  // cursor 4 → 0, copy 1 2
  ]);
  const { target: applied } = applyBps(patch, source);
  assert(eq(applied, target), 'negative SourceCopy offset');
}

console.log('\n=== diffSpans (exact spans, no gap-merging) ===');
{
  const src = bytes(0, 1, 2, 3, 4, 5, 6, 7);
  assert(diffSpans(src, Uint8Array.from(src)).length === 0, 'identical files → no spans');

  // Two edits separated by ONE unchanged byte must stay two spans — the
  // last-wins layering contract (never write back an unchanged gap byte).
  const t1 = Uint8Array.from(src);
  t1[2] = 0xaa;
  t1[4] = 0xbb;
  const s1 = diffSpans(src, t1);
  assert(s1.length === 2, 'one-byte gap keeps spans separate');
  assert(s1[0].offset === 2 && eq(s1[0].bytes, bytes(0xaa)), 'first span exact');
  assert(s1[1].offset === 4 && eq(s1[1].bytes, bytes(0xbb)), 'second span exact');

  // Contiguous run coalesces; spans at both ends are covered.
  const t2 = Uint8Array.from(src);
  t2[0] = 0x90;
  t2[5] = 0x91;
  t2[6] = 0x92;
  t2[7] = 0x93;
  const s2 = diffSpans(src, t2);
  assert(s2.length === 2, 'edge edits → two spans');
  assert(s2[0].offset === 0 && eq(s2[0].bytes, bytes(0x90)), 'span at file start');
  assert(s2[1].offset === 5 && eq(s2[1].bytes, bytes(0x91, 0x92, 0x93)), 'contiguous run coalesces to file end');

  assert(threw(() => diffSpans(src, bytes(1, 2)))?.includes('sizes differ') === true, 'length mismatch throws');

  // Consistency with the codec: applying an encoded patch then diffing
  // reproduces exactly the changed bytes.
  const s3 = diffSpans(src, applyBps(encodeBps(src, t1), src).target);
  assert(s3.length === 2 && s3[0].offset === 2 && s3[1].offset === 4, 'diff of applied patch matches the edits');
}

console.log('\n=== error cases ===');
{
  const source = bytes(1, 2, 3, 4);
  const target = bytes(1, 9, 3, 4);
  const good = encodeBps(source, target);

  assert(threw(() => bpsInfo(bytes(...ascii('IPS1'), 0, 0, 0)))?.includes('BPS1') === true, 'bad magic throws');
  assert(threw(() => applyBps(good.subarray(0, good.length - 5), source)) !== null, 'truncated patch throws');

  const corrupt = Uint8Array.from(good);
  corrupt[6] ^= 0xff;
  assert(threw(() => applyBps(corrupt, source))?.includes('corrupt') === true, 'flipped byte → patch CRC error');

  const wrongSource = bytes(1, 2, 3, 5);
  assert(threw(() => applyBps(good, wrongSource))?.includes('different base ROM') === true, 'wrong source → source CRC error');
  assert(threw(() => applyBps(good, bytes(1, 2, 3)))?.includes('size mismatch') === true, 'short source → size error');

  // Command that writes past the declared target size.
  const overrun = buildBps(source, target, [...cmd(1, 8), 1, 2, 3, 4, 5, 6, 7, 8]);
  assert(threw(() => applyBps(overrun, source))?.includes('past the end') === true, 'target overrun throws');

  // TargetCopy reading output that hasn't been written yet.
  const unwritten = buildBps(source, target, [...cmd(3, 4), ...signedOff(0)]);
  assert(threw(() => applyBps(unwritten, source))?.includes('unwritten') === true, 'TargetCopy from unwritten output throws');

  // Too few produced bytes (commands end early) → byte-count error.
  const short = buildBps(source, target, [...cmd(0, 2)]);
  assert(threw(() => applyBps(short, source))?.includes('2 of 4') === true, 'underproduced target throws');
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
