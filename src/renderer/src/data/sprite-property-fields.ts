// Bit-field schema for the per-ID normal-sprite property tables (Bank0A
// DATA_0A9320 … DATA_0AAB14). Legends and consumers come from the asm table
// headers in yi/SuperFX/Banks/Bank0A.asm and snes-framework/docs/
// spritestateengine.md §4.2 — keep the wording in sync with those when editing.
//
// Field kinds: `flag` (one bit), `enum` (a multi-bit choice), `number` (a
// multi-bit value, optionally signed), `hitbox` (collision bits 0-4 — an index
// into the 32 hitbox shapes). Pure data + get/set helpers; no React.

import type { SpritePropertyTableKey } from '../../../preload/api'

export interface SpritePropertyField {
  id: string
  table: SpritePropertyTableKey
  label: string
  /** Lowest bit of the field. */
  shift: number
  /** Width in bits. */
  bits: number
  kind: 'flag' | 'enum' | 'number' | 'hitbox'
  options?: Array<{ value: number; label: string }>
  /** Two's-complement display for `number` fields. */
  signed?: boolean
  tooltip: string
  advanced?: boolean
  /** No reader was found in the engine — editing it likely does nothing. */
  unverified?: boolean
}

export interface SpritePropertyTableInfo {
  key: SpritePropertyTableKey
  title: string
  label: string
  summary: string
  advanced?: boolean
}

export const SPRITE_PROPERTY_TABLE_INFO: readonly SpritePropertyTableInfo[] = [
  { key: 'collision', title: 'Contact with Yoshi and sprites', label: 'DATA_0A9320', summary: 'What happens when Yoshi or other sprites touch this sprite.' },
  { key: 'terrain', title: 'Terrain & sprite behaviour', label: 'DATA_0A971E', summary: 'How the sprite reacts to terrain and how the game treats it.' },
  { key: 'render', title: 'Sprite reactions', label: 'DATA_0A9B1C', summary: 'What happens when the sprite goes off-screen or meets fire, ice, or bubbles.' },
  { key: 'priorityAttr', title: 'Appearance', label: 'DATA_0A9F1A', summary: 'Colours, layering, and flipping.' },
  { key: 'gravity', title: 'Gravity', label: 'DATA_0AA318', summary: 'How quickly the sprite speeds up as it falls or rises.' },
  { key: 'gfxFile', title: 'Graphics file', label: 'DATA_0AA716', summary: 'The graphics file this sprite needs in the level’s sprite set.', advanced: true },
  { key: 'spitGraphic', title: 'Spit-out graphic', label: 'DATA_0AAB14', summary: 'The spinning image shown when Yoshi spits out the sprite.', advanced: true }
]

const f = (
  table: SpritePropertyTableKey,
  id: string,
  label: string,
  shift: number,
  bits: number,
  kind: SpritePropertyField['kind'],
  tooltip: string,
  extra: Partial<SpritePropertyField> = {}
): SpritePropertyField => ({ id, table, label, shift, bits, kind, tooltip, ...extra })

const opts = (...labels: string[]): Array<{ value: number; label: string }> =>
  labels.map((label, value) => ({ value, label }))

type TerrainPoint = readonly [x: number, y: number]
const standardPoints = [[8, 5], [2, 5], [13, 5], [8, 1], [8, 16]] as const
const widePoints = [[8, 8], [-4, 8], [20, 8], [8, -4], [8, 20]] as const
const centerPoint = [[8, 8]] as const
const standard = 'Checks terrain and adjusts the sprite’s position on contact.'
const reportsContact = 'Reports contact so the sprite can decide how to react.'
const recordsTiles = 'Saves details about the tiles it touches for the sprite’s own behaviour.'

// USA v1.0 DATA_0ACECB selects both a routine (DATA_0AD051) and signed pixel
// offsets (DATA_0ACF09). See spritestateengine.md §4.2 for the runtime origin.
export const SPRITE_TERRAIN_PRESETS: ReadonlyArray<{
  label: string
  description: string
  points: readonly TerrainPoint[]
}> = [
  { label: 'No terrain checks', description: 'Skips the game’s standard terrain checks. The sprite can still have terrain behaviour of its own.', points: [] },
  { label: 'Standard (Shy Guy)', description: standard, points: standardPoints },
  { label: 'Small (Bird)', description: standard, points: [[8, 8], [5, 8], [10, 8], [8, 5], [8, 11]] },
  { label: 'Wide (Poochy, crates)', description: standard, points: widePoints },
  { label: 'Wide with tile details (Lava Log)', description: recordsTiles, points: [[8, 10], [-8, 10], [24, 10], [8, 0], [8, 16]] },
  { label: 'Tall (Dr. Freezegood)', description: standard, points: [[8, 8], [0, 8], [15, 8], [8, -4], [8, 21]] },
  { label: 'Standard sensing with tile details (Icicle)', description: recordsTiles, points: standardPoints },
  { label: 'Wide with two feet (Boo Blah)', description: standard, points: [[8, 5], [-6, 5], [21, 5], [-5, 0], [20, 0], [-5, 16], [20, 16]] },
  { label: 'Tall and wide (Doors)', description: standard, points: [[16, 16], [2, 16], [30, 16], [8, 2], [8, 32]] },
  { label: 'Wide, raised sides (Georgette Jelly)', description: standard, points: [[8, 8], [-8, 0], [24, 0], [-7, 0], [23, 0], [-7, 16], [23, 16]] },
  { label: 'Wide corner sensing (Mini Raven, Hootie)', description: reportsContact, points: [[-2, -2], [17, 17], [-2, 17], [17, -2]] },
  { label: 'Corner sensing (Piro Dangle)', description: reportsContact, points: [[0, 0], [15, 15], [0, 15], [15, 0]] },
  { label: 'Two-foot sensing (Expanding Block)', description: reportsContact, points: [[-2, 16], [18, 16]] },
  { label: 'Standard sensing', description: reportsContact, points: standardPoints },
  { label: 'Wide with side tile details (Chomp Rock)', description: 'Saves tile details at the centre and sides, with separate ceiling and floor checks.', points: [[8, 8], [-6, 8], [22, 8], [8, -6], [8, 22]] },
  { label: 'Baby Mario', description: 'Uses Baby Mario’s special terrain checks with standard point positions.', points: standardPoints },
  { label: 'Raised with side tile details', description: 'Saves tile details at the centre and sides, with separate ceiling and floor checks.', points: [[8, 8], [-4, -4], [20, -4], [8, -6], [8, 22]] },
  { label: 'Size-based sides (Snowball)', description: 'The side checks move as the snowball grows. The dot shows its fixed floor check.', points: [[8, -6]] },
  { label: 'Wide sensing (Fishin’ Lakitu)', description: reportsContact, points: widePoints },
  { label: 'Narrow with two feet (Sluggies)', description: standard, points: [[8, 8], [2, 8], [14, 8], [4, 0], [12, 0], [4, 16], [12, 16]] },
  { label: 'Five points with coin checks (Egg)', description: 'Uses the terrain routine for eggs that also checks for coins.', points: [[8, 8], [0, 8], [16, 8], [8, 0], [8, 16]] },
  { label: 'Tall with two feet (Slugger, Green Glove)', description: standard, points: [[8, 4], [0, 4], [16, 4], [0, -6], [16, -6], [1, 16], [15, 16]] },
  { label: 'Tall and narrow (Koopa)', description: standard, points: [[8, 8], [2, 8], [13, 8], [8, -6], [8, 24]] },
  { label: 'Large (Giant Shy Guy)', description: standard, points: [[8, 8], [-3, 6], [19, 6], [8, -7], [8, 22]] },
  { label: 'Standard with tile details (Koopa shell)', description: recordsTiles, points: standardPoints },
  { label: 'Slightly tall (Snifit, Kamek)', description: standard, points: [[8, 8], [0, 8], [16, 8], [8, -3], [8, 19]] },
  { label: 'Wide, raised centre (Giant Egg)', description: standard, points: [[8, 4], [-4, 4], [20, 4], [8, -8], [8, 16]] },
  { label: 'Square sensing with tile details (Platforms, Bomb)', description: recordsTiles, points: [[8, 8], [0, 8], [15, 8], [8, 0], [8, 15]] },
  { label: 'Centre only (Eggs, Torpedo)', description: 'Reports terrain contact at one point in the middle.', points: centerPoint },
  { label: 'Centre with coin checks (Watermelon Seed)', description: 'Checks the centre for terrain and coins.', points: centerPoint },
  { label: 'Centre with tile details (Flame, Ski Lift)', description: recordsTiles, points: centerPoint },
  { label: 'Extra large (Large Milde)', description: standard, points: [[8, 8], [-20, 4], [36, 4], [8, -24], [8, 32]] }
]

export const SPRITE_PROPERTY_FIELDS: readonly SpritePropertyField[] = [
  // ── DATA_0A9320 collision / contact ──
  f('collision', 'hitbox', 'Hitbox shape', 0, 5, 'hitbox', 'The area used to detect contact with Yoshi and other sprites. Some sprites resize it during play.'),
  f('collision', 'projImmune', 'Resists thrown attacks', 5, 1, 'flag', 'Thrown eggs, thrown sprites, and Fuzzy puffs can’t defeat it.'),
  f('collision', 'notTongue', 'Tongue passes through', 6, 1, 'flag', 'Yoshi’s tongue goes straight through the sprite.'),
  f('collision', 'inedible', 'Tongue bounces off', 7, 1, 'flag', 'Yoshi’s tongue hits the sprite and bounces back.'),
  f('collision', 'freedOnDeath', 'Disappears when Yoshi dies', 8, 1, 'flag', 'Used by some ghosts and bosses that appear on a background layer.'),
  f('collision', 'sprTarget', 'Other sprites can detect it', 9, 1, 'flag', 'Lets other sprites include it when checking for collisions.'),
  f('collision', 'sprChecker', 'Checks for other sprites', 10, 1, 'flag', 'Checks for collisions with other sprites when it isn’t touching Yoshi.'),
  f('collision', 'stomp', 'When Yoshi lands on it', 11, 3, 'enum', 'What happens when Yoshi lands on top of the sprite.', {
    options: opts('Jump defeats it, otherwise hurts Yoshi', 'Sprite’s own stomp reaction', 'Stomp reaction 2 (unused)', 'Stomp reaction 3 (unused)', 'Vanishes in a pop', 'Hurts Yoshi', 'Yoshi can stand on it', 'Defeated by the stomp')
  }),
  f('collision', 'side', 'Side contact', 14, 2, 'enum', 'What happens when Yoshi touches the sprite from the side.', {
    options: opts('Solid push', 'Hurts Yoshi', 'Knocked away', 'No contact')
  }),
  // ── DATA_0A971E terrain / class ──
  f('terrain', 'terrainSet', 'Terrain collision preset', 0, 5, 'enum', 'Chooses where and how the sprite checks for level tiles.', {
    options: SPRITE_TERRAIN_PRESETS.map(({ label }, value) => ({ value, label }))
  }),
  f('terrain', 'keepYSpeed', 'Keep vertical speed on landing', 5, 1, 'flag', 'Keeps the sprite’s current vertical speed when it lands or catches a ledge.'),
  f('terrain', 'wallTurn', 'Turn at walls', 6, 1, 'flag', 'Turns the sprite around when it hits a wall.'),
  f('terrain', 'wallStop', 'Stop at walls', 7, 1, 'flag', 'Stops sideways movement at a wall. Takes priority over turning.'),
  f('terrain', 'ledgeTurn', 'Turn at ledges', 8, 1, 'flag', 'Turns the sprite around and moves it back onto the ledge.'),
  f('terrain', 'ledgeStop', 'Stop at ledges', 9, 1, 'flag', 'Stops the sprite at the ledge. Takes priority over turning.'),
  f('terrain', 'turnZero', 'Stop moving when turning', 10, 1, 'flag', 'The sprite turns to face the other way and comes to a stop.'),
  f('terrain', 'knockable', 'Knocked out by sprites', 11, 1, 'flag', "Other sprites' attacks can knock it out (Muddy Buddy, blasts, Chomp Rock …)."),
  f('terrain', 'noSwallow', 'Cannot be swallowed', 12, 1, 'flag', 'Held in the mouth until spat out.'),
  f('terrain', 'class', 'Sprite type', 13, 2, 'enum', 'Controls whether the game treats this sprite as an enemy or an item.', {
    options: opts('Enemy', 'Not an enemy', 'Not an enemy, contact-kill immune', 'Item / collectible')
  }),
  f('terrain', 'noEgg', 'No egg when swallowed', 15, 1, 'flag', 'Yoshi consumes it as his tongue retracts, like a coin or Health Star.'),
  // ── DATA_0A9B1C behaviour / render control ──
  f('render', 'drawMethod', 'Draw method', 0, 2, 'enum', 'GSU OAM dispatch (DATA_098AD8).', {
    options: opts('Single OAM record', 'Multi-record cel walker', 'Handler writes its own records', 'Walker + 32 records'),
    advanced: true
  }),
  f('render', 'despawn', 'Disappears off-screen', 2, 2, 'enum', 'How far past the screen edge the sprite can go before it disappears. It can reappear when you return.', {
    options: opts('Stays active', '96 px sideways / 96 px vertically', '144 px sideways / 96 px vertically', '144 px sideways / 160 px vertically')
  }),
  f('render', 'burnable', 'Can be burned', 4, 1, 'flag', 'Fire from a watermelon defeats it.'),
  f('render', 'bubble', 'Launched by air bubble', 5, 1, 'flag', 'The air Bubble pops on contact and launches it.'),
  f('render', 'freezable', 'Can be frozen', 6, 1, 'flag', 'The icy-melon chill freezes it.'),
  f('render', 'instantSwallow', 'Swallowed instantly', 7, 1, 'flag', 'Yoshi swallows it as soon as he catches it with his tongue.'),
  f('render', 'eggAim', 'Egg-aim target (unused)', 8, 1, 'flag', 'Only read by an egg-aim routine the original game never calls.', { unverified: true, advanced: true }),
  f('render', 'reward', 'Defeat reward (unused)', 9, 2, 'number', 'No active game code is known to read this setting.', { unverified: true, advanced: true }),
  f('render', 'oamCount', 'OAM record count', 11, 5, 'number', 'Number of hardware sprite pieces drawn by the multi-record routine per frame (0–31).', { advanced: true }),
  // ── DATA_0A9F1A priority / OAM attribute ──
  f('priorityAttr', 'layer', 'Draw layer', 0, 8, 'number', 'Lower values draw farther forward. $FF hides the sprite. Yoshi draws at $1A.', { advanced: true }),
  f('priorityAttr', 'tileHi', 'Tile bit 8 (N)', 8, 1, 'flag', 'OAM name-table select. Never set in the base game.', { advanced: true }),
  f('priorityAttr', 'palette', 'Colour palette row', 9, 3, 'number', 'Chooses one of the level’s eight sprite colour palettes.'),
  f('priorityAttr', 'objPriority', 'OBJ priority', 12, 2, 'enum', 'OAM priority vs the BG layers. Stored with the high bit inverted (the spawn applies EOR #$20).', {
    advanced: true,
    options: [
      { value: 0, label: 'Priority 2 (default)' },
      { value: 1, label: 'Priority 3 (in front)' },
      { value: 2, label: 'Priority 0 (behind BG)' },
      { value: 3, label: 'Priority 1' }
    ]
  }),
  f('priorityAttr', 'xflip', 'Flip left to right', 14, 1, 'flag', 'Mirrors the artwork relative to the direction the sprite faces.'),
  f('priorityAttr', 'yflip', 'Flip upside down', 15, 1, 'flag', 'Turns the artwork upside down.'),
  // ── DATA_0AA318 gravity ──
  f('gravity', 'accel', 'Vertical acceleration', 0, 8, 'number', 'How quickly the sprite approaches its target speed. Zero keeps its current speed unless the sprite changes it.', { signed: true }),
  f('gravity', 'target', 'Target vertical speed', 8, 8, 'number', 'Positive values make the sprite fall. Negative values make it rise. The game multiplies this value by 16.', { signed: true }),
  // ── DATA_0AA716 gfx file ──
  f('gfxFile', 'gfxFile', 'GFX file id', 0, 8, 'number', "Searched in the level's six spriteset slots to set the OBJ tile base. 0 = common sprite page."),
  f('gfxFile', 'gfxHi', 'High byte', 8, 8, 'number', 'Unused by the lookup in the base game.'),
  // ── DATA_0AAB14 spit graphic ──
  f('spitGraphic', 'spitBig', '32×32 bitmap', 15, 1, 'flag', 'Spin bitmap size: 32×32 instead of 16×16.'),
  f('spitGraphic', 'spitCode', 'Texel code', 0, 15, 'number', 'Packed texel address in the chunky sprite bitmap ($54:xxxx). 0 with bit 15 clear = no spin graphic.')
]

export function fieldsForTable(table: SpritePropertyTableKey): SpritePropertyField[] {
  return SPRITE_PROPERTY_FIELDS.filter((x) => x.table === table)
}

const mask = (field: SpritePropertyField): number => ((1 << field.bits) - 1) << field.shift

export function getFieldValue(word: number, field: SpritePropertyField): number {
  const raw = (word & mask(field)) >>> field.shift
  if (field.signed && raw & (1 << (field.bits - 1))) return raw - (1 << field.bits)
  return raw
}

/** Write `value` (signed allowed for signed fields) into `word`; out-of-range
 *  values are clamped to the field width. */
export function setFieldValue(word: number, field: SpritePropertyField, value: number): number {
  const max = (1 << field.bits) - 1
  let raw = Math.trunc(value)
  if (field.signed && raw < 0) raw += 1 << field.bits
  raw = Math.max(0, Math.min(max, raw))
  return ((word & ~mask(field)) | (raw << field.shift)) & 0xffff
}

/** Normal sprites only: special ($1BA+) sprites have no property-table rows. */
export const SPRITE_PROPERTY_MAX_ID = 0x1b9
export const hasSpriteProperties = (num: number): boolean => num >= 0 && num <= SPRITE_PROPERTY_MAX_ID
