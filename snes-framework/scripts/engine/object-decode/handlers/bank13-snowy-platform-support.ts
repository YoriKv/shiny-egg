// Standard object $E2 — SnowyPlatformSupport.
//
// Cart entry: CODE_init_snowy_platform_support @ $12:A205 (yi/Banks/Bank12.asm:5250).
// Per-cell stamp: CODE_stamp_snowy_platform_support @ $13:F4E4 (yi/Banks/Bank13.asm:14221).
//
// Snowy platform support — a tall multi-row stone structure. The init fixes
// the column extent to 4 (`STA $2A` with `#$0004`), so every instance stamps
// a 4-wide silhouette regardless of the stream record's width nibble. The
// stamp routine then picks tiles from one of two 32-entry tables:
//
//   - rows 0-7 ($2C < 8): `DATA_snowy_platform_support_top_tiles` — the upper
//     four row-groups have $0000 cells in cols 0 and 3, producing the
//     narrow tapered top; the lower four row-groups widen to all four cols.
//   - row 8+ ($2C >= 8):  `DATA_snowy_platform_support_body_tiles` — full-width
//     stone runs, cycling every 8 rows via the `AND #$0007` mask.
//
// Spec confirms the only entry → walker-time DP diff is $2A (0001 → 0004).
// Spec table-reads cross-checked: every cell's Map16 matches the asm tables
// indexed by `(($2C & 7) * 4 + $28)`. Top-table $0000 entries correspond
// to "no STAMP" cells in the spec timeline.
//
// No GoldenEgg counterpart (ReSharper search for `SnowyPlatformSupport`,
// `PlatformSupport`, `0xE2` returned zero hits).

import { registerStdObjectHandler } from './index.ts';
import type { DecodeState, InitHandler, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// ─────────────────────────────────────────────────────────────────────
// DATA_snowy_platform_support_top_tiles ($13:F464, Bank13.asm:14207).
//
// 32 entries, 8 row-groups of 4 cols each. Rows 0-3 have $0000 in cols 0
// and 3 (narrow top); rows 4-7 are full-width stone. Indexed in the asm
// by Y = (($2C & 7) * 4 + $28) << 1 → in TS we use the word index
// (($2C & 7) * 4 + $28) directly.
//
// A $0000 entry in this table is the "skip stamp" sentinel — the asm
// `BEQ` branches past the `STA.l !LevelDataBuffer,x` write.
// ─────────────────────────────────────────────────────────────────────

const DATA_snowy_platform_support_top_tiles: ReadonlyArray<number> = [
  0x0000, 0x8D9A, 0x8D9B, 0x0000,
  0x0000, 0x8DA9, 0x8DAA, 0x0000,
  0x0000, 0x8DB8, 0x8DB9, 0x0000,
  0x0000, 0x8DC6, 0x8DC7, 0x0000,
  0x8D9C, 0x8D9D, 0x8D9E, 0x8D9F,
  0x8DAB, 0x8DAC, 0x8DAD, 0x8DAE,
  0x8DBA, 0x8DBB, 0x8DBC, 0x8DBD,
  0x8DC8, 0x8DC9, 0x8DCA, 0x8DCB,
];

// ─────────────────────────────────────────────────────────────────────
// DATA_snowy_platform_support_body_tiles ($13:F4A4, Bank13.asm:14214).
//
// 32 entries, same shape as the top table but no $0000 silhouette cells:
// every cell stamps. The `AND #$0007` mask in the asm means rows cycle
// through this table every 8 rows for arbitrarily-tall supports.
// ─────────────────────────────────────────────────────────────────────

const DATA_snowy_platform_support_body_tiles: ReadonlyArray<number> = [
  0x8D9A, 0x8DA0, 0x8DA0, 0x8D9B,
  0x8DA9, 0x8DAF, 0x8DAF, 0x8DAA,
  0x8DB8, 0x8DBE, 0x8DBE, 0x8DB9,
  0x8DC6, 0x8DCC, 0x8DCC, 0x8DC7,
  0x8DA1, 0x8DA2, 0x8DA3, 0x8DA4,
  0x8DB0, 0x8DB1, 0x8DB2, 0x8DB3,
  0x8DBF, 0x8DC0, 0x8DC1, 0x8DC2,
  0x8DCD, 0x8DCE, 0x8DCF, 0x8DD0,
];

// ─────────────────────────────────────────────────────────────────────
// CODE_stamp_snowy_platform_support ($13:F4E4, Bank13.asm:14221).
//
//   REP #$30
//   LDA $2C ; AND #$0007 ; ASL ASL ; ADC $28 ; ASL ; TAY
//   LDA $2C ; CMP #$0008 ; BCS body
//   LDA DATA_snowy_platform_support_top_tiles,y ; BEQ skip ; BRA stamp
//   body:  LDA DATA_snowy_platform_support_body_tiles,y
//   stamp: LDX $1D ; STA.l !LevelDataBuffer,x
//   skip:  SEP #$30 ; RTL
//
// Notes:
// - The `ADC $28` runs in REP #$30 with no preceding CLC. The
//   `AND #$0007 ; ASL ASL` result has bits 4-15 zero, $28 is the small
//   column counter (≤ col_extent = 4 in practice), and the ASL just
//   before TAY zeros out any stale carry. Treating ADC as carry-clear
//   matches every observed cell in the spec.
// - $28 here is the raw column counter (0..colExtent-1), not a sign-aware
//   value — col_extent is forced positive (= 4) by the init.
// ─────────────────────────────────────────────────────────────────────

const stampSnowyPlatformSupport: PerCellHandler = (state) => {
  const row = state.zp2C & 0xff;
  const col = state.zp28 & 0xff;
  const idx = (((row & 0x07) << 2) + col) & 0x1f;

  if (row >= 0x08) {
    stampCell(state, DATA_snowy_platform_support_body_tiles[idx]!);
    return;
  }

  const tile = DATA_snowy_platform_support_top_tiles[idx]!;
  if (tile === 0x0000) return; // BEQ skip — leaves the cell as-is.
  stampCell(state, tile);
};

// ─────────────────────────────────────────────────────────────────────
// CODE_init_snowy_platform_support ($12:A205, Bank12.asm:5250).
//
//   REP #$20
//   LDA #$0004
//   STA $2A                                       ; force col_extent = 4
//   LDX #(CODE_stamp_snowy_platform_support-1)>>16   ; bank byte
//   LDA #CODE_stamp_snowy_platform_support-1         ; ptr-1
//   JMP walker_setup_trampoline                   ; slope=0; even/odd/row all same fn
//
// Spec entry → walker-time diff: $2A 0001 → 0004 (delta +$0003). All
// other DP bytes ($15 / $1B / $1C / $2E) unchanged, matching this code.
// ─────────────────────────────────────────────────────────────────────

const initSnowyPlatformSupport: InitHandler = (state: DecodeState) => {
  state.zp2A = 0x0004;
  walkerSetupTrampoline(state, stampSnowyPlatformSupport);
};

// ─────────────────────────────────────────────────────────────────────
// Registration. Parent (object-decode/index.ts) wires this in.
// ─────────────────────────────────────────────────────────────────────
export function installSnowyPlatformSupportHandlers(): void {
  registerStdObjectHandler(0xE2, initSnowyPlatformSupport);
}
