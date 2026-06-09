// Bank13 bg-autotile-block stamp handler + Bank12 init wrapper.
//
// Standard object $4E — `bg_autotile_block`. The largest general-purpose
// autotiler in the cart: stamps a (length × height) rectangle of "BG
// ground-block" tiles, picking a Map16 ID per cell based on the cell's
// position within the rectangle (top-left / top-mid / top-right / etc.)
// and whether the cell already contains a same-family tile (class-aware
// merge).
//
// Used by levels for the general-purpose BG ground/floor structural
// object that drops the BG-class Family1B00 tiles (anchor template slot
// TT.Family1B00_Anchor = $001A62).
//
// Algorithm (CODE_stamp_bg_autotile_block @ $13:A9F6):
//   1) "Acceptance gate" — accept this cell if any of:
//        - current tile's high byte == Family1B00 anchor's high byte
//          (same family — class-aware merge path; Y stays 0)
//        - current tile == $0000 (blank buffer)
//        - current tile == $00C2 (canonical "writable BG-grid" marker)
//        - current tile dereferenced from any of 30 slot addresses in
//          DATA_bg_autotile_match_list (the recognition list) matches current tile
//      If none accept, skip the cell entirely (no stamp).
//   2) "Region select" — pick one of three top-level branches by
//      (col_extent == 1, row_extent == 1):
//        - 1×1 single cell: take Y as-is, look up the class subindex
//          table DATA_bg_autotile_class_list and stamp that.
//        - row_extent > 1, col_extent == 1: vertical strip → left-dispatch.
//        - col_extent > 1, row_extent == 1: horizontal strip → right-dispatch.
//        - both > 1: interior dispatch (3×3 grid by edge state).
//   3) The dispatch chooses one of 16 default 31-entry tile tables
//      (LL, LR, LB, RT, RM, RB, IT0..IB2) indexed by Y (the position
//      within the recognition list). The picked value is itself a
//      template-slot ADDRESS; dereferencing it (templateAt) yields the
//      Map16 ID to stamp.
//   4) Class-aware path: when the under-tile is already in the same
//      Family1B00 family, scan the CONTIGUOUS 16-table region that begins
//      at DATA_bg_autotile_class_list (the class list + the 15 connectivity tile tables
//      that follow it in memory; see CLASS_SCAN_TABLES) for the under-tile
//      and divide the match's byte offset by $3E into (col = which of the
//      16 tables, row = byte offset within it). `col` indexes one of the
//      per-cell class-jump tables (LR/LL/LB/RT/RM/RB/IT0/IT2/IB0/IB2),
//      whose entry selects a default branch above; `row` then indexes that
//      branch's tile table.
//
// Asm sources:
//   CODE_init_bg_autotile_block             Bank12.asm:3684  ($12:979D)
//   CODE_stamp_bg_autotile_block            Bank13.asm:5672  ($13:A9F6)
//   CODE_bg_autotile_vertical_strip_dispatch          Bank13.asm:5732  ($13:AA54)
//   CODE_bg_autotile_horizontal_strip_dispatch         Bank13.asm:5782  ($13:AAA2)
//   CODE_bg_autotile_interior_dispatch      Bank13.asm:5832  ($13:AAF0)
//   CODE_bg_autotile_classify_under         Bank13.asm:5997  ($13:AC04)
//   CODE_bg_autotile_class_subindex         Bank13.asm:6009  ($13:AC15)
//   DATA_bg_autotile_match_list             Bank13.asm:6037  ($13:AC3D) — 31-entry recognition list
//   DATA_bg_autotile_class_list             Bank13.asm:6044  ($13:AC7B) — 31-entry same-family sub-tile list
//   DATA_bg_autotile_LL/LR/LB/RT/RM/RB/IT0..IB2_tiles
//                                           Bank13.asm:6050-6153 — 16 × 31-entry default tile tables
//   DATA_bg_autotile_class_jump_LR/LL/LB/RT/RM/RB/IT0/IT2/IB0/IB2
//                                           Bank13.asm:6155-6297 — class-aware jump tables

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';
import { TT } from '../template-slots.ts';

// ─────────────────────────────────────────────────────────────────────
// "Always accept" constants (CODE_stamp_bg_autotile_block prologue).
// ─────────────────────────────────────────────────────────────────────

/** $00C2 — canonical "writable BG-grid" marker. Cells holding this
 *  value are unconditionally stampable. (Cart line 5682 `CMP #$00C2`.) */
const ACCEPT_BG_GRID_MARKER = 0x00C2;

// ─────────────────────────────────────────────────────────────────────
// DATA_bg_autotile_match_list (Bank13.asm:6037).
//
// 31-entry "recognition list" of template-slot ADDRESSES. Position 0 is
// $0000 (handled via the early-out `CMP #$0000` and never actually
// indexed — Y starts at 2 in the scan loop). Position [i] for i in 1..30
// is a slot address; the cart loads X = slot, then CMP $0000,x to test
// whether the under-tile equals that slot's dereferenced value.
//
// Match position (Y in bytes, /2 for entry index) determines the row
// (Y) reused by every downstream tile table (LL/LR/LB/RT/RM/RB/IT0..IB2).
// ─────────────────────────────────────────────────────────────────────

const DATA_bg_autotile_match_list: ReadonlyArray<number> = [
  0x0000,                  0x1C04,                       0x1BF8, 0x1BF2,
  0x1BFA,                  TT.WideFloorPage_Anchor,      0x1BF4, 0x1BE4,
  0x1BF6,                  0x1BE6,                       0x1BFC, 0x1BEC,
  0x1BFE,                  0x1BEA,                       0x1C00, 0x1BE8,
  0x1C02,                  0x1C1A,                       0x1BE2, 0x1C18,
  0x1BF0,                  0x1BEE,                       TT.FloorRow0_LeftLo, TT.FloorRow0_RightLo,
  0x1C2E,                  0x1C30,                       0x1C32, 0x1C34,
  0x1C36,                  0x1C38,                       0x1C3A,
];

// ─────────────────────────────────────────────────────────────────────
// DATA_bg_autotile_class_list (Bank13.asm:6044).
//
// 31-entry "same-family sub-tile" list. When the under-tile's high byte
// matches the Family1B00 anchor, CODE_bg_autotile_class_subindex scans for
// the under-tile's Map16 ID starting here — but the scan deliberately runs
// PAST the 31 entries (Y up to $3E0) into the 15 connectivity tile tables
// laid out immediately after this list in memory, treating the whole region
// as 16 consecutive 62-byte (31-entry) tables. The match offset / $3E gives
// (col = which table, row = entry within it). See CLASS_SCAN_TABLES +
// classSubindex, which reproduce that contiguous scan.
//
// Each entry is a template-slot ADDRESS (in $1A80..$1BDC range).
// ─────────────────────────────────────────────────────────────────────

const DATA_bg_autotile_class_list: ReadonlyArray<number> = [
  0x1A80, 0x1AA0, 0x1AAC, 0x1B80, 0x1AC4, 0x1AB4, 0x1AE0, 0x1B9C,
  0x1AF8, 0x1AD0, 0x1B04, 0x1B8C, 0x1B0C, 0x1BA4, 0x1B14, 0x1BBC,
  0x1B1C, 0x1B24, 0x1BAC, 0x1B30, 0x1B58, 0x1AE8, 0x1B6C, 0x1B6C,
  0x1B6A, 0x1AFC, 0x1BC8, 0x1BD0, 0x1BD4, 0x1BD8, 0x1BDC,
];

// ─────────────────────────────────────────────────────────────────────
// Default tile tables — 16 × 31 entries each, indexed by recognition
// position Y. Entries are template-slot ADDRESSES (dereference with
// templateAt to get the final Map16 ID).
//
// One per "region" identified by the dispatch: edge columns × edge rows
// (Left/Right vs Top/Mid/Bot) plus 3×3 interior cells.
//
// Naming:
//   LL = left column, left-mid row (interior of a vertical strip body)
//   LR = left column, mid-right row (per cart label; actually used for
//        interior rows of a vertical strip — see CODE_13AA6F)
//   LB = left column, bottom row
//   RT/RM/RB = right column, top/mid/bottom row
//   IT0/IT1/IT2 = interior left   column, rows top/mid/bot
//   IM0/IM1/IM2 = interior middle column, rows top/mid/bot
//   IB0/IB1/IB2 = interior right  column, rows top/mid/bot
//
// (The cart's "T/M/B" prefix maps to the COLUMN dimension via its
// dispatch-label aliases TL/TM/TR — i.e. "Top/Middle/Bottom" of the
// $28-column branch list, where Top=$28==0 means leftmost column.
// The 0/1/2 suffix indexes the row dimension.)
// ─────────────────────────────────────────────────────────────────────

const DATA_bg_autotile_LL_tiles: ReadonlyArray<number> = [
  0x1A7A, 0x1A9A, 0x1AA4, 0x1B78, 0x1ABC, 0x1AB2, 0x1ADE, 0x1B9A,
  0x1A7A, 0x1A7A, 0x1B00, 0x1B88, 0x1B08, 0x1BA0, 0x1A7A, 0x1A7A,
  0x1A7A, 0x1A7A, 0x1A7A, 0x1B3C, 0x1B50, 0x1A7A, 0x1B6E, 0x1B6E,
  0x1B66, 0x1AFA, 0x1BC0, 0x1BCE, 0x1BD2, 0x1BD6, 0x1BDA,
];
const DATA_bg_autotile_LR_tiles: ReadonlyArray<number> = [
  0x1A7C, 0x1A9C, 0x1AAA, 0x1B7E, 0x1AC2, 0x1AB6, 0x1A7C, 0x1A7C,
  0x1A7C, 0x1A7C, 0x1A7C, 0x1A7C, 0x1A7C, 0x1A7C, 0x1A7C, 0x1A7C,
  0x1A7C, 0x1A7C, 0x1A7C, 0x1BDE, 0x1B56, 0x1A7C, 0x1B6C, 0x1B6C,
  0x1B66, 0x1AFA, 0x1BC6, 0x1BD0, 0x1BD4, 0x1BD6, 0x1BDA,
];
const DATA_bg_autotile_LB_tiles: ReadonlyArray<number> = [
  0x1A7E, 0x1A9E, 0x1AB0, 0x1B84, 0x1AC8, 0x1AB8, 0x1A7E, 0x1A7E,
  0x1AF6, 0x1A7E, 0x1A7E, 0x1A7E, 0x1A7E, 0x1A7E, 0x1B10, 0x1BB8,
  0x1B18, 0x1B2C, 0x1BB4, 0x1B3A, 0x1B5C, 0x1AE4, 0x1B6C, 0x1B6C,
  0x1B66, 0x1AFA, 0x1BD8, 0x1BCE, 0x1BD2, 0x1BD6, 0x1BDA,
];
const DATA_bg_autotile_RT_tiles: ReadonlyArray<number> = [
  0x1A74, 0x1A94, 0x1AA6, 0x1B7A, 0x1A74, 0x1A74, 0x1AD8, 0x1B94,
  0x1AF0, 0x1ACA, 0x1B02, 0x1B8A, 0x1A74, 0x1A74, 0x1B12, 0x1BBA,
  0x1A74, 0x1B20, 0x1BA8, 0x1A74, 0x1A74, 0x1A74, 0x1B70, 0x1B70,
  0x1B68, 0x1AFC, 0x1BC2, 0x1BCE, 0x1BD2, 0x1BD6, 0x1BDA,
];
const DATA_bg_autotile_RM_tiles: ReadonlyArray<number> = [
  0x1A76, 0x1A96, 0x1A76, 0x1A76, 0x1A76, 0x1A76, 0x1ADA, 0x1B96,
  0x1AF2, 0x1ACC, 0x1A76, 0x1A76, 0x1A76, 0x1A76, 0x1A76, 0x1A76,
  0x1A76, 0x1B2A, 0x1BB2, 0x1A76, 0x1A76, 0x1A76, 0x1B72, 0x1B72,
  0x1B68, 0x1AFC, 0x1BC2, 0x1BCE, 0x1BD2, 0x1BD6, 0x1BDA,
];
const DATA_bg_autotile_RB_tiles: ReadonlyArray<number> = [
  0x1A78, 0x1A98, 0x1A78, 0x1A78, 0x1ABE, 0x1A78, 0x1A78, 0x1A78,
  0x1A78, 0x1ACE, 0x1A78, 0x1A78, 0x1B0A, 0x1BA2, 0x1A78, 0x1A78,
  0x1B1A, 0x1B22, 0x1BAA, 0x1A78, 0x1B52, 0x1AE6, 0x1B74, 0x1B74,
  0x1B68, 0x1AFC, 0x1BC2, 0x1BCE, 0x1BD2, 0x1BD6, 0x1BDA,
];

// Interior tables — entries containing `TT.Family1B00_Anchor` mean
// "stamp the family anchor's tile" (the page-base Map16 value).
const ANCH = TT.Family1B00_Anchor;
const DATA_bg_autotile_IT0_tiles: ReadonlyArray<number> = [
  ANCH,   0x1A82, 0x1AA2, 0x1B76, ANCH,   ANCH,   0x1AD2, 0x1B8E,
  ANCH,   ANCH,   0x1AFE, 0x1B86, ANCH,   ANCH,   ANCH,   ANCH,
  ANCH,   ANCH,   ANCH,   0x1B32, ANCH,   ANCH,   0x1B6C, 0x1B6C,
  0x1B64, 0x1AFA, 0x1BBE, 0x1BCE, 0x1BD2, 0x1BD6, 0x1BDA,
];
const DATA_bg_autotile_IT1_tiles: ReadonlyArray<number> = [
  0x1A68, 0x1A88, 0x1AA8, 0x1B7C, ANCH,   ANCH,   ANCH,   ANCH,
  ANCH,   ANCH,   ANCH,   ANCH,   ANCH,   ANCH,   ANCH,   ANCH,
  ANCH,   ANCH,   ANCH,   0x1B36, ANCH,   ANCH,   0x1B6C, 0x1B6C,
  0x1B64, 0x1AFA, 0x1BBE, 0x1BCE, 0x1BD2, 0x1BD6, 0x1BDA,
];
const DATA_bg_autotile_IT2_tiles: ReadonlyArray<number> = [
  0x1A6E, 0x1A8E, 0x1AAE, 0x1B84, ANCH,   ANCH,   ANCH,   ANCH,
  0x1AEA, ANCH,   ANCH,   ANCH,   ANCH,   ANCH,   0x1B0E, 0x1BB6,
  ANCH,   0x1B26, 0x1BAE, 0x1B3E, ANCH,   ANCH,   0x1B5E, 0x1B5E,
  0x1B64, 0x1AFA, 0x1BBE, 0x1BCE, 0x1BD2, 0x1BD6, 0x1BDA,
];
const DATA_bg_autotile_IM0_tiles: ReadonlyArray<number> = [
  0x1A64, 0x1A84, ANCH,   ANCH,   ANCH,   ANCH,   0x1AD4, 0x1B90,
  ANCH,   ANCH,   ANCH,   ANCH,   ANCH,   ANCH,   ANCH,   ANCH,
  ANCH,   ANCH,   ANCH,   0x1B44, ANCH,   ANCH,   0x1B6E, 0x1B6E,
  0x1B64, 0x1AFA, 0x1BBE, 0x1BCE, 0x1BD2, 0x1BD6, 0x1BDA,
];
// IM1 (interior middle-middle); also used as shared default by other
// interior cells via CODE_autotile_interior_shared_default.
const DATA_bg_autotile_IM1_tiles: ReadonlyArray<number> = [
  0x1A6A, 0x1A8A, ANCH,   ANCH,   ANCH,   ANCH,   ANCH,   ANCH,
  ANCH,   ANCH,   ANCH,   ANCH,   ANCH,   ANCH,   ANCH,   ANCH,
  ANCH,   ANCH,   ANCH,   0x1B2E, ANCH,   ANCH,   0x1B6E, 0x1B6E,
  0x1B64, 0x1AFA, 0x1BBE, 0x1BCE, 0x1BD2, 0x1BD6, 0x1BDA,
];
const DATA_bg_autotile_IM2_tiles: ReadonlyArray<number> = [
  0x1A70, 0x1A90, ANCH,   ANCH,   ANCH,   ANCH,   ANCH,   ANCH,
  0x1AEC, ANCH,   ANCH,   ANCH,   ANCH,   ANCH,   ANCH,   ANCH,
  ANCH,   0x1B1E, 0x1BA6, ANCH,   ANCH,   ANCH,   0x1B60, 0x1B60,
  0x1B64, 0x1AFA, 0x1BBE, 0x1BCE, 0x1BD2, 0x1BD2, 0x1BD6,
];
const DATA_bg_autotile_IB0_tiles: ReadonlyArray<number> = [
  0x1A66, 0x1A86, ANCH,   ANCH,   0x1ABA, ANCH,   0x1AD6, 0x1B92,
  ANCH,   ANCH,   ANCH,   ANCH,   0x1B06, 0x1B9E, ANCH,   ANCH,
  ANCH,   ANCH,   ANCH,   0x1B34, 0x1B4E, ANCH,   0x1B74, 0x1B74,
  0x1B64, 0x1AFA, 0x1BBE, 0x1BCE, 0x1BD2, 0x1BD6, 0x1BDA,
];
const DATA_bg_autotile_IB1_tiles: ReadonlyArray<number> = [
  0x1A6C, 0x1A8C, ANCH,   ANCH,   0x1AC0, ANCH,   ANCH,   ANCH,
  ANCH,   ANCH,   ANCH,   ANCH,   ANCH,   ANCH,   ANCH,   ANCH,
  ANCH,   0x1B28, 0x1BB0, 0x1B38, 0x1B54, ANCH,   0x1B62, 0x1B62,
  0x1B64, 0x1AFA, 0x1BC4, 0x1BCE, 0x1BD2, 0x1BD6, 0x1BDA,
];
const DATA_bg_autotile_IB2_tiles: ReadonlyArray<number> = [
  0x1A72, 0x1A92, ANCH,   ANCH,   0x1AC6, ANCH,   ANCH,   ANCH,
  0x1AEE, ANCH,   ANCH,   ANCH,   ANCH,   ANCH,   ANCH,   ANCH,
  0x1B16, 0x1B28, 0x1BB0, 0x1B40, 0x1B5A, 0x1AE2, 0x1B62, 0x1B62,
  0x1B64, 0x1AFA, 0x1BCA, 0x1BCE, 0x1BD2, 0x1BD6, 0x1BDA,
];

// ─────────────────────────────────────────────────────────────────────
// Class-aware jump tables (DATA_bg_autotile_class_jump_vstrip_top..B11F, Bank13.asm:6155-6297).
//
// When the under-tile is in the same Family1B00 family, the cart picks
// one of these 11 jump tables based on the cell's position in the
// rectangle, indexes by the row half of the class-subindex result, and
// jumps to one of the default-tile-table branches above (TL, TM, TR,
// ML, MR, BL, BM, BR, MM_shared_default).
//
// We represent the jump targets as values from the `JumpTarget` enum,
// then dispatch into the corresponding default tile table.
// ─────────────────────────────────────────────────────────────────────

const JT_TL = 0; // CODE_autotile_interior_TL_default → DATA_bg_autotile_IT0_tiles
const JT_TM = 1; // CODE_autotile_interior_TM_default → DATA_bg_autotile_IT1_tiles
const JT_TR = 2; // CODE_autotile_interior_TR_default → DATA_bg_autotile_IT2_tiles
const JT_ML = 3; // CODE_autotile_interior_ML_default → DATA_bg_autotile_IM0_tiles
const JT_MR = 4; // CODE_autotile_interior_MR_default → DATA_bg_autotile_IM2_tiles
const JT_BL = 5; // CODE_autotile_interior_BL_default → DATA_bg_autotile_IB0_tiles
const JT_BM = 6; // CODE_autotile_interior_BM_default → DATA_bg_autotile_IB1_tiles
const JT_BR = 7; // CODE_autotile_interior_BR_default → DATA_bg_autotile_IB2_tiles
const JT_MM = 8; // CODE_autotile_interior_shared_default → DATA_bg_autotile_IM1_tiles

// LR jump table is referenced via `DATA_bg_autotile_class_jump_vstrip_top-$08,x` in the asm, i.e.
// indexed by sub-index starting at 4 (8 bytes after table base = entries
// at sub-index 4..11). Spec/cart use this as a class-aware override
// table for the LR (left-mid) cell — pad with -1 for invalid early
// indices to keep table size matching the cart's range.
const DATA_class_jump_LR: ReadonlyArray<number> = [
  -1, -1, -1, -1,                     // pad sub-index 0..3 (asm indexes from 4)
  JT_TL, JT_ML, JT_BL, JT_TL,         // sub-index 4..7
  JT_MM, JT_TM, JT_MM, JT_MM,         // sub-index 8..11
];
const DATA_class_jump_LL: ReadonlyArray<number> = [
  JT_MM, JT_MM, JT_MM, JT_BM, JT_TM, JT_MM,
];
const DATA_class_jump_LB: ReadonlyArray<number> = [
  JT_BM, JT_TM, JT_TM, JT_TM, JT_TR, JT_MR, JT_BR, JT_TM,
  JT_MM, JT_TR, JT_MM, JT_MM, JT_MR, JT_BM, JT_BM,
];
const DATA_class_jump_RT: ReadonlyArray<number> = [
  JT_BR, JT_TL, JT_TM, JT_TR, JT_MM, JT_MM, JT_MM, JT_MM,
  JT_MM, JT_MM, JT_MM, JT_MM, JT_MM, JT_ML, JT_MM,
];
const DATA_class_jump_RM: ReadonlyArray<number> = [JT_MR, JT_ML, JT_MM];
const DATA_class_jump_RB: ReadonlyArray<number> = [
  JT_MR, JT_BL, JT_BM, JT_BR, JT_MM, JT_MM, JT_MM, JT_ML,
];
const DATA_class_jump_IT0: ReadonlyArray<number> = [
  JT_MM, JT_MR, JT_TM, JT_TM, JT_MM, JT_MM, JT_ML, JT_MM,
  JT_MM, JT_TM, JT_MM, JT_MM, JT_MM, JT_ML, JT_MM,
];
const DATA_class_jump_IT2: ReadonlyArray<number> = [
  JT_MM, JT_TM, JT_TM, JT_TR, JT_MM, JT_MM, JT_MR, JT_TM,
  JT_MM, JT_MM, JT_MM, JT_MM, JT_MM,
];
const DATA_class_jump_IB0: ReadonlyArray<number> = [
  JT_MM, JT_MM, JT_MR, JT_BM, JT_ML, JT_MM, JT_MM, JT_ML,
  JT_MM, JT_MM, JT_MM, JT_MM, JT_MM, JT_MM, JT_MM,
];
const DATA_class_jump_IB2: ReadonlyArray<number> = [
  JT_BM, JT_BM, JT_MM, JT_MM, JT_MR, JT_MM, JT_MM, JT_MM,
  JT_MM, JT_MR, JT_MM, JT_MM, JT_BM, JT_BM, JT_BR, JT_BR,
];

// ─────────────────────────────────────────────────────────────────────
// Contiguous class-jump region (DATA_bg_autotile_class_jump_vstrip_top..$13B13F, 114 words).
//
// CRITICAL (the "scan overruns its named table" idiom — same as the class scan,
// see _shared.ts): each cell's dispatch indexes ITS class-jump table with the
// col sub-index (`LDA $00 ; ASL ; TAX ; JMP (TABLE,x)`), and the cart does NOT
// bound that index. When col exceeds the table's entry count it reads straight
// on into the NEXT class-jump table laid out after it in memory. So the whole
// region is one flat array indexed `base + col`; modelling each table in
// isolation (and falling back to the default on col-overflow) mis-stamps every
// overlapping-block merge whose under-tile sub-index lands past its own table —
// the bug behind 1-7's overlapping sand blocks. The 10 tables in MEMORY order:
const CJ_LAYOUT: ReadonlyArray<{ table: ReadonlyArray<number>; entries: ReadonlyArray<number> }> = [
  { table: DATA_class_jump_LR,  entries: DATA_class_jump_LR.slice(4) }, // vstrip_top (-$08 ⇒ drop the 4 pads)
  { table: DATA_class_jump_LL,  entries: DATA_class_jump_LL },          // vstrip_mid
  { table: DATA_class_jump_LB,  entries: DATA_class_jump_LB },          // vstrip_bot
  { table: DATA_class_jump_RT,  entries: DATA_class_jump_RT },          // hstrip_left
  { table: DATA_class_jump_RM,  entries: DATA_class_jump_RM },          // hstrip_mid
  { table: DATA_class_jump_RB,  entries: DATA_class_jump_RB },          // hstrip_right
  { table: DATA_class_jump_IT0, entries: DATA_class_jump_IT0 },         // interior LT
  { table: DATA_class_jump_IT2, entries: DATA_class_jump_IT2 },         // interior LB
  { table: DATA_class_jump_IB0, entries: DATA_class_jump_IB0 },         // interior RT
  { table: DATA_class_jump_IB2, entries: DATA_class_jump_IB2 },         // interior RB
];
const FLAT_CLASS_JUMP: ReadonlyArray<number> = CJ_LAYOUT.flatMap((s) => s.entries);
/** Entry base of each class-jump table within FLAT_CLASS_JUMP (keyed by the
 *  table identity the dispatchers pass). vstrip_top sits 4 entries BEFORE the
 *  region start (the asm's `DATA_bg_autotile_class_jump_vstrip_top-$08,x`), so its base is -4. */
const CJ_BASE_OF: ReadonlyMap<ReadonlyArray<number>, number> = (() => {
  const m = new Map<ReadonlyArray<number>, number>();
  let acc = 0;
  for (const s of CJ_LAYOUT) {
    m.set(s.table, s.table === DATA_class_jump_LR ? -4 : acc);
    acc += s.entries.length;
  }
  return m;
})();

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/** Read the Family1B00 anchor — the 16-bit Map16 ID that the page-anchor
 *  template slot resolves to. Used both for high-byte family checks and
 *  as the "stamp the anchor's tile" value when an interior table entry
 *  is `TT.Family1B00_Anchor` itself. */
function familyAnchor(state: DecodeState): number {
  return state.templateAt(TT.Family1B00_Anchor) & 0xffff;
}

/** Cart `CODE_bg_autotile_classify_under` ($13:AC04). Returns 1 if the
 *  under-tile's high byte equals the Family1B00 anchor's high byte
 *  (same family), 0 otherwise. */
function classifyUnder(state: DecodeState): number {
  const curHi = state.zp12 & 0xff00;
  const anchorHi = familyAnchor(state) & 0xff00;
  return curHi === anchorHi ? 1 : 0;
}

// The 16 contiguous 62-byte tables the cart's class_subindex scans, in MEMORY
// order: DATA_bg_autotile_class_list (class list) is immediately followed by the 15
// connectivity tile tables (vstrip top/mid/bot, hstrip left/mid/right, then the
// 9 interior tables). `col` from the scan indexes THIS array. Verified the
// memory layout entry-for-entry against Bank13.asm:6209-6318.
const CLASS_SCAN_TABLES: ReadonlyArray<ReadonlyArray<number>> = [
  DATA_bg_autotile_class_list, //  0  DATA_bg_autotile_class_list  class list
  DATA_bg_autotile_LL_tiles,   //  1  DATA_bg_autotile_vstrip_top_tiles  vstrip top
  DATA_bg_autotile_LR_tiles,   //  2               vstrip mid
  DATA_bg_autotile_LB_tiles,   //  3               vstrip bot
  DATA_bg_autotile_RT_tiles,   //  4               hstrip left
  DATA_bg_autotile_RM_tiles,   //  5               hstrip mid
  DATA_bg_autotile_RB_tiles,   //  6               hstrip right
  DATA_bg_autotile_IT0_tiles,  //  7               interior LT
  DATA_bg_autotile_IT1_tiles,  //  8               interior LM
  DATA_bg_autotile_IT2_tiles,  //  9               interior LB
  DATA_bg_autotile_IM0_tiles,  // 10               interior MT
  DATA_bg_autotile_IM1_tiles,  // 11               interior MM
  DATA_bg_autotile_IM2_tiles,  // 12               interior MB
  DATA_bg_autotile_IB0_tiles,  // 13               interior RT
  DATA_bg_autotile_IB1_tiles,  // 14               interior RM
  DATA_bg_autotile_IB2_tiles,  // 15               interior RB
];

/**
 * Cart `CODE_bg_autotile_class_subindex` ($13:AC15). Locates the under-tile in
 * the cart's CONTIGUOUS 16-table scan region — the 31-entry class list
 * immediately followed in memory by the 15 connectivity tile tables (see
 * `CLASS_SCAN_TABLES`). The asm scans `DATA_bg_autotile_class_list,y` for y in 0..$3E0
 * (= 16 × $3E), derefing each entry's template slot and comparing to the
 * under-tile; the first match's byte offset Y divides by $3E into:
 *   - `col` = which of the 16 tables matched (0 = class list, 1..15 = the
 *     connectivity tables) — indexes the per-cell class-jump table.
 *   - `row` = byte offset within that table — indexes the chosen default
 *     tile table.
 *
 * Not-found mirrors the cart's stale-Y: Y stays $3E0 → col=16, row=0 (the
 * jump-table index then falls out of range → default branch).
 *
 * NB: this used to scan ONLY the 31-entry class list, so `col` was always 0 and
 * the under-tile went unfound whenever it lived in a connectivity table — the
 * common case when two $4E blocks overlap — collapsing the whole overlap onto
 * one wrong merge tile.
 */
function classSubindex(state: DecodeState, anchor: number): { row: number; col: number } {
  const target = state.zp12 & 0xffff;
  void anchor; // asm scan doesn't use the anchor; param kept for call-site parity.
  // Scan the 16 tables in memory order; stop at the first slot whose template
  // equals the under-tile (class list has priority, then the connectivity
  // tables in layout order — matching the cart's single linear scan).
  let byteY = 0x3e0; // not-found sentinel → col=16, row=0 after the divide.
  scan: for (let t = 0; t < CLASS_SCAN_TABLES.length; t++) {
    const table = CLASS_SCAN_TABLES[t]!;
    for (let i = 0; i < table.length; i++) {
      if (state.templateAt(table[i]!) === target) {
        byteY = t * 0x3e + (i << 1);
        break scan;
      }
    }
  }
  // Divide by $3E into (col, row), mirroring the cart's subtract loop.
  let col = 0;
  while (byteY >= 0x3e) {
    byteY -= 0x3e;
    col += 1;
  }
  return { row: byteY, col };
}

/** Apply a JumpTarget to produce a slot address from the relevant
 *  default-table by Y (the recognition-list entry index in BYTES). */
function applyJumpTarget(target: number, y: number): number {
  switch (target) {
    case JT_TL: return DATA_bg_autotile_IT0_tiles[y >>> 1]!;
    case JT_TM: return DATA_bg_autotile_IT1_tiles[y >>> 1]!;
    case JT_TR: return DATA_bg_autotile_IT2_tiles[y >>> 1]!;
    case JT_ML: return DATA_bg_autotile_IM0_tiles[y >>> 1]!;
    case JT_MR: return DATA_bg_autotile_IM2_tiles[y >>> 1]!;
    case JT_BL: return DATA_bg_autotile_IB0_tiles[y >>> 1]!;
    case JT_BM: return DATA_bg_autotile_IB1_tiles[y >>> 1]!;
    case JT_BR: return DATA_bg_autotile_IB2_tiles[y >>> 1]!;
    case JT_MM: return DATA_bg_autotile_IM1_tiles[y >>> 1]!;
    default:    return DATA_bg_autotile_IM1_tiles[y >>> 1]!; // shared-default fallback
  }
}

/** Common dispatch helper for entries that, on class-match, jump through
 *  a per-region class_jump table indexed by `col_sub` ($00 from
 *  class_subindex). The picked default-handler then indexes its tile
 *  table by Y = row_sub-byte (NOT the original recognition-list y).
 *
 *  Cart pattern:
 *    JSR class_subindex   ; Y = row_sub_byte, $00 = col_sub
 *    LDA $00 ; ASL ; TAX
 *    JMP (class_jump_TBL,x)  ; → TL_default / ML_default / shared_default / ...
 *      ↳ LDA TILE_TBL,y      ; Y still = row_sub_byte
 */
function pickWithClassOverride(
  state: DecodeState,
  y: number,
  defaultTable: ReadonlyArray<number>,
  classJumpTable: ReadonlyArray<number> | null,
): number {
  if (classJumpTable !== null && classifyUnder(state) === 1) {
    const { row: rowSubByte, col: colSub } = classSubindex(state, familyAnchor(state));
    // Index the CONTIGUOUS class-jump region at base+col (see CJ_LAYOUT): when
    // col overruns this cell's own table the cart reads on into the next table
    // in memory, so we index the flat array rather than bounds-check to default.
    const base = CJ_BASE_OF.get(classJumpTable);
    if (base !== undefined) {
      const idx = base + colSub;
      // Only a col before the region (vstrip_top -$08 with col<4) or past its
      // end (col == 16 "not found", which can't occur for a same-family
      // under-tile) has no faithful target — fall back to the default there.
      if (idx >= 0 && idx < FLAT_CLASS_JUMP.length) {
        return applyJumpTarget(FLAT_CLASS_JUMP[idx]!, rowSubByte);
      }
    }
  }
  return defaultTable[y >>> 1]!;
}

/** Class-aware dispatch helper for interior_dispatch entries that, on
 *  class-match, fall through directly to shared_default (IM1) indexed by
 *  row_sub-byte Y. Used by TM/ML/MR/BM entries (the four edge-mid cells
 *  of the 3×3 interior grid, which lack their own class_jump table). */
function pickWithSharedDefaultOnMatch(
  state: DecodeState,
  y: number,
  defaultTable: ReadonlyArray<number>,
): number {
  if (classifyUnder(state) === 1) {
    const { row: rowSubByte } = classSubindex(state, familyAnchor(state));
    return DATA_bg_autotile_IM1_tiles[rowSubByte >>> 1]!;
  }
  return defaultTable[y >>> 1]!;
}

// ─────────────────────────────────────────────────────────────────────
// Sub-dispatchers (left / right / interior).
// ─────────────────────────────────────────────────────────────────────

/** Cart `CODE_bg_autotile_vertical_strip_dispatch` ($13:AA54). Handles the
 *  left column of a vertical strip (col_extent == 1, row_extent > 1):
 *  branches by row position (top / interior / bottom). */
function leftDispatch(state: DecodeState, y: number): number {
  const row = state.zp2C & 0xff;
  const rowExtent = state.zp2E & 0xff;
  if (row === 0) {
    // top row → default LL, class-jump LR (`DATA_bg_autotile_class_jump_vstrip_top-$08`)
    return pickWithClassOverride(state, y, DATA_bg_autotile_LL_tiles, DATA_class_jump_LR);
  }
  if (((row + 1) & 0xff) === rowExtent) {
    // bottom row → default LB, class-jump LB
    return pickWithClassOverride(state, y, DATA_bg_autotile_LB_tiles, DATA_class_jump_LB);
  }
  // interior row → default LR, class-jump LL
  return pickWithClassOverride(state, y, DATA_bg_autotile_LR_tiles, DATA_class_jump_LL);
}

/** Cart `CODE_bg_autotile_horizontal_strip_dispatch` ($13:AAA2). Handles the
 *  right column of a horizontal strip (row_extent == 1, col_extent > 1):
 *  branches by column position (left / interior / right). */
function rightDispatch(state: DecodeState, y: number): number {
  const col = state.zp28 & 0xff;
  const colExtent = state.zp2A & 0xff;
  if (col === 0) {
    // left edge → default RT, class-jump RT
    return pickWithClassOverride(state, y, DATA_bg_autotile_RT_tiles, DATA_class_jump_RT);
  }
  if (((col + 1) & 0xff) === colExtent) {
    // right edge → default RB, class-jump RB
    return pickWithClassOverride(state, y, DATA_bg_autotile_RB_tiles, DATA_class_jump_RB);
  }
  // interior column → default RM, class-jump RM
  return pickWithClassOverride(state, y, DATA_bg_autotile_RM_tiles, DATA_class_jump_RM);
}

/** Cart `CODE_bg_autotile_interior_dispatch` ($13:AAF0). 9-way grid
 *  select for objects with col_extent > 1 AND row_extent > 1: picks the
 *  default tile table + class-jump table by (col_edge, row_edge).
 *
 *  Cart dispatch (col=$28, row=$2C):
 *    col=0     row=0   → TL → IT0 (+ class_jump_IT0)
 *    col=0     mid     → TM → IT1 (no jump table; class-match → IM1)
 *    col=0     row=bot → TR → IT2 (+ class_jump_IT2)
 *    col=mid   row=0   → ML → IM0 (no jump table; class-match → IM1)
 *    col=mid   mid     → MM → IM1 (with anchor-bias)
 *    col=mid   row=bot → MR → IM2 (no jump table; class-match → IM1)
 *    col=right row=0   → BL → IB0 (+ class_jump_IB0)
 *    col=right mid     → BM → IB1 (no jump table; class-match → IM1)
 *    col=right row=bot → BR → IB2 (+ class_jump_IB2)
 */
function interiorDispatch(state: DecodeState, y: number): number {
  const col = state.zp28 & 0xff;
  const colExtent = state.zp2A & 0xff;
  const row = state.zp2C & 0xff;
  const rowExtent = state.zp2E & 0xff;
  const colAtLeft = col === 0;
  const colAtRight = ((col + 1) & 0xff) === colExtent;
  const rowAtTop = row === 0;
  const rowAtBot = ((row + 1) & 0xff) === rowExtent;

  // Left column (cart TL/TM/TR entries)
  if (colAtLeft && rowAtTop) {
    return pickWithClassOverride(state, y, DATA_bg_autotile_IT0_tiles, DATA_class_jump_IT0);
  }
  if (colAtLeft && rowAtBot) {
    return pickWithClassOverride(state, y, DATA_bg_autotile_IT2_tiles, DATA_class_jump_IT2);
  }
  if (colAtLeft) {
    return pickWithSharedDefaultOnMatch(state, y, DATA_bg_autotile_IT1_tiles);
  }
  // Right column (cart BL/BM/BR entries — "B" = Bottom of column dispatch list)
  if (colAtRight && rowAtTop) {
    return pickWithClassOverride(state, y, DATA_bg_autotile_IB0_tiles, DATA_class_jump_IB0);
  }
  if (colAtRight && rowAtBot) {
    return pickWithClassOverride(state, y, DATA_bg_autotile_IB2_tiles, DATA_class_jump_IB2);
  }
  if (colAtRight) {
    return pickWithSharedDefaultOnMatch(state, y, DATA_bg_autotile_IB1_tiles);
  }
  // Middle column (cart ML/MM/MR entries)
  if (rowAtTop) {
    return pickWithSharedDefaultOnMatch(state, y, DATA_bg_autotile_IM0_tiles);
  }
  if (rowAtBot) {
    return pickWithSharedDefaultOnMatch(state, y, DATA_bg_autotile_IM2_tiles);
  }
  // Middle-middle: cart's CODE_autotile_interior_MM_anchor_bias.
  // If Y==0 (recognition-list pos 0, i.e. $0000 / blank under-tile) AND
  // under-tile high byte matches anchor AND low byte >= $10, bump Y to 2
  // before indexing IM1. Produces a different shared-default when an
  // existing same-family low-byte-≥$10 tile sits under a $0000-categorised
  // cell — a corner of the class-aware merge logic.
  let yFinal = y;
  if (y === 0) {
    const cur = state.zp12 & 0xffff;
    const anchorHi = familyAnchor(state) & 0xff00;
    if ((cur & 0xff00) === anchorHi && (cur & 0xff) >= 0x10) {
      yFinal = 2;
    }
  }
  return DATA_bg_autotile_IM1_tiles[yFinal >>> 1]!;
}

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_bg_autotile_block ($13:A9F6) entry point.
// ─────────────────────────────────────────────────────────────────────

const bgAutotileBlockStamp: PerCellHandler = (state) => {
  const cur = state.zp12 & 0xffff;
  const curHi = cur & 0xff00;
  const anchor = familyAnchor(state);
  const anchorHi = anchor & 0xff00;

  // ─── 1) Acceptance gate ─────────────────────────────────────────
  let y = 0;
  let accept = false;
  if (curHi === anchorHi) {
    accept = true; // family match — Y stays at 0 (cart: BEQ CODE_13AA24 without bumping Y)
  } else if (cur === 0x0000 || cur === ACCEPT_BG_GRID_MARKER) {
    accept = true; // blank or BG-grid marker — Y stays at 0
  } else {
    // Scan recognition list starting at Y=2 (cart: INY INY before loop).
    for (let i = 1; i < DATA_bg_autotile_match_list.length; i++) {
      const slot = DATA_bg_autotile_match_list[i]!;
      if (state.templateAt(slot) === cur) {
        y = i << 1;
        accept = true;
        break;
      }
    }
  }
  if (!accept) {
    return; // CODE_13AA51 fall-through: cell rejected, no stamp.
  }

  // ─── 2) Region select ───────────────────────────────────────────
  const colExtentDec = (state.zp2A - 1) & 0xff; // $2A - 1
  const rowExtentDec = (state.zp2E - 1) & 0xff; // $2E - 1

  let slot: number;
  if (colExtentDec === 0) {
    // col_extent == 1 (single-column object)
    if (rowExtentDec === 0) {
      // 1×1 single cell — stamp from class-list directly.
      slot = DATA_bg_autotile_class_list[y >>> 1]!;
    } else {
      // vertical strip — left-dispatch.
      slot = leftDispatch(state, y);
    }
  } else if (rowExtentDec === 0) {
    // horizontal strip — right-dispatch.
    slot = rightDispatch(state, y);
  } else {
    // 2D rectangle — interior dispatch.
    slot = interiorDispatch(state, y);
  }

  // ─── 3) Stamp the dereferenced slot ─────────────────────────────
  stampCell(state, state.templateAt(slot));
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_bg_autotile_block ($12:979D).
//
//   REP #$20
//   LDX #(CODE_stamp_bg_autotile_block-1)>>16
//   LDA #CODE_stamp_bg_autotile_block-1
//   JMP walker_setup_trampoline
//
// Plain trampoline-walker init: same handler for even-col / odd-col /
// row slots, $19=$7FFF, slope=0. Spec confirms no DP mutations: walker
// reads stream's raw $1B/$1C/$2A/$2E/$15 unchanged.
// ─────────────────────────────────────────────────────────────────────

function initBgAutotileBlock(state: DecodeState): void {
  walkerSetupTrampoline(state, bgAutotileBlockStamp);
}

// ─────────────────────────────────────────────────────────────────────
// Registration.
// ─────────────────────────────────────────────────────────────────────

export function installBgAutotileBlockHandlers(): void {
  registerStdObjectHandler(0x4E, initBgAutotileBlock);
}
