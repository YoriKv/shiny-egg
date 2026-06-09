import { useCallback, useEffect, useState, type JSX } from 'react'
import type {
  PatchAuthoringPaths,
  PatchPoolSettings,
  PatchSummary,
  PrepackagedPatch
} from '../../../preload/api'

// Custom-patches panel. Lists the active project's local patches (toggle on/off,
// reorder) and the editor's prepackaged catalog (add into the project). Bypasses
// the save/undo system — every action persists immediately via IPC; changes that
// affect the built ROM call `onMutated` (→ markRomDirty). Patches apply post-build
// in list order (top → bottom), so a later patch overwrites an earlier one where
// they touch the same bytes — the user orders them to stack correctly. See
// src/main/patches.ts + research/plan-custom-patches.md.

// Display order of the prepackaged catalog's category headings. Categories not
// listed here (incl. patches with no category) sort after these, alphabetically,
// with the catch-all "Other" last. The categories themselves come from each
// prepackaged patch's `category` field in snes-framework/patches/*.json.
const CATEGORY_ORDER = [
  'Flutter! - Death Mechanics',
  'Flutter! - Skips and Speedups',
  'Flutter! - Misc',
  'Trisma - Improvements'
]
const OTHER_CATEGORY = 'Other'

/** Group the catalog by category, ordered by CATEGORY_ORDER then alphabetically
 *  ("Other" always last); patches within a group are sorted by name. */
function groupByCategory(
  catalog: PrepackagedPatch[]
): Array<{ category: string; patches: PrepackagedPatch[] }> {
  const byCat = new Map<string, PrepackagedPatch[]>()
  for (const c of catalog) {
    const cat = c.category ?? OTHER_CATEGORY
    ;(byCat.get(cat) ?? byCat.set(cat, []).get(cat)!).push(c)
  }
  const rank = (cat: string): number => {
    const i = CATEGORY_ORDER.indexOf(cat)
    if (i >= 0) return i
    return cat === OTHER_CATEGORY ? Number.MAX_SAFE_INTEGER : CATEGORY_ORDER.length
  }
  return [...byCat.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([category, patches]) => ({
      category,
      patches: [...patches].sort((x, y) => x.name.localeCompare(y.name))
    }))
}

/** Row tooltip: the description, with the source credit on its own line below
 *  it. The native `title` attribute renders `\n` as a line break. */
function patchTooltip(p: { description?: string; attribution?: string }): string | undefined {
  const lines = [p.description, p.attribution].filter(Boolean)
  return lines.length ? lines.join('\n') : undefined
}

/** The " · "-joined meta string for a patch row. Each segment is omitted when
 *  its count is 0, so a chunk-only patch shows just its chunks/bytes, an
 *  asm-only patch just its asm edits, and a mixed patch both. */
function patchMeta(p: { chunkCount?: number; totalBytes: number; asmCount: number }): string {
  const segs: string[] = []
  if (p.chunkCount !== undefined && p.chunkCount > 0) {
    segs.push(`${p.chunkCount} chunk${p.chunkCount === 1 ? '' : 's'} · ${p.totalBytes} B`)
  } else if (p.totalBytes > 0) {
    segs.push(`${p.totalBytes} B`)
  }
  if (p.asmCount > 0) segs.push(`${p.asmCount} asm edit${p.asmCount === 1 ? '' : 's'}`)
  return segs.join(' · ')
}

export interface PatchesBodyProps {
  /** Active project id (patches are per-project). Null → empty state. */
  projectId: string | null
  /** Called after a change that affects the next build (enable/disable, or
   *  removing an enabled patch) so the app marks the build dirty. */
  onMutated: () => void
}

export function PatchesBody({ projectId, onMutated }: PatchesBodyProps): JSX.Element {
  const [project, setProject] = useState<PatchSummary[]>([])
  const [catalog, setCatalog] = useState<PrepackagedPatch[]>([])
  const [paths, setPaths] = useState<PatchAuthoringPaths | null>(null)
  const [pool, setPool] = useState<PatchPoolSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    if (!projectId) { setProject([]); setCatalog([]); setPaths(null); setPool(null); return }
    const [p, c, ap, pp] = await Promise.all([
      window.shinyEgg.patches.listProject(),
      window.shinyEgg.patches.listPrepackaged(),
      window.shinyEgg.patches.authoringPaths(),
      window.shinyEgg.patches.getPatchPool()
    ])
    setProject(p)
    setCatalog(c)
    setPaths(ap)
    setPool(pp)
  }, [projectId])

  useEffect(() => { void refresh() }, [refresh])

  // Run a mutation, surface its error, refresh, and mark dirty when it changed
  // the built output.
  const run = useCallback(
    async (
      fn: () => Promise<{ ok: boolean; error?: string } | void>,
      dirty: boolean
    ): Promise<void> => {
      setBusy(true)
      setError(null)
      try {
        const r = await fn()
        if (r && 'ok' in r && !r.ok) { setError(r.error ?? 'Action failed.'); return }
        await refresh()
        if (dirty) onMutated()
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [refresh, onMutated]
  )

  const toggle = (id: string, enabled: boolean): Promise<void> =>
    run(() => window.shinyEgg.patches.setEnabled(id, enabled), true)
  const remove = (p: PatchSummary): Promise<void> =>
    run(() => window.shinyEgg.patches.remove(p.id), p.enabled)
  // Move the patch at `index` one step (dir -1 = up/earlier, +1 = down/later).
  // A reorder only changes the built ROM when it swaps two ENABLED patches —
  // disabled patches aren't applied, so stepping past one can't alter the output
  // (and so must not dirty the build).
  const move = (index: number, dir: -1 | 1): Promise<void> => {
    const target = index + dir
    if (target < 0 || target >= project.length) return Promise.resolve()
    const ids = project.map((p) => p.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    const dirty = project[index].enabled && project[target].enabled
    return run(() => window.shinyEgg.patches.reorder(ids), dirty)
  }
  // Adding a prepackaged patch enables it by default, so it affects the build.
  const add = (id: string): Promise<void> =>
    run(() => window.shinyEgg.patches.add(id), true)
  const importFiles = (): Promise<void> =>
    run(async () => {
      const res = await window.shinyEgg.patches.import()
      const failed = res.filter((r) => !r.ok)
      if (failed.length > 0) {
        return { ok: false, error: failed.map((f) => ('error' in f ? f.error : '')).filter(Boolean).join('; ') }
      }
    }, false)
  // Create a self-documenting template patch (disabled) + open the folder so the
  // user can edit it. Disabled-by-default → doesn't affect the build (dirty=false).
  const newPatch = (): Promise<void> =>
    run(async () => {
      const res = await window.shinyEgg.patches.newTemplate()
      if (res.ok) void window.shinyEgg.patches.openFolder()
      return res
    }, false)
  const openFolder = (): void => { void window.shinyEgg.patches.openFolder() }
  // Set the asm-patch pool size (KB). Optimistic local update for responsiveness;
  // the backend clamps + the refresh re-reads the committed value. Changing the
  // reserved slice changes the build layout, so it dirties the build.
  const changePoolKB = (kb: number): void => {
    if (!pool || Number.isNaN(kb)) return
    const snapped = Math.round(kb / pool.stepKB) * pool.stepKB
    const clamped = Math.min(pool.maxKB, Math.max(pool.minKB, snapped))
    setPool({ ...pool, kb: clamped })
    void run(() => window.shinyEgg.patches.setPatchPoolKB(clamped), true)
  }

  if (!projectId) {
    return <div className="se-patches se-patches--empty">No active project. Patches are stored per project.</div>
  }

  return (
    <div className="se-patches">
      <div className="se-patches__top">
        <div className="se-patches__actions">
          <button
            type="button"
            className="se-tool se-tool--reopen se-patches__btn"
            disabled={busy}
            onClick={() => void newPatch()}
            title="Create a self-documenting template patch to author your own, then open the folder to edit it"
          >
            New Patch
          </button>
          <button
            type="button"
            className="se-tool se-tool--reopen se-patches__btn"
            disabled={busy}
            onClick={() => void importFiles()}
            title="Import an .ips file into this project"
          >
            Import file…
          </button>
          <button
            type="button"
            className="se-tool se-tool--reopen se-patches__btn"
            onClick={openFolder}
            title="Open the project's patches folder to edit files directly"
          >
            Open folder
          </button>
        </div>
        {error && <div className="se-patches__error">{error}</div>}
      </div>

      <details className="se-patches__help">
        <summary>Authoring a patch — where to find code</summary>
        <p className="se-patches__help-text">
          Patches reference engine code by a raw address or an injected{' '}
          <code>!CODE_*</code> / <code>!RAM_*</code> label (the New Patch template
          documents the format). Find labels + addresses in the framework asm
          source; the label→address map is in the project build symbol files,
          regenerated on every build.
        </p>
        <dl className="se-patches__paths">
          <dt>Source asm</dt>
          <dd>
            <code className="se-patches__path" title={paths?.asmDir}>
              {paths?.asmDir ?? '…'}
            </code>
            <button
              type="button"
              className="se-patches__pathopen"
              onClick={() => void window.shinyEgg.patches.openAuthoringFolder('asm')}
            >
              Open
            </button>
          </dd>
          <dt>Symbol files</dt>
          <dd>
            {paths?.symDir ? (
              <>
                <code className="se-patches__path" title={paths.symDir}>
                  {paths.symDir}
                </code>
                <button
                  type="button"
                  className="se-patches__pathopen"
                  onClick={() => void window.shinyEgg.patches.openAuthoringFolder('sym')}
                >
                  Open
                </button>
                {paths.symFiles.length === 0 && (
                  <span className="se-patches__help-note">build the project to generate</span>
                )}
              </>
            ) : (
              <span className="se-patches__help-note">no active project</span>
            )}
          </dd>
        </dl>
      </details>

      <div className="se-patches__section-title">In this project</div>
      {project.length === 0 ? (
        <div className="se-patches__empty">None yet — add a prepackaged patch below or import a file.</div>
      ) : (
        <>
          <ul className="se-patches__list">
            {project.map((p, i) => (
              <li key={p.id} className="se-patches__row" title={patchTooltip(p)}>
                <label className="se-patches__check">
                  <input
                    type="checkbox"
                    checked={p.enabled}
                    disabled={busy}
                    onChange={(e) => void toggle(p.id, e.target.checked)}
                  />
                  <span className="se-patches__name">{p.name}</span>
                </label>
                <span className="se-patches__meta">{patchMeta(p)}</span>
                <span className="se-patches__reorder">
                  <button
                    type="button"
                    className="se-patches__move"
                    title="Move up — applied earlier"
                    disabled={busy || i === 0}
                    onClick={() => void move(i, -1)}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="se-patches__move"
                    title="Move down — applied later (wins where patches overlap)"
                    disabled={busy || i === project.length - 1}
                    onClick={() => void move(i, 1)}
                  >
                    ▼
                  </button>
                </span>
                {p.source === 'user' ? (
                  // User-authored patches have no re-add path (not in the prepackaged
                  // catalog, no source .ips), so don't offer a one-click delete that
                  // would be unrecoverable — they're removed by deleting the file.
                  <span
                    className="se-patches__xspacer"
                    title="User patch — to delete, remove its file via Open folder"
                  />
                ) : (
                  <button
                    type="button"
                    className="se-patches__x"
                    title="Remove from project"
                    disabled={busy}
                    onClick={() => void remove(p)}
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
          {project.length > 1 && (
            <div className="se-patches__order-hint">
              Applied top → bottom · later patches win where they overlap
            </div>
          )}
          {pool && (
            <>
              <div className="se-patches__poolsize">
                <label htmlFor="se-patch-pool-kb">Asm-patch pool</label>
                <input
                  id="se-patch-pool-kb"
                  type="number"
                  min={pool.minKB}
                  max={pool.maxKB}
                  step={pool.stepKB}
                  value={pool.kb}
                  disabled={busy}
                  onChange={(e) => changePoolKB(parseFloat(e.target.value))}
                />
                <span className="se-patches__poolsize-unit">KB</span>
              </div>
              <div className="se-patches__poolsize-hint">
                Space reserved off the SuperFX free region for hand-authored asm
                routines — only used when an asm patch is enabled. Larger leaves
                less room for relocated level data ({pool.minKB}–{pool.maxKB} KB).
              </div>
            </>
          )}
        </>
      )}

      <div className="se-patches__section-title">Prepackaged</div>
      {catalog.length === 0 ? (
        <div className="se-patches__empty">No prepackaged patches.</div>
      ) : (
        groupByCategory(catalog).map((group) => (
          <div key={group.category} className="se-patches__group">
            <div className="se-patches__group-title">{group.category}</div>
            <ul className="se-patches__list">
              {group.patches.map((c) => (
                <li key={c.id} className="se-patches__row" title={patchTooltip(c)}>
                  <span className="se-patches__name">{c.name}</span>
                  <span className="se-patches__meta">
                    {patchMeta({ totalBytes: c.totalBytes, asmCount: c.asmCount })}
                  </span>
                  {c.added ? (
                    <span className="se-patches__added">added</span>
                  ) : (
                    <button
                      type="button"
                      className="se-tool se-tool--reopen se-patches__btn"
                      disabled={busy}
                      onClick={() => void add(c.id)}
                      title="Add to this project (enabled by default)"
                    >
                      Add
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

    </div>
  )
}
