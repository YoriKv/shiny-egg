// Minimal dependency-free PNG encoder (truecolor + alpha, 8-bit) for the
// engine-side render CLIs. Hand-rolled on node:zlib so the dev tools keep the
// "no native deps, runs from WSL" property — pulling in a PNG library would
// break that. Extracted from the tmp render scripts that each re-implemented it.

import * as zlib from 'node:zlib';

export interface ImageData {
  rgba: Uint8Array;
  width: number;
  height: number;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const cc = Buffer.alloc(4);
  cc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, cc]);
}

/**
 * Decode a PNG buffer to RGBA8888. Handles 8-bit grayscale / RGB / RGBA and
 * indexed (palette, 1/2/4/8-bit) — the color types external editors export —
 * with all five filter types. Errors on 16-bit depth and interlacing (rare from
 * paint tools). Enough to round-trip our own exports and standard editor saves.
 */
export function decodePng(buf: Buffer): ImageData {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error('decodePng: not a PNG');
  let w = 0, h = 0, depth = 0, colorType = 0;
  const idat: Buffer[] = [];
  let plte: Buffer | null = null;
  let trns: Buffer | null = null;
  let p = 8;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8]!;
      colorType = data[9]!;
      if (data[12] !== 0) throw new Error('decodePng: interlaced PNG unsupported');
    } else if (type === 'PLTE') plte = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const channels = colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 1;
  if (depth === 16) throw new Error('decodePng: 16-bit depth unsupported');
  if (colorType !== 3 && depth !== 8) throw new Error(`decodePng: depth ${depth} unsupported for color type ${colorType}`);

  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3); // filter byte-distance
  const stride = Math.ceil((w * bitsPerPixel) / 8);
  const raw = zlib.inflateSync(Buffer.concat(idat));

  // Unfilter scanlines in place into `recon`.
  const recon = Buffer.alloc(h * stride);
  const paeth = (a: number, b: number, c: number): number => {
    const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)]!;
    const fi = y * (stride + 1) + 1;
    const ri = y * stride;
    for (let x = 0; x < stride; x++) {
      const f = raw[fi + x]!;
      const a = x >= bpp ? recon[ri + x - bpp]! : 0;
      const b = y > 0 ? recon[ri - stride + x]! : 0;
      const c = x >= bpp && y > 0 ? recon[ri - stride + x - bpp]! : 0;
      let v: number;
      if (ft === 0) v = f;
      else if (ft === 1) v = f + a;
      else if (ft === 2) v = f + b;
      else if (ft === 3) v = f + ((a + b) >> 1);
      else if (ft === 4) v = f + paeth(a, b, c);
      else throw new Error(`decodePng: bad filter ${ft}`);
      recon[ri + x] = v & 0xff;
    }
  }

  const rgba = new Uint8Array(w * h * 4);
  const put = (i: number, r: number, g: number, b: number, al: number): void => {
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = al;
  };
  for (let y = 0; y < h; y++) {
    const ri = y * stride;
    for (let x = 0; x < w; x++) {
      const di = (y * w + x) * 4;
      if (colorType === 3) {
        // indexed: unpack `depth`-bit sample, look up PLTE (+ tRNS alpha).
        const bitPos = x * depth;
        const byte = recon[ri + (bitPos >> 3)]!;
        const shift = 8 - depth - (bitPos & 7);
        const v = (byte >> shift) & ((1 << depth) - 1);
        const pi = v * 3;
        put(di, plte![pi]!, plte![pi + 1]!, plte![pi + 2]!, trns && v < trns.length ? trns[v]! : 255);
      } else if (colorType === 2) put(di, recon[ri + x * 3]!, recon[ri + x * 3 + 1]!, recon[ri + x * 3 + 2]!, 255);
      else if (colorType === 6) put(di, recon[ri + x * 4]!, recon[ri + x * 4 + 1]!, recon[ri + x * 4 + 2]!, recon[ri + x * 4 + 3]!);
      else if (colorType === 4) { const g = recon[ri + x * 2]!; put(di, g, g, g, recon[ri + x * 2 + 1]!); }
      else { const g = recon[ri + x]!; put(di, g, g, g, 255); } // grayscale
    }
  }
  return { rgba, width: w, height: h };
}

/** Encode an RGBA image as a PNG buffer. */
export function encodePng(img: ImageData): Buffer {
  const { width: w, height: h, rgba } = img;
  const stride = w * 4 + 1; // +1 leading filter byte per scanline
  const raw = Buffer.alloc(stride * h);
  const view = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0; // filter type 0 (none)
    view.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type 6 = truecolor + alpha
  // ihdr[10..12] = compression/filter/interlace = 0
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/**
 * Nearest-neighbour upscale, compositing transparent pixels onto an opaque
 * background so empty cells are visible in a diff viewer. Returns an opaque
 * RGBA image (alpha forced to 255). `scale` of 1 just composites.
 */
export function scaleAndComposite(
  img: ImageData,
  scale: number,
  bg: [number, number, number] = [32, 32, 48]
): ImageData {
  const s = Math.max(1, Math.floor(scale));
  const { width: w, height: h, rgba } = img;
  const ow = w * s;
  const oh = h * s;
  const out = new Uint8Array(ow * oh * 4);
  for (let y = 0; y < oh; y++) {
    const sy = (y / s) | 0;
    for (let x = 0; x < ow; x++) {
      const sx = (x / s) | 0;
      const si = (sy * w + sx) * 4;
      const di = (y * ow + x) * 4;
      if (rgba[si + 3] === 0) {
        out[di] = bg[0];
        out[di + 1] = bg[1];
        out[di + 2] = bg[2];
      } else {
        out[di] = rgba[si]!;
        out[di + 1] = rgba[si + 1]!;
        out[di + 2] = rgba[si + 2]!;
      }
      out[di + 3] = 255;
    }
  }
  return { rgba: out, width: ow, height: oh };
}
