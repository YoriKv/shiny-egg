// Unsaved drafts of the fixed-size cart tables in `ROM_TABLE_PATCHES`
// (snes-framework/scripts/rom-table-patches.ts): the table twin of the live gfx
// cache (`gfx-live-cache.ts`). The renderer pushes a table document's draft here
// while it differs from the saved copy (`render:setTablePreview`), and
// `render/rom-cache.ts` writes it over the saved overlay's table in the render
// ROM. So the level canvas and every other render show the draft without a save
// or a rebuild.
//
//   - Set/cleared by the renderer only (the draft lives there). The document
//     clears its entry when it becomes clean (saved or discarded) and on mount,
//     so a renderer reload never leaves a stale draft behind.
//   - Cleared wholesale on any project change.
//   - No revision counter: rom-cache keys its patched view on the bytes it
//     applies, so only a real byte change invalidates renders.

import type { RomTablePatchKind } from 'snes-framework/types'

const drafts = new Map<RomTablePatchKind, Uint8Array>()

/** Set (`bytes`) or clear (`null`) one table's draft. */
export function setTablePreview(kind: RomTablePatchKind, bytes: Uint8Array | null): void {
  if (bytes === null) drafts.delete(kind)
  else drafts.set(kind, bytes.slice())
}

/** Drop every table draft (project change). */
export function clearTablePreviews(): void {
  drafts.clear()
}

export function tablePreviews(): ReadonlyMap<RomTablePatchKind, Uint8Array> {
  return drafts
}
