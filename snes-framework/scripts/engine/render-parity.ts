// Shared render-parity hashing: the single source of truth for "hash a level's
// rendered output" used by BOTH the ad-hoc render-snapshot dev tool AND the
// committed Vitest regression test (render-parity.vitest.test.ts).
//
// Why hashes, not pixels: the rendered RGBA for all 219 levels is megabytes of
// copyrighted game data — we don't store it in git. A SHA-256 prefix per layer
// is a few bytes and detects any pixel change just as well. The committed
// goldens (render-parity.golden.json) were locked in after the decode parity was
// verified byte-exact against the live cart (219/219 — see
// research/notes-bg1-trace-rng-parity.md); the test re-renders the V1.0 build and
// fails if any layer's hash drifts from that verified-correct baseline.
//
// Determinism: renderLevelLayers is a pure function of the ROM bytes (the cart
// PRNG default is deterministic without a captured sequence), and the V1.0 build
// is byte-identical to the reference cart, so these hashes are stable and
// machine-independent. Regenerate the goldens only when an asm/build change
// legitimately alters the render (see render-parity.golden.json's header).

import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { loadDevCart, FRAMEWORK_ROOT, type DevCart } from './dev-cart.ts';
import { loadLevel, loadLevelMapPublic } from '../level.ts';
import { renderLevelLayers } from './render-level-layers.ts';
import type { SymbolMap } from './symbol-map.ts';
import type { LevelData } from '../types.ts';

export { FRAMEWORK_ROOT };

/** Committed golden-checksum file (sibling of this module). */
export const GOLDEN_PATH = path.join(import.meta.dirname, 'render-parity.golden.json');

/** The full golden-file shape (what GOLDEN_PATH (de)serialises to). The golden
 *  stores only the PINNED layers (sprite excluded — see PINNED_LAYERS). */
export interface GoldenFile {
  _comment: string;
  build: string;
  levelCount: number;
  hashes: Record<string, PinnedHashes>;
}

/** The hashed outputs per level (a 16-hex-char SHA-256 prefix each). */
export interface LevelHashes {
  /** Map16 IDs + page map — catches object-decode / parser changes. */
  decode: string;
  bg1: string;
  /** BG2/BG3 background planes (priority-0 tiles). */
  bg2: string;
  bg3: string;
  /** BG2/BG3 FOREGROUND planes (priority-1 tiles, above BG1). `'none'` when the
   *  layer has no foreground tiles — locks in "no foreground here" so a
   *  regression that adds/changes one is caught (see the priority-split work). */
  bg2Front: string;
  bg3Front: string;
  /** BG3 MID plane (priority-1 water band, in front of BG2 / behind BG1) on BG3
   *  screen-designation levels; `'none'` otherwise. */
  bg3Mid: string;
  /** `'none'` when the sprite renderer declines for the level. */
  sprite: string;
  collision: string;
}

// Layers the committed regression golden PINS. The sprite layer is deliberately
// EXCLUDED: it's mid-rework — its bake input (sprite-render-facts.json) is an
// uncommitted, actively-changing file, so the sprite render output is a moving
// target and pinning it would fail the test on every sprite iteration (its own
// sprite-tile-base.test.ts is the regression for that layer). What this golden
// locks in is the decode-parity result verified byte-exact vs the live cart
// (219/219) — i.e. the BG1 decode+render work — plus bg2/bg3/collision, which
// are stable. Add 'sprite' here once the sprite work lands and stabilises.
export const PINNED_LAYERS = ['decode', 'bg1', 'bg2', 'bg3', 'bg2Front', 'bg3Front', 'bg3Mid', 'collision'] as const;

/** A level's pinned-layer hashes (LevelHashes minus the volatile sprite layer). */
export type PinnedHashes = Pick<LevelHashes, (typeof PINNED_LAYERS)[number]>;

/** Project full per-level hashes down to the pinned layers (drops sprite). */
export function pinnedHashes(h: LevelHashes): PinnedHashes {
  return {
    decode: h.decode, bg1: h.bg1, bg2: h.bg2, bg3: h.bg3,
    bg2Front: h.bg2Front, bg3Front: h.bg3Front, bg3Mid: h.bg3Mid, collision: h.collision
  };
}

/** SHA-256 over the concatenated byte arrays, truncated to 16 hex chars. */
export function sha(...parts: Array<ArrayLike<number>>): string {
  const hash = crypto.createHash('sha256');
  for (const p of parts) hash.update(Buffer.from(p as Uint8Array));
  return hash.digest('hex').slice(0, 16);
}

/** Render a level's high-signal outputs and hash each. Returns null for
 *  empty / special / short-header slots (nothing to render — e.g. record 0x38,
 *  the gm38 intro-cutscene backdrop). */
export function renderLevelHashes(
  rom: Uint8Array,
  symbols: SymbolMap,
  level: LevelData
): LevelHashes | null {
  const r = renderLevelLayers(rom, symbols, FRAMEWORK_ROOT, level);
  if (!r) return null;
  return {
    decode: sha(r.decode.levelDataBuffer, r.decode.screenPageMap),
    bg1: sha(r.bg1.rgba),
    bg2: sha(r.bg2.rgba),
    bg3: sha(r.bg3.rgba),
    bg2Front: r.bg2Front ? sha(r.bg2Front.rgba) : 'none',
    bg3Front: r.bg3Front ? sha(r.bg3Front.rgba) : 'none',
    bg3Mid: r.bg3Mid ? sha(r.bg3Mid.rgba) : 'none',
    sprite: r.sprite ? sha(r.sprite.rgba) : 'none',
    collision: sha(r.collision.rgba)
  };
}

/** Every backed level record id (objectFile present), in ascending id order. */
export function backedLevelIds(frameworkRoot: string = FRAMEWORK_ROOT): number[] {
  const map = loadLevelMapPublic(frameworkRoot);
  return Object.entries(map.levels)
    .filter(([, e]) => e.objectFile)
    .map(([k]) => Number(k))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}

/** Stable hex key for a level record id in the golden map: `0x` + 2-digit hex. */
export function levelKey(id: number): string {
  return '0x' + id.toString(16).padStart(2, '0');
}

/**
 * Render + hash every backed level, keyed by `levelKey(id)`. Skips slots that
 * render to null (empty/special), so the result has 219 entries for the V1.0
 * catalog (record 0x38 excluded). This is what both the golden generator and the
 * Vitest test compute.
 */
export function renderAllLevelHashes(
  rom: Uint8Array,
  symbols: SymbolMap,
  frameworkRoot: string = FRAMEWORK_ROOT
): Record<string, LevelHashes> {
  const out: Record<string, LevelHashes> = {};
  for (const id of backedLevelIds(frameworkRoot)) {
    const level = loadLevel({ workRoot: frameworkRoot, levelRecordId: id });
    const hashes = renderLevelHashes(rom, symbols, level);
    if (hashes) out[levelKey(id)] = hashes;
  }
  return out;
}

/** Load the built V1.0 dev cart, or null if the build artifacts are absent
 *  (lets the gated Vitest test skip cleanly on a machine without a build). */
export function tryLoadDevCart(): DevCart | null {
  try {
    return loadDevCart();
  } catch {
    return null;
  }
}

/** Build the full golden-file object (metadata + per-level PINNED hashes) from a
 *  cart. Used by `render-snapshot.ts golden` to (re)write GOLDEN_PATH. */
export function buildGolden(rom: Uint8Array, symbols: SymbolMap): GoldenFile {
  const all = renderAllLevelHashes(rom, symbols);
  const hashes: Record<string, PinnedHashes> = {};
  for (const k of Object.keys(all)) hashes[k] = pinnedHashes(all[k]!);
  return {
    _comment:
      'Golden render checksums (SHA-256/16) for the pristine V1.0 build, PINNED ' +
      'layers only (decode/bg1/bg2/bg3/collision — sprite excluded, see ' +
      'render-parity.ts PINNED_LAYERS). Locked in after decode parity was ' +
      'verified byte-exact vs the live cart (219/219). Regenerate ONLY when an ' +
      'asm/build change legitimately alters the render: ' +
      'node snes-framework/scripts/engine/render-snapshot.ts golden',
    build: "Super Mario World 2 - Yoshi's Island (USA V1.0)",
    levelCount: Object.keys(hashes).length,
    hashes
  };
}
