// YY-CHR whole-cart raw-CHR export/import (the Graphics panel's "YY-CHR" target).
// Unlike the PNG/Aseprite tracks this one has NO pixel codec: YY-CHR edits raw SNES
// CHR bytes in place, and raw decompressed CHR is already this pipeline's native
// currency (gfx-live-cache / saveGfxEdit). So the export body is `decompress + pad +
// write bytes` and the import is `truncate pad + byte-diff + the shared reconciler`.
// The .pal/.col sidecars are display aids only (a wrong palette can't corrupt data —
// YY-CHR's pen stores the index-within-row). Engine byte-layout helpers + the
// verified YY-CHR.NET facts live in snes-framework/scripts/engine/gfx-yychr.ts;
// design + decisions in research/graphics-editing/yychr-export.md.
//
// Scope (whole cart, not per-level):
//   • every level-loaded CHR sheet, from the distinct tileset-combo walk
//     (bg1-tileset/ bg2/ bg3/ sprites/ hud/, with exact per-owning-combo palettes +
//     per-tile .col for BG2/BG3);
//   • the screen char sheets (screens/ — boot/title/storybook/world-map);
//   • the Mode-7 files under advanced/ — the title island $B1 + the Raphael moon
//     arena set $B9-$BD (chars = CPC nibble packing = YY-CHR "4BPP GBA",
//     byte-identical; $BD is the arena's TILEMAP, exported bytes-only; $BB/$BC
//     ship .col sidecars from the loader's per-char palette-row tables — see
//     MODE7_FILES);
//   • lz2 CHR files no known scene loads (other/ — bytes round-trip; depth unknown);
//   • the raw planar `.bin`s (raw/ animation strips) + the 1bpp fonts (advanced/).
//   • the GSU chunky bitmap banks $53-$56 (gsu/ — 1 byte/pixel, two nibble layers,
//     256-byte row stride) presented as planar 4bpp through the bijective
//     chunky↔planar transform ycompress uses for AllGFX.bin (chunkyToPlanar /
//     planarToChunky, validated byte-for-byte against FuSoYa's real output —
//     ycompress-allgfx.md §3). The glyph/icon/scenery PNG editors remain the
//     semantically-aware surfaces; this is the raw whole-bank view.
// Excluded: Tilemaps/ (not CHR — that's the aseprite-layout surface) and the GSU
// program bank (`SuperFX/DATA_570000.bin` is executable code, never art). lz16
// files no scene loads are sized by probing the blob (probeLz16RowCount); the four
// orphaned lz16-in-lz2-slot blobs ($2C-$2F) export view-only
// (ORPHANED_LZ16_IN_LZ2_SLOTS).

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SymbolMap } from 'snes-framework/symbol-map'
import { lz2, lz16, probeLz16RowCount } from 'snes-framework/decompress'
import { snesToPC } from 'snes-framework/symbol-map'
import { collectLevelGfxInfo, type GfxRole } from 'snes-framework/render-gfx-files'
import { exportScreenGfxPngs } from 'snes-framework/screen-gfx'
import { parseGfxPtrTable, gfxFileForLabel, GFX_ARENA } from 'snes-framework/gfx-reinsert'
import {
  padToYychrBank,
  stripYychrPad,
  buildPalFromRgbRows,
  buildPalFromCgram,
  buildColSidecar,
  chunkyToPlanar,
  planarToChunky,
  glyphs1bppToBitmap,
  bitmapToGlyphs1bpp,
  bitmap1bppToTiles,
  tiles1bppToBitmap,
  yychrSheetName,
  yychrPalName,
  yychrColName,
  yychrAdfName,
  buildIdentityAdf
} from 'snes-framework/gfx-yychr'
import { FONT_SHEETS } from 'snes-framework/msg-font'
import { gfxLiveEdits } from './gfx-live-cache'
import { liveTiles, decodeGfxFile } from './gfx-import-utils'
import type { GfxImportReconciler } from './gfx-import-reconcile'
import type { YychrManifestEntry } from './gfx-manifest'
import type { YychrImportFileOutcome } from '../shared/ipc-types'
import { distinctSceneHeaders, fontSheetBinFiles, readRawChrOverlayFirst } from './resources'
import { frameworkWorkRoot } from './framework-paths'

const hexId = (id: number): string => `f${id.toString(16).toUpperCase().padStart(2, '0')}`

/** Category folder for a level-loaded file (matches the PNG faithful track's names). */
function roleFolder(role: GfxRole): string {
  return role.category === 'other' ? 'other' : role.category
}

/** Import-side role label from the export's own category folder (the same idea as
 *  gfx-png-import's faithfulGfxRole) — stamps files level data can't classify. */
function yychrRole(relFile: string): string | undefined {
  switch (relFile.split(/[\\/]/)[0]) {
    case 'bg1-tileset': return 'BG1 tileset'
    case 'bg2': return 'BG2 background'
    case 'bg3': return 'BG3 background'
    case 'sprites': return 'Sprite sheet'
    case 'hud': return 'HUD / font / status'
    case 'screens': return 'Screen graphics'
    case 'advanced': return 'Mode-7 / special format'
    case 'gsu': return 'GSU bitmap bank'
    default: return undefined
  }
}

/** The Mode-7 files (all lz2). Ground truth is the loader asm, not a heuristic:
 *  every LZ2 fileId >= $B1 takes the special post-decode path in
 *  `CODE_decompress_lc_lz2` (Bank00 `CODE_00B5A7` → handler table `DATA_00B601`):
 *    - $B9/$BA (and the >= $B1 default, incl. $B1): CODE_00B609 — CPC nibble
 *      unpack (2 px/byte, LOW nibble first) → DMA to the $2119 HIGH-byte lane =
 *      Mode-7 CHARS. Byte-identical to YY-CHR's "4BPP GBA" → `.gba` auto-select.
 *    - $BB/$BC: CODE_00B6B7 — same unpack, plus a per-char palette-row offset
 *      ($00-$40) ORed in from DATA_00B637/DATA_00B677 → CGRAM rows 0-4. The
 *      stored nibbles stay 4-bit; we ship the row table as a `.col` sidecar.
 *    - $BD: CODE_00B70B — NO unpack; the raw bytes are the Mode-7 TILEMAP
 *      (64×64 cells, one byte = char index), DMA'd to the $2118 LOW-byte lane
 *      into the left half of the 128-wide map. Not pixel art.
 *  $B9-$BD are one scene: Raphael's moon arena (level-mode 9,
 *  `CODE_load_levelmode_09_settings` seeds DP $10-$14 = $B9..$BD; palette rows
 *  0-4 from DATA_5FE3EA..E46A). Verified end-to-end by composing the arena from
 *  these five files + the tables — renders Raphael's moon exactly
 *  (tmp/m7-compose.ts → tmp/m7-arena.png, 2026-07-02). */
const MODE7_FILES: Record<
  number,
  { base: string; description: string; cpc: boolean; tilemap?: boolean; charPalTableSnes?: number }
> = {
  0xb1: { base: 'advanced/title-island', description: 'Title screen — floating island (Mode-7 chars, CPC 2px/byte — opens as 4BPP GBA)', cpc: true },
  0xb9: { base: 'advanced/raphael-chars-00', description: 'Raphael moon arena — Mode-7 chars 0-63 (CPC 2px/byte — opens as 4BPP GBA)', cpc: true },
  0xba: { base: 'advanced/raphael-chars-40', description: 'Raphael moon arena — Mode-7 chars 64-127 (CPC 2px/byte — opens as 4BPP GBA)', cpc: true },
  0xbb: { base: 'advanced/raphael-chars-80', description: 'Raphael moon arena — Mode-7 chars 128-191 (CPC 2px/byte — opens as 4BPP GBA; per-char palette rows in the .col)', cpc: true, charPalTableSnes: 0x00b637 },
  0xbc: { base: 'advanced/raphael-chars-c0', description: 'Raphael moon arena — Mode-7 chars 192-255 (CPC 2px/byte — opens as 4BPP GBA; per-char palette rows in the .col)', cpc: true, charPalTableSnes: 0x00b677 },
  0xbd: { base: 'advanced/raphael-tilemap', description: 'Raphael moon arena — Mode-7 TILEMAP, 64×64 cells, one byte per cell = char index. NOT pixel art: bytes round-trip, but pixel painting is meaningless here', cpc: false, tilemap: true }
}

/** The Raphael arena's five palette rows (`DATA_5FE3EA..E46A`, contiguous $A0
 *  bytes → CGRAM rows 0-4 at load) as a YY-CHR `.pal`. */
function raphaelPal(rom: Uint8Array, symbols: SymbolMap): Uint8Array {
  const pc = symbols.tryPc('DATA_5FE3EA') ?? snesToPC(0x5fe3ea)
  const cg = new Uint8Array(512)
  cg.set(rom.subarray(pc, pc + 0xa0))
  return buildPalFromCgram(cg, 0)
}

/** LZ2-table slots $2C-$2F hold ORPHANED LZ16 blobs (a diamond/lattice mesh, 4 KB
 *  each): no in-game loader path resolves them, and two independent reversings
 *  agree on the format — our Bank06/Bank08 asm notes and ycompress's baked-in type
 *  table (ycompress-allgfx.md §1). Decoding them as lz2 "succeeds" into garbage via
 *  a stray $FF terminator, so the sweep special-cases them: export the REAL art
 *  (lz16 decode, row count probed) but keep them OUT of the manifest — an import
 *  would re-encode through the lz2 path (`saveGfxEdit` keys the codec off the
 *  table membership) and write wrong-format bytes into the slot. View-only. */
const ORPHANED_LZ16_IN_LZ2_SLOTS = new Set([0x2c, 0x2d, 0x2e, 0x2f])

/** Raw uncompressed planar-CHR `.bin`s (NOT the chunky SuperFX banks — see the
 *  module header). Read overlay-first so a re-export reflects unbuilt edits. */
const RAW_PLANAR_BINS: { binFile: string; base: string; bpp: 1 | 4; description: string }[] = [
  { binFile: 'Graphics/GFX_520000.bin', base: 'raw/anim-520000', bpp: 4, description: 'Animation tiles — coins / !-blocks / star / water / lava / torches' },
  { binFile: 'Graphics/GFX_568000.bin', base: 'raw/anim-568000', bpp: 4, description: 'Animation tiles — clouds / water cycles / backdrop strips' },
  { binFile: 'Graphics/GFX_53C000.bin', base: 'raw/gfx-53c000', bpp: 4, description: 'Story-cutscene / credits CHR (bank $53 tail) — planar, DMA-streamed by the credits IRQ' }
]

/** The GSU chunky bitmap banks, exported under gsu/ through the chunky↔planar
 *  transform (module header). Content classification is the banks-$52-$56 xref
 *  verification (ycompress-allgfx.md §4). `SuperFX/DATA_570000.bin` is NOT here —
 *  it's the assembled GSU program (code, not art). `palRow` picks the display
 *  palette's primary row: the glyph banks draw as OBJ (row 8), the rest map/title
 *  scenery (row 0) — display-only either way. */
const CHUNKY_GSU_BINS: { binFile: string; base: string; palRow: number; description: string }[] = [
  { binFile: 'Graphics/SuperFX/DATA_530000.bin', base: 'gsu/map-icons-530000', palRow: 0, description: 'World-map level-select icon pictures (GSU bank $53, planar view)' },
  { binFile: 'Graphics/SuperFX/DATA_538000.bin', base: 'gsu/map-icons-538000', palRow: 0, description: 'World-map level-select icon pictures (GSU bank $53, planar view)' },
  { binFile: 'Graphics/SuperFX/DATA_540000.bin', base: 'gsu/glyphs-540000', palRow: 8, description: 'GSU sprite glyphs (bank $54, planar view) — the in-app glyph export knows sprite boundaries; this is the raw bank' },
  { binFile: 'Graphics/SuperFX/DATA_548000.bin', base: 'gsu/glyphs-548000', palRow: 8, description: 'GSU sprite glyphs (bank $54, planar view) — the in-app glyph export knows sprite boundaries; this is the raw bank' },
  { binFile: 'Graphics/SuperFX/DATA_550000.bin', base: 'gsu/glyphs-550000', palRow: 8, description: 'GSU sprite glyphs (bank $55, planar view) — the in-app glyph export knows sprite boundaries; this is the raw bank' },
  { binFile: 'Graphics/SuperFX/DATA_558000.bin', base: 'gsu/glyphs-558000', palRow: 8, description: 'GSU sprite glyphs (bank $55, planar view) — the in-app glyph export knows sprite boundaries; this is the raw bank' },
  { binFile: 'Graphics/SuperFX/DATA_560000.bin', base: 'gsu/map-title-560000', palRow: 0, description: 'World-map character base + title-island 3D scenery (GSU bank $56, planar view)' }
]

export interface YychrArtifact {
  file: string
  bytes: Uint8Array
}

export interface YychrExportCollection {
  /** Every file to write (sheets + .pal/.col sidecars), export-dir-relative. */
  artifacts: YychrArtifact[]
  /** Manifest rows for the SHEETS only (sidecars are never imported). */
  manifest: YychrManifestEntry[]
  /** Coverage notes for the README (skipped unsized lz16 files, missing bins). */
  notes: string[]
}

/** lz2 self-terminates, so an unreferenced file's size is discoverable by decoding. */
function decodeLz2Auto(rom: Uint8Array, symbols: SymbolMap, fileId: number): Uint8Array {
  const tablePC = symbols.pc('DATA_lz2_compressed_gfx_ptrs')
  const p = tablePC + fileId * 3
  const srcPC = snesToPC(rom[p]! | (rom[p + 1]! << 8) | (rom[p + 2]! << 16))
  const buf = new Uint8Array(0x20000)
  const r = lz2(rom, srcPC, buf, 0)
  return buf.slice(0, r.destEnd)
}

/**
 * Collect the whole-cart YY-CHR export. `rom` must already carry the live overlays
 * (the caller passes gfx-png-export's `romWithLiveOverlays` result) and the CHR
 * decode additionally reads the live gfx cache — so the export shows base ⊕ unbuilt
 * edits, matching the import's diff baseline (round-trip symmetric).
 */
export function collectYychrExport(rom: Uint8Array, symbols: SymbolMap): YychrExportCollection {
  const artifacts: YychrArtifact[] = []
  const manifest: YychrManifestEntry[] = []
  const notes: string[] = []
  const seen = new Set<string>() // 'format/fileId'
  const usedNames = new Set<string>()
  const gfxOverride = gfxLiveEdits()

  const uniqueName = (base: string, format: 'lz2' | 'lz16'): string => {
    const b = usedNames.has(base) ? `${base}-${format}` : base
    usedNames.add(b)
    return b
  }

  /** Shared sheet emitter: pad, name by depth, attach sidecars, manifest row. */
  const emitChr = (args: {
    base: string
    description: string
    format: 'lz2' | 'lz16'
    fileId: number
    bpp: 1 | 2 | 4 | 8
    tiles: Uint8Array
    rowCount?: number
    cpc?: boolean
    pal?: Uint8Array
    col?: Uint8Array
  }): void => {
    const padBpp = args.cpc ? 4 : args.bpp
    const padded = padToYychrBank(args.tiles, padBpp)
    const file = yychrSheetName(uniqueName(args.base, args.format), args.bpp, { cpc: args.cpc })
    artifacts.push({ file, bytes: padded })
    if (args.pal) artifacts.push({ file: yychrPalName(file), bytes: args.pal })
    if (args.col) {
      artifacts.push({ file: yychrColName(file), bytes: args.col })
      // A .col REQUIRES an identity .adf beside it or YY-CHR's Col-mode redraw
      // NREs on builds without a default Resources/yychr.adf (see buildIdentityAdf).
      artifacts.push({ file: yychrAdfName(file), bytes: buildIdentityAdf() })
    }
    manifest.push({
      file,
      description: args.description,
      kind: 'chr',
      format: args.format,
      fileId: args.fileId,
      bpp: args.bpp,
      sizeBytes: args.tiles.length,
      rowCount: args.rowCount,
      tileBytes: args.bpp === 2 ? 16 : args.bpp === 8 ? 64 : 32
    })
  }

  const chrTiles = (format: 'lz2' | 'lz16', fileId: number, sizeBytes: number, rowCount?: number): Uint8Array =>
    liveTiles(format, fileId) ?? decodeGfxFile(rom, symbols, format, fileId, sizeBytes, rowCount)

  // ── Level-loaded sheets: every distinct tileset combo, first-seen owns the palette.
  let firstCgram: Uint8Array | null = null
  for (const header of distinctSceneHeaders()) {
    let info: ReturnType<typeof collectLevelGfxInfo>
    try {
      info = collectLevelGfxInfo(rom, symbols, header, { gfxOverride })
    } catch {
      continue
    }
    firstCgram ??= info.cgram
    for (const e of info.entries) {
      const key = `${e.format}/${e.fileId}`
      if (seen.has(key)) continue
      seen.add(key)
      const tiles = chrTiles(e.format, e.fileId, e.sizeBytes, e.rowCount)
      const cpr = e.bpp === 2 ? 4 : 16
      const global = e.role.category === 'sprites' && e.role.tier === 'global'
      const roleTxt =
        e.role.category === 'bg1-tileset' ? 'BG1 tileset' :
        e.role.category === 'bg2' ? 'BG2 background' :
        e.role.category === 'bg3' ? 'BG3 background' :
        e.role.category === 'sprites' ? (global ? 'Global sprite sheet' : 'Spriteset sheet') :
        e.role.category === 'hud' ? 'HUD / font / status' : 'Level graphics'
      emitChr({
        base: `${roleFolder(e.role)}/${hexId(e.fileId)}${global ? '-global' : ''}`,
        description: `${roleTxt} (${e.format} file 0x${e.fileId.toString(16).toUpperCase()})`,
        format: e.format,
        fileId: e.fileId,
        bpp: e.bpp,
        tiles,
        rowCount: e.rowCount,
        // With a .col the .pal is the packed sub-palettes (col byte = sub index);
        // without one, the file's primary CGRAM row first so it opens looking right.
        pal: e.perTile ? buildPalFromRgbRows(e.perTile.subPalettesRgb, cpr) : buildPalFromCgram(info.cgram, e.paletteRow),
        col: e.perTile ? buildColSidecar(e.perTile.tileSub, e.bpp, padToYychrBank(tiles, e.bpp).length) : undefined
      })
    }
  }

  // ── Screen char sheets (cart-static; boot/title/storybook/world-map). The screen
  // export renders PNGs we discard — it's the authoritative enumeration + per-tile
  // palette source for these files, and the set is small.
  try {
    for (const s of exportScreenGfxPngs(rom, symbols, { gfxOverride, groups: { system: true, map: true } })) {
      const key = `${s.format}/${s.fileId}`
      if (seen.has(key)) continue
      seen.add(key)
      const tiles = chrTiles(s.format, s.fileId, s.sizeBytes, s.rowCount)
      const cpr = s.bpp === 2 ? 4 : 16
      const base = `screens/${(s.file.split('/').pop() ?? hexId(s.fileId)).replace(/\.(png|aseprite)$/, '')}`
      emitChr({
        base,
        description: `${s.description} (${s.format} file 0x${s.fileId.toString(16).toUpperCase()})`,
        format: s.format,
        fileId: s.fileId,
        bpp: s.bpp,
        tiles,
        rowCount: s.rowCount,
        pal: s.perTilePalette ? buildPalFromRgbRows(s.perTilePalette.subPalettes, cpr) : firstCgram ? buildPalFromCgram(firstCgram, 0) : undefined,
        col: s.perTilePalette ? buildColSidecar(s.perTilePalette.tileSub, s.bpp, padToYychrBank(tiles, s.bpp).length) : undefined
      })
    }
  } catch (e) {
    notes.push(`Screen sheets skipped: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ── The full lz2 table: Mode-7 files (advanced/) + any Graphics/ CHR file no known
  // scene loads (other/ — depth unknown, exported 4bpp; the BYTES round-trip
  // regardless of the display depth). Tilemaps/ entries are excluded (not CHR),
  // except the Mode-7 set — the extract classifies $B1 as a tilemap but the island
  // track proves it's char data.
  try {
    const bank06 = readFileSync(join(frameworkWorkRoot(), 'yi', GFX_ARENA.ptrBankFile), 'utf8')
    const lz2Labels = parseGfxPtrTable(bank06, 'lz2')
    const assets = join(frameworkWorkRoot(), 'assets', 'yi')
    let unrefOther = 0
    let orphanViewOnly = 0
    for (let id = 0; id < lz2Labels.length; id++) {
      if (seen.has(`lz2/${id}`)) continue
      const m7 = MODE7_FILES[id]
      const isGraphics = existsSync(join(assets, 'Graphics', gfxFileForLabel(lz2Labels[id]!, 'lz2')))
      if (!m7 && !isGraphics) continue // a tilemap (or unextracted slot) — not CHR
      if (ORPHANED_LZ16_IN_LZ2_SLOTS.has(id)) {
        // Real art, wrong table: lz16-decode for viewing, no manifest row (see the
        // constant's doc). Base blob only — nothing can have edited these slots.
        seen.add(`lz2/${id}`)
        try {
          const blob = new Uint8Array(readFileSync(join(assets, 'Graphics', gfxFileForLabel(lz2Labels[id]!, 'lz2'))))
          const rows = probeLz16RowCount(blob)
          if (rows === null) throw new Error('no lz16 row count fits')
          const tiles = new Uint8Array(rows * 512)
          lz16(blob, 0, tiles, 0, rows)
          const file = yychrSheetName(uniqueName(`other/${hexId(id)}-orphan`, 'lz2'), 4)
          artifacts.push({ file, bytes: padToYychrBank(tiles, 4) })
          if (firstCgram) artifacts.push({ file: yychrPalName(file), bytes: buildPalFromCgram(firstCgram, 0) })
          orphanViewOnly++
        } catch (err) {
          notes.push(`Orphaned file 0x${id.toString(16).toUpperCase()} skipped (${err instanceof Error ? err.message : String(err)}).`)
        }
        continue
      }
      let tiles: Uint8Array
      try {
        tiles = liveTiles('lz2', id) ?? decodeLz2Auto(rom, symbols, id)
      } catch {
        notes.push(`lz2 file 0x${id.toString(16).toUpperCase()} skipped (decode failed).`)
        continue
      }
      seen.add(`lz2/${id}`)
      if (m7) {
        const isRaphael = id >= 0xb9 && id <= 0xbd
        let pal = firstCgram ? buildPalFromCgram(firstCgram, 0) : undefined
        let col: Uint8Array | undefined
        if (isRaphael && !m7.tilemap) pal = raphaelPal(rom, symbols)
        if (m7.tilemap) pal = undefined // char-index bytes, not pixels — a palette would mislead
        if (m7.charPalTableSnes !== undefined) {
          // Per-char palette-row offsets ($00-$40) the loader ORs into the pixels
          // (CODE_00B6B7) — exactly YY-CHR's .col semantics (col byte = offset>>4).
          const tPC = snesToPC(m7.charPalTableSnes)
          const tileSub = Array.from(rom.subarray(tPC, tPC + 64), (v) => v >> 4)
          col = buildColSidecar(tileSub, 4, padToYychrBank(tiles, 4).length)
        }
        emitChr({
          base: m7.base,
          description: m7.description,
          format: 'lz2',
          fileId: id,
          bpp: m7.cpc ? 4 : 8,
          tiles,
          cpc: m7.cpc,
          pal,
          col
        })
      } else {
        unrefOther++
        emitChr({
          base: `other/${hexId(id)}`,
          description: `Graphics no known scene loads (lz2 file 0x${id.toString(16).toUpperCase()}) — depth unverified, shown as 4bpp`,
          format: 'lz2',
          fileId: id,
          bpp: 4,
          tiles,
          pal: firstCgram ? buildPalFromCgram(firstCgram, 0) : undefined
        })
      }
    }
    // lz16 files no scene loads: probe the row count from the extracted blob's exact
    // byte length (probeLz16RowCount), then export like any other sheet. Count what
    // still can't be sized honestly instead of silently claiming full coverage.
    const lz16Labels = parseGfxPtrTable(bank06, 'lz16')
    let lz16Unsized = 0
    for (let id = 0; id < lz16Labels.length; id++) {
      if (seen.has(`lz16/${id}`)) continue
      const p = join(assets, 'Graphics', gfxFileForLabel(lz16Labels[id]!, 'lz16'))
      if (!existsSync(p)) continue // unextracted slot
      const rowCount = probeLz16RowCount(new Uint8Array(readFileSync(p)))
      if (rowCount === null) { lz16Unsized++; continue }
      seen.add(`lz16/${id}`)
      const sizeBytes = rowCount * 512
      let tiles: Uint8Array
      try {
        tiles = liveTiles('lz16', id) ?? decodeGfxFile(rom, symbols, 'lz16', id, sizeBytes, rowCount)
      } catch {
        lz16Unsized++
        continue
      }
      unrefOther++
      emitChr({
        base: `other/${hexId(id)}`,
        description: `Graphics no known scene loads (lz16 file 0x${id.toString(16).toUpperCase()}) — depth unverified, shown as 4bpp`,
        format: 'lz16',
        fileId: id,
        bpp: 4,
        tiles,
        rowCount,
        pal: firstCgram ? buildPalFromCgram(firstCgram, 0) : undefined
      })
    }
    if (lz16Unsized > 0) notes.push(`${lz16Unsized} lz16 file(s) couldn't be sized (no row count fits their compressed stream) — not exported.`)
    if (unrefOther > 0) notes.push(`${unrefOther} file(s) no known scene loads exported under other/ with unverified depth.`)
    if (orphanViewOnly > 0) notes.push(`${orphanViewOnly} orphaned sheet(s) (other/*-orphan) are VIEW-ONLY — the game never loads them and edits to them are not imported.`)
  } catch (e) {
    notes.push(`Pointer-table sweep skipped: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ── Raw planar `.bin`s (animation strips + the bank-$53 credits CHR).
  for (const raw of RAW_PLANAR_BINS) {
    let bytes: Uint8Array
    try {
      bytes = readRawChrOverlayFirst(raw.binFile)
    } catch {
      continue // not in this extract
    }
    const file = yychrSheetName(raw.base, raw.bpp)
    artifacts.push({ file, bytes: padToYychrBank(bytes, raw.bpp) })
    if (firstCgram) artifacts.push({ file: yychrPalName(file), bytes: buildPalFromCgram(firstCgram, 4) })
    manifest.push({
      file,
      description: raw.description,
      kind: 'raw',
      binFile: raw.binFile,
      bpp: raw.bpp,
      sizeBytes: bytes.length,
      tileBytes: 1
    })
  }

  // ── GSU chunky bitmap banks (gsu/) — exported as their planar 4bpp view via the
  // bijective transform (module header). `sizeBytes` is the CHUNKY byte length
  // (== the planar length); the import inverse-transforms before diffing, so the
  // write-back stays in the bank's native byte space.
  for (const gsu of CHUNKY_GSU_BINS) {
    let chunky: Uint8Array
    try {
      chunky = readRawChrOverlayFirst(gsu.binFile)
    } catch {
      continue // not in this extract
    }
    const file = yychrSheetName(gsu.base, 4)
    artifacts.push({ file, bytes: padToYychrBank(chunkyToPlanar(chunky), 4) })
    if (firstCgram) artifacts.push({ file: yychrPalName(file), bytes: buildPalFromCgram(firstCgram, gsu.palRow) })
    manifest.push({
      file,
      description: gsu.description,
      kind: 'chunky',
      binFile: gsu.binFile,
      bpp: 4,
      sizeBytes: chunky.length,
      tileBytes: 1
    })
  }

  // ── 1bpp fonts (no auto-select extension → manual "1BPP 8x8" pick; README).
  // The native blobs are NOT 8×8 tiles (8×12 glyph records / a flat 128-px-wide
  // bitmap), so they export RE-TILED into 8×8-tile order — YY-CHR then renders the
  // sheet exactly as our PNG export draws it; the import inverts (gfx-yychr.ts).
  for (const { key, binFile } of fontSheetBinFiles()) {
    let native: Uint8Array
    try {
      native = readRawChrOverlayFirst(binFile)
    } catch {
      continue
    }
    const spec = FONT_SHEETS.find((s) => s.key === key)
    if (!spec) continue
    const widthPx = spec.cols * spec.glyphW
    const tiles = bitmap1bppToTiles(spec.cols === 1 ? native : glyphs1bppToBitmap(native, spec.glyphW, spec.glyphH, spec.cols), widthPx)
    const file = yychrSheetName(`advanced/${key}`, 1)
    artifacts.push({ file, bytes: padToYychrBank(tiles, 1) })
    manifest.push({
      file,
      description: key === 'message-font' ? 'Message font (1bpp — pick format "1BPP 8x8")' : 'Message-box pictures (1bpp — pick format "1BPP 8x8")',
      kind: '1bpp',
      binFile,
      bpp: 1,
      sizeBytes: native.length,
      tileBytes: 1,
      glyphW: spec.glyphW,
      glyphH: spec.glyphH,
      cols: spec.cols
    })
  }

  return { artifacts, manifest, notes }
}

/** The user-facing guide dropped inside the yychr/ export folder. */
export function yychrReadme(notes: string[]): string {
  return [
    'Shiny Egg — YY-CHR graphics export',
    '==================================',
    '',
    'Each file here is a raw SNES graphics sheet you can open and edit directly in',
    'YY-CHR (yychr.exe). The file extension makes YY-CHR pick the right format',
    'automatically:',
    '',
    '  *.4bpp.sfc   4BPP SNES        (backgrounds, sprites, HUD)',
    '  *.2bpp.gb    2BPP GB          (BG3 backgrounds — same format as SNES 2bpp)',
    '  *.4bpp.gba   4BPP GBA         (Mode-7 chars: title island + Raphael arena, packed 2 px/byte)',
    '  *.1bpp       pick "1BPP 8x8" by hand (message font / pictures)',
    '  *.8bpp.m7    raphael-tilemap only — the Mode-7 MAP (one byte per cell = char',
    '               index), not pixel art; no YY-CHR format displays it meaningfully.',
    '',
    'Never rename a sheet to *.bin — YY-CHR would auto-select 2BPP MSX (wrong format).',
    '',
    'Palettes: each sheet auto-loads its *.pal sidecar. Files with a *.col sidecar',
    '(BG2/BG3 + the Raphael arena chars) show every tile in its real in-game palette',
    'row. For sprite sheets,',
    'pick other 16-color rows in the palette pane to preview other sprite palettes —',
    'the palette only affects display, never the saved data.',
    '',
    'The gsu/ sheets are the SuperFX bitmap banks (level-select pictures, sprite',
    'glyphs, title scenery) shown as normal tiles: the first half of each sheet is',
    'the LOW color layer (left page half, then right half), the second half the',
    'HIGH layer — two independent artworks sharing each byte. Edit whichever layer',
    'holds the piece you want; the import converts back automatically.',
    '',
    'Editing: paint tiles, then File > Save (overwrite the file in place). If YY-CHR',
    'asks about saving a small file "expanded", either answer is fine — the import',
    'ignores bytes past the real end of each sheet (they are padding; a warning',
    'appears if you painted into them). Then re-import this folder in Shiny Egg.',
    '',
    'Tiles are often shared: editing one tile changes it everywhere it appears',
    '(every level using the sheet, every sprite using the tile).',
    '',
    ...(notes.length > 0 ? ['Coverage notes:', ...notes.map((n) => `  - ${n}`), ''] : [])
  ].join('\n')
}

/** Invert a re-tiled 1bpp sheet back to its NATIVE record layout (glyph records
 *  or the flat bitmap) — the inverse of the export's `bitmap1bppToTiles` (∘
 *  `glyphs1bppToBitmap`). `sizeBytes` bounds the native length (drops any
 *  band-padding rows the tiling added). */
function untile1bpp(e: YychrManifestEntry, tiles: Uint8Array): Uint8Array {
  const glyphW = e.glyphW ?? 8, glyphH = e.glyphH ?? 8, cols = e.cols ?? 16
  const widthPx = cols * glyphW
  const bitmap = tiles1bppToBitmap(tiles, widthPx)
  if (cols === 1) return bitmap.slice(0, e.sizeBytes)
  const count = Math.floor(e.sizeBytes / ((glyphW >> 3) * glyphH))
  return bitmapToGlyphs1bpp(bitmap, glyphW, glyphH, cols, count)
}

export interface YychrImportCounts {
  imported: number
  skipped: number
  missing: number
  /** Files where nonzero bytes sat past the sheet's true end (painted padding — dropped). */
  padEdited: number
  errors: string[]
  /** Per-entry outcome, in manifest order — the YY-CHR tab's per-file feedback and
   *  the checksum write-back set (`imported`/`no-op` advance the stored hash). */
  outcomes: YychrImportFileOutcome[]
}

/**
 * Import the yychr section of a gfx-manifest: for each sheet whose bytes changed
 * (checksum-gated by the caller), truncate the bank padding and hand the bytes to
 * the shared reconciler — whole-file recordWholeBlob for compressed CHR, changed
 * byte-runs for raw `.bin`s (so it composes with the PNG animation track's writes).
 */
export function importYychrEntries(
  dir: string,
  entries: readonly YychrManifestEntry[],
  gate: (relFile: string) => 'missing' | 'unchanged' | 'changed',
  reconciler: GfxImportReconciler,
  rom: Uint8Array,
  symbols: SymbolMap
): YychrImportCounts {
  const counts: YychrImportCounts = { imported: 0, skipped: 0, missing: 0, padEdited: 0, errors: [], outcomes: [] }
  const eq = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i])
  for (const e of entries) {
    const gv = gate(e.file)
    if (gv === 'missing') { counts.missing++; counts.outcomes.push({ file: e.file, outcome: 'missing' }); continue }
    if (gv === 'unchanged') { counts.skipped++; counts.outcomes.push({ file: e.file, outcome: 'unchanged' }); continue }
    try {
      const raw = new Uint8Array(readFileSync(join(dir, e.file)))
      if (raw.length < e.sizeBytes) throw new Error(`file is ${raw.length} bytes, expected ≥ ${e.sizeBytes} (was it truncated?)`)
      const { bytes, padEdited } = stripYychrPad(raw, e.sizeBytes)
      if (padEdited) counts.padEdited++
      if (e.kind === 'chr' && e.format !== undefined && e.fileId !== undefined) {
        const base = liveTiles(e.format, e.fileId) ?? decodeGfxFile(rom, symbols, e.format, e.fileId, e.sizeBytes, e.rowCount)
        // Bytes equal base ⊕ live → no overlay; a 'no-op' outcome (not 'unchanged')
        // so the checksum write-back still clears the file's changed status.
        if (eq(bytes, base)) { counts.skipped++; counts.outcomes.push({ file: e.file, outcome: 'no-op' }); continue }
        reconciler.registerManifest([{ format: e.format, fileId: e.fileId, sizeBytes: e.sizeBytes }])
        // Whole-file authoritative, INCLUDING a partial tail tile (recordWholeBlob
        // floors to whole tiles; a blob whose size isn't a tile multiple would
        // silently keep its base tail) — the apply splices each record at
        // fileTile*tileBytes, so a short tail array lands byte-exact.
        const role = yychrRole(e.file)
        const whole = Math.floor(bytes.length / e.tileBytes)
        for (let t = 0; t < whole; t++) {
          reconciler.chrTile(e.format, e.fileId, t, bytes.slice(t * e.tileBytes, (t + 1) * e.tileBytes), e.tileBytes, e.file, role)
        }
        if (whole * e.tileBytes < bytes.length) {
          reconciler.chrTile(e.format, e.fileId, whole, bytes.slice(whole * e.tileBytes), e.tileBytes, e.file, role)
        }
        counts.imported++
        counts.outcomes.push({ file: e.file, outcome: 'imported' })
      } else if ((e.kind === 'raw' || e.kind === 'chunky' || e.kind === '1bpp') && e.binFile) {
        // Diff against overlay-first (base ⊕ existing raw edits — what the export
        // showed), recording only NEW changed runs so a re-import can't revert edits
        // from other tracks and run-level conflicts stay detectable. Transformed
        // exports (chunky GSU banks, re-tiled 1bpp sheets) are inverse-transformed
        // FIRST, so the diff + write-back run in the bank's NATIVE byte space — the
        // same bytes saveRawChrEdit writes and the other editors read.
        const edited =
          e.kind === 'chunky' ? planarToChunky(bytes)
            : e.kind === '1bpp' ? untile1bpp(e, bytes)
              : bytes
        const base = readRawChrOverlayFirst(e.binFile)
        let changed = false
        let runStart = -1
        for (let i = 0; i <= edited.length; i++) {
          const differs = i < edited.length && edited[i] !== base[i]
          if (differs && runStart < 0) runStart = i
          if (!differs && runStart >= 0) {
            reconciler.rawChr(e.binFile, runStart, edited.slice(runStart, i), e.file)
            runStart = -1
            changed = true
          }
        }
        if (changed) { counts.imported++; counts.outcomes.push({ file: e.file, outcome: 'imported' }) }
        else { counts.skipped++; counts.outcomes.push({ file: e.file, outcome: 'no-op' }) }
      } else {
        counts.errors.push(`${e.file}: malformed yychr manifest entry.`)
        counts.outcomes.push({ file: e.file, outcome: 'error', error: 'malformed yychr manifest entry' })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      counts.errors.push(`${e.file}: ${msg}`)
      counts.outcomes.push({ file: e.file, outcome: 'error', error: msg })
    }
  }
  return counts
}
