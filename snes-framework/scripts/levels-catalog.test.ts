// Smoke test for levels-catalog.ts. Runs against the bundled framework copy
// (`snes-framework/`) and asserts invariants on the resulting catalog — IDs,
// group counts, prefix stripping, slot-shape overrides. Catches regressions
// if `Bank51.asm` or the slot-shape table drift apart.
//
// Run: node --experimental-strip-types snes-framework/scripts/levels-catalog.test.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { vendoredV10SymbolMap } from './engine/symbol-map.ts';
import { buildLevelsCatalog, loadFontMap, parseLevelNamesFromCart } from './levels-catalog.ts';
import { levelIdHexKey } from './level.ts';
import { CATALOG_IDS, SLOT_SHAPE, WORLD_ORDER } from './levels-slot-shape.ts';
import type { LevelCatalogEntry } from './types.ts';

const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Cart bytes: prefer the built V1.0 ROM (byte-identical to the reference cart
// for V1.0), fall back to the reference cart path documented in CLAUDE.md.
function loadCart(): Buffer {
  const candidates = [
    path.join(frameworkRoot, 'build', "Super Mario World 2 - Yoshi's Island (USA V1.0).sfc"),
    '/mnt/d/Dev/SNES/YI_USA1.sfc',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return fs.readFileSync(c);
  throw new Error(
    `levels-catalog.test: no V1.0 cart found. Looked in:\n  ${candidates.join('\n  ')}\n` +
    `Build the framework or place a reference cart at one of the above paths.`
  );
}
const cart = loadCart();
const symbols = vendoredV10SymbolMap();
const fontMap = loadFontMap(frameworkRoot);

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

const hex = (id: number): string => `0x${id.toString(16).padStart(2, '0').toUpperCase()}`;

// ── parseLevelNamesFromCart ───────────────────────────────────────────────

console.log('=== parseLevelNamesFromCart ===');
const names = parseLevelNamesFromCart(cart, symbols, fontMap);
assert(names.size > 0, `expected at least one cart-derived name, got ${names.size}`);

// Spot-check known names (full string including the cart's slot prefix).
const KNOWN_CART_NAMES = new Map<number, string>([
  [0x00, '1 - 1: Make Eggs, Throw Eggs'],
  [0x03, "1 - 4: Burt The Bashful's Fort"],
  [0x07, "1 - 8: Salvo The Slime's Castle"],
  [0x08, "Extra 1: Poochy Ain't Stupid"],
  [0x30, '5 - 1: BLIZZARD!!!'],
]);
for (const [id, expected] of KNOWN_CART_NAMES) {
  const got = names.get(id) ?? '';
  assert(got === expected, `${hex(id)}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
}

console.log(`  ✓ parsed ${names.size} cart-derived names`);

// ── buildLevelsCatalog ────────────────────────────────────────────────────

console.log('\n=== buildLevelsCatalog ===');
// Walk the gm$0C indirection so the catalog uses data-record indices for
// `id` (and preserves the translevel ID as a side field). Matches what
// extract.ts does at runtime.
const f3e7PC = symbols.pc('YI_LevelDataPtrsAndEntranceData_DATA_level_entrance_indexes');
const f471PC = symbols.pc('YI_LevelDataPtrsAndEntranceData_DATA_map_level_entrances');
const f471Size =
  symbols.pc('YI_LevelDataPtrsAndEntranceData_DATA_map_level_midway_entrances') - f471PC;
const translevelToRecord: Record<string, number | null> = {};
for (let id = 0; id < 72; id++) {
  const entOff = cart[f3e7PC + id * 2] | (cart[f3e7PC + id * 2 + 1] << 8);
  // null for no-entrance sentinel (0) or an out-of-table garbage index.
  // Hex-keyed to match level-map.json on disc + what buildLevelsCatalog expects.
  translevelToRecord[levelIdHexKey(id)] =
    (entOff === 0 && id !== 0) || entOff >= f471Size ? null : cart[f471PC + entOff];
}
const catalog = buildLevelsCatalog(frameworkRoot, cart, symbols, translevelToRecord);
const entries = catalog.groups.flatMap((g) => g.levels);
const byTranslevelId = new Map<number, LevelCatalogEntry>(
  entries.filter((e) => e.translevelId !== undefined).map((e) => [e.translevelId!, e])
);

assert(
  catalog.groups.length === WORLD_ORDER.length,
  `expected ${WORLD_ORDER.length} groups, got ${catalog.groups.length}`
);
assert(
  entries.length === CATALOG_IDS.length,
  `expected ${CATALOG_IDS.length} catalog entries, got ${entries.length}`
);
for (const id of CATALOG_IDS) {
  assert(
    byTranslevelId.has(id),
    `catalog missing slot-shape translevel ID ${hex(id)}`
  );
}

// Cart-derived name has its slot prefix stripped in the catalog.
const burt = byTranslevelId.get(0x03);
assert(
  burt?.name === "Burt The Bashful's Fort",
  `${hex(0x03)} expected prefix-stripped name "Burt The Bashful's Fort", got ${JSON.stringify(burt?.name)}`
);

// SlotShape.nameOverride wins over the cart string (Prologue + bonus games).
for (const [idStr, shape] of Object.entries(SLOT_SHAPE)) {
  if (!shape.nameOverride) continue;
  const id = Number(idStr);
  const entry = byTranslevelId.get(id);
  assert(
    entry?.name === shape.nameOverride,
    `${hex(id)} expected nameOverride ${JSON.stringify(shape.nameOverride)}, got ${JSON.stringify(entry?.name)}`
  );
}

// Each group's translevel IDs are sorted ascending — matches world-map flow.
for (const g of catalog.groups) {
  for (let i = 1; i < g.levels.length; i++) {
    const prev = g.levels[i - 1].translevelId ?? g.levels[i - 1].recordId ?? 0;
    const cur = g.levels[i].translevelId ?? g.levels[i].recordId ?? 0;
    assert(
      cur > prev,
      `${g.label}: translevel IDs not strictly increasing at index ${i}`
    );
  }
}

// Data-record `id`s must be UNIQUE across the catalog — a collision means two
// levels resolve to the same `.bin` (the historical 0x15 Scratch-And-Match vs
// Prince-Froggy and 0x17 Slot-Machine vs 3-6 bugs). Null ids (bonus / mini-game
// / intro slots with no data record) are exempt.
const seenIds = new Map<number, string>();
for (const g of catalog.groups) {
  for (const l of g.levels) {
    if (l.recordId === null) continue;
    const prevName = seenIds.get(l.recordId);
    assert(
      prevName === undefined,
      `duplicate data-record id ${hex(l.recordId)}: "${prevName}" and "${l.name}"`
    );
    seenIds.set(l.recordId, l.name);
  }
}

// Each group's entry count matches the number of SLOT_SHAPE rows tagged with
// that world — guards against silent drops when SLOT_SHAPE/WORLD_ORDER drift.
const expectedPerGroup = new Map<string, number>(WORLD_ORDER.map((w) => [w, 0]));
for (const shape of Object.values(SLOT_SHAPE)) {
  expectedPerGroup.set(shape.world, (expectedPerGroup.get(shape.world) ?? 0) + 1);
}
for (const g of catalog.groups) {
  assert(
    g.levels.length === expectedPerGroup.get(g.label),
    `${g.label}: expected ${expectedPerGroup.get(g.label)} entries, got ${g.levels.length}`
  );
}

console.log(`  ✓ catalog has ${entries.length} entries across ${catalog.groups.length} groups`);

// ── Result ────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll levels-catalog tests passed.');
