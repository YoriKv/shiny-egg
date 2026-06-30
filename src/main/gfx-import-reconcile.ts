// The central graphics-import RECONCILER — the Electron-coupled writer half of the
// standardized export/import model (research/graphics-editing/). It exists to fix "edits
// thrash on re-import": the old importers decided "did this file change?" by diffing the
// edited artifact against the CURRENT live/overlay state, which drifts as other files/folders
// import — so re-importing an unedited folder reverted newer edits. The fix is two-part:
//
//   1. CHECKSUM GATE (`changedSinceExport`, gfx-import-conflict.ts): export stamps each
//      artifact's sha256 into the manifest/sidecar; import skips any artifact whose bytes still
//      match (the user didn't touch it) — so a stale/unedited file can't revert a newer edit.
//   2. WHOLE-FILE-AUTHORITATIVE + CONFLICT RECONCILE: a changed artifact records the SHARED,
//      cross-file data it owns — CHR tiles, master-palette colors, raw-CHR byte runs — into one
//      reconciler, tagged by source file. After ALL tracks of BOTH importers have recorded,
//      `apply()` resolves per datum: every source agrees → write it; two changed files DISAGREE
//      on one datum → SKIP that datum, keep the rest, log it (the user's req #3). Writes land on
//      the CURRENT live state (so a prior folder's edits survive).
//
// Single-owner PLACEMENT data (per-world/per-layer tilemap words, the title logo/island
// asm-overlay tilemaps) can't cross-file-conflict, so the importers write it directly (gated by
// checksum for idempotency) rather than through the reconciler — keeping this focused on the
// genuinely shared datums the user named ("1 tile / 1 color").
//
// The pure conflict/checksum core (`ConflictTracker`, the gate) lives in gfx-import-conflict.ts
// (Electron-free, unit-tested); this module adds the cart-resident re-encode + the saves. One
// reconciler instance is created in graphics-folder-io.ts and threaded into both
// importGfxPngsFromDir + importBgRegionFromDir, so a color edited by a screen `.aseprite` AND a
// BG region reconcile together (the conflict scope is the whole imported folder).

import type { SymbolMap } from 'snes-framework/symbol-map'
import type { PaletteEdit } from 'snes-framework/types'
import { liveTiles, decodeGfxFile } from './gfx-import-utils'
import { ConflictTracker, bytesEq, numEq, type Conflict } from './gfx-import-conflict'
import { saveGfxEdit, saveRawChrEdit, savePaletteEdits, loadPaletteEdits } from './resources'

// Re-export the gate so importers can keep a single `./gfx-import-reconcile` import.
export { changedSinceExport } from './gfx-import-conflict'

/** The minimum a CHR gfx file needs for the re-encode (a GfxFileEntry satisfies it, as does a
 *  GfxManifestEntry). `sizeBytes` decompresses the base blob; lz16 also needs its row count. */
export interface ChrFileMeta { format: 'lz2' | 'lz16'; fileId: number; sizeBytes: number }

export interface ReconcileApplyResult {
  /** CHR gfx files re-encoded + saved (saveGfxEdit). */
  applied: number
  /** Master-palette colors written back. */
  paletteChanged: number
  /** Raw-CHR `.bin`s written (saveRawChrEdit). */
  rawApplied: number
  /** One human-readable line per dropped datum (two changed files disagreed). Caller folds
   *  these into the import error list (shown red). */
  conflicts: string[]
}

/**
 * Collects every track's per-datum edits, then writes them all once with cross-file conflict
 * resolution. Record methods are cheap (build a ConflictTracker); `apply()` does the real saves
 * and is called ONCE after both importers have recorded. See the module header.
 */
export class GfxImportReconciler {
  private chr = new ConflictTracker<Uint8Array>(bytesEq) // key = format/fileId/fileTile
  private pal = new ConflictTracker<number>(numEq)       // key = blobOffset
  private raw = new ConflictTracker<Uint8Array>(bytesEq) // key = binFile\toffset
  private meta = new Map<string, ChrFileMeta>()          // 'format/fileId' → re-encode metadata
  private chrTileBytes = new Map<string, number>()       // 'format/fileId' → tile stride
  private chrRole = new Map<string, string>()            // 'format/fileId' → pipeline-supplied role

  /** Register the CHR gfx-file metadata a track knows about (for the re-encode size + lz16 row
   *  count at apply). Idempotent; later registrations of the same id are ignored. */
  registerManifest(entries: readonly ChrFileMeta[]): void {
    for (const e of entries) {
      const k = `${e.format}/${e.fileId}`
      if (!this.meta.has(k)) this.meta.set(k, { format: e.format, fileId: e.fileId, sizeBytes: e.sizeBytes })
    }
  }

  /** A CHR tile edit (pixels). `tileBytes` = the file's tile stride (BG2 4bpp=32 vs BG3 2bpp=16).
   *  `role` (optional) names what the file maps to, for files gfxFileRole can't classify from
   *  level data (world-map char $4C/$56, storybook f27) — folded into the "Changed graphics" detail. */
  chrTile(format: 'lz2' | 'lz16', fileId: number, fileTile: number, bytes: Uint8Array, tileBytes: number, source: string, role?: string): void {
    const fk = `${format}/${fileId}`
    this.chrTileBytes.set(fk, tileBytes)
    if (role) this.chrRole.set(fk, role)
    this.chr.record(`${fk}/${fileTile}`, bytes, source)
  }

  /** Record a WHOLE decompressed CHR blob as per-tile edits (whole-file authoritative: the
   *  faithful raw sheets / region crops / island $B1 — the literal "whole file"). */
  recordWholeBlob(format: 'lz2' | 'lz16', fileId: number, blob: Uint8Array, tileBytes: number, source: string, role?: string): void {
    const n = Math.floor(blob.length / tileBytes)
    for (let t = 0; t < n; t++) this.chrTile(format, fileId, t, blob.slice(t * tileBytes, (t + 1) * tileBytes), tileBytes, source, role)
  }

  /** A master-palette color (blob byte-offset → BGR-15 word). */
  paletteWord(blobOffset: number, bgr15: number, source: string): void {
    this.pal.record(String(blobOffset), bgr15, source)
  }

  /** A raw-CHR byte run (`assets/yi`-relative `.bin` + offset → bytes). */
  rawChr(binFile: string, offset: number, bytes: Uint8Array, source: string): void {
    this.raw.record(`${binFile}\t${offset}`, bytes, source)
  }

  /** True if no datum was recorded (so the caller can skip an empty apply). */
  get empty(): boolean { return this.chr.empty && this.pal.empty && this.raw.empty }

  /** Resolve every datum (drop + log conflicts) and perform all writes once, onto the current
   *  live state. `rom`/`symbols` back the CHR re-encode base when there's no live edit. */
  async apply(rom: Uint8Array, symbols: SymbolMap): Promise<ReconcileApplyResult> {
    const conflicts: string[] = []

    // ── CHR pixels — group winners by file, start from liveTiles ?? cart, splice, saveGfxEdit.
    let applied = 0
    const chr = this.chr.resolve()
    conflicts.push(...chr.conflicts.map((c) => chrConflictMsg(c)))
    const byFile = new Map<string, { fileTile: number; bytes: Uint8Array }[]>()
    for (const [key, bytes] of chr.winners) {
      const i = key.lastIndexOf('/')
      const fk = key.slice(0, i)
      ;(byFile.get(fk) ?? byFile.set(fk, []).get(fk)!).push({ fileTile: Number(key.slice(i + 1)), bytes })
    }
    for (const [fk, tiles] of byFile) {
      const meta = this.meta.get(fk)
      const tileBytes = this.chrTileBytes.get(fk) ?? 32
      if (!meta) { conflicts.push(`gfx ${fk}: not registered (no size) — edits skipped.`); continue }
      const rowCount = meta.format === 'lz16' ? meta.sizeBytes / 512 : undefined
      const base = (liveTiles(meta.format, meta.fileId) ?? decodeGfxFile(rom, symbols, meta.format, meta.fileId, meta.sizeBytes, rowCount)).slice()
      for (const t of tiles) base.set(t.bytes, t.fileTile * tileBytes)
      const r = saveGfxEdit(meta.format, meta.fileId, base, rowCount, { kind: 'chr', unitBytes: tileBytes, role: this.chrRole.get(fk) })
      if (r.ok) applied++
      else conflicts.push(`gfx 0x${meta.fileId.toString(16)}: ${r.error}`)
    }

    // ── Raw-CHR — one saveRawChrEdit over all winners.
    let rawApplied = 0
    const raw = this.raw.resolve()
    conflicts.push(...raw.conflicts.map((c) => `raw CHR ${c.key.replace('\t', ' @ ')}: ${c.sources.join(' & ')} disagree — skipped.`))
    const rawWrites: { binFile: string; offset: number; bytes: Uint8Array }[] = []
    for (const [key, bytes] of raw.winners) {
      const [binFile, offStr] = key.split('\t')
      rawWrites.push({ binFile: binFile!, offset: Number(offStr), bytes })
    }
    if (rawWrites.length > 0) {
      const r = saveRawChrEdit(rawWrites)
      if (r.ok) rawApplied = new Set(rawWrites.map((w) => w.binFile)).size
      else conflicts.push(`raw CHR: ${r.error}`)
    }

    // ── Palette colors — merge winners over the existing palette edits (full-set replace).
    let paletteChanged = 0
    const pal = this.pal.resolve()
    conflicts.push(...pal.conflicts.map((c) => `palette color offset ${c.key}: ${c.sources.join(' & ')} disagree — skipped.`))
    if (pal.winners.size > 0) {
      const palWinners = new Map<number, number>([...pal.winners].map(([k, v]) => [Number(k), v]))
      const merged: PaletteEdit[] = loadPaletteEdits().filter((ed) => !palWinners.has(ed.offset))
      for (const [offset, value] of palWinners) merged.push({ offset, value })
      const r = await savePaletteEdits(merged)
      if (r.ok) paletteChanged = palWinners.size
      else conflicts.push(`palette write-back: ${r.error ?? 'save failed'}`)
    }

    return { applied, paletteChanged, rawApplied, conflicts }
  }
}

/** "tile 0x57 of gfx 0x42 (lz2): a.png & b.png disagree — skipped." from a CHR conflict key. */
function chrConflictMsg(c: Conflict): string {
  const m = /^(lz2|lz16)\/(\d+)\/(\d+)$/.exec(c.key)
  if (!m) return `gfx tile ${c.key}: ${c.sources.join(' & ')} disagree — skipped.`
  return `tile 0x${Number(m[3]).toString(16)} of gfx 0x${Number(m[2]).toString(16)} (${m[1]}): ${c.sources.join(' & ')} disagree — skipped.`
}
