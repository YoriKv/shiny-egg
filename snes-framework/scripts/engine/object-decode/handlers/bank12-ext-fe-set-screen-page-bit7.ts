// Bank12 extended-object init handler — "set screen-page bit7".
//
// Ports CODE_extobj_FE_set_babymario_float_limit ($12:9186, yi/Banks/Bank12.asm:2848).
// Ext object $FE. The spec's `init_handler` symbol resolves directly (it is
// NOT stale here); DATA_extended_object_init_ptrs[$FE] points at this routine.
//
// Asm (verbatim — the entire routine):
//
//   CODE_extobj_FE_set_babymario_float_limit:
//     LDX.b $1C            ; X = screen index (the $1C anchor high-coord byte)
//     LDA.w $6CAA,x        ; A = per-screen page-map byte (screenPageMap[x])
//     ORA.b #$80           ; set bit 7
//     STA.w $6CAA,x        ; write back
//     RTL
//
// $1C is DP slot !RAM_YI_Level_LastSpawnedColumnRightHalfLo (= state.zp1C),
// the anchor cell's high coord byte the parser already set. $6CAA,x is the
// per-screen page-map table — our `state.screenPageMap` (see
// fetch.ts:resolveScreenPage, which reads `$6CAA,x` and masks `AND #$3F`).
//
// ── What it really does ──────────────────────────────────────────────────
// This is NOT a Map16 stamper. It lays down ZERO cells: no walker setup, no
// `$2A`/`$2E` extents, no `stampCell`. The spec confirms this directly:
//   "Cells stamped: 0 (across 0 distinct stamp handlers)"
//   walker_setup: null, init_dp_delta: null, cells: []   (spec.json)
//
// It sets only bit 7 of `screenPageMap[anchorScreen]`. The table's low 6
// bits hold the LRU page index (every fetch path does `AND #$3F`); bits 6-7
// are control flags. `reset()` seeds the whole table with $80 (bit 7 = the
// "unallocated" sentinel, matching the cart's `STA $80` init loop at
// CODE_108BA7). Bit 7 here is a runtime control flag consumed by in-engine
// gameplay/scroll logic, NOT by the static layout decoder.
//
// ── Modeled vs documented-unmodeled ──────────────────────────────────────
// MODELED:   we faithfully perform the exact byte mutation the cart does —
//            `screenPageMap[x] |= 0x80` at x = state.zp1C. Byte-faithful.
// UNMODELED: the *effect* of that bit. The static decoder only ever consumes
//            `screenPageMap[x] & 0x3f` for page allocation (fetch.ts), so
//            setting bit 7 cannot change which page a screen maps to, where a
//            later object lands, or any produced Map16 cell. For static
//            rendering the mutation is an effective no-op — it touches only
//            runtime state the decoder does not read. We perform it anyway
//            (rather than an empty body) to stay byte-faithful to the cart and
//            keep the flag observable if a future pass starts consuming it.
//            It stamps nothing into levelDataBuffer.
//
// Note: the cart does NOT call resolve_screen_page (no page allocation), so
// there is no ScreenOverflowError risk and pageCount is unaffected. The
// index `$1C` is used unmasked, exactly as `LDX.b $1C` does (no `& $7F`).

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState } from '../state.ts';

const EXT_ID_SET_SCREEN_PAGE_BIT7 = 0xFE;

// Ports CODE_extobj_FE_set_babymario_float_limit ($12:9186). Sets bit 7 of the
// anchor screen's page-map byte. Stamps no Map16 cells (see header).
function initSetScreenPageBit7(state: DecodeState): void {
  // LDX.b $1C — screen index = anchor high-coord byte, used unmasked.
  const x = state.zp1C & 0xff;
  // LDA $6CAA,x : ORA #$80 : STA $6CAA,x — set the bit7 control flag.
  // Modeled write only; no effect on page allocation (fetch masks AND #$3F).
  // Stamps nothing. See header "Modeled vs documented-unmodeled".
  state.screenPageMap[x] = (state.screenPageMap[x]! | 0x80) & 0xff;
}

export function installExtFeSetScreenPageBit7Handlers(): void {
  // Register ext $FE; the 0x100 mirror is automatic (getExtObjectHandler
  // masks id & 0xff).
  registerExtObjectHandler(EXT_ID_SET_SCREEN_PAGE_BIT7, initSetScreenPageBit7);
}
