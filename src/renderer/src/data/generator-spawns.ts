// Generator sprite → the enemy sprite it spawns. Drives the canvas generator
// badge (canvas/draw/generator-badges.ts): a purple square showing the spawned
// enemy's thumbnail, with a red X for the matching "stopper". HAND-AUTHORED from
// the sprite names + asm spawn annotations (yi/Constants/NormalSpriteIDs.asm —
// e.g. $0E6 Gusty "generator spawns one Gusty", $13E Flying Fang "spawned by Bat
// Generator", $052 Balloon "BalloonGenerator" guard). Both a generator and its
// stopper map to the SAME spawned enemy (the stopper just adds the red X). Keys
// cover both. 0x0E8 (Goonie that also generates) is intentionally absent — it
// renders its own cel, so it needs no stand-in badge.

import { getSprite } from './obj-metadata'

/** Generator/stopper sprite num → the sprite num of the enemy it spawns. */
export const GENERATOR_SPAWNS: Readonly<Record<number, number>> = {
  0x1d7: 0x0e6, // Gusty generator                              → Gusty
  0x1d8: 0x0e6, // Gusty generator stopper
  0x1d9: 0x11b, // Lakitu stopper                               → Lakitu (one/two)
  0x1da: 0x129, // Fuzzy generator stopper                      → Fuzzy
  0x1dc: 0x13e, // Fang generator, from right                   → Flying Fang
  0x1dd: 0x13e, // Fang generator stopper
  0x1de: 0x13e, // Fang generator, from both sides
  0x1df: 0x13e, // Fang generator stopper
  0x1e0: 0x157, // Wall Lakitu generator                        → Wall Lakitu
  0x1e4: 0x166, // Thunder Lakitu stopper                       → Thunder Lakitu (one/two)
  0x1e5: 0x152, // Flutter generator                            → Flutter
  0x1e6: 0x152, // Flutter generator stopper
  0x1e7: 0x165, // Nipper Spore generator                       → Nipper Spore
  0x1e8: 0x165, // Nipper Spore generator stopper
  0x1e9: 0x174, // Baron Von Zeppelin w/ Needlenose generator   → Baron Von Zeppelin, Needlenose
  0x1ea: 0x174, // Baron Von Zeppelin w/ Needlenose stopper
  0x1eb: 0x175, // Baron Von Zeppelin w/ bomb generator         → Baron Von Zeppelin, bomb
  0x1ec: 0x175, // Baron Von Zeppelin w/ bomb stopper
  0x1ed: 0x052, // Balloon generator                            → Balloon
  0x1ee: 0x052, // Balloon generator stopper
  0x1ef: 0x18b, // Four yellow line-guided Flatbed Ferries gen. → Line-guided yellow Flatbed Ferry
  0x1f0: 0x132, // Lemon Drop generator                         → Lemon Drop
  0x1f1: 0x132, // Lemon Drop generator stopper
  0x1f4: 0x129 // Fuzzy generator                               → Fuzzy
}

// Which of the keyed ids are STOPPERS — derived once from the sprite name (the
// metadata names all end "… stopper"), so the table above stays a single column.
const STOPPERS: ReadonlySet<number> = new Set(
  Object.keys(GENERATOR_SPAWNS)
    .map(Number)
    .filter((num) => /stopper/i.test(getSprite(num).name))
)

export interface GeneratorSpawn {
  /** Sprite num of the spawned enemy (its thumbnail goes in the badge). */
  enemy: number
  /** True for a generator-STOPPER (badge gets a red X). */
  stopper: boolean
}

/** The generator badge for a sprite, or null when it isn't a generator/stopper. */
export function generatorSpawn(num: number): GeneratorSpawn | null {
  const enemy = GENERATOR_SPAWNS[num]
  return enemy === undefined ? null : { enemy, stopper: STOPPERS.has(num) }
}

/** The fixed set of spawned-enemy sprite nums — the thumbnails the canvas needs.
 *  Constant (no level dependence), so the thumbnail request key is header-only. */
export const GENERATED_ENEMY_NUMS: readonly number[] = [...new Set(Object.values(GENERATOR_SPAWNS))]
