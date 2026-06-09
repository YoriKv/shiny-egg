// Guards the committed built-in patch repository (snes-framework/patches/): each
// self-contained `<id>.json` (PatchFile) must parse, its chunk bytes must be valid
// hex, and — when the base build is available — every offset must reverse-look-up
// to an asm label (so build-time drift remap will work). Skips the label check
// when there's no base build. Run:
//   node snes-framework/scripts/patches/builtin-repo.test.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { mergeSymbolMaps, parseWlaSymbolMap, type SymbolMap } from '../engine/symbol-map.ts';
import { remapChunk, storedToChunks } from './apply.ts';
import type { PatchFile } from '../types.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}

const FRAMEWORK_ROOT = path.resolve(import.meta.dirname, '..', '..');
const REPO = path.join(FRAMEWORK_ROOT, 'patches');
const BUILD = path.join(FRAMEWORK_ROOT, 'build');

function loadBaseSym(): SymbolMap | null {
  if (!fs.existsSync(BUILD)) return null;
  const syms = fs.readdirSync(BUILD).filter((f) => f.endsWith('.sym') && !f.includes('V1.1'));
  const main = syms.find((f) => !f.endsWith('-superfx.sym'));
  if (!main) return null;
  let sym = parseWlaSymbolMap(fs.readFileSync(path.join(BUILD, main), 'utf8'));
  const fx = syms.find((f) => f.endsWith('-superfx.sym'));
  if (fx) sym = mergeSymbolMaps(sym, parseWlaSymbolMap(fs.readFileSync(path.join(BUILD, fx), 'utf8')));
  return sym;
}

const sym = loadBaseSym();
const ids = fs.readdirSync(REPO).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
assert(ids.length > 0, 'repository has at least one patch');

for (const id of ids) {
  const pf = JSON.parse(fs.readFileSync(path.join(REPO, `${id}.json`), 'utf8')) as PatchFile;
  assert(pf.id === id, `${id}: id matches filename`);
  assert(pf.source === 'builtin', `${id}: source is builtin`);
  // A patch must do something: binary chunks and/or build-time asm (mirrors the
  // loader in patches.ts — asm-only patches carry `asm`, no `chunks`).
  const hasChunks = Array.isArray(pf.chunks) && pf.chunks.length > 0;
  const hasAsm =
    pf.asm !== undefined && (Array.isArray(pf.asm) ? pf.asm.length > 0 : pf.asm.trim().length > 0);
  assert(hasChunks || hasAsm, `${id}: has chunks or asm`);

  let chunks;
  try {
    chunks = storedToChunks(pf.chunks ?? []); // validates hex
  } catch (e) {
    assert(false, `${id}: chunk bytes are valid hex (${(e as Error).message})`);
    continue;
  }

  if (sym) {
    // Identity remap (ref === build) reproduces the stored offset, and each
    // offset anchors to a real label (so drift remap will track).
    let allAnchored = true;
    let identity = true;
    for (const h of chunks) {
      if (h.offset === undefined) continue; // label-form chunks don't reverse-lookup
      const r = remapChunk(h.offset, sym, sym);
      if (r.resolvedVia !== 'label') allAnchored = false;
      if (r.offset !== h.offset) identity = false;
    }
    assert(allAnchored, `${id}: every offset anchors to an asm label in the base symbols`);
    assert(identity, `${id}: identity remap reproduces the stored offsets`);
  }
}

const skip = sym ? '' : ' (label check skipped — no base build)';
console.log(`${failures === 0 ? '✓' : '✗'} builtin-repo: ${ids.length} patch(es)${skip}, ${failures === 0 ? 'all checks pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
