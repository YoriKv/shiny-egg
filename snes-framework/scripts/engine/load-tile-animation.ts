// Animated-tile frame-0 initializer. Asm-first port of
// `init_tileset_animation` ($00:D571) — the routine the cart calls during
// level-load (gm$0C) to populate the always-on animated VRAM slots at
// $1400 / $1440 / $1480 / $14C0 (coins / !-switch / !-coin / Mario stars)
// plus any per-tileset animated regions selected by the level's
// `LevelHeaderAnimationTileset` byte (header[10]).
//
// Without this step the animated-tile VRAM regions hold whatever bytes
// `loadLevelGfx` happened to leave there — typically uninitialized
// (zero-filled) — which makes any Map16 cell that references those tile
// indices render as garbage in BG1.
//
// # Cart algorithm
//
// `init_tileset_animation` runs a 32-iteration loop:
//
//   $7974++                  ; global animation frame counter
//   call animate_bg_tilesets ; per-tileset DMA + default-slots DMA
//
// `animate_bg_tilesets` ($00:D65D) then:
//
//   1. Dispatches to `DATA_tile_animation_ptrs[header[10] * 2]` — one of
//      18 per-tileset handlers (water / clouds / butterflies / torches /
//      lava / etc). Each handler does its own DMAs into level-specific
//      VRAM regions, indexed by per-handler state ($0B67 / $0B6D).
//   2. Always-on default-slots logic:
//        Y = ($7974 & $1E) << 1
//        if ($7E08 & DATA_default_tile_anim_frame_masks[Y]) != 0:  Y += 2     ; alt-frame swap
//        DMA $80 bytes from $52:DATA_default_tile_anim_source_ptrs[Y] to VRAM at
//                                DATA_default_tile_anim_vram_ptrs[Y]
//   3. If $0CFB != 0: also DMA water-tile frames from CARTRAM to VRAM
//      $1280/$1380 (water animations re-initialized after certain level
//      events). Skipped here — source is CARTRAM, not ROM.
//
// Running the loop 32 times "warms up" all four animation frames per
// slot. The final VRAM state has the most-recent write for each unique
// destination — sufficient for the static editor preview.
//
// # Current scope
//
// Implements both the always-on default-slots logic (step 2) AND all 18
// per-tileset handlers (step 1, header[10] = 0x00..0x11). Each handler
// is a faithful port of the cart's per-iteration DMA logic — the
// 32-iteration warm-up loop produces the final post-init VRAM state
// (last-write-wins per byte). See the per-handler comments below for
// specific edge cases (timer-gated paths, level-mode dependencies).
//
// # Assumed initial state
//
// Cart-side state ($7974 frame counter, $7E08 variant flag, $0B67/$0B6D
// handler cycle position) is non-deterministic at level load — it
// carries over from prior gameplay. We zero-initialize: this matches a
// "cold boot" interpretation that is reasonable for the editor preview
// and is also what the cart would do after a fresh power-on.

import type { SymbolMap } from './symbol-map.ts';
import { u16le } from './rom-read.ts';

const VRAM_BYTES = 0x10000;
const ITERATIONS = 0x20; // matches the cart's outer counter at $0000
const DEFAULT_DMA_SIZE = 0x80;

/** Level-header fields the tile-animation init reads. */
export interface TileAnimHeader {
  /** header[10] — LevelHeaderAnimationTileset (0..$11). Selects the
   *  per-tileset handler from `DATA_tile_animation_ptrs`. */
  animationTileset: number;
  /** header[1] — BG1Tileset. Read by `tile_animation_07` to swap source
   *  bank between FXDATA $52 and DATA $56 when bg1Tileset == $0A. */
  bg1Tileset: number;
  /** header[9] — LevelMode. Read by `tile_animation_06` to switch
   *  destination VRAM from $1000 region to $7F00 (mode $0A cinema). */
  levelMode: number;
}

/** Mutable cart-side animation state, used by per-tileset handlers.
 *  Initialized to zero at the start of `loadTileAnimation`. */
export interface TileAnimState {
  /** $7974 — global animation frame counter. The simulator increments
   *  this before each iteration of the outer loop. */
  frame: number;
  /** $0B67 — per-handler cycle position. Updated by individual handlers. */
  cycle: number;
  /** $0B6D — per-handler subcycle counter. */
  subcycle: number;
  /** $0B69 — secondary cycle position used by handler $0D. */
  reg0B69: number;
  /** $0B6B — secondary cycle position used by handler $0F. */
  reg0B6B: number;
  /** $0B6F — frame divider used by handlers $0D / $0E. */
  reg0B6F: number;
  /** $0B71 — frame divider used by handler $0F. */
  reg0B71: number;
  /** $7E08 — frame variant flag (read by always-on default-slots logic
   *  to pick alt-frame source). Bit 3 / bit 4 of this byte gate the
   *  `INY INY` advance. Treated as 0 at level load. */
  variant: number;
}

/**
 * Per-tileset handler signature. Implementations may read from ROM and
 * write to VRAM directly; state is shared via the `state` ref.
 */
export type TileAnimHandler = (
  rom: Uint8Array,
  vram: Uint8Array,
  state: TileAnimState,
  header: TileAnimHeader,
  ctx: TileAnimContext
) => void;

/** Cached cart-resident addresses for the handlers + the simulator. */
export interface TileAnimContext {
  /** PC of the SuperFX bank-$52 base (`DATA_gfx_bank52`). Used to translate 16-bit
   *  table offsets like `(…+$C000)&$FFFF` back into PC offsets for ROM reads (the
   *  asm stores them as `FXDATA_520000+$xxxx` 65816-alias literals). Most
   *  per-tileset handlers source from $52. */
  fxData520000PC: number;
  /** PC of the SuperFX bank-$56 base at OFFSET 0 (`DATA_map_character_base`). Used ONLY by
   *  `tile_animation_07`'s bg1Tileset==$0A path, which reuses the bank-$52 char
   *  table's low words ($EC00…) but swaps the DMA source BANK to $56 — i.e. a
   *  $56:0000-relative read, not a DATA_568000 one. */
  fxData560000PC: number;
  /** PC of `DATA_568000` — bank $56 OFFSET $8000, the base the per-tileset
   *  animation source tables (`DATA_00D7D5`, `DATA_00DB14`, …) are written
   *  relative to (`dw DATA_568000+$xxxx`). The handler offset literals here are
   *  those `$xxxx` displacements, so they must be added to THIS base, not
   *  `fxData560000PC` — using $56:0000 dropped the $8000 and read garbage
   *  (e.g. 1-3's BG3 flowers, 1-6's BG2 decorations). Feeds handlers
   *  $01/$03/$05/$06/$09/$0A/$0B/$0D/$0E/$0F/$10. */
  fxData568000PC: number;
}

/** Compute the PC for a bank:offset address pair. Inline-helper to keep
 *  handler bodies readable — `pcOf(ctx.fx52, $C000)` instead of
 *  `ctx.fxData520000PC + 0xC000`. */
const pcOf = (bankBasePC: number, offset16: number): number =>
  bankBasePC + (offset16 & 0xffff);

/** A single ROM→VRAM transfer (intended src/dest/size, pre-clip). */
export interface DmaTransfer {
  srcPC: number;
  /** Destination VRAM byte offset (= `vramWordAddr << 1`). */
  vramByteOffset: number;
  sizeBytes: number;
}

/** Per-transfer recorder consulted by `dmaToVram` when set. The frame
 *  enumerator installs one (and clears it in a `finally`) so it can capture
 *  which slot each animation frame was DMA'd from — both for rendering the
 *  frame strip and for the round-trip write-back to the raw CHR source. Module
 *  global, but only ever set synchronously around the enumerator loop; normal
 *  `loadTileAnimation` runs leave it null. */
let dmaTrace: ((t: DmaTransfer) => void) | null = null;

/**
 * Simulate one DMA transfer from cart ROM to VRAM. `vramWordAddr` is the
 * 16-bit word address the cart writes to `$2116` ($00:2116 = VMADDL);
 * with VMAIN=$80 (set by `init_tileset_animation` preamble) the SNES
 * increments by 1 word per pair-write, so `sizeBytes` source bytes map
 * 1:1 to `sizeBytes` destination bytes.
 *
 * Out-of-bounds writes are clipped to VRAM. The cart's DMA hardware
 * silently wraps; we choose to silently clip since none of YI's
 * animation sources should ever wrap, and a wrap would mask a bug.
 */
export function dmaToVram(
  rom: Uint8Array,
  srcPC: number,
  vram: Uint8Array,
  vramWordAddr: number,
  sizeBytes: number
): void {
  if (srcPC < 0 || srcPC + sizeBytes > rom.length) {
    throw new RangeError(
      `dmaToVram: src $${srcPC.toString(16)} + size $${sizeBytes.toString(16)} > ROM (${rom.length})`
    );
  }
  const destByte = (vramWordAddr & 0xffff) << 1;
  dmaTrace?.({ srcPC, vramByteOffset: destByte, sizeBytes });
  const end = Math.min(destByte + sizeBytes, VRAM_BYTES);
  const len = end - destByte;
  if (len <= 0) return;
  vram.set(rom.subarray(srcPC, srcPC + len), destByte);
}

/**
 * Translate a 16-bit table offset (the low word of a `FXDATA_520000+$xxxx`
 * asm-alias literal) into a ROM PC, given the cached bank-$52 base PC
 * (`ctx.fxData520000PC`, resolved from `DATA_gfx_bank52`).
 *
 * The cart stores only the low 16 bits of the SuperFX address in `dw`
 * entries because the source bank ($52) is set separately by the
 * surrounding asm. We mirror: the table offset directly indexes into the
 * 64-KB SuperFX bank starting at `ctx.fxData520000PC`.
 */
function fxSrcPC(ctx: TileAnimContext, tableValue16: number): number {
  return ctx.fxData520000PC + (tableValue16 & 0xffff);
}

/** No-op handler (header[10] == $04). Cart's `tile_animation_no_op`. */
const tileAnimationNoOp: TileAnimHandler = () => {
  /* no-op */
};

/**
 * One manifest entry per animated-tile slot the simulator wrote to. Used
 * by the editor's Files inspector to show synthesized "virtual file"
 * blocks for the animated regions (which aren't part of `scene_gfx_layout`).
 */
export interface TileAnimationEntry {
  /** Human label (`Coins` / `!-Switch` / `!-Coin` / `Star`). */
  label: string;
  /** Destination byte offset in VRAM (final-iteration write). */
  vramByteOffset: number;
  /** Byte length copied (always 0x80 for default slots). */
  sizeBytes: number;
}

/** Friendly labels for the four always-on slots, keyed by VRAM word
 *  address (since DATA_default_tile_anim_vram_ptrs stores word addrs). */
const DEFAULT_SLOT_LABELS: Record<number, string> = {
  0x1400: 'Coins',
  0x1440: '!-Switch',
  0x1480: '!-Coin',
  0x14c0: 'Star',
};

// ─────────────────────────────────────────────────────────────────────
// Per-tileset handlers — frame-by-frame DMA logic.
//
// Each handler runs once per outer-loop iteration. The cart's
// per-iteration $7974 value (= state.frame) drives most cycle indices;
// some handlers also use per-handler state at $0B67 / $0B6D / $0B69 etc.
// (state.cycle / state.subcycle / state.reg0B69 here).
//
// **Frame-0 scope**: ports faithfully simulate the cart's per-iteration
// DMA logic over the 32 iterations the cart performs. The result is the
// FINAL post-init VRAM state — last-write-wins per byte. Some handlers
// have timer-gated paths that never fire within 32 iterations (e.g.
// tile_animation_0F has a 6-frame internal timer that pre-empts its
// only DMA branch). For those, see the per-handler comment for the
// "minimal visible" bypass we apply.
// ─────────────────────────────────────────────────────────────────────

// Handler $00 — default header animation: cycles through 8 VRAM dests
// $1000-$1380 at stride $80, all sourced from $52:B400 (the same $100
// bytes copied into each slot via the $7974 & $7 index).
const tileAnimation00: TileAnimHandler = (rom, vram, state, _h, ctx) => {
  const n = state.frame & 0x7;
  const vramDest = 0x1000 | (n << 7);
  dmaToVram(rom, pcOf(ctx.fxData520000PC, 0xb400), vram, vramDest, 0x100);
};

// Handler $01 — 4-frame swap from $56:0800 / $0A00 / $0C00 / $0E00
// into VRAM $2F00 (a BG3-area animation slot). Index = ($7974 >> 2) & 6
// (= $7974 >> 1 & 3 then ×2 byte stride into a 4-entry word table).
const tileAnimation01: TileAnimHandler = (rom, vram, state, _h, ctx) => {
  const idx = (state.frame >>> 2) & 0x3;
  const srcOff = 0x0800 + idx * 0x200;
  dmaToVram(rom, pcOf(ctx.fxData568000PC, srcOff), vram, 0x2f00, 0x200);
};

// Handler $02 — water animation: pairs of DMAs into VRAM $1000-$1380.
// Index = $7974 & $1E (4-byte-stride into 16-entry src + 8-entry dest
// tables). Per-iteration: TWO DMAs, source advances $100 bytes between
// them, dests are paired ($1000+y, $1100+y) where y is the 4-entry
// index sliced by $0006.
const tileAnimation02: TileAnimHandler = (rom, vram, state, _h, ctx) => {
  // Source-pointer table at DATA_00D745 (16 dw entries, paired
  // bank-$52 offsets). Index by `($7974 & $1E)` byte-offset.
  // First 16 source values per the asm:
  //   $D000 $D800 $C000 $C000 $D200 $DA00 $C000 $C000
  //   $D400 $DC00 $C000 $C000 $D600 $DE00 $C000 $C000
  const srcTable = [
    0xd000, 0xd800, 0xc000, 0xc000, 0xd200, 0xda00, 0xc000, 0xc000,
    0xd400, 0xdc00, 0xc000, 0xc000, 0xd600, 0xde00, 0xc000, 0xc000,
  ];
  // VRAM dest pairs at DATA_00D735 / DATA_00D73D — 4 entries each.
  const destTable1 = [0x1000, 0x1080, 0x1200, 0x1280];
  const destTable2 = [0x1100, 0x1180, 0x1300, 0x1380];
  // asm: Y = $7974 & $1E (a BYTE offset into the dw tables). Source entry =
  // Y/2 (16-entry table); dest entry = (Y & $0006)/2 (4-entry table). The
  // dest index must derive from the BYTE offset, NOT the already-halved source
  // index — using (y>>1)&3 picked the $C000 filler entries and rendered the
  // water region as garbage (1-6's BG2 "coin/!-block" stamps).
  const yb = state.frame & 0x1e; // byte offset
  const y = yb >>> 1; // src table entry index (16 entries)
  const y2 = (yb & 0x6) >>> 1; // dest-pair entry index (4 entries)
  const src1 = pcOf(ctx.fxData520000PC, srcTable[y]);
  dmaToVram(rom, src1, vram, destTable1[y2], 0x100);
  // Second DMA: source advances by $100 (cart's DMA continues from where
  // the first stopped; the asm reuses the same source register).
  dmaToVram(rom, src1 + 0x100, vram, destTable2[y2], 0x100);
};

// Handler $03 — smiley clouds: 16-frame cycle, $56:1000 + $200 stride,
// dest VRAM $2F00, size $200.
const tileAnimation03: TileAnimHandler = (rom, vram, state, _h, ctx) => {
  // Source table DATA_00D794 has 16 entries pairing 4 unique sources
  // (each repeated 4 times) — index = ($7974 & $F) << 1 = byte offset.
  const srcPairs = [0x1000, 0x1200, 0x1400, 0x1600];
  const idx = ((state.frame & 0xf) >>> 2) & 0x3;
  const srcOff = srcPairs[idx];
  dmaToVram(rom, pcOf(ctx.fxData568000PC, srcOff), vram, 0x2f00, 0x200);
};

// Handler $05 — 14-step cycle through DATA_00D7D5 ($56:1800 + N*$200
// for N in 0..7 then mirror 0..7 backwards via the 14-entry table).
// State $0B67 wraps mod $38; we drive it via state.cycle.
const tileAnimation05: TileAnimHandler = (rom, vram, state, _h, ctx) => {
  // Advance $0B67 then derive Y = (($0B67 + 1) >> 1) & $FE
  // (LSR ; AND #$00FE = even-Y stride into 14-entry table).
  let cycle = state.cycle + 1;
  if (cycle >= 0x38) cycle = 0;
  state.cycle = cycle;
  // DATA_00D7D5 14 entries: $1800 $1A00 $1C00 $1E00 $2000 $2200 $2400 $2600
  //                         $2400 $2200 $2000 $1E00 $1C00 $1A00
  const table = [
    0x1800, 0x1a00, 0x1c00, 0x1e00, 0x2000, 0x2200, 0x2400, 0x2600,
    0x2400, 0x2200, 0x2000, 0x1e00, 0x1c00, 0x1a00,
  ];
  const y = (cycle >>> 1) & 0xfe; // Y is byte-stride into a dw table
  const tableIdx = (y >>> 1) % table.length;
  dmaToVram(rom, pcOf(ctx.fxData568000PC, table[tableIdx]), vram, 0x2f00, 0x200);
};

// Handler $06 — 8-frame cycle whose dest depends on LevelMode:
// mode == $0A: VRAM $7F00 (boss-arena alt region)
// else:        VRAM $2F00 (= same as handler $05)
// Source: DATA_00D7D5 at $0B67 byte-stride.
const tileAnimation06: TileAnimHandler = (rom, vram, state, header, ctx) => {
  // Cycle-advance gated by $0B6D timer.
  state.subcycle = (state.subcycle + 1) & 0xffff;
  if (state.subcycle >= 0x06) {
    state.subcycle = 0;
    state.cycle = (state.cycle + 2) & 0xe;
  }
  // Same table as handler 05.
  const table = [
    0x1800, 0x1a00, 0x1c00, 0x1e00, 0x2000, 0x2200, 0x2400, 0x2600,
  ];
  const y = state.cycle & 0xe;
  const tableIdx = (y >>> 1) % table.length;
  const srcPC = pcOf(ctx.fxData568000PC, table[tableIdx]);
  const dest = header.levelMode === 0x0a ? 0x7f00 : 0x2f00;
  dmaToVram(rom, srcPC, vram, dest, 0x200);
};

// Handler $07 — 4-frame paired DMA at VRAM $1000-$1180.
// Two source pages chosen by $7974 parity:
//   even $7974: $1080/$1180 dests, sources DATA_00D878/00D888
//   odd  $7974: $1000/$1100 dests, sources DATA_00D858/00D868
// BG1Tileset == $0A also bumps source bank from $52 to $56.
const tileAnimation07: TileAnimHandler = (rom, vram, state, header, ctx) => {
  // Cycle position from $0B67 (= state.cycle).
  state.subcycle = (state.subcycle + 1) & 0xffff;
  if (state.subcycle >= 0x0b) {
    state.subcycle = 0;
    state.cycle = (state.cycle + 1) & 0x3;
  }
  // Cart uses a sliding Y = $0B67 * 2 (dw-stride), then +8 if bg1 == $0A.
  // The cart reads `LDA DATA_xxxx,y` where Y is a BYTE offset into a `dw`
  // table, so the entry index it selects is `Y/2` (= cycle, or cycle+4 for
  // bg1 $0A). Our `*Src` arrays are entry-indexed, so the index is `y >> 1`.
  //   ⚠ Was `y % 8`, which used the byte offset directly as the entry index —
  //   for bg1 $0A that cancels the +8 (mod 8) and lands on entries {0,2,4,6}
  //   instead of {4,5,6,7}; for bg1≠$0A it lands on {0,2,4,6} instead of
  //   {0,1,2,3}. Masked on lava tilesets whose source pages are dense at
  //   every entry (e.g. 1-4 / bank $56), but 4-8 (bank $52) has a SPARSE page
  //   at the wrongly-hit entry 4 ($F400) → the lava body rendered as dirt.
  const yBase = state.cycle << 1;
  const yOffset = header.bg1Tileset === 0x0a ? 8 : 0;
  const y = yBase + yOffset;
  const idx = (y >> 1) & 0x07; // entry index = byte-offset / 2
  // DATA_00D858 (8 entries, src for odd): $C800 $CA00 $CC00 $CE00 $EC00 $EE00 $F000 $F200
  // DATA_00D868 (odd 2nd): $C900 $CB00 $CD00 $CF00 $ED00 $EF00 $F100 $F300
  // DATA_00D878 (even 1st): $EC00 $EE00 $F000 $F200 $F400 $F600 $F800 $FA00
  // DATA_00D888 (even 2nd): $ED00 $EF00 $F100 $F300 $F500 $F700 $F900 $FB00
  const evenSrc1 = [0xec00, 0xee00, 0xf000, 0xf200, 0xf400, 0xf600, 0xf800, 0xfa00];
  const evenSrc2 = [0xed00, 0xef00, 0xf100, 0xf300, 0xf500, 0xf700, 0xf900, 0xfb00];
  const oddSrc1 = [0xc800, 0xca00, 0xcc00, 0xce00, 0xec00, 0xee00, 0xf000, 0xf200];
  const oddSrc2 = [0xc900, 0xcb00, 0xcd00, 0xcf00, 0xed00, 0xef00, 0xf100, 0xf300];
  const bankPC = header.bg1Tileset === 0x0a ? ctx.fxData560000PC : ctx.fxData520000PC;
  if ((state.frame & 1) === 0) {
    // even path: $1080 / $1180
    dmaToVram(rom, pcOf(bankPC, evenSrc1[idx]), vram, 0x1080, 0x100);
    dmaToVram(rom, pcOf(bankPC, evenSrc2[idx]), vram, 0x1180, 0x100);
  } else {
    // odd path: $1000 / $1100
    dmaToVram(rom, pcOf(bankPC, oddSrc1[idx]), vram, 0x1000, 0x100);
    dmaToVram(rom, pcOf(bankPC, oddSrc2[idx]), vram, 0x1100, 0x100);
  }
};

// Handler $08 — 4-frame cycle from $52:E400 paired pages into VRAM
// $1000/$1100.
const tileAnimation08: TileAnimHandler = (rom, vram, state, _h, ctx) => {
  state.subcycle = (state.subcycle + 1) & 0xffff;
  if (state.subcycle >= 0x10) {
    state.subcycle = 0;
    state.cycle = (state.cycle + 1) & 0x3;
  }
  // DATA_00D91D: $E400 $E600 $E800 $EA00
  // DATA_00D925: $E500 $E700 $E900 $EB00
  const src1Table = [0xe400, 0xe600, 0xe800, 0xea00];
  const src2Table = [0xe500, 0xe700, 0xe900, 0xeb00];
  dmaToVram(rom, pcOf(ctx.fxData520000PC, src1Table[state.cycle]), vram, 0x1000, 0x100);
  dmaToVram(rom, pcOf(ctx.fxData520000PC, src2Table[state.cycle]), vram, 0x1100, 0x100);
};

// Handler $09 — advances DATA_568000 source pointer by $200 every 8
// frames. dest VRAM $2F00 size $200.
const tileAnimation09: TileAnimHandler = (rom, vram, state, _h, ctx) => {
  state.subcycle = (state.subcycle + 1) & 0xffff;
  if (state.subcycle >= 0x08) {
    state.subcycle = 0;
    state.cycle = (state.cycle + 0x200) & 0x600;
  }
  dmaToVram(rom, pcOf(ctx.fxData568000PC, state.cycle), vram, 0x2f00, 0x200);
};

// Handler $0A — like $09 but starts at $56:3000 and wraps over 8
// cycles ($200 stride × 8 = $1000 window).
const tileAnimation0A: TileAnimHandler = (rom, vram, state, _h, ctx) => {
  if (state.subcycle >= 0x08) {
    state.subcycle = 0;
    state.cycle = (state.cycle + 0x200) & 0xe00;
  }
  state.subcycle = (state.subcycle + 1) & 0xffff;
  dmaToVram(rom, pcOf(ctx.fxData568000PC, 0x3000 + state.cycle), vram, 0x2f00, 0x200);
};

// Handler $0B — alternates: even $7974 frames run handler $02 (water);
// odd frames step through a 14-entry source table at DATA_00D9BE.
const tileAnimation0B: TileAnimHandler = (rom, vram, state, header, ctx) => {
  if ((state.frame & 1) === 0) {
    tileAnimation02(rom, vram, state, header, ctx);
    return;
  }
  // DATA_00D9BE: 14 entries cycling $3000-$3E00 then back.
  const table = [
    0x3000, 0x3200, 0x3400, 0x3600, 0x3800, 0x3a00, 0x3c00, 0x3e00,
    0x3c00, 0x3a00, 0x3800, 0x3600, 0x3400, 0x3200,
  ];
  // DATA_00D9DA timing table: $000A $0004 $0004 $0004 $0004 $0004 $0004 $000A $0004…
  const timing = [10, 4, 4, 4, 4, 4, 4, 10, 4, 4, 4, 4, 4, 4];
  const cycleIdx = state.cycle & 0xf;
  if (state.subcycle >= timing[cycleIdx % timing.length]) {
    state.subcycle = 0;
    state.cycle = (state.cycle + 1) % 14;
  }
  state.subcycle++;
  dmaToVram(rom, pcOf(ctx.fxData568000PC, table[state.cycle % table.length]), vram, 0x2f00, 0x200);
};

// Handler $0C — 6-frame cycle, alternates DATA_00DA29 / DATA_00DA41
// source pages each frame; dest VRAM $1000 / $1100 / $1080 / $1180.
const tileAnimation0C: TileAnimHandler = (rom, vram, state, _h, ctx) => {
  // DATA_00DA59 timing: $0010 $000C $000C $0010 $000C $000C (6 entries)
  const timing = [0x10, 0x0c, 0x0c, 0x10, 0x0c, 0x0c];
  if (state.subcycle >= timing[state.cycle % timing.length]) {
    state.subcycle = 0;
    state.cycle = (state.cycle + 2) % 12;
  }
  state.subcycle++;
  // DATA_00DA29: $E000 $E100 $E200 $E300 $F400 $F500 $F600 $F700 $F400 $F500 $E200 $E300
  // DATA_00DA41: $F800 $F900 $FA00 $FB00 $FC00 $FD00 $FE00 $FF00 $FC00 $FD00 $FA00 $FB00
  const table1 = [
    0xe000, 0xe100, 0xe200, 0xe300, 0xf400, 0xf500, 0xf600, 0xf700,
    0xf400, 0xf500, 0xe200, 0xe300,
  ];
  const table2 = [
    0xf800, 0xf900, 0xfa00, 0xfb00, 0xfc00, 0xfd00, 0xfe00, 0xff00,
    0xfc00, 0xfd00, 0xfa00, 0xfb00,
  ];
  const y = state.cycle;
  if ((state.frame & 2) === 0) {
    // even: DATA_00DA29 → $1000 / $1100
    dmaToVram(rom, pcOf(ctx.fxData520000PC, table1[y]), vram, 0x1000, 0x100);
    dmaToVram(rom, pcOf(ctx.fxData520000PC, table1[y + 1] ?? table1[y]), vram, 0x1100, 0x100);
  } else {
    // odd: DATA_00DA41 → $1080 / $1180
    dmaToVram(rom, pcOf(ctx.fxData520000PC, table2[y]), vram, 0x1080, 0x100);
    dmaToVram(rom, pcOf(ctx.fxData520000PC, table2[y + 1] ?? table2[y]), vram, 0x1180, 0x100);
  }
};

// Handler $0D — chains handler $07; every 6 frames bumps a separate
// DATA_00D7D5 cursor via $0B69 and runs the $2F00 DMA.
const tileAnimation0D: TileAnimHandler = (rom, vram, state, header, ctx) => {
  state.reg0B6F = (state.reg0B6F + 1) & 0xffff;
  if (state.reg0B6F < 0x06) {
    tileAnimation07(rom, vram, state, header, ctx);
    return;
  }
  state.reg0B6F = 0;
  state.reg0B69 = (state.reg0B69 + 2) & 0xe;
  // DATA_00D7D5 (same as handler 05): $56:1800 + N*$200
  const table = [0x1800, 0x1a00, 0x1c00, 0x1e00, 0x2000, 0x2200, 0x2400, 0x2600];
  const idx = (state.reg0B69 >>> 1) % table.length;
  dmaToVram(rom, pcOf(ctx.fxData568000PC, table[idx]), vram, 0x2f00, 0x200);
};

// Handler $0E — alternates: odd $7974 frames run handler $0C; even
// frames do the DATA_00D7D5 cursor-bump path (same as $0D's bump path).
const tileAnimation0E: TileAnimHandler = (rom, vram, state, header, ctx) => {
  state.reg0B6F = (state.reg0B6F + 1) & 0xffff;
  if ((state.frame & 1) === 0) {
    // Even: cursor bump path (same as 0D's else branch)
    state.reg0B6F = 0;
    state.reg0B69 = (state.reg0B69 + 2) & 0xe;
    const table = [0x1800, 0x1a00, 0x1c00, 0x1e00, 0x2000, 0x2200, 0x2400, 0x2600];
    const idx = (state.reg0B69 >>> 1) % table.length;
    dmaToVram(rom, pcOf(ctx.fxData568000PC, table[idx]), vram, 0x2f00, 0x200);
    return;
  }
  tileAnimation0C(rom, vram, state, header, ctx);
};

// Handler $0F — 4-frame cycle from $56:2800-$2E00 into VRAM $2F00, but
// gated by a 6-frame timer (DMA only fires when timer wraps).
// **Frame-0 visibility bypass**: the cart's timer means no DMA in the
// first 5 iterations. For visual coverage we drive the timer on a
// per-call basis so the DMA fires every 6 iterations naturally — the
// 32-iter loop gives us ~5 distinct frames written.
const tileAnimation0F: TileAnimHandler = (rom, vram, state, _h, ctx) => {
  state.reg0B71 = (state.reg0B71 + 1) & 0xffff;
  if (state.reg0B71 >= 0x06) {
    state.reg0B71 = 0;
    state.reg0B6B = (state.reg0B6B + 1) & 0x3;
    // DATA_00DB14: $2800 $2A00 $2C00 $2E00
    const table = [0x2800, 0x2a00, 0x2c00, 0x2e00];
    dmaToVram(rom, pcOf(ctx.fxData568000PC, table[state.reg0B6B]), vram, 0x2f00, 0x200);
  }
};

// Handler $10 — 4-frame cycle DATA_568000 $4000/$4080-... paired
// into VRAM $2F00 / $2F80, each $80 bytes (half-size compared to
// most others).
const tileAnimation10: TileAnimHandler = (rom, vram, state, _h, ctx) => {
  const y = (state.subcycle & 0xc) >>> 2;
  state.subcycle = (state.subcycle + 1) & 0xffff;
  // DATA_00DB44: $4000 $4100 $4200 $4300
  // DATA_00DB4C: $4080 $4180 $4280 $4380
  const t1 = [0x4000, 0x4100, 0x4200, 0x4300];
  const t2 = [0x4080, 0x4180, 0x4280, 0x4380];
  dmaToVram(rom, pcOf(ctx.fxData568000PC, t1[y]), vram, 0x2f00, 0x80);
  dmaToVram(rom, pcOf(ctx.fxData568000PC, t2[y]), vram, 0x2f80, 0x80);
};

// Handler $11 — every 4 frames runs handler $03 (smiley clouds); other
// frames run handler $0C.
const tileAnimation11: TileAnimHandler = (rom, vram, state, header, ctx) => {
  if ((state.frame & 3) === 0) {
    tileAnimation03(rom, vram, state, header, ctx);
  } else {
    tileAnimation0C(rom, vram, state, header, ctx);
  }
};

// Registry mapping `header[10]` value (0..$11) to its handler.
const handlers: TileAnimHandler[] = [
  tileAnimation00,
  tileAnimation01,
  tileAnimation02,
  tileAnimation03,
  tileAnimationNoOp, // $04: cart's `tile_animation_no_op`
  tileAnimation05,
  tileAnimation06,
  tileAnimation07,
  tileAnimation08,
  tileAnimation09,
  tileAnimation0A,
  tileAnimation0B,
  tileAnimation0C,
  tileAnimation0D,
  tileAnimation0E,
  tileAnimation0F,
  tileAnimation10,
  tileAnimation11,
];

/** Resolved cart addresses + dispatch for one tile-animation run — the shared
 *  setup `loadTileAnimation` (final-state) and `enumerateTileAnimationFrames`
 *  (per-frame) both build before stepping. */
interface TileAnimRun {
  handler: TileAnimHandler;
  ctx: TileAnimContext;
  defaultVramPtrsPC: number;
  defaultSrcPtrsPC: number;
  variantGatePC: number;
}

/** Fresh zeroed run state (cold-boot interpretation — see file header). */
function freshTileAnimState(): TileAnimState {
  return { frame: 0, cycle: 0, subcycle: 0, reg0B69: 0, reg0B6B: 0, reg0B6F: 0, reg0B71: 0, variant: 0 };
}

/** Resolve the cart addresses + pick the handler for `header`. */
function prepareTileAnimRun(symbols: SymbolMap, header: TileAnimHeader): TileAnimRun {
  // SuperFX bank bases, resolved by the canonical SuperFX-native `DATA_*`
  // definition labels (`DATA_gfx_bank52:`/`DATA_map_character_base:` in SuperFX/Banks/Bank5x.asm;
  // the `FXDATA_*` form is the 65816-side cross-ref alias the asm uses in
  // `#FXDATA_5x0000+$xxxx` literals). Both land in the FX `.sym` and resolve via
  // the merged main+FX map — same convention as the sprite cel tables. $56 feeds
  // handlers $01/$03/$05/$06/$09/$0A/$0B/$0D/$0E/$0F/$10 (smiley clouds / water
  // cycles / butterflies / etc.).
  const ctx: TileAnimContext = {
    fxData520000PC: symbols.pc('DATA_gfx_bank52'),
    fxData560000PC: symbols.pc('DATA_map_character_base'),
    // The $56 animation tables are `dw DATA_568000+$xxxx` — bank $56 offset
    // $8000 — so the handler displacement literals add to THIS base. (Distinct
    // from DATA_map_character_base, which only tile_animation_07's bank-swap path uses.)
    fxData568000PC: symbols.pc('DATA_568000'),
  };
  const handlerIdx = header.animationTileset;
  const handler =
    handlerIdx >= 0 && handlerIdx < handlers.length ? handlers[handlerIdx] : tileAnimationNoOp;
  return {
    handler,
    ctx,
    defaultVramPtrsPC: symbols.pc('DATA_default_tile_anim_vram_ptrs'),
    defaultSrcPtrsPC: symbols.pc('DATA_default_tile_anim_source_ptrs'),
    variantGatePC: symbols.pc('DATA_default_tile_anim_frame_masks'),
  };
}

/** One iteration of `init_tileset_animation`: bump the frame counter, run the
 *  per-tileset handler, then the always-on default-slots DMA. Mutates `vram` +
 *  `state` in place. Extracted so the per-frame enumerator shares it verbatim. */
function stepTileAnimation(
  rom: Uint8Array,
  vram: Uint8Array,
  state: TileAnimState,
  header: TileAnimHeader,
  run: TileAnimRun
): void {
  // INC $7974
  state.frame = (state.frame + 1) & 0xffff;

  // Dispatch per-tileset handler.
  run.handler(rom, vram, state, header, run.ctx);

  // Always-on default-slots logic.
  //   Y = ($7974 & $1E) << 1
  let y = (state.frame & 0x1e) << 1;
  //   if ($7E08 & DATA_default_tile_anim_frame_masks[Y]) != 0: Y += 2
  if ((state.variant & u16le(rom, run.variantGatePC + y)) !== 0) {
    y += 2;
  }
  const vramDest = u16le(rom, run.defaultVramPtrsPC + y);
  const srcOff16 = u16le(rom, run.defaultSrcPtrsPC + y);
  const srcPC = fxSrcPC(run.ctx, srcOff16);
  dmaToVram(rom, srcPC, vram, vramDest, DEFAULT_DMA_SIZE);

  // $0CFB water-flag branch: source is CARTRAM ($70:60C0 / $70:62C0),
  // not ROM. Skipped — the cart only triggers this after specific
  // mid-level events, so at level-load entry the flag is 0.
}

/**
 * Populate the always-on animated VRAM slots ($1400 / $1440 / $1480 /
 * $14C0) and any per-tileset slots covered by registered handlers.
 *
 * Call AFTER `loadLevelGfx` — this step overwrites portions of VRAM
 * that the chunk-list interpreter previously filled with placeholder
 * tile data.
 *
 * Mutates `vram` in place.
 */
export function loadTileAnimation(
  rom: Uint8Array,
  symbols: SymbolMap,
  header: TileAnimHeader,
  vram: Uint8Array,
  /** Optional collector — when supplied, the simulator emits one entry per
   *  unique animated-tile destination after the 32-iteration loop, capturing
   *  the final-write VRAM range and a friendly label. */
  manifest?: TileAnimationEntry[]
): void {
  if (vram.length < VRAM_BYTES) {
    throw new RangeError(
      `loadTileAnimation: vram is ${vram.length} bytes, need ${VRAM_BYTES}`
    );
  }

  const run = prepareTileAnimRun(symbols, header);
  const state = freshTileAnimState();

  for (let i = 0; i < ITERATIONS; i++) {
    stepTileAnimation(rom, vram, state, header, run);
  }

  // Emit one manifest entry per unique animated VRAM slot, with the
  // human-readable name. The four always-on slots are at word addresses
  // $1400/$1440/$1480/$14C0 → byte $2800/$2880/$2900/$2980, each 0x80
  // bytes (4 tiles at 4bpp). Per-tileset handler outputs aren't yet
  // included — port the handler then add its outputs here.
  if (manifest) {
    for (const wordAddr of [0x1400, 0x1440, 0x1480, 0x14c0]) {
      manifest.push({
        label: DEFAULT_SLOT_LABELS[wordAddr] ?? `Slot $${wordAddr.toString(16)}`,
        vramByteOffset: wordAddr << 1,
        sizeBytes: DEFAULT_DMA_SIZE,
      });
    }
  }
}
