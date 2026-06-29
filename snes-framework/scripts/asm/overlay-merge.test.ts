// Unit test for the overlay→base merge (outdated-overlay checker). Synthetic asm
// text only — no cart, no Electron. Run: node snes-framework/scripts/asm/overlay-merge.test.ts

import { computeOverlayUpgrade } from './overlay-merge.ts';
import { listEditableRegionIds } from './markers.ts';

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${msg}`);
    process.exitCode = 1;
  }
}

const region = (id: string, body: string): string =>
  `;@editable:${id} begin\n${body}\n;@editable:${id} end`;

// A base file: a header, region A, mid code, region B.
const base = [
  '; header v2',
  region('a', '\tA-base'),
  '\tmid-base',
  region('b', '\tB-base'),
  '\tfooter'
].join('\n') + '\n';

console.log('=== listEditableRegionIds ===');
assert(JSON.stringify(listEditableRegionIds(base)) === JSON.stringify(['a', 'b']), 'lists region ids in order');

console.log('=== no drift: identical overlay ===');
{
  const up = computeOverlayUpgrade(base, base, () => true);
  assert(!up.changed, 'identical overlay → no change');
}

console.log('=== out-of-region base change is adopted ===');
{
  // Overlay = OLD base (header v1, old mid) with A edited; B untouched.
  const overlay = [
    '; header v1',
    region('a', '\tA-USER'),
    '\tmid-OLD',
    region('b', '\tB-base'),
    '\tfooter'
  ].join('\n') + '\n';
  const up = computeOverlayUpgrade(base, overlay, (id) => id === 'a'); // user edited only A
  assert(up.changed, 'drift detected');
  assert(up.upgraded.includes('; header v2'), 'adopts the new header (outside regions)');
  assert(up.upgraded.includes('\tmid-base'), 'adopts the new mid code (outside regions)');
  assert(up.upgraded.includes('A-USER'), "keeps the user's region-A edit");
  assert(up.editsPreserved.join() === 'a', 'editsPreserved = [a]');
  assert(up.regionsAdded.length === 0 && up.regionsDropped.length === 0, 'no add/drop');
}

console.log('=== frozen-stale region (not edited) is refreshed to base ===');
{
  // Region A differs from base but the user did NOT edit it (isEdited=false) —
  // e.g. base relabeled it. Upgrade should take base's A, not the stale overlay A.
  const overlay = [
    '; header v1',
    region('a', '\tA-STALE'),
    '\tmid-base',
    region('b', '\tB-base'),
    '\tfooter'
  ].join('\n') + '\n';
  const up = computeOverlayUpgrade(base, overlay, () => false); // nothing actually edited
  assert(up.upgraded.includes('\tA-base'), 'adopts base content for the unedited region');
  assert(!up.upgraded.includes('A-STALE'), 'drops the stale region content');
  assert(up.editsPreserved.length === 0, 'nothing reported as preserved');
}

console.log('=== newly-added base region is adopted ===');
{
  // Overlay predates region B entirely (only has region A).
  const overlay = [
    '; header v2',
    region('a', '\tA-base'),
    '\tmid-base',
    '\tfooter'
  ].join('\n') + '\n';
  const up = computeOverlayUpgrade(base, overlay, () => true);
  assert(up.changed, 'drift detected (missing region)');
  assert(up.regionsAdded.join() === 'b', 'regionsAdded = [b]');
  assert(up.upgraded.includes(';@editable:b begin'), 'upgraded file gains region b');
}

console.log('=== region removed from base reports a dropped edit ===');
{
  // Overlay has an extra region C the base no longer defines.
  const overlay = [
    '; header v2',
    region('a', '\tA-base'),
    '\tmid-base',
    region('b', '\tB-base'),
    region('c', '\tC-USER'),
    '\tfooter'
  ].join('\n') + '\n';
  const up = computeOverlayUpgrade(base, overlay, () => true);
  assert(up.regionsDropped.join() === 'c', 'regionsDropped = [c]');
  assert(!up.upgraded.includes('C-USER'), "base has no region c, so the user's c edit can't carry over");
}

console.log('=== nested regions (outer ⊃ inner, like palette-blob ⊃ bg-gradients) ===');
{
  // The base-asm reality for Bank57: the gradient region sits INSIDE the palette
  // blob region. Both are unregistered (isEdited = () => true), so any region
  // whose body differs is preserved — the merge must reconstruct the file exactly,
  // never report spurious drift, and keep both marker pairs intact.
  const nestedBase = [
    '; header',
    ';@editable:outer begin',
    '\tOUTER-pre-base',
    ';@editable:inner begin',
    '\tINNER-base',
    ';@editable:inner end',
    '\tOUTER-post-base',
    ';@editable:outer end',
    '\tfooter'
  ].join('\n') + '\n';
  assert(
    JSON.stringify(listEditableRegionIds(nestedBase)) === JSON.stringify(['outer', 'inner']),
    'nested ids listed outer-then-inner (begin-marker order)'
  );

  // Inner edited → the outer body also differs (it contains inner). Both preserve.
  const innerEdited = nestedBase.replace('\tINNER-base', '\tINNER-USER');
  {
    const up = computeOverlayUpgrade(nestedBase, innerEdited, () => true);
    assert(!up.changed, 'inner-only edit: no spurious drift');
    assert(up.upgraded === innerEdited, 'inner-only edit: reconstructs the overlay exactly');
    assert(up.upgraded.includes('INNER-USER'), 'inner-only edit: keeps the inner edit');
  }

  // Outer body edited outside the inner region; inner untouched. Both preserve.
  const outerEdited = nestedBase.replace('\tOUTER-pre-base', '\tOUTER-pre-USER');
  {
    const up = computeOverlayUpgrade(nestedBase, outerEdited, () => true);
    assert(!up.changed, 'outer-only edit: no spurious drift');
    assert(up.upgraded === outerEdited, 'outer-only edit: reconstructs the overlay exactly');
    assert(
      up.upgraded.includes(';@editable:inner begin') && up.upgraded.includes(';@editable:inner end'),
      'outer-only edit: nested inner marker pair stays intact'
    );
  }

  // Out-of-region base change (header) with both regions edited → adopt the new
  // header, keep both edits, no add/drop.
  const drifted = innerEdited.replace('; header', '; header-OLD').replace('\tfooter', '\tfooter-OLD');
  {
    const up = computeOverlayUpgrade(nestedBase, drifted, () => true);
    assert(up.changed, 'nested + out-of-region drift detected');
    assert(up.upgraded.includes('; header') && !up.upgraded.includes('; header-OLD'), 'adopts new header');
    assert(up.upgraded.includes('INNER-USER'), 'keeps the inner edit through the adopt');
    assert(up.regionsAdded.length === 0 && up.regionsDropped.length === 0, 'no add/drop for nested');
  }
}

console.log(`\n${pass} pass, ${fail} fail`);
console.log(process.exitCode ? '✗ failures above' : '✓ all overlay-merge tests pass');
process.exit(fail === 0 ? 0 : 1);
