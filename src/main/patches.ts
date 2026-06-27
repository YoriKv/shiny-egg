// Custom-patch store + post-build apply (main side). A patch is byte-level edits
// applied to the FINISHED build, after asar + the project overlay.
//
// On disk a patch is `<id>.json` (PatchFile: metadata + binary `chunks`) plus an
// OPTIONAL sibling `<id>.asm` holding the build-time asar source — both
// hand-editable in a text editor. The sibling is the home for asm (so it has real
// editor support); `readPatchFile` folds it back into `PatchFile.asm`. Back-compat:
// a JSON with inline `asm` and no sibling still loads (every re-save migrates it
// to the sibling). IPS is import-only — importing converts an `.ips` into chunks;
// an asar `.asm` is imported by converting it to the build-compatible form (see
// importAsm). Patches are **per project**: the editor
// ships a read-only prepackaged catalog (snes-framework/patches/), and the user
// "adds" (copies) one into the active project, or imports an external `.ips`. The
// project's `patches.json` manifest records which local patches are enabled
// (apply order; last write wins; all off by default).

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { basename, join } from 'node:path'
import { outputSfcName } from 'snes-framework/rom-versions'
import { readExtractionState } from 'snes-framework/state'
import { mergeSymbolMaps, parseWlaSymbolMap, type SymbolMap } from 'snes-framework/symbol-map'
import {
  applyPatches,
  convertAsarPatch,
  deriveAsmPatchMeta,
  flattenIps,
  chunksToStored,
  parseIps,
  resolveChunkTarget,
  storedToChunks,
  type AppliedPatch
} from 'snes-framework/patches'
import type { BuildResult } from 'snes-framework/build'
import { PATCH_POOL_DEFAULT_BYTES, PATCH_POOL_MAX_BYTES, PATCH_POOL_MIN_BYTES } from 'snes-framework/pool-map'
import type { PatchFile, PatchChunk, PatchApplyReport, RomVersion, StoredPatchChunk } from 'snes-framework/types'
import type {
  PatchAuthoringPaths,
  PatchImportResult,
  PatchMutationResult,
  PatchPoolSettings,
  PatchPreview,
  PatchPreviewChunk,
  PatchSummary,
  PrepackagedPatch
} from '../shared/ipc-types'
import {
  buildOutputDir,
  builtinPatchesRoot,
  frameworkWorkRoot,
  projectBuildDir,
  projectPatchesDir,
  projectPatchManifestPath
} from './framework-paths'
import { getCurrentProjectId } from './projects'

interface PatchManifest {
  version: 1
  /** Stable display + apply order of the project's patches — independent of the
   *  enabled state, so toggling a patch never reorders the list. */
  order: string[]
  /** Which patches are on (a set; order is irrelevant here). */
  enabled: string[]
  /** Asm-patch pool size (KB) reserved off FreeRegion51's tail. Absent ⇒ default.
   *  Bigger = more room for hand-authored asm; smaller = more free-region room for
   *  level-data migration. See snes-framework pool-map.ts + the budget gate. */
  patchPoolKB?: number
}

// Asm-patch pool size bounds (KB), derived from the engine's byte constants so the
// UI bound and the carve never drift. The slice must stay within one LoROM bank
// (PATCH_POOL_MAX_BYTES upholds that — see pool-map.ts patchPoolGeometry). The step
// is the 256 B (0.25 KB) granularity, so fractional sizes (0.25, 0.5, …) map to a
// whole-byte reservation; 0.25 = a power-of-two fraction, so kb·1024 stays exact.
const PATCH_POOL_MIN_KB = PATCH_POOL_MIN_BYTES / 1024
const PATCH_POOL_DEFAULT_KB = PATCH_POOL_DEFAULT_BYTES / 1024
const PATCH_POOL_MAX_KB = PATCH_POOL_MAX_BYTES / 1024
const PATCH_POOL_STEP_KB = PATCH_POOL_MIN_BYTES / 1024

/** Clamp a user-supplied patch-pool size to [min, max] KB, snapped to the 0.25 KB
 *  (256 B) step so it always maps to a whole-byte reservation. */
function clampPatchPoolKB(kb: number): number {
  if (!Number.isFinite(kb)) return PATCH_POOL_DEFAULT_KB
  const snapped = Math.round(kb / PATCH_POOL_STEP_KB) * PATCH_POOL_STEP_KB
  return Math.min(PATCH_POOL_MAX_KB, Math.max(PATCH_POOL_MIN_KB, snapped))
}

// ── On-disk read/write ────────────────────────────────────────────────────

function readManifest(projectId: string): PatchManifest {
  const p = projectPatchManifestPath(projectId)
  if (existsSync(p)) {
    try {
      const m = JSON.parse(readFileSync(p, 'utf8')) as Partial<PatchManifest>
      const enabled = Array.isArray(m.enabled) ? m.enabled.filter((x): x is string => typeof x === 'string') : []
      // Back-compat: pre-`order` manifests used `enabled` as the order too.
      const order = Array.isArray(m.order) ? m.order.filter((x): x is string => typeof x === 'string') : [...enabled]
      const patchPoolKB = typeof m.patchPoolKB === 'number' ? clampPatchPoolKB(m.patchPoolKB) : undefined
      return { version: 1, order, enabled, ...(patchPoolKB !== undefined ? { patchPoolKB } : {}) }
    } catch {
      /* fall through to default */
    }
  }
  return { version: 1, order: [], enabled: [] }
}

/** All project patch ids in stable display + apply order: the manifest order
 *  first (entries that still exist on disk), then any not-yet-ordered files
 *  alphabetically. Independent of enabled state — toggling never reorders. */
function projectOrderedIds(projectId: string): string[] {
  const present = listPatchIds(projectPatchesDir(projectId))
  const set = new Set(present)
  const out = readManifest(projectId).order.filter((id) => set.has(id))
  const seen = new Set(out)
  for (const id of present.sort()) if (!seen.has(id)) out.push(id)
  return out
}

/** Append an id to the manifest order (keeping enabled untouched) so a newly
 *  added/imported patch takes a stable position at the end. */
function appendToOrder(projectId: string, id: string): void {
  const m = readManifest(projectId)
  if (!m.order.includes(id)) writeManifest(projectId, { ...m, order: [...m.order, id] })
}

function writeManifest(projectId: string, m: PatchManifest): void {
  writeFileSync(projectPatchManifestPath(projectId), JSON.stringify(m, null, 2), 'utf8')
}

/** Path of a patch's sibling asm source (`<id>.asm`), the home for build-time
 *  asar — paired with `<id>.json`. */
function patchAsmPath(dir: string, id: string): string {
  return join(dir, `${id}.asm`)
}

function readPatchFile(dir: string, id: string): PatchFile | null {
  const p = join(dir, `${id}.json`)
  if (!existsSync(p)) return null
  try {
    // Back-compat: patches written before the hunks→chunks rename store the byte
    // writes under `hunks`. Adopt the legacy key so existing project patch files
    // (and any hand-authored `.json` still using it) keep loading.
    const raw = JSON.parse(readFileSync(p, 'utf8')) as PatchFile & { hunks?: StoredPatchChunk[] }
    const chunks = Array.isArray(raw.chunks) ? raw.chunks : Array.isArray(raw.hunks) ? raw.hunks : []
    // Build-time asm lives in the sibling `<id>.asm` (the on-disk home); fall back
    // to a legacy inline `asm` field so pre-split JSONs keep loading.
    const asmPath = patchAsmPath(dir, id)
    const asm = existsSync(asmPath) ? readFileSync(asmPath, 'utf8') : raw.asm
    // A patch must do something: binary chunks and/or build-time asm.
    if (chunks.length === 0 && asm === undefined) return null
    return { ...raw, chunks, ...(asm !== undefined ? { asm } : {}) }
  } catch {
    return null
  }
}

/** Write a patch to disk in the paired form: `<id>.json` (with `asm` stripped,
 *  since it lives in the sibling) + the sibling `<id>.asm` when the patch carries
 *  asm (else any stale sibling is removed). The single writer for created /
 *  imported / template patches, so the on-disk shape stays consistent. */
function writePatchFiles(dir: string, pf: PatchFile): void {
  mkdirSync(dir, { recursive: true })
  const { asm, ...json } = pf
  writeFileSync(join(dir, `${pf.id}.json`), JSON.stringify(json, null, 2), 'utf8')
  const asmPath = patchAsmPath(dir, pf.id)
  if (asm !== undefined) {
    writeFileSync(asmPath, Array.isArray(asm) ? asm.join('\n') : asm, 'utf8')
  } else if (existsSync(asmPath)) {
    rmSync(asmPath)
  }
}

/** All patch ids in a dir (one `<id>.json` each). */
function listPatchIds(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
}

function projectPatch(projectId: string, id: string): PatchFile | null {
  return readPatchFile(projectPatchesDir(projectId), id)
}

/** Total bytes a patch writes (Σ chunk byte-lengths) — from the hex, no decode. */
function totalBytesOf(pf: PatchFile): number {
  return (pf.chunks ?? []).reduce((n, h) => n + (h.bytes.length >> 1), 0)
}

/** Number of build-time asm edits — each directive that starts a distinct ROM
 *  write region in the patch's `asm`: an `org` in-place edit / trampoline, a
 *  `%patchcode()`/`%patchdata()` pool routine, or a legacy `freecode`/`freedata`
 *  stub. The asm parallel to a chunk, so a patch's "weight" reads consistently
 *  whether it writes via chunks or asm. Counts per-statement so `org $X : db ...`
 *  counts once; comments are stripped first so a `;` line never miscounts, and
 *  `^…%patch` (not `%endpatch`) keeps the block CLOSE from double-counting. */
function asmEditCountOf(pf: PatchFile): number {
  if (pf.asm === undefined) return 0
  const lines = Array.isArray(pf.asm) ? pf.asm : pf.asm.split('\n')
  let n = 0
  for (const line of lines) {
    for (const stmt of line.replace(/;.*$/, '').split(':')) {
      if (/^\s*(?:org|freecode|freedata|%patch(?:code|data))\b/i.test(stmt)) n++
    }
  }
  return n
}

function summaryOf(pf: PatchFile, enabled: boolean): PatchSummary {
  return {
    id: pf.id,
    name: pf.name,
    ...(pf.description ? { description: pf.description } : {}),
    ...(pf.attribution ? { attribution: pf.attribution } : {}),
    source: pf.source,
    ...(pf.romVersionAuthored ? { romVersionAuthored: pf.romVersionAuthored } : {}),
    chunkCount: (pf.chunks ?? []).length,
    totalBytes: totalBytesOf(pf),
    asmCount: asmEditCountOf(pf),
    enabled
  }
}

// ── Symbol-map loading ──────────────────────────────────────────────────────

function loadMergedSym(mainPath: string, fxPath: string): SymbolMap | null {
  if (!existsSync(mainPath)) return null
  let sym = parseWlaSymbolMap(readFileSync(mainPath, 'utf8'))
  if (existsSync(fxPath)) sym = mergeSymbolMaps(sym, parseWlaSymbolMap(readFileSync(fxPath, 'utf8')))
  return sym
}

function symPair(dir: string, romVersion: RomVersion): { main: string; fx: string } {
  const sfc = outputSfcName(romVersion)
  return {
    main: join(dir, sfc.replace(/\.sfc$/, '.sym')),
    fx: join(dir, sfc.replace(/\.sfc$/, '-superfx.sym'))
  }
}

/** On-disk locations for hand-authoring patches: the framework asm source
 *  (`<framework>/yi`) and the active project's build symbol files (`<project>/build`,
 *  written by each project build). For the patches-panel help. */
export function patchAuthoringPaths(): PatchAuthoringPaths {
  const asmDir = join(frameworkWorkRoot(), 'yi')
  const projectId = getCurrentProjectId()
  if (!projectId) return { asmDir, symDir: null, symFiles: [] }
  const symDir = projectBuildDir(projectId)
  const state = readExtractionState(frameworkWorkRoot())
  if (!state) return { asmDir, symDir, symFiles: [] }
  const { main, fx } = symPair(symDir, state.romVersion)
  return { asmDir, symDir, symFiles: [main, fx].filter((f) => existsSync(f)) }
}

/** The base V1.0 build's merged symbols — the "reference cart" the importer
 *  reverse-looks-up offsets against. Null when no base build exists yet.
 *  (Exported for the ROM importer's diff-inventory label attribution.) */
export function loadBaseSym(): SymbolMap | null {
  const state = readExtractionState(frameworkWorkRoot())
  if (!state) return null
  const { main, fx } = symPair(buildOutputDir(), state.romVersion)
  return loadMergedSym(main, fx)
}

/** The active project build's merged symbols (apply/preview resolve labels →
 *  addresses against these — they reflect the project's own asm shifts). Falls
 *  back to the base build when the project hasn't built yet. */
function loadProjectSym(projectId: string): SymbolMap | null {
  const state = readExtractionState(frameworkWorkRoot())
  if (!state) return null
  const { main, fx } = symPair(projectBuildDir(projectId), state.romVersion)
  return loadMergedSym(main, fx) ?? loadBaseSym()
}

function baseRomVersion(): RomVersion | undefined {
  return readExtractionState(frameworkWorkRoot())?.romVersion
}

// ── Listing ─────────────────────────────────────────────────────────────────

/** The active project's local patches, in manifest (apply) order first, then the
 *  rest. Empty when no project is active. */
export function listProjectPatches(): PatchSummary[] {
  const projectId = getCurrentProjectId()
  if (!projectId) return []
  const enabled = new Set(readManifest(projectId).enabled)
  const out: PatchSummary[] = []
  for (const id of projectOrderedIds(projectId)) {
    const pf = readPatchFile(projectPatchesDir(projectId), id)
    if (pf) out.push(summaryOf(pf, enabled.has(id)))
  }
  return out
}

/** The bundled prepackaged catalog, each flagged with whether it's already been
 *  added to the active project (by id). */
export function listPrepackagedPatches(): PrepackagedPatch[] {
  const projectId = getCurrentProjectId()
  const inProject = new Set(projectId ? listPatchIds(projectPatchesDir(projectId)) : [])
  const out: PrepackagedPatch[] = []
  for (const id of listPatchIds(builtinPatchesRoot())) {
    const pf = readPatchFile(builtinPatchesRoot(), id)
    if (!pf) continue
    out.push({
      id: pf.id,
      name: pf.name,
      ...(pf.category ? { category: pf.category } : {}),
      ...(pf.description ? { description: pf.description } : {}),
      ...(pf.attribution ? { attribution: pf.attribution } : {}),
      ...(pf.romVersionAuthored ? { romVersionAuthored: pf.romVersionAuthored } : {}),
      chunkCount: (pf.chunks ?? []).length,
      totalBytes: totalBytesOf(pf),
      asmCount: asmEditCountOf(pf),
      added: inProject.has(id)
    })
  }
  return out
}

// ── Mutations ─────────────────────────────────────────────────────────────

/** Copy a prepackaged patch (`<id>.json`) into the active project AND enable it
 *  by default (it still applies in list order — see reorder). Idempotent when
 *  already added; re-adding re-enables without duplicating. */
export function addPrepackagedToProject(builtinId: string): PatchMutationResult {
  const projectId = getCurrentProjectId()
  if (!projectId) return { ok: false, error: 'No active project.' }
  if (!readPatchFile(builtinPatchesRoot(), builtinId)) {
    return { ok: false, error: `Unknown prepackaged patch "${builtinId}".` }
  }
  const dir = projectPatchesDir(projectId)
  mkdirSync(dir, { recursive: true })
  copyFileSync(join(builtinPatchesRoot(), `${builtinId}.json`), join(dir, `${builtinId}.json`))
  // Bring the sibling asm source along (asm-bearing patches keep it in `<id>.asm`).
  const builtinAsm = patchAsmPath(builtinPatchesRoot(), builtinId)
  if (existsSync(builtinAsm)) copyFileSync(builtinAsm, patchAsmPath(dir, builtinId))
  // Append to the order (stable end position) and enable, in one manifest write.
  const m = readManifest(projectId)
  writeManifest(projectId, {
    ...m,
    order: m.order.includes(builtinId) ? m.order : [...m.order, builtinId],
    enabled: m.enabled.includes(builtinId) ? m.enabled : [...m.enabled, builtinId]
  })
  return { ok: true }
}

/** Import an external `.ips` into the active project: flatten it into
 *  address-based chunks and write a self-contained `<id>.json`. Not enabled.
 *  (Label remap is a build-time concern, not done here.) */
export function importIps(filePath: string): PatchImportResult {
  const projectId = getCurrentProjectId()
  if (!projectId) return { ok: false, error: 'No active project to import a patch into.' }

  let raw: Buffer
  try {
    raw = readFileSync(filePath)
  } catch (e) {
    return { ok: false, error: `Could not read "${filePath}": ${(e as Error).message}` }
  }
  let ips
  try {
    ips = parseIps(toU8(raw))
  } catch (e) {
    return { ok: false, error: `Not a valid IPS file: ${(e as Error).message}` }
  }

  const chunks: PatchChunk[] = flattenIps(ips)

  const dir = projectPatchesDir(projectId)
  const id = uniqueId(projectId, slugify(basename(filePath).replace(/\.ips$/i, '')))
  const pf: PatchFile = {
    id,
    name: basename(filePath).replace(/\.ips$/i, ''),
    source: 'imported',
    importedFrom: basename(filePath),
    ...(baseRomVersion() ? { romVersionAuthored: baseRomVersion() } : {}),
    chunks: chunksToStored(chunks)
  }
  writePatchFiles(dir, pf)
  appendToOrder(projectId, id)
  return { ok: true, patch: summaryOf(pf, false) }
}

/** Import an external asar `.asm` hack into the active project: convert the asar
 *  idioms it uses (`freecode`/`autoclean`/`freespace`/raw-address `org`) into the
 *  build-compatible form (the reserved `%patchcode` pool + drift-proofed label
 *  orgs — see convertAsarPatch), then write the paired `<id>.json` + `<id>.asm`.
 *  Disabled by default (the user reviews the converted asm + enables). Conversion
 *  notes ride back in the result so the panel can surface what changed. */
export function importAsm(filePath: string): PatchImportResult {
  const projectId = getCurrentProjectId()
  if (!projectId) return { ok: false, error: 'No active project to import a patch into.' }

  let src: string
  try {
    src = readFileSync(filePath, 'utf8')
  } catch (e) {
    return { ok: false, error: `Could not read "${filePath}": ${(e as Error).message}` }
  }

  const meta = deriveAsmPatchMeta(src, basename(filePath))
  // Reference symbols (base build) drift-proof the converted `org`s; null ⇒ orgs
  // stay raw (the converter notes it).
  const { asm, notes } = convertAsarPatch(src, { refSym: loadBaseSym() ?? undefined })

  const dir = projectPatchesDir(projectId)
  const id = uniqueId(projectId, slugify(meta.name))
  // Prepend a provenance + conversion-notes header so the stored asm is
  // self-explanatory (it differs from the imported source).
  const header = [
    `; Imported from ${basename(filePath)} and converted for this cart's build.`,
    ...(notes.length ? ['; Conversion notes:', ...notes.map((n) => `;   - ${n}`)] : []),
    ''
  ].join('\n')
  const pf: PatchFile = {
    id,
    name: meta.name,
    ...(meta.description ? { description: meta.description } : {}),
    ...(meta.attribution ? { attribution: meta.attribution } : {}),
    // The full comment block stays in the `.asm` body — no need to also store it
    // in JSON `details`.
    source: 'imported',
    importedFrom: basename(filePath),
    ...(baseRomVersion() ? { romVersionAuthored: baseRomVersion() } : {}),
    asm: header + asm
  }
  writePatchFiles(dir, pf)
  appendToOrder(projectId, id)
  return { ok: true, patch: summaryOf(pf, false), ...(notes.length ? { notes } : {}) }
}

/** A self-documenting template `PatchFile` for the "New Patch" button: every
 *  user-relevant field present with sample data. `details` carries the format
 *  reference (it's the field meant for hand-editing notes, never shown in the
 *  UI — JSON has no comments, so this is where the docs live). Created DISABLED:
 *  the sample chunk bytes are illustrative, so the user edits, then enables. */
function templatePatchFile(id: string, romVersion: RomVersion): PatchFile {
  return {
    id,
    name: 'My New Patch (template)',
    category: 'My Patches',
    description:
      'TEMPLATE — edit the fields + sample bytes below, then enable in the panel. (Created disabled.)',
    attribution: 'Optional credit: original hack · author · URL',
    details: [
      'FORMAT REFERENCE (this `details` field is never shown in the UI — it documents',
      'the file for hand-editing). A patch edits the FINISHED build (after asar + your',
      'project overlay). Provide build-time asm (in the sibling `<id>.asm` file),',
      'binary `chunks` (below), or both; delete the parts you do not use.',
      '',
      'Fields:',
      '  id          stable id (also the filename); keep unique within the project.',
      '  name        shown in the patches panel.',
      '  category    optional group heading in the panel.',
      '  description optional one-line summary (panel tooltip).',
      '  attribution optional source credit (panel tooltip, on its own line).',
      '  details     this reference text; never shown in the UI.',
      '  source      "user" for hand-authored patches (vs "builtin" / "imported").',
      '  romVersionAuthored  ROM the offsets target ("YI_U1" = USA V1.0).',
      '  importedFrom  original filename; only set on imported .ips / .asm patches.',
      '  chunks      raw byte writes (see below).',
      '',
      'Build-time asm lives in the SIBLING `<id>.asm` file (paired with this JSON, so',
      'it gets real editor support). See its leading comments for the asar reference.',
      '',
      'chunks[]: each chunk is ONE contiguous byte write, addressed exactly ONE of',
      'two ways:',
      '  - "offset": an absolute USA V1.0 PC offset as hex ("0x0093E2" or "$0093E2").',
      '    At apply it is reverse-looked-up to the nearest asm label + delta, so it',
      '    keeps pointing at the right code even after asm edits shift the cart.',
      '  - "label" (+ optional "labelOffset", hex e.g. "0x04" or "$04"): a .sym label',
      '    (e.g. "CODE_018041") resolved directly against the just-built ROM —',
      '    name your own anchor.',
      '  "bytes": hex bytes, packed ("EAEA") or with optional $NN / 0xNN prefixes and',
      '    whitespace/comma separators ("$EA $EA"). "EA" = NOP, "60" = RTS.',
      '  Hex anywhere here accepts $NN and 0xNN interchangeably.'
    ],
    source: 'user',
    romVersionAuthored: romVersion,
    asm: [
      '; --- asar source assembled into the build (delete this file if unused) ---',
      '; Everything here is commented out, so it assembles to nothing until you edit it.',
      '; Engine labels are injected as `!CODE_*` / `!RAM_*` defines (the "define inject"),',
      '; resolved against the just-built ROM .sym so they survive asm drift. See the',
      '; prepackaged Flutter patches for full worked examples.',
      ';',
      '; IMPORTANT: do NOT use asar `freespace` / `freecode` for new routines - asar',
      '; cannot confine them to a safe region on this cart, and they would collide with',
      '; the level-data relocation allocator (it uses the same Bank51 free space). Put',
      '; new routines in the reserved patch pool (a carved-off tail of the Bank51 free',
      '; region) with `%patchcode()` / `%endpatchcode()`.',
      ';',
      '; Example 1 - in-place edit by RAW ADDRESS (post build, needs to account for drift):',
      ';   org $0093E2 : db $EA,$EA              ; NOP two bytes at $0093E2',
      ';',
      '; Example 2 - in-place edit by INJECTED LABEL (drift-proof; preferred):',
      ';   org !CODE_018041 : db $EA,$EA         ; same edit, anchored to the engine label',
      ';',
      '; Example 3 - a new routine in the reserved patch pool (NOT freespace):',
      ';   org !CODE_018041 : JML MyRoutine      ; trampoline into the stub',
      ';   %patchcode()',
      ';   MyRoutine:',
      ';     LDA.w #$0001',
      ';     JML !CODE_018041+$04                ; resume after the displaced bytes',
      ';   %endpatchcode()'
    ],
    chunks: [
      // Offset-addressed sample (survives asm drift). Replace before enabling.
      { offset: '0x0093E2', bytes: 'EAEA' },
      // Label-addressed sample (resolved against the build .sym). Replace before enabling.
      { label: 'CODE_018041', labelOffset: '0x0', bytes: '60' }
    ]
  }
}

/** Create a new, self-documenting template patch in the active project (disabled,
 *  appended to the list). The user edits the JSON via "Open folder" then enables it. */
export function createTemplatePatch(): PatchImportResult {
  const projectId = getCurrentProjectId()
  if (!projectId) return { ok: false, error: 'No active project to create a patch in.' }
  const dir = projectPatchesDir(projectId)
  const id = uniqueId(projectId, 'my-patch')
  const pf = templatePatchFile(id, baseRomVersion() ?? 'YI_U1')
  writePatchFiles(dir, pf) // splits the asm template into the sibling `<id>.asm`
  appendToOrder(projectId, id) // not enabled — the sample bytes are illustrative
  return { ok: true, patch: summaryOf(pf, false) }
}

/** Enable/disable a project patch (apply order = manifest order; enabling
 *  appends to the end). */
export function setPatchEnabled(id: string, enabled: boolean): PatchMutationResult {
  const projectId = getCurrentProjectId()
  if (!projectId) return { ok: false, error: 'No active project.' }
  if (!projectPatch(projectId, id)) return { ok: false, error: `Patch "${id}" is not in this project.` }
  const m = readManifest(projectId)
  const nextEnabled = m.enabled.filter((x) => x !== id)
  if (enabled) nextEnabled.push(id)
  // Order is untouched — toggling never moves a patch in the list.
  const order = m.order.includes(id) ? m.order : [...m.order, id]
  writeManifest(projectId, { ...m, order, enabled: nextEnabled })
  return { ok: true }
}

/** Configured asm-patch pool size for a project (KB, clamped; default 1 KB). */
export function getPatchPoolKB(projectId: string): number {
  return clampPatchPoolKB(readManifest(projectId).patchPoolKB ?? PATCH_POOL_DEFAULT_KB)
}

/** Configured asm-patch pool size in BYTES — the carve passed to the build layout
 *  pass AND the pre-build budget gate so they agree on free-region capacity.
 *  (Round defends against any float drift; snapped KB·1024 is already exact.) */
export function getPatchPoolBytes(projectId: string): number {
  return Math.round(getPatchPoolKB(projectId) * 1024)
}

/** Patch-pool size + UI bounds for the active project (the Patches panel control).
 *  Falls back to the default size when no project is active. */
export function getPatchPoolSettings(): PatchPoolSettings {
  const projectId = getCurrentProjectId()
  return {
    kb: projectId ? getPatchPoolKB(projectId) : PATCH_POOL_DEFAULT_KB,
    minKB: PATCH_POOL_MIN_KB,
    maxKB: PATCH_POOL_MAX_KB,
    stepKB: PATCH_POOL_STEP_KB
  }
}

/** Set the project's asm-patch pool size (KB, clamped to [min, max]). Changes the
 *  build layout (the reserved slice + the free space migration can use), so the
 *  caller marks the build dirty. */
export function setPatchPoolKB(kb: number): PatchMutationResult {
  const projectId = getCurrentProjectId()
  if (!projectId) return { ok: false, error: 'No active project.' }
  const m = readManifest(projectId)
  writeManifest(projectId, { ...m, patchPoolKB: clampPatchPoolKB(kb) })
  return { ok: true }
}

/** Set the project's patch order (ids not in the project are dropped). Enabled
 *  state is preserved. */
export function reorderPatches(ids: string[]): PatchMutationResult {
  const projectId = getCurrentProjectId()
  if (!projectId) return { ok: false, error: 'No active project.' }
  const valid = ids.filter((id) => projectPatch(projectId, id))
  const m = readManifest(projectId)
  writeManifest(projectId, { ...m, order: valid })
  return { ok: true }
}

/** Remove a patch from the project (delete its file + de-list). */
export function removePatch(id: string): PatchMutationResult {
  const projectId = getCurrentProjectId()
  if (!projectId) return { ok: false, error: 'No active project.' }
  if (!projectPatch(projectId, id)) return { ok: false, error: `Patch "${id}" is not in this project.` }
  const p = join(projectPatchesDir(projectId), `${id}.json`)
  if (existsSync(p)) rmSync(p)
  const asmPath = patchAsmPath(projectPatchesDir(projectId), id)
  if (existsSync(asmPath)) rmSync(asmPath)
  const m = readManifest(projectId)
  writeManifest(projectId, {
    ...m,
    order: m.order.filter((x) => x !== id),
    enabled: m.enabled.filter((x) => x !== id)
  })
  return { ok: true }
}

/** Ensure the active project's patches dir exists and return it (for "open
 *  folder"). Null when no project is active. */
export function ensureProjectPatchesDir(): string | null {
  const projectId = getCurrentProjectId()
  if (!projectId) return null
  const dir = projectPatchesDir(projectId)
  mkdirSync(dir, { recursive: true })
  return dir
}

// ── Preview ──────────────────────────────────────────────────────────────

/** Resolve one project patch against the active project's current build symbols
 *  (label resolution + overlaps with other enabled patches). */
export function previewPatch(id: string): PatchPreview | null {
  const projectId = getCurrentProjectId()
  if (!projectId) return null
  const pf = projectPatch(projectId, id)
  if (!pf) return null
  const buildSym = loadProjectSym(projectId)
  const refSym = loadBaseSym() ?? buildSym

  let chunks: PatchChunk[]
  try {
    chunks = storedToChunks(pf.chunks ?? [])
  } catch (e) {
    return { id, chunks: [], warnings: [`malformed patch JSON: ${(e as Error).message}`], conflicts: [] }
  }

  const warnings: string[] = []
  const previewChunks: PatchPreviewChunk[] = []
  const myRanges: Array<{ offset: number; length: number }> = []
  for (const h of chunks) {
    const r = resolveChunkTarget(h, refSym, buildSym)
    if (r.unresolvedLabel) {
      warnings.push(
        r.resolvedVia === 'label'
          ? `label "${r.unresolvedLabel}" not in build — this patch will FAIL the build (enable the patch that defines it and order it first)`
          : `anchor "${r.unresolvedLabel}" not in build — falls back to reference offset`
      )
    }
    previewChunks.push({
      offset: r.offset,
      length: h.bytes.length,
      resolvedVia: r.resolvedVia,
      ...(r.label ? { label: r.label } : {})
    })
    myRanges.push({ offset: r.offset, length: h.bytes.length })
  }
  if (baseRomVersion() && pf.romVersionAuthored && baseRomVersion() !== pf.romVersionAuthored) {
    warnings.push(`authored for ${pf.romVersionAuthored}; project is ${baseRomVersion()}`)
  }

  const conflicts: PatchPreview['conflicts'] = []
  const manifest = readManifest(projectId)
  for (const otherId of manifest.enabled) {
    if (otherId === id) continue
    const other = projectPatch(projectId, otherId)
    if (!other) continue
    let otherChunks: PatchChunk[]
    try { otherChunks = storedToChunks(other.chunks ?? []) } catch { continue }
    for (const oh of otherChunks) {
      const r = resolveChunkTarget(oh, refSym, buildSym)
      const oStart = r.offset
      const oEnd = oStart + oh.bytes.length
      for (const mine of myRanges) {
        const s = Math.max(mine.offset, oStart)
        const e = Math.min(mine.offset + mine.length, oEnd)
        if (s < e) conflicts.push({ offset: s, length: e - s, patchIds: [id, otherId] })
      }
    }
  }
  return { id, chunks: previewChunks, warnings, conflicts }
}

// ── Post-build apply (called from buildProject) ─────────────────────────────

/**
 * Apply a project's enabled patches to the just-built ROM **in place**, after
 * asar. No-op (ROM untouched, byte-exact) when no patches are enabled. Each
 * chunk's label resolves to its address in the just-built ROM's symbols (tracking
 * the project's asm drift), else its absolute offset. Recomputes the checksum.
 * Returns the apply report, or null when nothing was enabled.
 */
export function applyProjectPatches(projectId: string, result: BuildResult): PatchApplyReport | null {
  const manifest = readManifest(projectId)
  if (manifest.enabled.length === 0) return null
  // Apply in the stable project order (so conflict last-wins matches the panel),
  // restricted to enabled patches.
  const enabledSet = new Set(manifest.enabled)
  const orderedEnabled = projectOrderedIds(projectId).filter((id) => enabledSet.has(id))

  // Resolve labels → addresses against the just-built ROM (`buildSym`); remap
  // each chunk's reference offset through the base/reference symbols (`refSym`) so
  // the write tracks the project's asm drift. `refSym === buildSym` (no separate
  // base build) ⇒ identity remap ⇒ raw offsets, correct for an un-drifted build.
  const buildSym = loadMergedSym(result.symbolsPath, result.superfxSymbolsPath)
  const refSym = loadBaseSym() ?? buildSym
  const applied: AppliedPatch[] = []
  const problems: string[] = []
  for (const id of orderedEnabled) {
    const pf = projectPatch(projectId, id)
    if (!pf) { problems.push(`enabled patch "${id}" not found — skipped`); continue }
    try {
      applied.push({
        id,
        chunks: storedToChunks(pf.chunks ?? []),
        ...(pf.romVersionAuthored ? { romVersionAuthored: pf.romVersionAuthored } : {})
      })
    } catch (e) {
      problems.push(`patch "${id}" has malformed JSON (${(e as Error).message}) — skipped`)
    }
  }
  if (applied.length === 0) {
    return { applied: [], skipped: [], warnings: problems, conflicts: [], chunks: [], bytesWritten: 0, checksum: 0 }
  }

  const buf = readFileSync(result.outputPath)
  const rom = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  const report = applyPatches(rom, refSym, buildSym, applied, result.romVersion)
  report.warnings.push(...problems)
  if (report.bytesWritten > 0) {
    const tmp = `${result.outputPath}.patch-tmp`
    writeFileSync(tmp, rom)
    renameSync(tmp, result.outputPath)
  }
  return report
}

// ── Build-time asm patches (assembled INTO the ROM, pre-checksum) ────────────

/** The enabled patches that carry an `asm` body, in apply order, with the asm
 *  flattened to a single string. These are compiled into the ROM by asar (via
 *  the framework's YI_InsertIntegratedPatches hook), not written post-build. */
export function enabledAsmPatches(projectId: string): Array<{ id: string; asm: string }> {
  const enabledSet = new Set(readManifest(projectId).enabled)
  const out: Array<{ id: string; asm: string }> = []
  for (const id of projectOrderedIds(projectId).filter((x) => enabledSet.has(x))) {
    const pf = projectPatch(projectId, id)
    if (pf?.asm !== undefined) {
      out.push({ id, asm: Array.isArray(pf.asm) ? pf.asm.join('\n') : pf.asm })
    }
  }
  return out
}

/** True when the active project has ≥1 enabled patch with an `asm` body (forces
 *  the build-tree path so asar can assemble it). */
export function hasEnabledAsmPatches(projectId: string): boolean {
  return enabledAsmPatches(projectId).length > 0
}

/** label name -> 24-bit SNES address, parsed STRAIGHT from the build `.sym`
 *  (bank:offset), not via SymbolMap. `SymbolMap.pc()`/`tryPc()` return a cart
 *  *file offset* (`snesToPC`) for the chunk-remap path — but asar `org`/`JSL`
 *  need the SNES address, and PC->SNES isn't uniquely invertible (LoROM and
 *  SuperFX-HiROM views share file offsets), so we read the SNES form directly.
 *  Prefers the project's own build `.sym`, falling back to the base build. */
function loadSnesAddrMap(projectId: string): Map<string, number> {
  const out = new Map<string, number>()
  const state = readExtractionState(frameworkWorkRoot())
  if (!state) return out
  const proj = symPair(projectBuildDir(projectId), state.romVersion)
  const pair = existsSync(proj.main) ? proj : symPair(buildOutputDir(), state.romVersion)
  for (const p of [pair.main, pair.fx]) {
    if (!existsSync(p)) continue
    let inLabels = false
    for (const raw of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const ci = raw.indexOf(';')
      const line = (ci >= 0 ? raw.slice(0, ci) : raw).trim()
      if (!line) continue
      if (line.startsWith('[') && line.endsWith(']')) { inLabels = line === '[labels]'; continue }
      if (!inLabels) continue
      const m = /^([0-9a-fA-F]{2}):([0-9a-fA-F]{4})\s+(\S+)/.exec(line)
      if (m && !out.has(m[3]!)) out.set(m[3]!, (parseInt(m[1]!, 16) << 16) | parseInt(m[2]!, 16))
    }
  }
  return out
}

/** Engine-label `--define`s for the enabled asm patches, as flat asar args.
 *
 *  asm patches assemble in the framework's FinalizeROM phase, which does NOT
 *  re-run the bank macros — so engine labels (CODE_/DATA_/etc.) are NOT in scope
 *  there and a raw `org $00E2D2` is the only option (hardcoded, drift-exposed).
 *  To let a patch instead write `org !CODE_00E2CC+$06` (drift-proof), we scan
 *  every enabled asm patch for `!<label>` tokens, resolve each to its SNES
 *  address in the build symbols, and emit `--define <label>=$ADDR` so the
 *  address tracks the current build — the asm analogue of label-form chunks.
 *
 *  Tokens that aren't engine labels (framework defines like `!RAM_*`/`!Define_*`,
 *  or a patch's own freecode labels, which are referenced without `!`) aren't in
 *  the symbol map and are simply left untouched. */
export function asmSymbolDefines(projectId: string): string[] {
  const patches = enabledAsmPatches(projectId)
  if (patches.length === 0) return []
  const addrs = loadSnesAddrMap(projectId)
  if (addrs.size === 0) return []
  const wanted = new Set<string>()
  for (const p of patches) {
    for (const line of p.asm.split('\n')) {
      const code = line.replace(/;.*$/, '') // strip comments so commented refs don't count
      for (const m of code.matchAll(/!([A-Za-z_][A-Za-z0-9_]*)/g)) wanted.add(m[1]!)
    }
  }
  const out: string[] = []
  for (const name of [...wanted].sort()) {
    const snes = addrs.get(name)
    if (snes === undefined) continue
    out.push('--define', `${name}=$${snes.toString(16).toUpperCase().padStart(6, '0')}`)
  }
  return out
}

// ── helpers ──────────────────────────────────────────────────────────────

function toU8(b: Buffer): Uint8Array {
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
}

function slugify(s: string): string {
  const slug = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'patch'
}

/** First free `<slug>` / `<slug>-2` / … not taken by this project. */
function uniqueId(projectId: string, slug: string): string {
  const taken = (id: string): boolean => projectPatch(projectId, id) !== null
  if (!taken(slug)) return slug
  for (let i = 2; ; i++) {
    const candidate = `${slug}-${i}`
    if (!taken(candidate)) return candidate
  }
}
