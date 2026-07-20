// Main-side audio service backing the Audio panel (audio:* IPC). Exported
// functions return the shared-ipc-types envelopes (`{ok:true,…}|{ok:false,
// error}`) so src/main/ipc/audio.ts stays pure channel registration:
//  - the browse/audition catalog over the built ROM (settings, song slots
//    with OST-verified names, SFX names, used-by-levels header scan);
//  - .spc synthesis for the renderer's SPC player (songs + one-shot SFX),
//    with same-size overlay samples spliced in for instant edit preview;
//  - sequence/SFX timeline decoding for the inspector tabs;
//  - the fixed per-project export folder (`<projectRoot>/audio/
//    {sfx,samples}` — the YY-CHR-tab model: no dialogs, one export-all
//    (SFX as editable MML .txt + samples as .brr/.wav) + browse +
//    open-folder) and the BASE-AWARE sample import;
//  - song import over `<projectRoot>/audio/import/` (YI-driver .spc files →
//    candidate songs → try-out .spc against a chosen target module's set →
//    Import = overlay song blob + audio-edits.json metadata, budget-gated;
//    the build's audio layout pass re-fits the $4E-$50 region around grown
//    modules; compose/decode paths apply overlay modules so imports play
//    without a rebuild; codec in snes-framework/scripts/audio/spc-import.ts
//    + module-layout.ts).
// The sample + song imports are this file's overlay-write paths (guarded by
// requireWritableProject; change metadata in overlayRoot/audio-edits.json;
// callers markRomDirty). System map: research/plan-audio-panel.md.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { join, resolve, sep } from 'path'
import {
  applyUploadStream,
  audioBlobSizes,
  bankSampleSlices,
  buildMmlModule,
  buildSfxTimeline,
  buildSpcFile,
  buildSongTimeline,
  compileMml,
  type CompileMmlOptions,
  composeBlocksAram,
  composeSettingAram,
  computeImportBudget,
  computeSettingAramUsage,
  decodeBrr,
  decodeSfxScript,
  decodeSong,
  detectMmlDialect,
  ENGINE_BLOCK_ID,
  exportSlug,
  extractSongModule,
  findSpcSongCandidates,
  formatSfxMml,
  GLOBAL_SAMPLES_BLOCK_ID,
  importPlacementWindows,
  JINGLE_FREE_SONG_MODULES,
  MAP_RESIDENT_SEQ_REGION,
  mapResidentReservationBlocks,
  MmlModuleError,
  moduleSongsUseEcho,
  parseBlockFromRom,
  parseSampleLoopOffsets,
  parseSpcFile,
  parseUploadStream,
  patchBootPortClear,
  planAudioLayout,
  serializeUploadStream,
  planSampleImport,
  readAudioCatalog,
  relocateModuleStream,
  repackKeptLayers,
  representativeSettingByRow,
  resolveSfxChain,
  SAMPLE_BANK_WRAPPERS,
  SAMPLE_MANIFEST_NAME,
  sampleDisplayName,
  SFX_PRIORITY_TABLE,
  SFX_REMAP_TABLE,
  sha256Hex,
  SMW_SAMPLE_FILES,
  songBlobFileOfLabel,
  songDisplayName,
  sliceModuleLayers,
  songSlotPtr,
  songSlotsOfSetting,
  songSlotsOfStream,
  SONG_TABLE_BASE,
  SPC_BLOCK_DISPLAY_NAMES,
  SPC_BLOCK_SAMPLE_DIRS,
  SPC_BLOCKS,
  spcBlockById,
  SpcMergeUnsupportedError,
  spcSongToCompiledMml,
  stripEchoVcmds,
  TITLE_IMPORT_BLOB_FILE,
  TITLE_IMPORT_BLOCK_ID,
  synthesizeImportPreviewSpc,
  synthesizeSfxSpc,
  synthesizeSongSpc,
  verifyYiDriverAram,
  wavFromPcm16,
  type AramImportBudget,
  type AudioCatalog,
  type BankSampleSlice,
  type SampleManifest,
  type SampleManifestEntry,
  type SettingAramUsage,
  type SongTimeline,
  type SpcSongCandidate,
  type UploadStream
} from 'snes-framework/audio'
import { readExtractionState } from 'snes-framework/state'
import { unpackLevelHeader } from 'snes-framework/object-decode'
import { u24le } from 'snes-framework/rom-read'
import { snesToPC, type SymbolMap } from 'snes-framework/symbol-map'
import type {
  AudioAramUsageResult,
  AudioCatalogResult,
  AudioCatalogUi,
  AudioComposeSpcResult,
  AudioDecodeSongResult,
  AudioExportFileUi,
  AudioExportRunResult,
  AudioExportStateResult,
  AudioImportResult,
  AudioImportSongCandidateUi,
  AudioImportSongFileUi,
  AudioImportTargetUi,
  AudioSettingUi,
  AudioSfxUi,
  AudioSongImportPreviewResult,
  AudioSongImportRunResult,
  AudioSongImportStateResult
} from '../shared/ipc-types'
import { loadRomAndSymbols } from './render/rom-cache'
import { frameworkWorkRoot, overlayRoot, projectRoot, writeFileAtomicSync } from './framework-paths'
import { getCurrentProjectId, requireWritableProject } from './projects'

/** Level-header field index of the music setting (see header bit-widths). */
const HEADER_MUSIC_FIELD = 13

// ── catalog ─────────────────────────────────────────────────────────────────

// Keyed by the rom-cache entry identity: loadRomAndSymbols returns a stable
// object until the build artifacts' mtimes change, so a rebuild naturally
// invalidates this cache.
const catalogCache = new WeakMap<object, { catalog: AudioCatalog; ui: AudioCatalogUi }>()

function musicSettingOfRecords(rom: Uint8Array, symbols: SymbolMap): Map<number, number[]> {
  // Walk the cart's record pointer table (indexed record*6: obj dl + spr dl),
  // unpack each backed record's header, group records by field 13. Walking
  // the BUILT ROM's table (rather than the extract-time level map) is
  // deliberate: headers here reflect the built project's edits and naturally
  // cover new-slot levels once built. Sentinel slots ($DA/$DB) point obj at
  // the 1-byte $15FCEA placeholder — skip them.
  const bySetting = new Map<number, number[]>()
  const ptrsPC = symbols.pc('YI_LevelDataPtrsAndEntranceData_Ptrs')
  for (let record = 0; record <= 0xdd; record++) {
    const p = ptrsPC + record * 6
    const objSnes = u24le(rom, p)
    if (objSnes === 0 || objSnes === 0x15fcea) continue
    try {
      const { fields } = unpackLevelHeader(rom, snesToPC(objSnes))
      const setting = fields[HEADER_MUSIC_FIELD]
      const list = bySetting.get(setting)
      if (list) list.push(record)
      else bySetting.set(setting, [record])
    } catch {
      // Unmapped/garbage pointer — not a level record; skip.
    }
  }
  return bySetting
}

let sfxCache: Array<{ id: number; name: string }> | null = null

function readSfxNames(): Array<{ id: number; name: string }> {
  if (sfxCache) return sfxCache
  const asm = readFileSync(join(frameworkWorkRoot(), 'yi', 'Constants', 'SoundIDs.asm'), 'utf8')
  const sfx: Array<{ id: number; name: string }> = []
  for (const m of asm.matchAll(/!Define_YI_SoundID([0-9A-Fa-f]{2})_(\w+)\s*=/g)) {
    const id = parseInt(m[1], 16)
    if (id === 0) continue // "None"
    sfx.push({ id, name: m[2] })
  }
  sfx.sort((a, b) => a.id - b.id)
  sfxCache = sfx
  return sfx
}

function loadCatalog(): { catalog: AudioCatalog; ui: AudioCatalogUi; rom: Uint8Array } {
  const cache = loadRomAndSymbols()
  const hit = catalogCache.get(cache)
  if (hit) return { ...hit, rom: cache.rom }
  const { rom, symbols } = cache
  const catalog = readAudioCatalog(rom, symbols)
  const byMusicSetting = musicSettingOfRecords(rom, symbols)

  const settings: AudioSettingUi[] = catalog.settings.map((s) => {
    const songBlockId = s.blockIds.find(
      (id) => SPC_BLOCKS.find((b) => b.blockId === id)?.kind === 'songs'
    )
    return {
      setting: s.setting,
      name: s.name,
      unused: s.unused,
      blockSetRow: s.blockSetRow,
      modules: s.blockIds.map((id) => SPC_BLOCK_DISPLAY_NAMES[id] ?? `block 0x${id.toString(16)}`),
      initSongId: s.initSongId,
      songs: [...songSlotsOfSetting(rom, catalog, s.setting).keys()]
        .sort((a, b) => a - b)
        .map((slotId) => ({ slotId, name: songDisplayName(s.blockSetRow, slotId) })),
      songBlockId,
      usedByLevels: s.setting <= 0x0f ? (byMusicSetting.get(s.setting) ?? []) : [],
      songModuleBytes:
        songBlockId !== undefined ? parseBlockFromRom(rom, catalog, songBlockId).byteLength : undefined
    }
  })

  // SFX voice/priority: the engine's priority table (1-based — entry for id
  // at SFX_PRIORITY_TABLE-1+id; high nibble = the voice the one-shot plays
  // on), read out of the engine upload stream rather than a composed image.
  const engineBlocks = parseBlockFromRom(rom, catalog, ENGINE_BLOCK_ID).stream.blocks
  const priorityOf = (id: number): number => {
    const addr = SFX_PRIORITY_TABLE - 1 + id
    const b = engineBlocks.find((blk) => addr >= blk.dest && addr < blk.dest + blk.data.length)
    return b ? b.data[addr - b.dest] : 0
  }
  const sfx: AudioSfxUi[] = readSfxNames().map((s) => {
    const priority = priorityOf(s.id)
    return { ...s, priority, voice: (priority >> 4) & 0x0f }
  })

  const blocks = SPC_BLOCKS.map((b) => ({
    blockId: b.blockId,
    name: SPC_BLOCK_DISPLAY_NAMES[b.blockId] ?? b.module,
    module: b.module,
    kind: b.kind
  }))

  const ui: AudioCatalogUi = { settings, sfx, blocks }
  catalogCache.set(cache, { catalog, ui })
  return { catalog, ui, rom }
}

export function getAudioCatalog(): AudioCatalogResult {
  try {
    // Overlay the DRAFT per-song delete state (audio-edits.json) onto the
    // ROM-derived catalog fresh each call — a delete changes audio-edits, not
    // the ROM, so it can't ride the ROM-keyed catalog cache. Deleted slots
    // stay listed (flagged) so the UI can offer Restore even after a build
    // silenced them.
    const ui = loadCatalog().ui
    const songEdits = readAudioEditsMeta()?.songs
    const settings = ui.settings.map((s) => {
      const block = s.songBlockId !== undefined ? SPC_BLOCKS.find((b) => b.blockId === s.songBlockId) : undefined
      const deleted = new Set(block ? (songEdits?.[songBlobFileOfLabel(block.label)]?.deletedSlots ?? []) : [])
      if (deleted.size === 0) return s
      const slotIds = [...new Set([...s.songs.map((g) => g.slotId), ...deleted])].sort((a, b) => a - b)
      return {
        ...s,
        songs: slotIds.map((slotId) => ({
          slotId,
          name: songDisplayName(s.blockSetRow, slotId),
          ...(deleted.has(slotId) ? { deleted: true } : {})
        }))
      }
    })
    return { ok: true, catalog: { ...ui, settings } }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Per-music-set ARAM section usage (one entry per block-set row) — the
 *  Songs-tab diagram. Computed fresh on every call (NOT cached with the
 *  catalog): the overlay module a song import writes changes the picture
 *  without a rebuild, and the paint is cheap. */
export function getAudioAramUsage(): AudioAramUsageResult {
  try {
    const { catalog, rom } = loadCatalog()
    const meta = readAudioEditsMeta()
    const rows: SettingAramUsage[] = []
    for (const [, setting] of [...representativeSettingByRow(catalog).entries()].sort((a, b) => a[0] - b[0])) {
      const overlayMod = overlaySongModuleForSetting(setting, catalog)
      rows.push(
        computeSettingAramUsage(
          rom,
          catalog,
          setting,
          overlayMod ? { ...overlayMod, label: meta?.songs?.[overlayMod.blobFile]?.title } : undefined
        )
      )
    }
    return { ok: true, rows }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Copy synthesized bytes into a plain ArrayBuffer for the IPC boundary. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(ab).set(bytes)
  return ab
}

// ── .spc synthesis ──────────────────────────────────────────────────────────

// Per-catalog cache of each bank block's ARAM sample slices (drives the
// live-preview splice below; invalidates with the catalog on rebuild).
const sliceCache = new WeakMap<AudioCatalog, Map<number, BankSampleSlice[]>>()

function slicesFor(rom: Uint8Array, catalog: AudioCatalog, blockId: number): BankSampleSlice[] {
  let byBlock = sliceCache.get(catalog)
  if (!byBlock) {
    byBlock = new Map()
    sliceCache.set(catalog, byBlock)
  }
  let slices = byBlock.get(blockId)
  if (!slices) {
    slices = bankSampleSlices(rom, catalog, blockId)
    byBlock.set(blockId, slices)
  }
  return slices
}

/** Live preview of imported sample edits: splice same-size overlay .brr
 *  bytes into a synthesized .spc's ARAM image (file offset 0x100 + ARAM
 *  address), for every sample bank in the composition. Two guards:
 *  - Same-size only — resized samples shift their bank's layout and preview
 *    after the next build instead (the import result says which).
 *  - Upload order — a slice is skipped when any LATER block in the
 *    composition overwrites its ARAM range (e.g. the engine's TitleScreen
 *    bank at $4000+ is replaced by the global bank in every non-title
 *    composition; splicing it there would corrupt global samples). An
 *    imported song module (already applied to the image) uploads LAST
 *    in-game, so it's passed as `finalStream` and wins any overlap. */
function applySampleOverlaysToSpc(
  spc: Uint8Array,
  blockIds: number[],
  rom: Uint8Array,
  catalog: AudioCatalog,
  finalStream?: UploadStream
): void {
  const projectId = getCurrentProjectId()
  if (!projectId) return
  const root = overlaySamplesRoot(projectId)
  if (!existsSync(root)) return
  const streams = blockIds.map((id) => parseBlockFromRom(rom, catalog, id).stream)
  if (finalStream) streams.push(finalStream)
  for (let bi = 0; bi < blockIds.length; bi++) {
    const bank = SPC_BLOCK_SAMPLE_DIRS[blockIds[bi]]
    if (!bank) continue
    const bankDir = join(root, bank)
    if (!existsSync(bankDir)) continue
    for (const slice of slicesFor(rom, catalog, blockIds[bi])) {
      const overwrittenLater = streams
        .slice(bi + 1)
        .some((s) =>
          s.blocks.some(
            (b) => b.dest < slice.aramStart + slice.byteLength && b.dest + b.data.length > slice.aramStart
          )
        )
      if (overwrittenLater) continue
      const p = join(bankDir, slice.file)
      if (!existsSync(p)) continue
      const bytes = readFileSync(p)
      if (bytes.length !== slice.byteLength) continue
      spc.set(bytes, 0x100 + slice.aramStart)
    }
  }
}

// ── imported-song overlays (project audio/import → overlay song blobs) ──────
// An imported song replaces one of the 12 song-module blobs as an overlay
// `.bin`. Until the next build the built ROM still carries the retail module,
// so every compose/decode path checks for an overlay module and applies it
// over the setting's baseline (module last — the in-game upload order).

/** Overlay home of a song-module blob (`assets/yi/SPC700/<blobFile>`). */
function overlaySongBlobPath(projectId: string, blobFile: string): string {
  return join(overlayRoot(projectId), 'assets', 'yi', 'SPC700', blobFile)
}

/** Parse the overlay song module in effect for an explicit block list (a
 *  set-table row, or the Sets editor's DRAFT row), when one exists. */
function overlaySongModuleForBlocks(
  blockIds: readonly number[]
): { blockId: number; stream: UploadStream; blobFile: string } | null {
  const projectId = getCurrentProjectId()
  if (!projectId) return null
  for (const id of blockIds) {
    const info = SPC_BLOCKS.find((b) => b.blockId === id)
    if (info?.kind !== 'songs') continue
    const blobFile = songBlobFileOfLabel(info.label)
    const p = overlaySongBlobPath(projectId, blobFile)
    if (!existsSync(p)) continue
    try {
      return { blockId: id, stream: parseUploadStream(new Uint8Array(readFileSync(p))).stream, blobFile }
    } catch {
      return null // unreadable overlay — fall back to the built ROM's module
    }
  }
  // Driver-only sets (Title): the title-import overlay module, when one is
  // in effect (excluded by its own block id — absent from a pre-build ROM,
  // present in row 0 after a build).
  if (blockIds.some((id) => SPC_BLOCKS.find((b) => b.blockId === id)?.kind === 'engine')) {
    const stream = titleOverlayStream()
    if (stream) return { blockId: TITLE_IMPORT_BLOCK_ID, stream, blobFile: TITLE_IMPORT_BLOB_FILE }
  }
  return null
}

/** Parse a setting's overlay song module, when one is in effect. */
function overlaySongModuleForSetting(
  setting: number,
  catalog: AudioCatalog
): { blockId: number; stream: UploadStream; blobFile: string } | null {
  const cfg = catalog.settings[setting]
  if (!cfg) return null
  return overlaySongModuleForBlocks(cfg.blockIds)
}

function composeSongSpcBytes(setting: number, songSlotId: number): Uint8Array {
  const { catalog, rom } = loadCatalog()
  const cfg = catalog.settings[setting]
  const overlayMod = overlaySongModuleForSetting(setting, catalog)
  if (overlayMod) {
    const meta = readAudioEditsMeta()?.songs?.[overlayMod.blobFile]
    const spc = synthesizeImportPreviewSpc(rom, catalog, setting, overlayMod.blockId, overlayMod.stream, songSlotId, {
      title: meta?.title
    })
    const baseline = composeSettingAram(rom, catalog, setting, overlayMod.blockId)
    applySampleOverlaysToSpc(spc, baseline.blockIds, rom, catalog, overlayMod.stream)
    return spc
  }
  const { spc, blockIds } = synthesizeSongSpc(rom, catalog, setting, songSlotId, {
    title: cfg ? songDisplayName(cfg.blockSetRow, songSlotId) : undefined,
    artist: 'Koji Kondo'
  })
  applySampleOverlaysToSpc(spc, blockIds, rom, catalog)
  return spc
}

/** Synthesize a playable .spc for a (setting, song slot) — the bytes the
 *  in-editor SPC player consumes (overlay-module + overlay-sample aware). */
export function composeSongSpc(setting: number, songSlotId: number): AudioComposeSpcResult {
  try {
    return { ok: true, spc: toArrayBuffer(composeSongSpcBytes(setting, songSlotId)) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Synthesize a playable .spc for an explicit block-row DRAFT — the Sets
 *  editor's ▶, so an unsaved row edit auditions exactly as assembled (the
 *  module CONTENTS still come from the built ROM + overlays; only the row
 *  composition is draft). Applies the row's overlay song module and sample
 *  overlays like composeSongSpc. The slot must come from the row's own
 *  modules (engine-only rows: the driver's title slots) — an engine title
 *  slot under a level row is a dangling pointer (the music-$07 class), so
 *  it's refused rather than played as garbage. */
export function composeRowSpc(blockIds: number[], songSlotId: number): AudioComposeSpcResult {
  try {
    const { catalog, rom } = loadCatalog()
    const ids = [...new Set(blockIds)]
    for (const id of ids) spcBlockById(id) // validates unknown ids loudly
    const overlayMod = overlaySongModuleForBlocks(ids)
    const composed = composeBlocksAram(rom, catalog, ids, overlayMod?.blockId ?? null)
    if (overlayMod) applyUploadStream(composed.aram, overlayMod.stream)

    const engineOnly = ids.length === 0 || ids.every((id) => spcBlockById(id).kind === 'engine')
    const slots = new Map<number, number>()
    for (const id of engineOnly ? [ENGINE_BLOCK_ID] : ids.filter((id) => spcBlockById(id).kind !== 'engine')) {
      for (const [slot, ptr] of songSlotsOfStream(parseBlockFromRom(rom, catalog, id).stream)) slots.set(slot, ptr)
    }
    if (overlayMod) {
      for (const [slot, ptr] of songSlotsOfStream(overlayMod.stream)) slots.set(slot, ptr)
    }
    if (!slots.has(songSlotId) || songSlotPtr(composed.aram, songSlotId) === 0) {
      return {
        ok: false,
        error: `slot 0x${songSlotId.toString(16).toUpperCase()} isn't provided by this row's modules — pick one of the row's own songs`
      }
    }

    patchBootPortClear(composed.aram)
    composed.aram[0xf4] = songSlotId
    const spc = buildSpcFile(
      composed.aram,
      { pc: composed.entry },
      { game: "Yoshi's Island", lengthSeconds: 180, fadeMs: 8000 }
    )
    applySampleOverlaysToSpc(spc, composed.blockIds, rom, catalog, overlayMod?.stream)
    return { ok: true, spc: toArrayBuffer(spc) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Decode + expand one SFX (remap chain included) for the SFX inspector.
 *  SFX data is engine-resident, so any composed baseline carries it. */
export function decodeSfxTimeline(id: number): AudioDecodeSongResult {
  try {
    const { catalog, rom, ui } = loadCatalog()
    const name = ui.sfx.find((s) => s.id === id)?.name ?? `SFX 0x${id.toString(16)}`
    const { aram } = composeSettingAram(rom, catalog, 0x12)
    return { ok: true, name, timeline: buildSfxTimeline(aram, id) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Decode + expand one song for the Sequence inspector (overlay-module aware —
 *  an imported song decodes without a rebuild). */
export function decodeSongTimeline(setting: number, songSlotId: number): AudioDecodeSongResult {
  try {
    const { catalog, rom } = loadCatalog()
    const cfg = catalog.settings[setting]
    if (!cfg) throw new Error(`unknown music setting 0x${setting.toString(16)}`)
    const overlayMod = overlaySongModuleForSetting(setting, catalog)
    if (overlayMod) {
      const { aram } = composeSettingAram(rom, catalog, setting, overlayMod.blockId)
      applyUploadStream(aram, overlayMod.stream)
      const ptr = songSlotPtr(aram, songSlotId)
      if (!ptr) throw new Error(`song slot 0x${songSlotId.toString(16)} not populated by the imported module`)
      const meta = readAudioEditsMeta()?.songs?.[overlayMod.blobFile]
      const patched = songSlotsOfStream(overlayMod.stream).has(songSlotId)
      return {
        ok: true,
        name: patched && meta?.title ? `${meta.title} (imported)` : songDisplayName(cfg.blockSetRow, songSlotId),
        timeline: buildSongTimeline(decodeSong(aram, ptr))
      }
    }
    const { aram } = composeSettingAram(rom, catalog, setting)
    const slots = songSlotsOfSetting(rom, catalog, setting)
    const ptr = slots.get(songSlotId)
    if (!ptr) throw new Error(`song slot 0x${songSlotId.toString(16)} not populated in this setting`)
    return {
      ok: true,
      name: songDisplayName(cfg.blockSetRow, songSlotId),
      timeline: buildSongTimeline(decodeSong(aram, ptr))
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Synthesize a playable .spc that fires one SFX (engine + global bank
 *  baseline — the blocks every non-title composition carries). */
export function composeSfxSpc(id: number): AudioComposeSpcResult {
  try {
    const { catalog, rom, ui } = loadCatalog()
    const name = ui.sfx.find((s) => s.id === id)?.name
    const spc = synthesizeSfxSpc(rom, catalog, id, name ? { title: `SFX — ${name}` } : {})
    applySampleOverlaysToSpc(spc, [ENGINE_BLOCK_ID, GLOBAL_SAMPLES_BLOCK_ID], rom, catalog)
    return { ok: true, spc: toArrayBuffer(spc) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ── the per-project export folder (YY-CHR-tab model) ────────────────────────
// Fixed location `<projectRoot>/audio/` with `songs/` + `sfx/` + `samples/`
// subdirs — no dialogs; the panel's Export tab lists what's on disk
// (refreshed on focus) and plays files back through the in-editor player.
// `samples/` doubles as the WAV round-trip surface the base-aware import
// below reads back.

function audioExportDir(): string | null {
  const id = getCurrentProjectId()
  return id ? join(projectRoot(id), 'audio') : null
}

/** The export folder, or throw — for the envelope-returning functions whose
 *  try/catch turns this into their `{ok:false}` result. */
function requireExportDir(): string {
  const dir = audioExportDir()
  if (!dir) throw new Error('No active project')
  return dir
}

/** Resolve `rel` inside the export folder, refusing path traversal. */
function resolveInsideExportDir(rel: string): string {
  const dir = requireExportDir()
  const full = resolve(dir, rel)
  if (!full.startsWith(resolve(dir) + sep)) throw new Error(`bad export path: ${rel}`)
  return full
}

// The Export tab refreshes on every window focus; hashing every sample .wav
// each time is repeated full-folder work, so the manifest comparison is
// cached per path until the file's mtime/size moves.
const wavShaCache = new Map<string, { mtimeMs: number; size: number; sha: string }>()

function sha256OfWavCached(path: string, mtimeMs: number, size: number): string {
  const hit = wavShaCache.get(path)
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit.sha
  const sha = sha256Hex(new Uint8Array(readFileSync(path)))
  wavShaCache.set(path, { mtimeMs, size, sha })
  return sha
}

export function getAudioExportState(): AudioExportStateResult {
  try {
    const dir = requireExportDir()
    const files: AudioExportFileUi[] = []
    // SFX export as editable MML .txt; the leading hex in the file name is
    // the sound id (what ▶ synthesizes).
    const sfxDir = join(dir, 'sfx')
    if (existsSync(sfxDir)) {
      for (const name of readdirSync(sfxDir).filter((f) => f.toLowerCase().endsWith('.txt')).sort()) {
        const st = statSync(join(sfxDir, name))
        const id = parseInt(name, 16)
        files.push({
          rel: `sfx/${name}`,
          name,
          bytes: st.size,
          kind: 'sfx',
          sfxId: Number.isInteger(id) && id > 0 ? id : undefined
        })
      }
    }
    // Samples: one row per decoded .wav (the playable artifact); the raw .brr
    // twin sits alongside on disk. Badges: `changed` = wav bytes differ from
    // the export-time manifest checksum; `overlay` = an imported project
    // override is in effect for the sample.
    const samplesRoot = join(dir, 'samples')
    if (existsSync(samplesRoot)) {
      const manifest = readSampleManifest(dir)
      const byKey = new Map((manifest?.entries ?? []).map((e) => [`${e.bank}/${e.file}`, e]))
      const projectId = getCurrentProjectId()
      const overlaySamples = projectId ? overlaySamplesRoot(projectId) : null
      for (const bank of readdirSync(samplesRoot).sort()) {
        const bankDir = join(samplesRoot, bank)
        if (!statSync(bankDir).isDirectory()) continue
        for (const name of readdirSync(bankDir).filter((f) => f.toLowerCase().endsWith('.wav')).sort()) {
          const st = statSync(join(bankDir, name))
          const brrName = name.replace(/\.wav$/i, '.brr')
          const entry = byKey.get(`${bank}/${brrName}`)
          const changed = entry
            ? sha256OfWavCached(join(bankDir, name), st.mtimeMs, st.size) !== entry.wavSha256
            : undefined
          const overlay = overlaySamples ? existsSync(join(overlaySamples, bank, brrName)) : undefined
          const label = sampleDisplayName(bank, parseInt(name, 16)) ?? undefined
          files.push({
            rel: `samples/${bank}/${name}`,
            name,
            label,
            bank,
            bytes: st.size,
            kind: 'sample',
            changed,
            overlay
          })
        }
      }
    }
    return { ok: true, dir, files }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Export every named SFX script as editable MML .txt (chain partners
 *  without a name of their own get a `-chained` file so every reachable
 *  script exports). ▶ in the export browser synthesizes playback from the
 *  sound id in the file name. */
export function exportAllSfx(): AudioExportRunResult {
  try {
    const dir = requireExportDir()
    const { catalog, rom, ui } = loadCatalog()
    const out = join(dir, 'sfx')
    mkdirSync(out, { recursive: true })
    // SFX data rides the engine block, identical in every set — any
    // composed baseline works (Map, matching the sfx test harness).
    const { aram } = composeSettingAram(rom, catalog, 0x12)
    const names = new Map(ui.sfx.map((s) => [s.id, s.name]))
    // Script sharing: ids whose pointer lands on the same script bytes.
    const byAddr = new Map<number, number[]>()
    for (let id = 0x01; id <= 0xa2; id++) {
      const addr = resolveSfxChain(aram, id)[0]?.scriptAddr ?? 0
      if (addr !== 0) (byAddr.get(addr) ?? byAddr.set(addr, []).get(addr)!).push(id)
    }
    let written = 0
    const writeMml = (id: number, name: string | undefined, fileStem: string): void => {
      const root = resolveSfxChain(aram, id)[0]
      if (!root || root.scriptAddr === 0) return
      const mml = formatSfxMml(decodeSfxScript(aram, root.scriptAddr).events, {
        soundId: id,
        priority: root.priority,
        chain: aram[SFX_REMAP_TABLE + id],
        name,
        sharedWith: (byAddr.get(root.scriptAddr) ?? []).filter((o) => o !== id)
      })
      writeFileSync(join(out, `${fileStem}.txt`), mml)
      written++
    }
    const exported = new Set<number>()
    for (const s of ui.sfx) {
      writeMml(s.id, s.name, `${s.id.toString(16).padStart(2, '0')}-${exportSlug(s.name)}`)
      exported.add(s.id)
      // Chain partners get their own file (each is a real sound id with its
      // own script + priority entry). They live above the named-id range
      // (0xB0+) with no SoundIDs.asm name, so the file name carries the
      // parent's; several sounds can chain to one partner (e.g. Jump and
      // SpitOut share 0xB1) — the first parent names it, and the #sfx id
      // stays the authoritative identity for re-import.
      for (const entry of resolveSfxChain(aram, s.id).slice(1)) {
        if (exported.has(entry.soundId) || names.has(entry.soundId)) continue
        exported.add(entry.soundId)
        writeMml(
          entry.soundId,
          `chained from ${s.name}`,
          `${entry.soundId.toString(16).padStart(2, '0')}-${exportSlug(s.name)}-chained`
        )
      }
    }
    return { ok: true, written, dir }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** The one-button export: SFX scripts as MML + every sample as .brr/.wav. */
export function exportAllAudio(): AudioExportRunResult {
  const sfx = exportAllSfx()
  if (!sfx.ok) return sfx
  const samples = exportAllSamples()
  if (!samples.ok) return samples
  return { ok: true, written: sfx.written + samples.written, dir: samples.dir }
}

/** Export every BRR sample: the raw .brr bytes plus a decoded 16-bit mono
 *  .wav (32 kHz — the DSP's native rate) per sample, per bank — and the
 *  import manifest (per-sample checksums + loop metadata) that makes the
 *  base-aware import possible. Exports read the extracted base assets, so
 *  re-exporting also refreshes the manifest baseline. */
export function exportAllSamples(): AudioExportRunResult {
  try {
    const dir = requireExportDir()
    const src = join(frameworkWorkRoot(), 'assets', 'yi', 'SPC700', 'Samples')
    if (!existsSync(src)) return { ok: false, error: 'No extracted samples — run extract first' }
    const entries: SampleManifestEntry[] = []
    let written = 0
    for (const bank of readdirSync(src).sort()) {
      const bankDir = join(src, bank)
      if (!statSync(bankDir).isDirectory()) continue
      const wrapperRel = SAMPLE_BANK_WRAPPERS[bank]
      const loopOffsets = wrapperRel
        ? parseSampleLoopOffsets(readFileSync(join(frameworkWorkRoot(), 'yi', wrapperRel), 'utf8'))
        : new Map<string, number | null>()
      const out = join(dir, 'samples', bank)
      mkdirSync(out, { recursive: true })
      for (const file of readdirSync(bankDir).filter((f) => f.toLowerCase().endsWith('.brr')).sort()) {
        const bytes = new Uint8Array(readFileSync(join(bankDir, file)))
        writeFileSync(join(out, file), bytes)
        const decoded = decodeBrr(bytes)
        const wav = wavFromPcm16(decoded.pcm)
        writeFileSync(join(out, file.replace(/\.brr$/i, '.wav')), wav)
        entries.push({
          bank,
          file,
          brrSha256: sha256Hex(bytes),
          wavSha256: sha256Hex(wav),
          brrBytes: bytes.length,
          loop: decoded.loops,
          loopOffset: loopOffsets.get(file) ?? null
        })
        written++
      }
    }
    const manifest: SampleManifest = { version: 1, entries }
    writeFileSync(join(dir, 'samples', SAMPLE_MANIFEST_NAME), JSON.stringify(manifest, null, 2))
    return { ok: true, written, dir }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

function readSampleManifest(dir: string): SampleManifest | null {
  const p = join(dir, 'samples', SAMPLE_MANIFEST_NAME)
  if (!existsSync(p)) return null
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as SampleManifest
    return parsed.version === 1 && Array.isArray(parsed.entries) ? parsed : null
  } catch {
    return null
  }
}

function overlaySamplesRoot(projectId: string): string {
  return join(overlayRoot(projectId), 'assets', 'yi', 'SPC700', 'Samples')
}

/** Run the base-aware sample import over the export folder: unchanged wavs
 *  skip (stale overlays revert to base bytes), edited wavs re-encode into
 *  the project overlay (the build's asar include path already prefers it).
 *  The caller marks the build dirty when imported+reverted > 0. */
export function importSamples(): AudioImportResult {
  const writable = requireWritableProject()
  if (!writable.ok) return { ok: false, error: writable.error }
  const dir = join(projectRoot(writable.projectId), 'audio')
  const manifest = readSampleManifest(dir)
  if (!manifest) return { ok: false, error: 'No sample manifest — run Export Samples first' }
  try {
    const overlaySamples = overlaySamplesRoot(writable.projectId)
    const plan = planSampleImport(
      { exportSamplesDir: join(dir, 'samples'), overlaySamplesDir: overlaySamples },
      manifest
    )
    for (const w of plan.writes) {
      const p = join(overlaySamples, w.bankRel)
      mkdirSync(join(p, '..'), { recursive: true })
      writeFileAtomicSync(p, Buffer.from(w.bytes))
    }
    for (const r of plan.reverts) {
      rmSync(join(overlaySamples, r), { force: true })
    }
    updateAudioEditsMeta(writable.projectId, plan.writes, plan.reverts, manifest)
    return {
      ok: true,
      imported: plan.writes.length,
      reverted: plan.reverts.length,
      items: plan.items.map((i) => ({
        bank: i.bank,
        wav: i.wav,
        file: i.file,
        action: i.action,
        message: i.message,
        warnings: i.warnings,
        sameSize: i.sameSize
      }))
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Change-vs-base metadata for imported audio — the pipeline-provides-
 *  metadata convention (a future "changed audio" inventory reads this
 *  instead of re-deriving; graphics' gfx-edits.json is the precedent).
 *  `samples` keys are `<Bank>/<NN>.brr`; `songs` keys are the overlay song
 *  blob file name (e.g. `DATA_4ED5D0.bin`). */
interface AudioEditsMeta {
  samples: Record<string, { baseBytes: number; newBytes: number }>
  songs?: Record<
    string,
    {
      baseBytes: number
      newBytes: number
      /** Import provenance — absent on a delete-only overlay (no imported song). */
      source?: string
      sourceSlot?: number
      targetBlockId: number
      /** Song slots the import repointed at the imported song — one entry for
       *  a slot-targeted merge, every module slot for a whole-module import.
       *  Absent on imports made before this field existed. */
      targetSlots?: number[]
      title?: string
      /** Per-slot import layers (block-index boundaries in the composed
       *  blob — see mml-module.ts sliceModuleLayers). Empty array = a
       *  whole-module import (the entire blob is the base for future
       *  merges); absent = a pre-layer-model import. */
      layers?: { slot: number; firstBlock: number; source?: string; title?: string }[]
      /** Song slots the user deleted from this module — their sequence bytes
       *  are omitted from the overlay blob and the slot's $FF8E pointer is set
       *  to 0 (silence). Restore re-adds them from the pristine asset. The
       *  overlay is always `extractSongModule(pristine, kept slots) ⊕ imported
       *  layers ⊕ deleted→0` (applyModuleDeletion). */
      deletedSlots?: number[]
    }
  >
}

function audioEditsMetaPath(projectId: string): string {
  return join(overlayRoot(projectId), 'audio-edits.json')
}

function readAudioEditsMetaFor(projectId: string): AudioEditsMeta {
  const p = audioEditsMetaPath(projectId)
  if (existsSync(p)) {
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8'))
      if (parsed && typeof parsed === 'object' && parsed.samples) return parsed as AudioEditsMeta
    } catch {
      /* rebuild from scratch */
    }
  }
  return { samples: {} }
}

function readAudioEditsMeta(): AudioEditsMeta | null {
  const projectId = getCurrentProjectId()
  return projectId ? readAudioEditsMetaFor(projectId) : null
}

function writeAudioEditsMeta(projectId: string, meta: AudioEditsMeta): void {
  writeFileAtomicSync(audioEditsMetaPath(projectId), JSON.stringify(meta, null, 2))
}

function updateAudioEditsMeta(
  projectId: string,
  writes: Array<{ bankRel: string; bytes: Uint8Array }>,
  reverts: string[],
  manifest: SampleManifest
): void {
  const meta = readAudioEditsMetaFor(projectId)
  const byKey = new Map(manifest.entries.map((e) => [`${e.bank}/${e.file}`, e]))
  for (const w of writes) {
    meta.samples[w.bankRel] = {
      baseBytes: byKey.get(w.bankRel)?.brrBytes ?? 0,
      newBytes: w.bytes.length
    }
  }
  for (const r of reverts) delete meta.samples[r]
  writeAudioEditsMeta(projectId, meta)
}

// ── song import (import/ folder — YI-driver .spc files) ─────────────────────
// The import half of "importing spc files" (codec in
// snes-framework/scripts/audio/spc-import.ts). Fixed folder
// `<projectRoot>/audio/import/`, no dialogs: the user drops YI-driver .spc
// files (our own exports, emulator captures of the game or its hacks); the
// panel lists each file's candidate songs, previews any of them in-memory
// against a chosen target module's music set, and Import writes the
// extracted module as the target's overlay blob (importSong below).

function audioImportDir(): string | null {
  const dir = audioExportDir()
  return dir ? join(dir, 'import') : null
}

const isMmlFile = (name: string): boolean => /\.(mml|txt)$/i.test(name)

/** Sample-file reader for MML compiles, confined to the import folder
 *  (the compiler tries `#path`/bare/samples/ prefixes relative to the MML). */
function mmlSampleReader(importDir: string): (rel: string) => Uint8Array | null {
  const root = resolve(importDir)
  return (rel) => {
    const p = resolve(join(importDir, rel))
    if (p !== root && !p.startsWith(root + sep)) return null
    try {
      return new Uint8Array(readFileSync(p))
    } catch {
      return null
    }
  }
}

/** AMY `#default`/`#fg_set` instrument rows, sourced from the flower-garden
 *  module (rows 0-23 = the stock kit, 24-27 = the grassland add-on
 *  instruments — the tables AMY's canned sets replicate).
 *
 *  Read from the PRISTINE extracted blob, never the built ROM: once a song
 *  is imported into flower garden (the default target!) and built, the
 *  built ROM's module IS the import — a whole-module replacement carries
 *  only its own rows (e.g. a 5-row/30-byte table), which used to make every
 *  MML scan fail with "no 28-row instrument table" until Reset. The asset
 *  blob is extract output; project overlays never touch it. */
function cartDefaultInstrumentRows(): { def: Uint8Array; fg: Uint8Array } {
  const label = SPC_BLOCKS.find((b) => b.module === 'flowergarden')!.label
  const p = join(frameworkWorkRoot(), 'assets', 'yi', 'SPC700', songBlobFileOfLabel(label))
  let table: { data: Uint8Array } | undefined
  try {
    table = parseUploadStream(new Uint8Array(readFileSync(p))).stream.blocks.find((b) => b.dest === 0x3d00)
  } catch {
    throw new Error('flower-garden asset blob missing or unreadable — re-extract the ROM')
  }
  if (!table || table.data.length < 168) {
    throw new Error('flower-garden asset blob has no 28-row instrument table — re-extract the ROM')
  }
  return { def: table.data.subarray(0, 144), fg: table.data.subarray(144, 168) }
}

/** A song-bearing module's PRISTINE stream — the extracted asset blob for
 *  song modules (imports never touch assets; the built ROM's module may BE
 *  an import), the built ROM's engine stream for the title target (the
 *  driver is never replaced). Null when unreadable. Used by the No-echo
 *  option's "this module's original songs use echo" warning. */
function pristineSongModuleStream(target: (typeof SPC_BLOCKS)[number], rom: Uint8Array, catalog: AudioCatalog): UploadStream | null {
  if (target.kind === 'engine') return parseBlockFromRom(rom, catalog, target.blockId).stream
  try {
    const p = join(frameworkWorkRoot(), 'assets', 'yi', 'SPC700', songBlobFileOfLabel(target.label))
    return parseUploadStream(new Uint8Array(readFileSync(p))).stream
  } catch {
    return null
  }
}

/** Block id of the grassland instrument add-on (grasslandbank). */
const GRASSLAND_BLOCK_ID = 0x19

/** Grassland-drums option for the MML compiler. Resident targets reference
 *  the bank's $18/$19 directly; everywhere else the Kick + Closed Hi-hat
 *  BRRs are sliced from the cart's grasslandbank module and carried into the built
 *  module as ordinary custom samples. */
function grasslandBankOpts(
  rom: Uint8Array,
  catalog: AudioCatalog,
  fgRows: Uint8Array,
  resident: boolean
): { rows: Uint8Array; resident: boolean; kick?: { data: Uint8Array; loopOffset: number }; closedHat?: { data: Uint8Array; loopOffset: number } } {
  if (resident) return { rows: fgRows, resident: true }
  const stream = parseBlockFromRom(rom, catalog, GRASSLAND_BLOCK_ID).stream
  const dir = stream.blocks.find((b) => b.dest >= 0x3c00 && b.dest < 0x3d00)
  const data = stream.blocks.find((b) => b.dest >= 0x4000)
  if (!dir || !data) return { rows: fgRows, resident: false } // no drum data → approximations
  const slices = bankSampleSlices(rom, catalog, GRASSLAND_BLOCK_ID)
  const drum = (index: number): { data: Uint8Array; loopOffset: number } | undefined => {
    const slice = slices[index]
    if (!slice) return undefined
    const start = dir.data[index * 4] | (dir.data[index * 4 + 1] << 8)
    const loop = dir.data[index * 4 + 2] | (dir.data[index * 4 + 3] << 8)
    if (start !== slice.aramStart) return undefined // dir order surprise — skip rather than mis-slice
    const off = slice.aramStart - data.dest
    return { data: data.data.subarray(off, off + slice.byteLength), loopOffset: loop - start }
  }
  return { rows: fgRows, resident: false, kick: drum(0), closedHat: drum(1) }
}

/** Cart-sliced global-bank samples, for import targets whose music set does
 *  NOT upload the global bank (Title = driver-only, Bowser, Ending): the
 *  stock-instrument approximations (and AMY #default rows) carry the
 *  referenced samples into the module instead of pointing at residents
 *  that aren't there. The grassland drum-carry mechanism, generalized. */
function globalBankCarryOpts(rom: Uint8Array, catalog: AudioCatalog): NonNullable<CompileMmlOptions['globalBankCarry']> {
  const stream = parseBlockFromRom(rom, catalog, GLOBAL_SAMPLES_BLOCK_ID).stream
  const dir = stream.blocks.find((b) => b.dest >= 0x3c00 && b.dest < 0x3d00)
  const data = stream.blocks.find((b) => b.dest >= 0x4000)
  const slices = dir && data ? bankSampleSlices(rom, catalog, GLOBAL_SAMPLES_BLOCK_ID) : []
  return {
    read: (srcn) => {
      if (!dir || !data) return null
      const off = srcn * 4 - (dir.dest - 0x3c00)
      if (off < 0 || off + 3 >= dir.data.length) return null
      const start = dir.data[off] | (dir.data[off + 1] << 8)
      const loop = dir.data[off + 2] | (dir.data[off + 3] << 8)
      const slice = slices.find((s) => s.aramStart === start)
      if (!slice) return null
      return {
        data: data.data.subarray(start - data.dest, start - data.dest + slice.byteLength),
        loopOffset: loop - start
      }
    }
  }
}

/** App-packaged extra samples (framework yi/SPC700/ExtraSamples/ — timbres
 *  YI lacks, carried into imported modules; see the folder's provenance
 *  README). Missing files degrade to the global-bank approximations. */
function packagedExtraSamples(): { panFlute?: { data: Uint8Array; loopOffset: number }; brass?: { data: Uint8Array; loopOffset: number } } {
  const read = (file: string): { data: Uint8Array; loopOffset: number } | undefined => {
    try {
      const raw = readFileSync(join(frameworkWorkRoot(), 'yi', 'SPC700', 'ExtraSamples', file))
      if (raw.length < 11 || (raw.length - 2) % 9 !== 0) return undefined
      return { data: new Uint8Array(raw.subarray(2)), loopOffset: raw[0] | (raw[1] << 8) }
    } catch {
      return undefined
    }
  }
  return { panFlute: read('PanFlute.brr'), brass: read('Brass.brr') }
}

/** App-packaged real-SMW-sample library (framework yi/SPC700/SMWSamples/ —
 *  the community "Super Mario World Samples" pack; see the provenance
 *  README there). AMK-format .brr, 2-byte loop header; file names per
 *  SMW_SAMPLE_FILES. Stock SMW instruments in AMK imports carry the actual
 *  SMW sample — AMK-exact timbres at a sample-budget cost. Missing files
 *  degrade silently to the usual substitutions. */
function smwSampleLibrary(): CompileMmlOptions['smwSamples'] {
  const dir = join(frameworkWorkRoot(), 'yi', 'SPC700', 'SMWSamples')
  return {
    read: (sampleIdx) => {
      const file = SMW_SAMPLE_FILES[sampleIdx]
      if (!file) return null
      try {
        const raw = readFileSync(join(dir, file))
        if (raw.length < 11 || (raw.length - 2) % 9 !== 0) return null
        return { data: new Uint8Array(raw.subarray(2)), loopOffset: raw[0] | (raw[1] << 8) }
      } catch {
        return null
      }
    }
  }
}

/** Compile an MML import file (options wired to the import folder + cart).
 *  `grassland` = the import target's set carries the grassland bank (true),
 *  doesn't (null → carry mode; also the scan's target-unknown default), or
 *  substitute samples are disabled entirely — real drums, packaged timbres
 *  AND the SMW library (false — the budget-fallback retry).
 *  `echoDelayLimit` = 3 for jingle-free targets (JINGLE_FREE_SONG_MODULES),
 *  else the default 2 — the scan's target-unknown compile stays at 2.
 *  `emulateLightStaccato` = false is the seq-budget fallback retry (drops
 *  the AMK $F4 $02 note+tie splits). `useSmwSamples` = the "Real SMW
 *  samples" checkbox (default on). `carryGlobalBank` = the target's music
 *  set does not upload the global sample bank (Title/Bowser/Ending) —
 *  global-bank references carry their samples; NOT dropped by the
 *  substitute-sample fallback, it's correctness rather than fidelity.
 *  `noEcho` = the "No echo (extra room)" checkbox — strips $F5/$F7/$F8 so
 *  the module can claim the $2C00-$3C00 echo region. */
function compileMmlImport(
  importDir: string,
  name: string,
  rom: Uint8Array,
  catalog: AudioCatalog,
  grassland: boolean | null = null,
  echoDelayLimit?: number,
  emulateLightStaccato?: boolean,
  useSmwSamples = false,
  carryGlobalBank = false,
  noEcho = false
) {
  const text = readFileSync(join(importDir, name), 'utf8')
  const rows = cartDefaultInstrumentRows()
  const compiled = compileMml(text, {
    readFile: mmlSampleReader(importDir),
    defaultInstrumentRows: rows.def,
    fgSetInstrumentRows: rows.fg,
    grasslandBank: grassland === false ? undefined : grasslandBankOpts(rom, catalog, rows.fg, grassland === true),
    packagedSamples: grassland === false ? undefined : packagedExtraSamples(),
    smwSamples: grassland === false || !useSmwSamples ? undefined : smwSampleLibrary(),
    globalBankCarry: carryGlobalBank ? globalBankCarryOpts(rom, catalog) : undefined,
    echoDelayLimit,
    emulateLightStaccato
  })
  return noEcho ? stripEchoVcmds(compiled) : compiled
}

/** Budget error where dropping the light-staccato ties would let a retry
 *  fit, but the checkbox (off by default) hasn't authorized it — surface
 *  the remedy alongside the error. */
const withStaccatoHint = (e: MmlModuleError): MmlModuleError =>
  new MmlModuleError(
    `${e.message} Enable "Drop light staccato to fit" to retry without the light-staccato note+tie splits (notes ring 1 tick shorter).`,
    e.kind
  )

const toCandidateUi = (c: SpcSongCandidate): AudioImportSongCandidateUi => ({
  slot: c.slot,
  ok: c.ok,
  aliasOf: c.aliasOf,
  noteEvents: c.noteEvents,
  seqBytes: c.seqBytes,
  instrumentRows: c.instrumentRows,
  error: c.error
})

/** Representative music setting that uploads `blockId` (first match; -1 when
 *  no setting's block-set row carries it). */
function settingUploadingBlock(catalog: AudioCatalog, blockId: number): number {
  return catalog.settings.findIndex((s) => s.blockIds.includes(blockId))
}

/** The 12 replaceable song modules, with slots + where they're heard + any
 *  imported song currently in effect (overlay blob + meta). */
/** The two import-budget views for a target (see AudioImportTargetUi):
 *  whole-module replace dodges the set's resident sample banks plus the
 *  map-resident reservation on level-set targets; a slot merge also dodges
 *  `currentBlocks` (the module's live content — overlay blob when imported,
 *  else the retail module). */
function targetImportBudgets(
  rom: Uint8Array,
  catalog: AudioCatalog,
  setting: number,
  currentBlocks: UploadStream['blocks'],
  module: string,
  noEcho = false
): { budgetReplace: AramImportBudget; budgetSlot: AramImportBudget } {
  const bankBlocks = [
    ...(catalog.settings[setting]?.blockIds ?? [])
      .filter((id) => spcBlockById(id).kind === 'samples')
      .flatMap((id) => parseBlockFromRom(rom, catalog, id).stream.blocks),
    ...mapResidentReservationBlocks(module)
  ]
  const echoDelayLimit = JINGLE_FREE_SONG_MODULES.has(module) ? 3 : 2
  // No-echo claim: a whole-module replace always qualifies (every slot
  // repoints at the stripped import); a slot merge only when the module's
  // kept songs are echo-free.
  return {
    budgetReplace: computeImportBudget(bankBlocks, echoDelayLimit, noEcho),
    budgetSlot: computeImportBudget(
      [...bankBlocks, ...currentBlocks],
      echoDelayLimit,
      noEcho && !moduleSongsUseEcho(currentBlocks)
    )
  }
}

function songImportTargets(rom: Uint8Array, catalog: AudioCatalog, noEcho = false): AudioImportTargetUi[] {
  const projectId = getCurrentProjectId()
  const meta = readAudioEditsMeta()
  return SPC_BLOCKS.filter((b) => b.kind === 'songs').map((b) => {
    const blobFile = songBlobFileOfLabel(b.label)
    const overlayPath = projectId ? overlaySongBlobPath(projectId, blobFile) : null
    const imported =
      overlayPath && existsSync(overlayPath)
        ? {
            source: meta?.songs?.[blobFile]?.source,
            title: meta?.songs?.[blobFile]?.title,
            targetSlots: meta?.songs?.[blobFile]?.targetSlots,
            moduleBytes: statSync(overlayPath).size,
            baseBytes: b.retailBytes
          }
        : undefined
    const setting = settingUploadingBlock(catalog, b.blockId)
    const blockSetRow = catalog.settings[setting]?.blockSetRow
    const currentStream = imported ? overlaySongModuleForSetting(setting, catalog)?.stream : undefined
    const slots = [...songSlotsOfStream(parseBlockFromRom(rom, catalog, b.blockId).stream).keys()].sort((x, y) => x - y)
    const usedBy = [
      ...new Set(
        catalog.settings.filter((s) => s.blockIds.includes(b.blockId) && !s.unused).map((s) => s.name)
      )
    ]
    return {
      ...targetImportBudgets(
        rom,
        catalog,
        setting,
        (currentStream ?? parseBlockFromRom(rom, catalog, b.blockId).stream).blocks,
        b.module,
        noEcho
      ),
      blockId: b.blockId,
      // Display name = the music set's own name (the header dropdown's
      // vocabulary — "Flower Garden", not "flower-garden songs"); the module
      // identifier stays dev-facing in tooltips.
      name: usedBy[0] ?? (SPC_BLOCK_DISPLAY_NAMES[b.blockId] ?? b.module),
      module: b.module,
      slots,
      slotNames: slots.map((s) => (blockSetRow !== undefined ? songDisplayName(blockSetRow, s) : `slot 0x${s.toString(16)}`)),
      setting,
      usedBy,
      imported
    }
  })
}

/** The title target: the three songs living inside the driver image
 *  (block-set row 0). Imports here are slot-targeted merges shipped as the
 *  separate title-import module the build wires in — the driver itself is
 *  never replaced. */
function titleImportTarget(rom: Uint8Array, catalog: AudioCatalog, noEcho = false): AudioImportTargetUi {
  const projectId = getCurrentProjectId()
  const meta = readAudioEditsMeta()
  const driver = SPC_BLOCKS.find((b) => b.kind === 'engine')!
  const overlayPath = projectId ? overlaySongBlobPath(projectId, TITLE_IMPORT_BLOB_FILE) : null
  const imported =
    overlayPath && existsSync(overlayPath)
      ? {
          source: meta?.songs?.[TITLE_IMPORT_BLOB_FILE]?.source,
          title: meta?.songs?.[TITLE_IMPORT_BLOB_FILE]?.title,
          targetSlots: meta?.songs?.[TITLE_IMPORT_BLOB_FILE]?.targetSlots,
          moduleBytes: statSync(overlayPath).size,
          baseBytes: 0 // no retail counterpart — the module only exists imported
        }
      : undefined
  const blockSetRow = catalog.settings[0x10]?.blockSetRow ?? 0
  const slots = [...songSlotsOfStream(parseBlockFromRom(rom, catalog, driver.blockId).stream).keys()].sort((x, y) => x - y)
  // Title merges dodge the whole driver image (its title bank + sequence are
  // live content) plus any previous title import. The No-echo claim needs
  // the driver's OTHER title songs echo-free — retail Welcome/Yoshi's
  // Island both echo, so this stays false unless all three are replaced.
  const titleBlocks = [
    ...parseBlockFromRom(rom, catalog, driver.blockId).stream.blocks,
    ...(titleOverlayStream()?.blocks ?? [])
  ]
  const budgetSlot = computeImportBudget(titleBlocks, 2, noEcho && !moduleSongsUseEcho(titleBlocks))
  return {
    budgetSlot,
    blockId: driver.blockId,
    name: 'Title screen',
    module: driver.module,
    slots,
    slotNames: slots.map((sl) => songDisplayName(blockSetRow, sl)),
    slotRequired: true,
    setting: 0x10,
    usedBy: ['Title'],
    imported
  }
}

/** Scan the import folder (created on first scan so it's a drop target). */
export function getSongImportState(downsampleToFit = true, dropStaccatoToFit = false, useSmwSamples = false, noEcho = false): AudioSongImportStateResult {
  const dir = audioImportDir()
  if (!dir) return { ok: false, error: 'No active project' }
  let loaded: ReturnType<typeof loadCatalog>
  try {
    loaded = loadCatalog()
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
  const { catalog, rom } = loaded
  try {
    mkdirSync(dir, { recursive: true })
    const engineStream = parseBlockFromRom(rom, catalog, ENGINE_BLOCK_ID).stream
    const files: AudioImportSongFileUi[] = []
    for (const name of readdirSync(dir)
      .filter((f) => /\.spc$/i.test(f) || isMmlFile(f))
      .sort()) {
      const full = join(dir, name)
      const st = statSync(full)
      if (!st.isFile()) continue
      const base = { rel: `import/${name}`, name, bytes: st.size }
      if (isMmlFile(name)) {
        // MML source: compile + trial-build so budget failures surface here
        // (they're target-independent in the v1 layout).
        const text = readFileSync(full, 'utf8')
        const dialect = detectMmlDialect(text).dialect ?? undefined
        if (/^\s*#sfx\b/im.test(text)) {
          // An exported SFX script (sfx-mml.ts format) — a different intake
          // than song modules; parked until the SFX write path lands.
          files.push({
            ...base,
            ok: false,
            kind: 'mml',
            dialect,
            error: 'SFX MML file — this folder imports songs; SFX re-import arrives with the SFX-editing milestone',
            candidates: []
          })
          continue
        }
        try {
          let compiled = compileMmlImport(dir, name, rom, catalog, null, undefined, undefined, useSmwSamples, false, noEcho)
          let built: ReturnType<typeof buildMmlModule>
          try {
            // Scan is target-independent; with No echo on, the claim is
            // optimistic (a whole-module replace always qualifies).
            built = buildMmlModule(compiled, [1], { downsampleToFit, claimEchoRegion: noEcho })
          } catch (e) {
            // Mirror the import's opt-in fallback — checked, a song that
            // only fits without the light-staccato ties scans as
            // importable; unchecked, the budget error carries the remedy.
            if (!(e instanceof MmlModuleError) || e.kind === 'structural' || !compiled.usedLightStaccato) throw e
            if (!dropStaccatoToFit) throw withStaccatoHint(e)
            compiled = compileMmlImport(dir, name, rom, catalog, null, undefined, false, useSmwSamples, false, noEcho)
            built = buildMmlModule(compiled, [1], { downsampleToFit, claimEchoRegion: noEcho })
          }
          const noteEvents = [...compiled.trackEvents, ...compiled.subEvents]
            .flat()
            .filter((ev) => ev.kind === 'note' || ev.kind === 'perc').length
          files.push({
            ...base,
            ok: true,
            kind: 'mml',
            dialect: compiled.dialect,
            title: compiled.meta.title,
            // Trial-build warnings (downsampling, slot fan-out) belong with
            // the port report — they're scan-time facts about this song.
            report: [...compiled.report, ...built.warnings],
            candidates: [
              {
                slot: 1,
                ok: true,
                noteEvents,
                seqBytes: built.seqBytes,
                sampleBytes: built.sampleBytes,
                sampleCount: compiled.samples.length,
                instrumentRows: compiled.instrumentRows.length,
                dirSlots: compiled.dirEntries.length
              }
            ]
          })
        } catch (e) {
          files.push({ ...base, ok: false, kind: 'mml', dialect, error: (e as Error).message, candidates: [] })
        }
        continue
      }
      try {
        const parsed = parseSpcFile(new Uint8Array(readFileSync(full)))
        if (!verifyYiDriverAram(parsed.aram, engineStream).ok) {
          files.push({
            ...base,
            ok: false,
            error: "Not a YI sound-driver snapshot — only .spc files running Yoshi's Island's driver are importable",
            candidates: []
          })
          continue
        }
        files.push({
          ...base,
          ok: true,
          kind: 'spc',
          title: parsed.title ?? undefined,
          candidates: findSpcSongCandidates(parsed.aram).map(toCandidateUi)
        })
      } catch (e) {
        files.push({ ...base, ok: false, kind: 'spc', error: (e as Error).message, candidates: [] })
      }
    }
    const projectId = getCurrentProjectId()
    const freeBytes = projectId ? projectedAudioLayout(projectId, null, null).freeBytes : 0
    return { ok: true, dir, files, targets: [...songImportTargets(rom, catalog, noEcho), titleImportTarget(rom, catalog, noEcho)], freeBytes }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

interface BuiltImportModule {
  bytes: Uint8Array
  stream: UploadStream
  warnings: string[]
  setting: number
  targetSlots: number[]
  target: (typeof SPC_BLOCKS)[number]
  /** Overlay blob file name the import would write (e.g. `DATA_4ED5D0.bin`). */
  blobFile: string
  /** Block the preview composer excludes from the baseline before applying
   *  the built module (the replaced song module; the title-import module id
   *  for title imports — the DRIVER must stay in the baseline). */
  previewExcludeBlockId: number
  /** Per-slot layer boundaries of the built blob (importSong persists them;
   *  empty = whole-module import). */
  layers: { slot: number; firstBlock: number; source?: string; title?: string }[]
  /** ID666 title of the source .spc, when tagged. */
  sourceTitle: string | null
}

/** Shared build for preview + import: extract the song from a .spc (against
 *  the target set's baseline) or compile an MML source, repointing every slot
 *  the target module serves. Throws on anything unusable. */

/** The project's title-import overlay module, when one is in effect. */
function titleOverlayStream(): UploadStream | null {
  const projectId = getCurrentProjectId()
  if (!projectId) return null
  const p = overlaySongBlobPath(projectId, TITLE_IMPORT_BLOB_FILE)
  if (!existsSync(p)) return null
  try {
    return parseUploadStream(new Uint8Array(readFileSync(p))).stream
  } catch {
    return null
  }
}

/** The target module's current content decomposed for a slot merge: the
 *  immutable base (retail embed for song modules, EMPTY for title imports —
 *  the driver is dodge-only) plus the kept layers (previously imported
 *  slots, minus the one being replaced — embedding a replaced slot's old
 *  layer would orphan its data and eat the budget on every re-import). */
function decomposeForSlotMerge(
  rom: Uint8Array,
  catalog: AudioCatalog,
  targetBlockId: number,
  isTitle: boolean,
  blobFile: string,
  replaceSlot: number
): {
  baseBlocks: UploadStream['blocks']
  kept: { slot: number; blocks: UploadStream['blocks']; source?: string; title?: string }[]
  /** A pre-layer-model overlay that couldn't be decomposed rides along whole. */
  unattributed: boolean
} {
  const retailBase = (): UploadStream['blocks'] =>
    isTitle ? [] : parseBlockFromRom(rom, catalog, targetBlockId).stream.blocks
  const projectId = getCurrentProjectId()
  const overlayPath = projectId ? overlaySongBlobPath(projectId, blobFile) : null
  if (!overlayPath || !existsSync(overlayPath)) {
    return { baseBlocks: retailBase(), kept: [], unattributed: false }
  }
  let blocks: UploadStream['blocks']
  try {
    blocks = parseUploadStream(new Uint8Array(readFileSync(overlayPath))).stream.blocks
  } catch {
    return { baseBlocks: retailBase(), kept: [], unattributed: false }
  }
  const meta = readAudioEditsMeta()?.songs?.[blobFile]
  if (!meta?.layers) {
    // Pre-layer-model overlay. A single-slot import being re-imported is
    // fully replaced (keep nothing); anything else can't be decomposed and
    // rides along whole (accretes once more; layered from here on).
    if (meta?.targetSlots?.length === 1 && meta.targetSlots[0] === replaceSlot) {
      return { baseBlocks: retailBase(), kept: [], unattributed: false }
    }
    return { baseBlocks: blocks, kept: [], unattributed: true }
  }
  const sliced = sliceModuleLayers(blocks, meta.layers, replaceSlot)
  const bySlot = new Map(meta.layers.map((l) => [l.slot, l]))
  return {
    baseBlocks: sliced.baseBlocks,
    kept: sliced.kept.map((l) => ({ ...l, source: bySlot.get(l.slot)?.source, title: bySlot.get(l.slot)?.title })),
    unattributed: false
  }
}

/** Slot-merge layout context shared by the MML and single-slot .spc import
 *  paths — everything buildMmlModule needs to lay a song out ALONGSIDE the
 *  target module's kept songs (rather than replacing the whole module). */
interface SlotMergeContext {
  /** Dodge-only blocks (resident sample banks + map-resident reservation;
   *  driver for title targets) — not copied into the output. */
  layoutBase: UploadStream | undefined
  /** The module decomposed into immutable base + kept per-slot layers (the
   *  replaced slot dropped). Null for whole-module (targetSlotId === null). */
  decomposed: ReturnType<typeof decomposeForSlotMerge> | null
  /** Embedded base for buildMmlModule: base blocks + repacked kept layers. */
  mergeBase: UploadStream | undefined
  claimEchoRegion: boolean
  /** Echo-delay ceiling (3 for jingle-free targets, else default). */
  echoDelayLimit: number | undefined
  warnings: string[]
}

/** Compute the slot-merge layout context (dodge-only banks, decomposed
 *  base+kept layers, echo-region claim). Extracted from the MML import path so
 *  the single-slot .spc path shares the exact same layout semantics. */
function computeSlotMergeContext(
  rom: Uint8Array,
  catalog: AudioCatalog,
  setting: number,
  target: (typeof SPC_BLOCKS)[number],
  targetBlockId: number,
  isTitle: boolean,
  blobFile: string,
  targetSlotId: number | null,
  noEcho: boolean
): SlotMergeContext {
  // Jingle-free targets (Ending, 1W-0 demo) may keep echo delay 3 — their
  // context never reads the $264C jingle region the EDL-3 buffer covers.
  const echoDelayLimit = JINGLE_FREE_SONG_MODULES.has(target.module) ? 3 : undefined
  const warnings: string[] = []
  // Dodge-only layout context. Title imports dodge the driver. Every other
  // import dodges the target set's resident SAMPLE banks: their ARAM extent
  // (the $B960+ add-on window; Bowser's $A480+; Ending's whole bank) and their
  // $3C00-page directory entries must survive the import — the module's
  // preserved songs AND every sibling set sharing the bank at the same
  // block-row position play through them, and the positional-diff upload never
  // re-sends an unchanged bank, so clobbering it persists across sets (a
  // welcome-module import that spilled sequence data into $B960 corrupted the
  // world map's mapcastlebank instruments until a different-bank set
  // re-uploaded it). Level-set targets additionally dodge the map-resident
  // $D000-$DC7E reservation (Score + Powerful Infant — requested in-level with
  // no re-upload).
  const layoutBase = isTitle
    ? parseBlockFromRom(rom, catalog, targetBlockId).stream
    : (() => {
        const bankBlocks = [
          ...(catalog.settings[setting]?.blockIds ?? [])
            .filter((id) => spcBlockById(id).kind === 'samples')
            .flatMap((id) => parseBlockFromRom(rom, catalog, id).stream.blocks),
          ...mapResidentReservationBlocks(target.module)
        ]
        return bankBlocks.length > 0 ? { blocks: bankBlocks, entry: 0x0400 } : undefined
      })()
  // Merge base: the module's current content DECOMPOSED — immutable base
  // (retail embed; empty for title, whose driver is dodge-only) + the kept
  // per-slot layers, with the replaced slot's old layer dropped so a re-import
  // doesn't accrete its orphaned data (audio-edits.json records the layer
  // boundaries). Kept layers REPACK first-fit into the placement windows so the
  // free space left for the incoming song stays contiguous (and layers
  // imported before the map-resident reservation existed move out of it).
  const decomposed =
    targetSlotId !== null
      ? decomposeForSlotMerge(rom, catalog, targetBlockId, isTitle, blobFile, targetSlotId)
      : null
  // "No echo" ($2C00-$3C00 claim): safe when every OTHER song playable in the
  // module's context is echo-free — for slot merges that's the kept base+layers
  // (plus the driver's own songs on the title target, which ride layoutBase); a
  // whole-module replace repoints every slot at our (stripped) song, so it
  // always qualifies.
  let claimEchoRegion = false
  if (noEcho) {
    const contextSongBlocks = [
      ...(isTitle ? layoutBase?.blocks ?? [] : []),
      ...(decomposed ? [...decomposed.baseBlocks, ...decomposed.kept.flatMap((l) => l.blocks)] : [])
    ]
    if (targetSlotId !== null && moduleSongsUseEcho(contextSongBlocks)) {
      warnings.push(
        "echo space not claimed — the set's other songs use echo and would overwrite it; replace the entire set (or import them with No echo too) to claim the extra room"
      )
    } else {
      claimEchoRegion = true
    }
    const pristine = pristineSongModuleStream(target, rom, catalog)
    if (pristine && moduleSongsUseEcho(pristine.blocks)) {
      warnings.push(
        `this music set's original songs use echo — with No echo the level plays dry, including its sound effects (they inherit the music's reverb)`
      )
    }
  }
  const keptBlocks = decomposed
    ? repackKeptLayers(
        [...(layoutBase?.blocks ?? []), ...decomposed.baseBlocks],
        decomposed.kept,
        importPlacementWindows(echoDelayLimit, undefined, claimEchoRegion)
      )
    : null
  const mergeBase: UploadStream | undefined = decomposed
    ? { blocks: [...decomposed.baseBlocks, ...keptBlocks!.flat()], entry: 0x0400 }
    : undefined
  // Reverse guard: an echo-USING import merged into a module whose kept content
  // sits in the echo region (a previous No-echo import). Layered content just
  // repacked out of it above (claimEchoRegion false excludes the window);
  // immutable base blocks (whole-module No-echo overlays decompose as all-base)
  // can't move — refuse loudly.
  if (!claimEchoRegion && mergeBase?.blocks.some((b) => b.dest < 0x3c00 && b.dest + b.data.length > 0x2c00)) {
    throw new Error(
      "the module's imported song claimed the echo space (No echo) — enable No echo for this import too, or Reset the module first"
    )
  }
  if (decomposed?.unattributed) {
    warnings.push(
      'the previous import predates per-slot tracking and stays embedded whole — Reset the module and re-import each slot to reclaim its space'
    )
  }
  return { layoutBase, decomposed, mergeBase, claimEchoRegion, echoDelayLimit, warnings }
}

function buildSongImportModule(
  rel: string,
  sourceSlot: number,
  targetBlockId: number,
  downsampleToFit = true,
  dropStaccatoToFit = false,
  useSmwSamples = false,
  noEcho = false,
  targetSlotId: number | null = null
): BuiltImportModule {
  const full = resolveInsideExportDir(rel)
  const { catalog, rom } = loadCatalog()
  const target = SPC_BLOCKS.find(
    (b) => b.blockId === targetBlockId && (b.kind === 'songs' || b.kind === 'engine')
  )
  if (!target) throw new Error(`block 0x${targetBlockId.toString(16)} is not a song module`)
  // Title imports (the driver's three songs) never replace their module —
  // the driver IS the engine. They merge into ONE slot and ship as a blob
  // the build splices into the END of the engine's own upload stream (see
  // module-layout.ts renderEngineTitleImport).
  const isTitle = target.kind === 'engine'
  if (isTitle && targetSlotId === null) {
    throw new Error('title imports replace one slot — pick which of the three title songs to replace')
  }
  const setting = isTitle ? 0x10 : settingUploadingBlock(catalog, targetBlockId)
  if (setting < 0) throw new Error('no music setting uploads the target module')
  const moduleSlots = [
    ...songSlotsOfStream(parseBlockFromRom(rom, catalog, targetBlockId).stream).keys()
  ].sort((a, b) => a - b)
  if (targetSlotId !== null && !moduleSlots.includes(targetSlotId)) {
    throw new Error(`slot 0x${targetSlotId.toString(16)} is not one of the ${target.module} module's slots`)
  }
  // Slot-targeted imports replace ONE slot (merge mode); whole-module
  // imports repoint every slot the retail module patches (a stale slot
  // would hang the driver in-game).
  const targetSlots = targetSlotId !== null ? [targetSlotId] : moduleSlots
  const common = {
    setting,
    targetSlots,
    target,
    blobFile: isTitle ? TITLE_IMPORT_BLOB_FILE : songBlobFileOfLabel(target.label),
    previewExcludeBlockId: isTitle ? TITLE_IMPORT_BLOCK_ID : targetBlockId
  }
  const multiSlotWarning =
    targetSlotId === null && moduleSlots.length > 1
      ? [`the ${target.module} module also serves slots ${moduleSlots.map((s) => `0x${s.toString(16)}`).join(', ')} — all repointed at the imported song`]
      : []

  if (isMmlFile(rel)) {
    const importDir = audioImportDir()
    if (!importDir) throw new Error('No active project')
    const name = rel.split('/').pop()!
    const carriesGrassland = catalog.settings[setting]?.blockIds.includes(GRASSLAND_BLOCK_ID) ?? false
    // Sets without the global sample bank (Bowser, Ending — and the Title
    // set, when it becomes a target) must CARRY any referenced global-bank
    // samples; a resident SRCN there plays the set's own bank instead.
    const carryGlobalBank = !(catalog.settings[setting]?.blockIds.includes(GLOBAL_SAMPLES_BLOCK_ID) ?? true)
    const { layoutBase, decomposed, mergeBase, claimEchoRegion, echoDelayLimit, warnings: targetWarnings } =
      computeSlotMergeContext(rom, catalog, setting, target, targetBlockId, isTitle, common.blobFile, targetSlotId, noEcho)
    // Resident mode on grassland sets, carry mode everywhere else.
    let grassland: boolean | null = carriesGrassland ? true : null
    let staccato = true
    let compiled = compileMmlImport(importDir, name, rom, catalog, grassland, echoDelayLimit, undefined, useSmwSamples, carryGlobalBank, noEcho)
    let built: ReturnType<typeof buildMmlModule>
    // Budget fallbacks — each pass sacrifices one more optional cost rather
    // than refusing the import: substitute samples first (sample space:
    // real SMW samples, drum relocation on resident sets, carried BRRs
    // elsewhere), then — only when the "Drop light staccato to fit"
    // checkbox authorizes it — the light-staccato note+tie splits (sequence
    // space, whose tail the samples also share).
    for (;;) {
      try {
        built = buildMmlModule(compiled, targetSlots, { downsampleToFit, base: mergeBase, layoutBase, echoDelayLimit, claimEchoRegion })
        break
      } catch (e) {
        if (!(e instanceof MmlModuleError) || e.kind === 'structural') throw e
        const usedSubstitutes = compiled.usedGrasslandDrums || compiled.usedPackagedSamples || compiled.usedSmwSamples
        if (usedSubstitutes && grassland !== false) {
          grassland = false
          targetWarnings.push(
            "substitute samples (real SMW samples / real YI drums / packaged timbres) skipped — the sample budget doesn't fit them alongside the song's own; the global-bank approximations play instead"
          )
        } else if (compiled.usedLightStaccato && staccato) {
          if (!dropStaccatoToFit) throw withStaccatoHint(e)
          staccato = false
          targetWarnings.push(
            'light-staccato emulation dropped ("Drop light staccato to fit") — its note+tie splits pushed the module over the ARAM budget; notes ring 1 tick shorter than on AMK'
          )
        } else {
          throw e
        }
        compiled = compileMmlImport(importDir, name, rom, catalog, grassland, echoDelayLimit, staccato, useSmwSamples, carryGlobalBank, noEcho)
      }
    }
    if (echoDelayLimit === 3) {
      // The scan-time report under the file row was compiled target-unknown
      // (clamp 2), so surface the relaxed outcome where the action lands.
      const usesEdl3 = [...compiled.trackEvents, ...compiled.subEvents].some((evs) =>
        evs.some((e) => e.kind === 'vcmd' && e.op === 0xf7 && e.args[0] === 3)
      )
      if (usesEdl3) {
        targetWarnings.push(
          'echo delay 3 in effect — allowed on this module because its context never plays the resident jingles; any other target clamps to 2'
        )
      }
    }
    if (compiled.usedGrasslandDrums && carriesGrassland) {
      targetWarnings.push("SMW drums play YI's real Kick / Closed Hi-hat (resident in this music set — no module bytes needed)")
    }
    // Layer bookkeeping for the composed blob: kept layers re-indexed after
    // the base, then the new slot's layer (everything past the merge base).
    let layers: BuiltImportModule['layers'] = []
    if (decomposed && targetSlotId !== null) {
      let at = decomposed.baseBlocks.length
      for (const l of decomposed.kept) {
        layers.push({ slot: l.slot, firstBlock: at, source: l.source, title: l.title })
        at += l.blocks.length
      }
      layers.push({
        slot: targetSlotId,
        firstBlock: mergeBase!.blocks.length,
        source: name,
        title: compiled.meta.title
      })
      layers = layers.sort((a, b) => a.firstBlock - b.firstBlock)
    }
    return {
      ...common,
      bytes: built.bytes,
      stream: built.stream,
      layers,
      // The port report is NOT repeated here — it renders under the file row
      // (AudioImportSongFileUi.report); action warnings stay action-specific.
      warnings: [...targetWarnings, ...multiSlotWarning],
      sourceTitle: compiled.meta.title ?? null
    }
  }

  const parsed = parseSpcFile(new Uint8Array(readFileSync(full)))
  if (!verifyYiDriverAram(parsed.aram, parseBlockFromRom(rom, catalog, ENGINE_BLOCK_ID).stream).ok) {
    throw new Error('not a YI sound-driver snapshot')
  }
  const name = rel.split('/').pop()!

  if (targetSlotId !== null) {
    // Single-slot .spc: MERGE the song alongside the module's kept songs by
    // adapting the decoded song to a CompiledMml and running the SAME layout
    // path as MML (buildMmlModule) — it relocates the sequence into free ARAM
    // and appends this song's instrument rows + custom samples after the kept
    // ones. (The whole-set path below stays verbatim: it repoints every slot,
    // so nothing is kept and no relocation is needed.)
    const ptr = songSlotPtr(parsed.aram, sourceSlot)
    if (!ptr) throw new Error(`source slot 0x${sourceSlot.toString(16)} is empty`)
    const { layoutBase, decomposed, mergeBase, claimEchoRegion, echoDelayLimit, warnings: targetWarnings } =
      computeSlotMergeContext(rom, catalog, setting, target, targetBlockId, isTitle, common.blobFile, targetSlotId, noEcho)
    const baseAram = composeSettingAram(rom, catalog, setting, targetBlockId).aram
    let adapted: ReturnType<typeof spcSongToCompiledMml>
    try {
      adapted = spcSongToCompiledMml(parsed.aram, ptr, baseAram, parsed.title)
    } catch (e) {
      if (e instanceof SpcMergeUnsupportedError) {
        throw new Error(`this .spc song can't merge into a single slot (${e.message}) — pick "Replace entire set" instead`)
      }
      throw e
    }
    const compiled = noEcho && claimEchoRegion ? stripEchoVcmds(adapted.compiled) : adapted.compiled
    const built = buildMmlModule(compiled, targetSlots, {
      downsampleToFit,
      base: mergeBase,
      layoutBase,
      echoDelayLimit,
      claimEchoRegion
    })
    let layers: BuiltImportModule['layers'] = []
    if (decomposed) {
      let at = decomposed.baseBlocks.length
      for (const l of decomposed.kept) {
        layers.push({ slot: l.slot, firstBlock: at, source: l.source, title: l.title })
        at += l.blocks.length
      }
      layers.push({ slot: targetSlotId, firstBlock: mergeBase!.blocks.length, source: name, title: parsed.title ?? undefined })
      layers = layers.sort((a, b) => a.firstBlock - b.firstBlock)
    }
    return {
      ...common,
      bytes: built.bytes,
      stream: built.stream,
      layers,
      warnings: [...targetWarnings, ...adapted.warnings, ...built.warnings, ...multiSlotWarning],
      sourceTitle: parsed.title
    }
  }

  const baseline = composeSettingAram(rom, catalog, setting, targetBlockId)
  const mod = extractSongModule(
    parsed.aram,
    targetSlots.map((targetSlot) => ({ sourceSlot, targetSlot })),
    baseline.aram
  )
  const relocationWarnings: string[] = []
  let stream = mod.stream
  let bytes = mod.bytes
  // Level-set targets: sequence data in the map-resident $D000-$DC7E region
  // (AMY-source builds place sequences at $D090) would corrupt the resident
  // Score/Powerful Infant data — rigid-shift every $D000+ sequence range up
  // so the lowest lands at $DC7F, patching the known pointer words.
  if (mapResidentReservationBlocks(target.module).length > 0) {
    const shiftRanges = mod.seqRanges.filter((r) => r.end > MAP_RESIDENT_SEQ_REGION.start)
    const minStart = shiftRanges.reduce((m, r) => Math.min(m, r.start), 0x10000)
    if (minStart < MAP_RESIDENT_SEQ_REGION.end) {
      const delta = MAP_RESIDENT_SEQ_REGION.end - minStart
      const maxEnd = shiftRanges.reduce((m, r) => Math.max(m, r.end), 0)
      if (maxEnd + delta > SONG_TABLE_BASE) {
        throw new Error(
          `song is ${maxEnd - minStart} sequence bytes — too large to relocate out of the reserved ` +
          `0xD000-0xDC7E region (map-resident Score/invincibility music) on this module; pick the map, 1W-0 demo or ending module instead`
        )
      }
      stream = relocateModuleStream(stream, shiftRanges.map((r) => ({ start: r.start, end: r.end, delta })))
      bytes = serializeUploadStream(stream)
      relocationWarnings.push(
        `sequence data relocated 0x${minStart.toString(16).toUpperCase()} → 0xDC7F — ` +
        `0xD000-0xDC7E holds the map-resident Score/invincibility music, which plays mid-level`
      )
    }
  }
  // The $264C-$2C00 jingle region is likewise accumulation-resident (death /
  // goal / level-intro / game-over / toadies) — a source that parks data
  // there (map/1W-0 captures) corrupts it for every level context. Verbatim
  // data can't be split safely, so warn rather than relocate.
  if (!JINGLE_FREE_SONG_MODULES.has(target.module) && !['worldmap', 'welcome'].includes(target.module)) {
    if (stream.blocks.some((b) => b.dest < 0x2c00 && b.dest + b.data.length > 0x264c)) {
      relocationWarnings.push(
        'this .spc writes the 0x264C-0x2BFF jingle region — the death/goal/level-intro jingles will play corrupted until the map re-uploads them'
      )
    }
  }
  // A .spc module keeps its source addresses, so it CAN overwrite the set's
  // resident sample banks (typical AMY artifacts put custom BRR at $B960 over
  // the add-on bank). The song itself plays — the bank's other consumers
  // (sibling sets sharing it; the positional-diff upload never re-sends an
  // unchanged bank) are what break. Surface it instead of silently shipping.
  const bankOverlapWarnings: string[] = []
  for (const bankId of (catalog.settings[setting]?.blockIds ?? []).filter((id) => spcBlockById(id).kind === 'samples')) {
    const bank = spcBlockById(bankId)
    const overlaps = parseBlockFromRom(rom, catalog, bankId).stream.blocks.some((bb) =>
      stream.blocks.some((mb) => mb.dest < bb.dest + bb.data.length && bb.dest < mb.dest + mb.data.length)
    )
    if (overlaps) {
      bankOverlapWarnings.push(
        `this .spc's layout overwrites the resident ${bank.module} sample bank — music sets sharing that bank ` +
        `(and this module's other slots) will play corrupted instruments until a different bank re-uploads`
      )
    }
  }
  return {
    ...common,
    bytes,
    stream,
    layers: [],
    warnings: [...mod.warnings, ...relocationWarnings, ...bankOverlapWarnings, ...multiSlotWarning],
    sourceTitle: parsed.title
  }
}

/** Projected region layout with the target blob overridden to `moduleBytes`
 *  (every other overlay — songs and resized samples — included). The title
 *  blob rides inside the engine bin — its projection adjusts the engine. */
function projectedAudioLayout(projectId: string, blobFile: string | null, moduleBytes: number | null) {
  const sizes = audioBlobSizes(
    join(frameworkWorkRoot(), 'assets', 'yi'),
    join(overlayRoot(projectId), 'assets', 'yi')
  ).map((s) => (blobFile !== null && s.file === `SPC700/${blobFile}` && moduleBytes !== null ? { ...s, bytes: moduleBytes } : s))
  if (blobFile === TITLE_IMPORT_BLOB_FILE && moduleBytes !== null) {
    // The title blob rides inside the engine bin — override its rider (the
    // sizes above already include any EXISTING title overlay).
    const engine = sizes.find((s) => s.kind === 'engine')!
    engine.bytes = engine.bytes - (engine.titleImportBytes ?? 0) + moduleBytes
    engine.titleImportBytes = moduleBytes
  }
  return planAudioLayout(sizes)
}

/** Build the try-out .spc for one (file, source slot, target module) pick. */
export function previewSongImport(
  rel: string,
  sourceSlot: number,
  targetBlockId: number,
  downsampleToFit = true,
  dropStaccatoToFit = false,
  useSmwSamples = false,
  noEcho = false,
  targetSlotId: number | null = null
): AudioSongImportPreviewResult {
  try {
    const { catalog, rom } = loadCatalog()
    const m = buildSongImportModule(rel, sourceSlot, targetBlockId, downsampleToFit, dropStaccatoToFit, useSmwSamples, noEcho, targetSlotId)
    const warnings = [...m.warnings]
    if (m.bytes.length > m.target.retailBytes) {
      const projectId = getCurrentProjectId()
      const free = projectId ? projectedAudioLayout(projectId, m.blobFile, m.bytes.length).freeBytes : null
      warnings.push(
        `module is ${m.bytes.length - m.target.retailBytes} bytes larger than the retail ${m.target.module} slot` +
          (free !== null && free < 0 ? ` and OVER the region budget by ${-free} bytes — import will refuse` : '')
      )
    }
    const spc = synthesizeImportPreviewSpc(rom, catalog, m.setting, m.previewExcludeBlockId, m.stream, m.targetSlots[0], {
      title: m.sourceTitle ?? rel.split('/').pop()?.replace(/\.(spc|mml|txt)$/i, '')
    })
    return {
      ok: true,
      spc: toArrayBuffer(spc),
      warnings,
      moduleBytes: m.bytes.length,
      targetRetailBytes: m.target.retailBytes
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Import a song into the project: write the extracted module as the target's
 *  overlay blob (the build's layout pass re-fits the region around it) +
 *  record change-vs-base metadata. Caller marks the build dirty. */
export function importSong(
  rel: string,
  sourceSlot: number,
  targetBlockId: number,
  downsampleToFit = true,
  dropStaccatoToFit = false,
  useSmwSamples = false,
  noEcho = false,
  targetSlotId: number | null = null
): AudioSongImportRunResult {
  const writable = requireWritableProject()
  if (!writable.ok) return { ok: false, error: writable.error }
  try {
    const m = buildSongImportModule(rel, sourceSlot, targetBlockId, downsampleToFit, dropStaccatoToFit, useSmwSamples, noEcho, targetSlotId)
    const romVersion = readExtractionState(frameworkWorkRoot())?.romVersion
    if (romVersion !== 'YI_U1' && m.bytes.length !== m.target.retailBytes) {
      return {
        ok: false,
        error:
          `Imported module is ${m.bytes.length} bytes vs the retail ${m.target.retailBytes} — ` +
          'size-changing song imports are V1.0-only for now (V1.1 pins data after the audio region)'
      }
    }
    const layout = projectedAudioLayout(writable.projectId, m.blobFile, m.bytes.length)
    if (layout.freeBytes < 0) {
      return {
        ok: false,
        error:
          `Not enough room: the audio region would be ${-layout.freeBytes} bytes over budget ` +
          `(module ${m.bytes.length} B vs retail ${m.target.retailBytes} B). Revert another imported song or pick a smaller one.`
      }
    }
    const dest = overlaySongBlobPath(writable.projectId, m.blobFile)
    mkdirSync(join(dest, '..'), { recursive: true })
    writeFileAtomicSync(dest, Buffer.from(m.bytes))
    const meta = readAudioEditsMetaFor(writable.projectId)
    meta.songs = meta.songs ?? {}
    // Preserve any deleted-slot set already recorded for this module — the
    // deleted→0 patches ride along in the embedded base, and future
    // delete/restore needs the set (a slot merge decomposes the delete overlay
    // as its base, so the import already sees the freed room).
    const priorDeleted = meta.songs[m.blobFile]?.deletedSlots
    meta.songs[m.blobFile] = {
      baseBytes: m.target.retailBytes,
      newBytes: m.bytes.length,
      source: rel.split('/').pop() ?? rel,
      sourceSlot,
      targetBlockId,
      // Slot merges: every slot currently carrying an imported layer;
      // whole-module imports: every module slot (layers = []).
      targetSlots: m.layers.length > 0 ? m.layers.map((l) => l.slot).sort((a, b) => a - b) : m.targetSlots,
      title: m.sourceTitle ?? rel.split('/').pop()?.replace(/\.(spc|mml|txt)$/i, ''),
      layers: m.layers,
      ...(priorDeleted && priorDeleted.length > 0 ? { deletedSlots: priorDeleted } : {})
    }
    writeAudioEditsMeta(writable.projectId, meta)
    return {
      ok: true,
      moduleBytes: m.bytes.length,
      targetRetailBytes: m.target.retailBytes,
      freeBytes: layout.freeBytes,
      warnings: m.warnings
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Remove an imported song: delete the overlay blob (the next build reconciles
 *  the region back). Caller marks the build dirty. */
export function revertSongImport(targetBlockId: number): AudioSongImportRunResult {
  const writable = requireWritableProject()
  if (!writable.ok) return { ok: false, error: writable.error }
  try {
    const target = spcBlockById(targetBlockId)
    const blobFile = target.kind === 'engine' ? TITLE_IMPORT_BLOB_FILE : songBlobFileOfLabel(target.label)
    rmSync(overlaySongBlobPath(writable.projectId, blobFile), { force: true })
    const meta = readAudioEditsMetaFor(writable.projectId)
    if (meta.songs) delete meta.songs[blobFile]
    writeAudioEditsMeta(writable.projectId, meta)
    const layout = projectedAudioLayout(writable.projectId, null, null)
    return {
      ok: true,
      moduleBytes: 0,
      targetRetailBytes: target.retailBytes,
      freeBytes: layout.freeBytes,
      warnings: []
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ── per-song delete / restore ───────────────────────────────────────────────
// Free a multi-song module's ROM/ARAM space by dropping one of its songs (e.g.
// to fit a bigger import into another of its slots), reversibly. A module's
// overlay blob is ALWAYS `extractSongModule(pristine, kept retail slots) ⊕
// imported layers ⊕ (deleted slots → $FF8E ptr 0)`. Delete adds a slot to the
// deleted set, restore removes it — both recompute the blob here. The reduced
// retail base comes from the PRISTINE asset (imports never touch it), so the
// deleted song's sequence bytes are genuinely omitted (smaller blob → the
// layout pass reclaims the ROM region on the next build, exactly like Reset),
// and a subsequent slot import sees the freed room through decomposeForSlotMerge
// reading this overlay. A deleted slot points at 0 (the driver's silent/safe
// "no song" pointer — plan-audio-panel §1745). Exclusive bytes only: the shared
// $3D00 instrument table rides along whole, so no sibling song loses an
// instrument.

/** Recompute a song module's overlay for a new deleted-slot set (preserving
 *  any slot-merge import layers), or revert to pristine when nothing is
 *  deleted or imported. */
function applyModuleDeletion(targetBlockId: number, nextDeletedSlots: number[]): AudioSongImportRunResult {
  const writable = requireWritableProject()
  if (!writable.ok) return { ok: false, error: writable.error }
  try {
    const { catalog, rom } = loadCatalog()
    const target = SPC_BLOCKS.find((b) => b.blockId === targetBlockId && b.kind === 'songs')
    if (!target) throw new Error(`block 0x${targetBlockId.toString(16)} is not a song module`)
    const blobFile = songBlobFileOfLabel(target.label)
    const pristine = pristineSongModuleStream(target, rom, catalog)
    if (!pristine) throw new Error('pristine module asset unreadable — re-extract the ROM')
    const allSlots = [...songSlotsOfStream(pristine).keys()].sort((a, b) => a - b)
    const deletedSet = new Set(nextDeletedSlots.filter((s) => allSlots.includes(s)))

    const overlayPath = overlaySongBlobPath(writable.projectId, blobFile)
    const meta = readAudioEditsMetaFor(writable.projectId)
    const entry = meta.songs?.[blobFile]
    // A whole-module import (import provenance, no per-slot layers) can't be
    // per-song decomposed — the driver plays one song across every slot.
    if (entry?.source && (!entry.layers || entry.layers.length === 0)) {
      throw new Error("this module has a whole-set import — Reset it before deleting individual songs")
    }
    // Slot-merge import layers to preserve (minus any now-deleted slot).
    let importLayers: { slot: number; blocks: UploadStream['blocks']; source?: string; title?: string }[] = []
    if (existsSync(overlayPath) && entry?.layers && entry.layers.length > 0) {
      const blocks = parseUploadStream(new Uint8Array(readFileSync(overlayPath))).stream.blocks
      const sliced = sliceModuleLayers(blocks, entry.layers, -1)
      const bySlot = new Map(entry.layers.map((l) => [l.slot, l]))
      importLayers = sliced.kept
        .map((l) => ({ ...l, source: bySlot.get(l.slot)?.source, title: bySlot.get(l.slot)?.title }))
        .filter((l) => !deletedSet.has(l.slot))
    }
    const importedSlots = new Set(importLayers.map((l) => l.slot))
    const liveRetail = allSlots.filter((s) => !deletedSet.has(s) && !importedSlots.has(s))
    if (liveRetail.length === 0 && importLayers.length === 0) {
      throw new Error('a module must keep at least one song — restore or import one before deleting the last')
    }

    // No edits left → revert to the pristine asset (drop the overlay + entry).
    if (deletedSet.size === 0 && importLayers.length === 0) {
      rmSync(overlayPath, { force: true })
      if (meta.songs) delete meta.songs[blobFile]
      writeAudioEditsMeta(writable.projectId, meta)
      const layout = projectedAudioLayout(writable.projectId, null, null)
      return { ok: true, moduleBytes: 0, targetRetailBytes: target.retailBytes, freeBytes: layout.freeBytes, warnings: [] }
    }

    // Reduced retail base = pristine songs for the live-retail slots only.
    const setting = settingUploadingBlock(catalog, targetBlockId)
    const baseline = composeSettingAram(rom, catalog, setting, targetBlockId).aram
    const pristineAram = baseline.slice()
    applyUploadStream(pristineAram, pristine)
    const baseMod = extractSongModule(pristineAram, liveRetail.map((s) => ({ sourceSlot: s, targetSlot: s })), baseline)
    const baseBlocks = baseMod.stream.blocks

    // Repack imports into the gaps around the reduced base + resident banks.
    const bankBlocks = (catalog.settings[setting]?.blockIds ?? [])
      .filter((id) => spcBlockById(id).kind === 'samples')
      .flatMap((id) => parseBlockFromRom(rom, catalog, id).stream.blocks)
    const keptBlocks =
      importLayers.length > 0
        ? repackKeptLayers([...bankBlocks, ...baseBlocks], importLayers, importPlacementWindows(undefined, undefined, false))
        : []
    const deletedPatches = [...deletedSet]
      .sort((a, b) => a - b)
      .map((s) => ({ dest: SONG_TABLE_BASE + s * 2, data: new Uint8Array(2) }))
    const stream: UploadStream = { blocks: [...baseBlocks, ...keptBlocks.flat(), ...deletedPatches], entry: 0x0400 }
    const bytes = serializeUploadStream(stream)

    const romVersion = readExtractionState(frameworkWorkRoot())?.romVersion
    if (romVersion !== 'YI_U1' && bytes.length !== target.retailBytes) {
      return { ok: false, error: 'deleting a song resizes the module — V1.0-only for now (V1.1 pins data after the audio region)' }
    }
    const layout = projectedAudioLayout(writable.projectId, blobFile, bytes.length)
    if (layout.freeBytes < 0) {
      return { ok: false, error: `Not enough room after the change: ${-layout.freeBytes} bytes over the audio-region budget.` }
    }

    // Layer boundaries for the new blob (base first, then each repacked import).
    let at = baseBlocks.length
    const newLayers = importLayers.map((l, i) => {
      const firstBlock = at
      at += keptBlocks[i].length
      return { slot: l.slot, firstBlock, source: l.source, title: l.title }
    })

    const dest = overlaySongBlobPath(writable.projectId, blobFile)
    mkdirSync(join(dest, '..'), { recursive: true })
    writeFileAtomicSync(dest, Buffer.from(bytes))
    meta.songs = meta.songs ?? {}
    meta.songs[blobFile] = {
      ...(entry ?? {}),
      baseBytes: target.retailBytes,
      newBytes: bytes.length,
      targetBlockId,
      deletedSlots: [...deletedSet].sort((a, b) => a - b),
      layers: newLayers,
      // Keep the import provenance only while imports remain in the module.
      ...(importLayers.length === 0
        ? { source: undefined, sourceSlot: undefined, title: undefined, targetSlots: undefined }
        : { targetSlots: newLayers.map((l) => l.slot).sort((a, b) => a - b) })
    }
    writeAudioEditsMeta(writable.projectId, meta)
    return { ok: true, moduleBytes: bytes.length, targetRetailBytes: target.retailBytes, freeBytes: layout.freeBytes, warnings: baseMod.warnings }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Current deleted-slot set recorded for a song module. */
function currentDeletedSlots(targetBlockId: number): number[] {
  const target = spcBlockById(targetBlockId)
  if (target.kind !== 'songs') return []
  return readAudioEditsMeta()?.songs?.[songBlobFileOfLabel(target.label)]?.deletedSlots ?? []
}

/** Delete one song slot from a module (its bytes are freed; the slot plays
 *  silence until restored or re-imported). */
export function deleteSong(targetBlockId: number, slot: number): AudioSongImportRunResult {
  return applyModuleDeletion(targetBlockId, [...new Set([...currentDeletedSlots(targetBlockId), slot])])
}

/** Restore a previously-deleted song slot from the pristine module asset. */
export function restoreSong(targetBlockId: number, slot: number): AudioSongImportRunResult {
  return applyModuleDeletion(targetBlockId, currentDeletedSlots(targetBlockId).filter((s) => s !== slot))
}

/** Read one exported .spc/.wav back for in-editor playback. `rel` must
 *  resolve inside the export folder (no traversal). */
export function readExportedSpc(rel: string): AudioComposeSpcResult {
  try {
    return { ok: true, spc: toArrayBuffer(readFileSync(resolveInsideExportDir(rel))) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export function openAudioExportFolder(): string | null {
  const dir = audioExportDir()
  if (!dir) return null
  mkdirSync(dir, { recursive: true })
  return dir
}
