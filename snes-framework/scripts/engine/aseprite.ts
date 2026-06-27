// Minimal Aseprite (.aseprite/.ase) tilemap codec for the BG Region editor
// (research/graphics-editing/aseprite-export.md). Like png.ts, this is a
// dependency-free, node:zlib-only codec so the dev/export pipeline keeps the
// "no native deps, runs from WSL, byte-exact pinnable" property — we own the
// format instead of shelling out to an installed Aseprite.
//
// We emit exactly what an SNES background IS: an indexed image as a TILEMAP
// layer over a TILESET, with the level's CGRAM as the palette. The encoder is
// generic (any tile size, optional per-cell H/V flip); the decoder only does the
// one thing import needs — FLATTEN the tilemap layer back to an RGBA region — so
// the existing base-aware slicers (diffBg1Region / diffBgRegionTiles) consume it
// unchanged. The JSON sidecar, not this file, stays the import contract.
//
// Format reference: aseprite/docs/ase-file-specs.md. Little-endian throughout.
// Chunks we use: Color Profile (0x2007), Palette (0x2019), Tileset (0x2023),
// Layer (0x2004, type 2 = tilemap), Cel (0x2005, cel type 3 = compressed tilemap).

import * as zlib from 'node:zlib';

const MAGIC_FILE = 0xa5e0;
const MAGIC_FRAME = 0xf1fa;

// Cel-type-3 tile DWORD bit masks (the Aseprite defaults).
const TILE_ID_MASK = 0x1fffffff;
const TILE_XFLIP = 0x20000000;
const TILE_YFLIP = 0x40000000;
const TILE_DFLIP = 0x80000000;

/** One tilemap cell. `tile === 0` is the structural empty tile (transparent). */
export interface AsepriteCell {
  tile: number;
  hflip?: boolean;
  vflip?: boolean;
}

/** A single-frame, single-tilemap-layer indexed Aseprite document. */
export interface AsepriteTilemapDoc {
  tileW: number;
  tileH: number;
  /** Grid size in tiles. Canvas px = tilesAcross*tileW × tilesDown*tileH. */
  tilesAcross: number;
  tilesDown: number;
  /** Tiles INCLUDING the empty tile at index 0 (its pixels are ignored on
   *  render). Each entry is `tileW*tileH` palette-index bytes, row-major. */
  tiles: Uint8Array[];
  /** `tilesAcross*tilesDown` cells, row-major. */
  cells: AsepriteCell[];
  /** Up to 256 ImageData-packed colours (`r | g<<8 | b<<16 | a<<24`), the same
   *  u32 form `buildPaletteRow` produces — index i is palette entry i. */
  palette: Uint32Array;
  /** Palette index rendered transparent on the (non-background) tilemap layer.
   *  Pick one no real pixel uses (BG1: 255 — BG1 pixels only use rows 0..7). */
  transparentIndex: number;
  layerName?: string;
  tilesetName?: string;
}

// ── write helpers ───────────────────────────────────────────────────────────

/** Aseprite STRING: WORD length + UTF-8 bytes. */
function aseString(s: string): Buffer {
  const b = Buffer.from(s, 'utf8');
  const head = Buffer.alloc(2);
  head.writeUInt16LE(b.length, 0);
  return Buffer.concat([head, b]);
}

/** Read an Aseprite STRING (WORD length + UTF-8 bytes) at `off`. */
function readAseString(buf: Buffer, off: number): string {
  const len = buf.readUInt16LE(off);
  return buf.toString('utf8', off + 2, off + 2 + len);
}

/** Wrap chunk data with its 6-byte header (DWORD size incl. header, WORD type). */
function aseChunk(type: number, data: Buffer): Buffer {
  const head = Buffer.alloc(6);
  head.writeUInt32LE(data.length + 6, 0);
  head.writeUInt16LE(type, 4);
  return Buffer.concat([head, data]);
}

function colorProfileChunk(): Buffer {
  const d = Buffer.alloc(16); // WORD type=1 (sRGB), WORD flags, FIXED gamma, BYTE[8]
  d.writeUInt16LE(1, 0);
  return aseChunk(0x2007, d);
}

function paletteChunk(palette: Uint32Array): Buffer {
  const n = palette.length;
  const head = Buffer.alloc(20); // DWORD size, first, last, BYTE[8] reserved
  head.writeUInt32LE(n, 0);
  head.writeUInt32LE(0, 4);
  head.writeUInt32LE(n - 1, 8);
  const entries = Buffer.alloc(n * 6); // per entry: WORD flags=0, R,G,B,A
  for (let i = 0; i < n; i++) {
    const v = palette[i] ?? 0;
    const o = i * 6;
    entries[o + 2] = v & 0xff;          // R
    entries[o + 3] = (v >>> 8) & 0xff;  // G
    entries[o + 4] = (v >>> 16) & 0xff; // B
    entries[o + 5] = (v >>> 24) & 0xff; // A
  }
  return aseChunk(0x2019, Buffer.concat([head, entries]));
}

/** Tileset chunk (0x2023): an embedded indexed tileset (id 0, tile 0 = empty). */
function tilesetChunkRaw(tiles: Uint8Array[], tileW: number, tileH: number, name: string): Buffer {
  const numTiles = tiles.length;
  const head = Buffer.alloc(32); // id,flags,numTiles, W,H, baseIndex, BYTE[14]
  head.writeUInt32LE(0, 0);            // tileset id
  head.writeUInt32LE(2 | 4, 4);        // flags: 2 = embed tiles, 4 = id 0 = empty
  head.writeUInt32LE(numTiles, 8);
  head.writeUInt16LE(tileW, 12);
  head.writeUInt16LE(tileH, 14);
  head.writeInt16LE(1, 16);            // base index shown to the user
  // Embedded image: tileW × (tileH*numTiles), 1 byte/pixel, tiles stacked.
  const image = Buffer.concat(tiles.map((t) => Buffer.from(t.buffer, t.byteOffset, t.byteLength)));
  const comp = zlib.deflateSync(image);
  const lenField = Buffer.alloc(4);
  lenField.writeUInt32LE(comp.length, 0);
  return aseChunk(0x2023, Buffer.concat([head, aseString(name), lenField, comp]));
}

/** Tilemap layer chunk (0x2004 type 2). Layer order = chunk order = layer index; all
 *  tilemap layers reference tileset id 0 (the one embedded tileset). */
function tilemapLayerChunkRaw(name: string): Buffer {
  const fixed = Buffer.alloc(16); // flags,type,child,defW,defH,blend,opacity,BYTE[3]
  fixed.writeUInt16LE(1 | 2, 0); // visible + editable (without bit 2 the layer is locked)
  fixed.writeUInt16LE(2, 2);  // type 2 = tilemap
  fixed.writeUInt16LE(0, 4);  // child level
  fixed.writeUInt16LE(0, 10); // blend = normal
  fixed[12] = 255;            // opacity
  const tilesetIndex = Buffer.alloc(4); // type 2 → DWORD tileset index (0)
  return aseChunk(0x2004, Buffer.concat([fixed, aseString(name), tilesetIndex]));
}

/** Compressed-tilemap cel chunk (0x2005 type 3) for `layerIndex`, `tilesAcross×tilesDown`
 *  cells (row-major). The Nth tilemap-layer chunk is layer index N. */
function tilemapCelChunkRaw(layerIndex: number, cells: AsepriteCell[], tilesAcross: number, tilesDown: number): Buffer {
  const head = Buffer.alloc(16); // layerIndex, x, y, opacity, celType, zIndex, BYTE[5]
  head.writeUInt16LE(layerIndex, 0);
  head.writeInt16LE(0, 2);    // x
  head.writeInt16LE(0, 4);    // y
  head[6] = 255;              // opacity
  head.writeUInt16LE(3, 7);   // cel type 3 = compressed tilemap
  head.writeInt16LE(0, 9);    // z-index
  // bytes 11..15 reserved
  const meta = Buffer.alloc(32); // W,H tiles, bits/tile, 4 masks, BYTE[10]
  meta.writeUInt16LE(tilesAcross, 0);
  meta.writeUInt16LE(tilesDown, 2);
  meta.writeUInt16LE(32, 4); // bits per tile
  meta.writeUInt32LE(TILE_ID_MASK, 6);
  meta.writeUInt32LE(TILE_XFLIP, 10);
  meta.writeUInt32LE(TILE_YFLIP, 14);
  meta.writeUInt32LE(TILE_DFLIP, 18);
  // bytes 22..31 reserved
  const tileData = Buffer.alloc(tilesAcross * tilesDown * 4);
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]!;
    let v = c.tile & TILE_ID_MASK;
    if (c.hflip) v |= TILE_XFLIP;
    if (c.vflip) v |= TILE_YFLIP;
    tileData.writeUInt32LE(v >>> 0, i * 4);
  }
  const comp = zlib.deflateSync(tileData);
  return aseChunk(0x2005, Buffer.concat([head, meta, comp]));
}

/** Wrap a frame's chunks in the frame + file headers (shared by the tilemap + image
 *  encoders). `gridW`/`gridH` are cosmetic (the tile size for tilemaps; 0 for images). */
function assembleAseFile(
  chunks: Buffer[], widthPx: number, heightPx: number, numColors: number,
  transparentIndex: number, gridW = 0, gridH = 0
): Uint8Array {
  const body = Buffer.concat(chunks);
  const frameHead = Buffer.alloc(16);
  frameHead.writeUInt32LE(body.length + 16, 0); // bytes in this frame (incl. header)
  frameHead.writeUInt16LE(MAGIC_FRAME, 4);
  // Chunk count goes in BOTH the old 16-bit and new 32-bit fields. Aseprite only falls
  // back to the new field when old == 0xFFFF AND old < new (i.e. count > 0xFFFF) — writing
  // 0xFFFF here for a small count makes it read 65535 chunks.
  frameHead.writeUInt16LE(chunks.length <= 0xffff ? chunks.length : 0xffff, 6);
  frameHead.writeUInt16LE(100, 8);            // frame duration ms
  frameHead.writeUInt32LE(chunks.length, 12); // new chunk count

  const header = Buffer.alloc(128);
  header.writeUInt16LE(MAGIC_FILE, 4);
  header.writeUInt16LE(1, 6);          // frames
  header.writeUInt16LE(widthPx, 8);
  header.writeUInt16LE(heightPx, 10);
  header.writeUInt16LE(8, 12);         // color depth = 8 (indexed)
  header.writeUInt32LE(1, 14);         // flags: 1 = layer opacity valid (no UUID)
  header.writeUInt16LE(100, 18);       // deprecated speed
  header[28] = transparentIndex & 0xff;
  header.writeUInt16LE(numColors, 32); // number of colors
  header[34] = 1;                      // pixel width
  header[35] = 1;                      // pixel height
  header.writeUInt16LE(gridW, 40);     // grid width (cosmetic)
  header.writeUInt16LE(gridH, 42);     // grid height (cosmetic)

  const file = Buffer.concat([header, frameHead, body]);
  file.writeUInt32LE(file.length, 0);  // total file size
  return new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
}

/** Encode a single-frame indexed tilemap document to `.aseprite` bytes. */
export function encodeAseprite(doc: AsepriteTilemapDoc): Uint8Array {
  const chunks = [
    colorProfileChunk(), paletteChunk(doc.palette),
    tilesetChunkRaw(doc.tiles, doc.tileW, doc.tileH, doc.tilesetName ?? 'tiles'),
    tilemapLayerChunkRaw(doc.layerName ?? 'BG'),
    tilemapCelChunkRaw(0, doc.cells, doc.tilesAcross, doc.tilesDown)
  ];
  return assembleAseFile(chunks, doc.tilesAcross * doc.tileW, doc.tilesDown * doc.tileH, doc.palette.length, doc.transparentIndex, doc.tileW, doc.tileH);
}

/** One tilemap layer of a multi-layer document: a name + its own `tilesAcross*tilesDown`
 *  cells (indices into the SHARED tileset). */
export interface AsepriteTilemapLayerSpec {
  name: string;
  cells: AsepriteCell[];
}

/** A single-frame indexed document with MULTIPLE tilemap layers over ONE shared tileset
 *  (e.g. the overworld's BG1+BG2). `layers` are bottom-to-top: `layers[0]` draws first
 *  (behind), later layers on top — match the hardware layer order so the in-Aseprite
 *  composite mirrors the game. */
export interface AsepriteMultiTilemapDoc {
  tileW: number;
  tileH: number;
  tilesAcross: number;
  tilesDown: number;
  /** Shared tileset (index 0 = empty), referenced by every layer. */
  tiles: Uint8Array[];
  layers: AsepriteTilemapLayerSpec[];
  palette: Uint32Array;
  transparentIndex: number;
  tilesetName?: string;
}

/** Encode a multi-tilemap-layer document (one shared embedded tileset, one cel per layer). */
export function encodeAsepriteMultiTilemap(doc: AsepriteMultiTilemapDoc): Uint8Array {
  const chunks: Buffer[] = [
    colorProfileChunk(), paletteChunk(doc.palette),
    tilesetChunkRaw(doc.tiles, doc.tileW, doc.tileH, doc.tilesetName ?? 'tiles')
  ];
  // All layer chunks first (defining layer indices 0..N-1 bottom-to-top)…
  for (const l of doc.layers) chunks.push(tilemapLayerChunkRaw(l.name));
  // …then one cel per layer, referencing its layer index.
  doc.layers.forEach((l, i) => chunks.push(tilemapCelChunkRaw(i, l.cells, doc.tilesAcross, doc.tilesDown)));
  return assembleAseFile(chunks, doc.tilesAcross * doc.tileW, doc.tilesDown * doc.tileH, doc.palette.length, doc.transparentIndex, doc.tileW, doc.tileH);
}

/** A single-frame, single normal-layer indexed Aseprite IMAGE (no tileset/tilemap) —
 *  the "single image with palette" export for assembled views (world/level icons, title
 *  scenery, metasprites, metatiles). Just an indexed cel + the CGRAM-derived palette. */
export interface AsepriteImageDoc {
  width: number;
  height: number;
  /** `width*height` palette-index bytes, row-major. */
  pixels: Uint8Array;
  palette: Uint32Array;
  transparentIndex: number;
  layerName?: string;
}

/** A normal (type-0) image layer chunk. */
function imageLayerChunk(name: string): Buffer {
  const fixed = Buffer.alloc(16); // flags,type,child,defW,defH,blend,opacity,BYTE[3]
  fixed.writeUInt16LE(1 | 2, 0);  // visible + editable
  fixed.writeUInt16LE(0, 2);      // type 0 = normal (image)
  fixed.writeUInt16LE(0, 10);     // blend = normal
  fixed[12] = 255;                // opacity
  return aseChunk(0x2004, Buffer.concat([fixed, aseString(name)]));
}

/** A compressed-image cel (cel type 2): the full-canvas indexed image, ZLIB'd. */
function imageCelChunk(doc: AsepriteImageDoc): Buffer {
  const head = Buffer.alloc(16); // layerIndex,x,y,opacity,celType,zIndex,BYTE[5]
  head.writeUInt16LE(0, 0);   // layer index 0
  head.writeInt16LE(0, 2);    // x
  head.writeInt16LE(0, 4);    // y
  head[6] = 255;              // opacity
  head.writeUInt16LE(2, 7);   // cel type 2 = compressed image
  head.writeInt16LE(0, 9);    // z-index
  const dim = Buffer.alloc(4);
  dim.writeUInt16LE(doc.width, 0);
  dim.writeUInt16LE(doc.height, 2);
  const comp = zlib.deflateSync(Buffer.from(doc.pixels.buffer, doc.pixels.byteOffset, doc.pixels.byteLength));
  return aseChunk(0x2005, Buffer.concat([head, dim, comp]));
}

/** Encode a single-frame indexed IMAGE document to `.aseprite` bytes (no tileset). */
export function encodeAsepriteImage(doc: AsepriteImageDoc): Uint8Array {
  const chunks = [colorProfileChunk(), paletteChunk(doc.palette), imageLayerChunk(doc.layerName ?? 'image'), imageCelChunk(doc)];
  return assembleAseFile(chunks, doc.width, doc.height, doc.palette.length, doc.transparentIndex);
}

// ── decode (flatten) ──────────────────────────────────────────────────────────

interface ParsedTileset {
  tileW: number;
  tileH: number;
  numTiles: number;
  /** numTiles*tileW*tileH index bytes, tiles stacked. */
  pixels: Uint8Array;
}

/**
 * Flatten the tilemap layer of an `.aseprite` we wrote back to an RGBA region —
 * the exact inverse of the export render, so it drops into the existing
 * base-aware slicers. We read only what's needed: header (size + transparent
 * index), the palette, the (single) embedded tileset, and the tilemap cel.
 */
interface ParsedCel { x: number; y: number; wTiles: number; hTiles: number; idMask: number; xMask: number; yMask: number; tiles: Uint32Array }
interface ParsedAseprite { widthPx: number; heightPx: number; transparentIndex: number; palette: Uint32Array; tileset: ParsedTileset; cel: ParsedCel }

/** Read a palette chunk into `palette` and return true if `type` was one. Handles the
 *  new 0x2019 chunk AND the old 0x0004/0x0011 (FLI_COLOR) chunks Aseprite writes for some
 *  palettes on save (see §7) — every decoder must read both. Shared by the tilemap parse
 *  and the single-image decode so the read can't drift between them. */
function readPaletteChunk(buf: Buffer, type: number, data: number, palette: Uint32Array): boolean {
  if (type === 0x2019) {
    // Palette: DWORD size,first,last, BYTE[8], then per entry WORD flags + RGBA.
    const first = buf.readUInt32LE(data + 4);
    const last = buf.readUInt32LE(data + 8);
    let o = data + 20;
    for (let idx = first; idx <= last; idx++) {
      const flags = buf.readUInt16LE(o);
      const r = buf[o + 2]!, g = buf[o + 3]!, b = buf[o + 4]!, a = buf[o + 5]!;
      palette[idx] = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
      o += 6 + (flags & 1 ? 2 + buf.readUInt16LE(o + 6) : 0); // skip optional name
    }
    return true;
  }
  if (type === 0x0004 || type === 0x0011) {
    // Old palette chunk (FLI_COLOR / FLI_COLOR2). WORD packet count, then packets of
    // {BYTE skip, BYTE count (0⇒256), RGB×count}. 0x0011 colours are 6-bit; 0x0004 8-bit.
    // No alpha → opaque (transparency is the transparent index, not palette alpha).
    const sixBit = type === 0x0011;
    let o = data + 2;
    let idx = 0;
    const packets = buf.readUInt16LE(data);
    for (let pk = 0; pk < packets; pk++) {
      idx += buf[o]!; o += 1;
      let count = buf[o]!; o += 1;
      if (count === 0) count = 256;
      for (let c = 0; c < count; c++) {
        let r = buf[o]!, g = buf[o + 1]!, b = buf[o + 2]!; o += 3;
        if (sixBit) { r = (r << 2) | (r >> 4); g = (g << 2) | (g >> 4); b = (b << 2) | (b >> 4); }
        palette[idx++] = ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
      }
    }
    return true;
  }
  return false;
}

/** Parse the header + the chunks we care about (palette, embedded tileset, tilemap
 *  cel) — shared by the flatten decode and the structural decode. */
function parseAsepriteDoc(bytes: Uint8Array): ParsedAseprite {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.readUInt16LE(4) !== MAGIC_FILE) throw new Error('decodeAseprite: bad file magic');
  const widthPx = buf.readUInt16LE(8);
  const heightPx = buf.readUInt16LE(10);
  const depth = buf.readUInt16LE(12);
  if (depth !== 8) throw new Error(`decodeAseprite: expected indexed (8-bit) depth, got ${depth}`);
  const transparentIndex = buf[28]!;

  let p = 128;
  if (buf.readUInt16LE(p + 4) !== MAGIC_FRAME) throw new Error('decodeAseprite: bad frame magic');
  let nChunks = buf.readUInt32LE(p + 12);
  if (nChunks === 0) nChunks = buf.readUInt16LE(p + 6);
  p += 16;

  const palette = new Uint32Array(256);
  let tileset: ParsedTileset | null = null;
  let cel: ParsedCel | null = null;

  for (let i = 0; i < nChunks; i++) {
    const size = buf.readUInt32LE(p);
    const type = buf.readUInt16LE(p + 4);
    const data = p + 6;
    if (readPaletteChunk(buf, type, data, palette)) {
      // palette read into `palette`
    } else if (type === 0x2023) {
      const flags = buf.readUInt32LE(data + 4);
      const numTiles = buf.readUInt32LE(data + 8);
      const tileW = buf.readUInt16LE(data + 12);
      const tileH = buf.readUInt16LE(data + 14);
      let o = data + 32;
      o += 2 + buf.readUInt16LE(o); // skip name string
      if (flags & 2) {
        const len = buf.readUInt32LE(o);
        const img = zlib.inflateSync(buf.subarray(o + 4, o + 4 + len));
        tileset = { tileW, tileH, numTiles, pixels: new Uint8Array(img) };
      }
    } else if (type === 0x2005 && buf.readUInt16LE(data + 7) === 3) {
      // Cel X/Y (signed, in pixels): Aseprite TRIMS a tilemap cel to its non-empty
      // bounding box on save, so a layer with empty borders (e.g. BG2's "sky" rows)
      // saves a smaller wTiles×hTiles at a non-zero origin. The decoders re-place the
      // cel into the full canvas grid using this offset — without it every cell is
      // mis-located and a placement import reports the whole layer "not rewritable".
      const x = buf.readInt16LE(data + 2);
      const y = buf.readInt16LE(data + 4);
      const wTiles = buf.readUInt16LE(data + 16);
      const hTiles = buf.readUInt16LE(data + 18);
      const idMask = buf.readUInt32LE(data + 22);
      const xMask = buf.readUInt32LE(data + 26);
      const yMask = buf.readUInt32LE(data + 30);
      const raw = zlib.inflateSync(buf.subarray(data + 48, p + size));
      const tiles = new Uint32Array(wTiles * hTiles);
      for (let t = 0; t < tiles.length; t++) tiles[t] = raw.readUInt32LE(t * 4);
      cel = { x, y, wTiles, hTiles, idMask, xMask, yMask, tiles };
    }
    p += size;
  }

  if (!tileset || !cel) throw new Error('decodeAseprite: missing tileset or tilemap cel');
  return { widthPx, heightPx, transparentIndex, palette, tileset, cel };
}

/**
 * Flatten the tilemap layer of an `.aseprite` we wrote back to an RGBA region —
 * the exact inverse of the export render, so it drops into the existing
 * base-aware slicers.
 */
export function decodeAsepriteRegion(bytes: Uint8Array): { width: number; height: number; rgba: Uint8Array; palette: Uint32Array } {
  const { widthPx, heightPx, transparentIndex, palette, tileset, cel } = parseAsepriteDoc(bytes);
  const rgba = new Uint8Array(widthPx * heightPx * 4);
  const out = new Uint32Array(rgba.buffer, rgba.byteOffset, widthPx * heightPx);
  const { tileW, tileH, numTiles, pixels } = tileset;
  const tileBytes = tileW * tileH;
  for (let ty = 0; ty < cel.hTiles; ty++) {
    for (let tx = 0; tx < cel.wTiles; tx++) {
      const entry = cel.tiles[ty * cel.wTiles + tx]!;
      const id = entry & cel.idMask;
      if (id === 0 || id >= numTiles) continue; // empty / out of range → transparent
      const hflip = (entry & cel.xMask) !== 0;
      const vflip = (entry & cel.yMask) !== 0;
      const tileBase = id * tileBytes;
      const destX = cel.x + tx * tileW, destY = cel.y + ty * tileH; // honor a trimmed cel's origin
      for (let py = 0; py < tileH; py++) {
        for (let px = 0; px < tileW; px++) {
          const ox = destX + px, oy = destY + py;
          if (ox < 0 || oy < 0 || ox >= widthPx || oy >= heightPx) continue;
          const sx = hflip ? tileW - 1 - px : px;
          const sy = vflip ? tileH - 1 - py : py;
          const idx = pixels[tileBase + sy * tileW + sx]!;
          if (idx === transparentIndex) continue;
          out[oy * widthPx + ox] = palette[idx]!;
        }
      }
    }
  }
  return { width: widthPx, height: heightPx, rgba, palette };
}

/** The structural read of a tilemap `.aseprite`: the embedded tileset's indexed
 *  pixels (per tile) + the per-cell arrangement (tile index + flips). Unlike the
 *  flatten decode, this exposes PLACEMENT (which tile sits in each cell) so an
 *  importer can write a rearrangement back to the cart tilemap, and per-tile pixel
 *  edits independent of where the tile is placed. */
export interface AsepriteStructural {
  width: number;
  height: number;
  palette: Uint32Array;
  transparentIndex: number;
  tileW: number;
  tileH: number;
  /** Tileset tile count INCLUDING the empty tile 0. */
  numTiles: number;
  /** `numTiles*tileW*tileH` index bytes, tiles stacked (tile 0 first). */
  tilePixels: Uint8Array;
  /** `wTiles*hTiles` cells, row-major: the tile index + flips placed in each cell. */
  cells: AsepriteCell[];
  wTiles: number;
  hTiles: number;
  /** The (possibly trimmed) cel's rectangle in TILE units within the full grid (clamped to
   *  the canvas). Cells INSIDE it are authoritative — incl. an intentional clear to tile 0;
   *  cells OUTSIDE it were trimmed by Aseprite (re-expanded to tile 0, NOT a real edit). */
  celBounds: { col: number; row: number; cols: number; rows: number };
}

export function decodeAsepriteStructural(bytes: Uint8Array): AsepriteStructural {
  const { widthPx, heightPx, transparentIndex, palette, tileset, cel } = parseAsepriteDoc(bytes);
  // Re-expand a (possibly trimmed) cel into the FULL canvas tile grid at the cel's origin —
  // empty cells default to tile 0. So `cells` is always indexable at canvas (col,row), the
  // way the placement importers iterate it (region.width/tileW × …), regardless of trimming.
  const fullW = Math.floor(widthPx / tileset.tileW);
  const fullH = Math.floor(heightPx / tileset.tileH);
  const celTX = Math.floor(cel.x / tileset.tileW);
  const celTY = Math.floor(cel.y / tileset.tileH);
  const cells: AsepriteCell[] = new Array(fullW * fullH);
  for (let i = 0; i < cells.length; i++) cells[i] = { tile: 0 };
  for (let ty = 0; ty < cel.hTiles; ty++) {
    for (let tx = 0; tx < cel.wTiles; tx++) {
      const gx = celTX + tx, gy = celTY + ty;
      if (gx < 0 || gy < 0 || gx >= fullW || gy >= fullH) continue;
      const entry = cel.tiles[ty * cel.wTiles + tx]!;
      cells[gy * fullW + gx] = { tile: entry & cel.idMask, hflip: (entry & cel.xMask) !== 0, vflip: (entry & cel.yMask) !== 0 };
    }
  }
  const col = Math.max(0, celTX), row = Math.max(0, celTY);
  return {
    width: widthPx, height: heightPx, palette, transparentIndex,
    tileW: tileset.tileW, tileH: tileset.tileH, numTiles: tileset.numTiles, tilePixels: tileset.pixels,
    cells, wTiles: fullW, hTiles: fullH,
    celBounds: { col, row, cols: Math.max(0, Math.min(fullW, celTX + cel.wTiles) - col), rows: Math.max(0, Math.min(fullH, celTY + cel.hTiles) - row) }
  };
}

/** One layer of a multi-layer structural decode: its name + per-cell placement. */
export interface AsepriteStructuralLayer {
  name: string;
  /** `wTiles*hTiles` cells, row-major: the tile index + flips placed in each cell. */
  cells: AsepriteCell[];
}

/** The structural read of a MULTI-tilemap-layer `.aseprite` (the inverse of
 *  `encodeAsepriteMultiTilemap`): the shared embedded tileset + EACH layer's per-cell
 *  arrangement, in file order (layer index 0 = bottom). Used to round-trip the overworld's
 *  BG1+BG2 layers from one combined file. */
export interface AsepriteMultiStructural {
  width: number;
  height: number;
  palette: Uint32Array;
  transparentIndex: number;
  tileW: number;
  tileH: number;
  numTiles: number;
  tilePixels: Uint8Array;
  wTiles: number;
  hTiles: number;
  layers: AsepriteStructuralLayer[];
}

export function decodeAsepriteMultiStructural(bytes: Uint8Array): AsepriteMultiStructural {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.readUInt16LE(4) !== MAGIC_FILE) throw new Error('decodeAsepriteMulti: bad file magic');
  const widthPx = buf.readUInt16LE(8);
  const heightPx = buf.readUInt16LE(10);
  if (buf.readUInt16LE(12) !== 8) throw new Error('decodeAsepriteMulti: expected indexed (8-bit) depth');
  const transparentIndex = buf[28]!;

  let p = 128;
  if (buf.readUInt16LE(p + 4) !== MAGIC_FRAME) throw new Error('decodeAsepriteMulti: bad frame magic');
  let nChunks = buf.readUInt32LE(p + 12);
  if (nChunks === 0) nChunks = buf.readUInt16LE(p + 6);
  p += 16;

  const palette = new Uint32Array(256);
  let tileset: ParsedTileset | null = null;
  const layerNames: string[] = [];               // layer index → name (chunk order)
  const cels = new Map<number, ParsedCel>();      // layer index → its tilemap cel

  for (let i = 0; i < nChunks; i++) {
    const size = buf.readUInt32LE(p);
    const type = buf.readUInt16LE(p + 4);
    const data = p + 6;
    if (readPaletteChunk(buf, type, data, palette)) {
      // palette read into `palette`
    } else if (type === 0x2004) {
      // Layer chunk: layer index = its position among all layer chunks. Name at +16.
      layerNames.push(readAseString(buf, data + 16));
    } else if (type === 0x2023) {
      const flags = buf.readUInt32LE(data + 4);
      const numTiles = buf.readUInt32LE(data + 8);
      const tileW = buf.readUInt16LE(data + 12);
      const tileH = buf.readUInt16LE(data + 14);
      let o = data + 32;
      o += 2 + buf.readUInt16LE(o); // skip name string
      if (flags & 2) {
        const len = buf.readUInt32LE(o);
        const img = zlib.inflateSync(buf.subarray(o + 4, o + 4 + len));
        tileset = { tileW, tileH, numTiles, pixels: new Uint8Array(img) };
      }
    } else if (type === 0x2005 && buf.readUInt16LE(data + 7) === 3) {
      const layerIndex = buf.readUInt16LE(data);
      const x = buf.readInt16LE(data + 2);
      const y = buf.readInt16LE(data + 4);
      const wTiles = buf.readUInt16LE(data + 16);
      const hTiles = buf.readUInt16LE(data + 18);
      const idMask = buf.readUInt32LE(data + 22);
      const xMask = buf.readUInt32LE(data + 26);
      const yMask = buf.readUInt32LE(data + 30);
      const raw = zlib.inflateSync(buf.subarray(data + 48, p + size));
      const tiles = new Uint32Array(wTiles * hTiles);
      for (let t = 0; t < tiles.length; t++) tiles[t] = raw.readUInt32LE(t * 4);
      cels.set(layerIndex, { x, y, wTiles, hTiles, idMask, xMask, yMask, tiles });
    }
    p += size;
  }
  if (!tileset) throw new Error('decodeAsepriteMulti: missing tileset');
  if (cels.size === 0) throw new Error('decodeAsepriteMulti: no tilemap cels');

  // Re-expand each (possibly trimmed) layer cel into the full canvas tile grid at its
  // origin — empty cells default to tile 0 (same trim handling as decodeAsepriteStructural).
  const wTiles = Math.floor(widthPx / tileset.tileW);
  const hTiles = Math.floor(heightPx / tileset.tileH);
  const layers: AsepriteStructuralLayer[] = [];
  for (let li = 0; li < layerNames.length; li++) {
    const cel = cels.get(li);
    const cells: AsepriteCell[] = new Array(wTiles * hTiles);
    for (let i = 0; i < cells.length; i++) cells[i] = { tile: 0, hflip: false, vflip: false };
    if (cel) {
      const celTX = Math.floor(cel.x / tileset.tileW), celTY = Math.floor(cel.y / tileset.tileH);
      for (let ty = 0; ty < cel.hTiles; ty++) {
        for (let tx = 0; tx < cel.wTiles; tx++) {
          const gx = celTX + tx, gy = celTY + ty;
          if (gx < 0 || gy < 0 || gx >= wTiles || gy >= hTiles) continue;
          const entry = cel.tiles[ty * cel.wTiles + tx]!;
          cells[gy * wTiles + gx] = { tile: entry & cel.idMask, hflip: (entry & cel.xMask) !== 0, vflip: (entry & cel.yMask) !== 0 };
        }
      }
    }
    layers.push({ name: layerNames[li]!, cells });
  }
  return {
    width: widthPx, height: heightPx, palette, transparentIndex,
    tileW: tileset.tileW, tileH: tileset.tileH, numTiles: tileset.numTiles, tilePixels: tileset.pixels,
    wTiles, hTiles, layers
  };
}

/**
 * Decode a single-image `.aseprite` (the inverse of `encodeAsepriteImage`) back to RGBA —
 * the "single image with palette" import path. Reads the header (size + transparent
 * index), the palette, and the (single) image cel (type 0 raw or 2 compressed), honoring
 * the cel's x/y offset + w/h (Aseprite TRIMS a cel to its non-transparent bounding box on
 * save, so a re-saved edited file's cel is smaller and offset). Pixels outside the cel are
 * transparent. Feeds the existing RGBA-based slicers unchanged.
 */
export function decodeAsepriteImage(bytes: Uint8Array): { width: number; height: number; rgba: Uint8Array; palette: Uint32Array } {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.readUInt16LE(4) !== MAGIC_FILE) throw new Error('decodeAsepriteImage: bad file magic');
  const widthPx = buf.readUInt16LE(8);
  const heightPx = buf.readUInt16LE(10);
  if (buf.readUInt16LE(12) !== 8) throw new Error('decodeAsepriteImage: expected indexed (8-bit) depth');
  const transparentIndex = buf[28]!;

  let p = 128;
  if (buf.readUInt16LE(p + 4) !== MAGIC_FRAME) throw new Error('decodeAsepriteImage: bad frame magic');
  let nChunks = buf.readUInt32LE(p + 12);
  if (nChunks === 0) nChunks = buf.readUInt16LE(p + 6);
  p += 16;

  const palette = new Uint32Array(256);
  let cel: { x: number; y: number; w: number; h: number; pixels: Uint8Array } | null = null;
  for (let i = 0; i < nChunks; i++) {
    const size = buf.readUInt32LE(p);
    const type = buf.readUInt16LE(p + 4);
    const data = p + 6;
    if (readPaletteChunk(buf, type, data, palette)) {
      // palette read into `palette`
    } else if (type === 0x2005) {
      const celType = buf.readUInt16LE(data + 7);
      if (celType === 0 || celType === 2) {
        const x = buf.readInt16LE(data + 2), y = buf.readInt16LE(data + 4);
        const w = buf.readUInt16LE(data + 16), h = buf.readUInt16LE(data + 18);
        const raw = celType === 2
          ? zlib.inflateSync(buf.subarray(data + 20, p + size))
          : buf.subarray(data + 20, data + 20 + w * h);
        cel = { x, y, w, h, pixels: new Uint8Array(raw) };
      }
    }
    p += size;
  }
  if (!cel) throw new Error('decodeAsepriteImage: missing image cel');

  const rgba = new Uint8Array(widthPx * heightPx * 4);
  const out = new Uint32Array(rgba.buffer, rgba.byteOffset, widthPx * heightPx);
  for (let py = 0; py < cel.h; py++) {
    const cy = cel.y + py; if (cy < 0 || cy >= heightPx) continue;
    for (let px = 0; px < cel.w; px++) {
      const cx = cel.x + px; if (cx < 0 || cx >= widthPx) continue;
      const idx = cel.pixels[py * cel.w + px]!;
      if (idx === transparentIndex) continue; // outside the cel / transparent → leave 0
      out[cy * widthPx + cx] = palette[idx]!;
    }
  }
  return { width: widthPx, height: heightPx, rgba, palette };
}
