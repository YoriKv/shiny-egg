// Declarative schema for the Level Header panel — the 15 bit-packed header
// fields of a level (the analogue of property-schema's objectFields/spriteFields,
// but level-wide rather than per-entity).
//
// Field order, names, and bit widths are the engine's
// snes-framework/scripts/engine/object-decode/header.ts (HEADER_BIT_WIDTHS), and
// the widths are mirrored renderer-side in canvas/limits.ts (HEADER_BIT_WIDTHS),
// which is the single source the clamp + this schema both read. Every field is a
// dropdown: the palette rows, sprite tileset/palette, BG color and item memory
// offer every value their bits can hold (each indexes a full table); the two
// animation fields only their dispatch table's entries (past them the game jumps
// to garbage). Values a list leaves out stay selectable as a raw fallback, so a
// header is never silently rewritten.
//
// The curated label sets below (level mode, music, BG1/2/3 tilesets) are
// verified against the game's OWN authored index→name tables — `BG1CHRBK` /
// `BG2CHRBK` / `BG3CHRBK` in `sfc/ys_init.asm`, `GMMDNOD` in
// `sfc/ys_game.asm`, and `BGM_INIT_FLAG` in `sfc/ys_game.asm` — each of which
// carries a `;[index:name]` comment per row. Where those internal dev names are
// cryptic (e.g. variant "′" rows, "elevator test"), the user-facing label leans
// on the GoldenEgg reference editor's descriptive appearance-name and the
// authored name is noted; where GoldenEgg was factually wrong (several music
// tracks, every "Standard level" mode) the authored table wins. All of this was
// cross-checked against the 157 authored `.prm` level files (which index → which
// real level). Fields with no per-value names in any table (sprite tileset, the
// palette rows) get them from evidence instead: the wiki backdrop recipes
// (bg-setups.ts) name the BG2/BG3 palettes and animation values, and anything
// still unnamed is labelled at render time from shipped-level usage — the
// tilesets a palette ships with (`companion`), else the levels that use it.
//
// The panel adds two guides on top of the names (lib/header-guide.ts): which
// shipped levels use the selected value (the base-cart `render:headerGuide`
// index — the one description every field has, named or not), and, for the
// palette-row fields, a swatch strip of the colors the row loads (`swatch`).
// An option's `detail` is the longer note shown under the field while that value
// is selected.

import { HEADER_BIT_WIDTHS } from '../canvas/limits'
import { BG2_SETUPS, BG3_SETUPS, type BgSetup } from './bg-setups'
import { HEADER_FIELD as F } from './header-fields'
import type { EnumOption, FieldKind } from './property-schema'

/** Curated labels for the level-mode field (header[9], 5-bit). Primary names are
 *  the authored `GMMDNOD` "画面モードタイプデータ" table (`ys_game.asm`), which
 *  names every mode by purpose — superseding the old generic "Standard level"
 *  placeholders. Cross-validated against the per-level `.prm` usage AND the
 *  verified PPU-register captures in `snes-framework/docs/bg23rendering.md §3`:
 *    - 0x02 Underwater — only 3-3-3, which is also BG1 Pond (color-math on).
 *    - 0x03 Lava (Mode 2) — the offset-per-tile BG3 "wavy" heat distortion.
 *    - 0x08 Snowfall — every World-5 snow stage.
 *    - 0x09 Mode-7 — Raphael's moon boss (record 0xCB only).
 *    - 0x0A — autoscroll/BG-Mode-0: 6-8 Kamek (record 0x6B). NOTE: the authored
 *      table calls this the "double Big Boo" mode; yi-shiny's render analysis
 *      calls it Kamek autoscroll. Same PPU config; verify in-game before trusting.
 *  Any unlisted value shows as a raw fallback. */
export const LEVEL_MODES: EnumOption[] = [
  { value: 0x00, label: 'Underground / snow (basic)' },
  { value: 0x01, label: 'Mole (BG3 mask)' },
  { value: 0x02, label: 'Underwater' },
  {
    value: 0x03,
    label: 'Lava (offset-per-tile BG3, wavy)',
    detail: 'PPU Mode 2: BG3 drives offset-per-tile scrolling of BG1/BG2 — the wavy heat distortion.'
  },
  { value: 0x04, label: 'Bubble (BG3 mask)' },
  { value: 0x05, label: 'Wall' },
  { value: 0x06, label: 'Forest (dappled light)' },
  { value: 0x07, label: 'Hole-Lakitu / Fly-Guy (BG3)' },
  { value: 0x08, label: 'Snowfall' },
  {
    value: 0x09,
    label: "Mode 7 boss (Raphael's moon)",
    detail: "PPU Mode 7 arena built for Raphael the Raven's moon — not a general-purpose mode."
  },
  {
    value: 0x0a,
    label: 'BG Mode 0 (Kamek autoscroll)',
    detail:
      'PPU BG Mode 0 with autoscroll. The game’s own table calls this the “double Big Boo” mode; the render analysis matches the Kamek chase. Verify in-game.'
  },
  { value: 0x0b, label: 'Pipe (Dokan)' },
  { value: 0x0c, label: 'BG2 enemy' },
  { value: 0x0d, label: "BG2 enemy (Prince Froggy's stomach)" },
  { value: 0x0e, label: 'BG3 mask' },
  { value: 0x0f, label: 'Snow (gradually clearing)' }
]

const FREE_MUSIC_DETAIL =
  'A free value: silent on an unmodified game. Repoint it in the Audio panel’s Sets tab to give it music.'

/** Curated labels for the music field (header[13], 4-bit). Names are the authored
 *  `BGM_INIT_FLAG` "ＢＧＭセット" table (`ys_game.asm`), whose per-row
 *  `;[index:name]` comments are developer-authoritative — they CORRECT several
 *  GoldenEgg mislabels the editor previously carried: GoldenEgg's "Jungle" (0x01)
 *  is really 地上 = above-ground/overworld; its "Kamek's Theme" (0x05/0x08) is
 *  really the いきなりボス "instant-boss" variant; its "No Music" (0x0C) is really
 *  大クッパ = King Bowser; its 0x0D is スペシャル４ = Special 4. Cross-checked
 *  against `.prm` usage (0x00 Flower Garden = 1-1/2-1…, 0x02 Castle = every fort,
 *  0x04 Underground = World 6, 0x05 = mini-boss rooms not Kamek). 0x0E/0x0F are
 *  blank in the table + unused → omitted (raw fallback). */
// Labels for 0x00-0x0D are IDENTICAL to the audio catalog's
// MUSIC_SETTING_NAMES (snes-framework/scripts/audio/catalog.ts) — one game
// concept, one name everywhere; keep the two lists in lockstep (0x0E/0x0F
// share the "Custom 0xNN" base; this dropdown adds a silence hint).
export const MUSIC_TRACKS: EnumOption[] = [
  { value: 0x00, label: 'Flower Garden' },
  { value: 0x01, label: 'Overworld (above-ground)' },
  { value: 0x02, label: 'Castle / Fortress' },
  { value: 0x03, label: 'Boss' },
  { value: 0x04, label: 'Underground' },
  { value: 0x05, label: 'Boss (instant-boss variant)' },
  { value: 0x06, label: 'Bonus Game' },
  { value: 0x07, label: 'Big Boss' },
  { value: 0x08, label: 'Big Boss (instant-boss variant)' },
  { value: 0x09, label: 'Big Boss (hard-mode variant)' },
  { value: 0x0a, label: 'Athletic' },
  { value: 0x0b, label: 'Invincible Mario (star)' },
  { value: 0x0c, label: 'King Bowser' },
  { value: 0x0d, label: 'Special 4' },
  // Free values — silent on an unmodified game (they point at the driver-only
  // set); repoint them in the Audio panel's Sets tab for custom music picks.
  { value: 0x0e, label: 'Custom 0x0E (silent until repointed)', detail: FREE_MUSIC_DETAIL },
  { value: 0x0f, label: 'Custom 0x0F (silent until repointed)', detail: FREE_MUSIC_DETAIL }
]

/** Curated labels for the BG1 tileset field (header[1], 4-bit, full 16-value
 *  coverage). The base rows (0x0–0x7) take the authored `BG1CHRBK` identity
 *  (`ys_init.asm`): 0x0 地下/cave, 0x1 草/grass, 0x2 水中/pond, 0x3 溶岩/lava,
 *  0x4 雪/snow, 0x5 ジャングル/jungle, 0x6 カベ/wall, 0x7 花/flower. The "′"
 *  variant rows (0x8–0xF) are palette/gfx swaps the source only marks as primes,
 *  so they default to GoldenEgg's more useful in-game appearance names.
 *
 *  Where the authored identity and GoldenEgg's appearance-name conflicted, the
 *  call was made by co-occurrence — reading the theme off the source-named
 *  BG2/BG3/music/mode AND the decoded sprite set of every level that uses the
 *  value (tools: `tmp/cooccur.mjs` for headers, `tmp/sprite-cooccur.ts` for the
 *  named sprites). The sprite set is the stronger signal — it overruled a
 *  header-only guess on 0xB. Verdicts:
 *    - 0x3 Lava (6-4 fort runs mode=lava-mode2 + BG2=lava; sprites Lava Bubble /
 *      Lava Drop) — not GoldenEgg's "3D stone".
 *    - 0xA Wooden castle (every user is a `-4` fortress with boss/Blargg sprites;
 *      the source's "underwater′" comment is stale gfx-slot lineage).
 *    - 0xB Sewer (sprites are literally named "Sewer ghost" / "Caged Ghost
 *      squeezing in sewer", plus Spray Fish / Aqua Lakitu / Jean de Fillet) —
 *      GoldenEgg is right; the headers alone (solid-black BG2) misleadingly
 *      looked like a generic dark interior, and the source's "lava′" is wrong.
 *    - 0xD Sky (BG2=sky; sprites Baron Von Zeppelin / Balloon in Cloud World).
 *    - 0x1 Grass (generic green ground used under night / snow-mtn / sky
 *      backdrops, not forest-specific) — not GoldenEgg's "Forest 1".
 *
 *  0x2 Pond is the special "unsigned object width" tileset — switching a level
 *  into/out of it can corrupt object widths (GoldenEgg clamps width>128→1). */
export const BG1_TILESETS: EnumOption[] = [
  { value: 0x0, label: 'Cave' },
  { value: 0x1, label: 'Grass' },
  {
    value: 0x2,
    label: 'Pond (unsigned object widths)',
    detail:
      'Object widths are read unsigned in this tileset — switching a level into or out of it can corrupt wide objects.'
  },
  { value: 0x3, label: 'Lava / 3D rock' },
  { value: 0x4, label: 'Snow' },
  { value: 0x5, label: 'Jungle' },
  { value: 0x6, label: 'Brick castle / wall' },
  { value: 0x7, label: 'Flower' },
  { value: 0x8, label: 'Cave 2' },
  { value: 0x9, label: 'Forest 2' },
  { value: 0xa, label: 'Wooden castle' },
  { value: 0xb, label: 'Sewer' },
  { value: 0xc, label: 'Flower Garden' },
  { value: 0xd, label: 'Sky' },
  { value: 0xe, label: 'Stone castle' },
  { value: 0xf, label: 'Grass 2' }
]

/** Curated labels for the BG2 tileset field (header[3], 5-bit, full 32-value
 *  coverage). User-facing appearance names from the GoldenEgg reference editor.
 *  Unlike BG1 (where the authored `BG1CHRBK` identity won), for the BG2 backdrop
 *  GoldenEgg's names are MORE faithful than the source's `BG2CHRBK` comments:
 *  rendering the BG2 layer (via `tmp/bg-index.ts` + render-cli) shows the source's
 *  terse dev-names have drifted from the final look — 0x01 renders as bamboo
 *  Woods (source comment "月/moon"), 0x04 as pine Forest+Mountains (source
 *  "雪/snow"). BG2/BG3 gfx slots were reused + re-paletted, so the original-intent
 *  comment isn't the on-screen result; GoldenEgg named what actually shows. Kept
 *  verbatim and render-spot-checked — do NOT "correct" these toward the source.
 *  One exception, from the community "BG2 Settings for GoldenEgg" wiki (see
 *  bg-setups.ts): 0x0F was a second "Forest and Mountains", but renders (6-3) as
 *  volcanoes under orange clouds — the wiki's "Volcano". */
export const BG2_TILESETS: EnumOption[] = [
  { value: 0x00, label: 'Cave, Waterfall' },
  { value: 0x01, label: 'Woods' },
  { value: 0x02, label: 'Pond' },
  { value: 0x03, label: '3D stone, Lava' },
  { value: 0x04, label: 'Forest and Mountains' },
  { value: 0x05, label: 'Forest' },
  { value: 0x06, label: 'Castle, Watercourse and Candles' },
  { value: 0x07, label: 'Tropical Mountains' },
  { value: 0x08, label: 'Forest' },
  { value: 0x09, label: 'Jungle, Mountains' },
  { value: 0x0a, label: 'Waterfall' },
  { value: 0x0b, label: 'Distant grounds' },
  { value: 0x0c, label: 'Boggy Woods' },
  { value: 0x0d, label: "Night sky, Raven's Moons" },
  { value: 0x0e, label: 'Grass' },
  { value: 0x0f, label: 'Volcanoes' },
  { value: 0x10, label: 'Jungle, Mountains' },
  { value: 0x11, label: 'Glitched' },
  { value: 0x12, label: 'Ocean' },
  { value: 0x13, label: 'Cave, Crystals' },
  { value: 0x14, label: 'Castle, webs' },
  { value: 0x15, label: 'Sky, Mountains (low)' },
  { value: 0x16, label: 'Boss' },
  { value: 0x17, label: 'Glitched' },
  { value: 0x18, label: 'Forest, Eerie Cave' },
  { value: 0x19, label: 'Castle, Stones' },
  { value: 0x1a, label: 'Sky, Mountains (high)' },
  { value: 0x1b, label: 'None' },
  { value: 0x1c, label: 'Smiley Mountains' },
  { value: 0x1d, label: 'Round Mountains' },
  { value: 0x1e, label: 'Forest' },
  { value: 0x1f, label: "Baby Bowser's Room" }
]

/** Curated labels for the BG3 tileset field (header[5], 6-bit; the authored
 *  `BG3CHRBK` table (`ys_init.asm`) defines exactly 0x00–0x2F, matching
 *  GoldenEgg's range). User-facing appearance names from GoldenEgg, with the
 *  three indices GoldenEgg left "Unknown" filled from the source table:
 *  0x08 砂嵐/Sandstorm, 0x09 バブル/Bubble, 0x0B "eleveter test" (a leftover
 *  debug entry — unused). Any value ≥ 0x30 shows as a raw fallback.
 *
 *  As with BG2, render-spot-checking (`tmp/bg-index.ts` + render-cli) confirms
 *  GoldenEgg's names beat the source's `BG3CHRBK` comments for this backdrop
 *  layer: 0x0C renders as diagonal light shafts = "Shine" (source comment
 *  "森/forest"); 0x0A renders blank — it's the dig-reveal mask, so GoldenEgg's
 *  "Cross Section Cover" and the source's "モグラ/mole" both fit. Kept verbatim,
 *  except where the community "BG3 Settings for GoldenEgg" wiki (bg-setups.ts)
 *  names a backdrop more specifically and renders agree: 0x24 is a Starry-Night
 *  oil-painted sky (was "Night sky, Moons"), 0x2A a giant moon, 0x28 white stars,
 *  0x29/0x2B small/big clouds, 0x2E clouds drawn in front of BG2, 0x20 bushes
 *  and palms (with BG2 Smiley mountains), 0x02/0x05/0x06 the sprite-layer sets. */
export const BG3_TILESETS: EnumOption[] = [
  { value: 0x00, label: 'None' },
  { value: 0x01, label: 'Water of Pond' },
  { value: 0x02, label: 'BG3 objects 1 (sprite layer)' },
  { value: 0x03, label: 'Clouds, glitched' },
  { value: 0x04, label: 'Animated clouds' },
  { value: 0x05, label: 'BG3 objects 2 (sprite layer)' },
  { value: 0x06, label: 'BG3 objects 3 (sprite layer)' },
  { value: 0x07, label: 'BG3 objects 4 (sprite layer)' },
  { value: 0x08, label: 'Sandstorm' },
  { value: 0x09, label: 'Bubble' },
  { value: 0x0a, label: 'Cross Section Cover' },
  { value: 0x0b, label: 'Elevator test (unused)' },
  { value: 0x0c, label: 'Shine' },
  { value: 0x0d, label: 'Clouds and Mountains' },
  { value: 0x0e, label: 'Boggy Woods' },
  { value: 0x0f, label: 'Sky, Mountains' },
  { value: 0x10, label: 'Sky, Clouds' },
  { value: 0x11, label: 'Fog (Hookbill the Koopa)' },
  { value: 0x12, label: "Night sky, Raven's Moon" },
  { value: 0x13, label: 'Water (low)' },
  { value: 0x14, label: 'Jungle' },
  { value: 0x15, label: 'Cave crystals' },
  { value: 0x16, label: 'Shark Chomp' },
  { value: 0x17, label: 'Rocks' },
  { value: 0x18, label: 'Castle, Torches' },
  { value: 0x19, label: 'Snowstorm' },
  { value: 0x1a, label: 'Goonies' },
  { value: 0x1b, label: 'Flower Garden' },
  { value: 0x1c, label: 'Spotlight' },
  {
    value: 0x1d,
    label: 'Water (high)',
    detail: 'The Water tileset (0x13) with higher tides — no scroll setting makes it scroll correctly.'
  },
  { value: 0x1e, label: 'Moon, Clouds, and Mountains' },
  { value: 0x1f, label: 'Magic Shower' },
  { value: 0x20, label: 'Bushes and palms' },
  { value: 0x21, label: "Prince Froggy's throat" },
  { value: 0x22, label: 'Clouds and Mist' },
  { value: 0x23, label: 'Sun' },
  { value: 0x24, label: 'Oil-painted stars and moon' },
  { value: 0x25, label: "Boss's Room" },
  { value: 0x26, label: 'Pop' },
  { value: 0x27, label: 'Forest' },
  { value: 0x28, label: 'White stars' },
  { value: 0x29, label: 'Clouds (small)' },
  { value: 0x2a, label: 'Giant moon' },
  { value: 0x2b, label: 'Clouds (big)' },
  { value: 0x2c, label: 'Mist, waves' },
  { value: 0x2d, label: 'Mist, scrolls left' },
  { value: 0x2e, label: 'Clouds in front of BG2' },
  { value: 0x2f, label: 'Sky, Clouds' }
]

/** Curated labels for the BG scroll-rate field (header[12], 5-bit). Each value
 *  selects a row of the engine's parallax-divisor tables that
 *  `LevelHeaderBGScrollSetting` indexes (`Bank04.asm`: `DATA_04FB6E` /
 *  `DATA_04FBAE` / `DATA_04FBEE` / `DATA_04FC2E`). The labels spell out the
 *  per-layer horizontal/vertical scroll *divisors* — how much slower BG2 / BG3
 *  scroll than BG1 — taken verbatim from the authored `bg_data` "scroll type"
 *  reference table (e.g. `H/2,V/4` = BG2 scrolls at half the camera speed
 *  horizontally, a quarter vertically). Only 0x0–0x7, 0xE, 0xF are named in
 *  the source, though shipped levels also use 0x09–0x0D and 0x10–0x14 — the panel
 *  offers those as unnamed entries (with the levels that use them). Parallax is
 *  not simulated in the live preview, so these are informational — Test Level to
 *  verify the on-screen feel. */
export const SCROLL_TYPES: EnumOption[] = [
  { value: 0x0, label: 'BG2 H/2 V/4, BG3 H/4 V/8' },
  { value: 0x1, label: 'BG2 H/2 V/1, BG3 H/4 V/1' },
  { value: 0x2, label: 'BG2 H/1 V/1, BG3 H/1 V/1 (locked)' },
  { value: 0x3, label: 'BG2 H/2 V/4, BG3 H/1 V/1' },
  { value: 0x4, label: 'BG2 H/2 V/4, BG3 none' },
  { value: 0x5, label: 'BG2 H/2 V/4, BG3 H/4 V/4' },
  { value: 0x6, label: 'BG2 H/2 V/4, BG3 H/1.2 V/1.2' },
  { value: 0x7, label: 'BG2 H/2 V/4, BG3 H/2 V/4' },
  { value: 0xe, label: 'BG2 H/2 (no vertical)' },
  { value: 0xf, label: 'None (both layers locked)' }
]

export { HEADER_FIELD } from './header-fields'

/** The palette-catalog group a palette-row field previews (`buildPaletteCatalog`
 *  ids; `bg1` swaps to `bg1-dark` for World 6). `backdrop` is the BG-color field:
 *  a solid color below 0x10, a gradient table from 0x10 up. */
export type HeaderSwatch = 'backdrop' | 'bg1' | 'bg2' | 'bg3' | 'sprite'

export interface HeaderField {
  /** Index into LevelData.header (0..14). */
  index: number
  label: string
  field: FieldKind
  hint: string
  swatch?: HeaderSwatch
  /** The field whose names describe this one's unnamed values — a palette row
   *  is named after the tilesets it ships with (lib/header-guide `usageName`). */
  companion?: number
  /** Whether editing it re-skins the static preview live. Fields 12–14 (BG
   *  scroll rate, music, item memory) have no renderer consumer — they affect
   *  only the built ROM, so the panel groups them under "Gameplay". */
  preview: boolean
}

/** Tile-animation handlers (header[10]), one per `DATA_tile_animation_ptrs`
 *  entry (Bank00 — 18 of them; a value past 0x11 indexes past the table). Named
 *  by what each animates, from the handler ports in engine/load-tile-animation.ts:
 *  VRAM $1000–$1380 is BG1 object tiles (water / lava surfaces), $2F00 the BG3
 *  animation slot. 0x07's fort lava-water is graphicsassets.md §6. The wiki
 *  recipes that use a handler are appended by `recipeNames`. */
const ANIM_TILESET_NAMES: Record<number, string> = {
  0x00: 'Default (BG1 tiles)',
  0x01: 'BG3, 4-frame swap',
  0x02: 'Water (BG1 tiles)',
  0x03: 'Smiley clouds (BG3)',
  0x04: 'None',
  0x05: 'BG3, 14-step cycle',
  0x06: 'BG3, 8-frame cycle',
  0x07: 'Fort lava-water (BG1 tiles)',
  0x08: 'BG1 tiles, 4-frame',
  0x09: 'BG3 strip, every 8 frames',
  0x0a: 'BG3 strip, 8-step loop',
  0x0b: 'Water + BG3 cycle',
  0x0c: 'BG1 tiles, 6-frame',
  0x0d: 'Fort lava-water + BG3',
  0x0e: 'BG1 6-frame + BG3',
  0x0f: 'BG3, timed 4-frame',
  0x10: 'BG3, half-size 4-frame',
  0x11: 'Smiley clouds + BG1 6-frame'
}
const ANIM_TILESET_COUNT = 0x12
/** `DATA_animation_palette_ptr` (Bank01) has 21 entries; entry 0 is a no-op. */
const ANIM_PALETTE_COUNT = 0x15

/** The wiki recipes (data/bg-setups) that use `value` for `field`: a palette
 *  row names the backdrop variant it was drawn for ("Water (Blue)"), any other
 *  field the backdrops that expect it. */
function recipeNames(field: number, value: number): string[] {
  const names = new Set<string>()
  const add = (setups: BgSetup[], paletteField: number): void => {
    for (const s of setups) {
      const name = s.name.replace(/ \(sprite layer\)$/, '')
      for (const v of s.variants) {
        const hit =
          field === paletteField ? v.palettes.includes(value) : (v.req?.[field] ?? s.req?.[field])?.includes(value)
        if (hit) names.add(field === paletteField && v.name ? `${name} (${v.name})` : name)
      }
    }
  }
  add(BG2_SETUPS, F.bg2Palette)
  add(BG3_SETUPS, F.bg3Palette)
  return [...names]
}

/** Every value 0..count-1 as an option; `name` labels what it can (an empty
 *  label is filled from shipped-level usage by the panel — header-guide). */
function range(count: number, name: (v: number) => string | undefined = () => undefined): EnumOption[] {
  return Array.from({ length: count }, (_, value) => ({ value, label: name(value) ?? '' }))
}

/** Up to two recipe names, for an option label ("; " between them — several
 *  names carry commas of their own, e.g. "Cave, waterfall"). */
function recipeLabel(field: number, value: number): string | undefined {
  const names = recipeNames(field, value)
  if (names.length === 0) return undefined
  return names.length > 2 ? `${names.slice(0, 2).join('; ')} +${names.length - 2}` : names.join('; ')
}

/** Tile-animation handlers too generic for a recipe to describe (the default
 *  cycle, and the no-op) — named by handler alone. */
const GENERIC_ANIM_TILESETS = new Set([0x00, 0x04])

/** A header field shown as a dropdown. Options with an empty label are named
 *  from shipped-level usage at render time; values a list leaves out stay
 *  selectable as a raw fallback. */
function en(
  index: number,
  label: string,
  options: EnumOption[],
  hint: string,
  preview: boolean,
  extra: { swatch?: HeaderSwatch; companion?: number } = {}
): HeaderField {
  return { index, label, field: { kind: 'enum', options }, hint, preview, ...extra }
}

/** One row per header field, `index` matching header.ts. Every field is a
 *  dropdown: curated names where the game or the wiki recipes give them, and
 *  every valid value offered (the bit width, or the dispatch table's length). */
export function headerFields(): HeaderField[] {
  return [
    en(
      F.bgColor,
      'BG color',
      range(0x20, (v) => (v < 0x10 ? 'Solid color' : 'Gradient')),
      'Backdrop color. 0x00–0x0F = a solid color; 0x10+ = a gradient preset.',
      true,
      { swatch: 'backdrop' }
    ),
    en(
      F.bg1Tileset,
      'BG1 tileset',
      BG1_TILESETS,
      'BG1 tile graphics set. Also drives object decode, so changing it can move stamped tiles, not just re-skin them. Pond (0x2) uses unsigned object widths — switching into/out of it can corrupt wide objects.',
      true
    ),
    // isWorld6 is derived from the record id, NOT the header, so editing this field still
    // selects from the correct dark-vs-normal pointer table — no header↔dark-variant interaction bug.
    en(
      F.bg1Palette,
      'BG1 palette',
      range(0x20),
      'BG1 palette row (the dark variant is auto-selected for World 6). Unnamed rows are named after the BG1 tilesets shipped levels pair them with.',
      true,
      { swatch: 'bg1', companion: F.bg1Tileset }
    ),
    en(F.bg2Tileset, 'BG2 tileset', BG2_TILESETS, 'BG2 (parallax) tile graphics set.', true),
    en(
      F.bg2Palette,
      'BG2 palette',
      range(0x40, (v) => recipeLabel(F.bg2Palette, v)),
      'BG2 palette row. Named after the backdrop it was drawn for (community BG2 settings chart), else the BG2 tilesets shipped levels pair it with.',
      true,
      { swatch: 'bg2', companion: F.bg2Tileset }
    ),
    en(F.bg3Tileset, 'BG3 tileset', BG3_TILESETS, 'BG3 (far parallax) tile graphics set.', true),
    en(
      F.bg3Palette,
      'BG3 palette',
      range(0x40, (v) => recipeLabel(F.bg3Palette, v)),
      'BG3 palette row. Named after the backdrop it was drawn for (community BG3 settings chart), else the BG3 tilesets shipped levels pair it with.',
      true,
      { swatch: 'bg3', companion: F.bg3Tileset }
    ),
    en(
      F.spriteTileset,
      'Sprite tileset',
      range(0x80),
      'Sprite (OBJ) graphics set for this level. No set has a name — each is listed with the levels that use it; “Fit sprite tileset” picks one for the placed sprites.',
      true
    ),
    en(F.spritePalette, 'Sprite palette', range(0x10), 'Sprite palette row (OBJ palettes 6–7).', true, { swatch: 'sprite' }),
    en(
      F.levelMode,
      'Level mode',
      LEVEL_MODES,
      'PPU display / scene mode — selects the BG layout, color-math, and IRQ. Names are the game’s own scene-mode table; 0x03 / 0x09 / 0x0A are the special ones (offset-per-tile lava / Mode-7 boss / autoscroll).',
      true
    ),
    en(
      F.animTileset,
      'Animation tileset',
      range(ANIM_TILESET_COUNT, (v) =>
        [ANIM_TILESET_NAMES[v], GENERIC_ANIM_TILESETS.has(v) ? undefined : recipeLabel(F.animTileset, v)]
          .filter(Boolean)
          .join(' · ')
      ),
      'Which tile-animation handler runs: animated BG1 object tiles (water / lava surfaces) and/or the BG3 animation slot. 0x00–0x11 are the game’s 18 handlers; names after “·” are the backdrop recipes that use it.',
      true
    ),
    en(
      F.animPalette,
      'Animation palette',
      range(ANIM_PALETTE_COUNT, (v) => (v === 0 ? 'None' : recipeLabel(F.animPalette, v))),
      'Which palette-cycle animation runs (waterfalls, torches, clouds, lava …). 0x00–0x14 are the game’s 21 handlers; 0x00 does nothing. The Palette panel’s “Palette animations” group shows each one’s frames.',
      true
    ),
    en(
      F.scrollRate,
      'BG scroll rate',
      SCROLL_TYPES,
      'Parallax scroll mode — sets how much slower BG2 / BG3 scroll than BG1 (the H/V divisors). No live preview (parallax is not simulated) — Test Level to verify.',
      false
    ),
    en(
      F.music,
      'Music',
      MUSIC_TRACKS,
      'Background music track. ▶ Play music below hears it in the editor (synthesized); Test Level hears it in-game. Track names are from the game’s own BGM table (they correct several GoldenEgg mislabels).',
      false
    ),
    en(
      F.itemMemory,
      'Item memory',
      range(4, (v) => `Page ${v}`),
      'Which of 4 RAM bitmaps tracks collected items (coins/flowers/red coins, keys, opened doors). Connected sublevels that both hold collectibles should use different pages, or their collected-state collides. No live preview — Test Level to verify.',
      false
    )
  ]
}

/** Where field `index` sits in the packed header: its first bit (MSB-first from
 *  the start of the 10 bytes) and its width — for the field tooltip, so an edit
 *  can be checked against a hex editor. */
export function headerFieldBits(index: number): { start: number; width: number } {
  let start = 0
  for (let i = 0; i < index; i++) start += HEADER_BIT_WIDTHS[i] ?? 0
  return { start, width: HEADER_BIT_WIDTHS[index] ?? 0 }
}

/** The 15 unpacked fields packed back to the on-disc bytes, MSB-first — the
 *  renderer twin of the framework's `serializeHeader` (Node `Buffer`, so not
 *  importable here), for the panel's raw-bytes readout. */
export function packHeader(header: readonly number[]): Uint8Array {
  const totalBits = HEADER_BIT_WIDTHS.reduce((a, w) => a + w, 0)
  const out = new Uint8Array((totalBits + 7) >> 3)
  let bit = 0
  HEADER_BIT_WIDTHS.forEach((width, i) => {
    const value = header[i] ?? 0
    for (let b = width - 1; b >= 0; b--, bit++) {
      if ((value >> b) & 1) out[bit >> 3]! |= 0x80 >> (bit & 7)
    }
  })
  return out
}
