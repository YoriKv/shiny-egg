// Build-time graphics reinsert: place re-encoded (edited) graphics blobs into a
// build and keep the ROM layout valid. The companion to the lz2/lz16 *encoders*.
//
// # Why this is small
//
// Every LZ2/LZ16 graphics + tilemap blob is `incbin`'d sequentially in
// `Banks/Bank57.asm` and addressed by `dl LABEL` entries in the two pointer
// tables (`DATA_lz{2,16}_compressed_gfx_ptrs`, Bank06.asm). asar resolves those
// labels at assembly time, so when a blob changes size and shifts every blob
// after it, the pointers **re-resolve automatically — no repointing**. The whole
// arena ends at one `%FREE_BYTES($5F8A36, N, $FF)` boundary with N bytes of `$FF`
// slack, then the 63 KB FreeRegion50/51 beyond.
//
// So an edit needs at most ONE of three things, by how much the arena grows
// (`growth = Σ(newSize − baseSize)` over edited blobs):
//   - growth ≤ 0          → nothing. The data-only overlay (asar `--include`
//                           finds the edited file) just packs smaller; the macro
//                           orgs forward over the harmless gap.
//   - 0 < growth ≤ N      → BOUNDARY MOVE: rewrite the macro to
//                           `($5F8A36+growth, N−growth, $FF)` (same trick as
//                           `boundary-move.ts` for level pools). Needs the
//                           build-tree merge so the edited Bank57.asm is used.
//   - growth > N          → OVERFLOW: spill blobs into FreeRegion50/51 via
//                           `relocate.ts` (not yet wired — see `planGfxLayout`).
//
// Both the data-only and boundary-move paths are proven end-to-end against a
// real asar build (decode the built ROM back, edit + shifted neighbour intact).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { rewriteFreeBytesText, snes6, type BoundaryMove } from './boundary-move.ts';
import { deleteIncbin } from './relocate.ts';
import type { FreeRegion } from './pool-map.ts';
import { encodeLz2 } from './engine/decompress/lz2-encode.ts';
import { encodeLz16 } from './engine/decompress/lz16-encode.ts';

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The single movable arena that holds all graphics + tilemap blobs. */
export const GFX_ARENA = {
  /** Bank `.asm` (relative to `yi/`) whose tail `%FREE_BYTES` bounds the arena. */
  bankFile: 'Banks/Bank57.asm',
  /** SNES address where the blobs end and the `$FF` slack begins. */
  boundary: 0x5f8a36,
  /** Pointer-table bank `.asm` (relative to `yi/`). */
  ptrBankFile: 'Banks/Bank06.asm',
} as const;

export type GfxFormat = 'lz2' | 'lz16';

const PTR_TABLE_LABEL: Record<GfxFormat, string> = {
  lz2: 'DATA_lz2_compressed_gfx_ptrs',
  lz16: 'DATA_lz16_compressed_gfx_ptrs',
};

/** The graphics blob filename a pointer-table `LABEL` resolves to, e.g.
 *  `DATA_5CBA89` (lz16) → `GFX_5CBA89.lz16`. (Tilemap entries in the LZ2 table
 *  resolve to `Tilemaps/…` files that don't match this and are skipped.) */
export function gfxFileForLabel(label: string, format: GfxFormat): string {
  return `GFX_${label.replace(/^DATA_/, '')}.${format}`;
}

/**
 * Ordered pointer-table labels for `format`, index = graphics file ID. Reads the
 * `dl LABEL` rows under the table label in Bank06.asm.
 */
export function parseGfxPtrTable(bank06Text: string, format: GfxFormat): string[] {
  const lines = bank06Text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trimStart().startsWith(`${PTR_TABLE_LABEL[format]}:`));
  if (start < 0) throw new Error(`gfx-reinsert: ${PTR_TABLE_LABEL[format]} not found`);
  const labels: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i]!.match(/^\s*dl\s+(DATA_[0-9A-Fa-f]+)\s*(?:;.*)?$/);
    if (m) labels.push(m[1]!);
    else if (lines[i]!.trim() !== '' && !lines[i]!.trimStart().startsWith(';')) break; // next directive ends the table
  }
  return labels;
}

/** The editable blob file for a graphics file ID, **relative to `assets/yi`** (incl.
 *  its subdir), or null if the table slot has no extracted blob. Most slots are char
 *  sheets → `Graphics/GFX_<addr>.<ext>`; some lz2 slots are tilemaps (and the title
 *  island's Mode-7 char is one — the extract classifies it as a tilemap) →
 *  `Tilemaps/DATA_<addr>.<ext>`. The reinsert pipeline (`computeGfxGrowth`) scans
 *  both dirs, so an edit to either round-trips. */
export function gfxBlobFileForId(yiRoot: string, format: GfxFormat, fileId: number): string | null {
  const text = fs.readFileSync(path.join(yiRoot, GFX_ARENA.ptrBankFile), 'utf8');
  const labels = parseGfxPtrTable(text, format);
  const label = labels[fileId];
  if (!label) throw new Error(`gfx-reinsert: ${format} file ID ${fileId} out of range (${labels.length})`);
  const assets = path.join(yiRoot, '..', 'assets', 'yi');
  const gfx = `Graphics/${gfxFileForLabel(label, format)}`;
  if (fs.existsSync(path.join(assets, gfx))) return gfx;
  const tilemap = `Tilemaps/${label}.${format}`; // e.g. Tilemaps/DATA_5BAE23.lz2
  if (fs.existsSync(path.join(assets, tilemap))) return tilemap;
  return null;
}

/** The arena's current `$FF` fill (slack) parsed from its bank asm. */
export function readArenaFill(yiRoot: string): number {
  const text = fs.readFileSync(path.join(yiRoot, GFX_ARENA.bankFile), 'utf8');
  const re = new RegExp(`%FREE_BYTES\\(\\$${GFX_ARENA.boundary.toString(16).toUpperCase().padStart(6, '0')},\\s*(\\d+),\\s*\\$FF\\)`);
  const m = text.match(re);
  if (!m) throw new Error(`gfx-reinsert: arena %FREE_BYTES at $${GFX_ARENA.boundary.toString(16)} not found in ${GFX_ARENA.bankFile}`);
  return parseInt(m[1]!, 10);
}

export type GfxLayoutMode = 'data-only' | 'boundary-move' | 'overflow';
export interface GfxLayoutPlan {
  /** Σ(newSize − baseSize) over edited blobs. */
  growth: number;
  /** Arena `$FF` slack available for a boundary move. */
  fillSize: number;
  mode: GfxLayoutMode;
  /** Present iff mode === 'boundary-move'. Feeds `rewriteFreeBytesText`. */
  move?: BoundaryMove;
  /** Bytes past the slack, iff mode === 'overflow' (needs relocation). */
  overflowBy?: number;
}

/** Decide the layout action for a total `growth` against `fillSize` slack. */
export function planGfxLayout(growth: number, fillSize: number): GfxLayoutPlan {
  if (growth <= 0) return { growth, fillSize, mode: 'data-only' };
  if (growth <= fillSize) {
    return {
      growth,
      fillSize,
      mode: 'boundary-move',
      move: { bankFile: GFX_ARENA.bankFile, poolId: 'GfxArena', boundary: GFX_ARENA.boundary, fillSize, growth },
    };
  }
  return { growth, fillSize, mode: 'overflow', overflowBy: growth - fillSize };
}

/** An edited graphics blob present in the overlay. `file` is the incbin path
 *  relative to `assets/yi` (e.g. `Graphics/GFX_5CBA89.lz16`). */
export interface GfxEditedBlob {
  file: string;
  overlaySize: number;
  baseSize: number;
}

/**
 * Total arena growth from the edited blobs present in `overlayAssetsYi`
 * (Graphics + Tilemaps), each measured against its base size. An overlay blob
 * with no base counterpart is a new file (counts as pure growth).
 */
export function computeGfxGrowth(
  baseAssetsYi: string,
  overlayAssetsYi: string
): { growth: number; blobs: GfxEditedBlob[] } {
  let growth = 0;
  const blobs: GfxEditedBlob[] = [];
  for (const sub of ['Graphics', 'Tilemaps']) {
    const dir = path.join(overlayAssetsYi, sub);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!/\.lz(2|16)$/.test(name)) continue;
      const file = `${sub}/${name}`;
      const overlaySize = fs.statSync(path.join(dir, name)).size;
      const basePath = path.join(baseAssetsYi, sub, name);
      const baseSize = fs.existsSync(basePath) ? fs.statSync(basePath).size : 0;
      growth += overlaySize - baseSize;
      blobs.push({ file, overlaySize, baseSize });
    }
  }
  return { growth, blobs };
}

// ── overflow relocation: spill edited blobs into the free regions ────────────
//
// When the arena grows past its slack, we MOVE the edited blobs out of the arena
// (delete their incbin from Bank57; the arena then holds only unedited base blobs
// → it shrinks below the boundary, no boundary move needed) and append them into
// the SuperFX-HiROM free regions. `dl LABEL` re-resolves, so nothing repoints.
// We append to each region's CURRENT `%FREE_BYTES` state, so this coexists with
// any level-data relocation that already ran into the same region.

/** The label of the blob whose incbin references `file` in a bank's text. */
function incbinLabelFor(bankText: string, file: string): string {
  const m = bankText.match(new RegExp(`^(\\S+):\\s*\\n\\s*incbin\\s+"${escapeRe(file)}"`, 'm'));
  if (!m) throw new Error(`gfx-reinsert: no incbin for "${file}" found`);
  return m[1]!;
}

const FREE_BYTES_RE = /^([ \t]*)%FREE_BYTES\(\$([0-9A-Fa-f]{6}),\s*(\d+),\s*\$FF\)(.*)$/gm;

/** Current `$FF` fill of `region` in `bankText` (after any prior appends), or
 *  null if its `%FREE_BYTES` isn't present in the region's address range. */
function currentRegionFill(bankText: string, region: FreeRegion): number | null {
  FREE_BYTES_RE.lastIndex = 0;
  for (let m = FREE_BYTES_RE.exec(bankText); m; m = FREE_BYTES_RE.exec(bankText)) {
    const b = parseInt(m[2]!, 16);
    if (b >= region.boundary && b <= region.boundary + region.capacityBytes) return parseInt(m[3]!, 10);
  }
  return null;
}

/** Append `blobs` (each `{label, file, bytes}`) into `region`'s current
 *  `%FREE_BYTES`, mirroring `relocate.ts`'s org-anchored splice. */
function appendGfxToRegion(
  bankText: string,
  region: FreeRegion,
  blobs: { label: string; file: string; bytes: number }[]
): string {
  FREE_BYTES_RE.lastIndex = 0;
  for (let m = FREE_BYTES_RE.exec(bankText); m; m = FREE_BYTES_RE.exec(bankText)) {
    const b = parseInt(m[2]!, 16);
    if (b < region.boundary || b > region.boundary + region.capacityBytes) continue;
    const fill = parseInt(m[3]!, 10);
    const used = blobs.reduce((n, x) => n + x.bytes, 0);
    if (used > fill) throw new Error(`gfx-reinsert: ${used}B exceeds region ${region.id} remaining ${fill}B`);
    const block = blobs.map((x) => `${x.label}:\n\tincbin "${x.file}"`).join('\n\n');
    const repl =
      `${m[1]}%InsertMacroAtXPosition($${snes6(b)})\n${block}\n` +
      `${m[1]}%FREE_BYTES($${snes6(b + used)}, ${fill - used}, $FF)${m[4]}`;
    return bankText.slice(0, m.index) + repl + bankText.slice(m.index + m[0]!.length);
  }
  throw new Error(`gfx-reinsert: no %FREE_BYTES in region ${region.id} range`);
}

/**
 * Relocate every edited blob out of the arena into the free regions, IN PLACE in
 * the build tree (Bank57 incbin deletions + free-region appends). Greedy fill,
 * region by region against current remaining space. Throws if they don't fit.
 * Run AFTER the level-data layout so region appends stack on top of it.
 */
export function relocateGfxBlobs(treeYiRoot: string, blobs: GfxEditedBlob[], freeRegions: FreeRegion[]): void {
  const bank57Path = path.join(treeYiRoot, GFX_ARENA.bankFile);
  let bank57 = fs.readFileSync(bank57Path, 'utf8');
  const inserts = blobs.map((b) => {
    const label = incbinLabelFor(bank57, b.file);
    bank57 = deleteIncbin(bank57, label);
    return { label, file: b.file, bytes: b.overlaySize };
  });
  fs.writeFileSync(bank57Path, bank57);

  const remaining = [...inserts];
  for (const region of freeRegions) {
    if (remaining.length === 0) break;
    const rp = path.join(treeYiRoot, region.bankFile);
    let rtext = fs.readFileSync(rp, 'utf8');
    const fill = currentRegionFill(rtext, region);
    if (fill == null) continue;
    const place: typeof remaining = [];
    let used = 0;
    while (remaining.length && used + remaining[0]!.bytes <= fill) {
      const x = remaining.shift()!;
      place.push(x);
      used += x.bytes;
    }
    if (place.length) fs.writeFileSync(rp, appendGfxToRegion(rtext, region, place));
  }
  if (remaining.length > 0) {
    const over = remaining.reduce((n, b) => n + b.bytes, 0);
    throw new Error(
      `gfx-reinsert: ${over}B of edited graphics don't fit the free regions ` +
        `(${freeRegions.map((r) => r.id).join(', ')}). Revert some graphics edits.`
    );
  }
}

// ── save side: edited decompressed tiles → re-encoded overlay blob ───────────

/** Re-encode edited decompressed tiles into a compressed blob for `format`
 *  (`lz16` needs the tile-row count). The build's reinsert layout then places it. */
export function encodeGfxBlob(format: GfxFormat, tiles: Uint8Array, rowCount?: number): Uint8Array {
  if (format === 'lz2') return encodeLz2(tiles);
  if (rowCount == null) throw new Error('encodeGfxBlob: lz16 requires a rowCount');
  return encodeLz16(tiles, rowCount);
}

/**
 * Re-encode edited tiles for a graphics file ID and write the blob into the overlay
 * (`<overlayAssetsYi>/{Graphics|Tilemaps}/<name>.lz{2,16}`), the file the build's
 * reinsert pipeline picks up. Returns the path written (relative to `assets/yi`,
 * incl. its subdir). Throws if the file ID isn't an editable blob.
 */
export function writeGfxEdit(
  yiRoot: string,
  overlayAssetsYi: string,
  format: GfxFormat,
  fileId: number,
  tiles: Uint8Array,
  rowCount?: number
): string {
  const file = gfxBlobFileForId(yiRoot, format, fileId); // assets/yi-relative (Graphics/ or Tilemaps/)
  if (!file) throw new Error(`gfx-reinsert: ${format} file ID ${fileId} is not a graphics blob`);
  const enc = encodeGfxBlob(format, tiles, rowCount);
  const dest = path.join(overlayAssetsYi, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, enc);
  return file; // already assets/yi-relative (incl. Graphics/ or Tilemaps/)
}

/**
 * Apply a graphics layout plan into the build tree: for a boundary move, rewrite
 * the arena bank's `%FREE_BYTES` from the PRISTINE base into the tree (idempotent
 * — re-running with different growth, or none, reconciles from base). Data-only
 * needs no asm edit. Overflow throws (relocation not yet wired). `baseYiRoot` /
 * `treeYiRoot` are the `yi/` dirs of the pristine base and the build tree.
 */
export function applyGfxLayout(baseYiRoot: string, treeYiRoot: string, plan: GfxLayoutPlan): void {
  if (plan.mode === 'overflow') {
    throw new Error(
      `gfx-reinsert: edit grows the arena by ${plan.growth}B, ${plan.overflowBy}B past the ` +
        `${plan.fillSize}B slack. Relocation to FreeRegion50/51 is not yet wired.`
    );
  }
  const baseText = fs.readFileSync(path.join(baseYiRoot, GFX_ARENA.bankFile), 'utf8');
  const out = plan.mode === 'boundary-move' ? rewriteFreeBytesText(baseText, plan.move!) : baseText;
  const dest = path.join(treeYiRoot, GFX_ARENA.bankFile);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, out, 'utf8');
}
