// Palette loader — populates the 512-byte CGRAM buffer for an in-level
// scene. Asm-first port of `load_level_palettes` ($00:BA24) +
// `load_palettes` ($00:BA7A); the latter is a small bytecode interpreter
// that walks `scene_palette_layout` at $00:B78A.
//
// Replaces the legacy `gfx/load-palette.ts` (which was GoldenEgg-derived
// with documented address shifts and incomplete animated-palette handling).
//
// # Table addresses
//
// All cart-resident PC offsets are looked up via a `SymbolMap` at call time
// (the map comes from asar's `--symbols=wla` output during build). This
// survives asm patches that grow Bank00 and shift the table positions.
//
// Looked-up labels:
//
//   scene_palette_layout          interpreter program (4-byte entries)
//   bg1_palette_ptrs              32 × dw (default BG1 sub-ptrs)
//   bg1_dark_world_palette_ptrs   32 × dw (World 6 variant)
//   bg2_palette_ptrs              64 × dw
//   bg3_palette_ptrs              64 × dw
//   sprite_palette_ptrs           16 × dw
//   yoshi_palette_ptrs             8 × dw
//
// Hardcoded (cart-static, same across versions):
//
//   palette blob (DATA_master_palette_rom_blob)     PC $1FA000  — 8 KB BGR-15 colors
//   (= same byte via standard LoROM SNES $3F:A000 and via the SuperFX-mapped
//    SNES $5F:A000 = PC $1FA000)
//
// # Algorithm (per docs/enginecore.md §5 + yi/Banks/Bank00.asm:5537+)
//
// 1. Resolve 7 indirect-pointer slots from the level header. These are 16-bit
//    byte-offsets RELATIVE to the palette blob base. Mirrors zero-page DP
//    $10..$1C in the cart:
//
//      $10 = backdrop  : $0130 + bgColor * 2
//      $12 = BG1       : bg1_palette_ptrs[bg1*2]
//                        (or bg1_dark_world_palette_ptrs[bg1*2] for World 6)
//      $14 = BG2       : bg2_palette_ptrs[bg2*2]
//      $16 = BG3       : bg3_palette_ptrs[bg3*2]
//      $18 = sprite    : sprite_palette_ptrs[sprite*2]
//      $1A = BG1-alt   : $12 + $3C  (a second sub-palette in the same row;
//                        used by some fade/animation paths)
//      $1C = Yoshi     : yoshi_palette_ptrs[yoshiColor*2]
//
// 2. Run the interpreter starting at scene_palette_layout offset 0
//    (in-level program). Each entry is 4 bytes:
//
//      word 0  source pointer:
//                $0000..$7FFF  literal byte-offset into palette blob
//                $8000..$FFFE  high bit set; strip it, use as Y offset into
//                              DP $10..$1C → 16-bit indirect pointer.
//                              Conventionally Y is even (0,2,4,...) selecting
//                              slot $10, $12, $14, $16, $18, $1A, $1C.
//                $FFFF         end of program
//      byte 2  CGRAM index (palette-entry number; multiplied by 2 to get
//              byte address)
//      byte 3  size byte:
//                low nibble  = colors per row (transfer count per row)
//                high nibble = number of rows
//
// 3. Per entry: transfer `rows × colors_per_row` consecutive 16-bit color
//    words from the palette blob (starting at source offset) to CGRAM.
//    Source advances continuously across rows; dest advances by $20 bytes
//    (= 16 colors = one full CGRAM row) per row. This lets one entry
//    scatter related sub-palettes across non-contiguous CGRAM rows.
//
// 4. The cart writes to two mirrors ($70:2000 primary, $70:2D6C secondary
//    for fade/HDMA). We only emit the primary — the editor doesn't need the
//    fade-pass mirror.

import type { SymbolMap } from './symbol-map.ts';
import { u16le } from './rom-read.ts';

const BACKDROP_BASE_OFFSET = 0x0130;
const BG1_ALT_DELTA = 0x003c;
const CGRAM_BYTES = 512;
const PROGRAM_END = 0xffff;

/**
 * Level-header fields needed to load palettes. These correspond to the
 * bit-packed header fields at WRAM `$7E:0134-$7E:0152` after
 * `UnpackLevelHeader` runs.
 */
export interface PaletteHeader {
  /** Backdrop color index (0..255) — selects one of 256 backdrop colors at offset $130 in the palette blob. */
  bgColor: number;
  /** BG1 palette ID (0..31) — index into bg1_palette_ptrs. */
  bg1Palette: number;
  /** BG2 palette ID (0..63). */
  bg2Palette: number;
  /** BG3 palette ID (0..63). */
  bg3Palette: number;
  /** Sprite palette ID (0..15). */
  spritePalette: number;
  /** Yoshi color (0..7) — runtime player choice, not a header field strictly. */
  yoshiColor: number;
  /** When true, use bg1_dark_world_palette_ptrs instead of bg1_palette_ptrs. */
  isWorld6: boolean;
  /** Level header field 9 (LevelMode). When equal to `$0A` (boss-arena
   *  cinema mode) the cart uses an alternate palette-load path: only the
   *  Yoshi + Sprite DP slots get populated and the shared interpreter
   *  enters at byte offset `$D8` into `scene_palette_layout`, not 0. See
   *  the cart routine `load_levelmode_0A_palettes` at `$00:BB90`. Optional;
   *  defaults to normal mode. */
  levelMode?: number;
}

/** Mode-$0A is YI's boss-arena cinema variant; the cart skips the normal
 *  full-palette program and walks a tail-segment of scene_palette_layout
 *  that only needs Yoshi + Sprite source pointers. */
const LEVEL_MODE_0A = 0x0a;
/** Byte offset into scene_palette_layout where the mode-$0A program
 *  starts. Hardcoded in the cart as `LDX #$00D8` (`$00:BBA9`). */
const LEVEL_MODE_0A_START_OFFSET = 0xd8;

/** The CGRAM palette ROW each BG layer's colors load into, read from
 *  `scene_palette_layout`'s fixed CGRAM destinations. BG1/BG2 are 4bpp (row =
 *  colorIdx >> 4); BG3 is 2bpp (row = colorIdx >> 2). Stock normal program:
 *  BG1 → row 4, BG2 → row 6, BG3 → row 0 (row 0 holds the backdrop + BG3).
 *
 *  This is what a *paletteless gfx-file preview* needs to color a BG sheet with
 *  ITS OWN palette — the per-tile layer renderer (`render-bg-layers`/`render-bg1`)
 *  doesn't, because it reads the 3-bit palette row from each tilemap / Map16 cell.
 *  Defaults (4/6/0) cover mode-$0A, whose tail program doesn't reload the BG rows. */
export interface BgPaletteRows {
  bg1: number;
  bg2: number;
  bg3: number;
}

export function bgPaletteBaseRows(
  rom: Uint8Array,
  symbols: SymbolMap,
  levelMode?: number
): BgPaletteRows {
  const PC = symbols.pc('DATA_scene_palette_layout');
  const start = levelMode === LEVEL_MODE_0A ? LEVEL_MODE_0A_START_OFFSET : 0;
  let bg1 = -1, bg2 = -1, bg3 = -1;
  let prog = PC + start;
  for (let guard = 0; guard < 10_000; guard++) {
    const sourceWord = u16le(rom, prog);
    if (sourceWord === PROGRAM_END) break;
    if (sourceWord & 0x8000) {
      const slotIdx = (sourceWord & 0x7fff) >>> 1; // 1=$12 BG1, 2=$14 BG2, 3=$16 BG3
      const cgramByte = rom[prog + 2]!;
      if (slotIdx === 1 && bg1 < 0) bg1 = cgramByte >>> 4;
      else if (slotIdx === 2 && bg2 < 0) bg2 = cgramByte >>> 4;
      else if (slotIdx === 3 && bg3 < 0) bg3 = cgramByte >>> 2;
    }
    prog += 4;
  }
  return { bg1: bg1 < 0 ? 4 : bg1, bg2: bg2 < 0 ? 6 : bg2, bg3: bg3 < 0 ? 0 : bg3 };
}

/**
 * Run the cart's palette interpreter for an in-level scene and write the
 * resulting 512-byte CGRAM payload into `cgram`. Cgram is modified in-place
 * starting at offset 0 (one full PPU CGRAM = 256 × u16 colors).
 *
 * `symbols` resolves the table addresses (see file header for the list of
 * label names looked up). Typically loaded via `parseWlaSymbolMap(...)`
 * against the built ROM's `.sym` file.
 *
 * Throws on malformed input (interpreter runs off the end of the cart's
 * scene_palette_layout or tries to read past the palette blob).
 *
 * `provenance` (optional, length 256) is filled with each CGRAM color index's
 * SOURCE byte-offset into the master palette blob (`DATA_master_palette_rom_blob`
 * base) — the word that backs that swatch, so a color edit knows which blob
 * `dw` to rewrite. `−1` = never written by the interpreter (no blob source).
 * Last write wins, matching the cart's overwrite order. Pure add — omit it and
 * the render path is unchanged.
 */
export function loadLevelPalettes(
  rom: Uint8Array,
  symbols: SymbolMap,
  header: PaletteHeader,
  cgram: Uint8Array,
  provenance?: Int32Array
): void {
  if (cgram.length < CGRAM_BYTES) {
    throw new RangeError(
      `loadLevelPalettes: cgram is ${cgram.length} bytes, need ${CGRAM_BYTES}`
    );
  }
  if (provenance) {
    if (provenance.length < 256) {
      throw new RangeError(`loadLevelPalettes: provenance is ${provenance.length}, need 256`);
    }
    provenance.fill(-1);
  }

  // Resolve the palette-pointer tables up-front so missing-symbol errors fail
  // fast and obviously rather than mid-interpreter. (The scene-layout program +
  // blob bases are resolved inside `runPaletteProgram`.)
  const BG1_PALETTE_PTRS_PC = symbols.pc('DATA_bg1_palette_ptrs');
  const BG1_DARK_PALETTE_PTRS_PC = symbols.pc('DATA_bg1_dark_world_palette_ptrs');
  const BG2_PALETTE_PTRS_PC = symbols.pc('DATA_bg2_palette_ptrs');
  const BG3_PALETTE_PTRS_PC = symbols.pc('DATA_bg3_palette_ptrs');
  const SPRITE_PALETTE_PTRS_PC = symbols.pc('DATA_sprite_palette_ptrs');
  const YOSHI_PALETTE_PTRS_PC = symbols.pc('DATA_yoshi_palette_ptrs');

  // --- Step 1: resolve the 7 indirect-pointer slots (DP $10..$1C) -------
  // Each slot is a 16-bit byte-offset into the palette blob.
  //
  // Mode-$0A (boss-arena cinema) is a special case: the cart only sets DP
  // $10 (yoshi) and $12 (sprite), leaving $14-$1C with stale values from
  // a prior level. The alternate program at byte offset $D8 only ever
  // indirects through those two slots, so the unset entries are never
  // read. We mirror this — populating only the two used slots makes the
  // intent explicit and matches the cart's actual register state.
  const isLevelMode0A = header.levelMode === LEVEL_MODE_0A;
  const slots = new Uint16Array(8); // index by (Y / 2) — slot[0]=$10, slot[1]=$12, ..., slot[6]=$1C

  if (isLevelMode0A) {
    slots[0] = u16le(rom, YOSHI_PALETTE_PTRS_PC + header.yoshiColor * 2); // $10 = yoshi
    slots[1] = u16le(rom, SPRITE_PALETTE_PTRS_PC + header.spritePalette * 2); // $12 = sprite
    // slots[2..7] intentionally left 0 — the mode-$0A program at $D8 does
    // not indirect through them.
  } else {
    slots[0] = (BACKDROP_BASE_OFFSET + header.bgColor * 2) & 0xffff; // $10
    const bg1Ptr = header.isWorld6
      ? u16le(rom, BG1_DARK_PALETTE_PTRS_PC + header.bg1Palette * 2)
      : u16le(rom, BG1_PALETTE_PTRS_PC + header.bg1Palette * 2);
    slots[1] = bg1Ptr; // $12
    slots[2] = u16le(rom, BG2_PALETTE_PTRS_PC + header.bg2Palette * 2); // $14
    slots[3] = u16le(rom, BG3_PALETTE_PTRS_PC + header.bg3Palette * 2); // $16
    slots[4] = u16le(rom, SPRITE_PALETTE_PTRS_PC + header.spritePalette * 2); // $18
    slots[5] = (bg1Ptr + BG1_ALT_DELTA) & 0xffff; // $1A
    slots[6] = u16le(rom, YOSHI_PALETTE_PTRS_PC + header.yoshiColor * 2); // $1C
    // slots[7] is at "DP $1E" — never referenced by the in-level program, but
    // present so 16-bit indexing past $1C doesn't read uninitialised memory.
  }

  // --- Step 2: run the interpreter, starting at offset 0 (normal) or $D8
  // (mode-$0A — the cart's `load_levelmode_0A_palettes` re-enters at $D8). ---
  runPaletteProgram(
    rom, symbols, slots, isLevelMode0A ? LEVEL_MODE_0A_START_OFFSET : 0, cgram, provenance
  );
}

/** A non-level palette program for `loadScenePalettes` — a system screen's
 *  palette load (the cart's `CODE_load_*_palettes` → `CODE_load_palettes` at a
 *  hardcoded X, with DP $10..$1C palette-pointer slots set directly). */
export interface ScenePalette {
  /** Byte offset into `scene_palette_layout` where this program starts. */
  startOffset: number;
  /** DP $10..$1C palette-pointer slots (byte-offsets into the master palette
   *  blob), index 0 = $10. Indirect source words resolve against these; slots
   *  the program never reads can be 0. */
  slots: readonly number[];
}

/**
 * Load a non-level scene's palette into `cgram` via the shared palette
 * interpreter (engine twin of the cart's `CODE_load_*_palettes`). Sets the DP
 * $10..$1C palette-pointer slots directly, then walks from `scene.startOffset`.
 */
export function loadScenePalettes(
  rom: Uint8Array,
  symbols: SymbolMap,
  scene: ScenePalette,
  cgram: Uint8Array,
  provenance?: Int32Array
): void {
  if (cgram.length < CGRAM_BYTES) {
    throw new RangeError(`loadScenePalettes: cgram is ${cgram.length} bytes, need ${CGRAM_BYTES}`);
  }
  if (provenance) {
    if (provenance.length < 256) throw new RangeError(`loadScenePalettes: provenance is ${provenance.length}, need 256`);
    provenance.fill(-1);
  }
  const slots = new Uint16Array(8);
  for (let i = 0; i < scene.slots.length && i < slots.length; i++) slots[i] = scene.slots[i]! & 0xffff;
  runPaletteProgram(rom, symbols, slots, scene.startOffset, cgram, provenance);
}

/**
 * Shared `scene_palette_layout` interpreter — walks 4-byte entries from
 * `startOffset`, transferring BGR-15 colors from the master palette blob into
 * `cgram` (indirect source words resolve through `slots`). Used by both
 * `loadLevelPalettes` (header-derived slots, offset 0/$D8) and
 * `loadScenePalettes` (slots set directly, screen-specific offset).
 */
function runPaletteProgram(
  rom: Uint8Array,
  symbols: SymbolMap,
  slots: Uint16Array,
  startOffset: number,
  cgram: Uint8Array,
  provenance?: Int32Array
): void {
  const SCENE_PALETTE_LAYOUT_PC = symbols.pc('DATA_scene_palette_layout');
  // Palette blob base — BGR-15 colors, walked via 16-bit byte-offsets.
  const PALETTE_BLOB_PC = symbols.pc('DATA_master_palette_rom_blob');
  let prog = SCENE_PALETTE_LAYOUT_PC + startOffset;

  // Hard cap: a program is ~18 entries (72 bytes). Three orders of magnitude
  // past that is firmly malformed input — bail rather than loop.
  for (let guard = 0; guard < 10_000; guard++) {
    const sourceWord = u16le(rom, prog);
    if (sourceWord === PROGRAM_END) return;

    let sourceOff: number;
    if (sourceWord & 0x8000) {
      // Indirect: bits 0..14 are a byte-Y offset into DP $10..$1C area.
      const dpY = sourceWord & 0x7fff;
      // In the asm: TAY ; LDA $0010,y — so the actual DP byte address is $10 + dpY.
      // Slot index (in our slots[] array) = dpY / 2. The asm only ever uses
      // even dpY values selecting slots $10, $12, ..., $1C → indices 0..6.
      const slotIdx = dpY >>> 1;
      if (slotIdx > 7 || (dpY & 1) !== 0) {
        throw new Error(
          `runPaletteProgram: indirect source $${sourceWord.toString(16)} at prog offset ${prog - SCENE_PALETTE_LAYOUT_PC} selects unexpected DP byte (dpY=$${dpY.toString(16)})`
        );
      }
      sourceOff = slots[slotIdx]!;
    } else {
      sourceOff = sourceWord;
    }

    const cgramByte = rom[prog + 2]!; // byte 2: CGRAM color index
    const sizeByte = rom[prog + 3]!;  // byte 3: size (high nibble rows, low nibble colors/row)
    const colorsPerRow = sizeByte & 0x0f;
    const rows = (sizeByte >>> 4) & 0x0f;
    let destByte = (cgramByte << 1) & 0xffff;

    // Per the asm at CODE_00BAB4: outer loop over rows. Inner loop reads
    // `colorsPerRow` consecutive u16 source words and writes them to CGRAM
    // starting at destByte. Source advances continuously across rows; dest
    // advances by $20 (= one full 16-color row) per outer iteration.
    let srcByte = sourceOff & 0xffff;
    for (let r = 0; r < rows; r++) {
      let d = destByte;
      for (let c = 0; c < colorsPerRow; c++) {
        const srcPC = PALETTE_BLOB_PC + srcByte;
        if (srcPC + 2 > rom.length) {
          throw new RangeError(
            `runPaletteProgram: source $${srcByte.toString(16)} past palette blob end (prog ${prog - SCENE_PALETTE_LAYOUT_PC})`
          );
        }
        if (d + 2 > CGRAM_BYTES) {
          // The cart's CGRAM is exactly 512 bytes; a well-formed program never
          // writes past that.
          throw new RangeError(
            `runPaletteProgram: dest $${d.toString(16)} past CGRAM end (prog ${prog - SCENE_PALETTE_LAYOUT_PC})`
          );
        }
        cgram[d + 0] = rom[srcPC + 0]!;
        cgram[d + 1] = rom[srcPC + 1]!;
        if (provenance) provenance[d >>> 1] = srcByte; // CGRAM color idx → blob byte-offset
        srcByte = (srcByte + 2) & 0xffff;
        d += 2;
      }
      destByte = (destByte + 0x20) & 0xffff;
    }

    prog += 4;
  }

  throw new Error(
    `runPaletteProgram: interpreter exceeded guard (no $FFFF terminator within 10k entries)`
  );
}
