// Committed render-parity regression test (Vitest).
//
// Locks in the render output that was verified byte-exact against the live cart
// (219/219 levels — see research/notes-bg1-trace-rng-parity.md). For every backed
// level it re-renders the V1.0 build and hashes each layer (decode grid + bg1 /
// bg2 / bg3 / sprite / collision RGBA), comparing against the committed goldens
// in render-parity.golden.json. A hash drift = a render regression on that level.
//
// We store CHECKSUMS, not pixels: the RGBA for 219 levels is megabytes of
// copyrighted game data; a 16-hex-char SHA per layer detects any pixel change
// just as well and stays a 50 KB JSON in git.
//
// This is the rare engine test that runs under Vitest (the others are node-run —
// see vitest.config.ts). It's gated on the V1.0 build artifacts: with no build
// it SKIPS cleanly (so a checkout/CI without a cart stays green), the same
// reference-cart-gating the node engine tests use. The golden-file shape check
// below always runs, so a corrupted/short golden fails even without a build.
//
// If an asm/build change legitimately alters the render, regenerate the goldens:
//   node snes-framework/scripts/engine/render-snapshot.ts golden

import * as fs from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import {
  tryLoadDevCart,
  renderAllLevelHashes,
  pinnedHashes,
  PINNED_LAYERS,
  GOLDEN_PATH,
  type GoldenFile,
  type LevelHashes
} from './render-parity.ts';

const golden: GoldenFile = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));
const goldenLevels = Object.keys(golden.hashes).sort();
const PINNED = [...PINNED_LAYERS].sort();

// Always-runnable (no cart needed): the golden file is well-formed.
describe('render-parity golden file', () => {
  it('has the expected level count and per-level pinned-layer keys', () => {
    expect(goldenLevels.length).toBe(golden.levelCount);
    expect(goldenLevels.length).toBe(219);
    for (const lvl of goldenLevels) {
      expect(Object.keys(golden.hashes[lvl]!).sort()).toEqual(PINNED);
    }
  });
});

// Cart-gated: re-render the V1.0 build and compare the pinned layers to the
// goldens. (The sprite layer is rendered too but not pinned — see PINNED_LAYERS.)
const cart = tryLoadDevCart();

describe.skipIf(cart === null)('render parity vs golden (V1.0 build)', () => {
  let actual: Record<string, LevelHashes>;
  beforeAll(() => {
    // Render + hash every backed level once; the per-level cases just compare.
    actual = renderAllLevelHashes(cart!.rom, cart!.symbols);
  }, 180_000);

  it('renders exactly the golden level set (no added/dropped levels)', () => {
    expect(Object.keys(actual).sort()).toEqual(goldenLevels);
  });

  it.each(goldenLevels)('level %s renders identical to golden (pinned layers)', (lvl) => {
    expect(pinnedHashes(actual[lvl]!)).toEqual(golden.hashes[lvl]);
  });
});
