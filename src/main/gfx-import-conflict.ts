// Pure (Electron-free) core of the graphics-import reconciler: the checksum gate + the
// cross-file conflict tracker. Kept free of `./resources` (which pulls in electron via
// framework-paths) so it's unit-testable under plain `node` — see gfx-import-conflict.test.ts.
// The Electron-coupled writer (saveGfxEdit etc.) lives in gfx-import-reconcile.ts, which USES
// these. See research/graphics-editing/ for the standardized export/import model.

import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

/** sha256 (hex) of an exported artifact's bytes — the per-file change signature the export
 *  stamps into the manifest/sidecar so import can skip files the user didn't touch. */
export function fileChecksum(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * The checksum gate. `relFile` is the artifact's manifest-relative path; `stored` is its
 * export-time checksum (from `gfx-manifest.json`'s `checksums` map or a sidecar field).
 *   - `'missing'`   — the file isn't on disk (caller bumps its own `missing` tally).
 *   - `'unchanged'` — bytes still match `stored` ⇒ skip (don't decode/record).
 *   - `'changed'`   — bytes differ, OR `stored` is absent (old export ⇒ import as before).
 */
export function changedSinceExport(dir: string, relFile: string, stored: string | undefined): 'missing' | 'unchanged' | 'changed' {
  const p = join(dir, relFile)
  if (!existsSync(p)) return 'missing'
  if (!stored) return 'changed' // backward-compat: a pre-checksum export always imports
  return fileChecksum(readFileSync(p)) === stored ? 'unchanged' : 'changed'
}

/** A resolved datum: the agreed value (the FIRST source's, when all agree). */
export interface Winner<V> { value: V }
/** A dropped datum: two+ changed files set the same key to DIFFERENT values. */
export interface Conflict { key: string; sources: string[] }

/**
 * First-writer-wins-or-conflict map, generic over the datum value. Every importer records
 * `(key, value, sourceFile)`; a later EQUAL value is a no-op (two files agree), a later
 * DIFFERENT value marks the key a conflict (all disagreeing sources noted). `resolve()`
 * returns the agreed winners + the dropped conflicts. The reconciler keeps one tracker per
 * datum namespace (CHR tile, palette word, …); the conflict scope is the whole imported folder.
 */
export class ConflictTracker<V> {
  private map = new Map<string, { value: V; source: string; conflict?: Set<string> }>()
  private readonly eq: (a: V, b: V) => boolean
  constructor(eq: (a: V, b: V) => boolean) { this.eq = eq }

  record(key: string, value: V, source: string): void {
    const cur = this.map.get(key)
    if (!cur) { this.map.set(key, { value, source }); return }
    if (this.eq(cur.value, value)) return // agree
    ;(cur.conflict ??= new Set([cur.source])).add(source)
  }

  /** True if no datum was recorded. */
  get empty(): boolean { return this.map.size === 0 }

  /** Resolve: every non-conflicted key → its winning value; conflicted keys are dropped + listed. */
  resolve(): { winners: Map<string, V>; conflicts: Conflict[] } {
    const winners = new Map<string, V>()
    const conflicts: Conflict[] = []
    for (const [key, slot] of this.map) {
      if (slot.conflict) conflicts.push({ key, sources: [...slot.conflict] })
      else winners.set(key, slot.value)
    }
    return { winners, conflicts }
  }
}

/** Byte-array equality (for CHR-tile / raw-CHR values). */
export const bytesEq = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i])
/** Number equality (for palette / tilemap-word values). */
export const numEq = (a: number, b: number): boolean => a === b

/**
 * Count `unitBytes`-stride blocks that differ between `next` (an overlay-edited blob) and
 * `base` (its pristine decompressed bytes) — the exact "what changed vs base" magnitude the
 * Changed-graphics inventory reports (a CHR tile = 16/32 B, a tilemap word = 2 B, a raw byte =
 * 1 B). `totalUnits` spans the LONGER blob, so a size change counts every extra block as
 * changed (a byte present in one and absent in the other always differs). Pure / Electron-free
 * so it's unit-tested under plain `node`.
 */
export function countChangedUnits(
  next: Uint8Array,
  base: Uint8Array,
  unitBytes: number
): { changedUnits: number; totalUnits: number } {
  const stride = Math.max(1, unitBytes)
  const totalUnits = Math.ceil(Math.max(next.length, base.length) / stride)
  let changedUnits = 0
  for (let u = 0; u < totalUnits; u++) {
    const off = u * stride
    for (let i = 0; i < stride; i++) {
      // Out-of-range reads as a sentinel that never equals a real 0..255 byte, so a
      // length mismatch within the block registers as a change.
      if ((next[off + i] ?? -1) !== (base[off + i] ?? -1)) { changedUnits++; break }
    }
  }
  return { changedUnits, totalUnits }
}
