// Unit test: BRR encoder + WAV parser.
// Run: node snes-framework/scripts/audio/brr-encode.test.ts
//
// Pins:
//  - encode→decode fidelity on synthetic signals (sine SNR ≥ 30 dB, silence
//    stays silent, structure: block count / end flag / loop flag).
//  - WAV parse: our own wavFromPcm16 output round-trips exactly; stereo
//    averaging; non-PCM16 rejected.
//  - (Assets-gated) every extracted sample re-encodes at its decoded length
//    with SNR ≥ 25 dB vs its own decode — the "imports won't audibly
//    degrade untouched-but-resaved samples" gate. Reports the worst SNR.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { decodeBrr } from './brr.ts';
import { encodeBrr } from './brr-encode.ts';
import { parseWavPcm16, wavFromPcm16 } from './wav.ts';
import { FRAMEWORK_ROOT } from '../engine/dev-cart.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}
function eq<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`  ✗ ${msg}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    failures++;
  }
}

function snrDb(reference: Int16Array, test: Int16Array): number {
  const n = Math.min(reference.length, test.length);
  let sig = 0;
  let noise = 0;
  for (let i = 0; i < n; i++) {
    sig += reference[i] * reference[i];
    const d = test[i] - reference[i];
    noise += d * d;
  }
  if (noise === 0) return Infinity;
  return 10 * Math.log10(sig / noise);
}

console.log('=== synthetic encode→decode ===');
{
  const n = 1600;
  const sine = new Int16Array(n);
  for (let i = 0; i < n; i++) sine[i] = Math.round(12000 * Math.sin((i / 32000) * 2 * Math.PI * 440));
  const brr = encodeBrr(sine);
  eq(brr.length, Math.ceil(n / 16) * 9, 'block-aligned output size');
  const d = decodeBrr(brr);
  assert(d.terminated, 'end flag present');
  eq(d.loops, false, 'no loop flag by default');
  const snr = snrDb(sine, d.pcm);
  assert(snr >= 30, `sine SNR ${snr.toFixed(1)} dB < 30`);
}
{
  const brr = encodeBrr(new Int16Array(64), { loop: true });
  const d = decodeBrr(brr);
  eq(d.loops, true, 'loop flag flows to the end block');
  assert(d.pcm.every((v) => v === 0), 'silence stays silent');
}
{
  // Non-multiple-of-16 input is zero-padded, not truncated.
  const brr = encodeBrr(new Int16Array(17));
  eq(brr.length, 2 * 9, 'padding to two blocks');
}

console.log('\n=== wav parse ===');
{
  const pcm = new Int16Array([0, 1000, -1000, 32767, -32768]);
  const parsed = parseWavPcm16(wavFromPcm16(pcm, 32000));
  eq(parsed.sampleRate, 32000, 'sample rate');
  eq(parsed.sourceChannels, 1, 'mono');
  eq([...parsed.pcm], [...pcm], 'exact PCM round-trip through our own container');
}
{
  // Stereo → averaged mono: build a 2-channel file by hand from the mono
  // writer's header (patch channels/byte-rate/block-align).
  const l = new Int16Array([100, 200]);
  const wav = wavFromPcm16(new Int16Array([100, 150, 200, 250]), 44100);
  const dv = new DataView(wav.buffer);
  dv.setUint16(22, 2, true); // channels
  dv.setUint32(28, 44100 * 4, true); // byte rate
  dv.setUint16(32, 4, true); // block align
  const parsed = parseWavPcm16(wav);
  eq(parsed.sourceChannels, 2, 'stereo detected');
  eq([...parsed.pcm], [125, 225], 'channel-averaged');
  void l;
}
{
  const wav = wavFromPcm16(new Int16Array(4));
  new DataView(wav.buffer).setUint16(34, 32, true); // bits per sample → 32
  let threw = false;
  try { parseWavPcm16(wav) } catch { threw = true }
  assert(threw, 'non-16-bit input rejected');
}

// --- assets-gated: re-encode every extracted sample --------------------------
const samplesRoot = path.join(FRAMEWORK_ROOT, 'assets', 'yi', 'SPC700', 'Samples');
if (!fs.existsSync(samplesRoot)) {
  console.log('\n(skip) extracted samples not present — run extract first');
} else {
  console.log('\n=== re-encode all extracted samples ===');
  let count = 0;
  let worst = Infinity;
  let worstName = '';
  for (const bank of fs.readdirSync(samplesRoot).sort()) {
    const bankDir = path.join(samplesRoot, bank);
    for (const file of fs.readdirSync(bankDir).filter((f) => f.endsWith('.brr')).sort()) {
      const base = decodeBrr(new Uint8Array(fs.readFileSync(path.join(bankDir, file))));
      const reenc = encodeBrr(base.pcm, { loop: base.loops });
      eq(reenc.length, Math.ceil(base.pcm.length / 16) * 9, `${bank}/${file}: size`);
      const d2 = decodeBrr(reenc);
      eq(d2.loops, base.loops, `${bank}/${file}: loop flag preserved`);
      const snr = snrDb(base.pcm, d2.pcm);
      if (snr < worst) { worst = snr; worstName = `${bank}/${file}`; }
      assert(snr >= 25, `${bank}/${file}: re-encode SNR ${snr.toFixed(1)} dB < 25`);
      count++;
    }
  }
  console.log(`  ${count} samples re-encoded; worst SNR ${worst.toFixed(1)} dB (${worstName})`);
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll BRR-encode checks passed.');
