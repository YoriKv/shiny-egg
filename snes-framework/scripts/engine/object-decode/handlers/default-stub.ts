// Default-stub handler — registered for all 256 extended + 256 standard
// object IDs. **True no-op**: writes nothing to LevelDataBuffer, leaving
// unhandled objects' cells at their zero-initialised state.
//
// Why no-op (vs. an earlier byte-stamp variant): the §6.2 BG1 renderer
// reads LevelDataBuffer as 16-bit Map16 IDs and uses ID == 0 as the
// "skip / blank" sentinel. An ID-byte stamp produced bogus page-$00
// Map16 cells everywhere, which the renderer would draw as real (wrong)
// tiles. Render-nothing-for-unhandled is the editor-side fallback: the
// object outline overlay shows the bounds, BG1 stays blank for that
// object until a real handler ports.
//
// Real per-object handlers replace stubs in `bank12/` and `bank13/`
// over time — call `registerXxxObjectHandler(id, fn)` after this module
// runs to wire one in.

import {
  registerExtObjectHandler,
  registerStdObjectHandler
} from './index.ts';
import type { DecodeState } from '../state.ts';

/** No-op handler. Leaves the cells the walker would visit at zero so
 *  the BG1 renderer can identify them as "unhandled" and skip drawing. */
function defaultStubHandler(_state: DecodeState): void {
  /* render-nothing — see file header */
}

/** Register the stub for all 256 IDs on both dispatch tables. */
export function installDefaultStubHandlers(): void {
  for (let i = 0; i < 256; i++) {
    registerExtObjectHandler(i, defaultStubHandler);
    registerStdObjectHandler(i, defaultStubHandler);
  }
}
