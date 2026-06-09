// Custom-patch apply core — pure (no node/DOM), framework-side so it tests with
// `node`. A patch chunk is an absolute reference (V1.0) offset + bytes. At apply,
// each offset is remapped through the reference symbols → nearest asm label +
// delta → that label's address in the just-built ROM, so the write tracks asm
// drift. Then the bytes are written and the checksum re-fixed.
//
// See research/plan-custom-patches.md.

import type { SymbolMap } from '../engine/symbol-map.ts';
import { fixSnesChecksum, storedSnesChecksum } from './checksum.ts';
import type {
  PatchApplyReport,
  PatchConflict,
  PatchChunk,
  StoredPatchChunk,
  RomVersion
} from '../types.ts';

// ── On-disk chunk codec (PatchChunk ⇄ StoredPatchChunk, bytes ⇄ hex) ────────────

/** Uppercase hex of a byte array, no separators. */
export function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s.toUpperCase();
}

/** Decode an even-length hex string to bytes. Throws on odd length / non-hex. */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
    throw new Error(`invalid hex bytes: "${clean.slice(0, 24)}${clean.length > 24 ? '…' : ''}"`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

/** A chunk must be addressed by EXACTLY one of `offset` (absolute, reverse-looked-
 *  up) or `label` (resolved against the build symbols). Throws otherwise. */
export function validateChunkAddressing(c: { offset?: number | string; label?: string }): void {
  const hasOffset = c.offset !== undefined;
  const hasLabel = c.label !== undefined;
  if (hasOffset === hasLabel) {
    throw new Error(
      `patch chunk must have exactly one of "offset" or "label" (got ${hasOffset ? 'both' : 'neither'})`
    );
  }
}

/** Stored offset (hex string, e.g. "0x62D2") → numeric file offset. Also
 *  accepts "$.."/bare-hex and legacy decimal numbers so older patch files on
 *  disk keep loading. */
function parseStoredOffset(v: number | string): number {
  if (typeof v === 'number') return v;
  const s = v.trim();
  if (s.startsWith('$')) return parseInt(s.slice(1), 16);
  if (/^0x/i.test(s)) return parseInt(s.slice(2), 16);
  return parseInt(s, 16);
}

/** Copy the label-form addressing fields (label + labelOffset) verbatim. */
function labelOf<T extends { label?: string; labelOffset?: number }>(c: T) {
  return {
    ...(c.label !== undefined ? { label: c.label } : {}),
    ...(c.labelOffset !== undefined ? { labelOffset: c.labelOffset } : {})
  };
}

/** Runtime chunks → on-disk form (bytes → hex, offset → "0x" hex string). */
export function chunksToStored(chunks: PatchChunk[]): StoredPatchChunk[] {
  return chunks.map((c) => ({
    ...(c.offset !== undefined ? { offset: '0x' + c.offset.toString(16).toUpperCase() } : {}),
    ...labelOf(c),
    bytes: bytesToHex(c.bytes)
  }));
}

/** On-disk chunks → runtime form (hex → bytes, offset string → number). Throws
 *  on malformed hex or invalid addressing (must have exactly one of offset /
 *  label). */
export function storedToChunks(stored: StoredPatchChunk[]): PatchChunk[] {
  return stored.map((s) => {
    validateChunkAddressing(s);
    return {
      ...(s.offset !== undefined ? { offset: parseStoredOffset(s.offset) } : {}),
      ...labelOf(s),
      bytes: hexToBytes(s.bytes)
    };
  });
}

// ── Build-time address remap (drift tracking) ───────────────────────────────

/** Where a chunk resolves to in the built ROM, and how. */
export interface ResolvedTarget {
  offset: number;
  resolvedVia: 'label' | 'absolute';
  /** The anchor label, when remapped via one. */
  label?: string;
  /** Set when the anchor label vanished from the build (fell back to absolute). */
  unresolvedLabel?: string;
}

/**
 * Remap a reference (V1.0) offset into the just-built ROM, tracking asm drift:
 * reverse-look-up the offset's nearest asm label in `refSym`, then resolve that
 * label's address in `buildSym` and re-apply the delta. Falls back to the raw
 * offset when there's no reference symbol, no preceding label, or the label has
 * vanished from the build (a warning case). When `refSym === buildSym` (no
 * separate reference available, e.g. an un-drifted project) the remap is an
 * identity, so the raw offset is used — correct whenever the build matches the
 * reference.
 */
export function remapChunk(offset: number, refSym: SymbolMap | null, buildSym: SymbolMap | null): ResolvedTarget {
  if (!refSym || !buildSym) return { offset, resolvedVia: 'absolute' };
  const hit = refSym.reverseLookup(offset);
  if (!hit) return { offset, resolvedVia: 'absolute' };
  const base = buildSym.tryPc(hit.label);
  if (base === undefined) return { offset, resolvedVia: 'absolute', unresolvedLabel: hit.label };
  return { offset: base + hit.delta, resolvedVia: 'label', label: hit.label };
}

/**
 * Resolve a chunk's write target by its addressing form:
 *   - `label`(+`labelOffset`): resolve the label DIRECTLY in the just-built symbols
 *     (`buildSym`) + labelOffset. No reverse-lookup — the patch names its own anchor.
 *     If the label isn't in the build, the target is unresolvable (offset -1);
 *     `applyPatches` treats that as fatal (no absolute fallback for a label chunk).
 *   - `offset`: the absolute-offset reverse-lookup remap (`remapChunk`).
 */
export function resolveChunkTarget(
  chunk: PatchChunk,
  refSym: SymbolMap | null,
  buildSym: SymbolMap | null
): ResolvedTarget {
  if (chunk.label !== undefined) {
    const base = buildSym?.tryPc(chunk.label);
    if (base === undefined) {
      return { offset: -1, resolvedVia: 'label', unresolvedLabel: chunk.label };
    }
    return { offset: base + (chunk.labelOffset ?? 0), resolvedVia: 'label', label: chunk.label };
  }
  return remapChunk(chunk.offset ?? 0, refSym, buildSym);
}

/** One patch's worth of chunks, ready to apply (in manifest order). */
export interface AppliedPatch {
  id: string;
  chunks: PatchChunk[];
  romVersionAuthored?: RomVersion;
}

interface Interval {
  patchId: string;
  start: number;
  end: number; // exclusive
}

/** Maximal byte ranges covered by ≥2 distinct patches (later writes win). */
function findConflicts(intervals: Interval[]): PatchConflict[] {
  // Coverage sweep over interval endpoints.
  const points = new Set<number>();
  for (const iv of intervals) { points.add(iv.start); points.add(iv.end); }
  const sorted = Array.from(points).sort((a, b) => a - b);

  const conflicts: PatchConflict[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const lo = sorted[i];
    const hi = sorted[i + 1];
    const ids = new Set<string>();
    for (const iv of intervals) if (iv.start <= lo && iv.end >= hi) ids.add(iv.patchId);
    if (ids.size < 2) continue;
    const last = conflicts[conflicts.length - 1];
    const idList = Array.from(ids);
    if (last && last.offset + last.length === lo && sameSet(last.patchIds, idList)) {
      last.length += hi - lo; // merge contiguous same-contributor segments
    } else {
      conflicts.push({ offset: lo, length: hi - lo, patchIds: idList });
    }
  }
  return conflicts;
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

/**
 * Apply enabled patches to a built ROM **in place**, in order (last write wins).
 * Each chunk's reference offset is remapped via `remapChunk` (`refSym` = where the
 * offset is valid, `buildSym` = the just-built ROM). Out-of-bounds chunks are
 * skipped (never grow the 2 MB cart). When any byte changes, the SNES checksum
 * is recomputed; with nothing applied the ROM is left byte-untouched (preserving
 * base byte-identity for unpatched projects).
 */
export function applyPatches(
  rom: Uint8Array,
  refSym: SymbolMap | null,
  buildSym: SymbolMap | null,
  patches: AppliedPatch[],
  targetRomVersion?: RomVersion
): PatchApplyReport {
  const report: PatchApplyReport = {
    applied: [],
    skipped: [],
    warnings: [],
    conflicts: [],
    chunks: [],
    bytesWritten: 0,
    checksum: storedSnesChecksum(rom)
  };
  const intervals: Interval[] = [];

  for (const patch of patches) {
    let appliedAny = false;
    let warnedVersion = false;
    for (const chunk of patch.chunks) {
      const resolved = resolveChunkTarget(chunk, refSym, buildSym);
      const target = resolved.offset;
      // A label-form chunk whose label isn't in the build is FATAL: the patch
      // named an anchor that doesn't exist (its defining patch is disabled, or
      // ordered after this one). Fail loudly — never silently skip the write.
      if (resolved.unresolvedLabel !== undefined && resolved.resolvedVia === 'label') {
        throw new Error(
          `patch "${patch.id}": label "${resolved.unresolvedLabel}" not found in the build ` +
            `symbols — enable the patch that defines it and order it before this one.`
        );
      }
      // An offset-form chunk whose nearest anchor vanished falls back to its raw
      // reference offset (non-fatal — the absolute offset is still a valid target).
      if (resolved.unresolvedLabel !== undefined) {
        report.warnings.push(
          `${patch.id}: anchor "${resolved.unresolvedLabel}" not in build symbols — using reference offset 0x${(chunk.offset ?? 0).toString(16)}`
        );
      }

      if (target < 0 || target + chunk.bytes.length > rom.length) {
        report.skipped.push({
          id: patch.id,
          reason: `chunk at 0x${target.toString(16)} (+${chunk.bytes.length}) is out of bounds`
        });
        continue;
      }

      if (
        resolved.resolvedVia === 'absolute' &&
        !warnedVersion &&
        patch.romVersionAuthored &&
        targetRomVersion &&
        patch.romVersionAuthored !== targetRomVersion
      ) {
        report.warnings.push(
          `${patch.id}: offsets authored for ${patch.romVersionAuthored} applied to ${targetRomVersion} without label remap — may land wrong`
        );
        warnedVersion = true;
      }

      rom.set(chunk.bytes, target);
      intervals.push({ patchId: patch.id, start: target, end: target + chunk.bytes.length });
      report.chunks.push({
        patchId: patch.id,
        offset: target,
        length: chunk.bytes.length,
        resolvedVia: resolved.resolvedVia,
        ...(resolved.label !== undefined ? { label: resolved.label } : {})
      });
      report.bytesWritten += chunk.bytes.length;
      appliedAny = true;
    }
    if (appliedAny) report.applied.push(patch.id);
  }

  report.conflicts = findConflicts(intervals);
  if (report.bytesWritten > 0) report.checksum = fixSnesChecksum(rom);
  return report;
}
