// Cart-derived levels catalog. Source of truth: the level-name-string pointer
// table at `DATA_level_name_string_ptrs` ($51:49BC) in
// `snes-framework/yi/SuperFX/Banks/Bank51.asm` (72 entries indexed by
// translevel ID 0x00..0x47). Each pointer is a bank-local 16-bit value into
// bank $51; the target bytes encode an on-screen name printed at level
// entry. The placeholder `DATA_level_name_garbage_sentinel` ($51:532F)
// marks unused slots.
//
// We read the table + strings directly from the cart via SymbolMap-resolved
// addresses, not by parsing asm text — the runtime byte format is fixed by
// the print routine in `FXCODE_09E92F`, so it's stable across asm refactors
// (descriptive label aliases, comment changes, etc. don't affect it).
//
// Per-name strings use YI's font-tile encoding (not raw ASCII): each
// printable byte is a glyph index into the level-intro font. We invert the
// asm's `table "Tables/Fonts/Main.txt"` mapping (loaded once at catalog-
// build time) to recover the ASCII source.
//
// Joined with the static `SLOT_SHAPE` table (world + slot label per ID), this
// produces the catalog the editor dropdown consumes.
//
// Bonus-tile entries have placeholder cart strings, supplied via
// `SlotShape.nameOverride` instead.

import * as fs from 'node:fs';
import * as path from 'node:path';

import { snesToPC, type SymbolMap } from './engine/symbol-map.ts';
import { u16le } from './engine/rom-read.ts';
import { levelIdHexKey } from './level.ts';
import { SLOT_SHAPE, WORLD_ORDER, type SlotShape } from './levels-slot-shape.ts';
import type {
  LevelCatalogEntry,
  LevelCatalogGroup,
  LevelsCatalog,
} from './types.ts';
export type { LevelCatalogEntry, LevelCatalogGroup, LevelsCatalog } from './types.ts';

/** Number of `dw` entries in the pointer table — one per translevel ID 0..0x47. */
const POINTER_COUNT = 72;

/** Bank where both the pointer table and target name strings live. */
const NAME_STRING_BANK = 0x51;

/** Match a cart-name leading slot prefix: "1 - 1: ", "Extra 1: ", etc. */
export const SLOT_PREFIX_RE = /^(?:\d\s*-\s*\d|Extra\s*\d)\s*:\s*/;

/** Upper bound on bytes scanned per name string — guards against malformed data. */
const MAX_NAME_BYTES = 128;

/** Path (relative to workRoot) to the asar font table the strings are encoded with. */
const FONT_TABLE_REL_PATH = path.join('yi', 'Tables', 'Fonts', 'Main.txt');

type FontMap = Map<number, string>;

/**
 * Reads the cart bytes for the `DATA_level_name_string_ptrs` pointer table + each target
 * name string, resolving `{ translevelId → name }`. Skips placeholder slots.
 *
 * Both the pointer-table address and the placeholder offset come from the
 * SymbolMap, so this survives any asm relocation of bank $51.
 */
export function parseLevelNamesFromCart(
  cart: Buffer,
  symbols: SymbolMap,
  fontMap: FontMap
): Map<number, string> {
  const tablePC = symbols.pc('DATA_level_name_string_ptrs');
  // Pointer values in the table are bank-local 16-bit offsets into bank $51,
  // so to detect placeholders we compare against the low 16 bits of the
  // resolved placeholder PC.
  const placeholderPtr = symbols.pc('DATA_level_name_garbage_sentinel') & 0xffff;

  const byId = new Map<number, string>();
  for (let id = 0; id < POINTER_COUNT; id++) {
    const ptr = u16le(cart, tablePC + id * 2);
    if (ptr === placeholderPtr) continue;
    const namePC = snesToPC((NAME_STRING_BANK << 16) | ptr);
    const name = decodeLevelNameString(cart, namePC, fontMap);
    if (name) byId.set(id, name);
  }
  return byId;
}

/**
 * Decode a single level-name string starting at `cart[start]`. The on-disk
 * format is a small command stream consumed by `FXCODE_09E92F`:
 *   $FF <line-config-byte>            — start of line 1, then glyph bytes
 *   $FE <line-config-byte> <00>       — line 2, then glyph bytes
 *   $FD                               — terminator
 * Glyph bytes are font-table indexes — we map them back to ASCII via
 * `fontMap`. Unknown bytes are dropped (the placeholder/garbage string
 * is never decoded here because we filter it before calling).
 */
function decodeLevelNameString(
  cart: Buffer,
  start: number,
  fontMap: FontMap
): string {
  const chars: string[] = [];
  let i = start;
  const end = Math.min(cart.length, start + MAX_NAME_BYTES);
  while (i < end) {
    const b = cart[i++];
    if (b === 0xfd) break;
    if (b === 0xff) {
      i += 1;
      continue;
    }
    if (b === 0xfe) {
      i += 2;
      chars.push(' '); // line break — normalises away with the padding
      continue;
    }
    const ch = fontMap.get(b);
    if (ch) chars.push(ch);
  }
  return chars.join('').replace(/\s+/g, ' ').trim();
}

export interface ForeignLevelName {
  /** Decoded name lines (split at each `$FE` line break). */
  lines: string[];
  /** True only when the bytes are a structurally valid name: they start with the
   *  `$FF` line-1 marker, reach the `$FD` terminator within bounds, and every
   *  glyph byte is a known font char. A slot the hack abandoned holds clobbered
   *  bytes that fail this — the importer skips those rather than import garbage
   *  (e.g. GoldenEgg leaves `fc 21 …` where a real name starts `ff 00 …`). */
  wellFormed: boolean;
}

/**
 * Read a foreign cart's level-name table line-by-line, with a well-formedness
 * gate — the importer counterpart to {@link parseLevelNamesFromCart}. Unlike that
 * function it preserves the line structure (the asm string model needs matching
 * line counts) and flags garbage. Keyed by translevel slot.
 */
export function readForeignLevelNames(
  cart: Buffer,
  symbols: SymbolMap,
  fontMap: FontMap
): Map<number, ForeignLevelName> {
  const tablePC = symbols.pc('DATA_level_name_string_ptrs');
  const placeholderPtr = symbols.pc('DATA_level_name_garbage_sentinel') & 0xffff;
  const out = new Map<number, ForeignLevelName>();
  for (let id = 0; id < POINTER_COUNT; id++) {
    const ptr = u16le(cart, tablePC + id * 2);
    if (ptr === placeholderPtr) continue; // unused slot — no name
    const namePC = snesToPC((NAME_STRING_BANK << 16) | ptr);
    out.set(id, decodeNameLines(cart, namePC, fontMap));
  }
  return out;
}

/** Line-preserving + validating variant of {@link decodeLevelNameString}. */
function decodeNameLines(cart: Buffer, start: number, fontMap: FontMap): ForeignLevelName {
  // A valid name begins with the $FF line-1 marker; anything else is clobbered.
  if (start < 0 || start >= cart.length || cart[start] !== 0xff) {
    return { lines: [], wellFormed: false };
  }
  const lines: string[] = [];
  let cur: string[] = [];
  let i = start;
  const end = Math.min(cart.length, start + MAX_NAME_BYTES);
  let terminated = false;
  let badGlyph = false;
  while (i < end) {
    const b = cart[i++];
    if (b === 0xfd) {
      terminated = true;
      break;
    }
    if (b === 0xff) {
      i += 1; // line-1 start + config byte
      continue;
    }
    if (b === 0xfe) {
      lines.push(cur.join(''));
      cur = [];
      i += 2; // line-2 start (2 config bytes)
      continue;
    }
    const ch = fontMap.get(b);
    if (ch) cur.push(ch);
    else badGlyph = true; // unknown glyph → not a real name
  }
  lines.push(cur.join(''));
  // Preserve the exact decoded text (incl. the centering spaces a hack bakes in)
  // so the import reproduces the hack's names faithfully; only drop a trailing
  // space run (field padding before the terminator), which never carries meaning.
  return {
    lines: lines.map((l) => l.replace(/\s+$/, '')),
    wellFormed: terminated && !badGlyph
  };
}

/**
 * Loads `yi/Tables/Fonts/Main.txt` into a byte → char map. The file is
 * asar's character-table format: one entry per line, `<char>=<HH>`, where
 * `<char>` is a single ASCII character and `<HH>` is its 2-digit hex code.
 */
export function loadFontMap(workRoot: string): FontMap {
  const tblPath = path.join(workRoot, FONT_TABLE_REL_PATH);
  const text = fs.readFileSync(tblPath, 'utf8');
  const map: FontMap = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    // Format: `<char>=<HH>` — the char is everything before the *last* `=`.
    // We require exactly 2 trailing hex chars after the last `=` to keep
    // parsing trivially predictable and to round-trip the `==36` entry
    // (the `=` glyph itself).
    if (line.length < 4 || line.charAt(line.length - 3) !== '=') continue;
    const ch = line.slice(0, line.length - 3);
    const hex = line.slice(-2);
    if (ch.length !== 1) continue;
    const byte = parseInt(hex, 16);
    if (Number.isNaN(byte)) continue;
    map.set(byte, ch);
  }
  return map;
}

/**
 * Builds the renderer-facing catalog by joining cart-derived names with the
 * static slot-shape table.
 *
 * `SLOT_SHAPE` is keyed by **translevel ID** (cart name table $51:49BC is
 * indexed that way). Each catalog entry's `id` is the **data-record index**
 * (= cart Ptrs $17:F7C3 index) — translevel IDs are folded through the
 * hex-keyed `translevelToRecord` indirection map (keys are `0xNN` strings, to
 * match level-map.json on disc — see the ID convention in CLAUDE.md). For slots
 * without a main-world
 * entrance (bonus games, intro slots), the indirection returns null and we
 * fall back to using the translevel ID as the record index (which matches
 * what bonus-game-load paths use — they bypass gm$0C's indirection).
 *
 * The translevel ID is preserved on each entry so the BizHawk Test Level
 * button can inject the cart's natural world-map flow.
 */
export function buildLevelsCatalog(
  workRoot: string,
  cart: Buffer,
  symbols: SymbolMap,
  translevelToRecord: Record<string, number | null>
): LevelsCatalog {
  const fontMap = loadFontMap(workRoot);
  const cartNames = parseLevelNamesFromCart(cart, symbols, fontMap);
  const groups = new Map<string, LevelCatalogEntry[]>();
  for (const world of WORLD_ORDER) groups.set(world, []);

  for (const [idStr, shape] of Object.entries(SLOT_SHAPE) as [string, SlotShape][]) {
    const translevelId = Number(idStr);
    const cartName = cartNames.get(translevelId);
    const cartTrimmed = cartName ? cartName.replace(SLOT_PREFIX_RE, '').trim() : undefined;
    const name = shape.nameOverride ?? cartTrimmed ?? shape.slot;
    const group = groups.get(shape.world);
    if (!group) continue; // SLOT_SHAPE world that isn't in WORLD_ORDER — ignore.
    // `null` (no data record) for slots not reachable via gm$0C — bonus games /
    // intro slots. `translevelToRecord` already maps these to null (it bounds
    // the entrance index, so stray garbage like World 6's "Slot Machine" reads
    // null, not record 0x17). These used to take an identity fallback
    // (`id = translevelId`) that collided with real record indices — Scratch And
    // Match's translevel 0x15 vs Prince Froggy's record 0x15. See types.ts.
    const id = translevelToRecord[levelIdHexKey(translevelId)] ?? null;
    group.push({ recordId: id, translevelId, name, world: shape.world, slot: shape.slot });
  }

  // Stable order within each group by translevel ID (matches the world-map
  // flow). Sort by translevelId, not id, so groups stay in world-map order
  // even when record indices are non-monotonic.
  for (const list of groups.values()) {
    list.sort((a, b) => (a.translevelId ?? a.recordId ?? 0) - (b.translevelId ?? b.recordId ?? 0));
  }
  return {
    groups: WORLD_ORDER.map((label) => ({ label, levels: groups.get(label) ?? [] })),
  };
}
