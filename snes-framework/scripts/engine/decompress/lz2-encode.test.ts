// Unit test: both LZ2 encoders round-trip through the LZ2 decoder, and the
// shipped one reproduces the cart's own parse byte-for-byte.
// Run: node snes-framework/scripts/engine/decompress/lz2-encode.test.ts
//
// The decoder (`lz2.ts`) is the ground-truth: it is byte-exact against both
// `decomp.exe FORMAT=1` and the SuperFX cart. So `lz2(encodeLz2(x)) === x` is a
// strong correctness gate. (Cross-checking the encoder against `decomp.exe`
// directly — proving the *cart* decoder accepts our streams too — is the job of
// the cart-gated `encode-verify.ts` dev harness.)
//
// The byte-exactness section is what pins `lz2-encode.ts`'s recovered parse:
// every extracted LZ2 blob must re-encode to the bytes it came from. It needs an
// extract, and skips cleanly without one.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { lz2 } from './lz2.ts';
import { encodeLz2 } from './lz2-encode.ts';
import { encodeLz2Improved } from './lz2-encode-improved.ts';

let failures = 0;
let checks = 0;
function assert(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

function roundTrip(data: Uint8Array, label: string): void {
  for (const [name, encode] of [
    ['exact', encodeLz2],
    ['improved', encodeLz2Improved],
  ] as const) {
    roundTripWith(encode, data, `${label} [${name}]`);
  }
  // `encodeLz2Improved` is a shortest-path parse, so it is never larger than
  // ANY valid parse of the same input — the cart's included. A heuristic that
  // crept back in would break this on some input long before it broke a
  // round-trip, which is what makes it worth asserting on every case.
  const exact = encodeLz2(data).length;
  const improved = encodeLz2Improved(data).length;
  assert(improved <= exact, `${label}: compact parse ≤ cart parse (${improved} vs ${exact})`);
}

function roundTripWith(
  encode: (d: Uint8Array) => Uint8Array,
  data: Uint8Array,
  label: string
): void {
  const enc = encode(data);
  const dest = new Uint8Array(data.length + 16);
  let ok = true;
  let detail = '';
  try {
    const r = lz2(enc, 0, dest, 0);
    if (r.destEnd !== data.length) {
      ok = false;
      detail = `decoded length ${r.destEnd} != ${data.length}`;
    } else {
      for (let i = 0; i < data.length; i++) {
        if (dest[i] !== data[i]) {
          ok = false;
          detail = `byte ${i}: got 0x${dest[i]!.toString(16)}, want 0x${data[i]!.toString(16)}`;
          break;
        }
      }
    }
  } catch (e) {
    ok = false;
    detail = String(e);
  }
  const ratio = data.length ? ((enc.length / data.length) * 100).toFixed(0) : '–';
  assert(ok, `${label} (${data.length}B → ${enc.length}B, ${ratio}%)${ok ? '' : ' — ' + detail}`);
}

// Deterministic PRNG so the test is reproducible.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s;
  };
}

console.log('=== LZ2 encode/decode round-trip ===');

// Degenerate / edge sizes.
roundTrip(new Uint8Array(0), 'empty');
roundTrip(new Uint8Array([0x42]), 'single byte');
roundTrip(new Uint8Array([0xff]), 'single 0xFF (terminator byte as data)');
roundTrip(new Uint8Array([1, 2, 3]), 'three bytes');

// Command-type exercisers.
roundTrip(new Uint8Array(1000).fill(0xab), 'run-byte: 1000× 0xAB');
roundTrip(new Uint8Array(64).fill(0x00), 'run-byte: 64× 0x00 (all zero)');
roundTrip(
  Uint8Array.from({ length: 500 }, (_, i) => (i & 1 ? 0xcd : 0xab)),
  'alternating: 0xAB,0xCD ×250'
);
roundTrip(
  Uint8Array.from({ length: 300 }, (_, i) => i & 0xff),
  'incrementing: 0,1,2,…(wraps)'
);
{
  // Backref: a repeated chunk.
  const chunk = Uint8Array.from({ length: 37 }, (_, i) => (i * 7 + 3) & 0xff);
  const buf = new Uint8Array(chunk.length * 8);
  for (let i = 0; i < 8; i++) buf.set(chunk, i * chunk.length);
  roundTrip(buf, 'backref: 37-byte chunk ×8');
}
{
  // Backref with overlap (period-3 run → tests the periodic match extension).
  const buf = new Uint8Array(200);
  buf[0] = 0x10;
  buf[1] = 0x20;
  buf[2] = 0x30;
  for (let i = 3; i < buf.length; i++) buf[i] = buf[i - 3]!;
  roundTrip(buf, 'backref overlap: period-3 pattern ×200');
}

// Long-form lengths (> 32 bytes per command).
roundTrip(new Uint8Array(1024).fill(0x5a), 'long-form run-byte: 1024× 0x5A');
roundTrip(new Uint8Array(2500).fill(0x99), 'run-byte > 1024 (splits into commands)');

// The exact encoder's per-command caps (fill 1024, word 1023, backref 512) are
// non-uniform and each one re-scans from the capped position, so exercise runs
// that cross every cap — an off-by-one there survives cart data (whose longest
// literal run is only 386 bytes) but corrupts an edited blob.
roundTrip(
  Uint8Array.from({ length: 3000 }, (_, i) => (i & 1 ? 0x0f : 0xf0)),
  'alternating > 1023 (word cap, re-scans twice)'
);
{
  const chunk = Uint8Array.from({ length: 700 }, (_, i) => (i * 31 + 11) & 0xff);
  const buf = new Uint8Array(chunk.length * 3);
  for (let i = 0; i < 3; i++) buf.set(chunk, i * chunk.length);
  roundTrip(buf, 'backref > 512 (match cap, re-scans)');
}

// Random data (mostly literals — stresses the literal-chunk splitter).
{
  const rng = lcg(0xc0ffee);
  roundTrip(Uint8Array.from({ length: 4096 }, () => rng() & 0xff), 'random 4096B');
}

// Mixed realistic-ish content: runs + literals + repeats.
{
  const rng = lcg(0x1234);
  const parts: number[] = [];
  for (let i = 0; i < 200; i++) {
    const k = rng() % 4;
    if (k === 0) for (let j = 0; j < (rng() % 40) + 1; j++) parts.push(0x00);
    else if (k === 1) for (let j = 0; j < (rng() % 20) + 1; j++) parts.push(rng() & 0xff);
    else if (k === 2) for (let j = 0; j < (rng() % 30) + 1; j++) parts.push((j & 1) ? 0xf0 : 0x0f);
    else parts.push(...parts.slice(Math.max(0, parts.length - 16)));
  }
  roundTrip(Uint8Array.from(parts), 'mixed runs/literals/alt/repeat');
}

// ── byte-exactness against the cart's own parse ─────────────────────────────
//
// `encodeLz2` is not merely *a* valid encoder: it reproduces the parse the ROM
// shipped, which is what keeps an unedited blob's bytes (and every address after
// it) identical on rebuild. Re-encode every extracted blob and demand identity.
//
// The four `.lz2`-named blobs that are really orphaned LZ16 sheets (gfx IDs
// $2C-$2F, see research/notes-rom-import-lz2-overread.md) do not decode as LZ2
// at all; they are counted as skipped, not as failures.

console.log(`  ✓ ${checks} round-trips (both encoders × every case)`);

console.log('\n=== LZ2 encoder reproduces the cart parse ===');
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const assetsYi = path.resolve(here, '../../../assets/yi');
  const blobs: string[] = [];
  for (const dir of ['Graphics', 'Tilemaps']) {
    const d = path.join(assetsYi, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) if (f.endsWith('.lz2')) blobs.push(path.join(d, f));
  }
  if (blobs.length === 0) {
    console.log('  – skipped: no extracted .lz2 blobs (run an extract first)');
  } else {
    let exact = 0;
    let notLz2 = 0;
    let cartBytes = 0;
    let compactBytes = 0;
    const tooBig: string[] = [];
    const mismatched: string[] = [];
    for (const file of blobs.sort()) {
      const blob = new Uint8Array(fs.readFileSync(file));
      const dest = new Uint8Array(0x10000);
      let end: number;
      let consumed: number;
      try {
        const r = lz2(blob, 0, dest, 0);
        end = r.destEnd;
        consumed = r.srcEnd;
      } catch {
        notLz2++;
        continue;
      }
      if (consumed !== blob.length) {
        notLz2++; // over-reads its own slot, so it isn't self-contained LZ2
        continue;
      }
      const raw = dest.subarray(0, end);
      const enc = encodeLz2(raw);
      if (enc.length === blob.length && enc.every((b, i) => b === blob[i])) exact++;
      else mismatched.push(`${path.basename(file)} (${blob.length}B → ${enc.length}B)`);
      cartBytes += blob.length;
      const improved = encodeLz2Improved(raw).length;
      compactBytes += improved;
      if (improved > blob.length) tooBig.push(path.basename(file));
    }
    assert(
      mismatched.length === 0,
      `${exact}/${exact + mismatched.length} blobs re-encode byte-exact ` +
        `(${notLz2} non-LZ2 skipped)` +
        (mismatched.length ? ` — ${mismatched.slice(0, 5).join(', ')}` : '')
    );
    if (mismatched.length === 0) {
      console.log(`  ✓ ${exact} blobs re-encode byte-exact (${notLz2} non-LZ2 skipped)`);
    }
    assert(
      tooBig.length === 0,
      `compact parse never exceeds the cart's own${tooBig.length ? ` — ${tooBig.slice(0, 5).join(', ')}` : ''}`
    );
    if (cartBytes) {
      const pct = ((compactBytes / cartBytes - 1) * 100).toFixed(1);
      console.log(`  ✓ compact parse totals ${compactBytes}B vs the cart's ${cartBytes}B (${pct}%)`);
    }
  }
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
