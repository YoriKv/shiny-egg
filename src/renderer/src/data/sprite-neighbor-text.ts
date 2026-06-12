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
  // Tile-conditional behaviours get behaviour-phrased lines rather than the
  // generic "snaps to …": pipe spawners (same-cell), the pipe-centring
  // piranhas (offset-cell), and the ice-block snap.
  if (d.cls === 'tile-behavior' && d.spatial === 'same-cell')
    return 'Becomes a pipe spawner — emits copies — if placed on a pipe mouth'
  if (d.cls === 'tile-behavior' && d.spatial === 'offset-cell')
    return 'Auto-centres on a pipe mouth placed under it'
  if (d.cls === 'ice-snap') return 'Encased in the cube if placed on an ice-block tile'
  const t = neighborTarget(d)
  switch (d.spatial) {
    case 'same-cell':
      return `Needs ${aOrAn(t)} ${t} at its own cell`
    case 'path':
      return d.enforce ? `Follows ${t} if placed on one` : `Travels ${t} when placed on one`
    case 'offset-cell':
      return `Locks onto ${aOrAn(t)} ${t} placed near it`
    case 'row':
      return d.enforce
        ? `Needs ${aOrAn(t)} ${t} on its row`
        : `Connects to ${t} beside it when present`
    case 'level':
      return `Needs ${t} somewhere in the level`
    case 'proximity':
      // radiusCells 0 = same-cell pairing (the mouser sits ON its hole).
      return d.radiusCells === 0
        ? `Sits on ${aOrAn(t)} ${t} (same cell)`
        : `Needs ${aOrAn(t)} ${t} within reach`
    case 'global':
      return d.enforce
        ? `Pairs with ${aOrAn(t)} ${t} in the level`
        : `Interacts with ${aOrAn(t)} ${t} placed in the level`
    case 'carried':
      return `Needs ${aOrAn(t)} ${t} carried in from another room`
    case 'screen':
      return 'Uses the exit set for its screen'
    case 'note':
      return d.designerRule
  }
}
