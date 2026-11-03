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
