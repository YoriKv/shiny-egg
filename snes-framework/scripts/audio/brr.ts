// BRR sample decoding (audition quality) — the Export tab's sample export
// (raw .brr copy + decoded .wav via wav.ts). Format: 9-byte blocks,
// 1 header byte (shift:4 | filter:2 | loop:1 | end:1) + 8 data bytes = 16
// signed nibbles, high nibble first. Filter predictors (applied to the
// shifted nibble + the two previous output samples):
//   f0: 0            f1: +15/16·p1
//   f2: +61/32·p1 − 15/16·p2
//   f3: +115/64·p1 − 13/16·p2
// Output is clamped to 16-bit; the hardware's 15-bit wrap quirk is not
// modeled (irrelevant for well-formed samples — this decoder serves export
// and future waveform display, not DSP emulation; playback fidelity comes
// from the SPC player, which runs the real DSP).
//
// Loop metadata note: a sample's loop START lives in the bank's ARAM sample
// directory (the `dw DATA_x : dw DATA_x+loopoff` wrapper lines), not in the
// .brr bytes — only the loop FLAG (replay vs key-off at the end block) is
// in-band. Loop offsets join the export as a manifest when the Phase-2
// import pipeline defines the round-trip contract (plan §4).

export interface DecodedBrr {
  /** 16 samples per 9-byte block. */
  pcm: Int16Array;
  /** True if the end block has the loop flag set (sample replays from the
   *  directory's loop point instead of keying off). */
  loops: boolean;
  blocks: number;
  /** True when an end-flagged block terminated the stream. The last sample
   *  of each extracted bank is sliced to the bank's data-block end, so its
   *  .brr can carry trailing padding past the end block — decode stops at
   *  the flag and `terminated` distinguishes that from running off the
   *  buffer (malformed data). */
  terminated: boolean;
}

export const clamp16 = (v: number): number => (v > 32767 ? 32767 : v < -32768 ? -32768 : v);

/** The filter predictor term added to the shifted nibble — shared by the
 *  decoder and the encoder (brr-encode.ts) so both sides run byte-identical
 *  integer math (an encoder simulating different rounding than the decoder
 *  would mis-predict its own running state). */
export function brrPredict(filter: number, p1: number, p2: number): number {
  switch (filter) {
    case 1: return p1 - (p1 >> 4);
    case 2: return 2 * p1 - ((p1 * 3) >> 5) - p2 + (p2 >> 4);
    case 3: return 2 * p1 - ((p1 * 13) >> 6) - p2 + ((p2 * 3) >> 4);
    default: return 0;
  }
}

export function decodeBrr(bytes: Uint8Array): DecodedBrr {
  const blocks = Math.floor(bytes.length / 9);
  const pcm = new Int16Array(blocks * 16);
  let p1 = 0;
  let p2 = 0;
  let loops = false;
  let out = 0;
  for (let b = 0; b < blocks; b++) {
    const head = bytes[b * 9];
    const shift = head >> 4;
    const filter = (head >> 2) & 0x03;
    const end = (head & 0x01) !== 0;
    if (end) loops = (head & 0x02) !== 0;
    for (let i = 0; i < 16; i++) {
      const byte = bytes[b * 9 + 1 + (i >> 1)];
      let nib = i % 2 === 0 ? byte >> 4 : byte & 0x0f;
      if (nib >= 8) nib -= 16;
      // Shift 13-15 is degenerate on hardware (result collapses to sign);
      // no shipped sample uses it, but stay graceful.
      let s = shift <= 12 ? (nib << shift) >> 1 : nib < 0 ? -2048 : 0;
      s = clamp16(s + brrPredict(filter, p1, p2));
      pcm[out++] = s;
      p2 = p1;
      p1 = s;
    }
    if (end) {
      // Trailing blocks after the end flag aren't part of the sample.
      return { pcm: pcm.subarray(0, out), loops, blocks: b + 1, terminated: true };
    }
  }
  return { pcm, loops, blocks, terminated: false };
}
