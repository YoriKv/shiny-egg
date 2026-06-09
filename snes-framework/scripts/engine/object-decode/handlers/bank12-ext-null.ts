// Ports the ext-object init handler shared by IDs 0x20-0x2F.
//
// SURPRISE vs the assignment brief: the brief expected a bare-RTL handler
// named `CODE_extobj_handler_null`. In the current framework asm that symbol
// does NOT exist. The DATA_extended_object_init_ptrs ext init-pointer table routes IDs
// 0x20..0x2F (verified: all 16 entries) to `CODE_extobj_handler_diagonal_slope_family_1`
// at $12:8A00 — and that body is NOT a bare RTL. It is, however, an
// observable NO-OP (stamps nothing), which is why the
// ext-2{0..F}-extobj_handler_null trace specs all record 0 cells. The
// spec's `init_handler: CODE_extobj_handler_null` is just the spec set's
// friendly alias for this behaviourally-null handler.
//
// Asm (CODE_extobj_handler_diagonal_slope_family_1, Bank12.asm:1760):
//
//   CODE_extobj_handler_diagonal_slope_family_1:   ; ext-obj IDs $30-$3F (label)
//                                                  ; but DATA_extended_object_init_ptrs maps $20-$2F here too
//     JSR.w CODE_get_current_map16_tile            ; re-resolve $1D, latch tile -> $12 (no write)
//     REP.b #$30
//     LDA.b $15 : SEC : SBC.w #$0008 : STA.b $15   ; orientation byte -= 8
//     JSL.l CODE_12AB55                            ; per-cell stamper — but it is a bare RTL!
//     SEP.b #$30
//     RTL
//
// The dispatched stamper CODE_12AB55 ($12:AB55, Bank12.asm:6274) is a single
// `RTL` — so NO Map16 cell is ever written. Net effect of the whole handler:
// it re-resolves the anchor and decrements $15, then returns without
// stamping. Verified with:
//   node snes-framework/scripts/cli.ts closure CODE_extobj_handler_diagonal_slope_family_1
// (CODE_12AB55 body = just `RTL`).
//
// These IDs are intentional no-ops in the cart (the misleadingly-named
// "diagonal_slope_family_1" label notwithstanding — it lays no slope). We
// register them explicitly to a documented no-op so a hit here is a faithful
// "do nothing", distinct from the parser's default "unhandled ext id" stub.
//
// We DO replicate the two real side effects on transient per-object state
// ($1D/$12 via get_current_map16_tile, and the $15 decrement) for fidelity —
// these zp fields are reset before the next object, so they don't affect the
// rendered buffer, but mirroring the asm keeps the port auditable.
import type { DecodeState } from '../state.ts';
import { registerExtObjectHandler } from './index.ts';
import { getCurrentMap16Tile } from '../fetch.ts';

// Ports CODE_extobj_handler_diagonal_slope_family_1 ($12:8A00) for IDs
// 0x20-0x2F. Observable no-op: stamps nothing (stamper CODE_12AB55 = RTL).
function extNull(state: DecodeState): void {
  // JSR CODE_get_current_map16_tile — re-resolve $1D, latch tile into $12.
  // (No buffer write. May throw ScreenOverflowError; let it propagate — the
  //  parser catches it.)
  getCurrentMap16Tile(state);
  // LDA $15 : SEC : SBC #$0008 : STA $15 — orientation byte -= 8 (16-bit).
  state.zp15 = (state.zp15 - 0x0008) & 0xffff;
  // JSL CODE_12AB55 — bare RTL; no cell stamped.
}

export function installExtNullHandlers(): void {
  // Ext IDs 0x20..0x2F all map to $12:8A00 in DATA_extended_object_init_ptrs.
  // (The 0x100 mirror is automatic — getExtObjectHandler masks id & 0xff.)
  for (let id = 0x20; id <= 0x2f; id++) {
    registerExtObjectHandler(id, extNull);
  }
}
