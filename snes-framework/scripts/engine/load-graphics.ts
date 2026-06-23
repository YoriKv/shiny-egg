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

/** Find the loaded gfx file covering a VRAM byte, with its file-relative tile index
 *  (`tileBytes` = 32 for 4bpp, 16 for 2bpp). Returns `null` if no loaded file covers
 *  it (an animated slot / borrowed char / miss). Shared by every CHR-slice path
 *  (bg-region, object-metatile, sprite-metasprite). `dpSlot` lets a caller gate by
 *  owning layer; 4bpp callers can ignore it. */
export function fileForVramByte(
  manifest: GfxFileEntry[],
  vramByte: number,
  tileBytes: number
): { fileId: number; format: 'lz2' | 'lz16'; fileTile: number; dpSlot?: number } | null {
  for (const e of manifest) {
    if (vramByte >= e.vramByteOffset && vramByte < e.vramByteOffset + e.sizeBytes) {
      return { fileId: e.fileId, format: e.format, fileTile: (vramByte - e.vramByteOffset) / tileBytes, dpSlot: e.dpSlot };
    }
  }
  return null;
}

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
  /** Level header field 9 (LevelMode). When `$0A` (boss-arena cinema; only
   *  level `$6B`) the cart's `load_levelmode_0A_gfx` ($00:B4D3) loads a
   *  hardcoded special GFX layout — `scene_gfx_layout` from offset `$18A`, NOT
   *  the header tileset fields — so `loadLevelGfx` routes through that program
   *  instead of the standard header-driven walk. Optional; defaults to normal. */
  levelMode?: number;
  /** Optional explicit 6 sprite-gfx file IDs that REPLACE the
   *  `DATA_spriteset_files[spriteTileset*6]` table lookup. BOTH consumers honour
   *  it — `loadLevelGfx` DMAs these files into the variable OBJ VRAM slots, and
   *  `spriteTileRow` resolves each sprite's tile-base slot against the same array
   *  — so the VRAM contents and the per-sprite slot lookup stay in sync. Lets a
   *  caller "mint" a spriteset that covers a level's sprites when no stock
   *  spriteset does (`mintSpriteset`); the static-render way to provide a valid
   *  spriteset without a ROM rebuild. Absent ⇒ read the cart table as usual.
   *  Must be length 6 when present. */
  spritesetOverride?: readonly number[];
}

/** Mode-$0A is YI's boss-arena cinema GFX variant (only level `$6B`): the cart
 *  ignores the header tilesets and loads a fixed `scene_gfx_layout` program. */
const LEVEL_MODE_0A = 0x0a;
/** `scene_gfx_layout` byte offset of the mode-$0A program (cart: `LDY #$018A`
 *  in `load_levelmode_0A_gfx`). */
const LEVEL_MODE_0A_GFX_START = 0x18a;
/** Spriteset the cart's `load_levelmode_0A_gfx` hardcodes ($6EB6..$6EBB). The
 *  `$18A` program references its sprite files as LITERALS, so these DP slots are
 *  unused by the walk itself — mirrored only for faithfulness to the cart. */
export const LEVEL_MODE_0A_SPRITESET: readonly number[] = [0x67, 0x3c, 0x55, 0x1a, 0x1a, 0x29];


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
 * The 6 variable sprite-gfx file IDs a spriteset selects — stage-1 DP slots
 * 7–12 (`DATA_spriteset_files[spriteTileset*6..]`), DMA'd to the variable
 * sprite VRAM region. The sprite-side render-validity input: a sprite renders
 * iff its metadata `spritesetFiles` ⊆ this set (see the editor's
 * sprite-render-validity lib + engine/validity-report.ts).
 */
export function loadSpritesetFileIds(
  rom: Uint8Array,
  symbols: SymbolMap,
  spriteTileset: number
): number[] {
  const base = symbols.pc('DATA_spriteset_files') + spriteTileset * 6;
  return Array.from(rom.subarray(base, base + 6));
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
/** Overwrite a just-decompressed VRAM region with a live gfx edit, if one exists
 *  for this file. Clamped to the file's loaded size + the VRAM bound. */
function applyGfxOverride(
  vram: Uint8Array,
  override: ReadonlyMap<string, Uint8Array> | undefined,
  format: 'lz2' | 'lz16',
  fileId: number,
  destByteOff: number,
  sizeBytes: number
): void {
  if (!override) return;
  const ov = override.get(`${format}/${fileId}`);
  if (!ov) return;
  const n = Math.min(ov.length, sizeBytes, vram.length - destByteOff);
  if (n > 0) vram.set(ov.subarray(0, n), destByteOff);
}

export function loadLevelGfx(
  rom: Uint8Array,
  symbols: SymbolMap,
  header: GfxHeader,
  vram: Uint8Array,
  /** Optional collector — when supplied, the loader appends one entry per
   *  decompressed gfx file. Order matches `scene_gfx_layout` walk order. */
  manifest?: GfxFileEntry[],
  /** Optional live-edit overlay (`${format}/${fileId}` → decompressed tile bytes):
   *  after a file decompresses into VRAM, its bytes are overwritten from here. Lets
   *  the editor preview unsaved-to-build gfx edits without a rebuild (the gfx twin
   *  of the live palette draft). Omit for the base cart (dev tools). */
  gfxOverride?: ReadonlyMap<string, Uint8Array>
): void {
  if (vram.length < VRAM_BYTES) {
    throw new RangeError(
      `loadLevelGfx: vram is ${vram.length} bytes, need ${VRAM_BYTES}`
    );
  }

  // Level-mode $0A (boss-arena cinema; only level $6B): the cart's
  // `load_levelmode_0A_gfx` ($00:B4D3) ignores the header tileset fields and
  // walks a fixed `scene_gfx_layout` program from $18A with a hardcoded
  // spriteset. The header tilesets are all $00 for this level, so the standard
  // path below would fill VRAM with the wrong graphics and the (correctly
  // decoded) Map16 stamps would render garbage. Route through the shared scene
  // walk instead — the engine twin of the cart's special loader.
  if (header.levelMode === LEVEL_MODE_0A) {
    loadSceneGfx(
      rom,
      symbols,
      {
        startOffset: LEVEL_MODE_0A_GFX_START,
        // dp $17..$1C (sprite slots) = hardcoded spriteset; the walk uses literal
        // file IDs so these are inert, but mirror the cart's register state.
        dpSlots: [0, 0, 0, 0, 0, 0, 0, ...LEVEL_MODE_0A_SPRITESET]
      },
      vram,
      manifest,
      gfxOverride
    );
    return;
  }

  // Resolve stage-1 (header → DP file-id) label addresses up-front.
  const BG1_TILESET_FILES_PC = symbols.pc('DATA_bg1_tileset_files');
  const BG1_DARK_TILESET_FILES_PC = symbols.pc('DATA_bg1_dark_tileset_files');
  const BG2_TILESET_FILES_PC = symbols.pc('DATA_bg2_tileset_files');
  const BG3_TILESETS_FILES_PC = symbols.pc('DATA_bg3_tilesets_files');
  const SPRITESET_FILES_PC = symbols.pc('DATA_spriteset_files');

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

  // Sprite slots: an explicit override (a minted spriteset) wins over the table —
  // the per-sprite tile-base lookup (spriteTileRow) reads the SAME override, so the
  // loaded VRAM and the slot resolution agree.
  const sprBase = SPRITESET_FILES_PC + header.spriteTileset * 6;
  const sprOverride = header.spritesetOverride;
  for (let i = 0; i < 6; i++) dp[7 + i] = sprOverride ? (sprOverride[i] ?? 0) & 0xff : rom[sprBase + i];

  // --- Stage 2: walk scene_gfx_layout from offset 0 (the in-level scene) -
  walkSceneGfx(rom, symbols, vram, dp, 0, manifest, gfxOverride);
}

/** A non-level "scene" for `loadSceneGfx` — a system screen (title, world map,
 *  Nintendo-Presents, …) loaded by the SAME `scene_gfx_layout` interpreter as
 *  levels, but from a different start offset with the DP $10..$1C file-id slots
 *  set directly (the cart's `CODE_load_*_gfx` specialisations do exactly this).
 *  See `screens.ts` for the per-screen descriptors. */
export interface SceneGfx {
  /** Byte offset into `scene_gfx_layout` where this scene's program starts. */
  startOffset: number;
  /** DP $10..$1C file-id slots (index 0 = $10) the scene's indirect chunk bytes
   *  resolve against. Literal-only scenes (e.g. Nintendo Presents) pass []. */
  dpSlots: readonly number[];
}

/**
 * Load a non-level scene's gfx into `vram` via the shared `scene_gfx_layout`
 * interpreter (the engine twin of the cart's `CODE_load_*_gfx` routines). Sets
 * DP $10..$1C from `scene.dpSlots`, then walks from `scene.startOffset`.
 */
export function loadSceneGfx(
  rom: Uint8Array,
  symbols: SymbolMap,
  scene: SceneGfx,
  vram: Uint8Array,
  manifest?: GfxFileEntry[],
  gfxOverride?: ReadonlyMap<string, Uint8Array>
): void {
  if (vram.length < VRAM_BYTES) {
    throw new RangeError(`loadSceneGfx: vram is ${vram.length} bytes, need ${VRAM_BYTES}`);
  }
  const dp = new Uint8Array(16);
  for (let i = 0; i < scene.dpSlots.length && i < dp.length; i++) dp[i] = scene.dpSlots[i]! & 0xff;
  walkSceneGfx(rom, symbols, vram, dp, scene.startOffset, manifest, gfxOverride);
}

/**
 * Shared Stage-2 walk of `scene_gfx_layout` — used by both `loadLevelGfx` (the
 * in-level scene at offset 0, DP from the header) and `loadSceneGfx` (a system
 * screen at an arbitrary offset, DP set directly). `dp` holds the resolved
 * $10..$1C file-id slots; the walk decompresses each chunk into `vram`.
 */
function walkSceneGfx(
  rom: Uint8Array,
  symbols: SymbolMap,
  vram: Uint8Array,
  dp: Uint8Array,
  startOffset: number,
  manifest?: GfxFileEntry[],
  gfxOverride?: ReadonlyMap<string, Uint8Array>
): void {
  const SCENE_GFX_LAYOUT_PC = symbols.pc('DATA_scene_gfx_layout');
  const COMPRESSED_GFX_TABLE_LZ2_PC = symbols.pc('DATA_lz2_compressed_gfx_ptrs');
  const COMPRESSED_GFX_TABLE_LZ16_PC = symbols.pc('DATA_lz16_compressed_gfx_ptrs');

  let prog = SCENE_GFX_LAYOUT_PC + startOffset;
  for (let guard = 0; guard < 10_000; guard++) {
    const chunkByte = rom[prog];
    if (chunkByte === PROGRAM_END) return;

    let fileId: number;
    let dpSlot: number | undefined;
    if (chunkByte >= INDIRECT_BASE) {
      const slotIdx = chunkByte - INDIRECT_BASE;
      if (slotIdx >= dp.length) {
        throw new Error(
          `walkSceneGfx: chunk byte $${chunkByte.toString(16)} at prog ${prog - SCENE_GFX_LAYOUT_PC} indirects past DP slots`
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
          `walkSceneGfx: LZ16 size $${sizeWord.toString(16)} at prog ${prog - SCENE_GFX_LAYOUT_PC} is not a multiple of ${BYTES_PER_TILE_ROW}`
        );
      }
      const rowCount = sizeWord / BYTES_PER_TILE_ROW;
      const srcPC = resolveGfxSrcPC(rom, COMPRESSED_GFX_TABLE_LZ16_PC, fileId, 'LZ16');
      if (destByteOff + sizeWord > VRAM_BYTES) {
        throw new RangeError(
          `walkSceneGfx: LZ16 dest $${destByteOff.toString(16)} + size $${sizeWord.toString(16)} > VRAM`
        );
      }
      lz16(rom, srcPC, vram, destByteOff, rowCount);
      applyGfxOverride(vram, gfxOverride, 'lz16', fileId, destByteOff, sizeWord);
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
          `walkSceneGfx: LZ2 dest $${destByteOff.toString(16)} >= VRAM`
        );
      }
      const result = lz2(rom, srcPC, vram, destByteOff);
      applyGfxOverride(vram, gfxOverride, 'lz2', fileId, destByteOff, result.destEnd - destByteOff);
      manifest?.push({
        fileId, dpSlot, format: 'lz2', srcPC,
        vramByteOffset: destByteOff,
        sizeBytes: result.destEnd - destByteOff
      });
      prog += 3;
    }
  }

  throw new Error(
    `walkSceneGfx: interpreter exceeded guard (no $FF terminator within 10k entries)`
  );
}
