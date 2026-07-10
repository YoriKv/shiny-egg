// BRR encoder — PCM → 9-byte BRR blocks, the write half of the sample
// pipeline (base-aware import re-encodes only samples the user edited; see
// sample-import.ts). Per block, brute-force search over filter (0-3) ×
// shift (0-12): quantize the 16 residuals against the running predictor
// state, keep the (filter, shift) with least squared error, then commit its
// reconstruction as the state for the next block. The reconstruction uses
// decodeBrr's exact integer math (brrPredict), so encode→decode is
// self-consistent by construction.
//
// Conventions matching the shipped data:
//  - Block 0 is forced to filter 0 (nothing precedes it; the DSP's initial
//    predictor state is undefined across key-ons).
//  - The final block carries the end flag, plus the loop flag when the
//    sample loops (the loop START lives in the bank's sample directory, not
//    in the .brr — the import pipeline preserves the base sample's loop
//    flag and warns if the edit invalidates the directory's loop offset).
//  - Input is zero-padded to a 16-sample multiple.

import { brrPredict, clamp16 } from './brr.ts';

export interface EncodeBrrOptions {
  /** Set the loop flag on the end block (default false). */
  loop?: boolean;
}

export function encodeBrr(pcm: Int16Array, opts: EncodeBrrOptions = {}): Uint8Array {
  const blocks = Math.max(1, Math.ceil(pcm.length / 16));
  const out = new Uint8Array(blocks * 9);
  let p1 = 0;
  let p2 = 0;

  const samples = new Int16Array(16);
  const bestNibs = new Uint8Array(16);
  const tryNibs = new Uint8Array(16);

  for (let b = 0; b < blocks; b++) {
    for (let i = 0; i < 16; i++) {
      const idx = b * 16 + i;
      samples[i] = idx < pcm.length ? pcm[idx] : 0;
    }

    let bestErr = Infinity;
    let bestFilter = 0;
    let bestShift = 0;
    let bestP1 = 0;
    let bestP2 = 0;
    const filters = b === 0 ? 1 : 4;
    for (let filter = 0; filter < filters; filter++) {
      for (let shift = 0; shift <= 12; shift++) {
        let tp1 = p1;
        let tp2 = p2;
        let err = 0;
        for (let i = 0; i < 16; i++) {
          const predict = brrPredict(filter, tp1, tp2);
          const residual = samples[i] - predict;
          // Quantized contribution is (nib << shift) >> 1, so the ideal
          // nibble is residual * 2 / 2^shift.
          let nib = Math.round((residual * 2) / (1 << shift));
          if (nib > 7) nib = 7;
          else if (nib < -8) nib = -8;
          const s = clamp16(((nib << shift) >> 1) + predict);
          const d = s - samples[i];
          err += d * d;
          tp2 = tp1;
          tp1 = s;
          tryNibs[i] = nib & 0x0f;
          if (err >= bestErr) {
            err = Infinity; // prune: already worse than the best config
            break;
          }
        }
        if (err < bestErr) {
          bestErr = err;
          bestFilter = filter;
          bestShift = shift;
          bestP1 = tp1;
          bestP2 = tp2;
          bestNibs.set(tryNibs);
        }
      }
    }

    const isLast = b === blocks - 1;
    out[b * 9] = (bestShift << 4) | (bestFilter << 2) | (isLast ? 0x01 | (opts.loop ? 0x02 : 0) : 0);
    for (let i = 0; i < 8; i++) {
      out[b * 9 + 1 + i] = (bestNibs[i * 2] << 4) | bestNibs[i * 2 + 1];
    }
    p1 = bestP1;
    p2 = bestP2;
  }
  return out;
}
