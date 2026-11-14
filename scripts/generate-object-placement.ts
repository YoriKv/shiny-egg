// Regenerate with: node scripts/generate-object-placement.ts
// Probe the loader walk, not rendered pixels: transparent cells allocate pages too.
import { readFileSync, writeFileSync } from 'node:fs';
import { HANDLER_INSTALLERS } from '../snes-framework/scripts/engine/object-decode/handlers/all.ts';
import { getExtObjectHandler } from '../snes-framework/scripts/engine/object-decode/handlers/index.ts';
import { DecodeState } from '../snes-framework/scripts/engine/object-decode/state.ts';

for (const install of HANDLER_INSTALLERS) install();
const boxes: Record<string, number[]> = {};
for (let id = 0; id < 256; id++) {
  const handler = getExtObjectHandler(id);
  if (!handler) continue;
  let minX = 0, minY = 0, maxX = 0, maxY = 0;
  // Include every sub-screen alignment. Some objects snap to a screen boundary.
  for (let subY = 0; subY < 16; subY++) for (let subX = 0; subX < 16; subX++) {
    const x = 112 + subX, y = 48 + subY;
    const state = new DecodeState();
    state.zp1B = (subY << 4) | subX;
    state.zp1C = 0x37;
    state.zp15 = id;
    state.zp2A = state.zp2E = 1;
    state.visitCell = (off) => {
      const page = off >>> 9;
      const screen = state.screenPageMap.indexOf(page);
      if (screen < 0 || page === 0) throw new Error(`Unmapped cell for ext ${id}`);
      const cx = (screen & 15) * 16 + ((off >>> 1) & 15) - x;
      const cy = (screen >>> 4) * 16 + ((off >>> 5) & 15) - y;
      minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
      minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
    };
    handler(state);
  }
  if (minX || minY || maxX || maxY) boxes[id.toString(16).padStart(2, '0')] = [minX, minY, maxX + 1, maxY + 1];
}
const target = new URL('../src/renderer/src/data/object-placement.json', import.meta.url);
const output = '{\n' + Object.entries(boxes).map(([id, box]) => `  "${id}": [${box.join(', ')}]`).join(',\n') + '\n}\n';
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8').replaceAll('\r\n', '\n') !== output) {
    throw new Error('Object placement bounds are stale; run node scripts/generate-object-placement.ts');
  }
} else {
  writeFileSync(target, output);
}
