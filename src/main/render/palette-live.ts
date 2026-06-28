// Live palette push to a RUNNING emulator — the engine behind `bizhawk:applyPaletteLive`.
//
// A palette edit is keyed by master-blob byte-offset. To show it live on the
// screen the emulator is CURRENTLY showing, we work out which CGRAM entries source
// each edited blob offset — the scene's provenance, computed via the same
// `load*Palettes` interpreter the editor renders with — and the caller writes those
// entries into CGRAM (both the CARTRAM $2000 mirror and PPU CGRAM directly; see
// ipc/render.ts for why both). `liveSceneProvenance` classifies the current screen
// from a live WRAM read and returns that provenance.
//
// This is PER-SCREEN ONLY. The thing that would make an edit persist across screens
// — patching the master palette blob the loader reads — is impossible: the blob
// lives in read-only ROM and BizHawk can't write CARTROM (verified; the SNES ROM
// has no writable copy, the loader reads it directly — yi Bank57 DATA_master_palette_rom_blob).
// So every scene load repaints CGRAM from the untouched blob; re-sync per screen.
//
// Covered scenes (classified from the live gamemode, per yi-shiny scene-palettes.md):
// in a level, the world map, the title / file-select screen, the story cutscene, the
// intro storybook, and the boot screen. Anything else (boss / bonus / credits / retry
// / Yoshi-colour cycle / load-or-fade transitions) isn't mapped — those are noted in
// the doc §2 but rarely edited.

import {
  loadLevelPalettes,
  loadScenePalettes,
  type PaletteHeader,
  type ScenePalette
} from 'snes-framework/load-palettes'
import { mapPalette, titleVariant, WORLD_COUNT } from 'snes-framework/screen-gfx'
import type { SymbolMap } from 'snes-framework/symbol-map'

// ── Live WRAM addresses (bank-0 = BizHawk "WRAM" domain offset) ──────────────
// All resolved from the framework's WRAM defines (yi/Memory/WRAM_*.asm).
const WRAM_GAMEMODE = 0x0118 // CurrentGameMode (u16)
const WRAM_CURRENT_WORLD = 0x0218 // CurrentWorld, stored as world*2 (u16)
// Unpacked level-header palette fields ($7E:0134.., after UnpackLevelHeader).
const WRAM_HDR_BACKDROP = 0x0134
const WRAM_HDR_BG1_PAL = 0x0138
const WRAM_HDR_BG2_PAL = 0x013c
const WRAM_HDR_BG3_PAL = 0x0140
const WRAM_HDR_SPRITE_PAL = 0x0144
const WRAM_HDR_LEVEL_MODE = 0x0146
const WRAM_CURRENT_YOSHI_COLOR = 0x0383

/** Contiguous WRAM block the live-scene read must cover: gamemode → yoshi colour
 *  (one `readMem` for all classifier + header fields). */
export const LIVE_WRAM_BASE = WRAM_GAMEMODE
export const LIVE_WRAM_LEN = WRAM_CURRENT_YOSHI_COLOR + 2 - WRAM_GAMEMODE // through the hi byte

// Gamemode → scene, from the cart's game_mode_pointers table (Bank00.asm DATA_00816A,
// the named CODE_gmXX_* handlers are ground truth). We map only modes where the
// scene's palette is fully loaded + on-screen; transitional fade/load modes are left
// to mechanism A's next-load behaviour. (NB the level run-loop $0F also covers the
// in-place pause — YI pauses inside gm$0F, there's no separate pause gamemode; $10/$11
// are the victory/death cutscenes.)
const LEVEL_GAMEMODES = new Set([0x0f]) // CODE_gm0f_run_level
const MAP_GAMEMODES = new Set([0x22]) // CODE_gm22_overworld (prepare/$20 is mid-load)
// Intro storybook (gm$38 load / gm$39 active) — NOT a scene_palette_layout program:
// gm38_load_intro_cutscene fills CGRAM with a bespoke loop (Bank10.asm:10716) — BG
// half white $7FFF, OBJ half ($80–$FF) ← blob DATA_5FED4A (yi-shiny scene-palettes.md
// §3.4). Handled specially below, not via STATIC_SCENES.
const STORYBOOK_GAMEMODES = new Set([0x38, 0x39])

export type LiveScene = 'level' | 'world-map' | 'title' | 'story-cutscene' | 'storybook' | 'boot'

/** A non-level scene with a DETERMINISTIC palette program (no live header/world
 *  needed) — the `scene_palette_layout` start offset + DP slots are fixed for the
 *  screen, so provenance is computed straight from the cart. Levels (live header)
 *  and world maps (live world) are handled specially in `liveSceneProvenance`. */
interface StaticScene {
  id: LiveScene
  /** Gamemodes this screen is shown in (load + interactive). */
  gamemodes: Set<number>
  /** The scene's palette program (resolved from the cart; may throw if symbols
   *  are absent — caught by the caller). */
  makeScene: (rom: Uint8Array, symbols: SymbolMap) => ScenePalette
}

// Mirrors the catalog's scene descriptors (palette-catalog.ts buildSceneGroups) —
// the same programs the "All Palettes" panel renders, so editing matches.
const STATIC_SCENES: StaticScene[] = [
  // Title screen + the player-select menu (file select rides the title screen, same
  // X=$26 program). gm$09 loads it, gm$0A is the interactive idle (Bank17).
  { id: 'title', gamemodes: new Set([0x09, 0x0a]), makeScene: (rom, sym) => titleVariant(rom, sym).palette },
  // Story cutscene (between-world / opening Bowser pages) — gm$05 load / gm$07 active.
  // Program X=$50, all fixed blob literals (yi-shiny scene-palettes.md §3.4 — this is
  // the program $50 we used to mislabel "storybook"; the real storybook is bespoke,
  // handled in liveSceneProvenance).
  { id: 'story-cutscene', gamemodes: new Set([0x05, 0x07]), makeScene: () => ({ startOffset: 0x50, slots: [] }) },
  // "Nintendo Presents" boot (gm$01 load / gm$03 show) — literal-only program at $40.
  { id: 'boot', gamemodes: new Set([0x01, 0x03]), makeScene: () => ({ startOffset: 0x40, slots: [] }) }
]

/** Storybook intro (gm$38/$39) provenance: the bespoke fill maps the OBJ half
 *  (CGRAM colours $80–$FF) to the master-blob region at `DATA_5FED4A`, in order; the
 *  BG half is the white-literal pages (not blob-backed → −1). See STORYBOOK_GAMEMODES. */
function storybookProvenance(symbols: SymbolMap, provenance: Int32Array): void {
  const objOff = (symbols.pc('DATA_5FED4A') - symbols.pc('DATA_master_palette_rom_blob')) & 0xffff
  for (let i = 0x80; i < 0x100; i++) provenance[i] = (objOff + (i - 0x80) * 2) & 0xffff
}

export interface LiveSceneResult {
  scene: LiveScene
  /** CGRAM index → master-blob byte-offset (−1 = not blob-sourced), for the scene
   *  currently displayed. Feed to `offsetCgramRuns`. */
  provenance: Int32Array
}

/**
 * Classify the screen the emulator is showing (from a live WRAM snapshot starting
 * at `LIVE_WRAM_BASE`) and compute its CGRAM provenance via the same palette
 * interpreter the editor renders with. Returns null when the current screen isn't
 * one we map instantly (title / menus / transitions) — mechanism A still carries
 * the edit on that screen's next load. Defensive: a malformed header (read during
 * a transition) is swallowed → null.
 */
export function liveSceneProvenance(
  rom: Uint8Array,
  symbols: SymbolMap,
  wram: Uint8Array
): LiveSceneResult | null {
  const u16 = (addr: number): number => {
    const i = addr - LIVE_WRAM_BASE
    if (i < 0 || i + 1 >= wram.length) return 0
    return wram[i]! | (wram[i + 1]! << 8)
  }
  const gm = u16(WRAM_GAMEMODE) & 0xff
  const provenance = new Int32Array(256)

  if (LEVEL_GAMEMODES.has(gm)) {
    const world = (u16(WRAM_CURRENT_WORLD) >>> 1) & 0xff
    const header: PaletteHeader = {
      bgColor: u16(WRAM_HDR_BACKDROP) & 0xff,
      bg1Palette: u16(WRAM_HDR_BG1_PAL) & 0x1f,
      bg2Palette: u16(WRAM_HDR_BG2_PAL) & 0x3f,
      bg3Palette: u16(WRAM_HDR_BG3_PAL) & 0x3f,
      spritePalette: u16(WRAM_HDR_SPRITE_PAL) & 0x0f,
      yoshiColor: u16(WRAM_CURRENT_YOSHI_COLOR) & 0x07,
      isWorld6: world === 5,
      levelMode: u16(WRAM_HDR_LEVEL_MODE) & 0xff
    }
    try {
      loadLevelPalettes(rom, symbols, header, new Uint8Array(512), provenance)
    } catch {
      return null
    }
    return { scene: 'level', provenance }
  }

  if (MAP_GAMEMODES.has(gm)) {
    const world = (u16(WRAM_CURRENT_WORLD) >>> 1) & 0xff
    // Guard a garbage live value: an out-of-range world would index the per-world
    // map-palette tables OOB and silently map to wrong offsets (vs. throwing).
    if (world >= WORLD_COUNT) return null
    try {
      loadScenePalettes(rom, symbols, mapPalette(rom, symbols, world), new Uint8Array(512), provenance)
    } catch {
      return null
    }
    return { scene: 'world-map', provenance }
  }

  if (STORYBOOK_GAMEMODES.has(gm)) {
    try {
      storybookProvenance(symbols, provenance)
    } catch {
      return null
    }
    return { scene: 'storybook', provenance }
  }

  const desc = STATIC_SCENES.find((s) => s.gamemodes.has(gm))
  if (desc) {
    try {
      loadScenePalettes(rom, symbols, desc.makeScene(rom, symbols), new Uint8Array(512), provenance)
    } catch {
      return null
    }
    return { scene: desc.id, provenance }
  }

  return null
}
