// Build-time `%FREE_BYTES` boundary move — lets a movable level pool grow into
// its end-of-bank `$FF` slack (pool-map.ts `tail.movable`).
//
// A pool's blobs are contiguous and end exactly at the boundary B in the base.
// Growing them by G bytes pushes the cursor to B+G, tripping `assert pc() <= B`.
// Because the pointer tables address blobs by LABEL (asar resolves at assembly
// time), the ONLY obstacle is that assert — so we rewrite
//   %FREE_BYTES(B, N, $FF)  →  %FREE_BYTES(B+G, N-G, $FF)
// which moves the boundary forward by G and shrinks the fill so the tail still
// ends at the same fixed point (B+N). Everything downstream stays byte-identical;
// only the G bytes that were $FF tail become data. Valid for 0 < G ≤ N (the fill
// size). G > N is a real overflow (blocked by the budget gate, not moved here).
//
// The rewrite reads the PRISTINE base bank `.asm` and writes the adjusted file
// into the build tree, so it's idempotent: re-running with a different G (or no
// growth) always reconciles from base. Movable banks the editor never asm-edits,
// so reading base (not the overlay-stamped tree copy) is safe.

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { PoolMap } from './pool-map.ts';
import { hex } from './hex.ts';

export interface BoundaryMove {
  /** Bank `.asm` path relative to the `yi/` root (e.g. `Banks/Bank4C.asm`). */
  bankFile: string;
  poolId: string;
  /** Original boundary B (SNES address). */
  boundary: number;
  /** Original `$FF` fill size N. */
  fillSize: number;
  /** Growth G in bytes (1 ≤ G ≤ N). */
  growth: number;
}

/** A 24-bit SNES address as 6 uppercase hex digits (no `$`). */
export const snes6 = (n: number): string => hex(n, 6);

/**
 * Movable pools whose current data has grown past the base boundary but still
 * fits the fill (0 < G ≤ N). `diskSizeOf(file)` returns each blob's current size
 * (overlay-if-saved, base otherwise). Pools that shrank/stayed (G ≤ 0) or
 * overran the fill (G > N, a budget violation) produce no move.
 */
export function computeBoundaryMoves(
  map: PoolMap,
  diskSizeOf: (file: string) => number
): BoundaryMove[] {
  const moves: BoundaryMove[] = [];
  for (const pool of map.pools) {
    if (!pool.tail.movable) continue;
    const used = pool.blobs.reduce((n, b) => n + diskSizeOf(b.file), 0);
    const growth = used - pool.capacityBytes;
    if (growth <= 0 || growth > pool.tail.fillSize) continue;
    moves.push({
      bankFile: pool.tail.bankFile,
      poolId: pool.id,
      boundary: pool.tail.boundary,
      fillSize: pool.tail.fillSize,
      growth,
    });
  }
  return moves;
}

/** Distinct bank `.asm` files that contain a movable pool (for tree reset). */
export function movableBankFiles(map: PoolMap): string[] {
  return [...new Set(map.pools.filter((p) => p.tail.movable).map((p) => p.tail.bankFile))];
}

/**
 * Rewrite the single `%FREE_BYTES($B, N, $FF)` call in `text` for `move`,
 * moving the boundary to `B+G` and the fill to `N-G`. Leaves any trailing
 * comment intact. Throws if the expected call isn't found (fail loud — a silent
 * miss would let the original assert fire on a grown build).
 */
export function rewriteFreeBytesText(text: string, move: BoundaryMove): string {
  const re = new RegExp(
    `%FREE_BYTES\\(\\$${snes6(move.boundary)},\\s*${move.fillSize},\\s*\\$FF\\)`
  );
  if (!re.test(text)) {
    throw new Error(
      `boundary-move: %FREE_BYTES($${snes6(move.boundary)}, ${move.fillSize}, $FF) ` +
        `not found in ${move.bankFile}.`
    );
  }
  const newBoundary = snes6(move.boundary + move.growth);
  const newFill = move.fillSize - move.growth;
  return text.replace(re, `%FREE_BYTES($${newBoundary}, ${newFill}, $FF)`);
}

/**
 * Reconcile every movable bank `.asm` in the build tree against the current
 * growth: rewrite the boundary for banks that grew, restore pristine base for
 * the rest (clears a stale move from a previous build). Both derive from the
 * base asm, so this is idempotent. `baseYiRoot`/`treeYiRoot` are the `yi/`
 * directories of the pristine base and the build tree.
 */
export function applyBoundaryMoves(
  baseYiRoot: string,
  treeYiRoot: string,
  map: PoolMap,
  diskSizeOf: (file: string) => number
): BoundaryMove[] {
  const moves = computeBoundaryMoves(map, diskSizeOf);
  const movesByFile = new Map(moves.map((m) => [m.bankFile, m]));
  for (const bankFile of movableBankFiles(map)) {
    const baseText = fs.readFileSync(path.join(baseYiRoot, bankFile), 'utf8');
    const mv = movesByFile.get(bankFile);
    const out = mv ? rewriteFreeBytesText(baseText, mv) : baseText;
    const dest = path.join(treeYiRoot, bankFile);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, out, 'utf8');
  }
  return moves;
}
