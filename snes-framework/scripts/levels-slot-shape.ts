// Static slot-shape table: translevel ID → {world, slot}. Names come from the
// cart at extract time (levels-catalog.ts); this file only supplies the world
// grouping + slot label for each ID, since the cart strings don't reliably
// carry that shape (bonus minigames have placeholder names; intros / extras
// inconsistent).

export interface SlotShape {
  /** Group label as displayed in the level dropdown header. */
  world: string;
  /** Slot label as displayed next to the level name. */
  slot: string;
  /** Optional override for the display name. Takes precedence over the
   *  cart-derived name. Use for slots where Bank51's name table is a
   *  placeholder (bonus minigames) or absent (Prologue), and for editorial
   *  corrections of cart strings the parser couldn't clean up. */
  nameOverride?: string;
}

export const SLOT_SHAPE: Record<number, SlotShape> = {
  // Special
  128: { world: 'Special', slot: 'Intro', nameOverride: 'Prologue' },

  // World 1
  0x00: { world: 'World 1', slot: '1-1' },
  0x01: { world: 'World 1', slot: '1-2' },
  0x02: { world: 'World 1', slot: '1-3' },
  0x03: { world: 'World 1', slot: '1-4' },
  0x04: { world: 'World 1', slot: '1-5' },
  0x05: { world: 'World 1', slot: '1-6' },
  0x06: { world: 'World 1', slot: '1-7' },
  0x07: { world: 'World 1', slot: '1-8' },
  0x08: { world: 'World 1', slot: 'Extra' },
  0x09: { world: 'World 1', slot: 'Bonus', nameOverride: 'Flip Cards' },

  // World 2
  0x0B: { world: 'World 2', slot: 'Intro' },
  0x0C: { world: 'World 2', slot: '2-1' },
  0x0D: { world: 'World 2', slot: '2-2' },
  0x0E: { world: 'World 2', slot: '2-3' },
  0x0F: { world: 'World 2', slot: '2-4' },
  0x10: { world: 'World 2', slot: '2-5' },
  0x11: { world: 'World 2', slot: '2-6' },
  0x12: { world: 'World 2', slot: '2-7' },
  0x13: { world: 'World 2', slot: '2-8' },
  0x14: { world: 'World 2', slot: 'Extra' },
  0x15: { world: 'World 2', slot: 'Bonus', nameOverride: 'Scratch And Match' },

  // World 3
  0x18: { world: 'World 3', slot: '3-1' },
  0x19: { world: 'World 3', slot: '3-2' },
  0x1A: { world: 'World 3', slot: '3-3' },
  0x1B: { world: 'World 3', slot: '3-4' },
  0x1C: { world: 'World 3', slot: '3-5' },
  0x1D: { world: 'World 3', slot: '3-6' },
  0x1E: { world: 'World 3', slot: '3-7' },
  0x1F: { world: 'World 3', slot: '3-8' },
  0x20: { world: 'World 3', slot: 'Extra' },
  0x21: { world: 'World 3', slot: 'Bonus', nameOverride: 'Drawing Lots' },

  // World 4
  0x24: { world: 'World 4', slot: '4-1' },
  0x25: { world: 'World 4', slot: '4-2' },
  0x26: { world: 'World 4', slot: '4-3' },
  0x27: { world: 'World 4', slot: '4-4' },
  0x28: { world: 'World 4', slot: '4-5' },
  0x29: { world: 'World 4', slot: '4-6' },
  0x2A: { world: 'World 4', slot: '4-7' },
  0x2B: { world: 'World 4', slot: '4-8' },
  0x2C: { world: 'World 4', slot: 'Extra' },
  0x2D: { world: 'World 4', slot: 'Bonus', nameOverride: 'Match Cards' },

  // World 5
  0x30: { world: 'World 5', slot: '5-1' },
  0x31: { world: 'World 5', slot: '5-2' },
  0x32: { world: 'World 5', slot: '5-3' },
  0x33: { world: 'World 5', slot: '5-4' },
  0x34: { world: 'World 5', slot: '5-5' },
  0x35: { world: 'World 5', slot: '5-6' },
  0x36: { world: 'World 5', slot: '5-7' },
  0x37: { world: 'World 5', slot: '5-8' },
  0x38: { world: 'World 5', slot: 'Extra' },
  0x39: { world: 'World 5', slot: 'Bonus', nameOverride: 'Roulette' },

  // World 6
  0x3C: { world: 'World 6', slot: '6-1' },
  0x3D: { world: 'World 6', slot: '6-2' },
  0x3E: { world: 'World 6', slot: '6-3' },
  0x3F: { world: 'World 6', slot: '6-4' },
  0x40: { world: 'World 6', slot: '6-5' },
  0x41: { world: 'World 6', slot: '6-6' },
  0x42: { world: 'World 6', slot: '6-7' },
  0x43: { world: 'World 6', slot: '6-8' },
  0x44: { world: 'World 6', slot: 'Extra' },
  0x45: { world: 'World 6', slot: 'Bonus', nameOverride: 'Slot Machine' },
};

/** Ordered list of group labels in the order the dropdown displays them. */
export const WORLD_ORDER: readonly string[] = [
  'Special',
  'World 1',
  'World 2',
  'World 3',
  'World 4',
  'World 5',
  'World 6',
];

/** Every translevel ID that has a designated slot in the dropdown. */
export const CATALOG_IDS: readonly number[] = Object.keys(SLOT_SHAPE)
  .map((s) => Number(s))
  .sort((a, b) => a - b);
