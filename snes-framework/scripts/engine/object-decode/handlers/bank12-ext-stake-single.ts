// Bank12 extended-object handler — ext $16 single-cell stake-on-existing-floor.
//
//
// Cart entry CODE_extobj_handler_stake_single ($12:8967):
//   JSR.w CODE_get_current_map16_tile   ; latch existing cell tile → $12, offset → $1D
//   REP.b #$30
//   JSL.l CODE_12A734
//   SEP.b #$30
//   RTL
//
// Per-cell stamp CODE_12A734 ($12:A734):
//   LDX.b $1D
//   JSL.l CODE_item_memory_bit_lookup   ; A != 0 → flag SET → skip stamp
//   BNE.b CODE_12A748
//   LDA.b $12 ; AND.w #$00FF ; ORA.w $1DF8   ; (existing tile low byte) | template slot $1DF8
//   STA.l !RAM_YI_Level_LevelDataBuffer,x
// CODE_12A748:
//   RTL
//
// Single-cell stamp. UNLIKE the bare template/constant stampers ($15
// 1x1-block, $17 special-coin), the stake ORs template slot $1DF8 onto the
// LOW BYTE of the existing cell's Map16 id — so the stake's high-byte
// attributes overlay whatever floor tile is already there. The trace cell
// hits an empty cell ($12 = 0), so output = $0000 | $A300 = $A300.
//
// Gate: CODE_item_memory_bit_lookup (= CODE_item_memory_bit_lookup, Bank01:13063) is a
// cross-bank level-state / savefile flag probe, unavailable at static-decode
// time. We model it as "clear" (= proceed with stamp), matching the trace.
//
// $1DF8 isn't in the TT named-slot table (which covers the floor/structural
// families $19DA-$1D8A); use the raw WRAM address.

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState } from '../state.ts';
import { getCurrentMap16Tile } from '../fetch.ts';
import { stampCell } from './_shared.ts';

// Template slot $1DF8 — stake-segment Map16 id (per-tileset). Not in TT.
const SLOT_STAKE = 0x001DF8;

// CODE_12A734 — per-cell stamp. Item-memory gate modelled as "clear".
function stampStakeSingle(state: DecodeState): void {
  // JSR CODE_get_current_map16_tile — latch existing tile ($12) + offset ($1D).
  getCurrentMap16Tile(state);
  // LDA $12 ; AND #$00FF ; ORA $1DF8 — overlay the stake onto the cell's low byte.
  const tile = (state.zp12 & 0x00ff) | state.templateAt(SLOT_STAKE);
  stampCell(state, tile);
}

export function installExtStakeSingleHandlers(): void {
  registerExtObjectHandler(0x16, stampStakeSingle);
}
