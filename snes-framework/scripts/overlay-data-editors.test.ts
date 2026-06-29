// overlay-data-editors.ts migration pins — the one-time rebuild that converts a
// pre-`;@editable`-marker (inline-`dw`) overlay into the marker format while
// preserving every edit. Load-bearing: a marker-less Bank57 / Bank0F overlay
// (how older projects stored palette / island / gradient / logo edits) rebuilds
// BYTE-FOR-BYTE to what a current save produces — markered, edits intact — so the
// drift checker no longer false-reports it and an "upgrade" can't wipe it.
//
// Run: node snes-framework/scripts/overlay-data-editors.test.ts

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FRAMEWORK_ROOT } from './engine/dev-cart.ts';
import { rebuildBank57Overlay, rebuildBank0FOverlay } from './overlay-data-editors.ts';
import { findRegion, listEditableRegionIds, spliceRegion } from './asm/markers.ts';
import { applyPaletteEdits, readPaletteEdits } from './palette-edit.ts';
import { applyIslandTilemapEdits, readIslandTilemapEdits } from './island-tilemap.ts';
import { applyGradientEdits, readGradientEdits, gradientLabels, gradientOffset } from './gradient-edit.ts';
import { applyLogoTilemapEdits, readLogoTilemapEdits } from './logo-tilemap.ts';

let failures = 0;
const assert = (c: boolean, m: string): void => {
  if (c) console.log(`  ✓ ${m}`);
  else { console.error(`  ✗ ${m}`); failures++; }
};
const read = (rel: string): string => readFileSync(path.join(FRAMEWORK_ROOT, rel), 'utf8');
const hasRegions = (text: string, ids: string[]): boolean => {
  const have = new Set(listEditableRegionIds(text));
  return ids.every((id) => have.has(id));
};

// ── Bank57: palette ⊃ gradients, plus island ──────────────────────────────────
console.log('=== Bank57.asm (palette / island / gradient) ===');
{
  const base = read('yi/Banks/Bank57.asm');
  const bank01 = read('yi/Banks/Bank01.asm');
  const labels = gradientLabels(bank01);

  const pEdits = [{ offset: 0, value: 0x1234 }, { offset: 4, value: 0x7abc }];
  const iEdits = [{ offset: 0, value: 0x11 }, { offset: 513, value: 0xee }];
  const gEdits = [
    { offset: gradientOffset(0, 0), value: 0x0123 },
    { offset: gradientOffset(2, 5), value: 0x4567 }
  ];

  // A current (markered) save = base ⊕ all three edit sets.
  const markered = applyGradientEdits(
    applyIslandTilemapEdits(applyPaletteEdits(base, pEdits), iEdits),
    gEdits,
    labels
  );
  assert(hasRegions(markered, ['palette-blob', 'island-tilemap', 'bg-gradients']), 'current save carries all 3 regions');

  // An OLD overlay = the same bytes with the markers stripped (pre-region format).
  const stripped = markered.replace(/^;@editable:(palette-blob|island-tilemap|bg-gradients) (begin|end)\r?\n/gm, '');
  assert(listEditableRegionIds(stripped).length === 0, 'stripped overlay has no data-region markers');

  const rebuilt = rebuildBank57Overlay(base, stripped, bank01);
  assert(hasRegions(rebuilt, ['palette-blob', 'island-tilemap', 'bg-gradients']), 'rebuild re-adds all 3 regions');
  assert(rebuilt === markered, 'rebuild from a marker-less overlay == a fresh markered save (byte-for-byte)');

  // Edits survive the round-trip (read back from the rebuilt overlay).
  const back = (xs: { offset: number; value: number }[], want: { offset: number; value: number }[]): boolean =>
    want.every((w) => xs.some((x) => x.offset === w.offset && x.value === w.value));
  assert(back(readPaletteEdits(base, rebuilt), pEdits), 'palette edits preserved');
  assert(back(readIslandTilemapEdits(base, rebuilt), iEdits), 'island edits preserved');
  assert(back(readGradientEdits(base, rebuilt, labels), gEdits), 'gradient edits preserved');

  // Idempotent: rebuilding an already-markered overlay is a no-op.
  assert(rebuildBank57Overlay(base, markered, bank01) === markered, 'rebuild is idempotent on an already-markered overlay');

  // No edits → overlay would equal base; rebuild returns base unchanged.
  const baseStripped = base.replace(/^;@editable:(palette-blob|island-tilemap|bg-gradients) (begin|end)\r?\n/gm, '');
  assert(rebuildBank57Overlay(base, baseStripped, bank01) === base, 'no-edit overlay rebuilds back to base');
}

// ── Bank0F: logo, beside the existing intro-story string region ────────────────
console.log('=== Bank0F.asm (logo + intro-story) ===');
{
  const base = read('yi/Banks/Bank0F.asm');
  const logoEdits = [{ offset: 5, value: 0x4242 }, { offset: 447, value: 0x8307 }];

  // Simulate a sibling intro-story edit by tweaking that region's body.
  const introBase = findRegion(base, 'intro-story')!.inner;
  const tweakedIntro = '; migration-test intro edit\n' + introBase;
  const markered = spliceRegion(applyLogoTilemapEdits(base, logoEdits), 'intro-story', tweakedIntro);
  assert(hasRegions(markered, ['logo-tilemap', 'intro-story']), 'current save carries logo + intro regions');

  // An OLD Bank0F overlay had the intro-story markers but NOT the logo markers.
  const stripped = markered.replace(/^;@editable:logo-tilemap (begin|end)\r?\n/gm, '');
  assert(hasRegions(stripped, ['intro-story']) && !hasRegions(stripped, ['logo-tilemap']),
    'stripped overlay keeps intro-story but lost logo-tilemap markers');

  const rebuilt = rebuildBank0FOverlay(base, stripped);
  assert(hasRegions(rebuilt, ['logo-tilemap', 'intro-story']), 'rebuild re-adds the logo region, keeps intro');
  assert(rebuilt === markered, 'rebuild from a logo-marker-less overlay == a fresh save (byte-for-byte)');
  assert(findRegion(rebuilt, 'intro-story')!.inner === tweakedIntro, 'sibling intro-story edit preserved');

  const back = readLogoTilemapEdits(base, rebuilt).sort((a, b) => a.offset - b.offset);
  assert(back.length === 2 && back[0]!.value === 0x4242 && back[1]!.value === 0x8307, 'logo edits preserved');

  // No edits → rebuild returns base unchanged.
  const baseStripped = base.replace(/^;@editable:logo-tilemap (begin|end)\r?\n/gm, '');
  assert(rebuildBank0FOverlay(base, baseStripped) === base, 'no-edit overlay rebuilds back to base');
}

console.log(`\n${failures === 0 ? '✓ all overlay-data-migration pins pass' : `✗ ${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
