// M1TE2 ".M1" session-file codec — a fixed-size raw binary that bundles a SNES
// tilemap editor's whole state (palette + 3 tilemaps + 8 tilesets) in one file, so a
// BG layer can be opened and edited as it composes in-game, then re-imported. Like the
// .aseprite codec (aseprite.ts) this owns the byte layout directly — no external tool
// dependency, fully node-testable (m1te2.test.ts).
//
// The mapping to SNES BG data is verbatim (the reason the .M1 is a clean target):
//   • a tilemap cell IS the SNES tilemap word `vhopppcc cccccccc` (LE) — 10-bit char,
//     3-bit palette row, priority, H/V flip; copied byte-for-byte.
//   • a CHR tile IS raw SNES planar CHR (4bpp = 32 B planes 0/1 then 2/3 row-interleaved;
//     2bpp = 16 B planes 0/1) — identical to VRAM, so a copy needs no re-plane.
//   • a palette color IS BGR555 LE (bit15 unused) — identical to CGRAM.
//
// FORMAT VERSIONS — M1TE2 grew a "v2" that supports maps wider/taller than one 32×32
// screen (M1-file-format.md §4): a map is now 32 OR 64 wide × 1..64 tall, stored as the
// editor's full 64×64-stride internal arrays. We ALWAYS WRITE v2 (the new M1TE saves v2),
// and PARSE both v2 and legacy v1 so a file from an older export still re-imports.
//
//   v2 LAYOUT (total = 74000 bytes):
//     off 0      16 B   header  — magic "M1", version 2, counts {palettes 1, maps 3,
//                              4bpp sets 4, 2bpp sets 4}, mapHeight (1..64), tileSize
//                              (0 = 8×8, 1 = 16×16), mapWidth (32/64) at off 9, 6 B zero.
//     off 16    256 B   palette — 128 colors × BGR555 LE.
//     off 272 24576 B   tilemaps — 3 maps × 64×64 cells × 2-byte word (row-major, STRIDE 64;
//                              the active region is bounded by mapWidth × mapHeight, cells
//                              outside it are 0). map 0/1 render 4bpp, map 2 renders 2bpp.
//     off 24848 32768 B 4bpp CHR — 4 sets × 256 tiles × 32 B.
//     off 57616 16384 B 2bpp CHR — 4 sets × 256 tiles × 16 B.
//
//   v1 LAYOUT (legacy, 55568 bytes; PARSE-ONLY): identical header (version 1, no mapWidth)
//   but the tilemaps are three packed 32×32 grids (3 × 0x800 = 6144 B at off 272), so the
//   4bpp CHR starts at 6416 and the 2bpp at 39184. parse() lifts a v1 file into the same
//   64×64-stride model at width 32 (its 32 columns placed at columns 0..31).
//
// The .M1 map section is PLAIN row-major at stride 64 — NOT SNES "screen-block" order.
// Screen-block ordering only applies to M1TE's raw `.map` export; the `.M1` is its lossless
// internal representation, so a producer that holds screen-block data (the overworld) must
// de-interleave to (col,row) BEFORE filling the doc map (and the diff re-interleaves).
//
// In 16×16 tile mode (tileSize = 1) the editor expands one word into the SNES 2×2 block
// base+{0,1,16,17} with the word's flips applied to the whole block — matching the YI
// 16×16 BG2/BG3 PPU exactly, so a YI 16×16 tilemap word maps 1:1.

/** The size we WRITE (v2). The legacy v1 size (parse-only) is M1TE2_SIZE_V1. */
export const M1TE2_SIZE = 74000;
/** Legacy v1 size — still accepted by parse() so an older export round-trips. */
export const M1TE2_SIZE_V1 = 55568;

/** The doc's maps are the editor's full 64×64 internal grid (stride 64); a cell (x,y) is at
 *  word index `y * MAP_STRIDE + x`. mapWidth × mapHeight bounds the active region. */
export const MAP_STRIDE = 64;
export const MAP_WORDS = MAP_STRIDE * MAP_STRIDE; // 4096

// v2 section offsets (the layout we write).
export const OFF_PALETTE = 16;
const PALETTE_BYTES = 256; // 128 colors × 2
export const OFF_MAPS = 272;
const MAPS_BYTES = 3 * MAP_WORDS * 2; // 24576
export const OFF_CHR4 = OFF_MAPS + MAPS_BYTES; // 24848
const CHR4_BYTES = 32768; // 4 sets × 256 tiles × 32
export const OFF_CHR2 = OFF_CHR4 + CHR4_BYTES; // 57616
const CHR2_BYTES = 16384; // 4 sets × 256 tiles × 16

// v1 legacy section geometry (parse-only).
const V1_MAP_CELLS = 1024; // 32 × 32
const V1_OFF_CHR4 = 6416;
const V1_OFF_CHR2 = 39184;

export interface M1te2Doc {
  /** Map width in tiles — 32 or 64 (the SNES BGxSC width). */
  mapWidth: 32 | 64;
  /** Map height in tiles (1..64). */
  mapHeight: number;
  /** 8 = the cells are single 8×8 tiles; 16 = each word draws a 16×16 (base+{0,1,16,17}). */
  tileSize: 8 | 16;
  /** 256 bytes = 128 colors, BGR555 LE. */
  palette: Uint8Array;
  /** Maps 0/1/2 (= BG1/BG2/BG3 slots), each the editor's 64×64-stride grid (MAP_WORDS SNES
   *  tilemap words); cell (x,y) at `y*MAP_STRIDE + x`, region bounded by mapWidth×mapHeight. */
  maps: [Uint16Array, Uint16Array, Uint16Array];
  /** 32768 bytes — 4 sets × 256 4bpp tiles (raw SNES planar). */
  chr4bpp: Uint8Array;
  /** 16384 bytes — 4 sets × 256 2bpp tiles (raw SNES planar). */
  chr2bpp: Uint8Array;
}

const clampHeight = (h: number): number => (h < 1 ? 1 : h > 64 ? 64 : h | 0);
const clampWidth = (w: number): 32 | 64 => (w >= 64 ? 64 : 32);

/** Lift a `srcWidth`-wide row-major tilemap into the doc's 64-stride 64×64 grid (the shape
 *  `maps` expects). Cells beyond the source stay 0. For producers that build a map at its
 *  native width (≤ 64) and just need it in doc form. */
export function liftDocMap(src: Uint16Array, srcWidth: number): Uint16Array {
  const out = new Uint16Array(MAP_WORDS);
  const srcHeight = Math.floor(src.length / srcWidth);
  for (let y = 0; y < srcHeight; y++) {
    for (let x = 0; x < srcWidth; x++) out[y * MAP_STRIDE + x] = src[y * srcWidth + x]!;
  }
  return out;
}

/** Serialize an M1te2Doc to the fixed 74000-byte v2 `.M1` blob. Map arrays are written
 *  verbatim at stride 64 (the producer zeroes cells outside mapWidth×mapHeight); CHR inputs
 *  shorter than a section are zero-padded, longer ones truncated; palette high bytes keep
 *  bit15 = 0. */
export function encodeM1te2(doc: M1te2Doc): Uint8Array {
  const out = new Uint8Array(M1TE2_SIZE);
  // Header — magic + the documented section counts; bytes 10..15 stay zero.
  out[0] = 0x4d; // 'M'
  out[1] = 0x31; // '1'
  out[2] = 2; // version (v2 — variable width/height)
  out[3] = 1; // palettes
  out[4] = 3; // maps
  out[5] = 4; // 4bpp sets
  out[6] = 4; // 2bpp sets
  out[7] = clampHeight(doc.mapHeight);
  out[8] = doc.tileSize === 16 ? 1 : 0;
  out[9] = clampWidth(doc.mapWidth); // v2: map width (32 or 64)

  for (let i = 0; i < PALETTE_BYTES; i++) {
    const b = doc.palette[i] ?? 0;
    // Odd bytes are the color's high byte — force the unused bit15 to 0.
    out[OFF_PALETTE + i] = i & 1 ? b & 0x7f : b;
  }

  let o = OFF_MAPS;
  for (let m = 0; m < 3; m++) {
    const map = doc.maps[m];
    for (let i = 0; i < MAP_WORDS; i++) {
      const w = map?.[i] ?? 0;
      out[o++] = w & 0xff;
      out[o++] = (w >> 8) & 0xff;
    }
  }

  out.set(doc.chr4bpp.subarray(0, CHR4_BYTES), OFF_CHR4);
  out.set(doc.chr2bpp.subarray(0, CHR2_BYTES), OFF_CHR2);
  return out;
}

/** Read a slot's 64×64-stride map from the v2 tilemaps section. */
function readMapsV2(bytes: Uint8Array): [Uint16Array, Uint16Array, Uint16Array] {
  return [0, 1, 2].map((m) => {
    const arr = new Uint16Array(MAP_WORDS);
    let o = OFF_MAPS + m * MAP_WORDS * 2;
    for (let i = 0; i < MAP_WORDS; i++) {
      arr[i] = bytes[o]! | (bytes[o + 1]! << 8);
      o += 2;
    }
    return arr;
  }) as [Uint16Array, Uint16Array, Uint16Array];
}

/** Read a legacy v1 32×32 tilemaps section, lifted into the 64×64-stride model (cols 0..31). */
function readMapsV1(bytes: Uint8Array): [Uint16Array, Uint16Array, Uint16Array] {
  return [0, 1, 2].map((m) => {
    const arr = new Uint16Array(MAP_WORDS);
    let o = OFF_MAPS + m * V1_MAP_CELLS * 2;
    for (let i = 0; i < V1_MAP_CELLS; i++) {
      const x = i & 31, y = i >> 5;
      arr[y * MAP_STRIDE + x] = bytes[o]! | (bytes[o + 1]! << 8);
      o += 2;
    }
    return arr;
  }) as [Uint16Array, Uint16Array, Uint16Array];
}

/** Parse a `.M1` blob (v2 = 74000 B, or legacy v1 = 55568 B — distinguished by size, per
 *  M1-file-format.md §4.3) into the unified 64×64-stride doc. Validates size + "M1" magic;
 *  the rest of the header is fixed, so only mapWidth/mapHeight/tileSize are read back. */
export function parseM1te2(bytes: Uint8Array): M1te2Doc {
  if (bytes.length !== M1TE2_SIZE && bytes.length !== M1TE2_SIZE_V1) {
    throw new Error(`.M1 file is ${bytes.length} bytes, expected ${M1TE2_SIZE} (v2) or ${M1TE2_SIZE_V1} (v1)`);
  }
  if (bytes[0] !== 0x4d || bytes[1] !== 0x31) throw new Error('Not an .M1 file (bad magic).');

  const palette = bytes.slice(OFF_PALETTE, OFF_PALETTE + PALETTE_BYTES);
  const tileSize: 8 | 16 = bytes[8] ? 16 : 8;

  if (bytes.length === M1TE2_SIZE) {
    return {
      mapWidth: bytes[9] === 64 ? 64 : 32,
      mapHeight: clampHeight(bytes[7] || 32),
      tileSize,
      palette,
      maps: readMapsV2(bytes),
      chr4bpp: bytes.slice(OFF_CHR4, OFF_CHR4 + CHR4_BYTES),
      chr2bpp: bytes.slice(OFF_CHR2, OFF_CHR2 + CHR2_BYTES)
    };
  }
  // Legacy v1: a 32-wide map, height clamped to 1..32, CHR at the older offsets.
  return {
    mapWidth: 32,
    mapHeight: Math.min(32, clampHeight(bytes[7] || 32)),
    tileSize,
    palette,
    maps: readMapsV1(bytes),
    chr4bpp: bytes.slice(V1_OFF_CHR4, V1_OFF_CHR4 + CHR4_BYTES),
    chr2bpp: bytes.slice(V1_OFF_CHR2, V1_OFF_CHR2 + CHR2_BYTES)
  };
}
