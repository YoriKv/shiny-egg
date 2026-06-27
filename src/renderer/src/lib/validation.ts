// Level-validation check engine (renderer-side, pure). Static playability lints
// — the in-editor analogue of the dev CLIs (sweep-levels / validity-report /
// validate-neighbor-deps), surfaced together in the Validation panel. Catches
// level designs that look fine in the static editor but break, glitch, or read
// garbage at runtime.
//
// Lives renderer-side because the per-entity render-validity checks need the
// obj-metadata module + verdict libs that live here; the decode-derived inputs
// (page count/overflow, the abort flag, the screen→page map) are computed
// main-side and passed in as `LevelDecodeSignals`.
//
// The render-validity placement checks (object theme/anim/VRAM coverage, sprite
// missing-gfx) are NOT in here — they reuse the existing entityRenderValidity
// probe and are composed in the panel for the CURRENT level only (the per-level
// probe is too heavy to run across all ~220 levels in the sweep, and those
// verdicts are already surfaced in the Picker).
//
// SNES limits, NOT the GBA ones Advynia uses: the sprite table is 256 entries
// (MAX_LEVEL_SPRITES), the "screen" cap is really the 63-entry page pool
// (signals.overflowed), and Advynia's "F0–F3 object overflow" has no SNES
// equivalent (those are dead dispatch slots) — its structural analogue is the
// page-pool overflow. See research + snes-framework asm citations.

import type {
  AllLevelsValidationResult,
  CollectibleCounts,
  LevelData,
  LevelDecodeSignals,
  LevelSprite,
  LevelValidationInput,
  LevelValidationResult,
  ValidationIssue
} from '../../../preload/api'
import { MAX_LEVEL_EXITS, MAX_LEVEL_SPRITES } from '../canvas/limits'

// ── collectible identity ─────────────────────────────────────────────────────
const RED_COIN = 0x065
const FLOWERS = new Set([0x0fa, 0x110])
const FLOATING_COIN = 0x1af
const COIN_OBJECTS = new Set([0x68, 0x8a]) // std coin objects (counted only)

// Item-memory PRIORITY model (ported from Advynia's itemmemorycheck): every
// item-memory entity carries a priority — HIGH (2) = a real loss if its
// collected-bit collides (red coins, flowers, keys); LOW (1) = a normal coin you
// don't mind losing. A screen-page tile-column conflicts when a HIGH item shares
// it with ANY other item-memory item (high+high or high+low ≥ 3); low+low is
// fine. This catches "red coin stacked over a coin" — which the old red/flower
// set missed — WITHOUT the coin-trail false positives the broad set produced.
const ITEM_MEMORY_PRIORITY = new Map<number, number>([
  [0x065, 2], // red coin
  [0x0fa, 2], // flower
  [0x110, 2], // flower (tileset variant)
  [0x027, 2], // key — losing it can soft-lock
  [0x1af, 1] // floating coin
])
const isHighPriorityItem = (num: number): boolean => ITEM_MEMORY_PRIORITY.get(num) === 2

// The full item-memory family (the CODE_03D3F8/03D3F3 caller set): key, locked
// doors, floating coin, bubbled 1-up, eggs, keyhole cork — used by the
// EXPERIMENTAL cross-level check + the `tracked` tally.
const ITEM_MEMORY_BROAD = new Set([
  0x027, 0x04e, 0x131, 0x065, 0x1af, 0x0fa, 0x110, 0x100, 0x022, 0x023, 0x024, 0x1a4
])

// Header enum values with no valid render — the 'Glitched'/'unused' rows in
// data/header-schema.ts (field index → bad values). BG2/BG3 tileset only; the
// curated values are mirrored here so the engine stays JSON-free.
const GLITCHED_HEADER: { index: number; label: string; bad: Set<number> }[] = [
  { index: 3, label: 'BG2 tileset', bad: new Set([0x11, 0x17]) }, // 'Glitched'
  { index: 5, label: 'BG3 tileset', bad: new Set([0x0b]) } // 'Elevator test (unused)'
]

const hx = (n: number): string => `0x${n.toString(16).toUpperCase()}`

/** Screen index (0..127) a tile-grid cell falls in: 16 screens wide, 8 tall. */
function screenOf(x: number, y: number): number {
  return (((y >> 4) & 0x07) << 4) | ((x >> 4) & 0x0f)
}

/** Top-left tile cell of a screen index — a jump target for screen-scoped issues. */
function screenOriginCell(screen: number): { x: number; y: number } {
  return { x: (screen & 0x0f) * 16, y: ((screen >> 4) & 0x07) * 16 }
}

/** The Advynia "Count Items" readout for one level. */
export function countCollectibles(level: LevelData): CollectibleCounts {
  let flowers = 0
  let redCoins = 0
  let coins = 0
  let tracked = 0
  for (const s of level.sprites) {
    if (s.num === RED_COIN) redCoins++
    if (FLOWERS.has(s.num)) flowers++
    if (s.num === FLOATING_COIN) coins++
    if (ITEM_MEMORY_BROAD.has(s.num)) tracked++
  }
  for (const o of level.objects) {
    if (o.num !== 0 && COIN_OBJECTS.has(o.num)) coins++
  }
  return { flowers, redCoins, coins, tracked }
}

/**
 * The cheap, decode-derived checks — run for every level (current + sweep).
 * Pure: takes the level data + main-computed decode signals, returns issues.
 *
 * Every check here is verified FALSE-POSITIVE-FREE against the vanilla V1.0 cart
 * (tmp/vanilla-sweep): vanilla is correct by construction, so a check that fires
 * on it is too strict. Checks investigated and DROPPED for failing that bar:
 *   • warp-to-unbacked/out-of-range — at runtime dest < 0xDE loads as a level
 *     (Bank01), so 0xDC/0xDD are valid destinations (0x6B → 0xDD is a real warp).
 *   • boss-door-without-same-screen-exit — doors can straddle a screen boundary
 *     (vanilla 0x59: the door's two sprites land on screens 0x44 + 0x54, the
 *     exit on 0x54), so "exit on the sprite's screen" isn't a reliable rule.
 * Cross-level item-memory collisions live in validateAll (they need all levels +
 * the warp graph); that check is now accurate enough to be core too.
 */
export function checkLevelCore(
  level: LevelData,
  signals: LevelDecodeSignals,
  levelRecordId: number
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const add = (i: Omit<ValidationIssue, 'levelRecordId'>): void => {
    issues.push({ ...i, levelRecordId })
  }

  // ── Sprite cap (Advynia) — the 256-entry stage spawn-flag table ──────────
  if (level.sprites.length > MAX_LEVEL_SPRITES) {
    add({
      check: 'sprite-cap',
      title: 'Sprite limit',
      severity: 'error',
      message: `${level.sprites.length} sprites exceeds the ${MAX_LEVEL_SPRITES} cap — extras corrupt the stage spawn-flag table.`,
      // The sprites beyond the cap are the ones the engine can't track.
      sprites: level.sprites.slice(MAX_LEVEL_SPRITES).map((s) => ({ num: s.num, x: s.x, y: s.y }))
    })
  } else if (level.sprites.length === MAX_LEVEL_SPRITES) {
    add({
      check: 'sprite-cap',
      title: 'Sprite limit',
      severity: 'warning',
      message: `At the ${MAX_LEVEL_SPRITES}-sprite cap — one more corrupts adjacent data.`
    })
  }

  // ── Screen-exit cap — one record per screen, 16×8 grid ───────────────────
  if (level.exits.length > MAX_LEVEL_EXITS) {
    add({
      check: 'exit-cap',
      title: 'Screen-exit limit',
      severity: 'error',
      message: `${level.exits.length} screen exits exceeds the ${MAX_LEVEL_EXITS}-screen exit table.`
    })
  }

  // ── Page-pool overflow / decode abort (Advynia "screen > 63" analogue) ───
  if (signals.decoded) {
    if (signals.aborted) {
      add({
        check: 'decode-abort',
        title: 'Corrupt level data',
        severity: 'error',
        message: 'The object stream aborts mid-parse — the level data is malformed.'
      })
    }
    if (signals.overflowed) {
      add({
        check: 'page-overflow',
        title: 'Page-pool overflow',
        severity: 'error',
        message: 'Level uses more than 63 screen pages — the page pool overflows and corrupts the level buffer.'
      })
    }
    // No near-limit warning: vanilla legitimately reaches 62/63 pages (e.g.
    // level 0x27), so only the actual overflow is flagged.
  }

  // ── Item-memory column collision (Advynia priority model) ────────────────
  // Item-memory entities in the same (page, tile-column) share one collected-bit
  // (Y collapses within a screen; screenPageMap resolves screen → LRU page, the
  // cart's own index). A conflict is only flagged when a HIGH-priority item (red
  // coin / flower / key) shares the column with another item-memory item — a
  // real loss. Two LOW items (coins) sharing a column is left alone.
  if (signals.decoded && signals.screenPageMap.length >= 128) {
    const byColumn = new Map<string, LevelSprite[]>()
    for (const s of level.sprites) {
      if (!ITEM_MEMORY_PRIORITY.has(s.num)) continue
      const raw = signals.screenPageMap[screenOf(s.x, s.y)]
      if (raw === undefined || (raw & 0x80) !== 0) continue // unmapped screen
      const key = `${raw & 0x3f}:${s.x & 0x0f}`
      const group = byColumn.get(key)
      if (group) group.push(s)
      else byColumn.set(key, [s])
    }
    for (const group of byColumn.values()) {
      if (group.length > 1 && group.some((s) => isHighPriorityItem(s.num))) {
        const s0 = group.find((s) => isHighPriorityItem(s.num)) ?? group[0]
        add({
          check: 'item-memory',
          title: 'Item-memory collision',
          severity: 'warning',
          message: `A high-value collectible shares an item-memory slot (screen-page column) with ${group.length - 1} other collectible(s) — collecting one despawns the rest.`,
          x: s0.x,
          y: s0.y,
          entity: { kind: 'sprite', id: s0.num },
          sprites: group.map((s) => ({ num: s.num, x: s.x, y: s.y }))
        })
      }
    }
  }

  // Exit-section sanity: a valid screen index is 0x00-0x7F (16×8 screens). A
  // record whose exits include an out-of-range index has a garbage/over-read
  // exit section (e.g. the unreachable orphan 0x7D, whose section is empty but
  // the parser over-reads 28 junk records) — skip the exit-based checks for it.
  const exitsWellFormed = level.exits.every((e) => e.screenIndex <= 0x7f)

  // ── Duplicate exits on one screen ────────────────────────────────────────
  // The live exit table ($7F:7E00) is one 4-byte slot per screen, written
  // screen-indexed (Bank0F build loop) — a second exit on the same screen
  // overwrites the first, so it never fires. Confirmed real: zero shipped levels
  // have duplicate-screen exits (only the garbage record 0x7D, excluded above).
  if (exitsWellFormed) {
    const perScreen = new Map<number, number>()
    for (const ex of level.exits) perScreen.set(ex.screenIndex, (perScreen.get(ex.screenIndex) ?? 0) + 1)
    for (const [screen, n] of perScreen) {
      if (n > 1) {
        add({
          check: 'dup-exit',
          title: 'Duplicate screen exit',
          severity: 'error',
          message: `Screen ${hx(screen)} has ${n} exits — the exit table holds one per screen, so all but one are lost.`,
          ...screenOriginCell(screen),
          entity: { kind: 'exit' }
        })
      }
    }
  }

  // ── Warp into a sentinel slot ────────────────────────────────────────────
  // The exit parser classifies any non-minibattle byte1 as a "warp" dest. At
  // runtime dest < 0xDE loads as a level (Bank01: the valid range is 0x00-0xDD),
  // and the engine ignores non-backed dests — so high markers aren't errors.
  // Only the seed-contest sentinel rows (0xDA/0xDB — 1-byte non-levels) are an
  // unambiguous "warp to nowhere".
  if (exitsWellFormed) {
    for (const ex of level.exits) {
      if (ex.variant !== 'warp') continue
      if (ex.destLevelRecordId === 0xda || ex.destLevelRecordId === 0xdb) {
        add({
          check: 'warp-dest',
          title: 'Warp to sentinel slot',
          severity: 'warning',
          message: `Screen ${hx(ex.screenIndex)} warps to ${hx(ex.destLevelRecordId)}, an unallocated sentinel slot.`,
          ...screenOriginCell(ex.screenIndex),
          entity: { kind: 'exit' }
        })
      }
    }
  }

  // ── Glitched / unused header values ──────────────────────────────────────
  for (const { index, label, bad } of GLITCHED_HEADER) {
    const v = level.header[index]
    if (v !== undefined && bad.has(v)) {
      add({
        check: 'header-glitched',
        title: 'Glitched header value',
        severity: 'warning',
        message: `${label} = ${hx(v)} is a known glitched/unused value — renders garbage.`
      })
    }
  }

  return issues
}

/** Roll per-level issues + counts into a result with severity tallies.
 *  Tallies the level's issues by severity. */
export function summarizeLevel(
  levelRecordId: number,
  name: string | undefined,
  issues: ValidationIssue[],
  counts: CollectibleCounts
): LevelValidationResult {
  return {
    levelRecordId,
    name,
    issues,
    counts,
    errorCount: issues.filter((i) => i.severity === 'error').length,
    warningCount: issues.filter((i) => i.severity === 'warning').length,
    infoCount: issues.filter((i) => i.severity === 'info').length
  }
}

/** A collectible's resolved item-memory slot within its level. */
interface CollectibleSlot {
  high: boolean
  s: LevelSprite
  page: number
  col: number
}

/** Resolve a level's collectibles to their (page, column) item-memory slots,
 *  keyed `page:col`. A slot keeps the highest-priority collectible on it. */
function collectibleSlots(inp: LevelValidationInput): Map<string, CollectibleSlot> {
  const slots = new Map<string, CollectibleSlot>()
  if (!inp.signals.decoded || inp.signals.screenPageMap.length < 128) return slots
  for (const s of inp.level.sprites) {
    if (!ITEM_MEMORY_PRIORITY.has(s.num)) continue
    const raw = inp.signals.screenPageMap[screenOf(s.x, s.y)]
    if (raw === undefined || (raw & 0x80) !== 0) continue // unmapped screen
    const page = raw & 0x3f
    const col = s.x & 0x0f
    const key = `${page}:${col}`
    const high = isHighPriorityItem(s.num)
    const existing = slots.get(key)
    if (!existing || (high && !existing.high)) slots.set(key, { high, s, page, col })
  }
  return slots
}

/**
 * Cross-level item-memory collision (accurate). The bitmap persists across
 * screen-exit warps (gm$0C skips its clear when the re-entry flag $038C ≠ 0 —
 * Bank01), so two collectibles in warp-connected sublevels collide when they
 * land in the SAME bitmap slot. This resolves that precisely:
 *
 *   1. Path-rooted sessions — for each map-entry root (where the bitmap clears),
 *      walk the DIRECTED warp graph forward to the set of sublevels reachable
 *      without returning to the map (the bitmap's lifetime). This avoids the old
 *      transitive-closure that merged unrelated levels through a shared sub-room.
 *   2. Column overlap — within a session, group by the selected bitmap
 *      (header[14]) and resolve each collectible's real (page, column) slot
 *      (the cart's own index). A collision is a slot used by collectibles in two
 *      DIFFERENT levels, where at least one is HIGH-priority (a real loss). Mere
 *      page-SHARING is no longer flagged.
 */
function crossLevelItemMemory(
  inputs: LevelValidationInput[],
  nameOf?: (rec: number) => string | undefined
): ValidationIssue[] {
  const byRec = new Map<number, LevelValidationInput>(inputs.map((i) => [i.levelRecordId, i]))

  // Directed warp adjacency (A → dest). Skip records whose exit section is
  // malformed (the over-read orphan 0x7D), whose junk warps would corrupt it.
  const adj = new Map<number, number[]>()
  for (const inp of inputs) {
    if (inp.level.exits.some((e) => e.screenIndex > 0x7f)) continue
    const dests: number[] = []
    for (const e of inp.level.exits) {
      if (e.variant === 'warp' && byRec.has(e.destLevelRecordId)) dests.push(e.destLevelRecordId)
    }
    if (dests.length) adj.set(inp.levelRecordId, dests)
  }

  // Each root's forward-reachable NON-root sub-rooms, not crossing into another
  // root (a root is entered fresh from the map, so two roots are never in one
  // item-memory session — even when a shared transition room loops back to both,
  // e.g. 0x36 bridges roots 0x00 ↔ 0x06). Tally how many roots reach each
  // sub-room: one reached by ≥2 roots is SHARED, and the pipe you actually exit
  // through is unknowable statically — so the collision is ambiguous and we drop
  // it (e.g. the bonus room 0x37 bridges sub-rooms of roots 0x02 and 0x0B).
  const reachByRoot = new Map<number, Set<number>>()
  const ownerCount = new Map<number, number>()
  for (const root of inputs) {
    if (!root.isRoot) continue
    const reach = new Set<number>()
    const seen = new Set<number>([root.levelRecordId])
    const queue = [root.levelRecordId]
    while (queue.length) {
      const cur = queue.shift()!
      for (const next of adj.get(cur) ?? [])
        if (!seen.has(next) && !byRec.get(next)?.isRoot) {
          seen.add(next)
          queue.push(next)
          reach.add(next)
        }
    }
    reachByRoot.set(root.levelRecordId, reach)
    for (const s of reach) ownerCount.set(s, (ownerCount.get(s) ?? 0) + 1)
  }

  const issues: ValidationIssue[] = []
  const reported = new Set<string>()
  for (const root of inputs) {
    if (!root.isRoot) continue
    // Session = this root + only its PRIVATELY-owned sub-rooms (reached from no
    // other root). Shared sub-rooms are excluded (ambiguous, see above).
    const session = [
      root.levelRecordId,
      ...[...reachByRoot.get(root.levelRecordId)!].filter((s) => ownerCount.get(s) === 1)
    ]
    if (session.length < 2) continue

    // Bucket every collectible slot by (selected bitmap, page, column).
    const buckets = new Map<string, Map<number, CollectibleSlot>>()
    for (const rec of session) {
      const inp = byRec.get(rec)!
      const h14 = inp.level.header[14] ?? 0
      for (const [slotKey, entry] of collectibleSlots(inp)) {
        const bk = `${h14}:${slotKey}`
        const perLevel = buckets.get(bk) ?? new Map<number, CollectibleSlot>()
        perLevel.set(rec, entry) // one entry per level — same-level stacks are the intra-level check
        buckets.set(bk, perLevel)
      }
    }
    for (const [bk, perLevel] of buckets) {
      if (perLevel.size < 2) continue // a real collision spans ≥2 levels
      const entries = [...perLevel.entries()]
      if (!entries.some(([, v]) => v.high)) continue // and risks a HIGH-value item
      const recs = entries.map(([r]) => r).sort((a, b) => a - b)
      const dedupKey = `${bk}|${recs.join(',')}`
      if (reported.has(dedupKey)) continue // a shared sub-room hits this from many roots
      reported.add(dedupKey)
      const [hiRec, hiVal] = entries.find(([, v]) => v.high)!
      const label = recs.map((r) => nameOf?.(r) ?? hx(r)).join(' + ')
      issues.push({
        check: 'item-memory-cross',
        title: 'Cross-level item-memory collision',
        severity: 'warning',
        message: `Warp-connected levels ${label} place a collectible in the same item-memory slot (page ${hiVal.page}, column ${hiVal.col}) — collecting it in one marks it collected in the other.`,
        levelRecordId: hiRec,
        x: hiVal.s.x,
        y: hiVal.s.y,
        entity: { kind: 'sprite', id: hiVal.s.num },
        // Each colliding sprite jumps to its own level.
        sprites: entries.map(([rec, v]) => ({ num: v.s.num, x: v.s.x, y: v.s.y, levelRecordId: rec }))
      })
    }
  }
  return issues
}

/** Run the sweep across every backed level. */
export function validateAll(
  inputs: LevelValidationInput[],
  nameOf?: (rec: number) => string | undefined
): AllLevelsValidationResult {
  const levels: LevelValidationResult[] = []
  let totalErrors = 0
  let totalWarnings = 0
  let totalInfo = 0
  for (const inp of inputs) {
    const issues = checkLevelCore(inp.level, inp.signals, inp.levelRecordId)
    const res = summarizeLevel(
      inp.levelRecordId,
      nameOf?.(inp.levelRecordId),
      issues,
      countCollectibles(inp.level)
    )
    totalErrors += res.errorCount
    totalWarnings += res.warningCount
    totalInfo += res.infoCount
    if (res.issues.length) levels.push(res)
  }
  // Cross-level item-memory (accurate: path-rooted + column-overlap).
  const crossLevel = crossLevelItemMemory(inputs, nameOf)
  for (const c of crossLevel) {
    if (c.severity === 'error') totalErrors++
    else if (c.severity === 'warning') totalWarnings++
    else totalInfo++
  }
  // Errors first, then warning count, then by id.
  levels.sort(
    (a, b) =>
      b.errorCount - a.errorCount || b.warningCount - a.warningCount || a.levelRecordId - b.levelRecordId
  )
  return { levels, crossLevel, levelsChecked: inputs.length, totalErrors, totalWarnings, totalInfo }
}
