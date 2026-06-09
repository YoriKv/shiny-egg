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

const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const cc = Buffer.alloc(4);
  cc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, cc]);
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
