// Build-tree merge. When a project's overlay contains asm edits,
// asar can't shadow them via include paths (asm is read from cwd, not the
// `assets/yi` include search) — so we materialize a merged tree (pristine base
// ⊕ overlay) and run asar against that. Data-only overlays keep the cheaper
// include fast path in `buildRom`.
//
// Output lands in the BASE build dir so render/BizHawk read it unchanged.
// Per-project build output (so projects don't share one ROM) is a follow-up;
// until then, switching projects requires a rebuild to refresh the shared ROM.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { buildRom, type BuildResult } from 'snes-framework/build'
import { readExtractionState } from 'snes-framework/state'
import {
  applyGfxLayout,
  computeGfxGrowth,
  planGfxLayout,
  readArenaFill,
  relocateGfxBlobs
} from 'snes-framework/gfx-reinsert'
import {
  asarBinPath,
  buildTreeRoot,
  frameworkWorkRoot,
  overlayRoot,
  projectBuildDir
} from './framework-paths'
import {
  activeBoundaryMoves,
  activeDecoupled,
  activeFreeRegions,
  activeNewSlots,
  activePatchPoolGeometry,
  activeRelocations,
  activeRemovedLevels,
  applyActiveLevelDataLayout
} from './resources'
import {
  applyProjectPatches,
  asmSymbolDefines,
  enabledAsmPatches,
  getPatchPoolBytes,
  hasEnabledAsmPatches
} from './patches'
import { applyMap16Edits } from './map16-edits'
import { PATCH_POOL_DEFAULT_BYTES, type PatchPoolGeometry } from 'snes-framework/pool-map'
import type { LayoutViolation } from 'snes-framework/relocate'

const MERGE_STATE = '.merge-state.json'
const EXTRACTION_STATE = '.extraction-state.json'

interface MergeState {
  /** Cart MD5 of the base the tree was cloned from — re-clone if it changes. */
  baseCartMd5: string | null
  /** Fingerprint of the base source dirs (asm + assets) the tree was cloned
   *  from — re-clone if it changes. The cart MD5 alone misses this: in dev the
   *  base IS the live `snes-framework/` source tree, so asm edits (label
   *  renames, new banks) leave the cart untouched but must still invalidate the
   *  clone. Without it, a later boundary-move build refreshes the movable banks
   *  from current base while the rest of the tree stays frozen — producing a
   *  Frankenstein tree (e.g. a refreshed Bank12 referencing a renamed label that
   *  the stale Bank13 no longer defines → `Elabel_not_found`). */
  baseSig: string
  /** Overlay-relative paths stamped into the tree on the last merge. */
  stamped: string[]
}

/**
 * Cheap content fingerprint of the base dirs the tree clones (`global`, `yi`,
 * `assets`): file count + total size + newest mtime. Advances on any
 * add/remove/edit (mtime catches even same-length edits like a label rename), so
 * a stale clone re-clones. ~1–2k stats → a few ms; only the clone it gates is
 * expensive, and that only fires on a real change.
 */
function baseSignature(base: string): string {
  let count = 0
  let size = 0
  let maxMtimeMs = 0
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else {
        const st = statSync(p)
        count++
        size += st.size
        if (st.mtimeMs > maxMtimeMs) maxMtimeMs = st.mtimeMs
      }
    }
  }
  for (const dir of ['global', 'yi', 'assets']) {
    const root = join(base, dir)
    if (existsSync(root)) walk(root)
  }
  return `${count}:${size}:${Math.round(maxMtimeMs)}`
}

/** All file paths under `root`, relative to it (POSIX-style). */
function listFilesRecursive(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string, prefix: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isDirectory()) walk(join(dir, e.name), rel)
      else out.push(rel)
    }
  }
  if (existsSync(root)) walk(root, '')
  return out
}

function readMergeState(tree: string): MergeState | null {
  const p = join(tree, MERGE_STATE)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as MergeState
  } catch {
    return null
  }
}

/** True when the project overlay contains any asm (`yi/**`) edits. */
export function overlayHasAsm(id: string): boolean {
  return listFilesRecursive(join(overlayRoot(id), 'yi')).length > 0
}

/**
 * Materialize (or refresh) the project's merged build-tree = base ⊕ overlay.
 * Clones the base once (re-clones if the base cart changed), then incrementally
 * stamps overlay files and restores any file dropped from the overlay. Cheap
 * after the first clone — only the overlay diff is copied.
 */
export function materializeBuildTree(id: string): void {
  const base = frameworkWorkRoot()
  const tree = buildTreeRoot(id)
  const overlay = overlayRoot(id)
  const baseCartMd5 = readExtractionState(base)?.sourceCartMd5 ?? null
  const baseSig = baseSignature(base)

  const prev = readMergeState(tree)
  const needsClone =
    !existsSync(join(tree, 'yi')) ||
    !prev ||
    prev.baseCartMd5 !== baseCartMd5 ||
    prev.baseSig !== baseSig

  if (needsClone) {
    if (existsSync(tree)) rmSync(tree, { recursive: true, force: true })
    mkdirSync(tree, { recursive: true })
    // asar needs: yi/ (asm, the build cwd), global/ (entry AssembleFile), and
    // assets/yi/ (data via --include). buildRom reads romVersion from the
    // tree's extraction-state, so copy that too. asar.exe is referenced by an
    // absolute path, so it isn't cloned.
    for (const dir of ['global', 'yi', 'assets']) {
      const src = join(base, dir)
      if (existsSync(src)) cpSync(src, join(tree, dir), { recursive: true })
    }
    const stateSrc = join(base, EXTRACTION_STATE)
    if (existsSync(stateSrc)) cpSync(stateSrc, join(tree, EXTRACTION_STATE))
  }

  const prevStamped = needsClone ? [] : prev?.stamped ?? []
  const overlayFiles = listFilesRecursive(overlay)

  // Stamp the overlay over the tree.
  for (const rel of overlayFiles) {
    const dest = join(tree, rel)
    mkdirSync(dirname(dest), { recursive: true })
    cpSync(join(overlay, rel), dest)
  }

  // Restore (or remove) files that were stamped last time but are no longer in
  // the overlay — keeps the tree consistent when an edit is discarded.
  const overlaySet = new Set(overlayFiles)
  for (const rel of prevStamped) {
    if (overlaySet.has(rel)) continue
    const dest = join(tree, rel)
    const baseFile = join(base, rel)
    if (existsSync(baseFile)) cpSync(baseFile, dest)
    else if (existsSync(dest)) rmSync(dest)
  }

  writeFileSync(
    join(tree, MERGE_STATE),
    JSON.stringify({ baseCartMd5, baseSig, stamped: overlayFiles } satisfies MergeState, null, 2),
    'utf8'
  )
}

// ── asm patches → asar's YI_ApplyPatchesPostAssembly hook ────────────────────

const POOL_HEX = (n: number): string => '$' + n.toString(16).toUpperCase().padStart(6, '0')

/** Generate the Custom/Asar_Patches_YI.asm body that feeds the enabled patches'
 *  asm into the framework's hook. The asm goes in YI_ApplyPatchesPostAssembly
 *  (the FINAL build phase) — NOT YI_InsertIntegratedPatches: the multi-phase
 *  build re-fills free space in a pass that runs after InsertIntegratedPatches,
 *  so a patch placed there is partially clobbered, whereas post-assembly writes
 *  (org over the reserved pool) survive to the output ROM. (Verified end-to-end.)
 *
 *  Custom routines/data are placed by the `%patchcode`/`%patchdata` bump allocator
 *  over a reserved slice of FreeRegion51's tail — NOT asar `freecode`, which on
 *  this cart can't be confined to a safe region (it first-fits past the low free
 *  tails into bank $12's live $FF sentinels and the migration banks). The slice is `$FF`-reserved by Bank51's
 *  carved `%FREE_BYTES` (pool-map/relocate); the macros `org` over that `$FF` in
 *  the LoROM $23 view (CPU-executable — the same view asar's own freecode uses). */
function generateAsarPatchesAsm(
  patches: Array<{ id: string; asm: string }>,
  geo: PatchPoolGeometry
): string {
  const body = patches.map((p) => `;--- patch: ${p.id} ---\n${p.asm}`).join('\n\n')
  const overflowMsg =
    '"asm-patch pool overflow: the enabled patches need more than the reserved $51 slice"'
  return [
    "; AUTO-GENERATED by shiny-egg from the project's enabled asm patches.",
    '; Regenerated every build; hand edits are overwritten. Disabling the patches',
    '; (or clearing their `asm`) restores the byte-exact base.',
    '',
    'if !Define_Global_ApplyAsarPatches == !TRUE',
    '',
    '; ── asm-patch pool: a reserved slice of FreeRegion51\'s tail ──────────────',
    '; %patchcode/%patchdata bump-allocate custom routines/data into the slice',
    '; (addressed in the LoROM $23 view so the SNES CPU can JSL them). pushpc/pullpc',
    '; isolate the org so interleaved engine-address hijacks keep their own cursor.',
    `!PatchPool_Next = ${POOL_HEX(geo.loromStart)}`,
    `!PatchPool_End  = ${POOL_HEX(geo.loromEnd)}`,
    '',
    'macro patchcode()',
    'pushpc',
    'org !PatchPool_Next',
    'endmacro',
    '',
    'macro endpatchcode()',
    '!PatchPool_Next #= pc()',
    `assert pc() <= !PatchPool_End, ${overflowMsg}`,
    'pullpc',
    'endmacro',
    '',
    'macro patchdata()',
    '%patchcode()',
    'endmacro',
    '',
    'macro endpatchdata()',
    '%endpatchcode()',
    'endmacro',
    '',
    'macro YI_InsertIntegratedPatches()',
    'endmacro',
    '',
    'macro YI_ApplyPatchesPostAssembly()',
    body,
    'endmacro',
    'endif',
    ''
  ].join('\n')
}

/**
 * Static guard (REPLACES the post-build $50/$51 RATS-scan): reject any enabled
 * patch whose asm uses asar `freecode`/`freedata`/`freespace` (or `autoclean`,
 * which is meaningless without freespace and misreads live bytes as stale
 * freespace pointers). Those can't be confined on this cart — custom routines/data
 * must use the `%patchcode`/`%patchdata` bump allocator. Catches the mistake
 * before asar runs, at the source, with a precise pointer. Comments are stripped
 * so a `; freecode` mention doesn't trip it.
 */
function assertNoFreecodeInPatches(patches: Array<{ id: string; asm: string }>): void {
  const banned = /\b(freecode|freedata|freespace|autoclean)\b/
  for (const p of patches) {
    for (const raw of p.asm.split('\n')) {
      const code = raw.replace(/;.*$/, '')
      const m = banned.exec(code)
      if (m) {
        throw new Error(
          `Patch "${p.id}" uses asar '${m[1]}', which is unsafe on this cart — its ` +
            'freespace search first-fits into live data ($12 sentinels) and the ' +
            'migration banks. Place custom routines/data with the %patchcode / ' +
            '%patchdata bump allocator (reserved $51 slice) instead, and use plain ' +
            'JML/JSL (no autoclean) for hijacks.'
        )
      }
    }
  }
}

/** Flip `!Define_Global_ApplyAsarPatches` in the tree's ROM map(s) (targeted
 *  string replace — leaves the rest of the file, incl. any overlay edits, intact). */
function setApplyAsarPatchesDefine(treeRoot: string, enabled: boolean): void {
  for (const v of ['U1', 'U2']) {
    const p = join(treeRoot, 'yi', 'RomMap', `ROM_Map_YI_${v}.asm`)
    if (!existsSync(p)) continue
    const text = readFileSync(p, 'utf8').replace(
      /(!Define_Global_ApplyAsarPatches\s*=\s*!)(?:TRUE|FALSE)/,
      `$1${enabled ? 'TRUE' : 'FALSE'}`
    )
    writeFileSync(p, text, 'utf8')
  }
}

/**
 * Reconcile the build tree's asar-patch hook to the project's enabled `asm`
 * patches. ≥1 enabled → write the generated Custom/Asar_Patches_YI.asm (their
 * asm inside YI_ApplyPatchesPostAssembly) + set !Define_Global_ApplyAsarPatches
 * = !TRUE. None → restore the byte-exact base hook + set the define !FALSE
 * (undoes a prior asm-patch build). Called after materialize, before asar.
 * Returns the count assembled.
 */
export function applyEnabledAsmPatches(treeRoot: string, projectId: string | null): number {
  const patches = projectId ? enabledAsmPatches(projectId) : []
  const hookRel = join('yi', 'Custom', 'Asar_Patches_YI.asm')
  const hookPath = join(treeRoot, hookRel)
  if (patches.length === 0) {
    const baseHook = join(frameworkWorkRoot(), hookRel)
    if (existsSync(baseHook)) cpSync(baseHook, hookPath)
    setApplyAsarPatchesDefine(treeRoot, false)
    return 0
  }
  // Reject freecode/freespace before asar runs — custom routines/data go through
  // the %patchcode/%patchdata bump allocator over the reserved $51 slice.
  assertNoFreecodeInPatches(patches)
  // Patches exist ⇒ projectId is non-null (enabledAsmPatches needs it). Use the
  // project's configured pool size so the bump allocator + the reserved slice agree.
  const poolBytes = projectId ? getPatchPoolBytes(projectId) : PATCH_POOL_DEFAULT_BYTES
  const geo = activePatchPoolGeometry(poolBytes)
  if (!geo) {
    throw new Error(
      'Cannot place asm patches: the patch-pool geometry is unavailable (no built ' +
        'symbols / pool map yet). Build the base ROM once before enabling asm patches.'
    )
  }
  writeFileSync(hookPath, generateAsarPatchesAsm(patches, geo), 'utf8')
  setApplyAsarPatchesDefine(treeRoot, true)
  return patches.length
}

export interface BuildProjectOptions {
  id: string
  onProgress?: (msg: string) => void
}

/** One-line summary of layout-plan violations for the build-time backstop. The
 *  pre-build gate (checkActivePoolBudgets) normally surfaces these first with the
 *  same carve; this catches any that slip past (e.g. a direct buildProject call)
 *  rather than letting asar crash. */
function layoutViolationMessage(violations: LayoutViolation[]): string {
  const parts: string[] = []
  const regionFull = violations.filter((v) => v.kind === 'region-full')
  if (regionFull.length > 0) {
    const total = regionFull.reduce((n, v) => n + v.bytes, 0)
    parts.push(
      `free space is full — ${regionFull.length} blob(s) (${total} B) couldn't be relocated ` +
        `(${regionFull.map((v) => v.id).join(', ')})`
    )
  }
  for (const v of violations.filter((v) => v.kind === 'pool-over')) {
    parts.push(`level pool ${v.id} is ${v.bytes} B over budget`)
  }
  return (
    `Build aborted: ${parts.join('; ')}. Reduce the asm-patch pool size, ` +
    `un-migrate or shrink some levels, then rebuild.`
  )
}

/**
 * Build the active project's ROM. Hybrid: when the overlay has asm edits,
 * materialize the merged build-tree and assemble against it; otherwise use the
 * data-only include fast path against the pristine base. Output goes to the
 * base build dir either way (render/BizHawk read it).
 */
export function buildProject(opts: BuildProjectOptions): BuildResult {
  const { id, onProgress } = opts
  const outputDir = projectBuildDir(id)

  // A grown movable pool's boundary move, a free-space migration (delete +
  // region-append + reclaim), and a de-couple (materialise + Ptrs repoint) all
  // edit bank `.asm` — which asar reads from cwd, not the `--include` search — so
  // any of them forces the build-tree path (asm can't be shadowed via includes).
  const moves = activeBoundaryMoves()
  const relocations = activeRelocations()
  const decoupled = activeDecoupled()
  const newSlots = activeNewSlots()
  const removedLevels = activeRemovedLevels()
  const layoutEdits =
    moves.length + relocations.length + decoupled.length + newSlots.length + removedLevels.length
  // An enabled patch with an `asm` body must be assembled by asar, which reads
  // asm from cwd — so it forces the build-tree path too.
  const asmPatches = hasEnabledAsmPatches(id)

  // Graphics reinsert: edited blobs grow/shrink the gfx arena. A shrink (or no
  // change) rides the data-only include path; a growth needs the gfx arena's
  // `%FREE_BYTES` boundary moved — an asm edit, so it forces the build-tree path.
  const base = frameworkWorkRoot()
  const gfxGrowth = computeGfxGrowth(join(base, 'assets', 'yi'), join(overlayRoot(id), 'assets', 'yi'))
  const gfxPlan = planGfxLayout(gfxGrowth.growth, readArenaFill(join(base, 'yi')))
  // Growth (boundary move) or overflow (relocation) both edit bank asm → force
  // the build-tree path. A shrink/no-op rides the data-only include path.
  const gfxNeedsTree = gfxPlan.mode === 'boundary-move' || gfxPlan.mode === 'overflow'

  let result: BuildResult
  if (overlayHasAsm(id) || layoutEdits > 0 || asmPatches || gfxNeedsTree) {
    onProgress?.(
      layoutEdits > 0
        ? `Materializing build-tree (${moves.length} boundary move(s), ` +
          `${relocations.length} migration(s), ${decoupled.length} de-couple(s), ` +
          `${newSlots.length} new level(s), ${removedLevels.length} removed level(s))…`
        : asmPatches && !overlayHasAsm(id)
          ? 'Materializing build-tree (asm patches enabled)…'
          : 'Materializing build-tree (asm overlay present)…'
    )
    materializeBuildTree(id)
    // When asm patches are enabled, reserve the $51 patch-pool slice (project-
    // configured size) in the layout pass so migration's capacity is shrunk to match
    // the carve (it never first-fits into the slice). 0 ⇒ no carve ⇒ byte-exact base
    // for patch-free builds.
    const plan = applyActiveLevelDataLayout(buildTreeRoot(id), asmPatches ? getPatchPoolBytes(id) : 0)
    // Backstop: if a blob couldn't be placed (free space full) or a pool is still
    // over, abort with an actionable message rather than letting asar crash mid-
    // assembly with a cryptic bank-border assert. The pre-build gate
    // (checkActivePoolBudgets) normally catches this first with the same carve.
    if (plan && plan.violations.length > 0) {
      throw new Error(layoutViolationMessage(plan.violations))
    }
    // Graphics layout: a growth moves the arena boundary; an overflow spills the
    // edited blobs into the free regions (after the level-data layout above, so
    // the region appends stack on top of it). A shrink needs neither.
    if (gfxPlan.mode === 'boundary-move') {
      applyGfxLayout(join(buildTreeRoot(id), 'yi'), gfxPlan)
    } else if (gfxPlan.mode === 'overflow') {
      relocateGfxBlobs(join(buildTreeRoot(id), 'yi'), gfxGrowth.blobs, activeFreeRegions())
    }
    const asmCount = applyEnabledAsmPatches(buildTreeRoot(id), id)
    if (asmCount > 0) onProgress?.(`Assembling ${asmCount} asm patch(es) into the ROM…`)
    // Inject engine-label addresses (resolved from the build symbols) so asm
    // patches can reference `!CODE_xxxxxx` in the label-less FinalizeROM phase.
    const extraDefines = asmSymbolDefines(id)
    result = buildRom({
      workRoot: buildTreeRoot(id),
      asarBin: asarBinPath(),
      outputDir,
      extraDefines,
      onProgress
    })
  } else {
    result = buildRom({
      workRoot: frameworkWorkRoot(),
      asarBin: asarBinPath(),
      overlayRoot: overlayRoot(id),
      outputDir,
      onProgress
    })
  }

  // Post-build: apply the project's enabled custom patches to the finished ROM
  // (after asar + overlay). No-op + byte-exact when none are enabled.
  const report = applyProjectPatches(id, result)
  if (report) {
    onProgress?.(
      `Applied ${report.applied.length} patch(es): ${report.bytesWritten} byte(s) written` +
        (report.warnings.length ? `; ${report.warnings.length} warning(s)` : '')
    )
    for (const w of report.warnings) onProgress?.(`  ⚠ ${w}`)
  }

  // Post-build: apply the project's Map16 block-definition edits (size-neutral
  // 8-byte byte patches to the $4C region). No-op + byte-exact when none.
  const map16Report = applyMap16Edits(id, result)
  if (map16Report) {
    onProgress?.(
      `Applied ${map16Report.applied} Map16 block edit(s): ${map16Report.bytesWritten} byte(s)` +
        (map16Report.skipped.length ? `; ${map16Report.skipped.length} skipped` : '')
    )
  }
  return result
}
