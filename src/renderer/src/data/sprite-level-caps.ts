// Engine instance limits for placed sprites. TWO distinct semantics — the
// distinction matters because the stock cart itself "exceeds" the runtime
// kind in 10+ levels (verified against the base-cart instance index):
//
// - kind 'placement' — a NON-RESETTING per-level counter: placing more than
//   `max` genuinely breaks (extras never spawn / degrade). Warning-grade
//   when the placed count exceeds the cap.
// - kind 'alive' — a runtime mutual-exclusion guard that the engine CLEARS
//   when the guarded sprite despawns (scrolls away). Any number of
//   placements is legal; only `max` can be alive at once, and a spawn
//   attempt while the guard is held simply despawns itself. Info-grade —
//   NEVER a warning. Shipped levels lean on this deliberately: left/right
//   spawn-point pairs (two placements of one machine, the spawn-entry index
//   picks the side, the guard despawns the loser) and sequential machines
//   down a level. E.g. Burt's Fort ships 12 BG3-machine placements.
//
// Every entry cites the engine guard it mirrors (family docs in
// snes-framework/docs/, addresses are the WRAM/SRAM guard the spawn path
// checks).

export interface SpriteCap {
  /** Sprite ids sharing one guard (the cap counts the GROUP's instances). */
  ids: number[]
  /** 'placement' = non-resetting counter, exceeding breaks (warning).
   *  'alive' = at-once guard cleared on despawn, extra placements are a
   *  normal design pattern (info only). */
  kind: 'placement' | 'alive'
  max: number
  /** Short noun for the guarded thing (panel + badge tooltip). */
  label: string
  /** The engine guard, for provenance. */
  cite: string
  /** Designer-facing note shown in the panel tooltip (placement patterns,
   *  caveats). */
  note?: string
}

export const SPRITE_CAPS: SpriteCap[] = [
  {
    ids: [0x097],
    kind: 'placement',
    max: 3,
    label: 'POW Block',
    cite: 'per-level POW counter $0E25 (family-misc §9) — never resets mid-level; the 4th+ POW no-ops and each use inflates smaller'
  },
  {
    ids: [0x071],
    kind: 'alive',
    max: 7,
    label: 'Big Boo',
    cite: 'instance bitfield $0CC4 (family-boos §3.4)'
  },
  // One shared BG3-machine guard: the level's BG3 layer hosts a single
  // mechanical sprite at a time; the $0CB2 flag rejects a spawn while one is
  // alive and is cleared (STZ $0CB2) when it despawns/scrolls away.
  {
    ids: [0x036, 0x039, 0x03d, 0x03f, 0x050, 0x051, 0x073],
    kind: 'alive',
    max: 1,
    label: 'BG3 machine',
    cite: 'shared BG3 single-alive guard $0CB2, cleared on despawn (family-hazards §6.1, family-platforms §2.1/2.4/8.1)',
    note:
      'Multiple placements are normal: shipped levels place these in left/right PAIRS — each placement is a spawn point, the spawn-entry index shifts the machine toward the side the player entered from, and the guard despawns the duplicate. Sequential machines down a level also work, since the guard clears when one scrolls away.'
  },
  {
    ids: [0x082],
    kind: 'alive',
    max: 1,
    label: 'Chain Chomp',
    cite: 'level-scope chain state $0DFD… (family-misc §23) — one per room'
  },
  {
    ids: [0x0ff],
    kind: 'alive',
    max: 1,
    label: 'Poochy',
    cite: 'single instance per level (family-platforms §7.7)'
  },
  {
    ids: [0x0ee],
    kind: 'alive',
    max: 1,
    label: 'Eggo-Dil',
    cite: 'single-instance guard $0EDF (family-misc §12)'
  },
  {
    ids: [0x01f],
    kind: 'alive',
    max: 1,
    label: 'Rotating Doors',
    cite: 'one per room, shared WRAM $105C… (family-misc §23)'
  },
  {
    ids: [0x11b],
    kind: 'alive',
    max: 1,
    label: 'Lakitu',
    cite: 'singleton guard $0C3C (family-clouds §2.2)'
  },
  {
    ids: [0x166],
    kind: 'alive',
    max: 1,
    label: 'Thunder Lakitu',
    cite: 'singleton guard $0C68 (family-clouds §2.5)'
  },
  {
    ids: [0x0a6, 0x0a7],
    kind: 'alive',
    max: 1,
    label: 'Incoming Chomp',
    cite: 'mutual-exclusion guards $0073/$0DC2 (family-misc §20)'
  }
]

const capByNum = new Map<number, SpriteCap>()
for (const c of SPRITE_CAPS) for (const id of c.ids) capByNum.set(id, c)

export function capForNum(num: number): SpriteCap | undefined {
  return capByNum.get(num)
}

export interface CapStatus {
  cap: SpriteCap
  /** Placed instances of the cap GROUP in this level. */
  count: number
  /** Only ever true for 'placement' caps — 'alive' guards can't be exceeded
   *  by placing more (extras just take turns spawning). */
  exceeded: boolean
}

/** Cap status for one sprite num against the level's full sprite list, or
 *  null when the num has no cap. */
export function capStatus(num: number, sprites: readonly { num: number }[]): CapStatus | null {
  const cap = capByNum.get(num)
  if (!cap) return null
  const ids = new Set(cap.ids)
  let count = 0
  for (const s of sprites) if (ids.has(s.num)) count++
  return { cap, count, exceeded: cap.kind === 'placement' && count > cap.max }
}
