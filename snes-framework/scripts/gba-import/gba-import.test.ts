// Parity test for the GBA cart importer.
//
// SMA3 (GBA) is a port of YI (SNES) with a near-identical level-data format, so
// a faithfully-ported sublevel should import to (almost) the same LevelData our
// own SNES decoder produces at the same record id. This test:
//
//   1. ROUND-TRIP (hard): every imported sublevel must re-serialize + re-decode
//      to itself — i.e. the importer produces self-consistent shiny-egg data.
//   2. CROSS-VERSION PARITY (hard, aggregate): for ids the SNES cart also backs,
//      compare imported vs native. Object data is byte-identical between the two
//      games, so a healthy fraction must match object-for-object — that both
//      confirms the format mapping AND that GBA sublevel id == SNES record id.
//
// Reference-cart-gated: skips cleanly (exit 0) when the GBA ROM is absent.
// Run: node --experimental-strip-types snes-framework/scripts/gba-import/gba-import.test.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadLevel, loadLevelMapPublic, decodeLevelStreams } from '../level.ts';
import { serializeLevel } from '../serialize-level.ts';
import type { LevelData } from '../types.ts';
import { identifyGbaCart, resolveGbaTables, gbaSublevelToLevelData, GBA_MAX_SUBLEVEL_ID } from './index.ts';

const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CART_PATH = process.env.SMA3_GBA_ROM
  ?? path.resolve(FRAMEWORK_ROOT, '..', '..', "Super Mario Advance 3 - Yoshi's Island (USA).gba");

if (!fs.existsSync(CART_PATH)) {
  console.warn(`gba-import.test: SKIP — GBA cart not found at ${CART_PATH} (set SMA3_GBA_ROM to override).`);
  process.exit(0);
}

let failures = 0;
const fail = (msg: string): void => { console.error(`  FAIL: ${msg}`); failures++; };

const cart = fs.readFileSync(CART_PATH);
const id = identifyGbaCart(cart);
console.log(`Cart: "${id.title}" code=${id.gameCode} crc32=0x${id.crc32.toString(16)}`);
if (!id.ok) { fail(`cart not identified: ${id.reason}`); process.exit(1); }

const map = loadLevelMapPublic(FRAMEWORK_ROOT);
const tables = resolveGbaTables(cart);

// Signature helpers: compact, order-preserving views for equality.
const objSig = (l: LevelData): string =>
  JSON.stringify(l.objects.map((o) => [o.num, o.exnum ?? -1, o.x, o.y, o.w, o.h]));
const sprSig = (l: LevelData): string =>
  JSON.stringify(l.sprites.map((s) => [s.num, s.x, s.y]));
const exitSig = (l: LevelData): string =>
  JSON.stringify(l.exits.map((e) => e.variant === 'warp'
    ? ['w', e.screenIndex, e.destLevelRecordId, e.destX, e.destY, e.entranceType]
    : ['m', e.screenIndex, e.minibattleId, e.returnX, e.returnY, e.returnLevelRecordId]));

// Multiset overlap of two entity signature lists: shared / max(len). Robust to
// reordering AND to SMA3's genuine per-level retouching (which a whole-level
// equality check would punish). 1.0 = the GBA level's entities are a superset/
// equal of the SNES level's (a faithful, complete read).
function overlap(aSigs: string[], bSigs: string[]): number {
  if (aSigs.length === 0 && bSigs.length === 0) return 1;
  const freq = new Map<string, number>();
  for (const s of bSigs) freq.set(s, (freq.get(s) ?? 0) + 1);
  let shared = 0;
  for (const s of aSigs) {
    const n = freq.get(s) ?? 0;
    if (n > 0) { shared++; freq.set(s, n - 1); }
  }
  return shared / Math.max(aSigs.length, bSigs.length);
}
const objSigs = (l: LevelData): string[] => l.objects.map((o) => `${o.num},${o.exnum ?? -1},${o.x},${o.y},${o.w},${o.h}`);
const sprSigs = (l: LevelData): string[] => l.sprites.map((s) => `${s.num},${s.x},${s.y}`);

let imported = 0;
let comparable = 0;
let objOverlapSum = 0;
let sprOverlapSum = 0;
let exitExact = 0;
let lowOverlap = 0; // comparable levels whose object overlap looks like a misread
const samples: string[] = [];

for (let sid = 0; sid <= GBA_MAX_SUBLEVEL_ID; sid++) {
  let res;
  try {
    res = gbaSublevelToLevelData({
      cart,
      sublevelId: sid,
      targetRecordId: sid,
      romVersion: map.romVersion,
      snesHeaderBitWidths: map.headerBitWidths,
      snesStandardObjectInfo: map.standardObjectInfo,
      tables
    });
  } catch {
    continue; // no main stream for this id
  }
  imported++;
  const lvl = res.level;

  // 1. Round-trip (hard): serialize → decode → identical entities. This is the
  //    saveability gate — saveLevelResource refuses to write a level that fails
  //    its own round-trip verify, so this MUST hold for every imported level.
  const ser = serializeLevel({ level: lvl, headerBitWidths: map.headerBitWidths, standardObjectInfo: map.standardObjectInfo });
  const rt = decodeLevelStreams({
    recordId: sid,
    romVersion: map.romVersion,
    headerBitWidths: map.headerBitWidths,
    standardObjectInfo: map.standardObjectInfo,
    objectBytes: ser.objectBytes,
    spriteBytes: ser.spriteBytes
  });
  if (objSig(rt) !== objSig(lvl)) fail(`0x${sid.toString(16)}: object round-trip mismatch`);
  if (sprSig(rt) !== sprSig(lvl)) fail(`0x${sid.toString(16)}: sprite round-trip mismatch`);
  if (exitSig(rt) !== exitSig(lvl)) fail(`0x${sid.toString(16)}: exit round-trip mismatch`);

  // 2. Cross-version overlap vs the native SNES decode at the same id. SMA3 is a
  //    port (objects byte-identical, sprite/exit formats convertible), so a
  //    faithful read overlaps the SNES level heavily — confirming both the format
  //    mapping and that GBA sublevel id == SNES record id. It is NOT expected to
  //    be 1.0: SMA3 retouched entities and adds camera sprites (dropped here).
  let native: LevelData;
  try { native = loadLevel({ workRoot: FRAMEWORK_ROOT, levelRecordId: sid }); } catch { continue; }
  if (native.empty || native.special) continue;
  comparable++;
  const oOv = overlap(objSigs(lvl), objSigs(native));
  const sOv = overlap(sprSigs(lvl), sprSigs(native));
  const e = exitSig(lvl) === exitSig(native);
  objOverlapSum += oOv;
  sprOverlapSum += sOv;
  if (e) exitExact++;
  if (oOv < 0.6) lowOverlap++;
  if (samples.length < 16) {
    samples.push(`  0x${sid.toString(16).padStart(2, '0')}  obj ${lvl.objects.length}/${native.objects.length} ${(oOv * 100).toFixed(0)}%  spr ${lvl.sprites.length}/${native.sprites.length} ${(sOv * 100).toFixed(0)}%  exit ${e ? '✓' : '✗'}`);
  }
}

const objMean = comparable ? objOverlapSum / comparable : 0;
const sprMean = comparable ? sprOverlapSum / comparable : 0;
console.log(`\nImported ${imported} GBA sublevels; ${comparable} comparable to a backed SNES record.`);
console.log('Sample (id  objects gba/snes overlap  sprites overlap  exits):');
console.log(samples.join('\n'));
console.log(`\nMean object overlap: ${(objMean * 100).toFixed(1)}%`);
console.log(`Mean sprite overlap: ${(sprMean * 100).toFixed(1)}%`);
console.log(`Exit whole-level parity: ${exitExact}/${comparable}`);
console.log(`Levels with object overlap < 60% (possible misread): ${lowOverlap}/${comparable}`);

// Faithful-conversion gate. A correct read overlaps the corresponding SNES level
// heavily; a broken format mapping / id correspondence would collapse this.
if (comparable > 0) {
  if (objMean < 0.85) fail(`mean object overlap ${(objMean * 100).toFixed(1)}% < 85% — format mapping or id correspondence is off`);
  if (sprMean < 0.7) fail(`mean sprite overlap ${(sprMean * 100).toFixed(1)}% < 70%`);
  if (exitExact / comparable < 0.6) fail(`exit parity ${exitExact}/${comparable} < 60%`);
}

if (failures) { console.error(`\ngba-import.test: ${failures} failure(s).`); process.exit(1); }
console.log('\ngba-import.test: PASS');
