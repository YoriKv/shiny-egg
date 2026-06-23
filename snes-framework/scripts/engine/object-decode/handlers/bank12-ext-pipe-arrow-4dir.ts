// Bank12 extended-object handler family: sewer arrow-sign DECORATION (ext
// $89-$8C). These are flat wall decorations (a 2-tile directional arrow in the
// sewer tileset), NOT pipe geometry — they carry no collision and just blend a
// sign onto whatever wall is beneath them.
//
// init_handler CODE_extobj_handler_pipe_arrow_4dir ($12:8E1F) — one shared
// init dispatches on the ext-id low nibble ($15) to one of two walker
// geometries + stampers, re-encoding $15 to 0/2 (the table index the stamper
// reads). Extents from DATA_128E0B/DATA_128E13; stamper from DATA_128E1B:
//
//   $89 left  : col 2 row 1 (HORIZONTAL pair) → stamper CODE_12BAED
//   $8A right : col 2 row 1 (HORIZONTAL pair) → stamper CODE_12BAED
//   $8B up    : col 1 row 2 (VERTICAL  pair) → stamper CODE_12BB2A
//   $8C down  : col 1 row 2 (VERTICAL  pair) → stamper CODE_12BB2A
//
// (Direction labels per the editor metadata; the geometry agrees — a left/right
// arrow is a horizontal 2-wide pair, an up/down arrow a vertical 2-tall pair.)
//
// ── Overlap (read-modify-write) stamper ─────────────────────────────────────
// Both stampers are READ-MODIFY-WRITE: the tile already in the buffer ($12,
// latched by the walker) shifts the sign tile, and on one specific underlying
// alignment the sign ALSO writes a neighbour cell. Per cell:
//
//   $00 = ($12 - sub) & $000E              ; sub = $77A9 ($89/$8A) | $7799 ($8B/$8C)
//   stamp(current) = $00 + primary[v] + axis   ; axis = col $28 ($89/$8A) | row $2C ($8B/$8C)
//   if $00 == 0:                           ; underlying aligned on a 16-tile boundary
//       stamp(neighbour) = secondary[v] + axis  ; neighbour = below ($89/$8A) | right ($8B/$8C)
//
//   CODE_12BAED ($89/$8A): primary DATA_12BAE5 {$851B,$8523}, secondary
//     DATA_12BAE9 {$8521,$8529}, axis col $28, neighbour get_map16_below.
//   CODE_12BB2A ($8B/$8C): primary DATA_12BB22 {$852B,$8533}, secondary
//     DATA_12BB26 {$8531,$8539}, axis row $2C, neighbour get_map16_right.
//
// EMPTY-buffer case ($12 = $0000), the common non-overlap placement: $00 =
// ($0000 - sub) & $000E = $6 (both subs end $99/$A9, so the wrap lands at $6),
// and $00 != 0 so the neighbour write never fires. The per-cell tile collapses
// to `$6 + primary[v] + axis`, i.e. the fixed two-tile run below — which is what
// the previous port hardcoded (it baked the +$6 into the base and dropped the
// blend + neighbour write entirely, so any overlap rendered wrong):
//   $89 → $8521,$8522   $8A → $8529,$852A   $8B → $8531,$8532   $8C → $8539,$853A

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { getMap16Below, getMap16Right } from '../fetch.ts';
import { stampCell, writeBuf16, setProbeToCurrent } from './_shared.ts';

// Walker geometry + the two cart tile tables + which axis advances / neighbour
// is written, per ext ID. `primary` is the current-cell base, `secondary` the
// neighbour-cell base used only on the $00==0 alignment.
interface SewerArrowVariant {
  readonly col: number; // $2A col extent (post-init)
  readonly row: number; // $2E row extent (post-init)
  readonly orient: number; // re-encoded $15 the walker init writes (parity record)
  readonly sub: number; // subtracted from $12 to form $00 = (… ) & $000E
  readonly primary: number; // DATA_12BAE5 / DATA_12BB22 entry (current cell)
  readonly secondary: number; // DATA_12BAE9 / DATA_12BB26 entry (neighbour cell)
  readonly axis: 'col' | 'row'; // counter added to the tile + indexed by walker
  readonly neighbour: 'below' | 'right'; // cell written when $00 == 0
}

const VARIANTS: Record<number, SewerArrowVariant> = {
  0x89: { col: 0x0002, row: 0x0001, orient: 0x00, sub: 0x77a9, primary: 0x851b, secondary: 0x8521, axis: 'col', neighbour: 'below' },
  0x8a: { col: 0x0002, row: 0x0001, orient: 0x02, sub: 0x77a9, primary: 0x8523, secondary: 0x8529, axis: 'col', neighbour: 'below' },
  0x8b: { col: 0x0001, row: 0x0002, orient: 0x00, sub: 0x7799, primary: 0x852b, secondary: 0x8531, axis: 'row', neighbour: 'right' },
  0x8c: { col: 0x0001, row: 0x0002, orient: 0x02, sub: 0x7799, primary: 0x8533, secondary: 0x8539, axis: 'row', neighbour: 'right' },
};

// CODE_12BAED ($89/$8A) / CODE_12BB2A ($8B/$8C) per-cell stampers — see header.
function makeInit(variant: SewerArrowVariant): (state: DecodeState) => void {
  const perCell: PerCellHandler = (state) => {
    const axisVal = (variant.axis === 'col' ? state.zp28 : state.zp2C) & 0xff;
    // $00 = ($12 - sub) & $000E (a 16-tile-wrap alignment of the buffer tile).
    const blend = ((state.zp12 & 0xffff) - variant.sub) & 0x000e;
    // Current cell: $00 + primary base + walker axis counter.
    stampCell(state, (blend + variant.primary + axisVal) & 0xffff);
    if (blend !== 0) return; // BNE — no neighbour write
    // $00 == 0: also blend the secondary tile onto the neighbour cell.
    setProbeToCurrent(state);
    const off = variant.neighbour === 'below' ? getMap16Below(state) : getMap16Right(state);
    writeBuf16(state, off, (variant.secondary + axisVal) & 0xffff);
  };

  return (state: DecodeState) => {
    state.zp15 = variant.orient; // init re-encodes the dispatch param
    state.zp2A = variant.col;
    state.zp2E = variant.row;
    walkerSetupTrampoline(state, perCell);
  };
}

export function installExtPipeArrow4dirHandlers(): void {
  registerExtObjectHandler(0x89, makeInit(VARIANTS[0x89]!));
  registerExtObjectHandler(0x8a, makeInit(VARIANTS[0x8a]!));
  registerExtObjectHandler(0x8b, makeInit(VARIANTS[0x8b]!));
  registerExtObjectHandler(0x8c, makeInit(VARIANTS[0x8c]!));
}
