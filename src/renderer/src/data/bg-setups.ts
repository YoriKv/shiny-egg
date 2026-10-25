// Background "recipes" for the BG2 and BG3 tilesets — which palettes each
// backdrop was drawn for and which other header settings it expects — behind the
// Level Header panel's backdrop-preset dropdown (lib/bg-setup turns each variant
// into a preset) and the BG2/BG3 palette + animation option names
// (header-schema `recipeNames`).
//
// Source: the community wiki pages "BG2 Settings for GoldenEgg" and "BG3
// Settings for GoldenEgg" (github.com/ShinyNT/Yoshi-s-Island-Hacking-Useful-
// Information/wiki, after Mattrizzle's chart). Their vocabulary maps onto ours:
// "Header Animation" = animation tileset (header[10]), "Palette Animation" =
// animation palette (header[11]), "BG Scrolling Rate" = header[12], "Back Area
// Color" = BG color (header[0]). Values are hex, as on the wiki.
//
// Cross-checked against every shipped level (tmp/header-guide-probe.ts tallies
// the companions each tileset ships with): the palette lists and every "only
// works in" level mode (and BG2 0x03's BG1) hold for all shipped levels, and
// the variant splits
// (Snowstorm, Mist) follow which palette ships with which mode. Where the wiki
// hedges ("might work in…") the value stays out of `req` and goes in a note.
// Where it disagrees with the shipped levels, the shipped levels win: the
// small/big Clouds' scroll rates (WIP on the wiki, 0x00 in every shipped level)
// are left out, and Castle & Torches lists the shipped 0x00 beside the wiki's
// preferred 0x01.
//
// "Any with BG3: None" animation tilesets aren't enumerable from the wiki, so
// they're not modelled.

import { HEADER_FIELD as F } from './header-fields'

/** Header field index → the values a recipe accepts for it (first = default). */
export type BgReq = Partial<Record<number, number[]>>

/** One way to use a backdrop: its palette(s) and anything that differs per
 *  palette (Snowstorm's three palettes each want their own mode + animation). */
export interface BgVariant {
  palettes: number[]
  /** The wiki's name for this palette choice (a color, or a snowstorm phase). */
  name?: string
  /** BG3 "sprite layer" tilesets: the sprites this palette is for. */
  sprites?: number[]
  req?: BgReq
}

export interface BgSetup {
  tilesets: number[]
  name: string
  variants: BgVariant[]
  /** Companion settings shared by every variant (a variant's `req` overrides). */
  req?: BgReq
  /** Fields that are optional extras — never applied by a preset. */
  optional?: number[]
  notes?: string[]
}

const v = (palettes: number[], name?: string, req?: BgReq): BgVariant => ({ palettes, name, req })

export const BG2_SETUPS: BgSetup[] = [
  { tilesets: [0x00], name: 'Cave, waterfall', variants: [v([0x20, 0x21])], req: { [F.animPalette]: [0x0e, 0x11, 0x13, 0x14] } },
  { tilesets: [0x01], name: 'Woods', variants: [v([0x01, 0x16, 0x17, 0x1c])], notes: ['Palettes 0x16 and 0x17 are identical.'] },
  { tilesets: [0x02], name: 'Pond', variants: [v([0x02])] },
  {
    tilesets: [0x03],
    name: '3D stone & lava',
    variants: [v([0x03])],
    req: { [F.bg1Tileset]: [0x3], [F.bg1Palette]: [0x03] },
    notes: ['The only background that needs a specific BG1 tileset and BG1 palette.']
  },
  {
    tilesets: [0x04],
    name: 'Forest and mountains',
    variants: [v([0x04, 0x11, 0x25, 0x26])],
    notes: ['Palette 0x03 is identical to 0x11.']
  },
  { tilesets: [0x05], name: 'Forest', variants: [v([0x05])] },
  { tilesets: [0x06], name: 'Castle, watercourse and candles', variants: [v([0x06])], req: { [F.animPalette]: [0x03] } },
  { tilesets: [0x07], name: 'Tropical mountains', variants: [v([0x07])] },
  { tilesets: [0x08], name: 'Forest', variants: [v([0x08, 0x24])] },
  {
    tilesets: [0x09, 0x10],
    name: 'Jungle mountains',
    variants: [v([0x09, 0x10, 0x2c, 0x2d])],
    notes: ['Tilesets 0x09 and 0x10 are identical, as are palettes 0x09 and 0x10.']
  },
  { tilesets: [0x0a], name: 'Waterfall', variants: [v([0x0a, 0x30])], req: { [F.animPalette]: [0x04] } },
  { tilesets: [0x0b], name: 'Distant grounds', variants: [v([0x0b, 0x31])], req: { [F.animTileset]: [0x02, 0x0b] } },
  { tilesets: [0x0c], name: 'Boggy woods', variants: [v([0x0c])] },
  {
    tilesets: [0x0d],
    name: 'Night sky',
    variants: [v([0x28])],
    notes: ['Doesn’t mix with tile animations — garbage appears among the stars.']
  },
  { tilesets: [0x0e], name: 'Grass', variants: [v([0x0e, 0x1e, 0x2e])] },
  { tilesets: [0x0f], name: 'Volcanoes', variants: [v([0x0f])], req: { [F.animTileset]: [0x02, 0x0b] } },
  { tilesets: [0x12], name: 'Ocean', variants: [v([0x12, 0x28, 0x29, 0x2a])] },
  {
    tilesets: [0x13],
    name: 'Cave crystals',
    variants: [v([0x13])],
    req: { [F.animPalette]: [0x05, 0x06, 0x10, 0x12] },
    optional: [F.animPalette]
  },
  { tilesets: [0x14], name: 'Castle, webs', variants: [v([0x14, 0x2f])] },
  {
    tilesets: [0x15, 0x1a],
    name: 'Sky, mountains',
    variants: [v([0x15, 0x20])],
    notes: ['Tileset 0x15 has low mountains, 0x1A high ones.']
  },
  { tilesets: [0x18], name: 'Forest, eerie cave', variants: [v([0x18])] },
  { tilesets: [0x19], name: 'Castle, stones', variants: [v([0x00, 0x2b])] },
  { tilesets: [0x1b], name: 'None', variants: [v([0x19])], notes: ['Used by sewer levels with no background.'] },
  { tilesets: [0x1c], name: 'Smiley mountains', variants: [v([0x1a])] },
  { tilesets: [0x1d], name: 'Round mountains', variants: [v([0x1b, 0x22, 0x27])], req: { [F.animTileset]: [0x00, 0x02, 0x0b] } },
  { tilesets: [0x1e], name: 'Forest', variants: [v([0x1d, 0x23])] },
  {
    tilesets: [0x1f],
    name: 'Baby Bowser’s room',
    variants: [v([0x1f])],
    notes: ['The lights-on palette is unknown (probably only triggered by Baby Bowser).']
  }
]

/** BG3 sprite-layer variant: a palette and the sprites drawn with it. */
const sp = (palette: number, sprites: number[], req?: BgReq): BgVariant => ({ palettes: [palette], sprites, req })

export const BG3_SETUPS: BgSetup[] = [
  {
    tilesets: [0x01],
    name: 'Water of pond',
    variants: [v([0x02])],
    req: { [F.animTileset]: [0x01], [F.scrollRate]: [0x01, 0x02, 0x08, 0x0b, 0x0d] },
    notes: ['BG3 must scroll vertically at a constant rate (scroll rates 0x01, 0x02, 0x08, 0x0B, 0x0D).']
  },
  {
    tilesets: [0x02],
    name: 'BG3 objects 1 (sprite layer)',
    variants: [
      sp(0x00, [0x010, 0x03d, 0x090, 0x0a5, 0x0d6, 0x0db, 0x193]),
      sp(0x03, [0x03f]),
      sp(0x04, [0x073]),
      sp(0x0c, [0x036, 0x03d, 0x0a5]),
      sp(0x12, [0x03d]),
      sp(0x30, [0x0db, 0x193])
    ],
    notes: [
      'Graphics for sprites that draw on BG3 — pick the palette for the sprites placed.',
      'Sprite 0x073 (red balloon): use sprite tileset 0x30; it clashes with BG2 tilesets 0x05, 0x0F, 0x16 and 0x1C.'
    ]
  },
  {
    tilesets: [0x04],
    name: 'Animated clouds',
    variants: [v([0x06], 'Blue'), v([0x2e], 'Pink')],
    req: { [F.animTileset]: [0x03, 0x11] },
    notes: ['BG3 scroll rates below 75% look best.']
  },
  {
    tilesets: [0x05],
    name: 'BG3 objects 2 (sprite layer)',
    variants: [sp(0x00, [0x039]), sp(0x05, [0x057], { [F.animTileset]: [0x00] })],
    notes: ['Sprite 0x039 only works in level modes 0x01, 0x05, 0x06, 0x07 and 0x0B.']
  },
  { tilesets: [0x06], name: 'BG3 objects 3 (sprite layer)', variants: [sp(0x00, [0x050, 0x051, 0x05e, 0x05f])] },
  {
    tilesets: [0x0a],
    name: 'Cross section cover',
    variants: [v([0x01], 'Green'), v([0x31], 'Pink')],
    req: { [F.scrollRate]: [0x03] }
  },
  {
    tilesets: [0x0c],
    name: 'Shine',
    variants: [v([0x0c])],
    req: { [F.animPalette]: [0x02, 0x13, 0x14], [F.levelMode]: [0x06] },
    notes: ['Might also work in level mode 0x0F (untested).']
  },
  {
    tilesets: [0x0d],
    name: 'Clouds and mountains',
    variants: [v([0x00], 'Blue'), v([0x23, 0x25], 'Pink')],
    req: { [F.scrollRate]: [0x00, 0x09] }
  },
  { tilesets: [0x0f], name: 'Sky and mountains', variants: [v([0x09])], req: { [F.scrollRate]: [0x10, 0x11] } },
  { tilesets: [0x10], name: 'Sky clouds', variants: [v([0x0a])] },
  { tilesets: [0x11], name: 'Hookbill the Koopa’s fog', variants: [v([0x00])], notes: ['Only usable in Hookbill’s battle.'] },
  { tilesets: [0x12], name: 'Stars and Raven’s moon', variants: [v([0x0b])] },
  {
    tilesets: [0x13],
    name: 'Water',
    variants: [v([0x0f], 'Blue'), v([0x2f], 'Green'), v([0x28], 'Brown'), v([0x29], 'Light blue')],
    req: { [F.animTileset]: [0x05], [F.scrollRate]: [0x03], [F.levelMode]: [0x00, 0x05] },
    notes: [
      'Might also work in level mode 0x01.',
      'Tileset 0x1D is the same water with higher tides, but no scroll setting makes it scroll correctly.'
    ]
  },
  {
    tilesets: [0x14],
    name: 'Jungle',
    variants: [v([0x08])],
    req: { [F.scrollRate]: [0x06] },
    notes: ['The level must not scroll vertically — that glitches, ending with Yoshi killed by invisible lava.']
  },
  {
    tilesets: [0x15],
    name: 'Cave crystals',
    variants: [v([0x0d], 'Normal'), v([0x15], 'Purple'), v([0x16], 'Dark green')],
    req: { [F.animPalette]: [0x05] },
    optional: [F.animPalette],
    notes: [
      'With animation palette 0x05, use a cave BG1 tileset (0x0 or 0x8) and BG2 Cave crystals (0x13): the palettes merge in the animation slot.'
    ]
  },
  { tilesets: [0x16], name: 'Shark Chomp (sprite 0x154)', variants: [sp(0x0e, [0x154])], req: { [F.levelMode]: [0x05] }, notes: ['Might work in level modes 0x01, 0x07 and 0x0B; the game only uses 0x05.'] },
  {
    tilesets: [0x18],
    name: 'Castle & torches',
    variants: [v([0x11], 'Orange'), v([0x26], 'Gray'), v([0x27], 'Dark')],
    req: { [F.animPalette]: [0x09], [F.animTileset]: [0x06, 0x0d, 0x0e], [F.scrollRate]: [0x01, 0x00] },
    notes: ['The wiki prefers scroll rate 0x01; shipped levels use 0x00. With animation tileset 0x0E the clouds and torches animate faster.']
  },
  {
    tilesets: [0x19],
    name: 'Snowstorm',
    variants: [
      v([0x00], 'Constant', { [F.levelMode]: [0x0f] }),
      v([0x0a], 'Outgoing', { [F.animPalette]: [0x0c], [F.levelMode]: [0x0f] }),
      v([0x14], 'Incoming', { [F.animPalette]: [0x0b], [F.levelMode]: [0x08], [F.scrollRate]: [0x00, 0x03] })
    ],
    req: { [F.animTileset]: [0x09], [F.scrollRate]: [0x00] },
    notes: ['The incoming storm might also work in level mode 0x0F.']
  },
  {
    tilesets: [0x1a],
    name: 'Goonies',
    variants: [v([0x12])],
    req: { [F.animTileset]: [0x0a], [F.scrollRate]: [0x07], [F.levelMode]: [0x07, 0x0b] },
  },
  {
    tilesets: [0x1b],
    name: 'Flower garden',
    variants: [v([0x13])],
    req: { [F.animTileset]: [0x0b], [F.scrollRate]: [0x06] },
    notes: ['The butterflies take their colors from the BG1 palette.']
  },
  {
    tilesets: [0x1c],
    name: 'Spotlight',
    variants: [v([0x01, 0x33, 0x34, 0x35])],
    req: { [F.scrollRate]: [0x0d, 0x0f, 0x14], [F.levelMode]: [0x0e], [F.bgColor]: [0x00] },
    notes: ['How dark it gets depends on the BG1 and BG2 in use. Palettes 0x01 and 0x35 differ slightly.']
  },
  {
    tilesets: [0x1f],
    name: 'Kamek’s magic shower',
    variants: [v([0x0b])],
    req: { [F.scrollRate]: [0x04] },
    notes: ['Boss battles only (Prince Froggy, Naval Piranha, Raphael’s first room, Tap-Tap).']
  },
  {
    tilesets: [0x20],
    name: 'Bushes and palms',
    variants: [v([0x19])],
    req: { [F.animTileset]: [0x0f], [F.scrollRate]: [0x01], [F.levelMode]: [0x05], [F.bg2Tileset]: [0x1c] },
    notes: ['Made to go with BG2 Smiley mountains (0x1C).']
  },
  {
    tilesets: [0x21],
    name: 'Prince Froggy’s throat',
    variants: [v([0x1a])],
    req: { [F.scrollRate]: [0x0f], [F.levelMode]: [0x0d] },
    notes: ['Only usable in Prince Froggy’s battle — the only place level mode 0x0D works.']
  },
  {
    tilesets: [0x22],
    name: 'Clouds and mist',
    variants: [v([0x1b])],
    req: { [F.scrollRate]: [0x01], [F.bg2Tileset]: [0x0a] },
    notes: ['Made to go with BG2 Waterfall (0x0A).']
  },
  {
    tilesets: [0x23],
    name: 'Sun',
    variants: [v([0x1c], 'Sunset'), v([0x1d], 'Day')],
    req: { [F.animPalette]: [0x0d], [F.scrollRate]: [0x00, 0x05] }
  },
  {
    tilesets: [0x24],
    name: 'Oil-painted stars and moon',
    variants: [v([0x1e])],
    req: { [F.scrollRate]: [0x00], [F.levelMode]: [0x00] },
    notes: [
      'Works best in level mode 0x00 (might work in 0x0B); modes 0x05 and 0x06 work but hide BG2.',
      'Doesn’t work with the level-intro cutscene.'
    ]
  },
  {
    tilesets: [0x25],
    name: 'Boss’s room',
    variants: [v([0x1f])],
    req: { [F.animPalette]: [0x0f], [F.scrollRate]: [0x0c, 0x0e] }
  },
  {
    tilesets: [0x26],
    name: 'Pop',
    variants: [v([0x0b])],
    req: { [F.animTileset]: [0x04], [F.scrollRate]: [0x0e, 0x0f] },
    notes: ['The “pop!” effects of the Bigger Boo and Marching Milde battles — only works there.']
  },
  {
    tilesets: [0x27],
    name: 'Forest',
    variants: [v([0x07], 'Green'), v([0x24], 'Autumn')],
    req: { [F.scrollRate]: [0x09], [F.levelMode]: [0x00, 0x0b] },
  },
  {
    tilesets: [0x28],
    name: 'White stars',
    variants: [v([0x0b])],
    req: { [F.scrollRate]: [0x00], [F.levelMode]: [0x00, 0x07, 0x0b] },
  },
  {
    tilesets: [0x29, 0x2b],
    name: 'Clouds',
    variants: [v([0x21], 'Pink'), v([0x22], 'Blue')],
    notes: ['Tileset 0x29 has smaller clouds, 0x2B bigger ones. They behave differently per level mode (still being worked out).']
  },
  {
    tilesets: [0x2a],
    name: 'Giant moon',
    variants: [v([0x18])],
    req: { [F.scrollRate]: [0x00, 0x0a], [F.animTileset]: [0x0f] },
    optional: [F.animTileset],
    notes: ['If the camera can scroll above the moon, set animation tileset 0x0F, or glitched graphics show.']
  },
  {
    tilesets: [0x2c],
    name: 'Mist',
    variants: [v([0x2b])],
    req: { [F.scrollRate]: [0x03, 0x12], [F.levelMode]: [0x06, 0x0f] },
  },
  {
    tilesets: [0x2d],
    name: 'Mist',
    variants: [
      v([0x2b], undefined, { [F.scrollRate]: [0x00, 0x06], [F.levelMode]: [0x0f] }),
      v([0x2c], undefined, { [F.animPalette]: [0x11, 0x12], [F.scrollRate]: [0x00], [F.levelMode]: [0x08] }),
      v([0x2d], undefined, { [F.scrollRate]: [0x00, 0x03, 0x06], [F.levelMode]: [0x0f] })
    ],
  },
  {
    tilesets: [0x2e],
    name: 'Clouds in front of BG2',
    variants: [v([0x21], 'Pink'), v([0x22], 'Blue')],
    req: { [F.scrollRate]: [0x13], [F.levelMode]: [0x07] },
    notes: ['Draws in front of BG2 (some Cloud World levels).']
  }
]
