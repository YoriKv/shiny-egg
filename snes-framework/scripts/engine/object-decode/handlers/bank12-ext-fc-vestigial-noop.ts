// Ports the ext-object init handler for ID 0xFC ("vestigial no-op").
//
// Cart symbol (spec.json `init_handler`): CODE_extobj_FC_vestigial_noop.
// The name is ACCURATE and the symbol is NOT stale — DATA_extended_object_init_ptrs slot 0xFC
// (Bank12.asm:447) points directly at CODE_extobj_FC_vestigial_noop, and that
// label has a real body of its own (no shared dispatch / jump table).
//
// VERIFIED BODY (Bank12.asm:2829-2831):
//
//   CODE_extobj_FC_vestigial_noop:
//   CODE_extobj_FC_vestigial_noop:
//       RTL
//
// That is the ENTIRE handler — a single bare RTL. It does NOT call
// CODE_get_current_map16_tile, does NOT touch $1D/$12, does NOT run the
// walker, does NOT call the PRNG, touches NO memory, and writes NO Map16 cell.
// It is a genuine, fully observable NO-OP — the "vestigial" name is exact.
// The cart's own comment (Bank12.asm:2823-2828) confirms it: "Ext-object $FC:
// VESTIGIAL no-op. Single `RTL`. The dispatch slot is wired but the handler
// does nothing. (External-source codename "SPLB2POS-1" suggests this was
// originally intended to write Baby-Mario's spawn position for split-screen /
// multi-player; the implementation was stripped before ship.)"
//
// Contrast with its neighbours (which DO write the buffer):
//   $FB CODE_extobj_FB_copy_screen_exit  — copies a screen-exit tile
//   $FD CODE_extobj_FD_clear_map16_cell  — writes Map16 $0000 to the cell
//   $FE CODE_extobj_FE_set_babymario_float_limit — sets a screen-page flag
// $FC alone among the $FB-$FE special tail is inert.
//
// Matches the captured trace exactly:
//   "cells": [], "walker_setup": null, "stamp_handler_summary": []  (0 cells).
//
// We register an EXPLICIT, documented no-op (mirroring sibling
// bank12-ext-null.ts) so a hit at 0xFC is a faithful "do nothing", distinct
// from the parser's default "unhandled ext id" stub. Because the cart body is
// literally four NOPs, there is NOTHING to replicate on `state` — the handler
// is deliberately empty (no getCurrentMap16Tile, no zp writes).
import type { DecodeState } from '../state.ts';
import { registerExtObjectHandler } from './index.ts';

// Ports CODE_extobj_FC_vestigial_noop ($12:9179, Bank12.asm:2830) for ext ID
// 0xFC. Body = a single RTL: a pure no-op that stamps nothing and touches no
// decoder-visible state.
function extFcVestigialNoop(_state: DecodeState): void {
  // RTL — the cart handler does nothing. No cell stamped, no state touched.
}

export function installExtFcVestigialNoopHandlers(): void {
  // Ext ID 0xFC maps to CODE_extobj_FC_vestigial_noop in DATA_extended_object_init_ptrs.
  // (The 0x100 mirror is automatic — getExtObjectHandler masks id & 0xff.)
  registerExtObjectHandler(0xfc, extFcVestigialNoop);
}
