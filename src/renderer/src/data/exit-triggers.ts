// How the obj-metadata `exitTrigger` flag is set — provenance, so the pre-baked
// data in obj-metadata.json stays reproducible. The flag lives in the JSON; this
// module documents its origin and exposes predicates that read it back.
//
// Two INDEPENDENT engine mechanisms fire a screen exit — both are flagged:
//
// SPRITES — door / pipe-entrance / horizontal-entrance / teleport sprites whose
// Main handler funnels into the shared warp routine `CODE_02A4B5` ($02:A4B5,
// which sets warp-fired flag $038C + gamemode $0B). The flagged sprite ids are
// that routine's call-graph callers (e.g. $042 Vertical Pipe Entrance, $0D0/$0D1
// horizontal / secret entrances, $084 Teleport). Regenerate with:
//   node snes-framework/scripts/cli.ts xref CODE_02CDB9 --callers   (entrance set)
//   node snes-framework/scripts/cli.ts xref CODE_02A4B5 --callers
//
// OBJECTS — a DOOR object is a screen-exit when it STAMPs a tile whose collision
// class carries a door bit. The class lives in `bg_type_table` (3 bytes/page,
// indexed by a Map16 id's high byte); byte 1 holds the door bit DR + bonus-door
// bit BD. A page is a player-warp exit type iff DR|BD is set — the only such page
// in this cart is $18. The player-collision read drives Yoshi into the "entering
// door" state (`CODE_player_state_0A_entering_door` → the shared warp routine
// `CODE_02A4B5`), NO sprite involved.
//
// IMPORTANT — the `enemy-pipe` secondary tag ($14, page $7D) is NOT a player
// warp. It is the ENEMY-SPAWN gate: Shy Guy / Lantern Ghost / Boo Guy inits read
// it (`CODE_0EB8AE`) to become generators that emit enemies from the pipe (the
// neighbour-dep "Class F" relationship). An earlier version of this module wrongly
// treated tag == pipe as an exit type, over-flagging every pipe OBJECT that merely
// stamps a pipe-mouth tile. Pipes warp via a co-located ENTRANCE SPRITE (below),
// not the tile — so pipe objects ($3C/$A5/$A6 vertical/double-ended, sewage
// entrances $6D-$70, keyed pipe $E0) carry NO object exitTrigger flag; their
// screen exit is the entrance sprite on the same screen. (Verified: pages $79/$7D
// have no door bit; only $18 does — see the asm trace in CODE_0EB8AE + CODE_02A4B5.)
//
// The set is derived by intersecting the DOOR pages (DR|BD) with each object's
// emulator-captured stamp tiles — see tmp/derive-object-exit-triggers.mjs.
// Current set: ext $88 only (Sewage pipe hole — stamps the $18 DR-door page).
//
// CAUTION: do NOT trust the codegraph's symbol names here — $F0-$F3 are labeled
// "PipeVerticalEnterable" but are actually Moving 3D Stones (their init registers
// the moving-object table $70:449E; they are not enterable). The collision class
// + an in-game test are the reliable signal, not symbol names.

import { getObjectInfo, getSprite } from './obj-metadata'

/** True if this sprite id's handler fires a screen exit (door / pipe / teleport). */
export function isExitTriggerSprite(num: number): boolean {
  return getSprite(num).exitTrigger
}

/** True if this object stamps a screen-exit collision tile (pipe mouth / door).
 *  `num===0` ⇒ extended object indexed by `exnum`; otherwise standard. */
export function isExitTriggerObject(num: number, exnum?: number): boolean {
  return getObjectInfo(num, exnum).exitTrigger
}
