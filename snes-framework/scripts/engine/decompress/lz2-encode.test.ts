// Unit test: LZ2 encoder round-trips through the LZ2 decoder.
// Run: node --experimental-strip-types snes-framework/scripts/engine/decompress/lz2-encode.test.ts
//
// The decoder (`lz2.ts`) is the ground-truth: it is byte-exact against both
// `decomp.exe FORMAT=1` and the SuperFX cart. So `lz2(encodeLz2(x)) === x` is a
// strong correctness gate. (Cross-checking the encoder against `decomp.exe`
// directly — proving the *cart* decoder accepts our streams too — is the job of
// the cart-gated `encode-verify.ts` dev harness.)

import { lz2 } from './lz2.ts';
import { encodeLz2 } from './lz2-encode.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

function roundTrip(data: Uint8Array, label: string): void {
  const enc = encodeLz2(data);
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

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
