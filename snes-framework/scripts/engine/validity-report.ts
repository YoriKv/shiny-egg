// Shipped-cart render-validity gate — the entity-render-validity counterpart
// to validate-neighbor-deps. Shipped levels are correct by construction, so
// every PLACED std/ext object and sprite must render under its own level's
// header:
//   objects — probe verdict `ok` / `no-visual` (probed alone at metadata
//             default size, the exact check the editor's picker runs);
//   sprites — `ok` / `not-gated` via the spriteset set-inclusion (the same
//             resolveSpriteValidity the editor uses).
// Any `invalid` / `degraded` / `missing-gfx` here is a probe-model or
// metadata gap, not a real cart bug — fix it before trusting the picker
// filter. `unknown` verdicts (unported handler / `spritesetFiles: null`) are
// tallied and listed but don't fail: there is nothing to verify.
//
// Like the neighbour gate, this catches TOO-STRICT verdicts only (a shipped
// placement wrongly flagged); too-loose ones need unit pins
// (entity-render-validity.test.ts).
//
// Sprite checks gate REACHABLE levels only (world-map records + warp BFS).
// Orphan records (no world-map slot, no incoming warp — e.g. 0xDC) aren't
// correct-by-construction: 0xDC is a leftover room whose spriteset genuinely
// lacks files its sprites need, so its mismatches are reported as info, not
// failures (the editor's red badge there is plausibly truthful). The first
// full gate run (2026-06-11) also drove an empirical metadata refinement —
// tmp/refine-spriteset-files.ts dropped `spritesetFiles` ids absent from a
// reachable shipped host's spriteset (Yoshi Block $098 / Snifit $113 → [],
// Falling Rocks $138/$13A → [0x20,0x21]): a file a correct shipped placement
// lacks cannot be a hard requirement (art is global or duplicated across
// files; the conjunction-only schema can't express the disjunction).
//
//   node snes-framework/scripts/engine/validity-report.ts            # summary
//   node snes-framework/scripts/engine/validity-report.ts --verbose  # per-level
//
// Exits 1 on any failure. Engine-side, no native deps — runs from WSL against
// the built V1.0 ROM.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadDevCart, FRAMEWORK_ROOT } from './dev-cart.ts';
import { loadLevel, loadLevelMapPublic, isWorld6RecordDeep } from '../level.ts';
import { createValidityProbe, type ValidityProbe } from './entity-render-validity.ts';
import { loadSpritesetFileIds } from './load-graphics.ts';
import { effectiveBg1Tilesets } from './bg1-regions.ts';
import { resolveSpriteValidity } from '../../../src/renderer/src/lib/sprite-render-validity.ts';
import { objectThemeVerdict } from '../../../src/renderer/src/lib/theme-validity.ts';
import { objectAnimVerdict } from '../../../src/renderer/src/lib/anim-validity.ts';
import { hex0x } from '../hex.ts';
import type { LevelData, ObjectRenderVerdict } from '../types.ts';

const VERBOSE = process.argv.includes('--verbose');

const meta = JSON.parse(
  fs.readFileSync(
    path.join(FRAMEWORK_ROOT, '..', 'src', 'renderer', 'src', 'data', 'obj-metadata.json'),
    'utf8'
  )
) as {
  standardObjects: Record<string, { name?: string; defaultWidth: number; defaultHeight: number; bg1Tilesets?: string[] | null; animTilesets?: string[] | null }>;
  extendedObjects: Record<string, { name?: string; defaultWidth: number; defaultHeight: number; bg1Tilesets?: string[] | null; animTilesets?: string[] | null }>;
  sprites: Record<string, { name?: string; spritesetFiles?: string[] | null }>;
};
function objInfo(
  kind: 'std' | 'ext',
  id: number
): { name?: string; defaultWidth: number; defaultHeight: number; bg1Tilesets?: string[] | null; animTilesets?: string[] | null } | undefined {
  return (kind === 'std' ? meta.standardObjects : meta.extendedObjects)[hex0x(id, 2)];
}

const { rom, symbols } = loadDevCart();
const map = loadLevelMapPublic(FRAMEWORK_ROOT) as unknown as {
  levels: Record<string, { objectFile: string | null }>;
  translevelToRecord: Record<string, number>;
};

// All backed levels, pre-loaded once.
const levels = new Map<number, LevelData>();
for (const [k, e] of Object.entries(map.levels)) {
  if (!e || !e.objectFile) continue;
  const id = parseInt(k, 16);
  if (Number.isNaN(id)) continue;
  try {
    const l = loadLevel({ workRoot: FRAMEWORK_ROOT, levelRecordId: id });
    if (!l.empty && !l.special && l.header.length >= 15) levels.set(id, l);
  } catch { /* unloadable slot */ }
}
const ids = [...levels.keys()].sort((a, b) => a - b);

// Reachable = world-map records + BFS over warp screen-exits (the sprite
// gate's evidence boundary — see the header).
const reachable = new Set<number>();
const queue = [...new Set(Object.values(map.translevelToRecord))];
while (queue.length) {
  const id = queue.pop()!;
  if (reachable.has(id)) continue;
  reachable.add(id);
  const l = levels.get(id);
  if (!l) continue;
  for (const ex of l.exits) {
    if (ex.variant === 'warp') queue.push(ex.destLevelRecordId);
  }
}

// One probe per distinct gfx-header tuple (the matrix prototype's dedup —
// ~200 tuples over ~220 backed levels), each memoising per object id.
const tupleProbes = new Map<string, ValidityProbe>();
function probeFor(level: LevelData, isW6: boolean): ValidityProbe {
  const h = level.header;
  const key = [h[1], h[3], h[5], h[7], h[9], h[10], isW6 ? 1 : 0].join(',');
  let p = tupleProbes.get(key);
  if (!p) {
    p = createValidityProbe({ rom, symbols, workRoot: FRAMEWORK_ROOT, donor: level, isWorld6: isW6 });
    tupleProbes.set(key, p);
  }
  return p;
}

// Pinned exceptions to "shipped placements probe renderable":
//   - $9D@$33: its block $7901 IS the X-placeholder tile in-game (verified by
//     the in-situ full-level X scan, 2026-06-11 — the only X block across all
//     219 shipped decodes).
//   - The Baby Bowser room ("Kamek's room", record $6B, mode $0A) scenery:
//     their Map16 entries read the $F000+ global-sprite-sheet region, which
//     the fight's gfx engine streams over at runtime (Bank0D BowserRoomKamek
//     family). Statically wrong under EVERY tileset ⇒ `bg1Tilesets: []`
//     (never theme-allowed) — so their own shipped placements probe invalid
//     by design, pinned here.
//   - The final-boss room (record $DD, ext $19/$1A "Destroyed Bowser's room")
//     set-pieces: their layout includes one X-placeholder block ($9D68) under
//     0xDD's own header, so the X-coverage probe escalates to invalid even
//     though the room renders correctly (BG1 byte-exact vs the live cart — see
//     bank12-ext-finalboss-setpiece.ts). Same truthful-but-benign category as
//     $9D@$33: a single shipped X-tile inside an otherwise-valid placement.
const EXPECTED_INVALID = new Set([
  '0x33:std:0x9D',
  '0x6B:std:0xF6',
  '0x6B:ext:0x0D',
  '0x6B:ext:0x0E',
  '0x6B:ext:0x1E',
  '0x6B:ext:0x1F',
  '0xDD:ext:0x19',
  '0xDD:ext:0x1A'
]);

interface Failure {
  level: number;
  what: string;
  verdict: string;
}
const failures: Failure[] = [];
const unknowns: Failure[] = [];
const orphanInfo: Failure[] = [];
const expectedSeen = new Set<string>();
const objectTally = new Map<ObjectRenderVerdict, number>();
const spriteTally = new Map<string, number>();
let levelsChecked = 0;
let objectPlacements = 0;
let spritePlacements = 0;
let mode7Levels = 0;

for (const id of ids) {
  // Record 0x38 — the gm38 intro-cutscene backdrop — isn't a normal playable
  // level: its objects don't probe valid under gm0C render rules (the cutscene
  // engine owns the scene in-game), and the shipping cart is like that. Skip
  // it from the correct-by-construction gate (same spirit as the orphan-info
  // sprite rule below).
  if (id === 0x38) continue;
  const level = levels.get(id)!;
  levelsChecked++;
  const isW6 = isWorld6RecordDeep(FRAMEWORK_ROOT, id);
  const probe = probeFor(level, isW6);
  if (probe.mode7) mode7Levels++;
  // The level's EFFECTIVE tilesets: header[1] plus every Graphic-Changer
  // band's target — mirrors the picker's any-band theme rule (level 0x58's
  // rail corners are valid only inside its ts15 changer band).
  const effectiveTs = [...effectiveBg1Tilesets(level.sprites, {
    bg1Tileset: level.header[1] ?? 0,
    bg1Palette: level.header[2] ?? 0
  })];

  // Objects — one verdict per distinct (kind, id) in this level.
  const seen = new Set<string>();
  for (const o of level.objects) {
    objectPlacements++;
    const kind: 'std' | 'ext' = o.num === 0 && o.exnum !== undefined ? 'ext' : 'std';
    const objId = kind === 'ext' ? o.exnum! : o.num;
    const dedup = `${kind}:${objId}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);
    const info = objInfo(kind, objId);
    let v = probe.probe(kind, objId, info?.defaultWidth ?? 1, info?.defaultHeight ?? 1);
    // The theme gate the editor hook layers on top of the probe — placed
    // objects must be theme-allowed under SOME effective tileset of their own
    // level (zero failures by construction: band-resolved shipped tilesets
    // feed the field). Theme-UNKNOWN (bg1Tilesets null) maps to the editor's
    // amber verdict — info, not a failure (and shipped objects are never null
    // by construction anyway).
    if (v === 'ok' || v === 'degraded') {
      const tv = objectThemeVerdict(info?.bg1Tilesets, effectiveTs);
      if (tv === 'locked') v = 'invalid';
      else if (tv === 'unknown') v = 'unknown';
      // The animation-tileset gate the editor hook also layers on: the
      // header[10]-animated objects ($08/$09/$35/$47/$DC) pass coverage under
      // any animation but only render right under their own (anim-validity.ts).
      // Zero failures by construction — the field is the shipped header[10] set.
      else if (objectAnimVerdict(info?.animTilesets, level.header[10] ?? 0) === 'locked') v = 'invalid';
    }
    objectTally.set(v, (objectTally.get(v) ?? 0) + 1);
    const what = `${kind} ${hex0x(objId, 2)} ${info?.name ?? '?'}`;
    const pinKey = `${hex0x(id)}:${kind}:${hex0x(objId, 2)}`;
    if (v === 'invalid' || v === 'degraded') {
      if (EXPECTED_INVALID.has(pinKey)) expectedSeen.add(pinKey);
      else failures.push({ level: id, what, verdict: v });
    } else if (v === 'unknown') {
      unknowns.push({ level: id, what, verdict: v });
    } else if (EXPECTED_INVALID.has(pinKey)) {
      // Pin drift: the known cart exception stopped probing invalid — a model
      // change silently loosened the X detection. Fail loud, like a met-count
      // pin in validate-neighbor-deps.
      failures.push({ level: id, what: `${what} (expected invalid, got ${v})`, verdict: v });
    }
  }

  // Sprites — set inclusion against the level's 6 variable spriteset files.
  const levelFiles = new Set(loadSpritesetFileIds(rom, symbols, level.header[7] ?? 0));
  const seenSprites = new Set<number>();
  for (const s of level.sprites) {
    spritePlacements++;
    if (seenSprites.has(s.num)) continue;
    seenSprites.add(s.num);
    const stored = meta.sprites[hex0x(s.num, 3)];
    const { verdict, missingFiles } = resolveSpriteValidity(stored?.spritesetFiles, levelFiles);
    spriteTally.set(verdict, (spriteTally.get(verdict) ?? 0) + 1);
    const what = `sprite ${hex0x(s.num, 3)} ${stored?.name ?? '?'}`;
    if (verdict === 'missing-gfx') {
      // Orphan levels aren't correct-by-construction — their genuine spriteset
      // mismatches are informational, not gate failures (see header).
      (reachable.has(id) ? failures : orphanInfo).push({
        level: id,
        what: `${what} (missing ${missingFiles.map((f) => hex0x(f, 2)).join(',')})`,
        verdict
      });
    } else if (verdict === 'unknown') {
      unknowns.push({ level: id, what, verdict });
    }
  }

  if (VERBOSE) console.log(`level ${hex0x(id)}: ${seen.size} object ids, ${seenSprites.size} sprite nums`);
}

// ── report ──────────────────────────────────────────────────────────────────
console.log(
  `levels checked: ${levelsChecked} (${mode7Levels} mode-7, ` +
    `${ids.filter((i) => !reachable.has(i)).length} orphan), distinct gfx tuples: ${tupleProbes.size}`
);
console.log(`object placements: ${objectPlacements}, sprite placements: ${spritePlacements}`);
console.log(
  'object verdicts (per distinct id per level):',
  Object.fromEntries([...objectTally.entries()].sort())
);
console.log(
  'sprite verdicts (per distinct num per level):',
  Object.fromEntries([...spriteTally.entries()].sort())
);

if (unknowns.length) {
  console.log(`\n${unknowns.length} unknown verdict(s) — nothing to verify, not a failure:`);
  for (const u of unknowns) console.log(`  level ${hex0x(u.level)}  ${u.what}`);
}

if (orphanInfo.length) {
  console.log(`\n${orphanInfo.length} orphan-level sprite mismatch(es) — info only (level unreachable in play):`);
  for (const o of orphanInfo) console.log(`  level ${hex0x(o.level)}  ${o.what}`);
}

if (expectedSeen.size) {
  console.log(`\n${expectedSeen.size} pinned cart exception(s) probed invalid as expected: ${[...expectedSeen].join(', ')}`);
}

if (failures.length) {
  console.error(`\n✗ ${failures.length} FAILURE(S) — shipped placements that don't probe renderable:`);
  for (const f of failures) console.error(`  level ${hex0x(f.level)}  ${f.what} → ${f.verdict}`);
  process.exit(1);
}
console.log('\n✓ every shipped placed object/sprite probes renderable under its own level header.');
