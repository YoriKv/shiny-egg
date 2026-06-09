// Plain-English summaries of a sprite's neighbour-dependency rows. Pure
// presentation over the neighbour-dep metadata — generic per-mechanism templates
// with the real target name interpolated from the data, so the phrasing stays
// correct per-sprite rather than hardcoding entity names. Lives here (next to the
// neighbour-dep metadata) rather than in PropertiesPanel so the panel body stays
// presentational.

import { getSprite, type SpriteNeighborDep } from './obj-metadata'

/** Indefinite article for a noun phrase. */
function aOrAn(t: string): string {
  return /^[aeiou]/i.test(t) ? 'an' : 'a'
}

/** A clean, data-driven noun phrase for a dep's target: friendly sprite names
 *  for sprite targets (resolved from `targetIds`); otherwise the data's de-hexed
 *  label — text outside any parenthetical, else the parenthetical itself (so
 *  e.g. a rail's `$CE-$D2 (line guides)` collapses to "line guides" rather than
 *  enumerating five objects). */
function neighborTarget(d: SpriteNeighborDep): string {
  if (d.targetKind === 'sprite') {
    const names = d.targetIds.map((id) => getSprite(parseInt(id, 16)).name).filter(Boolean)
    if (names.length) return names.join(' or ')
  }
  const noHex = d.targetName.replace(/\$[0-9A-Fa-fXx]+(?:-\$[0-9A-Fa-fXx]+)?/g, '').trim()
  const outside = noHex.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()
  const inside = noHex.match(/\(([^)]+)\)/)?.[1]?.trim()
  return outside || inside || 'a target'
}

/** Plain-English one-liner for a neighbour-dependency row: a generic template
 *  per spatial mechanism with the real target name interpolated from the data,
 *  so it stays correct per-sprite rather than hardcoding entity names. */
export function neighborSummary(d: SpriteNeighborDep): string {
  // Class F (pipe-spawner) is behaviour-enabling, not a snap/requirement — give
  // it its own line rather than the generic same-cell "snaps to …" phrasing.
  if (d.cls === 'F') return 'Becomes a pipe spawner — emits copies — if placed on a pipe mouth'
  const t = neighborTarget(d)
  switch (d.spatial) {
    case 'same-cell':
      return `Snaps to ${aOrAn(t)} ${t} if placed on one`
    case 'path':
      return `Follows ${t} if placed on one`
    case 'offset-cell':
      return `Locks onto ${aOrAn(t)} ${t} placed near it`
    case 'proximity':
      return `Needs ${aOrAn(t)} ${t} within reach`
    case 'global':
      return `Pairs with ${aOrAn(t)} ${t} in the level`
    case 'carried':
      return `Needs ${aOrAn(t)} ${t} carried in from another room`
    case 'screen':
      return 'Uses the exit set for its screen'
  }
}
