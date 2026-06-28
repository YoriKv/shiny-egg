// BG2 + BG3 tilemap loaders. These are SEPARATE from `load_level_gfx` —
// `load_level_gfx` populates tile DATA in VRAM, but the per-layer TILEMAP
// (the grid of tilemap-entry words at $2107-$2109 addresses) is loaded by
// a different step in gm$0C.
//
// Ports of:
//   $01:E80A  load_bg2_tilemap  (Bank01)
//   $01:E9F5  load_bg3_tilemap  (Bank01)
//
// **BG2 tilemap loader algorithm** (per yi/Banks/Bank01.asm:13347):
//   1. Read BG2 tileset ID from header.
//   2. Look up offset in `bg2_tilemap_indices` (DATA_bg2_tilemap_indices) — 32 dw.
//   3. At `bg2_tilemap_gfx_entries[offset]` read the entry-type byte:
//        $00 = plain LZ2 decompress to VRAM $3800
//        $02 = unused
//        $04 = wavy: arm HDMA on $2111 horizontal-scroll, then plain decompress
//   4. Plain path: read file-index byte at +1, look up LZ2 source pointer
//      via DATA_lz2_compressed_gfx_ptrs (same table our load-graphics uses), decompress.
//
// **BG3 tilemap loader algorithm** (per yi/Banks/Bank01.asm:13544):
//   1. If BG3Tileset == 0 → fill VRAM $3400..$3C00 with empty-tile word
//      $01CE (YI's blank pattern). The cart skips this step; we add it so
//      the editor preview shows a clean blank background instead of
//      whatever load_level_gfx happened to leave there.
//   2. Look up the 3-byte row in `bg3_tilemap_table` (DATA_bg3_tilemap_table) at
//      offset (BG3Tileset-1)*3 — bytes: (fileIdLo, fileIdHi, actionByte).
//   3. If fileId == 0 → no decompress; treat as empty BG3 (fill).
//   4. LZ2-decompress the file (source ptr via DATA_lz2_compressed_gfx_ptrs[fileId*3]) into
//      a scratch buffer at $70:5800.
//   5. **Tileset $16 special case**: patch the scratch from $7E:5DA6 before
//      upload (= sun-overlay tile data). Source contents are populated by
//      a different code path at level-load.
//   6. Copy 2 KB scratch to VRAM $3400.
//   7. Action-byte dispatch (CODE_01EA87 area):
//      - **$00**: plain — load complete.
//      - **$01-$7F**: write per-stripe modification table at WRAM
//        $70:3D4A (CODE_01EAA9). **Runtime per-frame effect** — no VRAM
//        tilemap content change. Static render is correct.
//      - **$80** `bg3_low_water_adjust`: queues an extra DMA targeting
//        VRAM $3740 with size $0680, blanking the bottom of the BG3
//        tilemap (water-line effect). Our render leaves the LZ2-loaded
//        bytes in place → BG3 shows extra tiles below the water line.
//        Not glitchy (real cart bytes), just busier than the cart.
//      - **$81-$87**: HDMA-setup dispatch table (horiz_scroll,
//        screen_des, clouds_mist, sun, transparency, wavy_mist). All
//        runtime per-frame effects — no VRAM tilemap content change.
//      - **$88-$FE**: fall through to BG3-hide (CODE_01EAA0 clears bit 2
//        of MainScreen/SubScreen).
//      - **$FF**: explicit BG3-hide (same handler).
//      We surface the hide cases via `bg3Disabled` so the renderer
//      suppresses BG3 entirely.
//
// **BG3 features intentionally skipped** (per the editor's
// "representative tilemap, no per-frame effects" goal):
//   - Per-stripe $703D4A modifications ($01-$7F actions, 6 levels).
//   - HDMA-driven per-frame effects ($81-$87 actions, 16 levels): sun
//     disc, cloud drift, mist wobble, water shimmer, etc.
//   - $80 low_water_adjust bottom-clear (6 levels): leaves the LZ2
//     tilemap below the water line visible; not glitchy.
//   - `gsu_init_5` ($00:E152) BG3 SuperFX-stitched parallax-cylinder
//     animations (clouds, moon, lava bowl). The frame-0 static tilemap
//     that `load_bg3_tilemap` deposits is what we render.
//
// **Known-visible GSU placeholder (BG2, deliberately not suppressed).** The
// same SuperFX-cylinder family also drives BG2 via tileset $16 (fort/boss
// sub-rooms). Its char gfx is a cone the GSU animates, and its palette block
// ($16) is a *pure-magenta $7C1F placeholder* the GSU overwrites at runtime —
// so the static decode (byte-identical to the cart's frame-0 VRAM, verified
// against the bg23-render captures) renders a magenta cone. On the BG3 cones
// the cart hides the layer (action $FF → bg3Disabled), but BG2 has no such
// action byte, so for modes that sub-enable BG2 it stays VISIBLE. Across the
// V1.0 catalog this surfaces in exactly ONE level — record $3D (mode $05) —
// the only editor-visible pure-magenta layer. We leave it as-is rather than
// add a magenta-sentinel suppression heuristic: it's authentic frame-0 data,
// and properly fixing it means rendering the GSU cylinder (out of scope, like
// the BG3 cases above). $82/$8A use the same tileset but their modes hide BG2.

import { lz2 } from './decompress/lz2.ts';
import { snesToPC, type SymbolMap } from './symbol-map.ts';
import { u16le, u24le } from './rom-read.ts';

// VRAM is word-addressed; our `vram` is a byte array. The asm/PPU word
// addresses below double to byte offsets: BG2 tilemap word $3800 → byte
// $7000, BG3 tilemap word $3400 → byte $6800. (Must stay in lockstep with
// scene-regs.ts `decodeBGxSC`, which yields the same byte addresses — earlier
// these were the un-doubled $3800/$3400, landing the tilemaps inside the
// char region and corrupting char data.)
const BG2_TILEMAP_VRAM_ADDR = 0x7000;
const BG3_TILEMAP_VRAM_ADDR = 0x6800;
const BG3_TILEMAP_VRAM_BYTES = 0x0800; // 2 KB = 32×32 tilemap words
const BG3_EMPTY_TILE_WORD = 0x01ce;    // YI's "blank tile" pattern
const SRAM_STAGING_BYTES = 0x10000; // matches DLL buffer size

interface Bg2GfxEntry {
  /** $00 / $02 / $04 dispatch byte. */
  type: number;
  /** File index into DATA_lz2_compressed_gfx_ptrs (= DATA_lz2_compressed_gfx_ptrs). */
  fileIdx: number;
}


function lookupBg2Entry(
  rom: Uint8Array,
  symbols: SymbolMap,
  bg2Tileset: number
): Bg2GfxEntry {
  const indices = symbols.pc('DATA_bg2_tilemap_indices');
  const entries = symbols.pc('DATA_bg2_tilemap_gfx_entries');
  const idxOffset = u16le(rom, indices + bg2Tileset * 2);
  const type = rom[entries + idxOffset];
  const fileIdx = rom[entries + idxOffset + 1];
  return { type, fileIdx };
}

/**
 * Populate the BG2 tilemap region of `vram` (byte $7000 = PPU word $3800)
 * by LZ2-decompressing the per-tileset blob.
 *
 * Returns the decompressed byte count; `vram` is mutated in place.
 * Returns 0 if entry type is unsupported. Action-byte $04 (wavy
 * HDMA) is treated the same as $00 — the tilemap decompresses
 * identically; the per-scanline HDMA wave is a runtime effect we
 * don't simulate.
 */
/** The decompressed tilemap bytes for an LZ2 `fileId` — from the editor's live gfx-edit
 *  overlay (a placement import's `saveGfxEdit('lz2', …)`) when present, so a tilemap
 *  rearrangement PREVIEWS on the canvas without a rebuild; else decompressed from the cart.
 *  Mirrors how `loadLevelGfx` overlays CHR — the tilemap loaders are a separate gm$0C step,
 *  so they need their own seam (without it, placement edits save but don't show). */
function tilemapBytes(rom: Uint8Array, symbols: SymbolMap, fileId: number, gfxOverride?: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const ov = gfxOverride?.get(`lz2/${fileId}`);
  if (ov) return ov;
  const srcPC = snesToPC(u24le(rom, symbols.pc('DATA_lz2_compressed_gfx_ptrs') + fileId * 3));
  const scratch = new Uint8Array(SRAM_STAGING_BYTES);
  const { destEnd } = lz2(rom, srcPC, scratch, 0);
  return scratch.subarray(0, destEnd);
}

export function loadBg2Tilemap(
  rom: Uint8Array,
  symbols: SymbolMap,
  bg2Tileset: number,
  vram: Uint8Array,
  gfxOverride?: ReadonlyMap<string, Uint8Array>
): number {
  const entry = lookupBg2Entry(rom, symbols, bg2Tileset);
  if (entry.type !== 0x00 && entry.type !== 0x04) return 0;

  const bytes = tilemapBytes(rom, symbols, entry.fileIdx, gfxOverride);
  const sizeBytes = Math.min(bytes.length, vram.length - BG2_TILEMAP_VRAM_ADDR);
  for (let i = 0; i < sizeBytes; i++) {
    vram[BG2_TILEMAP_VRAM_ADDR + i] = bytes[i]!;
  }
  return sizeBytes;
}

/** The cart source of a BG2/BG3 tilemap, for the placement write-back: the LZ2
 *  `fileId` (in `DATA_lz2_compressed_gfx_ptrs`) + its DECOMPRESSED tilemap-word bytes
 *  (which load at `vramBase`, so a region's `memoryEntryOff − vramBase` is the byte
 *  offset of that word in `bytes`). `null` ⇒ no static tilemap for this tileset. */
export interface BgTilemapSource { format: 'lz2'; fileId: number; bytes: Uint8Array; vramBase: number }

export function resolveBgTilemapSource(
  rom: Uint8Array,
  symbols: SymbolMap,
  layer: 2 | 3,
  tileset: number
): BgTilemapSource | null {
  const decompress = (fileId: number): Uint8Array => {
    const srcPC = snesToPC(u24le(rom, symbols.pc('DATA_lz2_compressed_gfx_ptrs') + fileId * 3));
    const scratch = new Uint8Array(SRAM_STAGING_BYTES);
    const { destEnd } = lz2(rom, srcPC, scratch, 0);
    return scratch.slice(0, destEnd);
  };
  if (layer === 2) {
    const entry = lookupBg2Entry(rom, symbols, tileset);
    if (entry.type !== 0x00 && entry.type !== 0x04) return null; // not a plain tilemap file
    return { format: 'lz2', fileId: entry.fileIdx, bytes: decompress(entry.fileIdx), vramBase: BG2_TILEMAP_VRAM_ADDR };
  }
  if (tileset === 0) return null;
  const rowOff = symbols.pc('DATA_bg3_tilemap_table') + (tileset - 1) * 3;
  const fileId = rom[rowOff]! | (rom[rowOff + 1]! << 8);
  const action = rom[rowOff + 2]!;
  if (fileId === 0 || action === 0xff) return null; // no file / BG3 hidden
  return { format: 'lz2', fileId, bytes: decompress(fileId), vramBase: BG3_TILEMAP_VRAM_ADDR };
}

/** Diagnostics + render hints from `loadBg3Tilemap`. */
export interface Bg3LoadResult {
  /** Bytes written into VRAM at byte $6800 (0..BG3_TILEMAP_VRAM_BYTES). 0 means
   *  fillEmptyOnNoBg3 was false and BG3Tileset/fileId was 0. */
  bytesWritten: number;
  /** True when we wrote the empty-tile pattern instead of decompressed data. */
  emptyFilled: boolean;
  /** True when the per-tileset row's action byte is $FF — the cart hides
   *  BG3 in this case even though VRAM has tile data. Renderer should
   *  suppress the BG3 layer for this level. */
  bg3Disabled: boolean;
}

/**
 * Populate the BG3 tilemap region of `vram` (byte $6800 = PPU word $3400).
 * Asm-first port of `load_bg3_tilemap` ($01:E9F5).
 *
 * When `bg3Tileset == 0`, OR when the resolved file index is 0, the cart
 * skips the DMA entirely (leaves VRAM as-is). For editor preview we fill
 * the 2 KB region with the empty-tile word $01CE so BG3 shows as a clean
 * blank instead of whatever junk `load_level_gfx` happened to leave there
 * — matches the legacy GoldenEgg behaviour.
 */
export function loadBg3Tilemap(
  rom: Uint8Array,
  symbols: SymbolMap,
  bg3Tileset: number,
  vram: Uint8Array,
  gfxOverride?: ReadonlyMap<string, Uint8Array>
): Bg3LoadResult {
  if (vram.length < BG3_TILEMAP_VRAM_ADDR + BG3_TILEMAP_VRAM_BYTES) {
    throw new RangeError(
      `loadBg3Tilemap: vram is ${vram.length} bytes, need at least ${BG3_TILEMAP_VRAM_ADDR + BG3_TILEMAP_VRAM_BYTES}`
    );
  }

  if (bg3Tileset === 0) {
    fillBg3WithEmptyTile(vram);
    return { bytesWritten: BG3_TILEMAP_VRAM_BYTES, emptyFilled: true, bg3Disabled: false };
  }

  // Per-tileset 3-byte row at bg3_tilemap_table[(bg3Tileset-1)*3].
  // **Layout: (fileId_lo, fileId_hi, action).** The cart reads fileId as a
  // 16-bit LE word (`LDA.w DATA_bg3_tilemap_table-$03,y` under `REP #$20`). For some
  // tilesets the high byte is non-zero (e.g. tileset $29 → row $03,$01,$00
  // → fileId $0103). Treating only the low byte gives the wrong LZ2 file
  // and garbage BG3 char data.
  const tableBase = symbols.pc('DATA_bg3_tilemap_table');
  const rowOff = tableBase + (bg3Tileset - 1) * 3;
  const fileId = rom[rowOff] | (rom[rowOff + 1] << 8);
  const action = rom[rowOff + 2];

  if (fileId === 0) {
    fillBg3WithEmptyTile(vram);
    return { bytesWritten: BG3_TILEMAP_VRAM_BYTES, emptyFilled: true, bg3Disabled: false };
  }

  // Decompressed bytes (live overlay-aware, so a placement edit previews), then copy
  // the BG3 tilemap region (2 KB) to VRAM.
  const scratch = tilemapBytes(rom, symbols, fileId, gfxOverride);

  const sizeBytes = Math.min(scratch.length, BG3_TILEMAP_VRAM_BYTES);
  for (let i = 0; i < sizeBytes; i++) {
    vram[BG3_TILEMAP_VRAM_ADDR + i] = scratch[i];
  }
  // Zero any residual region inside the BG3 tilemap window the decompress
  // didn't reach — keeps level-to-level transitions clean.
  for (let i = sizeBytes; i < BG3_TILEMAP_VRAM_BYTES; i++) {
    vram[BG3_TILEMAP_VRAM_ADDR + i] = 0;
  }

  // BG3-hide range: $88-$FE all fall through to CODE_01EAA0 (clears
  // bit 2 of TM/TS), as does $FF explicitly. None of these levels are
  // present in V1.0's level set today but the broader check is cheap
  // and matches the cart for any future addition.
  const bg3Disabled = action === 0xff || (action >= 0x88 && action <= 0xfe);
  return {
    bytesWritten: sizeBytes,
    emptyFilled: false,
    bg3Disabled
  };
}

function fillBg3WithEmptyTile(vram: Uint8Array): void {
  const lo = BG3_EMPTY_TILE_WORD & 0xff;
  const hi = (BG3_EMPTY_TILE_WORD >>> 8) & 0xff;
  for (let i = 0; i < BG3_TILEMAP_VRAM_BYTES; i += 2) {
    vram[BG3_TILEMAP_VRAM_ADDR + i] = lo;
    vram[BG3_TILEMAP_VRAM_ADDR + i + 1] = hi;
  }
}

/** Which CGRAM palette rows (0–7) a level's BG2 and BG3 tilemaps reference — the
 *  per-layer twin of `levelMap16Usage`'s BG1 `paletteRowsUsed`, used by the
 *  Palette panel to attribute each row to the layer(s) that use it.
 *
 *  Cheap by design: a row's palette is encoded in tilemap-entry bits 10–12, so
 *  this loads only the two tilemaps (no gfx/char decode, no RGBA) and unions the
 *  palette rows over every loaded word. **Blank filler tiles are excluded** so a
 *  row isn't flagged just because the empty background uses it: tile 0 for both
 *  layers, plus BG3's designated empty-tile word `$01CE`. A BG3 layer the cart
 *  hides (`bg3Disabled`) or that's only empty-filled contributes nothing. */
export function levelBgPaletteRows(
  rom: Uint8Array,
  symbols: SymbolMap,
  header: { bg2Tileset: number; bg3Tileset: number }
): { bg2: number[]; bg3: number[] } {
  const vram = new Uint8Array(0x10000);
  const bg2Bytes = loadBg2Tilemap(rom, symbols, header.bg2Tileset, vram);
  const bg3 = loadBg3Tilemap(rom, symbols, header.bg3Tileset, vram);

  const collect = (addr: number, len: number, skipBlankTile: number): number[] => {
    const rows = new Set<number>();
    const end = Math.min(addr + len, vram.length - 1);
    for (let off = addr; off + 2 <= end + 2 && off + 1 < vram.length; off += 2) {
      const entry = vram[off]! | (vram[off + 1]! << 8);
      const baseTile = entry & 0x3ff;
      if (baseTile === 0 || baseTile === skipBlankTile) continue; // blank filler
      rows.add((entry >>> 10) & 0x07);
    }
    return [...rows].sort((a, b) => a - b);
  };

  return {
    bg2: collect(BG2_TILEMAP_VRAM_ADDR, bg2Bytes, -1),
    bg3:
      bg3.bg3Disabled || bg3.emptyFilled
        ? []
        : collect(BG3_TILEMAP_VRAM_ADDR, bg3.bytesWritten, BG3_EMPTY_TILE_WORD & 0x3ff)
  };
}
