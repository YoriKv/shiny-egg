// Public surface of the ROM-import engine (plan-rom-import.md). Pure
// framework-side ROM analysis: given a foreign cart + the base V1.0 cart, it
// re-anchors the top-level tables, decodes the foreign level streams, and diffs
// them against base. The app layer (src/main/rom-import.ts) wraps this into the
// renderer report and applies selected changes through the editor's save paths.

export { analyzeForeignRom } from './analyze.ts';
export type { AnalyzeOptions, AnalyzeResult, ForeignImportItem } from './analyze.ts';
export { diffInventory } from './inventory.ts';
export type { InventoryOptions } from './inventory.ts';
export {
  resolveAnchors,
  vanillaAnchors,
  pointsAtValidObjStream,
  pointsAtValidSprStream,
  LEVEL_COUNT,
  type ImportAnchors,
  type ResolveAnchorsResult
} from './anchors.ts';
export { readForeignStreams } from './foreign-cart.ts';
export type { ForeignStreams, ForeignRecordStreams } from './foreign-cart.ts';
export { mergeForeignIndexWords, readForeignWorldMap } from './foreign-world-map.ts';
export type { ForeignWorldMap, IndexMergeResult } from './foreign-world-map.ts';
