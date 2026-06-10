// Pure overlay→base merge for the outdated-overlay checker (no Node/Electron
// deps, so it's unit-testable on its own). A project overlay stores a full copy
// of a base `.asm` file with `;@editable:<id>` regions spliced in. When the base
// later changes — code OUTSIDE the regions, or a NEW region added — the overlay
// drifts. `computeOverlayUpgrade` rebuilds the file from the fresh base, then
// re-splices back only the regions the user actually edited (the edit test is
// injected so this stays pure; the main process backs it with a semantic
// per-region comparison). The electron-coupled orchestration (file enumeration,
// disk I/O, backup) lives in src/main/overlay-upgrade.ts.

import { findRegion, listEditableRegionIds, spliceRegion } from './markers.ts';

export interface OverlayUpgrade {
  /** Upgraded content: fresh base with the user's edited regions re-spliced. */
  upgraded: string;
  /** True iff `upgraded` differs from the current overlay (drift to fix). */
  changed: boolean;
  /** Regions whose edits were preserved (overlay content kept). */
  editsPreserved: string[];
  /** Regions in base but not the overlay — adopted from base. */
  regionsAdded: string[];
  /** Regions in the overlay but not base — edits can't be carried over. */
  regionsDropped: string[];
}

/**
 * Merge one overlay `.asm` file onto the current base. Starts from `baseText`
 * (so every out-of-region change + newly-added region comes in for free), then
 * re-splices each region the overlay edited. `isEdited(id)` decides edit vs
 * frozen-stale-base for a region whose raw text differs from base — only called
 * for such regions, so it can be as cheap or as thorough as the caller wants.
 */
export function computeOverlayUpgrade(
  baseText: string,
  overlayText: string,
  isEdited: (id: string) => boolean
): OverlayUpgrade {
  const baseIds = listEditableRegionIds(baseText);
  const overlayIds = listEditableRegionIds(overlayText);
  const overlaySet = new Set(overlayIds);

  let upgraded = baseText;
  const editsPreserved: string[] = [];
  const regionsAdded: string[] = [];
  for (const id of baseIds) {
    if (!overlaySet.has(id)) {
      regionsAdded.push(id); // base added this region after the overlay was written
      continue;
    }
    const baseRegion = findRegion(baseText, id);
    const overlayRegion = findRegion(overlayText, id);
    if (!baseRegion || !overlayRegion) continue;
    if (overlayRegion.inner === baseRegion.inner) continue; // identical — nothing to merge
    if (isEdited(id)) {
      upgraded = spliceRegion(upgraded, id, overlayRegion.inner); // keep the user's edits
      editsPreserved.push(id);
    }
    // else: frozen-stale base (not actually edited) — leave base's content (adopt the update).
  }

  const regionsDropped = overlayIds.filter((id) => !baseIds.includes(id));
  return {
    upgraded,
    changed: upgraded !== overlayText,
    editsPreserved,
    regionsAdded,
    regionsDropped
  };
}
