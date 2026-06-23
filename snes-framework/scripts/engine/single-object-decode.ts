// Shared single-object decode used by BOTH the render-validity probe
// (entity-render-validity.ts) and the picker thumbnailer (entity-thumbnails.ts):
// decode one std/ext object ALONE in a synthetic one-object level carrying the
// donor's header (fixed position, metadata default size, no other entities).
//
// Both passes decode byte-identical input per candidate, so the unified
// picker-catalog pass (render-core's getEntityCatalog) decodes once and feeds
// the result to both — the dedup that halves the catalog's cold cost. The probe
// and thumbnailer each accept an optional injected `SingleObjectDecode`; when
// absent they decode inline here (the standalone path the dev tools + tests
// use), when present they share the caller's memoised decode.

import { decodeLevelFromLevelData, type DecodeLevelByIdResult } from './object-decode/index.ts';
import type { SymbolMap } from './symbol-map.ts';
import type { LevelData, LevelObject } from '../types.ts';

/** Decode one catalog candidate (std/ext object) alone under the donor header.
 *  Returns the decoded synthetic level, or null on decode failure. */
export type SingleObjectDecode = (
  kind: 'std' | 'ext',
  id: number,
  w: number,
  h: number
) => DecodeLevelByIdResult | null;

/** The synthetic one-object level a candidate is decoded in — the donor's
 *  header + a single object at a fixed position and the metadata default size,
 *  no sprites/exits. Identical for the validity probe and the thumbnailer so a
 *  single decode is reusable across them. */
export function singleObjectDonorLevel(
  donor: LevelData,
  kind: 'std' | 'ext',
  id: number,
  w: number,
  h: number
): LevelData {
  const obj: LevelObject = {
    index: 0,
    num: kind === 'std' ? id : 0,
    exnum: kind === 'ext' ? id : undefined,
    x: 24,
    y: 64,
    w: Math.max(1, w),
    h: Math.max(1, h),
    raw: []
  };
  return { ...donor, objects: [obj], sprites: [], exits: [] };
}

/** Decode a candidate's synthetic level, swallowing decode throws as null (both
 *  callers treat a throw and a null result identically — unknown verdict / no
 *  thumbnail). The inline path when no shared decode is injected. */
export function decodeSingleObject(
  rom: Uint8Array,
  symbols: SymbolMap,
  workRoot: string,
  levelData: LevelData
): DecodeLevelByIdResult | null {
  try {
    return decodeLevelFromLevelData({ rom, symbols, workRoot, levelData });
  } catch {
    return null;
  }
}
