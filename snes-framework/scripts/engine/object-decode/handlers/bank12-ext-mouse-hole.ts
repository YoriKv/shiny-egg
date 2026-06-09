// Ports the mouse_hole / puzzle-marker extended-object handler ($4C):
// a single template-slot stamp.
//
// The spec's init_handler name `CODE_extobj_handler_mouse_hole` is stale and
// no longer resolves; the live handler at DATA_extended_object_init_ptrs[$4C] is
// CODE_extobj_handler_puzzle_marker (Bank12.asm:1900):
//     JSR.w CODE_get_current_map16_tile   ; re-resolve $1D (latches $12)
//     REP #$30
//     JSL.l CODE_12AD2D                    ; the actual stamper
//     SEP #$30
//     RTL
// CODE_12AD2D (Bank12.asm:6519, $12:AD2D):
//     LDA.w $1D1A                          ; $7E:1D1A template slot
//     LDX.b $1D                            ; parser-resolved anchor offset
//     STA.l !RAM_YI_Level_LevelDataBuffer,x ; stamp into the Map16 buffer
//     RTL
//
// Despite the "hole" name this is NOT a carve-style handler. It calls
// CODE_get_current_map16_tile to resolve the anchor offset $1D (the latched
// existing tile $12 is never read); the stamper then unconditionally reads
// template slot $1D1A and stamps it at $1D — no conditional / read-existing-
// tile carve. The get_current_map16_tile step is REQUIRED, not a no-op: our
// parser dispatch does NOT set zp1D, so without it stampCell would stamp at
// the previous object's stale offset (fixed — was the cause of
// extTemplateStamp appearing unused). Shape-1 single-cell. The slot value is
// per-tileset; the trace's $3B04 is just that test level's value.
import type { DecodeState } from '../state.ts';
import { extTemplateStamp } from './_shared.ts';
import { registerExtObjectHandler } from './index.ts';

// Per-tileset puzzle-marker template slot: cart WRAM $7E:1D1A
// (!RAM_YI_Level_Tpl_PuzzleMarkerTile).
const SLOT_PUZZLE_MARKER_TILE = 0x1d1a;

// Ports CODE_extobj_handler_puzzle_marker → CODE_12AD2D ($12:AD2D):
// single template-slot stamp at the anchor.
function initMouseHole(state: DecodeState): void {
  // getCurrentMap16Tile (inside extTemplateStamp) re-resolves zp1D to THIS
  // object's anchor before stamping — matches the asm and the three sibling
  // single-cell ext handlers (egg-block $C4, special-coin $17, lakitu-hole $80).
  extTemplateStamp(state, SLOT_PUZZLE_MARKER_TILE);
}

export function installExtMouseHoleHandlers(): void {
  registerExtObjectHandler(0x4c, initMouseHole);
}
