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
//     arena chars $B9-$BC (chars = CPC nibble packing = YY-CHR "4BPP GBA",
//     byte-identical; $BB/$BC's per-char palette-row tables ride the manifest
//     (`tileSub`) for the in-app thumbnail — deliberately NO .col, YY-CHR's GBA
//     encoder corrupts Col-mode edits: gfx-yychr.ts header — see MODE7_FILES);
//   • lz2 CHR files no known scene loads (other/ — bytes round-trip; depth unknown);
//   • the raw planar `.bin`s (raw/ animation strips) + the 1bpp fonts (advanced/).
//   • the GSU chunky bitmap banks $53-$56 (gsu/ — 1 byte/pixel, two nibble layers,
//     256-byte row stride) presented as planar 4bpp through the bijective
//     chunky↔planar transform ycompress uses for AllGFX.bin (chunkyToPlanar /
//     planarToChunky, validated byte-for-byte against FuSoYa's real output —
//     ycompress-allgfx.md §3). The glyph/icon/scenery PNG editors remain the
//     semantically-aware surfaces; this is the raw whole-bank view.
// Excluded: anything whose bytes are TILEMAP data, not pixels — the Tilemaps/
// entries, the $BD Raphael arena Mode-7 map (its layout edits live in the Bosses
// aseprite export), and the verified-unused leftover tilemap slots
// (VERIFIED_UNUSED_LZ2_CHR) — except the Mode-7 CHAR sets that merely live in
// tilemap-id space (MODE7_FILES). lz16
// files no scene loads are sized by probing the blob (probeLz16RowCount); the four
// orphaned lz16-in-lz2-slot blobs ($2C-$2F) export view-only
// (ORPHANED_LZ16_IN_LZ2_SLOTS).

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SymbolMap } from 'snes-framework/symbol-map'
import { lz2, lz16, probeLz16RowCount } from 'snes-framework/decompress'
import { snesToPC } from 'snes-framework/symbol-map'
import { collectLevelGfxInfo, type GfxRole } from 'snes-framework/render-gfx-files'
import { exportScreenGfxPngs, titleVariant, storybookVariant, buildBonusSceneContext } from 'snes-framework/screen-gfx'
import { loadScenePalettes } from 'snes-framework/load-palettes'
import { buildStorybookIntroContext } from 'snes-framework/screen-storybook-intro'
import { CREDITS_CGRAM, CREDITS_TEXT_ROW, CREDITS_ART_ROW } from 'snes-framework/credits-palette-facts'
import { loadLevel } from 'snes-framework/level'
import { buildLevelIconContext } from 'snes-framework/world-map-level-icons'
import { parseGfxPtrTable, gfxFileForLabel, GFX_ARENA } from 'snes-framework/gfx-reinsert'
import {
  padToYychrBank,
  stripYychrPad,
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
import {
  LZ2_SPECIALS,
  LZ16_SPECIALS,
  RAW_GFX_FILES,
  ORPHANED_LZ16_IN_LZ2_SLOTS,
  VERIFIED_UNUSED_LZ2_CHR
} from 'snes-framework/gfx-file-catalog'
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
 *      stored nibbles stay 4-bit; the row table rides the manifest (`tileSub`,
 *      in-app thumbnail only) — deliberately NOT a `.col`, which would make
 *      YY-CHR corrupt every Col-mode edit of a `.gba` sheet (gfx-yychr.ts
 *      header; diagnosed from a real corrupted edit 2026-07-19).
 *    - $BD: CODE_00B70B — NO unpack; the raw bytes are the Mode-7 TILEMAP
 *      (64×64 cells, one byte = char index), DMA'd to the $2118 LOW-byte lane
 *      into the left half of the 128-wide map. Not pixel art.
 *  $B9-$BD are one scene: Raphael's moon arena (level-mode 9,
 *  `CODE_load_levelmode_09_settings` seeds DP $10-$14 = $B9..$BD; palette rows
 *  0-4 from DATA_5FE3EA..E46A). Verified end-to-end by composing the arena from
 *  these five files + the tables — renders Raphael's moon exactly
 *  (tmp/m7-compose.ts → tmp/m7-arena.png, 2026-07-02).
 *  $B3-$B8 (giant Baby Bowser $B3-$B6 = chars 0-255, giant Hookbill $B7/$B8 =
 *  chars 0-127) are ALSO CPC: their boss loaders (CODE_0DD3E9 /
 *  CODE_hookbill_begin_init1) bypass the 65816 handler tail via CODE_00B756
 *  and nibble-unpack on the GSU instead (FXCODE_08AA5F — same 2 px/byte, low
 *  nibble first) before the $2119 high-lane DMA (asm-traced 2026-07-19; they
 *  were mis-exported as raw 8bpp before that). */
/** Presentation names for the Mode-7 sheets; roles/encodings come from the
 *  catalog (`LZ2_SPECIALS` — kind `mode7-chr-cpc` +
 *  the `$BB/$BC` per-char palette-row tables; the `mode7-tilemap` kind — $BD —
 *  is NOT here: tilemap bytes, not CHR). */
const MODE7_BASES: Record<number, string> = {
  0xb1: 'advanced/title-island',
  0xb9: 'advanced/raphael-chars-00',
  0xba: 'advanced/raphael-chars-40',
  0xbb: 'advanced/raphael-chars-80',
  0xbc: 'advanced/raphael-chars-c0',
  0xb3: 'advanced/bowser-chars-00',
  0xb4: 'advanced/bowser-chars-40',
  0xb5: 'advanced/bowser-chars-80',
  0xb6: 'advanced/bowser-chars-c0',
  0xb7: 'advanced/hookbill-chars-00',
  0xb8: 'advanced/hookbill-chars-40'
}
const MODE7_FILES: Record<
  number,
  { base: string; description: string; cpc: boolean; charPalTableSnes?: number }
> = Object.fromEntries(
  Object.entries(MODE7_BASES).map(([idStr, base]) => {
    const id = Number(idStr)
    const rec = LZ2_SPECIALS[id]
    if (!rec) throw new Error(`MODE7_BASES id 0x${id.toString(16)} missing from LZ2_SPECIALS`)
    if (rec.kind === 'mode7-tilemap') throw new Error(`MODE7_BASES id 0x${id.toString(16)} is a tilemap — not CHR, not exported`)
    const cpc = rec.kind === 'mode7-chr-cpc'
    const suffix = cpc
      ? (rec.charPalTableSnes !== undefined ? ' — opens as 4BPP GBA; per-char palette rows shown in-app only (README)' : ' — opens as 4BPP GBA')
      : ' — opens as 8BPP'
    return [id, { base, description: rec.description + suffix, cpc, charPalTableSnes: rec.charPalTableSnes }]
  })
)

/** The Raphael arena's five palette rows (`DATA_5FE3EA..E46A`, contiguous $A0
 *  bytes → CGRAM rows 0-4 at load) as a YY-CHR `.pal`. */
function raphaelPal(rom: Uint8Array, symbols: SymbolMap): Uint8Array {
  const pc = symbols.tryPc('DATA_5FE3EA') ?? snesToPC(0x5fe3ea)
  const cg = new Uint8Array(512)
  cg.set(rom.subarray(pc, pc + 0xa0))
  return buildPalFromCgram(cg, 0)
}

/** One 15-color row blob placed at its TRUE CGRAM row, as a raw-order `.pal`
 *  (colors 1-15 of `atRow`; color 0 of that row = the given backdrop word). The
 *  shape of the finale/ending palette uploads: $1E bytes copied to
 *  PaletteMirror[$x1..$xF] (Bank0D loops at CODE_0DD375 / CODE_0DF2AA). */
function rowBlobPal(rom: Uint8Array, symbols: SymbolMap, label: string, snesAddr: number, color0: number, atRow: number): Uint8Array {
  const pc = symbols.tryPc(label) ?? snesToPC(snesAddr)
  const cg = new Uint8Array(512)
  const base = atRow * 32
  cg[base] = color0 & 0xff
  cg[base + 1] = (color0 >> 8) & 0xff
  cg.set(rom.subarray(pc, pc + 0x1e), base + 2)
  return buildPalFromCgram(cg, 0)
}
/** Giant-Bowser finale body colors (`DATA_5FF4BE`) at CGRAM row 15 — their
 *  live in-game position (Mesen fight capture 2026-07-19: post-fight CGRAM row
 *  15 matches the blob 15/15, exactly the asm's PaletteMirror[$F1] write). */
const bowserPal = (rom: Uint8Array, symbols: SymbolMap): Uint8Array => rowBlobPal(rom, symbols, 'DATA_5FF4BE', 0x5ff4be, 0x0000, 15)
/** Ending-scene BG row (`DATA_5FC328` → CGRAM [$01..$0F]; [$00] = white, as the
 *  loader sets — live-confirmed at gm$18, 14/15). */
const endingBgPal = (rom: Uint8Array, symbols: SymbolMap): Uint8Array => rowBlobPal(rom, symbols, 'DATA_5FC328', 0x5fc328, 0x7fff, 0)

// ORPHANED_LZ16_IN_LZ2_SLOTS + VERIFIED_UNUSED_LZ2_CHR now come from the catalog
// (`snes-framework/gfx-file-catalog`). The orphan handling rationale: decoding
// those slots as lz2 "succeeds" into garbage via a stray $FF terminator, so the
// sweep special-cases them — export the REAL art (lz16 decode, row count probed)
// but keep them OUT of the manifest (an import would re-encode through the lz2
// path and write wrong-format bytes into the slot). View-only.

/** Presentation names for the raw-bank sheets; roles/descriptions come from the
 *  catalog (`RAW_GFX_FILES`). Read overlay-first so a re-export reflects
 *  unbuilt edits. */
const RAW_BASES: Record<string, string> = {
  'Graphics/GFX_520000.bin': 'raw/anim-520000',
  'Graphics/GFX_568000.bin': 'raw/anim-568000',
  'Graphics/GFX_53C000.bin': 'raw/gfx-53c000',
  'Graphics/SuperFX/DATA_530000.bin': 'gsu/map-icons-530000',
  'Graphics/SuperFX/DATA_538000.bin': 'gsu/bonus-icons-538000',
  'Graphics/SuperFX/DATA_540000.bin': 'gsu/glyphs-540000',
  'Graphics/SuperFX/DATA_548000.bin': 'gsu/glyphs-548000',
  'Graphics/SuperFX/DATA_550000.bin': 'gsu/glyphs-550000',
  'Graphics/SuperFX/DATA_558000.bin': 'gsu/glyphs-558000',
  'Graphics/SuperFX/DATA_560000.bin': 'gsu/map-title-560000',
  'Graphics/SuperFX/DATA_570000.bin': 'gsu/menu-icons-570000'
}
const rawBase = (binFile: string): string => {
  const base = RAW_BASES[binFile]
  if (!base) throw new Error(`RAW_BASES missing presentation name for ${binFile}`)
  return base
}
/** Raw uncompressed planar-CHR `.bin`s (catalog kind 'planar'). */
const RAW_PLANAR_BINS = RAW_GFX_FILES.filter((r) => r.kind === 'planar').map((r) => ({
  binFile: r.binFile, base: rawBase(r.binFile), bpp: (r.bpp ?? 4) as 1 | 4, palScene: r.palScene, description: r.description
}))
/** The GSU chunky bitmap banks (catalog kind 'chunky'), exported under gsu/
 *  through the chunky↔planar transform (module header). `palRow`/`palScene`
 *  pick the display palette (map scene for the $53 icons / $56 map base / $57
 *  icon leftovers — the level CGRAM those sheets used to get was wrong for
 *  map art) — display-only. */
const CHUNKY_GSU_BINS = RAW_GFX_FILES.filter((r) => r.kind === 'chunky').map((r) => ({
  binFile: r.binFile, base: rawBase(r.binFile), palRow: r.palRow ?? 0, palRowApprox: r.palRowApprox, palScene: r.palScene, description: r.description
}))

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

/** lz2 slots VERIFIED UNUSED (tmp/list-other-gfx.ts against the dev cart + the
 *  classification audit): GFX_5B03C0..5B121D are in no scene, no spriteset, and no
 *  BG2/BG3 tilemap table (NOT the lz16 sprite files $6F-$72 — a different id
 *  space), and each decompresses to exactly 0x800 B = one leftover 32×32 tilemap
 *  screen parked just before the Tilemaps block — dead data the extract's pointer
 *  sets file under Graphics/. EXCLUDED from the export: tilemap bytes, not CHR,
 *  and nothing in-game reads them. The rest of other/ still exports — "no known
 *  scene loads" ≠ unused (cutscene/ending screens aren't modeled).
 *  The id set itself lives in the catalog (VERIFIED_UNUSED_LZ2_CHR). */
const VERIFIED_UNUSED_LZ2 = VERIFIED_UNUSED_LZ2_CHR

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
    /** The CGRAM group this sheet draws with, when known (16-color rows for
     *  4bpp, 4-color groups for 2bpp) — surfaces in the tab + thumbnail; the
     *  `.pal` itself stays raw CGRAM order. Absent = unknown or per-tile (.col). */
    palRow?: number
    /** `palRow` is dominant/representative only (OAM-assigned art, multi-row BG
     *  realities, sibling guesses) — badges as `~N` with a caveat. */
    palRowApprox?: boolean
    pal?: Uint8Array
    col?: Uint8Array
    /** Per-char CGRAM groups for CPC (`.gba`) sheets — manifest/thumbnail only,
     *  never a `.col` (see the guard below). */
    tileSub?: number[]
  }): void => {
    // HARD RULE: never a .col beside a .gba sheet — YY-CHR's 4BPP-GBA encoder has
    // no 4-bit mask, so Col mode corrupts every edit (gfx-yychr.ts header). CPC
    // per-char rows go through `tileSub` (manifest metadata) instead.
    if (args.cpc && args.col) throw new Error(`emitChr(${args.base}): a .col beside a .gba sheet corrupts YY-CHR edits — use tileSub`)
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
      tileBytes: args.bpp === 2 ? 16 : args.bpp === 8 ? 64 : 32,
      palRow: args.palRow,
      palRowApprox: args.palRow !== undefined && args.palRowApprox ? true : undefined,
      multiRow: args.col || args.tileSub ? true : undefined,
      tileSub: args.tileSub
    })
  }

  const chrTiles = (format: 'lz2' | 'lz16', fileId: number, sizeBytes: number, rowCount?: number): Uint8Array =>
    liveTiles(format, fileId) ?? decodeGfxFile(rom, symbols, format, fileId, sizeBytes, rowCount)

  // ── Level-loaded sheets: every distinct tileset combo, first-seen owns the palette.
  let firstCgram: Uint8Array | null = null
  // Every `.pal` ships in RAW CGRAM ORDER (no primary-row reorder — the pane's
  // row numbering always matches the game); the sheet's own row rides the
  // manifest (`palRow`) instead, driving the in-app thumbnail + the row badge.
  const rawPal = (cg: Uint8Array | null | undefined): Uint8Array | undefined =>
    (cg ? buildPalFromCgram(cg, 0) : undefined)
  // Fallback for sheets with NO traced or sibling palette: the first level
  // scene's CGRAM, raw — a real co-loaded palette family, no row claimed.
  const unknownPal = (): Uint8Array | undefined => rawPal(firstCgram)

  // ── Intended-scene CGRAMs for the attributed other/ sheets (all lazy; each
  // failure falls back to unknownPal). The .pal builder orders the given row
  // FIRST, so YY-CHR opens each sheet pre-selected on its intended colors.
  const lazy = <T,>(build: () => T): (() => T | null) => {
    let v: T | null | undefined
    return () => (v !== undefined ? v : (v = (() => { try { return build() } catch { return null } })()))
  }
  const lazyCgram = lazy as (build: () => Uint8Array) => () => Uint8Array | null
  // World-map CGRAM (world 0) — the map-art GSU banks' display .pal (the $53
  // icons draw as map-scene OAM, rows 8+) and the map-owned lz16 sheets.
  const mapCgramOnce = lazyCgram(() => buildLevelIconContext(rom, symbols, 0).cgram)
  const sceneCgram = (palette: { startOffset: number; slots: readonly number[] }): Uint8Array => {
    const cg = new Uint8Array(512)
    loadScenePalettes(rom, symbols, palette, cg)
    return cg
  }
  const titleCg = lazyCgram(() => sceneCgram(titleVariant(rom, symbols).palette))
  const storybookCg = lazyCgram(() => sceneCgram(storybookVariant().palette))
  const bonusCg = lazyCgram(() => buildBonusSceneContext(rom, symbols, 0).cgram)
  // Bandit minigames: scene palette program X=$C2 (rows 0-13 + Yoshi row, all
  // master-blob literals — research/graphics-survey/08-screens.md §7).
  const banditCg = lazyCgram(() => sceneCgram({ startOffset: 0xc2, slots: [] }))
  // gm$38 storybook prologue: settled BG/OBJ blobs (screen-storybook-intro.ts).
  const prologueCg = lazyCgram(() => buildStorybookIntroContext(rom, symbols).cgram)
  // Boss-room scenes: the ending room (record $DD — bg2 row $1F = lz16 $A7/$A8)
  // and Hookbill's room (record $86 — his Mode-7 body reads CGRAM row 0 live).
  const roomScene = (recordId: number): ReturnType<typeof collectLevelGfxInfo> => {
    const base = loadLevel({ workRoot: frameworkWorkRoot(), levelRecordId: recordId })
    const h = base.header
    if (!h || h.length < 15) throw new Error(`record 0x${recordId.toString(16)} has no usable header`)
    // Field mapping mirrors resources.ts distinctSceneHeaders (bgColor=h[0],
    // spriteTileset=h[7], spritePalette=h[8] — h[9] is levelMode, NOT a tileset).
    return collectLevelGfxInfo(rom, symbols, {
      bgColor: h[0]!, bg1Tileset: h[1]!, bg1Palette: h[2]!, bg2Tileset: h[3]!, bg2Palette: h[4]!,
      bg3Tileset: h[5]!, bg3Palette: h[6]!, spriteTileset: h[7]!, spritePalette: h[8]!,
      yoshiColor: 0, isWorld6: false
    })
  }
  const endingRoom = lazy(() => roomScene(0xdd))
  const hookbillRoomCg = lazyCgram(() => roomScene(0x86).cgram)
  // Retry / game-over screen: scene palette program at X=$4A
  // (CODE_gm13_prepare_retry_screen → CODE_00BB05, traced 2026-07-19).
  const retryCg = lazyCgram(() => sceneCgram({ startOffset: 0x4a, slots: [] }))
  /** Intended co-loaded CGRAM + palette row for an attributed sheet; undefined =
   *  no traced source and no sensible sibling (callers fall back to unknownPal,
   *  with no row claimed). Rows follow each sheet's VRAM destination class (OBJ
   *  region → row 8, BG → row 0); leftovers use their closest SIBLING scene
   *  (the FR/DE minigame text shares the EN sheets' bandit/bonus scenes). */
  const intendedPal = (format: 'lz2' | 'lz16', id: number): { cg: Uint8Array | null; row: number; exact?: boolean } | undefined => {
    if (format === 'lz2') {
      switch (id) {
        // $1D (Mode-0 BG2 logo): sub-palettes sit at the +32 BG2 base — 2bpp
        // group 8+ (LOGO_BG2_PALETTE_BASE, capture-verified in screen-scene.ts);
        // group 8 is the base field, per-cell fields go up to 15.
        case 0x1d: return { cg: titleCg(), row: 8 }
        case 0x1f: return { cg: titleCg(), row: 0 }
        // Bonus rows derived from the bonus scene's own tilemap-word histogram
        // (tmp/bonus-rows2.ts, 2026-07-19): $21 → row 0, $22 → row 1 (p1:51/p7:50),
        // $1C (BG3 2bpp) → group 0.
        case 0x1c: return { cg: bonusCg(), row: 0, exact: true } // whole-sheet-derived (256/256 cells p0)
        case 0x21: return { cg: bonusCg(), row: 0 }
        case 0x22: return { cg: bonusCg(), row: 1 }
        case 0x24: return { cg: banditCg(), row: 8 }
        case 0x25: return { cg: banditCg(), row: 0 }
        // $26: mini-battle variant-0 histogram — BG2 backdrop row 7 (1024 cells)
        // dominant; its BG1 cells use rows 4/5 (true multi-row art).
        case 0x26: return { cg: banditCg(), row: 7 }
        // $50: whole-sheet-derived — all 1024 BG3 cells group 0 (variant 0).
        case 0x50: return { cg: banditCg(), row: 0, exact: true }
        // Storybook rows from the capture-derived facts module (defaultRow):
        // $27 group 1, $87 row 2; $4A/$8A row 8 and $8B row 0 facts-confirmed.
        case 0x27: return { cg: storybookCg(), row: 1 }
        // GOAL! letters draw in palette row 0 of the CURRENT level's CGRAM
        // (Mesen goal trace; the first row read used the 2bpp char stride on this
        // 4bpp sheet and mis-bucketed the cells — row 0 is the 4bpp-stride result,
        // user-confirmed in YY-CHR).
        case 0x20: return { cg: firstCgram, row: 0 }
        case 0x4a: return { cg: storybookCg(), row: 8 }
        case 0x6e: return { cg: bonusCg(), row: 0 } // sibling: bonus title lettering family
        default: return undefined
      }
    }
    switch (id) {
      case 0x10: case 0x11: return { cg: retryCg(), row: 14 } // OBJ sheets (row E — user-verified in YY-CHR)
      case 0x13: return { cg: bonusCg(), row: 8 }
      // Bonus text/HUD sheets draw in BG row 7 (bonus-scene tilemap histogram:
      // $14 p7:64+, $15 p7:41, $16 p7:64 — the row-0 guess was wrong).
      case 0x14: case 0x15: case 0x16: return { cg: bonusCg(), row: 7 }
      case 0x73: case 0x8c: case 0x8f:
      case 0x91: case 0x92: case 0x93: case 0x94: // X-filler — sibling: the map marker table family
      case 0x95: case 0x96: case 0x97: case 0x98:
      case 0x99: case 0x9a: case 0x9b: case 0x9c:
      case 0x9d: case 0x9e: case 0x9f: case 0xa0:
        return { cg: mapCgramOnce(), row: 8 }
      case 0x87: return { cg: storybookCg(), row: 2 } // facts defaultRow
      case 0x89: case 0x8b: return { cg: storybookCg(), row: 0 } // $8B facts-confirmed; $89 uncovered (guess)
      case 0x8a: return { cg: storybookCg(), row: 8 }
      // Record $DD (the 6-8 fight/ending room — the boss door's warp dest):
      // bg2 chars $A7/$A8 + the spriteset-$7B Bowser strips, each at the row the
      // room walk derives (the strips get their real OBJ row).
      case 0xa7: case 0xa8:
      case 0x6a: case 0xad: case 0xae: case 0xaf: case 0xb0: {
        const info = endingRoom()
        if (!info) return undefined
        const e = info.entries.find((x) => x.format === 'lz16' && x.fileId === id)
        return { cg: info.cgram, row: e?.paletteRow ?? 0 }
      }
      case 0xab: case 0xac: return { cg: prologueCg(), row: 8 }
      case 0xb1: case 0xb2: return { cg: prologueCg(), row: 0 }
      // Credits: runtime-assembled palette, captured live from a Mesen run
      // (credits-palette-facts.ts — rows from the BG2 tilemap-word histogram).
      case 0xb3: return { cg: CREDITS_CGRAM, row: CREDITS_TEXT_ROW }
      case 0xb4: case 0x8d: case 0x8e: return { cg: CREDITS_CGRAM, row: CREDITS_ART_ROW }
      // Sibling palettes for the FR/DE leftover text (EN siblings $14/$50 live
      // in the bonus/bandit scenes).
      case 0xb5: case 0xb6: case 0xb9: return { cg: banditCg(), row: 0 }
      case 0xb7: case 0xb8: case 0xba: return { cg: banditCg(), row: 0 }
      default: return undefined
    }
  }
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
      // Scene-program level modes route NON-level files through the walk (the
      // mode-$0A cinema's $18A program) — consult the catalog before emitting:
      //  • tilemap/unused/orphan kinds (the $AF cinema tilemap) are not CHR — skip;
      //  • mode-7 CPC kinds defer to the advanced/ sweep (correct format there);
      //  • screen-chr/leftover-chr rows lend their description + pinned depth
      //    (the $1E cinema chars are 2bpp — the walk's role default said 4).
      const sp2 = e.format === 'lz2' ? LZ2_SPECIALS[e.fileId] : undefined
      if (sp2?.kind === 'mode7-chr-cpc') continue // no seen-mark — advanced/ handles it
      seen.add(key)
      if (sp2 && sp2.kind !== 'screen-chr' && sp2.kind !== 'leftover-chr') continue
      const described = sp2?.kind === 'screen-chr' || sp2?.kind === 'leftover-chr'
        ? sp2
        : e.format === 'lz16' ? LZ16_SPECIALS[e.fileId] : undefined
      const bpp = (sp2?.kind === 'screen-chr' ? sp2.bpp : undefined) ?? e.bpp
      const tiles = chrTiles(e.format, e.fileId, e.sizeBytes, e.rowCount)
      const global = e.role.category === 'sprites' && e.role.tier === 'global'
      const roleTxt =
        e.role.category === 'bg1-tileset' ? 'BG1 tileset' :
        e.role.category === 'bg2' ? 'BG2 background' :
        e.role.category === 'bg3' ? 'BG3 background' :
        e.role.category === 'sprites' ? (global ? 'Global sprite sheet' : 'Spriteset sheet') :
        e.role.category === 'hud' ? 'HUD / font / status' : 'Level graphics'
      const usePerTile = e.perTile && bpp === e.bpp ? e.perTile : undefined
      emitChr({
        base: `${roleFolder(e.role)}/${hexId(e.fileId)}${global ? '-global' : ''}`,
        description: described
          ? `${described.description} (${e.format} file 0x${e.fileId.toString(16).toUpperCase()})`
          : `${roleTxt} (${e.format} file 0x${e.fileId.toString(16).toUpperCase()})`,
        format: e.format,
        fileId: e.fileId,
        bpp,
        tiles,
        rowCount: e.rowCount,
        // The .pal is the scene's CGRAM, raw. With a .col, each byte is the
        // tile's REAL CGRAM group (perTile.rows maps sub → group), so YY-CHR
        // shows true per-tile colors over true row numbering; without one,
        // `palRow` carries the sheet's row for the tab badge + thumbnail.
        pal: rawPal(info.cgram),
        palRow: usePerTile ? undefined : e.paletteRow,
        // Flat level badges are representative only: BG1 cells carry Map16
        // palette bits, sprite/HUD chars get per-OAM palettes.
        palRowApprox: true,
        col: usePerTile
          ? buildColSidecar(usePerTile.tileSub.map((s) => usePerTile.rows[s] ?? 0), bpp, padToYychrBank(tiles, bpp).length)
          : undefined
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
      const base = `screens/${(s.file.split('/').pop() ?? hexId(s.fileId)).replace(/\.(png|aseprite)$/, '')}`
      const sRows = s.perTilePalette?.rows
      emitChr({
        base,
        description: `${s.description} (${s.format} file 0x${s.fileId.toString(16).toUpperCase()})`,
        format: s.format,
        fileId: s.fileId,
        bpp: s.bpp,
        tiles,
        rowCount: s.rowCount,
        // Raw owning-scene CGRAM; per-tile sheets carry CGRAM-true .col groups,
        // flat sheets carry their row in `palRow` (same scheme as level sheets).
        pal: rawPal(s.cgram) ?? rawPal(firstCgram),
        palRow: s.perTilePalette ? undefined : s.paletteRow,
        col: s.perTilePalette && sRows
          ? buildColSidecar(s.perTilePalette.tileSub.map((sub) => sRows[sub] ?? 0), s.bpp, padToYychrBank(tiles, s.bpp).length)
          : undefined
      })
    }
  } catch (e) {
    notes.push(`Screen sheets skipped: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ── The full lz2 table: Mode-7 char files (advanced/) + any Graphics/ CHR file
  // no known scene loads (other/ — depth unknown, exported 4bpp; the BYTES
  // round-trip regardless of the display depth). Tilemaps/ entries are excluded
  // (not CHR), except the Mode-7 CHAR sets — the extract classifies $B1 as a
  // tilemap but the island track proves it's char data. Slots proven dead
  // (VERIFIED_UNUSED_LZ2 — leftover tilemap data) are excluded too: tilemap
  // bytes, not pixels, and nothing in-game reads them anyway.
  try {
    const bank06 = readFileSync(join(frameworkWorkRoot(), 'yi', GFX_ARENA.ptrBankFile), 'utf8')
    const lz2Labels = parseGfxPtrTable(bank06, 'lz2')
    const assets = join(frameworkWorkRoot(), 'assets', 'yi')
    let unrefOther = 0
    let orphanViewOnly = 0
    for (let id = 0; id < lz2Labels.length; id++) {
      if (seen.has(`lz2/${id}`)) continue
      if (VERIFIED_UNUSED_LZ2.has(id)) continue // leftover tilemap data — not CHR, not exported
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
          const orphanPal = unknownPal()
          if (orphanPal) artifacts.push({ file: yychrPalName(file), bytes: orphanPal })
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
        const isRaphael = id >= 0xb9 && id <= 0xbc
        // Mode-7 pixels index CGRAM directly (row 0 base); all these .pals are
        // already raw CGRAM models with the data at its true rows.
        let pal = unknownPal()
        let tileSub: number[] | undefined
        if (id === 0xb1) pal = rawPal(titleCg()) ?? pal // title island: the title scene's CGRAM
        if (isRaphael) pal = raphaelPal(rom, symbols) // the arena's real rows 0-4
        let flatRow = 0
        if (id >= 0xb3 && id <= 0xb6) { pal = bowserPal(rom, symbols); flatRow = 15 } // DATA_5FF4BE at its live row 15
        if (id === 0xb7 || id === 0xb8) pal = rawPal(hookbillRoomCg()) ?? pal // Hookbill: his room's live CGRAM
        if (m7.charPalTableSnes !== undefined) {
          // Per-char palette-row offsets ($00-$40) the loader ORs into the pixels
          // (CODE_00B6B7) — exactly YY-CHR's .col semantics (col byte = offset>>4,
          // already a real CGRAM row), but shipped as MANIFEST metadata for the
          // in-app thumbnail only: a .col beside a .gba sheet makes YY-CHR corrupt
          // every Col-mode edit (gfx-yychr.ts header), so in YY-CHR these sheets
          // display flat and the user picks rows by hand (README).
          const tPC = snesToPC(m7.charPalTableSnes)
          tileSub = Array.from(rom.subarray(tPC, tPC + 64), (v) => v >> 4)
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
          palRow: tileSub ? undefined : flatRow,
          tileSub
        })
      } else {
        unrefOther++
        // Known non-level owners ('screen-chr') and content-identified leftovers
        // ('leftover-chr' — e.g. the FR/DE hint panels) come from the catalog;
        // the rest is the generic bucket. A screen-chr row may pin the depth
        // (storybook BG3 $27 = 2bpp).
        const special = LZ2_SPECIALS[id]
        const described = special?.kind === 'screen-chr' || special?.kind === 'leftover-chr'
        const hit = intendedPal('lz2', id)
        emitChr({
          base: `other/${hexId(id)}`,
          description: described
            ? `${special.description} (lz2 file 0x${id.toString(16).toUpperCase()})`
            : `Graphics no known scene loads (lz2 file 0x${id.toString(16).toUpperCase()}) — depth unverified, shown as 4bpp`,
          format: 'lz2',
          fileId: id,
          bpp: described ? (special.bpp ?? 4) : 4,
          tiles,
          pal: (hit ? rawPal(hit.cg) : undefined) ?? unknownPal(),
          palRow: hit?.cg ? hit.row : undefined,
          palRowApprox: hit?.cg ? !hit.exact : undefined
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
      const hit16 = intendedPal('lz16', id)
      emitChr({
        base: `other/${hexId(id)}`,
        // Non-level-scene attributions come from the catalog (LZ16_SPECIALS —
        // retry/bonus/map-marker/storybook/credits/ending chars); the rest is
        // the generic bucket.
        description: LZ16_SPECIALS[id]
          ? `${LZ16_SPECIALS[id].description} (lz16 file 0x${id.toString(16).toUpperCase()})`
          : `Graphics no known scene loads (lz16 file 0x${id.toString(16).toUpperCase()}) — depth unverified, shown as 4bpp`,
        format: 'lz16',
        fileId: id,
        bpp: 4,
        tiles,
        rowCount,
        // Attributed sheets get their owning scene's raw CGRAM (the Bowser
        // strips ride the record-$DD room walk); the rest the unknown default.
        pal: (hit16 ? rawPal(hit16.cg) : undefined) ?? unknownPal(),
        palRow: hit16?.cg ? hit16.row : undefined,
        palRowApprox: hit16?.cg ? !hit16.exact : undefined
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
    // The ending/credits bank gets its real BG row (DATA_5FC328, at row 0); the
    // animation banks a level CGRAM (their tiles span many rows — row 4 is a hint).
    const planarPal = raw.palScene === 'ending' ? endingBgPal(rom, symbols) : rawPal(firstCgram)
    if (planarPal) artifacts.push({ file: yychrPalName(file), bytes: planarPal })
    manifest.push({
      file,
      description: raw.description,
      kind: 'raw',
      binFile: raw.binFile,
      bpp: raw.bpp,
      sizeBytes: bytes.length,
      tileBytes: 1,
      palRow: raw.bpp === 4 ? (raw.palScene === 'ending' ? 0 : 4) : undefined,
      // Anim banks span many rows; the ending/credits bank mixes ending BG art
      // with credits photo strips — representative rows only.
      palRowApprox: raw.bpp === 4 ? true : undefined
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
    const cgram = (gsu.palScene === 'map' ? mapCgramOnce()
      : gsu.palScene === 'title' ? titleCg()
      : gsu.palScene === 'bonus' ? bonusCg()
      : null) ?? firstCgram
    const gsuPal = rawPal(cgram)
    if (gsuPal) artifacts.push({ file: yychrPalName(file), bytes: gsuPal })
    manifest.push({
      file,
      description: gsu.description,
      kind: 'chunky',
      binFile: gsu.binFile,
      bpp: 4,
      sizeBytes: chunky.length,
      tileBytes: 1,
      palRow: gsu.palRow,
      palRowApprox: gsu.palRowApprox
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
    '  *.4bpp.gba   4BPP GBA         (Mode-7 chars: title island, Raphael arena, giant',
    '                                 Bowser + Hookbill — all packed 2 px/byte)',
    '  *.1bpp       pick "1BPP 8x8" by hand (message font / pictures)',
    '',
    'Never rename a sheet to *.bin — YY-CHR would auto-select 2BPP MSX (wrong format).',
    '',
    'Palettes: each sheet auto-loads its *.pal sidecar, which is the owning',
    'scene\'s palette memory in RAW CGRAM ORDER — the palette pane\'s row numbering',
    'matches the game exactly. YY-CHR opens on the FIRST row, so for sheets that',
    'draw in a different row, select the sheet\'s row in the pane — the editor\'s',
    'YY-CHR tab shows each sheet\'s row ("pal row N") in its list entry — a "~"',
    'there means the row is representative only (sprite-assigned or multi-row art',
    'may use other rows for parts of the sheet). For 2bpp',
    'sheets the number is a 4-COLOR group: YY-CHR selects 2bpp palettes in 4-color',
    'sets, so click any cell of group N (its first color = index N*4 — e.g. group 6',
    '= the second 4-block of pane row 1). Files',
    'with a *.col sidecar (BG2/BG3 backgrounds + map screens) need no pick: every',
    'tile displays in its real in-game colors automatically. Painting on a .col',
    'sheet is per-tile as well: a pixel can only become one of its own tile\'s',
    'colors (the tile\'s 16-color row for 4bpp, its 4-color group for 2bpp) — pick',
    'any other palette color and YY-CHR paints the tile\'s own color at that',
    'position within the group instead, so a different color appears than was',
    'picked. Confusing, but harmless: nothing is corrupted. To pick reliably,',
    'right-click a pixel of the wanted color on the tile you are editing (or on',
    'any tile sharing its colors).',
    'The palette only affects display, never the saved data.',
    '',
    'raphael-chars-80 / -c0 use several palette rows at once in-game (rows 0-4,',
    'one per char). They deliberately ship no *.col — pairing one with a 4BPP GBA',
    'sheet makes YY-CHR corrupt pixels on edit — so in YY-CHR they display one',
    'row at a time (pick rows 0-4 in the pane); the app\'s own thumbnails show',
    'every char in its true row.',
    '',
    'The gsu/ sheets are the SuperFX bitmap banks $53-$57 (level-select pictures,',
    'sprite glyphs, title scenery) shown as normal tiles: the first half of each sheet is',
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
    'Sheets named *-orphan are view-only (never imported). The rest of other/ is',
    'art no KNOWN screen loads; some of it may belong to screens the editor does',
    'not model yet, so it is exported normally.',
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
