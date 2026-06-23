// Bank13 bg-autotile-decor-lookup stamp handler + Bank12 init wrapper.
//
// Standard object $4F — bg_autotile_decor_lookup ("decorative tile-pack
// with 188-entry lookup"). Per-cell handler probes each of the four
// neighbours, and for every neighbour whose Map16 PAGE byte matches the
// `Family1B00_Anchor` template ($1A62), rewrites that neighbour by
// indexing its low byte into a direction-specific LUT
// (above/below/right/left). Then it rewrites the current cell from a
// 256-entry self-tile LUT keyed by the cell's existing low byte —
// turning a freshly-stamped structural tile into the matching decorated
// variant given its neighbour shape, autotile-style.
//
// The init is a plain `walker_setup_trampoline` — no DP mutation, just
// rect-extents-as-streamed + stamp `CODE_stamp_bg_autotile_decor_lookup`. (Spec confirms init DP
// delta is identity.)
//
// Asm sources:
//   CODE_init_bg_autotile_decor_lookup     Bank12.asm:3702  ($12:97BD)
//   CODE_stamp_bg_autotile_decor_lookup    Bank13.asm:6299  ($13:B13F)
//   CODE_decor_lookup_neighbour_probe      Bank13.asm:6336  ($13:B190)
//   DATA_decor_lookup_above_tiles          Bank13.asm:6370  ($13:B1B0)
//   DATA_decor_lookup_below_tiles          Bank13.asm:6397  ($13:B32E)
//   DATA_decor_lookup_right_tiles          Bank13.asm:6424  ($13:B4AC)
//   DATA_decor_lookup_left_tiles           Bank13.asm:6451  ($13:B62A)
//   DATA_decor_lookup_self_tiles           Bank13.asm:6478  ($13:B7A8)

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { getMap16Above, getMap16Below, getMap16Left, getMap16Right } from '../fetch.ts';
import { TT } from '../template-slots.ts';
import { readBuf16, setProbeToCurrent, writeBuf16, stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// Direction LUTs.
//
// Each is a 191-entry table of template-slot ADDRESSES in the $1A62
// structural family. The probe reads the matched neighbour's low byte
// as a u8 index, fetches the address from this table, then
// dereferences that address through the template page to get the final
// Map16 ID written back to the neighbour cell. We store the slot
// addresses verbatim from the asm (`!RAM_YI_Level_TileTpl_Family1B00_Anchor`
// = $1A62) so `state.templateAt(slot)` runs the per-tileset
// dereference at runtime.
//
// Length 191 = $BF. The neighbour's high-byte CMP against
// Family1B00_Anchor's PAGE byte already gates against off-family tiles,
// so the low-byte index is bounded in practice to whatever the cart's
// $1A62-family table reaches; the asm `LDA ($0A),y` for low bytes >=
// 191 would walk into the adjacent table — same hazard handled here by
// an explicit length check.
// ─────────────────────────────────────────────────────────────────────

const ANCHOR = TT.Family1B00_Anchor;            // $001A62
const WIDE_FLOOR = TT.WideFloorPage_Anchor;     // $001BE0
const FLR0_LL = TT.FloorRow0_LeftLo;            // $001C5C
const FLR0_RL = TT.FloorRow0_RightLo;           // $001C5E

const DATA_decor_lookup_above_tiles: ReadonlyArray<number> = [
  0x1A74, 0x1A76, 0x1A78, 0x1A6E, 0x1A70, 0x1A72, 0x1A6E, 0x1A70,
  0x1A72, 0x1A74, 0x1A76, 0x1A78, 0x1A80, 0x1A7E, 0x1A7E, 0x1A80,
  0x1A94, 0x1A96, 0x1A98, 0x1A8E, 0x1A90, 0x1A92, 0x1A8E, 0x1A90,
  0x1A92, 0x1A94, 0x1A96, 0x1A98, 0x1AA0, 0x1A9E, 0x1A9E, 0x1AA0,
  0x1AA6, 0x1AAC, 0x1AA6, 0x1AAE, 0x1AB0, 0x1AAC, 0x1AAE, 0x1AB0,
  0x1AB4, 0x1AB4, 0x1AB8, 0x1AB8, 0x1ABE, 0x1AC4, 0x1ABE, 0x1AC6,
  0x1AC8, 0x1AC4, 0x1AC6, 0x1AC8, 0x1ACA, 0x1ACC, 0x1ACE, 0x1AD0,
  0x1AD8, 0x1ADA, 0x1ADC, 0x1AD8, 0x1ADA, 0x1ADC, 0x1AE0, 0x1AE0,
  0x1AE2, 0x1AE4, 0x1AE6, 0x1AE8, 0x1AEA, 0x1AEC, 0x1AEE, 0x1AF0,
  0x1AF2, 0x1AF4, 0x1AF6, 0x1AF8, 0x1AFA, 0x1AFC, 0x1B02, 0x1B04,
  0x1B02, 0x1B04, 0x1B0A, 0x1B0C, 0x1B0A, 0x1B0C, 0x1B0E, 0x1B10,
  0x1B12, 0x1B14, 0x1B16, 0x1B18, 0x1B1A, 0x1B1C, 0x1B1E, 0x1B20,
  0x1B22, 0x1B24, 0x1B26, 0x1B28, 0x1B2A, 0x1B2C, 0x1B42, 0x1B30,
  0x1B46, 0x1B4A, 0x1B3E, 0x1B40, 0x1B3A, 0x1B30, 0x1B3E, 0x1B40,
  0x1B42, 0x1B48, 0x1B46, 0x1B48, 0x1B4A, 0x1B3A, 0x1B52, 0x1B58,
  0x1B52, 0x1B5A, 0x1B5C, 0x1B58, 0x1B5A, 0x1B5C, 0x1B5E, 0x1B60,
  0x1B62, 0x1B68, 0x1B6A, 0x1B68, 0x1B6A, 0x1B6C, 0x1B6E, 0x1B70,
  0x1B72, 0x1B74, 0x1B7A, 0x1B80, 0x1B7A, 0x1B82, 0x1B84, 0x1B80,
  0x1B82, 0x1B84, 0x1B8A, 0x1B8C, 0x1B8A, 0x1B8C, 0x1B94, 0x1B96,
  0x1B98, 0x1B94, 0x1B96, 0x1B98, 0x1B9C, 0x1B9C, 0x1BA2, 0x1BA4,
  0x1BA2, 0x1BA4, 0x1BA6, 0x1BA8, 0x1BAA, 0x1BAC, 0x1BAE, 0x1BB0,
  0x1BB2, 0x1BB4, 0x1BB6, 0x1BB8, 0x1BBA, 0x1BBC, 0x1BC2, 0x1BC8,
  0x1BC2, 0x1BCA, 0x1BCC, 0x1BC8, 0x1BCA, 0x1BCC, 0x1BCE, 0x1BD0,
  0x1BD2, 0x1BD4, 0x1BD8, 0x1BD8, 0x1BDA, 0x1BDC, 0x1BDE,
];

const DATA_decor_lookup_below_tiles: ReadonlyArray<number> = [
  ANCHOR, 0x1A64, 0x1A66, ANCHOR, 0x1A64, 0x1A66, 0x1A74, 0x1A76,
  0x1A78, 0x1A74, 0x1A76, 0x1A78, 0x1A7A, 0x1A7A, 0x1A80, 0x1A80,
  0x1A82, 0x1A84, 0x1A86, 0x1A82, 0x1A84, 0x1A86, 0x1A94, 0x1A96,
  0x1A98, 0x1A94, 0x1A96, 0x1A98, 0x1A9A, 0x1A9A, 0x1AA0, 0x1AA0,
  0x1AA2, 0x1AA4, 0x1AA6, 0x1AA2, 0x1AA4, 0x1AAC, 0x1AA6, 0x1AAC,
  0x1AB2, 0x1AB4, 0x1AB2, 0x1AB4, 0x1ABA, 0x1ABC, 0x1ABE, 0x1ABA,
  0x1ABC, 0x1AC4, 0x1ABE, 0x1AC4, 0x1ACA, 0x1ACC, 0x1ACE, 0x1AD0,
  0x1AD2, 0x1AD4, 0x1AD6, 0x1AD8, 0x1ADA, 0x1ADC, 0x1ADE, 0x1AE0,
  0x1AE6, 0x1AE8, 0x1AE6, 0x1AE8, 0x1AF0, 0x1AF2, 0x1AF4, 0x1AF0,
  0x1AF2, 0x1AF4, 0x1AF8, 0x1AF8, 0x1AFA, 0x1AFC, 0x1AFE, 0x1B00,
  0x1B02, 0x1B04, 0x1B06, 0x1B08, 0x1B0A, 0x1B0C, 0x1B12, 0x1B14,
  0x1B12, 0x1B14, 0x1B1A, 0x1B1C, 0x1B1A, 0x1B1C, 0x1B2A, 0x1B20,
  0x1B22, 0x1B24, 0x1B20, 0x1B22, 0x1B2A, 0x1B24, 0x1B44, 0x1B30,
  0x1B32, 0x1B34, 0x1B32, 0x1B34, 0x1B30, 0x1B3C, 0x1B46, 0x1B4A,
  0x1B48, 0x1B44, 0x1B46, 0x1B48, 0x1B4A, 0x1B3C, 0x1B4E, 0x1B50,
  0x1B52, 0x1B4E, 0x1B50, 0x1B58, 0x1B52, 0x1B58, 0x1B70, 0x1B72,
  0x1B74, 0x1B64, 0x1B66, 0x1B68, 0x1B6A, 0x1B6E, 0x1B6E, 0x1B70,
  0x1B72, 0x1B74, 0x1B76, 0x1B78, 0x1B7A, 0x1B76, 0x1B78, 0x1B80,
  0x1B7A, 0x1B80, 0x1B86, 0x1B88, 0x1B8A, 0x1B8C, 0x1B8E, 0x1B90,
  0x1B92, 0x1B94, 0x1B96, 0x1B98, 0x1B9A, 0x1B9C, 0x1B9E, 0x1BA0,
  0x1BA2, 0x1BA4, 0x1BB2, 0x1BA8, 0x1BAA, 0x1BAC, 0x1BA8, 0x1BAA,
  0x1BB2, 0x1BAC, 0x1BBA, 0x1BBC, 0x1BBA, 0x1BBC, 0x1BBE, 0x1BC0,
  0x1BC2, 0x1BBE, 0x1BC0, 0x1BC8, 0x1BC2, 0x1BC8, 0x1BCE, 0x1BD0,
  0x1BD2, 0x1BD4, 0x1BD6, 0x1BD8, 0x1BDC, 0x1BDC, 0x1BDE,
];

const DATA_decor_lookup_right_tiles: ReadonlyArray<number> = [
  ANCHOR, ANCHOR, 0x1A7A, 0x1A68, 0x1A68, 0x1A7C, 0x1A6E, 0x1A6E,
  0x1A7E, 0x1A74, 0x1A74, 0x1A80, 0x1A7A, 0x1A7C, 0x1A7E, 0x1A80,
  0x1A82, 0x1A82, 0x1A9A, 0x1A88, 0x1A88, 0x1A9C, 0x1A8E, 0x1A8E,
  0x1A9E, 0x1A94, 0x1A94, 0x1AA0, 0x1A9A, 0x1A9C, 0x1A9E, 0x1AA0,
  0x1AA2, 0x1AA4, 0x1AA6, 0x1AA8, 0x1AAA, 0x1AAC, 0x1AAE, 0x1AB0,
  0x1AB2, 0x1AB4, 0x1AB6, 0x1AB8, 0x1ABC, 0x1ABC, 0x1AC4, 0x1AC2,
  0x1AC2, 0x1AC4, 0x1AC8, 0x1AC8, 0x1ACA, 0x1ACA, 0x1AD0, 0x1AD0,
  0x1AD2, 0x1AD2, 0x1ADE, 0x1AD8, 0x1AD8, 0x1AE0, 0x1ADE, 0x1AE0,
  0x1AE4, 0x1AE4, 0x1AE8, 0x1AE8, 0x1AEA, 0x1AEA, 0x1AF6, 0x1AF0,
  0x1AF0, 0x1AF8, 0x1AF6, 0x1AF8, 0x1AFC, 0x1AFC, 0x1AFE, 0x1B00,
  0x1B02, 0x1B04, 0x1B08, 0x1B08, 0x1B0C, 0x1B0C, 0x1B0E, 0x1B10,
  0x1B12, 0x1B14, 0x1B18, 0x1B18, 0x1B1C, 0x1B1C, 0x1B26, 0x1B20,
  0x1B24, 0x1B24, 0x1B26, 0x1B2C, 0x1B20, 0x1B2C, 0x1B36, 0x1B30,
  0x1B32, 0x1B3C, 0x1B36, 0x1B4C, 0x1B3A, 0x1B3C, 0x1B3E, 0x1B3A,
  0x1B3E, 0x1B32, 0x1B46, 0x1B46, 0x1B30, 0x1B4C, 0x1B50, 0x1B50,
  0x1B58, 0x1B56, 0x1B56, 0x1B58, 0x1B5C, 0x1B5C, 0x1B5E, 0x1B5E,
  0x1B6C, 0x1B66, 0x1B66, 0x1B6A, 0x1B6A, 0x1B6C, 0x1B6E, 0x1B70,
  0x1B70, 0x1B6E, 0x1B76, 0x1B78, 0x1B7A, 0x1B7C, 0x1B7E, 0x1B80,
  0x1B82, 0x1B84, 0x1B86, 0x1B88, 0x1B8A, 0x1B8C, 0x1B8E, 0x1B8E,
  0x1B9A, 0x1B94, 0x1B94, 0x1B9C, 0x1B9A, 0x1B9C, 0x1BA0, 0x1BA0,
  0x1BA4, 0x1BA4, 0x1BA8, 0x1BA8, 0x1BAC, 0x1BAC, 0x1BAE, 0x1BB4,
  0x1BA8, 0x1BB4, 0x1BB6, 0x1BB8, 0x1BBA, 0x1BBC, 0x1BC0, 0x1BC0,
  0x1BC8, 0x1BC6, 0x1BC6, 0x1BC8, 0x1BCC, 0x1BCC, 0x1BCE, 0x1BD0,
  0x1BD4, 0x1BD4, 0x1BD6, 0x1BD8, 0x1BDA, 0x1BDC, 0x1BDE,
];

const DATA_decor_lookup_left_tiles: ReadonlyArray<number> = [
  0x1A7A, 0x1A66, 0x1A66, 0x1A7C, 0x1A6C, 0x1A6C, 0x1A7E, 0x1A72,
  0x1A72, 0x1A80, 0x1A78, 0x1A78, 0x1A7A, 0x1A7C, 0x1A7E, 0x1A80,
  0x1A9A, 0x1A86, 0x1A86, 0x1A9C, 0x1A8C, 0x1A8C, 0x1A9E, 0x1A92,
  0x1A92, 0x1AA0, 0x1A98, 0x1A98, 0x1A9A, 0x1A9C, 0x1A9E, 0x1AA0,
  0x1AA4, 0x1AA4, 0x1AAC, 0x1AAA, 0x1AAA, 0x1AAC, 0x1AB0, 0x1AB0,
  0x1AB2, 0x1AB4, 0x1AB6, 0x1AB8, 0x1ABA, 0x1ABC, 0x1ABE, 0x1AC0,
  0x1AC2, 0x1AC4, 0x1AC6, 0x1AC8, 0x1AD0, 0x1ACE, 0x1ACE, 0x1AD0,
  0x1ADE, 0x1AD6, 0x1AD6, 0x1AE0, 0x1ADC, 0x1ADC, 0x1ADE, 0x1AE0,
  0x1AE2, 0x1AE4, 0x1AE6, 0x1AE8, 0x1AF6, 0x1AEE, 0x1AEE, 0x1AF8,
  0x1AF4, 0x1AF4, 0x1AF6, 0x1AF8, 0x1AFA, 0x1AFC, 0x1B00, 0x1B00,
  0x1B04, 0x1B04, 0x1B06, 0x1B08, 0x1B0A, 0x1B0C, 0x1B10, 0x1B10,
  0x1B14, 0x1B14, 0x1B16, 0x1B18, 0x1B1A, 0x1B1C, 0x1B28, 0x1B24,
  0x1B22, 0x1B24, 0x1B2C, 0x1B28, 0x1B22, 0x1B2C, 0x1B38, 0x1B30,
  0x1B3C, 0x1B34, 0x1B4C, 0x1B38, 0x1B3A, 0x1B3C, 0x1B3A, 0x1B40,
  0x1B40, 0x1B34, 0x1B30, 0x1B4A, 0x1B4A, 0x1B4C, 0x1B4E, 0x1B50,
  0x1B52, 0x1B54, 0x1B56, 0x1B58, 0x1B5A, 0x1B5C, 0x1B6C, 0x1B62,
  0x1B6C, 0x1B64, 0x1B66, 0x1B68, 0x1B6A, 0x1B6C, 0x1B6E, 0x1B6E,
  0x1B74, 0x1B74, 0x1B78, 0x1B78, 0x1B80, 0x1B7E, 0x1B7E, 0x1B80,
  0x1B84, 0x1B84, 0x1B88, 0x1B88, 0x1B8C, 0x1B8C, 0x1B9A, 0x1B92,
  0x1B92, 0x1B9C, 0x1B98, 0x1B98, 0x1B9A, 0x1B9C, 0x1B9E, 0x1BA0,
  0x1BA2, 0x1BA4, 0x1BB0, 0x1BAC, 0x1BAA, 0x1BAC, 0x1BB4, 0x1BB0,
  0x1BAA, 0x1BB4, 0x1BB8, 0x1BB8, 0x1BBC, 0x1BBC, 0x1BBE, 0x1BC0,
  0x1BC2, 0x1BC4, 0x1BC6, 0x1BC8, 0x1BCA, 0x1BCC, 0x1BD0, 0x1BD0,
  0x1BD2, 0x1BD4, 0x1BD6, 0x1BD8, 0x1BDA, 0x1BDC, 0x1BDE,
];

// ─────────────────────────────────────────────────────────────────────
// DATA_decor_lookup_self_tiles (Bank13.asm:6478).
//
// 190 entries (asm `dw` count). Indexed as `LDA $12; AND #$00FF; ASL;
// TAY; LDA DATA_decor_lookup_self_tiles,y` — i.e. tile low byte × 2 → word fetch. Low
// bytes >= 190 fall off the end (cart would read adjacent code; we
// length-gate). A zero entry means "ERASE the cell (stamp $0000)": the
// cart `BEQ.b CODE_13B187` branches over the second indirection but lands
// on the shared `STA buffer,x` with A still $0000, so the cell is cleared.
// (This is the "sand block remover" path.) Non-zero entries are either:
//   - direct Map16 IDs ($1BE6, $1C04, etc. — outside Family1B00, in
//     the wide-floor template page), OR
//   - template-slot ADDRESSES that get dereferenced through the
//     template page (`WideFloorPage_Anchor` $1BE0, `FloorRow0_LeftLo`
//     $1C5C, `FloorRow0_RightLo` $1C5E).
//
// We can't distinguish "raw Map16 ID" vs "slot address" by value alone:
// $1BE0 and $1C5C are valid as both. Cart logic: the second `LDA $0000,y`
// in CODE_stamp_bg_autotile_decor_lookup-area unconditionally treats the table entry as a slot
// address and dereferences through Bank 0 WRAM to get the Map16 ID.
// (See line 6328-6329: `TAY ; LDA $0000,y`.) So EVERY non-zero entry is
// a slot address that needs templateAt() lookup.
//
// Slots ≥ $1A62 and < $1FFC fall within the populated template-page
// range; slots outside that range (e.g. $1BE6 looks like a slot but
// isn't named in WRAM_LevelTemplateSlots.asm) still get a templateAt
// read at runtime — the template page covers $19DA..$1FDA so any
// in-range address is valid.
// ─────────────────────────────────────────────────────────────────────

const DATA_decor_lookup_self_tiles: ReadonlyArray<number> = [
  0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
  0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
  0x1C04, 0x1C04, 0x1C04, 0x1C04, 0x1C04, 0x1C04, 0x1C04, 0x1C04,
  0x1C04, 0x1C04, 0x1C04, 0x1C04, 0x1C04, 0x1C04, 0x1C04, 0x1C04,
  0x1BF8, 0x1BF8, 0x1BF8, 0x1BF8, 0x1BF8, 0x1BF8, 0x1BF8, 0x1BF8,
  WIDE_FLOOR, WIDE_FLOOR, WIDE_FLOOR, WIDE_FLOOR, 0x1BFA, 0x1BFA, 0x1BFA, 0x1BFA,
  0x1BFA, 0x1BFA, 0x1BFA, 0x1BFA, 0x1BE6, 0x1BE6, 0x1BE6, 0x1BE6,
  0x1BF4, 0x1BF4, 0x1BF4, 0x1BF4, 0x1BF4, 0x1BF4, 0x1BF4, 0x1BF4,
  0x1BEE, 0x1BEE, 0x1BEE, 0x1BEE, 0x1BF6, 0x1BF6, 0x1BF6, 0x1BF6,
  0x1BF6, 0x1BF6, 0x1BF6, 0x1BF6, 0x1C30, 0x1C30, 0x1BFC, 0x1BFC,
  0x1BFC, 0x1BFC, 0x1BFE, 0x1BFE, 0x1BFE, 0x1BFE, 0x1C00, 0x1C00,
  0x1C00, 0x1C00, 0x1C02, 0x1C02, 0x1C02, 0x1C02, 0x1C1A, 0x1C1A,
  0x1C1A, 0x1C1A, 0x1C1A, 0x1C1A, 0x1C1A, 0x1C1A, 0x1C18, 0x1C18,
  0x1C18, 0x1C18, 0x1C18, 0x1C18, 0x1C18, 0x1C18, 0x1C18, 0x1C18,
  0x1C18, 0x1C18, 0x1C18, 0x1C18, 0x1C18, 0x1C18, 0x1BF0, 0x1BF0,
  0x1BF0, 0x1BF0, 0x1BF0, 0x1BF0, 0x1BF0, 0x1BF0, FLR0_LL, FLR0_RL,
  FLR0_LL, 0x1C2E, 0x1C2E, 0x1C2E, 0x1C2E, FLR0_LL, FLR0_RL, FLR0_LL,
  FLR0_RL, FLR0_LL, 0x1BF2, 0x1BF2, 0x1BF2, 0x1BF2, 0x1BF2, 0x1BF2,
  0x1BF2, 0x1BF2, 0x1BEC, 0x1BEC, 0x1BEC, 0x1BEC, 0x1BE4, 0x1BE4,
  0x1BE4, 0x1BE4, 0x1BE4, 0x1BE4, 0x1BE4, 0x1BE4, 0x1BEA, 0x1BEA,
  0x1BEA, 0x1BEA, 0x1BE2, 0x1BE2, 0x1BE2, 0x1BE2, 0x1BE2, 0x1BE2,
  0x1BE2, 0x1BE2, 0x1BE8, 0x1BE8, 0x1BE8, 0x1BE8, 0x1C32, 0x1C32,
  0x1C32, 0x1C32, 0x1C32, 0x1C32, 0x1C32, 0x1C32, 0x1C34, 0x1C34,
  0x1C36, 0x1C36, 0x1C38, 0x1C38, 0x1C3A, 0x1C3A,
];

// ─────────────────────────────────────────────────────────────────────
// CODE_decor_lookup_neighbour_probe ($13:B190, Bank13.asm:6336).
//
//   neighbour = buffer[neighbourOff]
//   if (neighbour & $FF00) != Family1B00_Anchor: return
//   slot = table[neighbour & $00FF]
//   buffer[neighbourOff] = templateAt(slot)
//
// Cart uses an `LDA ($0A),y` indirect-Y over the table pointer in DP $0A
// followed by `LDA $0000,y` to dereference the slot. We collapse those
// two steps into a single direct array index + templateAt call — the
// effective semantics match.
// ─────────────────────────────────────────────────────────────────────

function decorLookupNeighbourProbe(
  state: DecodeState,
  neighbourOff: number,
  table: ReadonlyArray<number>,
): void {
  const neighbour = readBuf16(state, neighbourOff);
  const anchor = state.templateAt(ANCHOR);
  // Compare PAGE byte (high byte of Map16 ID) against the anchor's PAGE
  // byte. Cart: `LDA buffer,x ; AND #$FF00 ; CMP $1A62`. The anchor is
  // itself page-aligned in the cart's structural mapping, so a direct
  // word CMP works — the asm doesn't mask the anchor.
  if ((neighbour & 0xFF00) !== (anchor & 0xFF00)) return;

  const idx = neighbour & 0x00FF;
  if (idx >= table.length) return; // safety: cart would walk into adjacent data
  const slot = table[idx]!;
  const replacement = state.templateAt(slot);
  writeBuf16(state, neighbourOff, replacement);
}

// ─────────────────────────────────────────────────────────────────────
// Per-cell handler — CODE_stamp_bg_autotile_decor_lookup ($13:B13F).
//
//   1. Probe above neighbour → maybe rewrite via above-table.
//   2. Probe below neighbour → maybe rewrite via below-table.
//   3. Probe right neighbour → maybe rewrite via right-table.
//   4. Probe left  neighbour → maybe rewrite via left-table.
//   5. Self-lookup: idx = $12 & $FF; entry = DATA_decor_lookup_self_tiles[idx].
//      If entry == 0: stamp $0000 — i.e. ERASE the cell (the cart's `BEQ`
//        falls onto the shared `STA buffer,x` with A still $0000). This is
//        the "sand block remover" behaviour: sand low bytes $00..$0F all map
//        to the 16 zero entries → cleared.
//      Else: dereference entry through templateAt and stamp the result.
//
// The walker has already latched the current cell's Map16 ID into $12
// (via `getCurrentMap16Tile` / `latchCell`), so we read `state.zp12`
// for the self-lookup index directly. The probes do NOT use $12 — they
// each re-set $0E from $1B (cart `LDA $1B ; STA $0E`) before stepping
// the neighbour-fetch primitive.
//
// Probe helpers (`probe_right_tile` / `probe_left_tile` in asm at
// $13:FD54 / $13:FD61) just do `$0E ← $1B ; JSL get_map16_dir ;
// LDA buffer,x`. We inline that as `setProbeToCurrent + getMap16Right`
// (etc.) followed by `readBuf16` inside `decorLookupNeighbourProbe` —
// matches the pattern used in `bank13-castle-wall.ts`.
// ─────────────────────────────────────────────────────────────────────

const bgAutotileDecorLookupStamp: PerCellHandler = (state) => {
  // Above probe.
  setProbeToCurrent(state);
  const aboveOff = getMap16Above(state);
  decorLookupNeighbourProbe(state, aboveOff, DATA_decor_lookup_above_tiles);

  // Below probe.
  setProbeToCurrent(state);
  const belowOff = getMap16Below(state);
  decorLookupNeighbourProbe(state, belowOff, DATA_decor_lookup_below_tiles);

  // Right probe. Cart `JSR probe_right_tile` = $0E ← $1B + get_map16_right.
  setProbeToCurrent(state);
  const rightOff = getMap16Right(state);
  decorLookupNeighbourProbe(state, rightOff, DATA_decor_lookup_right_tiles);

  // Left probe.
  setProbeToCurrent(state);
  const leftOff = getMap16Left(state);
  decorLookupNeighbourProbe(state, leftOff, DATA_decor_lookup_left_tiles);

  // Self lookup: idx = $12 low byte. Entry 0 → CLEAR the cell ($0000).
  //
  // Cart (CODE_stamp_bg_autotile_decor_lookup, $13:B191-..):
  //   LDA DATA_decor_lookup_self_tiles,y ; BEQ CODE_13B187 ; TAY ; LDA $0000,y
  //   CODE_13B187: LDX $1D ; STA buffer,x
  // On a zero table entry the `BEQ` lands on the shared `STA` with A
  // STILL $0000 (it skips the TAY+deref, not the store) — so the cell is
  // written to $0000, i.e. ERASED. This is what makes std $4F the "sand
  // block remover": sand-family tiles have low bytes $00..$0F, all of
  // which index the 16 zero entries at the head of the self-table and so
  // get cleared. (Other low bytes index real slots → decorated variant.)
  // The earlier `return` here was wrong — it left the original tile in
  // place, so sand was never removed.
  const selfIdx = state.zp12 & 0xFF;
  if (selfIdx >= DATA_decor_lookup_self_tiles.length) {
    // Cart out-of-bounds read. DATA_decor_lookup_self_tiles is exactly 190
    // entries; `CODE_stamp_graffiti_rail` ($13:B924) immediately follows it. So
    // for a low byte >= 190 the cart's `LDA DATA_decor_lookup_self_tiles,y` reads
    // that routine's OPCODE BYTES as a "slot address", then `TAY ; LDA $0000,y`
    // derefs it through the $0000-1FFF WRAM mirror. The only index that occurs in
    // the shipped catalog is $BF — a diag-end cap ($00BF) sitting under a $4F
    // cell, records $3D/$8A. There the slot bytes are $15A5 (the encoding of
    // `LDA.b $15`), which derefs ambient-sprite RAM $15A5 (= AmbSpr_XAccelCeil
    // base $15A0 + 5) — uninitialised at object-decode time, holding $00C9 (a
    // diag-wall connector) in every observed case. That WRAM value is NOT
    // statically derivable, so the OOB indices that actually occur are pinned to
    // their observed deref result. (See DATA_decor_lookup_self_oob.)
    const oob = DATA_decor_lookup_self_oob[selfIdx];
    if (oob !== undefined) stampCell(state, oob);
    return;
  }
  const selfSlot = DATA_decor_lookup_self_tiles[selfIdx]!;
  if (selfSlot === 0) {
    stampCell(state, 0x0000); // cart `BEQ CODE_13B187` stores A=$0000
    return;
  }
  const selfTile = state.templateAt(selfSlot);
  stampCell(state, selfTile);
};

/** Out-of-bounds self-lookup results (low byte >= 190). The cart reads past
 *  the 190-entry self-table into `CODE_stamp_graffiti_rail`'s bytes and derefs
 *  the result through the WRAM mirror; the deref target is non-template RAM
 *  whose decode-time value isn't statically modellable. Only idx $BF occurs in
 *  the shipped catalog (records $3D/$8A): slot $15A5 → ambient-sprite RAM
 *  $15A5 = $00C9. Pinned to the observed value; gated by the sweep. A new level
 *  that hit a different OOB index (or left a different value in $15A5) would
 *  need its own entry — `sweep-levels` / the warp comparator would flag it. */
const DATA_decor_lookup_self_oob: Record<number, number> = {
  0xBF: 0x00C9,
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_bg_autotile_decor_lookup ($12:97BD, Bank12.asm:3702).
//
// Plain walker-setup trampoline — no DP mutation, all 3 handler slots
// point at the stamp handler. (Spec confirms init DP delta is identity.)
// ─────────────────────────────────────────────────────────────────────

function initBgAutotileDecorLookup(state: DecodeState): void {
  walkerSetupTrampoline(state, bgAutotileDecorLookupStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installBgAutotileDecorLookupHandlers(): void {
  registerStdObjectHandler(0x4F, initBgAutotileDecorLookup);
}
