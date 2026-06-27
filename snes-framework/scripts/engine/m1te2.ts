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
//   • a palette colour IS BGR555 LE (bit15 unused) — identical to CGRAM.
//
// FIXED LAYOUT (total = 55568 bytes; the editor rejects any other length):
//   off 0      16 B   header  — magic "M1", version 1, counts {palettes 1, maps 3,
//                              4bpp sets 4, 2bpp sets 4}, mapHeight (1..32), tileSize
//                              (0 = 8×8, 1 = 16×16), 7 B zero pad.
//   off 16    256 B   palette — 128 colours × BGR555 LE.
//   off 272  6144 B   tilemaps — 3 maps × 32×32 cells × 2-byte word (row-major,
//                              32 wide); map 0/1 render 4bpp, map 2 renders 2bpp.
//   off 6416 32768 B  4bpp CHR — 4 sets × 256 tiles × 32 B.
//   off 39184 16384 B 2bpp CHR — 4 sets × 256 tiles × 16 B.
//
// In 16×16 tile mode (tileSize = 1) the editor expands one word into the SNES 2×2 block
// base+{0,1,16,17} with the word's flips applied to the whole block — matching the YI
// 16×16 BG2/BG3 PPU exactly, so a YI 16×16 tilemap word maps 1:1.

export const M1TE2_SIZE = 55568;

const OFF_PALETTE = 16;
const PALETTE_BYTES = 256; // 128 colours × 2
const OFF_TILEMAP = 272;
const MAP_CELLS = 1024; // 32 × 32
const OFF_CHR4 = 6416;
const CHR4_BYTES = 32768; // 4 sets × 256 tiles × 32
const OFF_CHR2 = 39184;
const CHR2_BYTES = 16384; // 4 sets × 256 tiles × 16

export interface M1te2Doc {
  /** Map height in tiles (1..32) — editor metadata; the file always stores 32 rows. */
  mapHeight: number;
  /** 8 = the cells are single 8×8 tiles; 16 = each word draws a 16×16 (base+{0,1,16,17}). */
  tileSize: 8 | 16;
  /** 256 bytes = 128 colours, BGR555 LE. */
  palette: Uint8Array;
  /** Maps 0/1/2 (= BG1/BG2/BG3 slots), each 1024 SNES tilemap words. */
  maps: [Uint16Array, Uint16Array, Uint16Array];
  /** 32768 bytes — 4 sets × 256 4bpp tiles (raw SNES planar). */
  chr4bpp: Uint8Array;
  /** 16384 bytes — 4 sets × 256 2bpp tiles (raw SNES planar). */
  chr2bpp: Uint8Array;
}

const clampHeight = (h: number): number => (h < 1 ? 1 : h > 32 ? 32 : h | 0);

/** Serialize an M1te2Doc to the fixed 55568-byte `.M1` blob. Inputs shorter than a
 *  section are zero-padded; longer ones are truncated. Palette high bytes keep bit15=0. */
export function encodeM1te2(doc: M1te2Doc): Uint8Array {
  const out = new Uint8Array(M1TE2_SIZE);
  // Header — magic + the documented section counts; bytes 9..15 stay zero.
  out[0] = 0x4d; // 'M'
  out[1] = 0x31; // '1'
  out[2] = 1; // version
  out[3] = 1; // palettes
  out[4] = 3; // maps
  out[5] = 4; // 4bpp sets
  out[6] = 4; // 2bpp sets
  out[7] = clampHeight(doc.mapHeight);
  out[8] = doc.tileSize === 16 ? 1 : 0;

  for (let i = 0; i < PALETTE_BYTES; i++) {
    const b = doc.palette[i] ?? 0;
    // Odd bytes are the colour's high byte — force the unused bit15 to 0.
    out[OFF_PALETTE + i] = i & 1 ? b & 0x7f : b;
  }

  let o = OFF_TILEMAP;
  for (let m = 0; m < 3; m++) {
    const map = doc.maps[m];
    for (let i = 0; i < MAP_CELLS; i++) {
      const w = map?.[i] ?? 0;
      out[o++] = w & 0xff;
      out[o++] = (w >> 8) & 0xff;
    }
  }

  out.set(doc.chr4bpp.subarray(0, CHR4_BYTES), OFF_CHR4);
  out.set(doc.chr2bpp.subarray(0, CHR2_BYTES), OFF_CHR2);
  return out;
}

/** Parse a `.M1` blob. Validates the 55568-byte size + the "M1" magic; the rest of the
 *  header is fixed (the editor ignores it), so only mapHeight + tileSize are read back. */
export function parseM1te2(bytes: Uint8Array): M1te2Doc {
  if (bytes.length !== M1TE2_SIZE) {
    throw new Error(`.M1 file is ${bytes.length} bytes, expected ${M1TE2_SIZE}`);
  }
  if (bytes[0] !== 0x4d || bytes[1] !== 0x31) throw new Error('Not an .M1 file (bad magic).');

  const palette = bytes.slice(OFF_PALETTE, OFF_PALETTE + PALETTE_BYTES);
  const maps = [0, 1, 2].map((m) => {
    const arr = new Uint16Array(MAP_CELLS);
    let o = OFF_TILEMAP + m * MAP_CELLS * 2;
    for (let i = 0; i < MAP_CELLS; i++) {
      arr[i] = bytes[o]! | (bytes[o + 1]! << 8);
      o += 2;
    }
    return arr;
  }) as [Uint16Array, Uint16Array, Uint16Array];

  return {
    mapHeight: clampHeight(bytes[7] || 32),
    tileSize: bytes[8] ? 16 : 8,
    palette,
    maps,
    chr4bpp: bytes.slice(OFF_CHR4, OFF_CHR4 + CHR4_BYTES),
    chr2bpp: bytes.slice(OFF_CHR2, OFF_CHR2 + CHR2_BYTES)
  };
}
