// Collision summary for the selected object — feeds the Properties panel's
// Collision block. Data source: the provenance decode (`render:objectInfluence`)
// — the object's EXACT stamped cells (footprint / neighbor classes), each
// carrying the Map16 id it stamped — joined against the cart's per-page
// `bg_type_table` (`render:collisionTable`). This replaces the old bbox scan
// over the final composited grid, which attributed overlapping objects' tiles
// to the selected one and missed stamps outside the bbox. Buried cells
// (overdrawn by a later object — their `mid` is the OVERWRITER's tile) are
// counted separately, never classified as this object's collision.
//
// The chip classification mirrors the collision overlay's visual language
// (snes-framework/scripts/engine/render-collision.ts): the FILL class answers
// "can Yoshi pass?" (solid red / semi-solid orange / exit green / collectible
// yellow / tunnel blue / pass-through), the OUTLINE group answers "what does it
// DO?"
// (pipe-mouth, door, bonus-door, falling-floor, switch-block, damage,
// water-lava). The panel's chip CSS carries the same colors.

import { PIPE_ENTRY_DIRECTION_MASK, SECONDARY_TAG_NAMES } from 'snes-framework/collision'
import type { SecondaryTag } from 'snes-framework/collision'
import type {
  CollisionEntry,
  CollisionTableResult,
  DecodedObjectInfluence
} from '../../../preload/api'
import { hex } from '../lib/hex'

// ── Secondary-tag tooltip copy ────────────────────────────────────────────
// Hover descriptions for the 5-bit secondary tags (the per-page behaviour
// class — see snes-framework/docs/mchip.md §3.3.2 for the encoding and
// §3.8 for the surface-material tables). Behaviour is traced to its
// runtime consumer, not guessed from the name: the GSU player-collision
// code dispatches on this tag through three jump tables (side /
// head-from-below / foot) whose entry order matches SECONDARY_TAG_NAMES
// index-for-index. All 28 named tags (0x00–0x1B) are described; the 4
// reserved slots (0x1C–0x1F) and `none` carry no behaviour.

export const SECONDARY_TAG_DESCRIPTIONS: Partial<Record<SecondaryTag, string>> = {
  'snow-grass-floor':
    'Snow / grass top surface — the default top-surface footing; on snow courses it sets Yoshi\'s snow-walking state (footprints / footstep feedback).',
  soap:
    'Slippery "soap" surface — sets Yoshi\'s slippery-footing (soap-walking) state, reducing traction.',
  mud:
    'Mud surface — sets the mud-walking footing state and kicks up a mud splash effect on landing.',
  coin:
    'Coin embedded in the level grid — collected on contact.',
  'edible-bg':
    'Tongue-eatable BG tile — Yoshi can eat it out of the level.',
  rail:
    'Track / rail tile — line-guided sprites (platforms etc.) attach to and follow it, and the player\'s train form rides it (stepping onto a rail in train form switches Yoshi into rail-riding mode). The editor\'s sprite neighbour-dependency checks scan columns for this tag.',
  damage:
    'Hurts the player on side / overhead contact (standing on top is safe).',
  stake:
    'Ground-poundable stake / post — ground-pounding it drives the stake down (rewrites its BG). Not damaging; the spiked, hurts-on-contact stake is the separate damage-slope-stake tag.',
  'stairs-left':
    'Stairs descending to the left.',
  'stairs-right':
    'Stairs descending to the right.',
  'falling-floor':
    'Drops when stepped on.',
  'switch-block':
    'Dashed block — solid only while the ! switch is on.',
  'pipe-mouth':
    'Pipe-mouth tile (page 0x7D). Two consumers: (1) player pipe entry — enterable when the tile\'s per-tile entry byte carries the pressed direction\'s bit, a tile-driven screen exit with no sprite involved; (2) enemy initializers standing on it become proximity-triggered pipe generators.',
  'switch-coin':
    'Dashed coin — collectible only while the ! switch is on.',
  'ice-block':
    'Ice block — surface-material marker (slippery physics); also the snap anchor for the 19 "ice-block snap" sprites.',
  'damage-slope-stake':
    'Hurts the player on contact (slope-stake variant).',
  'damage-icicle':
    'Hurts the player on contact (icicle variant).',
  knockdown:
    'Knocks the player down on contact.',
  'dented-floor':
    'Soft floor that visibly dents where Yoshi steps — the foot-collision spawns a depression effect and the GSU rewrites a 48×16-px dent into the BG. Cosmetic deformation; passability is unchanged.',
  lava:
    'Lava surface — touching it (while not invulnerable) drops Yoshi into the lava-sink death state. The molten body itself is the byte-0 MG flag; this tag marks the contact surface.',
  'question-block':
    '? block — solid, and when bonked from below it releases its contents (spawns the block\'s entity, then rewrites itself to the emptied tile).',
  'mario-block':
    'Mario block — while the Mario-block ! switch is on, bonking it from below spawns the block\'s entity. Inert while the switch is off.',
  'tube-block':
    'Tube platform block — an ordinary solid platform to player collision. Its sink-under-weight motion is driven by the associated tube-platform sprite, not by this tag.',
  'countdown-block':
    'Countdown-lift block — ordinary collision; its timed appear/vanish behaviour is driven by the countdown-lift sprite. The tag just marks the tiles.',
  'waterfall-floor':
    'Waterfall base — standing in it emits periodic splash effects + a splash sound and applies a flow velocity that pushes the player.',
  'cedar-tree':
    'Cedar / pine foliage — a non-solid pass-through tile; moving through it rustles (plays a sound + sets a timer). Thrown eggs that hit it get a special bounce effect.',
  'wobbly-rock':
    'Wobbly rock platform — solid to stand on, but tilts / shakes under Yoshi (and Baby Mario); the wobble is run by the rock\'s own GSU handler, separate from this collision tag.'
}

/** Tooltip text for a raw 5-bit tag index, or undefined when the tag is
 *  `none` / unnamed / not yet described. */
export function secondaryTagTooltip(tag: number): string | undefined {
  const name = SECONDARY_TAG_NAMES[tag]
  return name ? SECONDARY_TAG_DESCRIPTIONS[name] : undefined
}

// ── Shared cart-table fetch ───────────────────────────────────────────────
// The collision table + pipe-entry bits are static per cart (~5 KB), so fetch
// once and share the promise across every consumer (Properties panel,
// neighbour-dep resolver) instead of each keeping its own cache.

let dataCache: CollisionTableResult | null = null
let dataFetching: Promise<CollisionTableResult> | null = null

export function getCollisionTableData(): Promise<CollisionTableResult> {
  if (dataCache) return Promise.resolve(dataCache)
  dataFetching ??= window.shinyEgg.render.collisionTable().then((d) => {
    dataCache = d
    return d
  })
  return dataFetching
}

/** Just the per-page `bg_type_table` — for consumers that don't need the
 *  pipe-entry bits (the neighbour-dep resolver's page→tag lookup). */
export function getCollisionTable(): Promise<CollisionEntry[]> {
  return getCollisionTableData().then((d) => d.table)
}

// ── Classification (mirrors render-collision.ts) ──────────────────────────

const PIPE_MOUTH_TAG = SECONDARY_TAG_NAMES.indexOf('pipe-mouth')
const COIN_TAG = SECONDARY_TAG_NAMES.indexOf('coin')
const SWITCH_COIN_TAG = SECONDARY_TAG_NAMES.indexOf('switch-coin')
const FALLING_FLOOR_TAG = SECONDARY_TAG_NAMES.indexOf('falling-floor')
const SWITCH_BLOCK_TAG = SECONDARY_TAG_NAMES.indexOf('switch-block')
const DAMAGE_TAGS = new Set([
  SECONDARY_TAG_NAMES.indexOf('damage'),
  SECONDARY_TAG_NAMES.indexOf('damage-slope-stake'),
  SECONDARY_TAG_NAMES.indexOf('damage-icicle')
])

/** Overlay fill class — same partition as the collision layer's fill colors. */
export type CollisionFillClass = 'solid' | 'semisolid' | 'exit' | 'collect' | 'tunnel' | 'none'

/** Behavioural-subclass group — same partition as the collision layer's
 *  dotted-outline colors. */
export type CollisionOutlineGroup =
  | 'pipe-mouth' | 'door' | 'bonus-door' | 'falling-floor'
  | 'switch-block' | 'damage' | 'water-lava'

function tagName(tag: number): string | null {
  if (tag <= 0) return null
  return SECONDARY_TAG_NAMES[tag] ?? `tag 0x${hex(tag)}`
}

/** Dotted-outline group for an entry, or null — same priority order as the
 *  overlay's `tagOutlineColor`. */
function outlineGroup(entry: CollisionEntry): CollisionOutlineGroup | null {
  if (entry.tag === PIPE_MOUTH_TAG) return 'pipe-mouth'
  if (entry.doors.bd) return 'bonus-door'
  if (entry.doors.dr) return 'door'
  if (entry.tag === FALLING_FLOOR_TAG) return 'falling-floor'
  if (entry.tag === SWITCH_BLOCK_TAG) return 'switch-block'
  if (DAMAGE_TAGS.has(entry.tag)) return 'damage'
  if (entry.flags.wt || entry.flags.mg) return 'water-lava'
  return null
}

/** Chip label + fill class for an entry — same priority as the overlay's
 *  fills (exit green > collectible yellow > solid red family > tunnel blue >
 *  pass-through). The secondary-tag name rides along on the label when it
 *  isn't already what the label says. */
function fillBehavior(entry: CollisionEntry): { label: string; fill: CollisionFillClass } {
  const tag = tagName(entry.tag)
  const withTag = (label: string): string => (tag ? `${label} · ${tag}` : label)
  if (entry.doors.dr || entry.doors.bd) {
    return { label: withTag(entry.doors.bd ? 'Bonus door' : 'Door'), fill: 'exit' }
  }
  if (entry.tag === COIN_TAG) return { label: 'Coin', fill: 'collect' }
  if (entry.tag === SWITCH_COIN_TAG) return { label: 'Switch coin', fill: 'collect' }
  if (entry.flags.al) return { label: withTag('Solid'), fill: 'solid' }
  if (entry.flags.md) return { label: withTag('Semi-solid'), fill: 'semisolid' }
  if (entry.flags.sk) return { label: withTag('Slope'), fill: 'solid' }
  if (entry.flags.wt) return { label: withTag('Water'), fill: 'solid' }
  if (entry.flags.mg) return { label: withTag('Lava'), fill: 'solid' }
  if (entry.flags.tn) return { label: withTag('Tunnel'), fill: 'tunnel' }
  return { label: tag ?? 'Pass-through', fill: 'none' }
}

/** Full per-page description for the drill-down rows — every shape flag
 *  spelled out, plus the tag / door extras. */
function describeEntry(entry: CollisionEntry): string {
  const shapes: string[] = []
  if (entry.flags.al) shapes.push('Solid')
  if (entry.flags.md) shapes.push('Semi-solid')
  if (entry.flags.sk) {
    // The static bg_type_table only ever carries slopeIdx 0x00-0x1F; the >= 0x20
    // ("runtime profile" — RAM-supplied moving/boss slopes) arm is defensive,
    // unreachable from shipped cart data. See snes-framework/docs/mchip.md byte 2.
    shapes.push(entry.slopeIdx >= 0x20 ? 'Slope (runtime profile)' : `Slope 0x${hex(entry.slopeIdx)}`)
  }
  if (entry.flags.wt) shapes.push('Water')
  if (entry.flags.mg) shapes.push('Lava')
  if (entry.flags.tn) shapes.push('Tunnel')
  const shape = shapes.length > 0 ? shapes.join(' + ') : 'Pass-through'

  const extras: string[] = []
  const tag = tagName(entry.tag)
  if (tag) extras.push(tag)
  if (entry.doors.dr) extras.push('door')
  if (entry.doors.bd) extras.push('bonus door')
  return extras.length > 0 ? `${shape} — ${extras.join(', ')}` : shape
}

// ── Summary ───────────────────────────────────────────────────────────────

/** One behaviour chip: all of the object's visible cells whose page shares
 *  this (label, fill, outline) classification, with a count. */
export interface CollisionChip {
  key: string
  label: string
  fill: CollisionFillClass
  outline: CollisionOutlineGroup | null
  count: number
  /** Hover explanation of the page's secondary tag, when one is described. */
  tooltip?: string
}

export interface ObjectCollisionSummary {
  /** Behaviour chips over the object's own visible cells, largest first. */
  chips: CollisionChip[]
  /** Per-page drill-down rows, largest first. A pipe-mouth page can split
   *  into two rows (enterable mouth tiles vs plain tagged terrain), so `key`
   *  — not `page` — is the unique row id. */
  perPage: { key: string; page: number; count: number; description: string; tooltip?: string }[]
  /** Cells the object visibly stamps (footprint + neighbor provenance). */
  cellsStamped: number
  /** Target cells a later object overdrew. Their final tile belongs to the
   *  overwriter, so they're reported but never classified as this object's. */
  cellsBuried: number
}

export function summarizeObjectCollision(
  influence: DecodedObjectInfluence | null,
  data: CollisionTableResult | null
): ObjectCollisionSummary | null {
  if (!influence || !data) return null
  const { table, pipeEntryBits } = data

  // Player-enterable pipe mouth — a TILE-level fact (tag $14 page + the
  // tile's DATA_0AEBBC direction bits), and a tile-driven screen exit, so
  // it classifies as exit-green like doors. See data/exit-triggers.ts.
  const isEnterableMouth = (mid: number, entry: CollisionEntry | undefined): boolean =>
    entry?.tag === PIPE_MOUTH_TAG &&
    ((pipeEntryBits[mid & 0xff] ?? 0) & PIPE_ENTRY_DIRECTION_MASK) !== 0

  // Group visible cells by (page, enterable-mouth) — pages are the collision
  // unit, except the pipe-mouth page where enterability splits per tile.
  const groupCounts = new Map<number, number>() // key = page << 1 | enterable
  let cellsStamped = 0
  let cellsBuried = 0
  for (const c of influence.cells) {
    if (c.cls === 'buried' || c.cls === 'buriedNeighbor') {
      cellsBuried++
      continue
    }
    cellsStamped++
    const page = (c.mid >>> 8) & 0xff
    const groupKey = (page << 1) | (isEnterableMouth(c.mid, table[page]) ? 1 : 0)
    groupCounts.set(groupKey, (groupCounts.get(groupKey) ?? 0) + 1)
  }

  const chipsByKey = new Map<string, CollisionChip>()
  const perPage: ObjectCollisionSummary['perPage'] = []
  for (const [groupKey, count] of groupCounts) {
    const page = groupKey >> 1
    const enterable = (groupKey & 1) === 1
    const entry = table[page]
    const behavior = enterable
      ? { label: 'Enterable pipe mouth', fill: 'exit' as const, outline: 'pipe-mouth' as const }
      : entry
        ? { ...fillBehavior(entry), outline: outlineGroup(entry) }
        : { label: 'Unknown page', fill: 'none' as const, outline: null }
    // The enterable-mouth split shares the pipe-mouth tag, so one lookup
    // covers both rows of a split page.
    const tooltip = entry ? secondaryTagTooltip(entry.tag) : undefined
    perPage.push({
      key: `${page}${enterable ? ':mouth' : ''}`,
      page,
      count,
      description: entry
        ? enterable
          ? `${describeEntry(entry)} — player-enterable pipe mouth (tile-driven screen exit)`
          : describeEntry(entry)
        : `no collision entry (page 0x${hex(page)} out of table range)`,
      tooltip
    })
    const key = `${behavior.fill}|${behavior.outline ?? ''}|${behavior.label}`
    const chip = chipsByKey.get(key)
    if (chip) chip.count += count
    else chipsByKey.set(key, { key, ...behavior, tooltip, count })
  }

  return {
    chips: [...chipsByKey.values()].sort((a, b) => b.count - a.count),
    perPage: perPage.sort((a, b) => b.count - a.count),
    cellsStamped,
    cellsBuried
  }
}
