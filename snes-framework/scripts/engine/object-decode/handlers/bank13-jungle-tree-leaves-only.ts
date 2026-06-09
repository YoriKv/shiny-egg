// Standard object $36 — init_jungle_tree_leaves_only.
//
// Cart entry: CODE_init_jungle_tree_leaves_only @ $12:95FA (Bank12.asm:3435).
//
// REP #$20 ; LDA #$000B ; STA $A1 ; LDX #(CODE_jungle_tree_trunk_with_leaves-1) ;
// JMP CODE_walker_setup_trampoline.
//
// Object $36 is the "leaves-only" jungle-tree variant: it stamps only the
// leafy crown (with branch decorations and PRNG-driven side leaves),
// without a wooden trunk. The init writes the +$000B "leaf bias" to $A1
// (read by the shared trunk+leaves per-cell handler), then trampolines
// to the same `jungleTreeTrunkWithLeavesStamp` that $30/$31 dispatch.
// The "trunk-with-leaves" $31 sibling seeds $A1 differently to render
// trunk + leaves together; here the $A1 = $000B value shifts all leaf
// picks into the leaves-only Map16 family.

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { jungleTreeTrunkWithLeavesStamp } from './bank13-jungle-tree-trunk.ts';

const LEAVES_ONLY_BIAS = 0x000B;

function initJungleTreeLeavesOnly(state: DecodeState): void {
  state.zpA1 = LEAVES_ONLY_BIAS;
  walkerSetupTrampoline(state, jungleTreeTrunkWithLeavesStamp);
}

export function installJungleTreeLeavesOnlyHandlers(): void {
  registerStdObjectHandler(0x36, initJungleTreeLeavesOnly);
}
