// Minimal RIFF/WAV codec. The reader serves the sample import pipeline: it
// accepts the files we export (16-bit PCM mono, 32 kHz) plus the common
// variations an external editor saves (stereo → averaged to mono, any sample
// rate — the rate is reported, not resampled; BRR has no inherent rate, the
// DSP pitch does). Anything but 16-bit integer PCM is rejected with an
// actionable message (float/24-bit exports are the classic Audacity
// default-settings trap). The writer is its round-trip inverse — the sample
// export's decoded-.wav half (write(read(x)) must satisfy the reader).

export interface ParsedWav {
  /** Mono 16-bit PCM (stereo inputs averaged). */
  pcm: Int16Array;
  sampleRate: number;
  /** Channel count of the source file (before the mono mix). */
  sourceChannels: number;
}

export function parseWavPcm16(bytes: Uint8Array): ParsedWav {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (off: number): string => String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
  if (bytes.length < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  let data: { off: number; len: number } | null = null;
  let p = 12;
  while (p + 8 <= bytes.length) {
    const id = tag(p);
    const len = dv.getUint32(p + 4, true);
    const body = p + 8;
    if (id === 'fmt ') {
      fmt = {
        format: dv.getUint16(body, true),
        channels: dv.getUint16(body + 2, true),
        sampleRate: dv.getUint32(body + 4, true),
        bits: dv.getUint16(body + 14, true)
      };
    } else if (id === 'data') {
      data = { off: body, len: Math.min(len, bytes.length - body) };
    }
    p = body + len + (len & 1); // chunks are word-aligned
  }
  if (!fmt || !data) throw new Error('WAV is missing its fmt or data chunk');
  // 0xFFFE = WAVE_FORMAT_EXTENSIBLE; treat as PCM if the bit depth matches.
  if ((fmt.format !== 1 && fmt.format !== 0xfffe) || fmt.bits !== 16) {
    throw new Error(
      `unsupported WAV encoding (need 16-bit integer PCM, got format ${fmt.format}, ${fmt.bits}-bit) — re-export as WAV 16-bit PCM`
    );
  }
  if (fmt.channels < 1 || fmt.channels > 2) {
    throw new Error(`unsupported channel count ${fmt.channels} (need mono or stereo)`);
  }
  const frames = Math.floor(data.len / (2 * fmt.channels));
  const pcm = new Int16Array(frames);
  if (fmt.channels === 1) {
    for (let i = 0; i < frames; i++) pcm[i] = dv.getInt16(data.off + i * 2, true);
  } else {
    for (let i = 0; i < frames; i++) {
      const l = dv.getInt16(data.off + i * 4, true);
      const r = dv.getInt16(data.off + i * 4 + 2, true);
      pcm[i] = (l + r) >> 1;
    }
  }
  return { pcm, sampleRate: fmt.sampleRate, sourceChannels: fmt.channels };
}

/** Wrap mono 16-bit PCM as a WAV file. 32000 Hz is the SNES DSP's native
 *  rate — a neutral default; actual musical pitch varies per instrument. */
export function wavFromPcm16(pcm: Int16Array, sampleRate = 32000): Uint8Array {
  const dataBytes = pcm.length * 2;
  const out = new Uint8Array(44 + dataBytes);
  const dv = new DataView(out.buffer);
  const ascii = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) out[off + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  dv.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  dv.setUint32(16, 16, true); // fmt chunk size
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true); // byte rate
  dv.setUint16(32, 2, true); // block align
  dv.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  dv.setUint32(40, dataBytes, true);
  for (let i = 0; i < pcm.length; i++) dv.setInt16(44 + i * 2, pcm[i], true);
  return out;
}
