// Bank12 extended-object handler family: pipe_arrow_4dir (ext $89-$8C).
//
// init_handler CODE_extobj_handler_pipe_arrow_4dir ($12:xxxx) — confirmed via
// each spec.json `init_handler` field. One shared init dispatches on the
// direction nibble (low nibble of the ext ID = $15) to one of two walker
// geometries, re-encoding $15 to the orientation byte the walker observes:
//
//   $89 up    : $15 89→00, col_extent 2 row_extent 1 (HORIZONTAL pair)
//   $8A down  : $15 8A→02, col_extent 2 row_extent 1 (HORIZONTAL pair)
//   $8B left  : $15 8B→00, col_extent 1 row_extent 2 (VERTICAL  pair)
//   $8C right : $15 8C→02, col_extent 1 row_extent 2 (VERTICAL  pair)
//
// Walker-driven (shape 2). The init sets $2A/$2E and tail-calls the bare
// walker trampoline. The per-cell stamper lays a 2-tile run:
//   - $89/$8A: stamper CODE_12BAED, advances by column → base, base+1.
//   - $8B/$8C: stamper CODE_12BB2A, advances by row    → base, base+1.
// Either way exactly one walker axis moves, so (col + row) gives the linear
// cell index 0,1 and the tile is base + index.
//
// Per-cell BASE tiles (verified 1:1 against each spec.json STAMP cell):
//   $89 → $8521,$8522   $8A → $8529,$852A
//   $8B → $8531,$8532   $8C → $8539,$853A
//
// (Spec `xy=-1` cells are the walker's per-column row-wrap markers
// (CODE_128874), not stamps — they fall out of the walker naturally.)

import { registerExtObjectHandler } from './index.ts';
import type { DecodeState, PerCellHandler } from '../state.ts';
import { walkerSetupTrampoline } from '../walker.ts';
import { stampCell } from './_shared.ts';

// Walker geometry + tile base + re-encoded $15 per ext ID, indexed by ID.
interface PipeArrowVariant {
  readonly col: number; // $2A col extent (post-init)
  readonly row: number; // $2E row extent (post-init)
  readonly orient: number; // re-encoded $15 the walker sees
  readonly base: number; // base Map16 ID of the first stamped cell
}

const VARIANTS: Record<number, PipeArrowVariant> = {
  0x89: { col: 0x0002, row: 0x0001, orient: 0x00, base: 0x8521 },
  0x8a: { col: 0x0002, row: 0x0001, orient: 0x02, base: 0x8529 },
  0x8b: { col: 0x0001, row: 0x0002, orient: 0x00, base: 0x8531 },
  0x8c: { col: 0x0001, row: 0x0002, orient: 0x02, base: 0x8539 },
};

// CODE_12BAED / CODE_12BB2A per-cell stampers. Both produce base + linear
// cell index; only one axis advances per variant, so (col + row) ∈ {0,1}.
function makeInit(variant: PipeArrowVariant): (state: DecodeState) => void {
  const perCell: PerCellHandler = (state) => {
    const index = ((state.zp28 & 0xff) + (state.zp2C & 0xff)) & 0xff;
    stampCell(state, (variant.base + index) & 0xffff);
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
