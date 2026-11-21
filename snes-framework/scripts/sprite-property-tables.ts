// Codec for the per-ID normal-sprite property tables in SuperFX Bank0A.asm —
// the seed words a fresh sprite slot is loaded with before its Init runs
// (docs/spritestateengine.md §4.2; full bit legends in the asm table headers).
// Each table is 442 `dw` rows (sprite $000-$1B9) inside its own
// `;@editable:sprite-*` region. Saves splice only changed words.
//
// These are SPAWN DEFAULTS, not guarantees: Init/Main handlers rewrite the
// slot words at runtime (hundreds of AND/ORA sites), so an edit here can be
// silently overridden by sprite-specific code.
//
// The hitbox shape table (DATA_sprite_hitbox_shapes, 32 × 4 words) is parsed
// read-only: collision bits 0-4 pick one of its entries.

import { applyEdits } from './asm/text-literals.ts';
import { dataWordEdits, findDataWords, findRegionDataWords, type DataWord } from './asm/data-words.ts';
import type { SpriteHitboxShape, SpritePropertiesModel, SpritePropertyTableKey } from './types.ts';

export const SPRITE_PROPERTIES_BANK_FILE = 'yi/SuperFX/Banks/Bank0A.asm';
/** Normal sprites $000-$1B9. */
export const SPRITE_PROPERTY_COUNT = 0x1ba;
export const SPRITE_HITBOX_SHAPE_COUNT = 32;

export interface SpritePropertyTableDef {
  key: SpritePropertyTableKey;
  region: string;
  /** First label of the table (the region's first line). */
  label: string;
  /** Descriptive alias (what the symbol map / docs call it). */
  alias: string;
}

export const SPRITE_PROPERTY_TABLES: readonly SpritePropertyTableDef[] = [
  { key: 'collision', region: 'sprite-collision-flags', label: 'DATA_0A9320', alias: 'DATA_sprite_collision_flags_table' },
  { key: 'terrain', region: 'sprite-terrain-flags', label: 'DATA_0A971E', alias: 'DATA_sprite_terrain_flags_table' },
  { key: 'render', region: 'sprite-render-control', label: 'DATA_0A9B1C', alias: 'DATA_sprite_render_control_table' },
  { key: 'priorityAttr', region: 'sprite-priority-attr', label: 'DATA_0A9F1A', alias: 'DATA_sprite_priority_attr_table' },
  { key: 'gravity', region: 'sprite-gravity', label: 'DATA_0AA318', alias: 'DATA_sprite_gravity_table' },
  { key: 'gfxFile', region: 'sprite-gfx-files', label: 'DATA_0AA716', alias: 'DATA_sprite_gfx_file_table' },
  { key: 'spitGraphic', region: 'sprite-spit-graphics', label: 'DATA_0AAB14', alias: 'DATA_sprite_spit_graphic_table' },
];

export function spritePropertyTableDef(key: SpritePropertyTableKey): SpritePropertyTableDef {
  const def = SPRITE_PROPERTY_TABLES.find((t) => t.key === key);
  if (!def) throw new Error(`Unknown sprite property table: ${key}`);
  return def;
}

function tableWords(text: string, def: SpritePropertyTableDef): DataWord[] {
  const words = findRegionDataWords(text, def.region, def.label);
  if (words.length !== SPRITE_PROPERTY_COUNT) {
    throw new Error(
      `${def.alias} has ${words.length} entries; expected ${SPRITE_PROPERTY_COUNT} (out of date overlay?).`
    );
  }
  return words;
}

/** One table's words from asm text, or null when the file lacks its region (an
 *  overlay saved before the region existed can't hold an edit to it). */
export function spritePropertyTableFromAsm(text: string, key: SpritePropertyTableKey): number[] | null {
  const def = spritePropertyTableDef(key);
  if (!text.includes(`;@editable:${def.region} begin`)) return null;
  return tableWords(text, def).map((w) => w.value);
}

const signed16 = (v: number): number => (v & 0x8000 ? v - 0x10000 : v);

export function parseHitboxShapes(text: string): SpriteHitboxShape[] {
  // Without region bounds the run continues into DATA_0A9320; take the first 128 words.
  const words = findDataWords(text, 'DATA_sprite_hitbox_shapes').slice(0, SPRITE_HITBOX_SHAPE_COUNT * 4);
  if (words.length !== SPRITE_HITBOX_SHAPE_COUNT * 4) throw new Error('DATA_sprite_hitbox_shapes is truncated.');
  const out: SpriteHitboxShape[] = [];
  for (let i = 0; i < SPRITE_HITBOX_SHAPE_COUNT; i++) {
    const [cx, cy, hw, hh] = words.slice(i * 4, i * 4 + 4).map((w) => signed16(w.value));
    out.push({ cx: cx!, cy: cy!, hw: hw!, hh: hh! });
  }
  return out;
}

/** Parse all seven tables + the hitbox shapes from Bank0A asm text. */
export function parseSpriteProperties(text: string): SpritePropertiesModel {
  const tables = {} as Record<SpritePropertyTableKey, number[]>;
  for (const def of SPRITE_PROPERTY_TABLES) tables[def.key] = tableWords(text, def).map((w) => w.value);
  return { tables, hitboxShapes: parseHitboxShapes(text) };
}

/** One table's cart bytes (little-endian words). Throws on a malformed model. */
export function spritePropertyTableBytes(model: SpritePropertiesModel, key: SpritePropertyTableKey): Uint8Array {
  const words = model?.tables?.[key];
  if (!Array.isArray(words) || words.length !== SPRITE_PROPERTY_COUNT) {
    throw new RangeError(`Sprite property table ${key}: expected ${SPRITE_PROPERTY_COUNT} words.`);
  }
  const out = new Uint8Array(SPRITE_PROPERTY_COUNT * 2);
  words.forEach((w, i) => {
    if (!Number.isInteger(w) || w < 0 || w > 0xffff) {
      throw new RangeError(`Sprite property table ${key}, sprite ${i}: ${w} is not a 16-bit word.`);
    }
    out[i * 2] = w & 0xff;
    out[i * 2 + 1] = w >>> 8;
  });
  return out;
}

export type SerializeSpritePropertiesResult = { ok: true; text: string } | { ok: false; error: string };

/** Validate and splice every table into Bank0A asm text (changed words only). */
export function serializeSpriteProperties(text: string, model: SpritePropertiesModel): SerializeSpritePropertiesResult {
  try {
    const edits = [];
    for (const def of SPRITE_PROPERTY_TABLES) {
      spritePropertyTableBytes(model, def.key); // validates
      const words = tableWords(text, def);
      const changes = new Map<number, number>();
      model.tables[def.key].forEach((v, i) => changes.set(i * 2, v));
      edits.push(...dataWordEdits(words, changes));
    }
    return { ok: true, text: applyEdits(text, edits) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
