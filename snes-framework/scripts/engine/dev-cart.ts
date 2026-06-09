// Shared cart + symbol-map loader for the engine-side dev tools
// (render-snapshot, sweep-levels, inspect-level, and the `id` CLI's
// best-effort name lookup). They all run against the built V1.0 ROM and its
// two `.sym` files — V1.0 is byte-identical to the reference cart, so it's the
// canonical decode/render target (see CLAUDE.md). This is NOT used by the
// app/IPC render path, which caches its own rom + parsed symbol map.
//
// Extracted from render-snapshot.ts so the loader + mergeSymbolMaps live in one
// place instead of being re-pasted into every throwaway script under tmp/.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { mergeSymbolMaps, parseWlaSymbolMap, type SymbolMap } from './symbol-map.ts';

// Re-exported for the engine tools that import it from here (historical home).
// The canonical implementation now lives in symbol-map.ts so the merged map
// carries `reverseLookup` over the combined label set.
export { mergeSymbolMaps };

/** Framework root (`snes-framework/`), derived from this file's location so the
 *  tools work regardless of the caller's cwd. */
export const FRAMEWORK_ROOT = path.resolve(import.meta.dirname, '..', '..');

/** Build-artifact stem (the V1.0 output name `outputSfcName` produces). */
const STEM = "Super Mario World 2 - Yoshi's Island (USA V1.0)";

export interface DevCart {
  /** ROM bytes for the engine decode/render functions (they take Uint8Array). */
  rom: Uint8Array;
  /** Same bytes as a Buffer — catalog/name parsing uses `readUInt16LE`. */
  cart: Buffer;
  /** Main `.sym` with the SuperFX `.sym` overlaid (see `mergeSymbolMaps`). */
  symbols: SymbolMap;
}


export interface DevCartPaths {
  cartPath: string;
  symPath: string;
  fxSymPath: string;
}

/** Build-artifact paths for the V1.0 dev cart. Split out so tools that only need
 *  a path (e.g. the pool-budget report, which reads the `.sym` text via
 *  level-budget's loader) don't have to parse the whole ROM. */
export function devCartPaths(frameworkRoot: string = FRAMEWORK_ROOT): DevCartPaths {
  const buildDir = path.join(frameworkRoot, 'build');
  return {
    cartPath: path.join(buildDir, `${STEM}.sfc`),
    symPath: path.join(buildDir, `${STEM}.sym`),
    fxSymPath: path.join(buildDir, `${STEM}-superfx.sym`)
  };
}

/**
 * Load the built V1.0 ROM + merged symbol map. Throws if the build artifacts
 * are missing (callers that want best-effort behaviour — e.g. the `level-lookup`
 * CLI's name lookup — catch and degrade; callers that need the cart — sweep/
 * inspect/snapshot — print the message and exit).
 */
export function loadDevCart(frameworkRoot: string = FRAMEWORK_ROOT): DevCart {
  const { cartPath, symPath, fxSymPath } = devCartPaths(frameworkRoot);
  for (const f of [cartPath, symPath]) {
    if (!fs.existsSync(f)) {
      throw new Error(`Missing build artifact: ${f}\nRun a V1.0 build first.`);
    }
  }
  const cart = fs.readFileSync(cartPath);
  let symbols = parseWlaSymbolMap(fs.readFileSync(symPath, 'utf8'));
  if (fs.existsSync(fxSymPath)) {
    symbols = mergeSymbolMaps(symbols, parseWlaSymbolMap(fs.readFileSync(fxSymPath, 'utf8')));
  }
  // Zero-copy view over the Buffer's bytes — fine for read-only ROM access.
  const rom = new Uint8Array(cart.buffer, cart.byteOffset, cart.byteLength);
  return { rom, cart, symbols };
}
