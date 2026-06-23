// Live overlay of edited gfx-file tile bytes — the gfx twin of the live palette
// draft (`applyPaletteEdits`). Lets the render path show `saveGfxEdit` edits (BG
// region, metatile, faithful sheets, metasprite) on the canvas WITHOUT a rebuild:
// the render's VRAM loader (`loadLevelGfx`, via `buildLevelVramCgram`) overrides
// each file's bytes from here, in exactly the spot CGRAM is overridden from the
// palette draft. Both live-edit layers are applied at the same render seam — one
// unified "preview unsaved edits" system.
//
//   - Populated by `saveGfxEdit` (it already holds the decompressed tile bytes).
//   - Cleared per-file on reset, wholesale on project switch (so one project's
//     edits never leak into another's render).
//   - A monotonic `revision` is folded into the VRAM/CGRAM render-cache keys, so an
//     edit invalidates the relevant cached renders; the renderer then bumps
//     `renderRefresh` to force a fresh (full, non-patch) re-render.
//
// The edits also persist to the project overlay via `saveGfxEdit` as before — this
// cache is only the in-memory preview layer (a build still bakes them into the ROM).

const cache = new Map<string, Uint8Array>()
let revision = 0

/** Cache key — the same `${format}/${fileId}` the render override looks up. */
const keyFor = (format: 'lz2' | 'lz16', fileId: number): string => `${format}/${fileId}`

/** Record a file's edited (decompressed) tile bytes for live preview. */
export function setGfxLiveEdit(format: 'lz2' | 'lz16', fileId: number, tiles: Uint8Array): void {
  cache.set(keyFor(format, fileId), tiles.slice())
  revision++
}

/** Drop one file's live edit (on per-file reset). */
export function clearGfxLiveEdit(format: 'lz2' | 'lz16', fileId: number): void {
  if (cache.delete(keyFor(format, fileId))) revision++
}

/** Drop every live edit (on project switch / reset-all). */
export function clearGfxLiveCache(): void {
  if (cache.size > 0) {
    cache.clear()
    revision++
  }
}

/** The live overrides the render's `loadLevelGfx` consults (keyed `format/fileId`). */
export function gfxLiveEdits(): ReadonlyMap<string, Uint8Array> {
  return cache
}

/** Bumps on every edit/reset/clear; fold into render-cache keys to invalidate. */
export function gfxLiveRevision(): number {
  return revision
}
