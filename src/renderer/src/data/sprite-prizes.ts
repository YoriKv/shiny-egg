// Sprite prize contents — what a prize-bearing sprite releases when popped / triggered. The
// editor draws this as a half-tile circular icon centred on the cell ABOVE the sprite, only while
// it's selected (canvas/draw/sprite-variant-hints.ts `drawSpritePrize`) — replacing the old corner
// badge. Covers the Winged Clouds ($067, $0B5, $0B6-$0CC) and the defeat-all room reward ($161).
// Parity-varying entries ($067/$0B5/$161) pick by spawn-cell `parityIndex`; the rest are fixed.
// Derived from sprite names + reveal/reward tables (Bank03 DATA_03C084, Bank0F DATA_0F8EA6).
// $0C9 (Winged Cloud [CRASH]) is intentionally omitted.

import { parityIndex } from 'snes-framework/sprite-parity'

export type SpritePrizeKind =
  | '1up' | 'stars' | 'coin' | 'flower' | 'key' | 'door' | 'switch' | 'sunflower'
  | 'pow' | 'stairs' | 'platform' | 'bandit' | 'eater' | 'watermelon' | 'random'

/** spriteId → prize kind by `parityIndex` (length 1 = fixed; length 4 = parity-selected). */
export const SPRITE_PRIZES: Record<number, readonly SpritePrizeKind[]> = {
  0x067: ['stars', 'sunflower', 'flower', '1up'], // hidden cloud, rock/snowball-revealed (DATA_0F8EA6)
  0x0b5: ['1up', 'stars', 'switch', 'stars'], //     hidden cloud, proximity-revealed (DATA_03C084)
  0x0b6: ['coin'], //        Winged Cloud, 8 coins
  0x0b7: ['1up'], //         bubbled 1-up
  0x0b8: ['flower'],
  0x0b9: ['pow'],
  0x0ba: ['stairs'], //      stairs (right/left is a direction, same prize)
  0x0bb: ['platform'], //    platform (right/left)
  0x0bc: ['bandit'],
  0x0bd: ['coin'],
  0x0be: ['1up'],
  0x0bf: ['key'],
  0x0c0: ['stars'], //       3 stars
  0x0c1: ['stars'], //       5 stars
  0x0c2: ['door'],
  0x0c3: ['eater'], //       ground eater
  0x0c4: ['watermelon'],
  0x0c5: ['watermelon'], //  fire
  0x0c6: ['watermelon'], //  icy
  0x0c7: ['sunflower'], //   3-leaf seed
  0x0c8: ['sunflower'], //   6-leaf seed
  0x0cb: ['random'], //      random item
  0x0cc: ['switch'], //      !-switch / !-switch
  0x161: ['coin', 'key', 'flower', 'door'] // defeat-all room reward (by cell parity)
}

/** Resolve the prize a sprite at (x,y) yields, or null if `num` carries no prize.
 *  With no meaningful placement the caller passes the spawn cell; parity entries index by it. */
export function spritePrizeAt(num: number, x: number, y: number): SpritePrizeKind | null {
  const prizes = SPRITE_PRIZES[num]
  if (!prizes) return null
  return prizes.length === 1 ? prizes[0]! : (prizes[parityIndex(x, y)] ?? prizes[0]!)
}

/** Half-tile circular prize icon presentation (short label + colour). */
export const SPRITE_PRIZE_STYLE: Record<SpritePrizeKind, { label: string; color: string }> = {
  '1up': { label: '1UP', color: 'rgba(53, 200, 85, 1)' }, //   green
  stars: { label: '★', color: 'rgba(238, 204, 42, 1)' }, //    gold
  coin: { label: '¢', color: 'rgba(238, 204, 42, 1)' }, //     gold
  flower: { label: 'FLR', color: 'rgba(236, 72, 153, 1)' }, // pink
  key: { label: 'KEY', color: 'rgba(148, 163, 184, 1)' }, //   slate
  door: { label: 'DOR', color: 'rgba(168, 121, 80, 1)' }, //   wood
  switch: { label: '!', color: 'rgba(230, 58, 58, 1)' }, //    red
  sunflower: { label: 'SUN', color: 'rgba(245, 158, 11, 1)' }, // orange
  pow: { label: 'POW', color: 'rgba(59, 139, 255, 1)' }, //    blue
  stairs: { label: 'STR', color: 'rgba(91, 208, 255, 1)' }, // cyan
  platform: { label: 'PLT', color: 'rgba(91, 208, 255, 1)' }, // cyan
  bandit: { label: 'BAN', color: 'rgba(176, 91, 255, 1)' }, // purple
  eater: { label: 'EAT', color: 'rgba(139, 107, 59, 1)' }, //  brown
  watermelon: { label: 'WML', color: 'rgba(53, 200, 85, 1)' }, // green
  random: { label: '?', color: 'rgba(226, 232, 240, 1)' } //   white
}
