// Giant ext-object setpiece STUBS — deferred by explicit decision.
//
// These four extended objects lay down very large FIXED setpieces (hundreds
// of Map16 cells) and only appear in cutscene / boss / intro levels:
//
//   0x10  extobj_handler_16x32_block          (16x32 block; spec ~240KB md / 697KB json)
//   0x18  extobj_handler_demo_setpiece_16x16   (intro demo set)
//   0x19  extobj_handler_finalboss_setpiece_24x3
//   0x1A  extobj_handler_finalboss_setpiece_32x12
//
// Registered as documented no-ops so coverage accounting is explicit and the
// parser skips them cleanly (same render result as the default stub — nothing
// — but intentional rather than "not yet reached"). The object-outline
// overlay still shows their bounds in the editor.
//
// TODO (deferred sweep): faithfully port from
// CODE_extobj_handler_{16x32_block,demo_setpiece_16x16,finalboss_setpiece_24x3,
// finalboss_setpiece_32x12}. Note: 0x10/0x18/0x19/0x1A reuse the
// 128-byte-source-table + 3-way `+base` transform stamper that the ported
// 8x16_block handler (bank12-ext-8x16-block.ts) implements, just at larger
// extents — fold against that when porting.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState } from '../state.ts';

/** No-op for the deferred giant setpieces — renders nothing (see header). */
// Merge: object IDs 0x10, 0x18, 0x19, 0x1A share this handler.
function giantSetpieceStub(_state: DecodeState): void {
  /* deferred — intentional no-op */
}

export function installExtGiantStubHandlers(): void {
  registerExtObjectHandler(0x10, giantSetpieceStub);
  registerExtObjectHandler(0x18, giantSetpieceStub);
  registerExtObjectHandler(0x19, giantSetpieceStub);
  registerExtObjectHandler(0x1a, giantSetpieceStub);
}
