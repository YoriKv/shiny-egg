// Per-object init handler registry. Replaces the cart's DATA_extended_object_init_ptrs
// (extended-object init pointers) and DATA_standard_object_init_ptrs (standard-object init
// pointers) — instead of code-address tables, we use TypeScript function
// arrays indexed by object ID.
//
// Phase 4 work: handler files in bank12/ and bank13/ register themselves
// here at module load via `registerExtObjectHandler(id, fn)` /
// `registerStdObjectHandler(id, fn)`.
//
// Unregistered IDs return `null`; the parser skips them gracefully (the
// asm-side dispatch would jump into garbage on unregistered IDs, but for
// our editor we want to soldier on through unfamiliar levels and just
// leave their Map16 cells unrendered).

import type { InitHandler } from '../state.ts';

const extObjectHandlers: (InitHandler | null)[] = new Array(256).fill(null);
const stdObjectHandlers: (InitHandler | null)[] = new Array(256).fill(null);

export function registerExtObjectHandler(id: number, fn: InitHandler): void {
  if (id < 0 || id > 0xff) {
    throw new RangeError(`registerExtObjectHandler: id ${id} out of range`);
  }
  extObjectHandlers[id] = fn;
}

export function registerStdObjectHandler(id: number, fn: InitHandler): void {
  if (id < 0 || id > 0xff) {
    throw new RangeError(`registerStdObjectHandler: id ${id} out of range`);
  }
  stdObjectHandlers[id] = fn;
}

export function getExtObjectHandler(id: number): InitHandler | null {
  return extObjectHandlers[id & 0xff];
}

export function getStdObjectHandler(id: number): InitHandler | null {
  return stdObjectHandlers[id & 0xff];
}

/** Count of registered handlers — useful for "X / 256 handlers ported" progress. */
export function handlerCoverage(): { ext: number; std: number } {
  let ext = 0;
  let std = 0;
  for (const h of extObjectHandlers) if (h !== null) ext++;
  for (const h of stdObjectHandlers) if (h !== null) std++;
  return { ext, std };
}
