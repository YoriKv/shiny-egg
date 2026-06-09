import type { DecodeState, PerCellHandler } from '../state.ts';
import { stampCell } from './_shared.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { registerExtObjectHandler } from './index.ts';

// Ports CODE_extobj_handler_double_teleport_door (ext 0x1F, $12:89EF, Bank12.asm).
// Sibling of CODE_extobj_handler_double_teleport_hole (ext 0x1E).
//
// Shape: WALKER-DRIVEN (shape 2). The init sets a 4x4 cell grid (col extent
// $2A = 4, row extent $2E = 4) then tail-calls the walker. The per-cell
// stamper CODE_12AB39 ($12:AB39) indexes a byte table by the walker counters
// and stamps 0x9600 | tableByte.
//
// IMPORTANT: this handler stamps Map16 graphics tiles ONLY. It touches NO
// exit / teleport / warp state — the actual warp is a separate paired
// screen-exit record on the same screen, decoded outside the object stream.
// (The "teleport" in the friendly name is purely the door's appearance.)
//
// CODE_12AB39 per-cell:
//   Y = (row * 4) + col              ; row counter $2C, col counter $28
//   A = DATA_12AB29,Y                 ; byte table (low byte is the tile id)
//   stamp 0x9600 | A
// DATA_12AB29 ($12:AB29) — 16-entry byte table, verified against the per-cell
// trace (record_value low byte → stamped 0x96xx):
//   Y:  0  1  2  3   4  5  6  7   8  9  A  B   C  D  E  F
const DATA_12AB29 = [
  0xca, 0xcb, 0xcf, 0xd0,
  0xcc, 0xcd, 0xcd, 0xce,
  0xcd, 0xcd, 0xcd, 0xcd,
  0xcd, 0xcd, 0xcd, 0xcd,
] as const;

function initDoubleTeleportDoor(state: DecodeState): void {
  state.zp2A = 0x0004; // col extent
  state.zp2E = 0x0004; // row extent
  walkerSetupTrampoline(state, perCellDoubleTeleportDoor);
}

// Ports CODE_12AB39 ($12:AB39).
const perCellDoubleTeleportDoor: PerCellHandler = (state) => {
  const col = state.zp28 & 0xff;
  const row = state.zp2C & 0xff;
  const tile = DATA_12AB29[row * 4 + col];
  stampCell(state, 0x9600 | tile);
};

export function installExtDoubleTeleportDoorHandlers(): void {
  registerExtObjectHandler(0x1f, initDoubleTeleportDoor);
}
