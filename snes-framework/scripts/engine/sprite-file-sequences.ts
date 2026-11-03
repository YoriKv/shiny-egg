// Ordered multi-file sprite graphics: sprites whose tiles run past their own
// 32-tile spriteset slot into the next one(s), so their gfx files must sit in
// CONSECUTIVE slots of the six-file row (`DATA_spriteset_files`), in this order.
//
// Provenance: every shipped level that places each sprite below holds exactly
// these files adjacent and in this order in its authored row (V1.0 sweep over
// all backed levels). Entries seen in a single level (Lunge Fish, Large Milde,
// Fishin' Lakitu) are the least corroborated. The worst a wrong entry does is
// over-constrain a fit; a missing one lets a fit split a sprite's files.
//
// Deliberately NOT derived from a sprite's curated required-file list: those
// are unordered and partly over-approximated (a sprite placed in one level
// lists that level's whole row). Several multi-file sprites ship with their
// files apart (Dr. Freezegood, Rogger's pot, the falling icicle) or in an
// order other than the list's (Kamek, Big Boo), so the lists aren't
// adjacency rules.

/** Sprite num → its gfx files in required slot order (first = lowest slot). */
export const SPRITE_FILE_CHAINS: ReadonlyMap<number, readonly number[]> = new Map<number, readonly number[]>([
  [0x010, [0x42, 0x43]], // Caged Ghost (round mound)
  [0x090, [0x42, 0x43]], // Dangling Ghost
  [0x193, [0x42, 0x43]], // Caged Ghost (sewer)
  [0x02c, [0x32, 0x33, 0x34]], // Lunge Fish
  [0x030, [0x28, 0x60]], // Little Mouser
  [0x071, [0x61, 0x48]], // Big Boo
  [0x0d4, [0x6d, 0x6e]], // Large Milde
  [0x0d9, [0x49, 0xaa]], // Fishin' Lakitu
  [0x166, [0x49, 0x4b]], // Thunder Lakitu
  [0x0e8, [0x2a, 0x2b]], // Goonie
  [0x153, [0x2a, 0x2b]], // Goonie with Shy Guy
  [0x155, [0x2a, 0x2b]], // Very Goonie
  [0x0ff, [0x3a, 0x3b]], // Poochy
  [0x125, [0x6a, 0x6c]], // Kamek
  [0x137, [0x20, 0x21]], // Falling stone blocks
  [0x138, [0x20, 0x21]],
  [0x139, [0x20, 0x21]],
  [0x13a, [0x20, 0x21]],
  [0x16d, [0x2b, 0x47]], // Para Koopas
  [0x16e, [0x2b, 0x47]],
  [0x16f, [0x2b, 0x47]],
]);

/**
 * Place ordered file dependencies as adjacent chains. Shared files join
 * sequences into one chain (A→B and B→C become A→B→C). Existing slot-bound
 * assignments are preserved; an impossible chain is returned as a conflict.
 */
export function placeOrderedSpritesetFiles(
  files: number[],
  sequences: readonly (readonly number[])[],
  lockedSlots: ReadonlySet<number>,
  requiredFiles: ReadonlySet<number>
): { changed: boolean; conflicts: number[] } {
  const next = new Map<number, number>()
  const previous = new Map<number, number>()
  const conflicts = new Set<number>()
  for (const sequence of sequences) {
    const unique = [...new Set(sequence)]
    for (let i = 0; i + 1 < unique.length; i++) {
      const before = unique[i]!
      const after = unique[i + 1]!
      const existingNext = next.get(before)
      const existingPrevious = previous.get(after)
      if (
        (existingNext !== undefined && existingNext !== after) ||
        (existingPrevious !== undefined && existingPrevious !== before)
      ) {
        conflicts.add(before)
        conflicts.add(after)
        continue
      }
      next.set(before, after)
      previous.set(after, before)
    }
  }

  const chains: number[][] = []
  const visited = new Set<number>()
  for (const start of next.keys()) {
    if (previous.has(start) || visited.has(start)) continue
    const chain: number[] = []
    let file: number | undefined = start
    while (file !== undefined && !visited.has(file)) {
      visited.add(file)
      chain.push(file)
      file = next.get(file)
    }
    if (file !== undefined) {
      for (const id of chain) conflicts.add(id)
    } else if (chain.length > 1) {
      chains.push(chain)
    }
  }
  for (const id of next.keys()) {
    if (!visited.has(id)) conflicts.add(id)
  }

  chains.sort((a, b) => b.length - a.length)
  let changed = false
  const claimedSlots = new Set(lockedSlots)
  for (const chain of chains) {
    let alreadyPlaced = false
    for (let start = 0; start + chain.length <= files.length; start++) {
      if (chain.every((file, i) => files[start + i] === file)) {
        alreadyPlaced = true
        for (let i = 0; i < chain.length; i++) claimedSlots.add(start + i)
        break
      }
    }
    if (alreadyPlaced) continue

    let bestStart = -1
    let bestScore = Number.NEGATIVE_INFINITY
    for (let start = 0; start + chain.length <= files.length; start++) {
      let valid = true
      let score = 0
      for (let i = 0; i < chain.length; i++) {
        const slot = start + i
        const existing = files[slot]!
        if (claimedSlots.has(slot) && existing !== chain[i]) {
          valid = false
          break
        }
        if (existing === chain[i]) score += 4
        else if (!requiredFiles.has(existing)) score += 1
        if (i === 0 && existing === chain[0]) score += 2
      }
      if (valid && score > bestScore) {
        bestStart = start
        bestScore = score
      }
    }
    if (bestStart < 0) {
      for (const id of chain) conflicts.add(id)
      continue
    }
    for (let i = 0; i < chain.length; i++) {
      const slot = bestStart + i
      if (files[slot] !== chain[i]) {
        files[slot] = chain[i]!
        changed = true
      }
      claimedSlots.add(slot)
    }
  }
  return { changed, conflicts: [...conflicts].sort((a, b) => a - b) }
}
