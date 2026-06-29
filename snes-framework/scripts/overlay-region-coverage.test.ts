// Region-coverage guard: every inline-`dw` overlay editor must write ONLY inside
// `;@editable` regions. The drift checker (overlay-merge.ts) models only regions,
// so an edit that lands OUTSIDE one false-drifts and an "upgrade" silently wipes
// it — the bug that prompted wrapping palette / island / gradient / logo in
// regions. This drives each editor in the DATA_OVERLAY_EDITORS registry with a
// representative edit and fails if any byte changes outside a region, turning that
// rule into a checked invariant for every current AND future registered editor.
//
// A new inline-`dw` overlay editor MUST enrol in DATA_OVERLAY_EDITORS (string
// editors go through resources.ts `ASM_REGIONS`, which splices regions by
// construction). This guard then covers it automatically.
//
// Run: node snes-framework/scripts/overlay-region-coverage.test.ts

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FRAMEWORK_ROOT } from './engine/dev-cart.ts';
import { DATA_OVERLAY_EDITORS } from './overlay-data-editors.ts';
import { findRegion, listEditableRegionIds } from './asm/markers.ts';

let failures = 0;
const assert = (c: boolean, m: string): void => {
  if (c) console.log(`  ✓ ${m}`);
  else { console.error(`  ✗ ${m}`); failures++; }
};
const readBase = (rel: string): string => readFileSync(path.join(FRAMEWORK_ROOT, rel), 'utf8');

/** Every `;@editable` region's [innerStart, innerEnd) span in `text`. */
const regionSpans = (text: string): Array<[number, number]> =>
  listEditableRegionIds(text).map((id) => {
    const r = findRegion(text, id)!;
    return [r.innerStart, r.innerEnd];
  });
const inSomeSpan = (i: number, spans: Array<[number, number]>): boolean =>
  spans.some(([s, e]) => i >= s && i < e);

for (const ed of DATA_OVERLAY_EDITORS) {
  console.log(`=== ${ed.file} ===`);
  const base = readBase(ed.file);

  // The editor's declared regions must exist + be well-formed in the base file.
  const baseIds = new Set(listEditableRegionIds(base));
  assert(ed.regions.every((id) => baseIds.has(id)),
    `declared regions present in base: ${ed.regions.join(', ')}`);

  let edited: string | null = null;
  try {
    edited = ed.sampleEdit(readBase);
  } catch (e) {
    assert(false, `sampleEdit threw (markers likely mis-placed): ${(e as Error).message}`);
  }
  if (edited === null) continue;

  assert(edited.length === base.length, 'edit is length-preserving');

  const spans = regionSpans(base);
  const n = Math.min(edited.length, base.length);
  let changed = 0;
  let outside = 0;
  let firstOutside = -1;
  for (let i = 0; i < n; i++) {
    if (edited[i] === base[i]) continue;
    changed++;
    if (!inSomeSpan(i, spans)) { outside++; if (firstOutside < 0) firstOutside = i; }
  }
  assert(changed > 0, `sample edit is non-trivial (${changed} bytes changed)`);
  assert(outside === 0,
    outside === 0
      ? 'every changed byte is inside an `;@editable` region'
      : `every changed byte is inside a region (${outside} out-of-region, first at 0x${firstOutside.toString(16)})`);
}

console.log(`\n${failures === 0 ? '✓ all overlay editors write inside `;@editable` regions' : `✗ ${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
