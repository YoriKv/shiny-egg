// world-map-paths.ts pins — the asm-region edit for the Bank17 Yoshi path tables
// (per-world dot positions + per-level walk checkpoints, inline `dw`).
// Load-bearing checks: the asm parse reproduces the CART's table words exactly
// (else a write targets the wrong coordinate), a no-change save round-trips
// byte-for-byte, a single-point edit touches exactly its two words, and the
// migration read/apply pair round-trips — including on a MARKER-LESS overlay
// (the pre-migration shape), where the label-scan fallback must not bleed into
// the next contiguous `dw` tables (DATA_17BA81 / DATA_17BE6E).
//
// Run: node snes-framework/scripts/world-map-paths.test.ts

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadDevCart, FRAMEWORK_ROOT } from './engine/dev-cart.ts';
import {
  parseWorldMapPaths,
  serializeWorldMapPaths,
  readWorldMapPathsEdits,
  applyWorldMapPathsEdits,
  WORLD_MAP_PATHS_FILE,
  WORLD_MAP_YOSHI_DOTS_LABEL,
  WORLD_MAP_WALK_PATHS_LABEL,
  PATH_WORLDS,
  PATH_DOTS_PER_WORLD,
  PATH_LEVELS_PER_WORLD,
  PATH_CHECKPOINTS_PER_LEVEL
} from './world-map-paths.ts';

let failures = 0;
const assert = (c: boolean, m: string): void => { if (c) console.log(`  ✓ ${m}`); else { console.error(`  ✗ ${m}`); failures++; } };

const baseText = readFileSync(path.join(FRAMEWORK_ROOT, WORLD_MAP_PATHS_FILE), 'utf8');
const model = parseWorldMapPaths(baseText);

assert(model.dots.length === PATH_WORLDS && model.dots.every((w) => w.length === PATH_DOTS_PER_WORLD),
  `dots parse to ${PATH_WORLDS}×${PATH_DOTS_PER_WORLD}`);
assert(
  model.checkpoints.length === PATH_WORLDS &&
    model.checkpoints.every((w) => w.length === PATH_LEVELS_PER_WORLD && w.every((l) => l.length === PATH_CHECKPOINTS_PER_LEVEL)),
  `checkpoints parse to ${PATH_WORLDS}×${PATH_LEVELS_PER_WORLD}×${PATH_CHECKPOINTS_PER_LEVEL}`
);
// Known vanilla anchors (patheditor.asm reference): W1 dot 1 = ($0030,$009C);
// 1-2's first checkpoint = ($0070,$00A0).
assert(model.dots[0]![0]!.x === 0x30 && model.dots[0]![0]!.y === 0x9c, 'W1 dot 1 parses to ($0030,$009C)');
assert(model.checkpoints[0]![1]![0]!.x === 0x70 && model.checkpoints[0]![1]![0]!.y === 0xa0, '1-2 checkpoint 0 parses to ($0070,$00A0)');

// The parse MUST match the cart word-for-word (the write's correctness rests on it).
try {
  const { rom, symbols } = loadDevCart(FRAMEWORK_ROOT);
  const wordAt = (pc: number, i: number): number => rom[pc + i * 2]! | (rom[pc + i * 2 + 1]! << 8);
  const dotsPc = symbols.pc(WORLD_MAP_YOSHI_DOTS_LABEL);
  let exact = true;
  for (let w = 0; w < PATH_WORLDS && exact; w++) {
    for (let d = 0; d < PATH_DOTS_PER_WORLD; d++) {
      const i = w * PATH_DOTS_PER_WORLD + d;
      const p = model.dots[w]![d]!;
      if (p.x !== wordAt(dotsPc, i) || p.y !== wordAt(dotsPc, PATH_WORLDS * PATH_DOTS_PER_WORLD + i)) { exact = false; break; }
    }
  }
  assert(exact, 'asm parse reproduces the cart Yoshi-dot words exactly');
  const walkPc = symbols.pc(WORLD_MAP_WALK_PATHS_LABEL);
  const walkAxis = PATH_WORLDS * PATH_LEVELS_PER_WORLD * PATH_CHECKPOINTS_PER_LEVEL;
  exact = true;
  for (let w = 0; w < PATH_WORLDS && exact; w++) {
    for (let l = 0; l < PATH_LEVELS_PER_WORLD && exact; l++) {
      for (let k = 0; k < PATH_CHECKPOINTS_PER_LEVEL; k++) {
        const i = (w * PATH_LEVELS_PER_WORLD + l) * PATH_CHECKPOINTS_PER_LEVEL + k;
        const p = model.checkpoints[w]![l]![k]!;
        if (p.x !== wordAt(walkPc, i) || p.y !== wordAt(walkPc, walkAxis + i)) { exact = false; break; }
      }
    }
  }
  assert(exact, 'asm parse reproduces the cart walk-checkpoint words exactly');
} catch {
  console.log('  (cart unavailable — skipped the cart-vs-asm checks)');
}

// No-change save is byte-identical (format-preserving identity).
const noChange = serializeWorldMapPaths(baseText, model);
assert(noChange.ok && noChange.text === baseText, 'no-change save round-trips byte-for-byte');

const clone = (): ReturnType<typeof parseWorldMapPaths> => structuredClone(model);
const fileDiffBytes = (a: string, b: string): number => {
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) n++;
  return n + Math.abs(a.length - b.length);
};

// A single dot edit touches exactly its two words' hex digits and reads back.
{
  const edited = clone();
  edited.dots[2]![4] = { x: 0x123, y: 0x8b };
  const res = serializeWorldMapPaths(baseText, edited);
  assert(res.ok, 'single-dot edit serializes ok');
  if (res.ok) {
    const re = parseWorldMapPaths(res.text);
    assert(re.dots[2]![4]!.x === 0x123 && re.dots[2]![4]!.y === 0x8b, 'edited dot reads back');
    assert(JSON.stringify(re.checkpoints) === JSON.stringify(model.checkpoints), 'checkpoints untouched by a dot edit');
    // W3 dot 5 base = ($0118,$00A4) → both words change, 4 hex digits differ per word at most.
    assert(res.text.length === baseText.length && fileDiffBytes(res.text, baseText) <= 8, 'only the two words\' hex digits differ');
  }
}

// A single checkpoint edit reads back and leaves everything else intact.
{
  const edited = clone();
  edited.checkpoints[0]![6]![3] = { x: 0x1a0, y: 0x90 }; // 1-7's unused 4th slot
  const res = serializeWorldMapPaths(baseText, edited);
  assert(res.ok, 'single-checkpoint edit serializes ok');
  if (res.ok) {
    const re = parseWorldMapPaths(res.text);
    assert(re.checkpoints[0]![6]![3]!.x === 0x1a0 && re.checkpoints[0]![6]![3]!.y === 0x90, 'edited checkpoint reads back');
    assert(JSON.stringify(re.dots) === JSON.stringify(model.dots), 'dots untouched by a checkpoint edit');
  }
}

// Out-of-range values are rejected (only on a CHANGED word).
{
  const bad = clone();
  bad.dots[0]![0] = { x: 0x10000, y: model.dots[0]![0]!.y };
  assert(!serializeWorldMapPaths(baseText, bad).ok, 'out-of-range word (0x10000) is rejected');
}

// Migration read/apply round-trip — WITH markers, and MARKER-LESS (the
// pre-migration overlay shape the rebuild reads).
{
  const edited = clone();
  edited.dots[5]![7] = { x: 0x1c0, y: 0xb0 };
  edited.checkpoints[3]![0]![1] = { x: 0x58, y: 0x9c };
  const res = serializeWorldMapPaths(baseText, edited);
  assert(res.ok, 'migration fixture serializes ok');
  if (res.ok) {
    const edits = readWorldMapPathsEdits(baseText, res.text);
    assert(edits.length === 4, `edit set has the 4 changed words (got ${edits.length})`);
    assert(applyWorldMapPathsEdits(baseText, edits) === res.text, 'apply(base, read(overlay)) reproduces the overlay');

    const markerless = res.text.split('\n').filter((l) => !l.includes(';@editable:world-map-yoshi')).join('\n');
    const fallbackEdits = readWorldMapPathsEdits(baseText, markerless);
    assert(
      JSON.stringify(fallbackEdits) === JSON.stringify(edits),
      'marker-less overlay reads back the same edit set (label-scan fallback, no bleed into the next tables)'
    );
  }
}

console.log(failures === 0 ? '\nAll world-map-paths tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
