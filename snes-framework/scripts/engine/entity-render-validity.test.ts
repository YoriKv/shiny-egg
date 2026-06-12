// Pins for the object render-validity probe (entity-render-validity.ts).
//
// The pins encode what the full-matrix run established empirically
// (research/object-render-validity.tsv — every std/ext object × every shipped
// gfx-header tuple), NOT the pre-run plan guesses (water pipes / jungle canopy
// turned out to probe ok under every tileset — the per-tileset template slots
// supply valid anchors everywhere; only tile-animation-dependent objects are
// restricted):
//   - std $35 Animated water: ok under a level that ships it; INVALID under
//     every shipped BG1-tileset-2 pairing (its tiles need the matching
//     animationTileset fill — ts2 column is 'bad' in the matrix).
//   - std $08 steep slope: 'cond/part' family — at least one ts2 pairing
//     leaves it degraded (some blocks animation-filled, some missing).
//   - std $01 Ledge: ok under both of the above tuples (the 439/502 common
//     case).
//   - ext $FF Tile eraser + std $4F Sand block remover: no-visual command
//     objects (stamp nothing) — never filtered out.
//   - levelMode $09 (Raphael arena) ⇒ probe.mode7 (PPU mode 7, no normal BG1).
//   - loadSpritesetFileIds == the gfx manifest's dp-slot 7..12 file ids (the
//     sprite-side check's input).
//
// Run: node snes-framework/scripts/engine/entity-render-validity.test.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadDevCart, FRAMEWORK_ROOT } from './dev-cart.ts';
import { loadLevel, loadLevelMapPublic, isWorld6RecordDeep } from '../level.ts';
import { createValidityProbe, type ValidityProbe } from './entity-render-validity.ts';
import { loadLevelGfx, loadSpritesetFileIds, type GfxFileEntry } from './load-graphics.ts';
import { hex0x } from '../hex.ts';
import type { LevelData } from '../types.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ ${msg}`); failures++; }
}

let cart;
try { cart = loadDevCart(FRAMEWORK_ROOT); } catch (e) {
  console.error((e as Error).message);
  process.exit(2);
}
const { rom, symbols } = cart;

// Metadata default sizes (the size the picker probes at).
const meta = JSON.parse(
  fs.readFileSync(
    path.join(FRAMEWORK_ROOT, '..', 'src', 'renderer', 'src', 'data', 'obj-metadata.json'),
    'utf8'
  )
) as {
  standardObjects: Record<string, { defaultWidth: number; defaultHeight: number }>;
  extendedObjects: Record<string, { defaultWidth: number; defaultHeight: number }>;
};
function sizeOf(kind: 'std' | 'ext', id: number): { w: number; h: number } {
  const group = kind === 'std' ? meta.standardObjects : meta.extendedObjects;
  const info = group[hex0x(id, 2)];
  return { w: info?.defaultWidth ?? 1, h: info?.defaultHeight ?? 1 };
}

// All backed, probe-able levels.
const map = loadLevelMapPublic(FRAMEWORK_ROOT);
const levels: LevelData[] = [];
for (const [key, entry] of Object.entries(map.levels)) {
  if (!entry || !(entry as { objectFile: string | null }).objectFile) continue;
  const recordId = parseInt(key, 16);
  if (Number.isNaN(recordId)) continue;
  let level: LevelData;
  try {
    level = loadLevel({ workRoot: FRAMEWORK_ROOT, levelRecordId: recordId });
  } catch {
    continue;
  }
  if (level.empty || level.special || level.header.length < 15) continue;
  levels.push(level);
}
assert(levels.length > 100, `backed levels enumerated (${levels.length})`);

const probes = new Map<number, ValidityProbe>();
function probeFor(level: LevelData): ValidityProbe {
  let p = probes.get(level.recordId);
  if (!p) {
    p = createValidityProbe({
      rom, symbols, workRoot: FRAMEWORK_ROOT, donor: level,
      isWorld6: isWorld6RecordDeep(FRAMEWORK_ROOT, level.recordId)
    });
    probes.set(level.recordId, p);
  }
  return p;
}
function probe(level: LevelData, kind: 'std' | 'ext', id: number): string {
  const { w, h } = sizeOf(kind, id);
  return probeFor(level).probe(kind, id, w, h);
}

// ── $35 animated water: ok under its own level, invalid under ts2 ───────────
const waterHost = levels.find((l) => l.objects.some((o) => o.num === 0x35));
assert(waterHost !== undefined, 'a shipped level places std $35 (animated water)');
if (waterHost) {
  assert(
    probe(waterHost, 'std', 0x35) === 'ok',
    `std $35 ok under its own level ${hex0x(waterHost.recordId)} (anim tileset pairing present)`
  );
}

const ts2Hosts = levels.filter(
  (l) => (l.header[1] ?? 0) === 2 && !isWorld6RecordDeep(FRAMEWORK_ROOT, l.recordId)
);
assert(ts2Hosts.length > 0, `non-w6 BG1-tileset-2 levels exist (${ts2Hosts.length})`);
for (const host of ts2Hosts) {
  const v = probe(host, 'std', 0x35);
  assert(
    v === 'invalid',
    `std $35 invalid under ts2 level ${hex0x(host.recordId)} (matrix ts2='bad'), got ${v}`
  );
}

// ── $08 steep slope under ts2: X-escalated to invalid ───────────────────────
// Pre-X-model this was 'degraded' (matrix ts2='part'); the missing blocks
// include X-placeholder slots, so the corrected model escalates — a lone
// placement shows X glyphs in-game.
assert(
  ts2Hosts.some((host) => probe(host, 'std', 0x08) === 'invalid'),
  'std $08 invalid under ≥1 ts2 pairing (X-escalated; was degraded pre-X-model)'
);

// ── $01 Ledge: ok where its sheet is complete, invalid where decorative
//    variants hit X slots (ts2 is one of those sheets) ──────────────────────
if (waterHost) {
  assert(probe(waterHost, 'std', 0x01) === 'ok', `std $01 Ledge ok under level ${hex0x(waterHost.recordId)}`);
}
if (ts2Hosts[0]) {
  const v = probe(ts2Hosts[0], 'std', 0x01);
  assert(
    v === 'invalid',
    `std $01 Ledge invalid under ts2 level ${hex0x(ts2Hosts[0].recordId)} (decorative variants hit X slots), got ${v}`
  );
}

// ── command objects stamp nothing ⇒ no-visual ───────────────────────────────
if (ts2Hosts[0]) {
  assert(probe(ts2Hosts[0], 'ext', 0xff) === 'no-visual', 'ext $FF Tile eraser ⇒ no-visual');
  assert(probe(ts2Hosts[0], 'std', 0x4f) === 'no-visual', 'std $4F Sand block remover ⇒ no-visual');
}

// ── X-placeholder theme lock (the level-0x06 report, 2026-06-11) ────────────
// Tileset 9's sheets lack the mud-ledge / ceiling / flower-garden art — their
// blocks hit slots holding the cart's X-placeholder filler, so they'd show X
// glyphs in-game. ANY X block ⇒ invalid. 0x70 Plants is the counter-case:
// level 0x06 itself ships it, and it probes clean.
const l06 = levels.find((l) => l.recordId === 0x06);
assert(l06 !== undefined, 'level 0x06 (Touch Fuzzy, ts9) is backed');
if (l06) {
  for (const id of [0x21, 0x24, 0x58, 0xe4]) {
    const v = probe(l06, 'std', id);
    assert(v === 'invalid', `std ${hex0x(id, 2)} invalid under level 0x06 (X-placeholder blocks), got ${v}`);
  }
  assert(probe(l06, 'std', 0x70) === 'ok', 'std $70 Plants ok under level 0x06 (ships there)');
  assert(probe(l06, 'std', 0x01) === 'ok', 'std $01 Ledge ok under level 0x06');
}
// The one retail exception: level $33 ships $9D whose block $7901 IS an X tile
// in-game — the probe must call it invalid (validity-report pins it expected).
const l33 = levels.find((l) => l.recordId === 0x33);
assert(l33 !== undefined, 'level 0x33 is backed');
if (l33) {
  const v = probe(l33, 'std', 0x9d);
  assert(v === 'invalid', `std $9D invalid under level 0x33 (the retail X-tile exception), got ${v}`);
}

// ── mode-7 arena detection (levelMode $09) ──────────────────────────────────
const mode7Host = levels.find((l) => (l.header[9] ?? 0) === 0x09);
assert(mode7Host !== undefined, 'a backed levelMode-$09 (Raphael arena) level exists');
if (mode7Host) {
  assert(probeFor(mode7Host).mode7, `probe.mode7 set for level ${hex0x(mode7Host.recordId)}`);
}
if (waterHost) assert(!probeFor(waterHost).mode7, 'probe.mode7 clear for a normal level');

// ── spriteset file ids match the gfx manifest's dp-slots 7..12 ──────────────
if (waterHost) {
  const h = waterHost.header;
  const manifest: GfxFileEntry[] = [];
  loadLevelGfx(
    rom, symbols,
    {
      bg1Tileset: h[1] ?? 0, bg2Tileset: h[3] ?? 0, bg3Tileset: h[5] ?? 0,
      spriteTileset: h[7] ?? 0,
      isWorld6: isWorld6RecordDeep(FRAMEWORK_ROOT, waterHost.recordId)
    },
    new Uint8Array(0x10000), manifest
  );
  const ids = loadSpritesetFileIds(rom, symbols, h[7] ?? 0);
  assert(ids.length === 6, 'loadSpritesetFileIds returns 6 ids');
  const spriteEntries = manifest.filter((e) => e.dpSlot !== undefined && e.dpSlot >= 7);
  assert(spriteEntries.length > 0, 'manifest carries sprite-region (dp 7..12) entries');
  assert(
    spriteEntries.every((e) => ids[e.dpSlot! - 7] === e.fileId),
    'each dp-slot 7..12 manifest entry matches loadSpritesetFileIds'
  );
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll entity-render-validity pins passed.');
