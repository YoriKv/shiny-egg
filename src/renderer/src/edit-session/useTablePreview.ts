// Live preview for a fixed-size cart-table document (the main-side registry is
// `ROM_TABLE_PATCHES`, snes-framework/scripts/rom-table-patches.ts): while the
// draft differs from the saved copy, push it to main, which writes it into the
// render ROM so the level canvas and every other render show it with no save
// or rebuild. A clean document clears its draft (saved state then shows,
// from the overlay). The first run clears too, so a renderer reload can't
// leave a stale draft in main. `onApplied` (the render-refresh bump) runs only
// when main reports the render ROM actually changed.

import { useEffect } from 'react'
import type { RomTableModels, RomTablePatchKind } from '../../../preload/api'

export function useTablePreview<K extends RomTablePatchKind>(
  kind: K,
  draft: RomTableModels[K] | null,
  dirty: boolean,
  onApplied: () => void
): void {
  useEffect(() => {
    // Not cancelled on re-run: each push's ROM change still needs its refresh.
    void window.shinyEgg.render
      .setTablePreview(kind, dirty && draft !== null ? draft : null)
      .then((changed) => {
        if (changed) onApplied()
      })
      .catch((e: unknown) => console.warn(`[table-preview] ${kind}:`, e))
  }, [kind, draft, dirty, onApplied])
}
