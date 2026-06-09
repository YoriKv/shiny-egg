// Graphics loader — populates the 64-KB VRAM buffer for an in-level scene.
// Asm-first port of `load_level_gfx` ($00:B339) +
// `load_compressed_gfx_files` ($00:B39E) — a small bytecode interpreter
// over `scene_gfx_layout`.
//
// Replaces the legacy `gfx/load-graphics.ts` (which was GoldenEgg-derived
// with documented address shifts and used the broken old `lz16`).
//
// # Table addresses
//
// All cart-resident PC offsets are looked up via a `SymbolMap` at call time
// (the map comes from asar's `--symbols=wla` output during build), so the
// loader survives asm patches that shift table positions.
//
// Looked-up labels:
//
//   scene_gfx_layout             chunk-list interpreter program
//   bg1_tileset_files            16 × 3 bytes (BG1 file IDs)
//   bg1_dark_tileset_files       World-6 variant
//   bg2_tileset_files            32 × 2 bytes (BG2 file IDs)
//   bg3_tilesets_files           48 × 2 bytes (BG3 file IDs)
//   spriteset_files              N × 6 bytes (sprite file IDs)
//   DATA_lz2_compressed_gfx_ptrs                  LZ2-format source ptrs (24-bit SuperFX
//                                cart pointers). Aliased in the framework
//                                asm as `DATA_lz2_compressed_gfx_ptrs`.
//   DATA_lz16_compressed_gfx_ptrs                  LZ16-format source ptrs
//
// # Algorithm (per docs/enginecore.md §6 + yi/Banks/Bank00.asm:4821+)
//
// **Stage 1: resolve file IDs from the level header into DP $10..$1C.**
//
//   header.bg1Tileset       → 3 bytes from bg1_tileset_files[idx*3..]      → DP $10/$11/$12
//   header.bg1Tileset (W6)  → 3 bytes from bg1_dark_tileset_files[idx*3..] → DP $10/$11/$12
//   header.bg2Tileset       → 2 bytes from bg2_tileset_files[idx*2..]      → DP $13/$14
//   header.bg3Tileset       → 2 bytes from bg3_tilesets_files[idx*2..]     → DP $15/$16
//   header.spriteTileset    → 6 bytes from spriteset_files[idx*6..]        → DP $17..$1C
//
// **Stage 2: walk scene_gfx_layout from offset 0.** Each entry is 3 bytes
// (5 for LZ16):
//
//   byte 0   chunk index:
//             $00..$EF   literal compressed-file ID
//             $F0..$FE   indirect — fileId = DP[$10 + (byte - $F0)]
//                        (i.e. selects one of the per-set IDs resolved in stage 1)
//             $FF        end-of-program
//
//   byte 1..2  VRAM destination address (LE u16, word-address into VRAM).
//              Bit 15 set selects LZ16 format; clear selects LZ2.
//              Byte address into the 64-KB VRAM buffer = (word & $7FFF) * 2.
//
//   byte 3..4  (LZ16 only) Uncompressed byte size (LE u16). Divide by 512
//              to get `rowCount` (each 8×8 tile-row of 16 tiles = 512 bytes
//              at 4bpp).
//
// **Stage 3: per entry, run the decompressor.** Source pointer comes from
// the appropriate table:
//
//   LZ2  : srcSnes = u24(DATA_lz2_compressed_gfx_ptrs[fileId*3..])
//   LZ16 : srcSnes = u24(DATA_lz16_compressed_gfx_ptrs[fileId*3..])
//
// Source pointers are 24-bit SNES addresses in the SuperFX bank-mapped
// region (`$40-$5F`) — `snesToPC` must use SuperFX math, not standard LoROM.
// (See docs/enginecore.md §6.5/§6.6 for the bank-mapping arithmetic.)
//
// Output: writes decompressed graphics into `vram` at the per-entry byte
// destination. After all entries the buffer holds all BG1/BG2/BG3/sprite
// tile-data + tilemap bytes the level needs.

import { lz2 } from './decompress/lz2.ts';
import { lz16 } from './decompress/lz16.ts';
import { snesToPC, type SymbolMap } from './symbol-map.ts';
import { u16le, u24le } from './rom-read.ts';
import type { GfxFileEntry } from '../types.ts';
// Re-exported so existing `from 'snes-framework/load-graphics'` imports keep
// resolving GfxFileEntry now that its single definition lives in types.ts.
export type { GfxFileEntry };

const VRAM_BYTES = 0x10000; // 64 KB
const PROGRAM_END = 0xff;
const INDIRECT_BASE = 0xf0;
const BYTES_PER_TILE_ROW = 512; // 16 tiles × 32 bytes (4bpp)

/**
 * Level-header fields needed to load graphics. Indexes are pre-clamped to
 * the relevant bit width per the YI header bit-length table — caller is
 * responsible for not exceeding the per-table size.
 */
export interface GfxHeader {
  /** BG1 tileset (0..15) — picks 3 file IDs from bg1_tileset_files. */
  bg1Tileset: number;
  /** BG2 tileset (0..31) — picks 2 file IDs from bg2_tileset_files. */
  bg2Tileset: number;
  /** BG3 tileset (0..47) — picks 2 file IDs from bg3_tilesets_files. */
  bg3Tileset: number;
  /** Sprite tileset (0..N) — picks 6 file IDs from spriteset_files. */
  spriteTileset: number;
  /** When true, use bg1_dark_tileset_files instead of bg1_tileset_files. */
  isWorld6: boolean;
}


/**
 * Read a compressed-gfx source pointer from `tablePC[fileId]` and resolve it to
 * a PC offset, rejecting one that can't be a real ROM location. A corrupt or
 * incomplete built ROM reads the pointer table as filler — `$000000` (zeroed)
 * or `$FFFFFF` (→ out-of-ROM PC) — which would otherwise feed the LZ decoder a
 * garbage source and let it walk to its iteration cap. Turn that into a clear,
 * actionable error up front instead.
 */
function resolveGfxSrcPC(
  rom: Uint8Array,
  tablePC: number,
  fileId: number,
  format: 'LZ2' | 'LZ16'
): number {
  const srcSnes = u24le(rom, tablePC + fileId * 3);
  const srcPC = snesToPC(srcSnes);
  if (srcSnes === 0 || srcPC < 0 || srcPC >= rom.length) {
    const hx = (n: number): string => '$' + (n >>> 0).toString(16).toUpperCase();
    throw new Error(
      `loadLevelGfx: ${format} gfx pointer for file ${hx(fileId)} resolves to ` +
        `${hx(srcSnes)} (pc ${hx(srcPC)}, rom ${rom.length} bytes) — not a valid ` +
        `ROM location. The built ROM looks corrupt or incomplete; rebuild it.`
    );
  }
  return srcPC;
}

/**
 * Run the cart's graphics interpreter for an in-level scene and write the
 * resulting 64-KB VRAM payload into `vram`. Vram is modified in-place
 * starting at offset 0.
 *
 * `symbols` resolves the table addresses (see file header). Typically
 * loaded via `parseWlaSymbolMap(...)` against the built ROM's `.sym` file.
 *
 * Throws on malformed input (interpreter runs off the cart, source pointer
 * lands outside ROM, or VRAM destination would overflow).
 */
export function loadLevelGfx(
  rom: Uint8Array,
  symbols: SymbolMap,
  header: GfxHeader,
  vram: Uint8Array,
  /** Optional collector — when supplied, the loader appends one entry per
   *  decompressed gfx file. Order matches `scene_gfx_layout` walk order. */
  manifest?: GfxFileEntry[]
): void {
  if (vram.length < VRAM_BYTES) {
    throw new RangeError(
      `loadLevelGfx: vram is ${vram.length} bytes, need ${VRAM_BYTES}`
    );
  }

  // Resolve label addresses up-front.
  const SCENE_GFX_LAYOUT_PC = symbols.pc('DATA_scene_gfx_layout');
  const BG1_TILESET_FILES_PC = symbols.pc('DATA_bg1_tileset_files');
  const BG1_DARK_TILESET_FILES_PC = symbols.pc('DATA_bg1_dark_tileset_files');
  const BG2_TILESET_FILES_PC = symbols.pc('DATA_bg2_tileset_files');
  const BG3_TILESETS_FILES_PC = symbols.pc('DATA_bg3_tilesets_files');
  const SPRITESET_FILES_PC = symbols.pc('DATA_spriteset_files');
  const COMPRESSED_GFX_TABLE_LZ2_PC = symbols.pc('DATA_lz2_compressed_gfx_ptrs');
  const COMPRESSED_GFX_TABLE_LZ16_PC = symbols.pc('DATA_lz16_compressed_gfx_ptrs');

  // --- Stage 1: resolve file IDs into a 13-slot pseudo-DP buffer ---------
  // dp[0] corresponds to asm DP $10, dp[1] to $11, ..., dp[12] to $1C.
  const dp = new Uint8Array(16);

  const bg1Base =
    (header.isWorld6 ? BG1_DARK_TILESET_FILES_PC : BG1_TILESET_FILES_PC) +
    header.bg1Tileset * 3;
  dp[0] = rom[bg1Base + 0];
  dp[1] = rom[bg1Base + 1];
  dp[2] = rom[bg1Base + 2];

  const bg2Base = BG2_TILESET_FILES_PC + header.bg2Tileset * 2;
  dp[3] = rom[bg2Base + 0];
  dp[4] = rom[bg2Base + 1];

  const bg3Base = BG3_TILESETS_FILES_PC + header.bg3Tileset * 2;
  dp[5] = rom[bg3Base + 0];
  dp[6] = rom[bg3Base + 1];

  const sprBase = SPRITESET_FILES_PC + header.spriteTileset * 6;
  for (let i = 0; i < 6; i++) dp[7 + i] = rom[sprBase + i];

  // --- Stage 2: walk scene_gfx_layout from offset 0 ----------------------
  let prog = SCENE_GFX_LAYOUT_PC;
  for (let guard = 0; guard < 10_000; guard++) {
    const chunkByte = rom[prog];
    if (chunkByte === PROGRAM_END) return;

    let fileId: number;
    let dpSlot: number | undefined;
    if (chunkByte >= INDIRECT_BASE) {
      const slotIdx = chunkByte - INDIRECT_BASE;
      if (slotIdx >= dp.length) {
        throw new Error(
          `loadLevelGfx: chunk byte $${chunkByte.toString(16)} at prog ${prog - SCENE_GFX_LAYOUT_PC} indirects past DP slots`
        );
      }
      fileId = dp[slotIdx];
      dpSlot = slotIdx;
    } else {
      fileId = chunkByte;
    }

    const vramDest = u16le(rom, prog + 1);
    const isLz16 = (vramDest & 0x8000) !== 0;
    const destByteOff = (vramDest & 0x7fff) << 1;

    if (isLz16) {
      const sizeWord = u16le(rom, prog + 3);
      if (sizeWord % BYTES_PER_TILE_ROW !== 0) {
        // The cart's data should always pass exact tile-row multiples here.
        // A non-multiple would mean we'd produce fewer pixels than the size
        // word claims, leaving uninitialised tail bytes. Treat as malformed.
        throw new Error(
          `loadLevelGfx: LZ16 size $${sizeWord.toString(16)} at prog ${prog - SCENE_GFX_LAYOUT_PC} is not a multiple of ${BYTES_PER_TILE_ROW}`
        );
      }
      const rowCount = sizeWord / BYTES_PER_TILE_ROW;
      const srcPC = resolveGfxSrcPC(rom, COMPRESSED_GFX_TABLE_LZ16_PC, fileId, 'LZ16');
      if (destByteOff + sizeWord > VRAM_BYTES) {
        throw new RangeError(
          `loadLevelGfx: LZ16 dest $${destByteOff.toString(16)} + size $${sizeWord.toString(16)} > VRAM`
        );
      }
      lz16(rom, srcPC, vram, destByteOff, rowCount);
      manifest?.push({
        fileId, dpSlot, format: 'lz16', srcPC,
        vramByteOffset: destByteOff, sizeBytes: sizeWord
      });
      prog += 5;
    } else {
      const srcPC = resolveGfxSrcPC(rom, COMPRESSED_GFX_TABLE_LZ2_PC, fileId, 'LZ2');
      // LZ2 doesn't carry an explicit output-size in the chunk entry — the
      // decoder terminates on the $FF sentinel and we trust it to fit
      // within VRAM. Bound it for safety.
      if (destByteOff >= VRAM_BYTES) {
        throw new RangeError(
          `loadLevelGfx: LZ2 dest $${destByteOff.toString(16)} >= VRAM`
        );
      }
      const result = lz2(rom, srcPC, vram, destByteOff);
      manifest?.push({
        fileId, dpSlot, format: 'lz2', srcPC,
        vramByteOffset: destByteOff,
        sizeBytes: result.destEnd - destByteOff
      });
      prog += 3;
    }
  }

  throw new Error(
    `loadLevelGfx: interpreter exceeded guard (no $FF terminator within 10k entries)`
  );
}
