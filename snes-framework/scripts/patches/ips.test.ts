// Unit test: IPS codec. Synthetic cases are self-contained; the three real
// ../yi-patches/*.ips are round-tripped opportunistically when present (they're
// external, like the reference carts — skipped in their absence).
// Run: node snes-framework/scripts/patches/ips.test.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseIps, writeIps, flattenIps, expandRecord, type IpsRecord } from './ips.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}

const bytes = (...b: number[]): Uint8Array => Uint8Array.from(b);
const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));
const eq = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

console.log('=== literal record ===');
{
  // PATCH | off=0x000003 size=0x0002 data=AA BB | EOF
  const ips = bytes(...ascii('PATCH'), 0x00, 0x00, 0x03, 0x00, 0x02, 0xaa, 0xbb, ...ascii('EOF'));
  const p = parseIps(ips);
  assert(p.records.length === 1, 'one record');
  const r = p.records[0] as { offset: number; data: Uint8Array };
  assert(r.offset === 3, `offset 3 (got ${r.offset})`);
  assert(eq(r.data, bytes(0xaa, 0xbb)), 'data AA BB');
  assert(eq(writeIps(p), ips), 'literal round-trips byte-identically');
}

console.log('\n=== RLE record ===');
{
  // PATCH | off=0x000010 size=0 runLen=0x0004 value=0xEA | EOF
  const ips = bytes(...ascii('PATCH'), 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x04, 0xea, ...ascii('EOF'));
  const p = parseIps(ips);
  const r = p.records[0] as { offset: number; runLength: number; value: number };
  assert(r.runLength === 4 && r.value === 0xea, 'RLE 4×EA');
  const ex = expandRecord(r);
  assert(ex.offset === 0x10 && eq(ex.bytes, bytes(0xea, 0xea, 0xea, 0xea)), 'expands to 4×EA');
  assert(eq(writeIps(p), ips), 'RLE round-trips byte-identically');
}

console.log('\n=== truncate extension ===');
{
  const ips = bytes(...ascii('PATCH'), ...ascii('EOF'), 0x12, 0x34, 0x56);
  const p = parseIps(ips);
  assert(p.records.length === 0 && p.truncate === 0x123456, 'empty patch + truncate 0x123456');
  assert(eq(writeIps(p), ips), 'truncate round-trips');
}

console.log('\n=== flatten: coalesce + overlap ===');
{
  const recs: IpsRecord[] = [
    { offset: 0x100, data: bytes(1, 2) },     // [100,102)
    { offset: 0x102, data: bytes(3, 4) },     // abuts → merge
    { offset: 0x101, data: bytes(9) },        // overlaps → overwrite index 1
    { offset: 0x200, data: bytes(7) }         // disjoint → new span
  ];
  const spans = flattenIps({ records: recs });
  assert(spans.length === 2, `two spans (got ${spans.length})`);
  assert(spans[0].offset === 0x100 && eq(spans[0].bytes, bytes(1, 9, 3, 4)), 'coalesced + overwritten');
  assert(spans[1].offset === 0x200 && eq(spans[1].bytes, bytes(7)), 'disjoint span kept');
}

console.log('\n=== error cases ===');
{
  const threw = (f: () => unknown): boolean => { try { f(); return false; } catch { return true; } };
  assert(threw(() => parseIps(bytes(...ascii('NOPE!'), ...ascii('EOF')))), 'bad header throws');
  assert(threw(() => parseIps(bytes(...ascii('PATCH'), 0x00, 0x00))), 'truncated record throws');
  assert(threw(() => parseIps(bytes(...ascii('PATCH')))), 'missing EOF throws');
}

console.log('\n=== real ../yi-patches/*.ips round-trip (if present) ===');
{
  // test dir = <root>/snes-framework/scripts/patches → external dir is <root>/../yi-patches
  const dir = path.resolve(import.meta.dirname, '..', '..', '..', '..', 'yi-patches');
  if (!fs.existsSync(dir)) {
    console.log('  (skipped — yi-patches not present)');
  } else {
    for (const f of fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.ips'))) {
      const raw = fs.readFileSync(path.join(dir, f));
      const buf = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
      let p;
      try { p = parseIps(buf); } catch (e) {
        assert(false, `${f}: parse threw (${(e as Error).message})`);
        continue;
      }
      assert(eq(writeIps(p), buf), `${f}: round-trips byte-identically (${p.records.length} records)`);
    }
  }
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
