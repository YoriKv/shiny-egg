// Object render-validity probe: would a std/ext object's stamped tiles have
// their graphics in VRAM under a given level header? Backs the editor's Add-
// picker filter (`render:entityRenderValidity`) and the shipped-cart gate
// (`validity-report.ts`). Promoted from the tmp/object-render-validity.ts
// prototype whose full-matrix run produced research/object-render-validity.tsv.
//
// Method: decode the candidate ALONE in a synthetic one-object level carrying
// the donor level's header, then check every stamped Map16 ID — all 4
// sub-tiles must be VRAM-covered by the loaded gfx manifest, with the
// tile-animation fill counting as covered (see vram-coverage.ts).
//
// Model points, confirmed against every shipped gfx-header tuple (the
// 2026-06-10 matrix run — research/object-render-validity.tsv — then the
// 2026-06-11 X-placeholder correction from the level-0x06 report):
//   - COVERAGE-validity keys on the animationTileset/levelMode pairing: 5
//     objects (steep slopes $08/$09, animated water $35, castle lava $47, icy
//     water $DC) stamp tiles the tile-animation pass must fill.
//   - ART-validity keys on the BG1 tileset's sheets via the cart's own
//     X-placeholder filler (see vram-coverage.ts X_PLACEHOLDER_TILE): a
//     sub-tile slot can be gfx-covered yet hold the X glyph — the sheet has
//     no art for that slot, and a lone placement WILL show X tiles in-game.
//     Theme-locked families (mud ledges $21-$26, flower garden $E4, …) are
//     exactly the ones whose blocks hit X slots under foreign tilesets, so
//     ANY X block escalates the verdict to `invalid`. (Wrong-theme-but-real
//     art — a slot holding another family's tiles — remains undetectable by
//     content; the §B5 thumbnails make it visible instead.) One retail
//     exception exists: level $33 ships Stationary rock $9D whose block $7901
//     IS an X tile in-game — pinned in validity-report.ts.
//   - Page-cell-count overflow (`tile >= pageCellCounts[page]`) is ADVISORY —
//     the fetch math still resolves and shipped levels stamp such IDs (lava
//     $A606 in level 0x08). Only sub-tile VRAM coverage gates.
//   - Map16 IDs the table cannot resolve (page $FExx markers, e.g. $FEB5 in
//     w6 level 0x93) are non-visual markers shipped levels also stamp — they
//     are skipped, never failed.
//   - PPU mode-7 arenas (Raphael, levelMode $09) have no normal BG1 tile
//     rendering; the probe exposes `mode7` so callers report a level-mode
//     situation instead of per-object failures.
//   - Probe-alone semantics (no neighbours, fixed position, metadata default
//     size) are validated: every object placed in a shipped level probes
//     ok/no-visual under its own level's tuple (zero gate failures).

import { loadMap16Tables, decodeMap16Alloc } from './map16.ts';
import { loadSceneRegs } from './scene-regs.ts';
import { loadLevelGfx, type GfxHeader } from './load-graphics.ts';
import { loadTileAnimation } from './load-tile-animation.ts';
import { makeVramCoverage } from './vram-coverage.ts';
import {
  decodeSingleObject,
  singleObjectDonorLevel,
  type SingleObjectDecode
} from './single-object-decode.ts';
import type { SymbolMap } from './symbol-map.ts';
import type {
  GfxFileEntry,
  LevelData,
  ObjectRenderVerdict
} from '../types.ts';

// Single definition lives in types.ts (Node-free island) so the app's IPC
// envelope types can re-use it without importing this engine module.
export type { ObjectRenderVerdict };

export interface ValidityProbeArgs {
  rom: Uint8Array;
  symbols: SymbolMap;
  workRoot: string;
  /** The level whose header the probe runs under. Also the serializer donor
   *  for the synthetic one-object levels, so it must be a backed, non-empty/
   *  special record (`decodeLevelFromLevelData` resolves its level-map
   *  entry). Only the header matters for the verdict — the donor's own
   *  objects/sprites/exits are replaced. */
  donor: LevelData;
  /** World-6 dark BG1 file set. Resolve with the deep resolver
   *  (`isWorld6RecordDeep` / render-core's `isWorld6`) so warp-reached
   *  sub-rooms inherit it. */
  isWorld6: boolean;
  /** Shared single-object decode (the unified picker-catalog pass): when set,
   *  `probe()` decodes through it instead of inline, so one decode per candidate
   *  also feeds the thumbnailer. Omit for standalone use (dev tools / tests). */
  decode?: SingleObjectDecode;
}

export interface ValidityProbe {
  /** PPU mode 7 (Raphael arena, levelMode $09): no normal BG1 tile rendering,
   *  so per-object verdicts are not meaningful — callers should surface the
   *  level mode instead of per-object failures. `probe()` still computes
   *  (the shipped-cart gate runs it for parity with the matrix prototype). */
  mode7: boolean;
  /** Verdict for one candidate decoded alone under the donor's header.
   *  `w`/`h` are the candidate's metadata default size. Memoised per
   *  (kind, id, w, h) — a probe instance is per header tuple. */
  probe(kind: 'std' | 'ext', id: number, w: number, h: number): ObjectRenderVerdict;
}

/** Build a per-header-tuple validity probe: loads the tuple's gfx + tile
 *  animation into VRAM once, then `probe()` decodes candidates against it. */
export function createValidityProbe(args: ValidityProbeArgs): ValidityProbe {
  const { rom, symbols, workRoot, donor, decode } = args;
  const h = donor.header;
  const regs = loadSceneRegs(rom, symbols, h[9] ?? 0);
  const gfxHeader: GfxHeader = {
    bg1Tileset: h[1] ?? 0,
    bg2Tileset: h[3] ?? 0,
    bg3Tileset: h[5] ?? 0,
    spriteTileset: h[7] ?? 0,
    isWorld6: args.isWorld6,
    levelMode: h[9] ?? 0
  };
  const vram = new Uint8Array(0x10000);
  const manifest: GfxFileEntry[] = [];
  loadLevelGfx(rom, symbols, gfxHeader, vram, manifest);
  loadTileAnimation(
    rom,
    symbols,
    { animationTileset: h[10] ?? 0, bg1Tileset: gfxHeader.bg1Tileset, levelMode: h[9] ?? 0 },
    vram
  );
  const coverage = makeVramCoverage(manifest, vram);
  const map16Tables = loadMap16Tables(rom, symbols);
  const bg1CharAddr = regs.bg1CharAddr;

  // Block classification: 'ok' (all sub-tiles hold loaded/anim art) · 'x'
  // (≥1 sub-tile is the X-placeholder filler — covered, but the sheet has no
  // art for this family's slot) · 'miss' (≥1 sub-tile neither loaded nor
  // anim-filled) · 'marker' (unresolvable $FExx ids — non-visual, skipped).
  // See the model points in the file header for why overflow and unresolvable
  // IDs don't fail.
  const classifyBlock = (mid: number): 'ok' | 'x' | 'miss' | 'marker' => {
    let subs;
    try {
      subs = decodeMap16Alloc(map16Tables, mid);
    } catch {
      return 'marker';
    }
    let miss = false;
    for (const st of subs) {
      const off = (bg1CharAddr + st.tileIndex * 32) & 0xffff;
      if (coverage.placeholder(off)) return 'x';
      if (!coverage.covered(off) && !coverage.nonZero(off)) miss = true;
    }
    return miss ? 'miss' : 'ok';
  };

  const cache = new Map<string, ObjectRenderVerdict>();

  const probe = (kind: 'std' | 'ext', id: number, w: number, h2: number): ObjectRenderVerdict => {
    const key = `${kind}:${id}:${w}x${h2}`;
    const hit = cache.get(key);
    if (hit) return hit;

    const decoded = decode
      ? decode(kind, id, w, h2)
      : decodeSingleObject(rom, symbols, workRoot, singleObjectDonorLevel(donor, kind, id, w, h2));

    const verdict = ((): ObjectRenderVerdict => {
      if (!decoded || decoded.stats.aborted) return 'unknown';
      if (decoded.stats.unregisteredObjects > 0) return 'unknown';

      // Every non-zero mid in the decode buffer belongs to the lone candidate.
      const mids = new Set<number>();
      const buf = decoded.state.levelDataBuffer;
      const pageMap = decoded.state.screenPageMap;
      for (let s = 0; s < pageMap.length; s++) {
        const slot = pageMap[s];
        if (slot === 0x80) continue;
        const page = slot & 0x3f;
        if (page === 0) continue;
        const base = page * 512;
        for (let i = 0; i < 512; i += 2) {
          const mid = buf[base + i] | (buf[base + i + 1] << 8);
          if (mid !== 0) mids.add(mid);
        }
      }
      if (mids.size === 0) return 'no-visual';

      let visible = 0;
      let good = 0;
      let xBlocks = 0;
      for (const mid of mids) {
        const cls = classifyBlock(mid);
        if (cls === 'marker') continue; // non-visual marker
        visible++;
        if (cls === 'ok') good++;
        else if (cls === 'x') xBlocks++;
      }
      if (visible === 0) return 'no-visual';
      // ANY X block ⇒ invalid: the sheet itself marks the family's art absent,
      // and a lone placement shows the X glyph in-game (file-header model
      // points). Coverage misses keep the proportional ok/degraded/invalid.
      if (xBlocks > 0) return 'invalid';
      if (good === visible) return 'ok';
      return good === 0 ? 'invalid' : 'degraded';
    })();

    cache.set(key, verdict);
    return verdict;
  };

  return { mode7: (regs.bgmode & 7) === 7, probe };
}
