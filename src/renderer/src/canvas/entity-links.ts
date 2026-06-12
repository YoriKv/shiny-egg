// Per-type "special treatments": relationships between level entities that the
// editor surfaces but the raw data doesn't make explicit. The first kind is
// ASSOCIATION LINKS — when an entity is selected the canvas draws connector
// lines to everything it's related to (e.g. an exit ↔ the pipe/door on its
// screen, and vice-versa).
//
// EXPANDABLE BY DESIGN. To add a new relationship (generator ↔ its spawns, a
// P-switch ↔ the blocks it toggles, a boss ↔ its arena trigger, …): write one
// `AssociationRule` that, given the selected entity, returns the entities it's
// linked to for BOTH directions, and append it to `RULES`. Anchors, dedup, and
// drawing are shared — a new rule is the only code you add. Future non-link
// treatments (custom drag, per-type adornments) can hang off parallel
// registries in this module.

import type { LevelData, LevelObject, LevelSprite, ScreenExit } from '../../../preload/api'
import { isExitTriggerObject, isExitTriggerSprite } from '../data/exit-triggers'
import { getObjectInfo } from '../data/obj-metadata'
import { CELL_PX, exitCenterX, exitCenterY, objectVisualBox, screenOf } from './geometry'
import { objectCellBox } from './limits'
import type { Selection } from '../types'

/** A resolved selected entity — one of the three editable kinds. */
export type EntityRef =
  | { kind: 'object'; obj: LevelObject }
  | { kind: 'sprite'; spr: LevelSprite }
  | { kind: 'exit'; exit: ScreenExit }

/** A connector line between two world-pixel anchors. */
export interface LinkLine {
  ax: number
  ay: number
  bx: number
  by: number
}

/** Given the selected entity + level, return the entities it links to. Should
 *  be bidirectional (handle "A selected → list Bs" and "B selected → list A"). */
export type AssociationRule = (sel: EntityRef, level: LevelData) => EntityRef[]

/**
 * Exit ↔ the exit-trigger object or entrance sprite on the same screen. Three
 * engine mechanisms fire a screen exit (see data/exit-triggers.ts): an OBJECT
 * stamping a DOOR tile (DR/BD bits) or a player-enterable PIPE-MOUTH tile
 * (tag $14 + DATA_0AEBBC entry bits — tile-driven, no sprite), or a door /
 * pipe / teleport SPRITE whose Main funnels into the shared warp routine
 * (`CODE_02A4B5`). Either way there is no byte-level link to the exit, so we
 * reconstruct it by co-location on the exit's screen.
 */
const exitPipeDoorRule: AssociationRule = (sel, level) => {
  if (sel.kind === 'exit') {
    const screen = sel.exit.screenIndex
    const out: EntityRef[] = []
    for (const o of level.objects) {
      if (isExitTriggerObject(o.num, o.exnum) && screenOf(o.x, o.y) === screen) {
        out.push({ kind: 'object', obj: o })
      }
    }
    for (const s of level.sprites) {
      if (isExitTriggerSprite(s.num) && screenOf(s.x, s.y) === screen) {
        out.push({ kind: 'sprite', spr: s })
      }
    }
    return out
  }
  if (sel.kind === 'object' && isExitTriggerObject(sel.obj.num, sel.obj.exnum)) {
    const screen = screenOf(sel.obj.x, sel.obj.y)
    const exit = level.exits.find((e) => e.screenIndex === screen)
    return exit ? [{ kind: 'exit', exit }] : []
  }
  if (sel.kind === 'sprite' && isExitTriggerSprite(sel.spr.num)) {
    const screen = screenOf(sel.spr.x, sel.spr.y)
    const exit = level.exits.find((e) => e.screenIndex === screen)
    return exit ? [{ kind: 'exit', exit }] : []
  }
  return []
}

/** True when sprite `s` sits inside pipe-category object `o`'s cell box. */
function pipeHostsSprite(o: LevelObject, s: LevelSprite): boolean {
  if (getObjectInfo(o.num, o.exnum).category !== 'pipe') return false
  const b = objectCellBox(o)
  return s.x >= b.x0 && s.x < b.x0 + b.w && s.y >= b.y0 && s.y < b.y0 + b.h
}

/**
 * Exit ↔ the PIPE OBJECT hosting its entrance sprite. The UN-enterable pipe
 * family ($F4 …) stamps no enterable mouth tiles (see data/exit-triggers.ts),
 * so designers make those warp by placing an entrance SPRITE on the mouth —
 * the rule above only reaches that (often invisible) sprite. The pipe is the
 * landmark the designer sees, so link it too: for every exit-trigger sprite on
 * the exit's screen, any pipe-category object whose cell box contains that
 * sprite joins the link set — and selecting such a pipe links back to its
 * sprite's screen exit. (Tile-enterable pipes — $3C etc. — link directly via
 * the exitTrigger rule above instead.) Sharing a screen is deliberately NOT
 * enough: decorative pipes near a door / hidden entrance stay unlinked.
 * (Verified across the shipped levels: every Vertical-pipe-entrance sprite
 * sits exactly on its host pipe's anchor cell; pipes unrelated to the exit
 * never contain the entrance sprite.)
 */
const exitPipeHostRule: AssociationRule = (sel, level) => {
  if (sel.kind === 'exit') {
    const screen = sel.exit.screenIndex
    const out: EntityRef[] = []
    for (const s of level.sprites) {
      if (!isExitTriggerSprite(s.num) || screenOf(s.x, s.y) !== screen) continue
      for (const o of level.objects) {
        if (pipeHostsSprite(o, s)) out.push({ kind: 'object', obj: o })
      }
    }
    return out
  }
  if (sel.kind === 'object') {
    for (const s of level.sprites) {
      if (!isExitTriggerSprite(s.num) || !pipeHostsSprite(sel.obj, s)) continue
      const exit = level.exits.find((e) => e.screenIndex === screenOf(s.x, s.y))
      if (exit) return [{ kind: 'exit', exit }]
    }
  }
  return []
}

/** The active association rules. Append to extend. */
const RULES: AssociationRule[] = [exitPipeDoorRule, exitPipeHostRule]

/** World-px center anchor for a link endpoint at this entity. */
export function entityAnchorPx(ref: EntityRef): { x: number; y: number } {
  if (ref.kind === 'exit') {
    return { x: exitCenterX(ref.exit.screenIndex), y: exitCenterY(ref.exit.screenIndex) }
  }
  if (ref.kind === 'sprite') {
    return { x: (ref.spr.x + 0.5) * CELL_PX, y: (ref.spr.y + 0.5) * CELL_PX }
  }
  const b = objectVisualBox(ref.obj)
  return { x: b.x0 + b.w / 2, y: b.y0 + b.h / 2 }
}

function refKey(r: EntityRef): string {
  if (r.kind === 'object') return `o${r.obj.uid}`
  if (r.kind === 'sprite') return `s${r.spr.uid}`
  return `e${r.exit.uid}`
}

/** Resolve a uid-based Selection to a concrete entity ref (object/sprite/exit
 *  only — null for incoming/spawn/none). */
export function resolveEntityRef(sel: Selection | null, level: LevelData): EntityRef | null {
  if (!sel) return null
  if (sel.kind === 'object') {
    const obj = level.objects.find((o) => o.uid === sel.uid)
    return obj ? { kind: 'object', obj } : null
  }
  if (sel.kind === 'sprite') {
    const spr = level.sprites.find((s) => s.uid === sel.uid)
    return spr ? { kind: 'sprite', spr } : null
  }
  if (sel.kind === 'exit') {
    const exit = level.exits.find((e) => e.uid === sel.uid)
    return exit ? { kind: 'exit', exit } : null
  }
  return null
}

/** All connector lines for the current selection (dedup'd across rules). */
export function linksFor(sel: EntityRef, level: LevelData): LinkLine[] {
  const from = entityAnchorPx(sel)
  const seen = new Set<string>()
  const lines: LinkLine[] = []
  for (const rule of RULES) {
    for (const target of rule(sel, level)) {
      const key = refKey(target)
      if (seen.has(key)) continue
      seen.add(key)
      const to = entityAnchorPx(target)
      lines.push({ ax: from.x, ay: from.y, bx: to.x, by: to.y })
    }
  }
  return lines
}
