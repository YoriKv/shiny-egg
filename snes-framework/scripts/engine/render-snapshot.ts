// In-development render-regression tool. NOT a committed golden test — a
// one-off "snapshot before a change, check after" workflow:
//
//   node snes-framework/scripts/engine/render-snapshot.ts snapshot 0x10
//   ...make your change (object-decode handler, render fn, palette math, ...)...
//   node snes-framework/scripts/engine/render-snapshot.ts check 0x10
//
// `check` re-renders the same level and reports, per output, PASS (identical to
// the snapshot) or CHANGED — so you can see whether an edit moved the rendered
// pixels. Snapshots live in tmp/render-snapshots/ (gitignored); `snapshot`
// overwrites. Pass `--all` to snapshot/check every backed level at once
// (per-level files, so a later single-level `check 0xNN` still works) — this is
// the all-levels decode/render regression sweep.
//
// Outputs hashed: the decode buffer (Map16 IDs + page map — catches
// object-decode/parser changes), and the bg1 / bg2 / bg3 / sprite / collision
// RGBA layers.
// It renders the BASE level (no project overlay), so it's independent of any
// edited project. Runs against snes-framework/build/<V1.0>.sfc + .sym.
//
// The gfx/header/band orchestration lives in render-level-layers.ts (shared with
// render-cli's `level` mode); this tool just hashes the layers it returns.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { type SymbolMap } from './symbol-map.ts';
import { loadDevCart, FRAMEWORK_ROOT } from './dev-cart.ts';
import { loadLevel, loadLevelMapPublic } from '../level.ts';
import { renderLevelLayers } from './render-level-layers.ts';
import type { LevelData } from '../types.ts';
import { hex } from '../hex.ts';
import { hexN, parseHexId } from './cli-util.ts';

const SNAPSHOT_DIR = path.join(FRAMEWORK_ROOT, '..', 'tmp', 'render-snapshots');

/** Built V1.0 ROM + merged symbol map (shared loader). Exits 2 if the build
 *  artifacts are missing — this dev tool always renders the V1.0 build. */
function loadRomAndSymbols(): { rom: Uint8Array; symbols: SymbolMap } {
  try {
    const { rom, symbols } = loadDevCart(FRAMEWORK_ROOT);
    return { rom, symbols };
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
}

function sha(...parts: Array<ArrayLike<number>>): string {
  const hash = crypto.createHash('sha256');
  for (const p of parts) hash.update(Buffer.from(p as Uint8Array));
  return hash.digest('hex').slice(0, 16);
}

/** Render a level's high-signal outputs and return a hash per output. Returns
 *  null for empty / special / short-header slots (nothing to render). */
function renderLevelHashes(
  rom: Uint8Array,
  symbols: SymbolMap,
  level: LevelData
): Record<string, string> | null {
  const r = renderLevelLayers(rom, symbols, FRAMEWORK_ROOT, level);
  if (!r) return null;
  return {
    decode: sha(r.decode.levelDataBuffer, r.decode.screenPageMap),
    bg1: sha(r.bg1.rgba),
    bg2: sha(r.bg2.rgba),
    bg3: sha(r.bg3.rgba),
    sprite: r.sprite ? sha(r.sprite.rgba) : 'none',
    collision: sha(r.collision.rgba)
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseId(s: string): number {
  return parseHexId(s, { label: 'level record id' });
}

function snapPath(id: number): string {
  return path.join(SNAPSHOT_DIR, `${hex(id, 2)}.json`);
}

const idHexOf = (n: number) => hexN(n);

const [, , mode, idArg] = process.argv;
const all = process.argv.includes('--all');
if (mode !== 'snapshot' && mode !== 'check') {
  console.error('Usage: render-snapshot.ts <snapshot|check> <levelRecordId | --all>');
  console.error('  e.g. render-snapshot.ts snapshot 0x10');
  console.error('       render-snapshot.ts check --all');
  process.exit(2);
}
if (!all && (!idArg || idArg.startsWith('--'))) {
  console.error('Missing <levelRecordId> (or pass --all).');
  process.exit(2);
}

const { rom, symbols } = loadRomAndSymbols();

/** Render + hash one level's outputs, or null for empty/special/unbacked. */
function hashesFor(id: number): Record<string, string> | null {
  const level = loadLevel({ workRoot: FRAMEWORK_ROOT, levelRecordId: id });
  return renderLevelHashes(rom, symbols, level);
}

function writeSnapshot(id: number, hashes: Record<string, string>): void {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  fs.writeFileSync(snapPath(id), JSON.stringify({ level: idHexOf(id), hashes }, null, 2));
}

/** Compare current hashes to the stored snapshot. Returns the number of changed
 *  outputs, or -1 if no snapshot exists. Logs per-output PASS/CHANGED when
 *  `log` is set (single-level detail view). */
function diffSnapshot(id: number, hashes: Record<string, string>, log: boolean): number {
  const file = snapPath(id);
  if (!fs.existsSync(file)) return -1;
  const prev = JSON.parse(fs.readFileSync(file, 'utf8')).hashes as Record<string, string>;
  let changed = 0;
  for (const k of Object.keys(hashes)) {
    const same = prev[k] === hashes[k];
    if (!same) changed++;
    if (log) {
      console.log(`  ${same ? '✓ PASS   ' : '✗ CHANGED'} ${k.padEnd(10)} ${same ? hashes[k] : `${prev[k]} → ${hashes[k]}`}`);
    }
  }
  return changed;
}

if (all) {
  // Every backed level (objectFile present), in id order.
  const map = loadLevelMapPublic(FRAMEWORK_ROOT);
  const ids = Object.entries(map.levels)
    .filter(([, e]) => e.objectFile)
    .map(([k]) => Number(k))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  if (mode === 'snapshot') {
    let n = 0;
    for (const id of ids) {
      const hashes = hashesFor(id);
      if (!hashes) continue;
      writeSnapshot(id, hashes);
      n++;
    }
    console.log(`Snapshot --all: ${n} levels → ${path.relative(process.cwd(), SNAPSHOT_DIR)}`);
  } else {
    let checked = 0;
    let changedLevels = 0;
    let missing = 0;
    for (const id of ids) {
      const hashes = hashesFor(id);
      if (!hashes) continue;
      const changed = diffSnapshot(id, hashes, false);
      if (changed === -1) {
        console.log(`  ? NO SNAPSHOT ${idHexOf(id)}`);
        missing++;
        continue;
      }
      checked++;
      if (changed > 0) {
        changedLevels++;
        console.log(`  ✗ ${idHexOf(id)}: ${changed} output(s) changed — run \`check ${idHexOf(id)}\` for detail`);
      }
    }
    console.log(
      `\nchecked ${checked} levels → ${changedLevels} changed` +
        (missing ? `, ${missing} without a snapshot (run \`snapshot --all\` first)` : '') +
        (changedLevels === 0 ? '  ✓ all match' : '')
    );
    process.exit(changedLevels === 0 ? 0 : 1);
  }
} else {
  const id = parseId(idArg!);
  const idHex = idHexOf(id);
  const hashes = hashesFor(id);
  if (!hashes) {
    console.error(`Level ${idHex} is empty/special/unbacked — nothing to render.`);
    process.exit(2);
  }

  if (mode === 'snapshot') {
    writeSnapshot(id, hashes);
    console.log(`Snapshot ${idHex} written → ${path.relative(process.cwd(), snapPath(id))}`);
    for (const [k, v] of Object.entries(hashes)) console.log(`  ${k.padEnd(10)} ${v}`);
  } else {
    if (!fs.existsSync(snapPath(id))) {
      console.error(`No snapshot for ${idHex} — run \`snapshot ${idArg}\` first.`);
      process.exit(2);
    }
    console.log(`check ${idHex} (vs snapshot):`);
    const changed = diffSnapshot(id, hashes, true);
    console.log(changed === 0 ? `\nUnchanged — your edit did not affect ${idHex}'s render.` : `\n${changed} output(s) CHANGED for ${idHex}.`);
    process.exit(changed === 0 ? 0 : 1);
  }
}
