// Decoder for `scene_register_layout` ($00:BBEA) — the per-level-mode
// PPU register configuration that determines where BG1/BG2/BG3 tilemaps
// and tile data live in VRAM.
//
// Each level-mode row is 20 bytes:
//   byte 0..3  framework metadata (interrupt mode, IRQ kind, SCBR, SCMR)
//   byte 4     backdrop-scroll flag (cart's COLDATA HDMA trick — if non-zero,
//              the cart copies CGRAM[0] backdrop to $0948 then zeros it in
//              the main mirror; renderers that want the real backdrop must
//              read from $0948 instead of CGRAM[0] for these scenes)
//   byte 5..19 15 PPU register VALUES, in the order given by reg_mirror_mapping
//              (DATA_reg_mirror_mapping at yi/Banks/Bank00.asm:5817). Slot index =
//              byte-offset minus 5:
//     slot 0  → $2105 BGMODE
//     slot 1  → $2107 BG1SC
//     slot 2  → $2108 BG2SC
//     slot 3  → $2109 BG3SC
//     slot 4  → $210B BG12NBA  (BG1 + BG2 char-data base)
//     slot 5  → $210C BG34NBA  (BG3 + BG4 char-data base)
//     slot 6  → $2123 BG1+2 window-mask settings  — not used statically
//     slot 7  → $2124 BG3+4 window-mask settings  — not used statically
//     slot 8  → $2125 OBJ + color window settings — not used statically
//     slot 9  → $212C TM       (MAIN-screen layer enable: bit 0=BG1,
//                               1=BG2, 2=BG3, 3=BG4, 4=OBJ). **Critical**
//                               — without this the renderer doesn't know
//                               which layers should be visible.
//     slot 10 → $212D TS       (sub-screen layer enable; matters only for
//                               color-math compositing — informational here)
//     slot 11 → $212E TMW      main-screen window mask  — not used statically
//     slot 12 → $212F TSW      sub-screen window mask   — not used statically
//     slot 13 → $2130 CGWSEL   color-math initial       — not used statically
//     slot 14 → $2131 CGADSUB  color-math designation   — not used statically
//
// Row lookup is a two-step indirection (per the cart's
// gm0c_level_fadein_and_name caller at yi/Banks/Bank01.asm:6201-6203):
//   1. sceneModeByteIdx = levelmode_index[levelMode]
//      (levelmode_index = DATA_levelmode_index in Bank01, 16 entries)
//   2. rowOffset = scene_layout_indices[sceneModeByteIdx]  (u16 LE; the
//      byte index is already in u16-stride form since the asm uses
//      LDY.w with x = sceneModeByteIdx, reading 2 bytes)
//   3. row = scene_register_layout + rowOffset
//
// Why two steps: multiple level-modes can share one scene-mode row
// (e.g. mode $05 maps to scene-mode index 7, the standard in-level
// scene-mode), so the levelmode_index table de-duplicates the table.
//
// **Tilemap address encoding** ($2107-$2109): `aaaaaa SH`
//   bits 7..2: tilemap base in 1K-WORD units. VRAM is word-addressed, but our
//     `vram` is a byte array, so the BYTE address = bits<<2 × 0x800 (2KB per
//     unit), NOT × 0x400. (Off-by-2× here put BG2/BG3 tilemaps at half their
//     real byte address — inside the char region, clobbering char data. The
//     char-base field below is, by contrast, already in byte units.)
//   bits 1..0: SC size — 00=32×32, 01=64×32, 10=32×64, 11=64×64
//
// **Char-base encoding** ($210B-$210C): `BBBB AAAA`
//   bits 0..3: layer-A (BG1 / BG3) char-data byte address >> 13 (8KB increments)
//   bits 4..7: layer-B (BG2 / BG4) same

import type { SymbolMap } from './symbol-map.ts';

export interface SceneRegs {
  /** PPU BGMODE register value. Low 3 bits = mode (0..7). Bit 3 = BG3
   *  high-priority flag (mode 1 only). Bits 4..7 = per-BG tile-size
   *  (0 = 8×8, 1 = 16×16) for BG1/BG2/BG3/BG4 respectively. */
  bgmode: number;
  /** BG1 tile size in pixels — 8 or 16, derived from BGMODE bit 4. */
  bg1TileSize: 8 | 16;
  /** BG2 tile size — bit 5. */
  bg2TileSize: 8 | 16;
  /** BG3 tile size — bit 6. */
  bg3TileSize: 8 | 16;
  /** BG1 tilemap VRAM byte address. */
  bg1TilemapAddr: number;
  /** BG2 tilemap VRAM byte address. */
  bg2TilemapAddr: number;
  /** BG3 tilemap VRAM byte address. */
  bg3TilemapAddr: number;
  /** BG1 tile-data VRAM byte address. */
  bg1CharAddr: number;
  /** BG2 tile-data VRAM byte address. */
  bg2CharAddr: number;
  /** BG3 tile-data VRAM byte address. */
  bg3CharAddr: number;
  /** SC-size flags per layer (0=32×32, 1=64×32, 2=32×64, 3=64×64). */
  bg1ScSize: number;
  bg2ScSize: number;
  bg3ScSize: number;
  /** Low 3 bits of BGMODE ($2105) — the SNES BG mode (0..7). YI normal
   *  levels are mode 1; offset-per-tile levels are mode 2 (no BG3 tile
   *  layer); Mode-7 boss is mode 7. Used to gate whether BG3 is a real
   *  pixel layer (modes 0/1) vs offset data (mode 2). */
  bgmodeMode: number;
  /** Raw TM byte ($212C) — main-screen layer-enable bitmask. */
  tm: number;
  /** Raw TS byte ($212D) — sub-screen layer-enable bitmask. YI composites
   *  BG2/BG3 from the subscreen via color math for most modes, so a layer
   *  can be "on screen" through TS even when its TM bit is clear. */
  ts: number;
  /** Raw CGWSEL byte ($2130) — color-math window/operand select. */
  cgwsel: number;
  /** Raw CGADSUB byte ($2131) — color-math layer-select + add/sub + half. */
  cgadsub: number;
  /** Convenience: TM bit 0 (BG1 enabled on main screen). */
  bg1Enable: boolean;
  /** TM bit 1 (BG2 enabled on main screen). */
  bg2Enable: boolean;
  /** TM bit 2 (BG3 enabled on main screen). */
  bg3Enable: boolean;
  /** TS bit 1 (BG2 enabled on subscreen — composited via color math). */
  bg2SubEnable: boolean;
  /** TS bit 2 (BG3 enabled on subscreen). */
  bg3SubEnable: boolean;
  /** CGADSUB bit 7 — color math subtracts (vs adds). The subtracted
   *  subscreen layer reads as a darkening overlay (cave shadow). */
  colorMathSubtract: boolean;
  /** CGADSUB bit 6 — half-result color math (the operand is halved). */
  colorMathHalf: boolean;
  /** TM bit 4 (OBJ/sprites enabled). */
  objEnable: boolean;
  /** Scene-row byte 4. When non-zero, the cart applies the COLDATA backdrop
   *  trick — the real backdrop color lives at $0948 rather than CGRAM[0].
   *  Editors implementing gradient backdrop should consult this flag. */
  backdropScrollFlag: number;
}

function decodeBGxSC(reg: number): { addr: number; size: number } {
  // bits 7..2 = tilemap base in 1K-WORD units → ×0x800 for the byte address
  // (see "Tilemap address encoding" above); bits 1..0 = SC-size flags.
  return {
    addr: ((reg >>> 2) & 0x3f) * 0x800,
    size: reg & 0x03
  };
}

/**
 * Read `scene_register_layout` row for the given level mode and decode
 * the BG-layer addressing fields we care about.
 */
export function loadSceneRegs(
  rom: Uint8Array,
  symbols: SymbolMap,
  levelMode: number
): SceneRegs {
  const levelmodeIdxBase = symbols.pc('DATA_levelmode_index');
  const indicesBase = symbols.pc('DATA_scene_layout_indices');
  const layoutBase = symbols.pc('DATA_scene_register_layout');

  // Step 1: levelMode → scene-mode byte-index (already in 2-byte stride).
  const sceneModeByteIdx = rom[levelmodeIdxBase + (levelMode & 0xff)];
  // Step 2: read u16 LE at scene_layout_indices[sceneModeByteIdx] → row offset.
  const rowOffset = rom[indicesBase + sceneModeByteIdx] |
    (rom[indicesBase + sceneModeByteIdx + 1] << 8);
  const row = layoutBase + rowOffset;

  const backdropScrollFlag = rom[row + 4];
  const bgmode = rom[row + 5];
  const bg1sc = rom[row + 6];
  const bg2sc = rom[row + 7];
  const bg3sc = rom[row + 8];
  const bg12nba = rom[row + 9];
  const bg34nba = rom[row + 10];
  // mirror slots (byte = slot + 5): slot 9 = row+14 → TM ($212C),
  // slot 10 = row+15 → TS ($212D), slot 13 = row+18 → CGWSEL ($2130),
  // slot 14 = row+19 → CGADSUB ($2131). Per reg_mirror_mapping at
  // yi/Banks/Bank00.asm:5817-5833. Verified byte-for-byte against the
  // bg23-render runtime captures (yi-shiny scenario) for every catalog mode.
  const tm = rom[row + 14];
  const ts = rom[row + 15];
  const cgwsel = rom[row + 18];
  const cgadsub = rom[row + 19];

  const bg1 = decodeBGxSC(bg1sc);
  const bg2 = decodeBGxSC(bg2sc);
  const bg3 = decodeBGxSC(bg3sc);

  return {
    bgmode,
    bg1TileSize: (bgmode & 0x10) ? 16 : 8,
    bg2TileSize: (bgmode & 0x20) ? 16 : 8,
    bg3TileSize: (bgmode & 0x40) ? 16 : 8,
    bg1TilemapAddr: bg1.addr,
    bg2TilemapAddr: bg2.addr,
    bg3TilemapAddr: bg3.addr,
    bg1ScSize: bg1.size,
    bg2ScSize: bg2.size,
    bg3ScSize: bg3.size,
    bgmodeMode: bgmode & 0x07,
    // Char base: each unit = 8KB = 0x2000 bytes
    bg1CharAddr: (bg12nba & 0x0f) * 0x2000,
    bg2CharAddr: ((bg12nba >>> 4) & 0x0f) * 0x2000,
    bg3CharAddr: (bg34nba & 0x0f) * 0x2000,
    tm,
    ts,
    cgwsel,
    cgadsub,
    bg1Enable: (tm & 0x01) !== 0,
    bg2Enable: (tm & 0x02) !== 0,
    bg3Enable: (tm & 0x04) !== 0,
    bg2SubEnable: (ts & 0x02) !== 0,
    bg3SubEnable: (ts & 0x04) !== 0,
    colorMathSubtract: (cgadsub & 0x80) !== 0,
    colorMathHalf: (cgadsub & 0x40) !== 0,
    objEnable: (tm & 0x10) !== 0,
    backdropScrollFlag
  };
}
