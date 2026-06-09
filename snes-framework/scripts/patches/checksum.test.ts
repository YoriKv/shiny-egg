// Unit test: SNES checksum recompute. Synthetic self-consistency cases, plus an
// opportunistic check against the real (already asar-fixed) base build — re-
// fixing it must leave the checksum field unchanged, proving the algorithm
// matches asar's --fix-checksum.
// Run: node snes-framework/scripts/patches/checksum.test.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CHECKSUM_FIELD_PC,
  computeSnesChecksum,
  fixSnesChecksum,
  storedSnesChecksum
} from './checksum.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}

console.log('=== synthetic self-consistency ===');
{
  const rom = new Uint8Array(0x8000);
  for (let i = 0; i < rom.length; i++) rom[i] = (i * 7 + 3) & 0xff;
  const checksum = fixSnesChecksum(rom);
  const complement = rom[CHECKSUM_FIELD_PC] | (rom[CHECKSUM_FIELD_PC + 1] << 8);
  assert(storedSnesChecksum(rom) === checksum, 'stored checksum matches returned');
  assert((checksum + complement) === 0xffff, 'checksum + complement === 0xFFFF');
  // Full-ROM 16-bit sum equals the checksum (hardware invariant).
  let total = 0;
  for (let i = 0; i < rom.length; i++) total += rom[i];
  assert((total & 0xffff) === checksum, 'full-ROM sum & 0xFFFF === checksum');
  // Idempotent.
  const again = fixSnesChecksum(rom);
  assert(again === checksum, 're-fix is idempotent');
}

console.log('\n=== too-small ROM throws ===');
{
  let threw = false;
  try { computeSnesChecksum(new Uint8Array(16)); } catch { threw = true; }
  assert(threw, 'ROM smaller than the header field throws');
}

console.log('\n=== real base build: re-fix is a no-op (matches asar) ===');
{
  const buildDir = path.resolve(import.meta.dirname, '..', '..', 'build');
  const sfc = fs.existsSync(buildDir)
    ? fs.readdirSync(buildDir).find((f) => f.endsWith('.sfc'))
    : undefined;
  if (!sfc) {
    console.log('  (skipped — no base build .sfc present)');
  } else {
    const raw = fs.readFileSync(path.join(buildDir, sfc));
    const rom = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    const field = rom.slice(CHECKSUM_FIELD_PC, CHECKSUM_FIELD_PC + 4);
    const stored = storedSnesChecksum(rom);
    const computed = computeSnesChecksum(rom);
    assert(computed === stored, `computed checksum 0x${computed.toString(16)} === stored 0x${stored.toString(16)}`);
    fixSnesChecksum(rom);
    const after = rom.slice(CHECKSUM_FIELD_PC, CHECKSUM_FIELD_PC + 4);
    assert(field.every((v, i) => v === after[i]), 're-fix leaves the field byte-identical');
  }
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
