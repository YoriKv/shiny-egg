// Decode one level by record id and print everything the blueprint parser sees:
// the unpacked header (with field names), decode stats, std/ext object and
// sprite histograms, and the screen-exit list. Replaces the family of one-off
// "dump level 0xNN" scripts (dump-objspr / objhist / hdrs / exits) that each
// hardcoded a level id.
//
//   node snes-framework/scripts/engine/inspect-level.ts 0x1E
//
// Runs against the built V1.0 ROM (engine-side, no native deps — works from
// WSL). For the rendered-pixel view use render-cli.ts / render-snapshot.ts;
// this is the symbolic / structural view.

import { loadDevCart, FRAMEWORK_ROOT } from './dev-cart.ts';
import { loadLevel, recordToTranslevel, loadLevelMapPublic } from '../level.ts';
import { levelNameIndex } from '../level-id.ts';
import { decodeLevelById } from './object-decode/index.ts';
import { hexN as hex, parseHexId } from './cli-util.ts';

// 15 header fields, in order — see header.ts (UnpackLevelHeader / CODE_unpack_level_header).
const HEADER_LABELS = [
  'BG color', 'BG1 tileset', 'BG1 palette', 'BG2 tileset', 'BG2 palette',
  'BG3 tileset', 'BG3 palette', 'sprite tileset', 'sprite palette', 'level mode',
  'animation tileset', 'animation palette', 'BG scroll rate', 'music', 'item memory'
];

const id = parseHexId(process.argv[2], {
  label: 'level record id',
  onError: () => console.error('Usage: inspect-level.ts <levelRecordId>   e.g. inspect-level.ts 0x1E')
});
const { rom, cart, symbols } = loadDevCart();
const map = loadLevelMapPublic(FRAMEWORK_ROOT);
const level = loadLevel({ workRoot: FRAMEWORK_ROOT, levelRecordId: id });

// Context line: record id + name + translevel, so the structural dump is never
// ambiguous about which ID space you're looking at (CLAUDE.md two-ID-spaces).
let name: string | undefined;
try {
  name = levelNameIndex(FRAMEWORK_ROOT, cart, symbols).byRecord.get(id);
} catch {
  /* names are best-effort */
}
const tl = recordToTranslevel(map, id);
console.log(
  `record ${hex(id)}${name ? `  ${name}` : ''}  (translevel ${tl == null ? 'none — sub-room/orphan' : hex(tl)})`
);

if (level.empty || level.special) {
  console.log(level.special ? '  special-cased in the engine — no object stream.' : '  empty slot — no level here.');
  process.exit(0);
}

// ── Header ────────────────────────────────────────────────────────────────
console.log('\nHEADER:');
level.header.forEach((v, i) => {
  console.log(`  [${String(i).padStart(2)}] ${(HEADER_LABELS[i] ?? `field ${i}`).padEnd(18)} ${v} (${hex(v)})`);
});

// ── Decode stats ────────────────────────────────────────────────────────────
const decoded = decodeLevelById({ rom, symbols, workRoot: FRAMEWORK_ROOT, levelRecordId: id });
if (decoded) {
  const s = decoded.stats;
  console.log('\nDECODE:');
  console.log(
    `  ${s.objectsParsed} objects (std ${s.stdObjectsParsed} / ext ${s.extObjectsParsed}), ` +
      `${s.unregisteredObjects} unregistered, ${s.exitsParsed} exits, ${s.bytesConsumed} bytes consumed` +
      `${s.aborted ? '  ⚠ ABORTED' : ''}${s.overflowed ? '  ⚠ OVERFLOWED' : ''}`
  );
}

// ── Object histograms ─────────────────────────────────────────────────────
const std = new Map<number, number>();
const ext = new Map<number, number>();
for (const o of level.objects) {
  if (o.num === 0x00 && o.exnum != null) ext.set(o.exnum, (ext.get(o.exnum) ?? 0) + 1);
  else std.set(o.num, (std.get(o.num) ?? 0) + 1);
}
const histLine = (m: Map<number, number>, w = 2) =>
  [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${hex(k, w)}×${n}`).join('  ') || '(none)';

console.log(`\nSTD objects (${std.size} distinct, ${level.objects.length - [...ext.values()].reduce((a, b) => a + b, 0)} total):`);
console.log(`  ${histLine(std)}`);
console.log(`\nEXT objects (${ext.size} distinct):`);
console.log(`  ${histLine(ext)}`);

// ── Sprites ─────────────────────────────────────────────────────────────────
const spr = new Map<number, number>();
for (const sp of level.sprites) spr.set(sp.num, (spr.get(sp.num) ?? 0) + 1);
console.log(`\nSPRITES (${spr.size} distinct, ${level.sprites.length} total):`);
console.log(`  ${histLine(spr, 3)}`);

// ── Exits ─────────────────────────────────────────────────────────────────
console.log(`\nEXITS (${level.exits.length}):`);
if (level.exits.length === 0) console.log('  (none)');
for (const e of level.exits) {
  if (e.variant === 'warp') {
    console.log(`  screen ${hex(e.screenIndex)} → record ${hex(e.destLevelRecordId)} @ (${e.destX},${e.destY}) entranceType ${hex(e.entranceType)}`);
  } else {
    console.log(`  screen ${hex(e.screenIndex)} → minibattle ${hex(e.minibattleId)} return record ${hex(e.returnLevelRecordId)} @ (${e.returnX},${e.returnY})`);
  }
}

// ── Stream byte budget ──────────────────────────────────────────────────────
const d = level.diag;
console.log(`\nBYTES: header ${d.headerBytes}, objects ${d.objectBytes}, exits ${d.exitBytes}, sprites ${d.spriteBytes}`);
