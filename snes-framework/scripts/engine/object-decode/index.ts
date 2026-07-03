// Top-level entry: turn a level's .bin file bytes into a stamped
// LevelDataBuffer (Map16 ID grid) + parsed exits.
//
// Pipeline (mirrors the cart's level-load chain):
//   1. UnpackLevelHeader (Bank10) — bit-extract 15 header fields
//   2. init_per_tileset_template_slots (Bank10) — populate the WRAM
//      template slots ($19DA..$1FDA) the Bank13 stamp handlers read
//      for shape-aware fallback selection.
//   3. LoadLevelData (Bank10) — run master stream parser, which dispatches
//      to Bank12 init handlers, which walk and call Bank13 stamp handlers,
//      which stamp Map16 IDs.
//
// Handler coverage is incremental — per-object handlers are added as we
// encounter them in test levels. Unregistered objects are silently
// skipped (no stamping), so a level with novel objects renders partially.
//
// Known render-fidelity gap (NOT a decoder bug): some visible tiles are stamped
// at RUNTIME by sprite / boss / player-event behaviours (Bank03 sprite engine +
// boss banks) via CODE_change_map16 — never by the object stream this file
// decodes, so it's never an object-handler concern. Signature: real=nonzero,
// ours=$0000, no object covering the cell. Concrete: 4-4 (level 0x1E)'s
// "horizontal pipe" ($3D5A/$6700 on screen 0x7C) is a Bank03 terrain-morph
// helper (CODE_03CBD7, main_stairs family), NOT std object $79. Rule this out
// before suspecting handler logic when chasing a buffer diff vs a live dump.
//
// ── Import-specifier rule (Node --experimental-strip-types) ──────────────────
// Every relative import in this module tree MUST carry the literal `.ts`
// extension (`./state.ts`, never `./state.js`). Node's strip-types loader
// resolves the exact specifier: a `.js` specifier throws ERR_MODULE_NOT_FOUND at
// runtime, which takes this whole re-export hub — and thus the editor's decode
// path, i.e. a blank render — down. `tsc` does NOT catch it (it resolves
// `.js`→sibling `.ts`, so a wrong specifier type-checks green). So `npx tsc
// --noEmit` passing is NOT sufficient verification here: also run a real
// `import()` probe (count registered handlers against a known-unused id — NOT
// 0x00, which is a live handler). Grep guard, must return nothing:
//   grep -rn "from '\.\.*/.*\.js'" snes-framework/scripts/engine/

export { DecodeState } from './state.ts';
export type {
  DecodedScreenExit,
  DecodeResult,
  InitHandler,
  PerCellHandler
} from './state.ts';
export {
  loadLevelObjectStream,
  loadObjectPropertyTable,
  type DecodeStats
} from './parser.ts';
export { unpackLevelHeader, HEADER_BYTES, HEADER_FIELD_COUNT } from './header.ts';
export { populateTemplates } from './templates.ts';
export { TT, type TemplateSlot } from './template-slots.ts';
export {
  walkerSetupTrampoline,
  walkerSetupKeepSlope,
  walkerRun,
  intraObjectWalker
} from './walker.ts';
export {
  getCurrentMap16Tile,
  getMap16Above,
  getMap16Below,
  getMap16Left,
  getMap16Right,
  resolveScreenPage,
  ScreenOverflowError
} from './fetch.ts';
export { prngNext } from './prng.ts';
export {
  registerExtObjectHandler,
  registerStdObjectHandler,
  getExtObjectHandler,
  getStdObjectHandler,
  handlerCoverage
} from './handlers/index.ts';
export { installDefaultStubHandlers } from './handlers/default-stub.ts';
export {
  decodeLevelById,
  decodeLevelFromLevelData,
  type DecodeLevelByIdOptions,
  type DecodeLevelByIdResult,
  type DecodeLevelFromLevelDataOptions
} from './load-by-id.ts';
export { resolveProvenanceCells, resolveObjectFootprints, type ProvenanceCell } from './provenance.ts';

// Install every object-decode handler at module load, so any consumer of
// `decodeLevel` gets a working Map16 buffer out of the box. The ordered list
// lives in handlers/all.ts — stubs FIRST, so the real per-handler ports
// registered after them take precedence. Add a handler in that one file.
import { HANDLER_INSTALLERS } from './handlers/all.ts';
for (const install of HANDLER_INSTALLERS) install();

import { DecodeState } from './state.ts';
import { unpackLevelHeader } from './header.ts';
import { populateTemplates } from './templates.ts';
import { loadLevelObjectStream, loadObjectPropertyTable, type DecodeStats } from './parser.ts';
import type { SymbolMap } from '../symbol-map.ts';

/**
 * Convenience wrapper: full level-load from a raw .bin file.
 *
 * `levelBytes` is the per-level .bin file contents — header (10 bytes)
 * followed by the object stream, exit list, etc.
 */
export interface DecodeLevelOptions {
  /** When set + non-empty, record provenance for the objects at these STREAM
   *  INDICES (object drag cell-highlight; one entry for a single drag, the whole
   *  group for a multi-select drag). Off by default; arming it allocates a small
   *  Map and is otherwise free. */
  provenanceTargets?: number[];
  /** Captured cart-PRNG output sequence (from the `level-rng` trace) to replay
   *  in place of the LFSR, reproducing the live game's exact random-tile
   *  variants. See state.ts `prngReplay` / prng.ts. */
  prngReplay?: readonly number[];
  /** Per-caller-site captured PRNG bytes (cart caller PC → byte sequence in call
   *  order), the preferred replay form. See state.ts `prngReplayBySite`. */
  prngReplayBySite?: Record<number, readonly number[]>;
  /** Override the LFSR seed (the editor's "Refresh RNG" action) — re-rolls the
   *  cosmetic random-tile variants by starting the PRNG from a different value.
   *  Omit for the default deterministic seed (0xACE1) the render-parity goldens
   *  pin. Only meaningful for untagged sites (a replay queue, when present, takes
   *  precedence over the LFSR). See state.ts `prngState`. */
  prngSeed?: number;
  /** Collect per-object drawn-tile footprints (state.cellStampers) for the
   *  editor's drawn-tiles hit-testing. Off by default; arming it allocates a Map
   *  and a Set per stamped cell but never touches the rendered buffer, so the
   *  decode output stays byte-identical. Resolve with `resolveObjectFootprints`. */
  collectObjectCells?: boolean;
}

export function decodeLevel(
  rom: Uint8Array,
  symbols: SymbolMap,
  levelBytes: Uint8Array,
  opts: DecodeLevelOptions = {}
): { state: DecodeState; stats: DecodeStats } {
  // 1. Parse header
  const { fields: header } = unpackLevelHeader(levelBytes, 0);

  // 2. Build state + reset
  const state = new DecodeState();
  // Object stream starts immediately after the 10-byte header.
  state.reset(levelBytes.subarray(10), header);

  // Replay a captured cart-PRNG sequence (level-rng trace) when provided. Set
  // after reset() so it survives into the parse.
  if (opts.prngReplay != null && opts.prngReplay.length > 0) {
    state.prngReplay = opts.prngReplay;
  }
  if (opts.prngReplayBySite != null) {
    const m = new Map<number, { bytes: readonly number[]; idx: number }>();
    for (const [pc, bytes] of Object.entries(opts.prngReplayBySite)) {
      m.set(Number(pc), { bytes, idx: 0 });
    }
    state.prngReplayBySite = m;
  }

  // Override the LFSR seed (the "Refresh RNG" editor action). Set after reset()
  // (which installs the default 0xACE1) so it survives into the parse. Guarded
  // non-zero: a 0 seed is a Galois-LFSR fixed point (stuck → all-zero output), so
  // fall back to the default rather than render a dead-RNG level.
  if (opts.prngSeed != null) {
    state.prngState = (opts.prngSeed & 0xffff) || 0xACE1;
  }

  // Arm the provenance recorder (object drag cell-highlight) when requested.
  if (opts.provenanceTargets != null && opts.provenanceTargets.length > 0) {
    state.provenanceTargets = new Set(opts.provenanceTargets);
    state.provenanceCells = new Map();
  }

  // Arm the drawn-tiles footprint collector (editor hit-testing) when requested.
  if (opts.collectObjectCells) {
    state.cellStampers = new Map();
  }

  // 3. Populate per-tileset Map16-ID template slots in WRAM (cart
  //    `init_per_tileset_template_slots`). Bank13 stamp handlers read
  //    these for shape-aware fallback selection.
  populateTemplates(rom, symbols, state);

  // 4. Run parser
  const propTable = loadObjectPropertyTable(rom, symbols);
  const stats = loadLevelObjectStream(state, propTable);

  return { state, stats };
}
