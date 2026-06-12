// How the obj-metadata `exitTrigger` flag is set — provenance, so the pre-baked
// data in obj-metadata.json stays reproducible. The flag lives in the JSON; this
// module documents its origin and exposes predicates that read it back.
//
// ═══════════════════════════════════════════════════════════════════════════
// THREE INDEPENDENT engine mechanisms fire a screen exit — all three are
// flagged. This list has been gotten wrong TWICE (first by over-flagging every
// pipe, then by declaring pipes sprite-only); the current model is verified
// against the asm AND a counterexample level. Before "simplifying" it again,
// re-test level 0x3B obj[279] (an Enterable vertical pipe with NO sprite on its
// screen — it warps) and read the GSU sites below. The 65816 side is NOT the
// whole story: the pipe-entry state write is a SuperFX `SMS` — invisible to
// plain text grep (xref DOES index GSU SM/SMS/LM/LMS since graph schema 6;
// `xref --writers !EXRAM_YI_Player_CurrentStateLo` now surfaces it).
// ═══════════════════════════════════════════════════════════════════════════
//
// 1. DOOR TILES (objects) — an object is a screen-exit when it stamps a tile
//    whose `bg_type_table` page carries a door bit (byte 1, DR | BD). The only
//    such page in this cart is $18. The player-collision read drives Yoshi into
//    `CODE_player_state_0A_entering_door` → the shared warp routine
//    `CODE_02A4B5`. Door SPRITES (the visible doors, $001/$012/$093/…) reach
//    state 0A via their own overlap check instead (`main_door`, see
//    docs/family-misc.md §1.4) — both roads lead to the same state.
//    Flagged object: ext $88 (Sewage pipe hole — stamps the $18 DR page).
//
// 2. ENTERABLE PIPE-MOUTH TILES (objects) — tile-driven pipe entry, NO sprite
//    involved. The GSU player collision probes (SuperFX Bank0B: head probe
//    ~`CODE_0BA3CE`, foot probe ~`CODE_0BD032`, plus a third site ~$0B:DC0D)
//    accept a tile when ALL hold:
//      - its page collision tag is $14 `pipe-mouth` (`R7 & $F800 == $A000`;
//        only page $7D carries it),
//      - the per-tile byte `DATA_0AEBBC[tile & $FF]` has the D-pad-matching
//        entry-direction bit (low nibble: $01/$02 horizontal, $04 down, $08 up;
//        high bits = alignment/orientation markers),
//      - Yoshi is aligned and pressing into the mouth.
//    `CODE_0BDC20` then commits: PipeTransitionType ($0106) derived from the
//    tile id (≥$7D0B ⇒ horizontal family) and PlayerState ← $06 (in-pipe walk
//    → state $08 → the exit index at $038E computed from Yoshi's position).
//    Flagged objects (mouth-tile stampers, derived by provenance-decoding one
//    shipped instance of every pipe-category object and intersecting its
//    page-$7D stamps with DATA_0AEBBC entry bits — tmp/derive-pipe-enterable.ts):
//      std $3C  Enterable vertical pipe      ($7D08/$7D09 → $04/$84)
//      std $A5  Double-ended vertical pipe   ($7D02/$7D03 → $04/$84)
//      std $A6  Double-ended horizontal pipe ($7D04/$7D05 → $00/$02)
//      ext $6D-$70 Sewage pipe entrances     ($7D0C-$7D1B, directional bits)
//      ext $E0  3D pipe with key paint       ($7D24/$7D25 → $04/$84)
//    The UN-enterable pipe family (std $F4 etc.) stamps the untagged page-$79
//    tiles instead — NO pipe-mouth tag at all — which is why shipped levels
//    pair those with an entrance sprite, and why the enemy gate (below) accepts
//    the hardcoded $79F1/$79F2 literals on top of the tag.
//
// 3. ENTRANCE SPRITES — door / pipe-entrance / horizontal-entrance / teleport
//    sprites whose Main funnels into the shared warp helper `CODE_02CDB9` (→
//    `CODE_02A4B5`, warp-fired flag $038C + gamemode $0B). Used to make the
//    un-enterable pipe family (and bare walls) warp. Flagged sprite ids are the
//    helper's call-graph callers (e.g. $042 Vertical Pipe Entrance, $0D0/$0D1
//    horizontal / secret entrances, $147, $084 Teleport). Regenerate with:
//      node snes-framework/scripts/cli.ts xref CODE_02CDB9 --callers
//      node snes-framework/scripts/cli.ts xref CODE_02A4B5 --callers
//
// RELATED BUT NOT AN EXIT: the same $14 `pipe-mouth` tag doubles as the
// ENEMY-SPAWN gate — Shy Guy / Lantern Ghost / Cactus Jack / Boo Guy inits call
// `CODE_0EB8AE` and, standing on a tagged tile (or $79F1/$79F2), become
// generators that emit enemies from the pipe (the neighbour-dep "Class F"
// relationship). The tag feeds BOTH mechanics; the per-tile DATA_0AEBBC entry
// bits are what gate the player warp.
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

/** True if this object stamps a screen-exit tile — a DR/BD door tile or a
 *  player-enterable pipe-mouth tile (see the three-mechanism note above).
 *  `num===0` ⇒ extended object indexed by `exnum`; otherwise standard. */
export function isExitTriggerObject(num: number, exnum?: number): boolean {
  return getObjectInfo(num, exnum).exitTrigger
}
