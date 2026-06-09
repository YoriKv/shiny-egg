// Ports extended-object init handler $FB ("copy_screen_exit").
//
// Cart: CODE_extobj_FB_copy_screen_exit = CODE_extobj_FB_copy_screen_exit ($12:916C),
// dispatched from the DATA_extended_object_init_ptrs ext init-pointer table at slot 0xFB
// (verified by indexing the table: entry[0xFB] resolves to this label).
// Not call-reachable, so it is absent from the codegraph; resolve it via
// the data-table slot, not a code xref.
//
// Exact cart source (yi/Banks/Bank12.asm:2812-2821). The asm comment there:
//   "Ext-object $FB: copy a screen-exit entry from one screen-index to
//    another. $001C = source screen-index; $001B = destination."
//   CODE_extobj_FB_copy_screen_exit:
//     LDX.w $001C            ; X = source screen-index (cart's $1C)
//     LDY.w $001B            ; Y = dest   screen-index (cart's $1B)
//     LDA.w $6CAA,x          ; A = $6CAA[source]
//     STA.w $6CAA,y          ; $6CAA[dest] = A
//     RTL
//
// Despite the "screen-exit" codename, the operation it performs is a one-
// byte copy within the $6CAA table. In DecodeState $6CAA is `screenPageMap`
// (state.ts: "Per-screen LRU page mapping (cart $6CAA,x). 0 = unallocated."),
// i.e. it duplicates a per-screen LevelDataBuffer PAGE MAPPING so two
// screen-indices share one decoded page. It stamps 0 Map16 cells and runs
// no walker — the captured run stamps 0 Map16 cells
// (cells: [], walker_setup: null).
//
// MODELED: the $6CAA page-map byte copy (source $1C -> dest $1B). The
// parser hands us zp1C = anchorHi and zp1B = anchorLo (the cart's $1C/$1B
// indices). screenPageMap is the 128-entry $6CAA mirror and resolveScreenPage
// indexes it with `& 0xff`, so we mirror that masking and replicate the
// one-byte copy faithfully.
//
// NOT MODELED: the parallel $6CA9 per-screen buffer-base table
// (DecodeState.screenBufBase) is NOT touched by the cart here — it only
// duplicates the $6CAA page-map byte. We copy only screenPageMap, exactly
// as the asm does.
import type { DecodeState } from '../state.ts';
import { registerExtObjectHandler } from './index.ts';

// Ports CODE_extobj_FB_copy_screen_exit ($12:916C). Copies one $6CAA
// page-map byte from the source screen ($1C) to the dest screen ($1B).
// No Map16 cells stamped (spec: 0 cells, no walker).
function initCopyScreenExit(state: DecodeState): void {
  // LDX $1C / LDY $1B: screen indices into the $6CAA page map. The cart
  // uses the full byte; screenPageMap is the 128-entry $6CAA mirror, so
  // bound the index to the array as resolveScreenPage does (& 0xff).
  const map = state.screenPageMap;
  const srcScreen = state.zp1C & 0xff;  // cart X = $1C (source, read)
  const destScreen = state.zp1B & 0xff; // cart Y = $1B (dest, write)
  if (srcScreen < map.length && destScreen < map.length) {
    map[destScreen] = map[srcScreen]!; // LDA $6CAA,x : STA $6CAA,y
  }
}

// Public installer — registers the 0xFB handler. The 0x1FB mirror is
// automatic (getExtObjectHandler masks id & 0xff).
function installExtFbCopyScreenExitHandlers(): void {
  registerExtObjectHandler(0xFB, initCopyScreenExit);
}

export { installExtFbCopyScreenExitHandlers };
