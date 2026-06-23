// Survey every slope (SK-flagged) collision page and classify which byte-pair
// carries the varying surface shape: foot-down (bytes[0,1]) vs foot-up
// (bytes[2,3]). Hypothesis the renderer encodes: foot-up = ground (fill below),
// foot-down = ceiling/underside (fill above). Use this to confirm the signal is
// clean before touching render-collision's slope handling.
//
//   node snes-framework/scripts/engine/slope-pages.ts
//
// Engine-side, no native deps (works from WSL), targets the built V1.0 ROM.

import { loadDevCart } from './dev-cart.ts';
import { loadCollisionTable, loadSlopePanels, decodeSlopeProfile } from './collision.ts';

const { rom, symbols } = loadDevCart();
const table = loadCollisionTable(rom, symbols);
const panels = loadSlopePanels(rom, symbols);

const hx = (n: number, w = 2) => n.toString(16).padStart(w, '0');

// Group SK pages by their slope index (raw2).
const seenIdx = new Map<number, number[]>();
for (let p = 0; p < table.length; p++) {
  const e = table[p]!;
  if (!e.flags.sk) continue;
  const arr = seenIdx.get(e.raw2) ?? [];
  arr.push(p);
  seenIdx.set(e.raw2, arr);
}

const totalPages = [...seenIdx.values()].reduce((a, b) => a + b.length, 0);
console.log(`SK pages: ${totalPages}, distinct slopeIdx: ${seenIdx.size}\n`);

for (const idx of [...seenIdx.keys()].sort((a, b) => a - b)) {
  const pages = seenIdx.get(idx)!;
  if (idx >= 0x20) {
    console.log(`idx 0x${hx(idx)}  RAM/animated  pages=[${pages.map((p) => hx(p)).join(',')}]`);
    continue;
  }
  const prof = decodeSlopeProfile(panels, idx);
  const distinct = (g: (s: (typeof prof)[number]) => number) => new Set(prof.map(g)).size;
  const vDlo = distinct((s) => s.subpixelY);
  const vDhi = distinct((s) => s.direction);
  const vUlo = distinct((s) => s.subpixelYUp);
  const vUhi = distinct((s) => s.directionUp);
  const downVar = Math.max(vDlo, vDhi);
  const upVar = Math.max(vUlo, vUhi);
  const pair = downVar > upVar ? 'DOWN(ceil?)' : upVar > downVar ? 'UP(ground?)' : 'TIE';
  // Surface from the most-varying byte (mirrors renderer's tie-break: prefer down).
  const sels: [string, number][] = [
    ['down-lo', vDlo], ['down-hi', vDhi], ['up-lo', vUlo], ['up-hi', vUhi]
  ];
  let best = sels[0]!;
  for (const s of sels.slice(1)) if (s[1] > best[1]) best = s;
  const get = (s: (typeof prof)[number]) =>
    best[0] === 'down-lo' ? s.subpixelY
      : best[0] === 'down-hi' ? s.direction
        : best[0] === 'up-lo' ? s.subpixelYUp
          : s.directionUp;
  const isSub = best[0].endsWith('lo');
  // foot-DOWN pick ⇒ ceiling (solid above); foot-UP ⇒ ground (solid below).
  // Off-tile columns are solid or passable depending on that side — mirror the
  // renderer's readSurface so this diagnostic doesn't mislabel ceiling slopes
  // (idx $1C-$1F) the way the old hardcoded-ground mapping did.
  const fillAbove = best[0].startsWith('down');
  const surf = prof.map((s) => {
    const y = isSub ? get(s) >> 1 : get(s);
    if (y >= 0 && y < 16) return y;
    return (y >= 16) === fillAbove ? 'S' : 'P';
  });
  const surfStr = surf.map((v) => String(v).padStart(3)).join('');
  console.log(
    `idx 0x${hx(idx)}  ${pair.padEnd(11)} pick=${best[0].padEnd(7)} var(D=${downVar} U=${upVar})  ` +
      `pages=[${pages.map((p) => hx(p)).join(',')}]`
  );
  console.log(`        surfaceY:${surfStr}`);
}
