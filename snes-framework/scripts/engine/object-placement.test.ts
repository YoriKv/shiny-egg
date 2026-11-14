import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { HANDLER_INSTALLERS } from './object-decode/handlers/all.ts';
import { getExtObjectHandler, getStdObjectHandler } from './object-decode/handlers/index.ts';
import { ScreenOverflowError } from './object-decode/fetch.ts';
import { DecodeState, type InitHandler } from './object-decode/state.ts';

for (const install of HANDLER_INSTALLERS) install();

function run(handler: InitHandler, id: number, x: number, y: number): void {
  const state = new DecodeState();
  state.zp15 = id;
  state.zp1B = ((y & 15) << 4) | (x & 15);
  state.zp1C = (y & 0xf0) | (x >>> 4);
  state.zp2A = state.zp2E = 1;
  handler(state);
}

test('blank tile invisible border reaches the actual loader overflow path', () => {
  const handler = getStdObjectHandler(0xa8)!;
  assert.throws(() => run(handler, 0xa8, 0, 0), ScreenOverflowError);
  assert.throws(() => run(handler, 0xa8, 255, 127), ScreenOverflowError);
  for (const x of [1, 254]) for (const y of [1, 126]) {
    assert.doesNotThrow(() => run(handler, 0xa8, x, y));
  }
});

test('generated extended-object bounds keep the actual loader inside the grid at every edge', () => {
  const boxes = JSON.parse(readFileSync(new URL('../../../src/renderer/src/data/object-placement.json', import.meta.url), 'utf8')) as Record<string, number[]>;
  for (let id = 0; id < 256; id++) {
    const handler = getExtObjectHandler(id);
    if (!handler) continue;
    const [left, top, right, bottom] = boxes[id.toString(16).padStart(2, '0')] ?? [0, 0, 1, 1];
    for (const x of [-left, 256 - right]) for (const y of [-top, 128 - bottom]) {
      assert.doesNotThrow(() => run(handler, id, x, y), `ext ${id.toString(16)} at ${x},${y}`);
    }
  }
});
