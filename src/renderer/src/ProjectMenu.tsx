import { useEffect, useState, type JSX } from 'react'
import type { ProjectInfo, ProjectSummary } from '../../preload/api'
import { useDropdown } from './hooks/useDropdown'
import { DiscardChangesModal } from './DiscardChangesModal'
import { HelpDialog } from './HelpDialog'
import { ImportRomDialog } from './ImportRomDialog'
import { ImportGbaDialog } from './ImportGbaDialog'
import { AboutBody, LEVEL_EDITOR_HELP } from './app-help'
import { useEditSession } from './edit-session/EditSession'

interface ProjectMenuProps {
  current: ProjectSummary | null
  /** Fired after a project op so App updates the trigger. `switched` is true
   *  when the *active* project changed (new / open / delete) — App clears the
   *  level selection to reload — and false for an in-place rename. */
  onChange: (p: ProjectSummary, switched: boolean) => void
  /** Fired after a successful ROM import so App marks the build dirty + reloads
   *  the current level (its overlay may have just been overwritten).
   *  `removedVanillaIds` = records the optional post-import "remove all vanilla
   *  levels" pass took out (empty/absent when the option was off). */
  onImported: (removedVanillaIds?: number[]) => void
}

// Mirror of the main-side name rule (src/main/projects.ts isValidProjectName):
// lowercase ascii + digits + "-"/"_", must start alphanumeric, ≤64 chars.
// Used for live feedback; the backend enforces it authoritatively.
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return i >= 0 ? p.slice(i + 1) : p
}

export function ProjectMenu({ current, onChange, onImported }: ProjectMenuProps): JSX.Element {
  const { anyDirty, dirtyKeys, saveAll, discardAll } = useEditSession()

  const { open, setOpen, containerRef } = useDropdown()
  const [view, setView] = useState<'list' | 'info'>('list')
  const [importOpen, setImportOpen] = useState(false)
  const [importGbaOpen, setImportGbaOpen] = useState(false)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [info, setInfo] = useState<ProjectInfo | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  // A project switch / create held behind the unsaved-changes modal; the stored
  // thunk runs on Save (after a successful save-all) or Discard.
  const [pending, setPending] = useState<(() => Promise<void>) | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // App-level help/about dialogs (reuse the panel HelpDialog system).
  const [appDialog, setAppDialog] = useState<'editor-help' | 'about' | null>(null)



  // Each open resets to the list view and refreshes the project list.
  useEffect(() => {
    if (!open) return
    setView('list')
    setStatus(null)
    void window.shinyEgg.projects.list().then(setProjects)
  }, [open])

  async function refreshList(): Promise<void> {
    setProjects(await window.shinyEgg.projects.list())
  }

  // Run `action` now, or hold it behind the unsaved-changes modal when dirty.
  function guard(action: () => Promise<void>): void {
    if (anyDirty) {
      setStatus(null)
      setPending(() => action)
    } else {
      void action()
    }
  }

  async function doNew(): Promise<void> {
    setBusy(true)
    setStatus(null)
    try {
      onChange(await window.shinyEgg.projects.create(), true)
      await refreshList()
    } catch (err) {
      setStatus((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function doOpen(id: string): Promise<void> {
    setBusy(true)
    setStatus(null)
    try {
      onChange(await window.shinyEgg.projects.switch(id), true)
      setOpen(false)
    } catch (err) {
      setStatus((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function onNew(): void {
    guard(doNew)
  }

  function onOpen(id: string): void {
    if (id === current?.id) {
      setOpen(false)
      return
    }
    guard(() => doOpen(id))
  }

  async function onModalSave(): Promise<void> {
    const action = pending
    if (!action || busy) return
    setBusy(true)
    try {
      const ok = await saveAll()
      if (!ok) {
        setStatus('Save failed — changes were not switched.')
        return
      }
      setPending(null)
      await action()
    } finally {
      setBusy(false)
    }
  }

  async function onModalDiscard(): Promise<void> {
    const action = pending
    if (!action || busy) return
    discardAll()
    setPending(null)
    await action()
  }

  async function onSaveAll(): Promise<void> {
    if (busy || !anyDirty) return
    setBusy(true)
    setStatus('Saving…')
    try {
      const ok = await saveAll()
      setStatus(ok ? 'All changes saved.' : 'Some changes failed to save.')
    } finally {
      setBusy(false)
    }
  }

  async function openInfo(): Promise<void> {
    if (!current) return
    setStatus(null)
    setView('info')
    setRenameValue(current.name)
    setInfo(null)
    const i = await window.shinyEgg.projects.info(current.id)
    setInfo(i)
    setRenameValue(i.name)
  }

  async function onRename(): Promise<void> {
    if (!current || busy) return
    const next = renameValue.trim()
    if (next === current.name || !NAME_RE.test(next)) return
    setBusy(true)
    setStatus(null)
    try {
      const r = await window.shinyEgg.projects.rename(current.id, next)
      if (r.ok) {
        onChange(r.project, false)
        await refreshList()
        setView('list')
      } else {
        setStatus(r.error)
      }
    } catch (err) {
      setStatus((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function onDelete(): Promise<void> {
    if (!current || busy) return
    setBusy(true)
    setStatus(null)
    try {
      const r = await window.shinyEgg.projects.delete(current.id)
      if (r.ok) {
        setConfirmingDelete(false)
        onChange(r.current, true)
        await refreshList()
        setView('list')
      } else {
        setStatus(r.error)
      }
    } catch (err) {
      setStatus((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function onExport(): Promise<void> {
    if (!current || busy) return
    setBusy(true)
    setStatus('Building…')
    try {
      const r = await window.shinyEgg.projects.export(current.id)
      if (r.ok) setStatus(`Exported → ${baseName(r.savedPath)}`)
      else if ('canceled' in r) setStatus('Export canceled.')
      else setStatus(`Export failed: ${r.error}`)
    } finally {
      setBusy(false)
    }
  }

  async function onOpenFolder(): Promise<void> {
    if (!current) return
    await window.shinyEgg.projects.openFolder(current.id)
  }

  const trimmed = renameValue.trim()
  const renameOk = !!current && trimmed !== current.name && NAME_RE.test(trimmed)

  return (
    <div className="se-rommenu" ref={containerRef}>
      <button
        type="button"
        className={`se-rommenu__trigger${open ? ' is-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Project menu"
      >
        <span className="se-projmenu__label">
          <span className="se-projmenu__kicker">Project</span>
          <span className="se-projmenu__name">{current?.name ?? '—'}</span>
        </span>
        <svg
          className="se-rommenu__chevron"
          viewBox="0 0 10 6"
          width="10"
          height="6"
        >
          <path d="M1 1 L5 5 L9 1" stroke="currentColor" strokeWidth="1.25" fill="none" />
        </svg>
      </button>

      {open && (
        <div className="se-rommenu__pop se-projmenu__pop">
          {view === 'list' ? (
            <>
              <section className="se-pop__section se-projmenu__menu">
                <button
                  type="button"
                  className="se-menuitem is-primary"
                  onClick={onNew}
                  disabled={busy}
                >
                  New project
                </button>
              </section>

              <section className="se-pop__section">
                <h3 className="se-pop__h">Open project</h3>
                {projects.length === 0 ? (
                  <p className="se-pop__empty">No projects yet.</p>
                ) : (
                  <div className="se-pop__list">
                    {projects.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`se-proj${p.id === current?.id ? ' is-current' : ''}`}
                        onClick={() => onOpen(p.id)}
                        disabled={busy}
                      >
                        <span className="se-proj__name">{p.name}</span>
                        {p.id === current?.id && (
                          <span className="se-proj__meta">current</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="se-pop__section se-projmenu__menu">
                <button
                  type="button"
                  className="se-menuitem"
                  onClick={() => void onSaveAll()}
                  disabled={busy || !anyDirty}
                >
                  {anyDirty ? `Save all (${dirtyKeys.length})` : 'Save all'}
                </button>
                <button
                  type="button"
                  className="se-menuitem"
                  onClick={() => void openInfo()}
                  disabled={busy || !current}
                >
                  Project info
                </button>
                <button
                  type="button"
                  className="se-menuitem"
                  onClick={() => void onExport()}
                  disabled={busy || !current}
                >
                  Export…
                </button>
                <button
                  type="button"
                  className="se-menuitem"
                  onClick={() => void onOpenFolder()}
                  disabled={busy || !current}
                >
                  Open folder
                </button>
                <button
                  type="button"
                  className="se-menuitem"
                  onClick={() => {
                    setOpen(false)
                    setImportOpen(true)
                  }}
                  disabled={busy || !current}
                >
                  Import from ROM…
                </button>
                <button
                  type="button"
                  className="se-menuitem"
                  onClick={() => {
                    setOpen(false)
                    setImportGbaOpen(true)
                  }}
                  disabled={busy || !current}
                >
                  Import from GBA…
                </button>
              </section>

              <section className="se-pop__section se-projmenu__menu se-projmenu__menu--divided">
                <button
                  type="button"
                  className="se-menuitem"
                  onClick={() => {
                    setOpen(false)
                    setAppDialog('editor-help')
                  }}
                >
                  Level Editor help
                </button>
                <button
                  type="button"
                  className="se-menuitem"
                  onClick={() => {
                    setOpen(false)
                    setAppDialog('about')
                  }}
                >
                  About Shiny Egg
                </button>
              </section>
            </>
          ) : (
            <>
              <section className="se-pop__section">
                <button
                  type="button"
                  className="se-projmenu__back"
                  onClick={() => {
                    setView('list')
                    setStatus(null)
                  }}
                >
                  ← Back
                </button>
                <h3 className="se-pop__h">Project info</h3>
                {info ? (
                  <p className="se-pop__status">
                    <span className="se-pop__status-main">{info.name}</span>
                    <span className="se-meta se-pop__status-meta">
                      created {formatTimestamp(info.createdAt)} · modified{' '}
                      {formatTimestamp(info.modifiedAt)}
                      {info.romVersion ? ` · ${info.romVersion}` : ''}
                    </span>
                    {info.baseMismatch && (
                      <span className="se-projmenu__warn">
                        ⚠ Bound to a different cart than is currently extracted —
                        saving is blocked until you re-extract the matching cart.
                      </span>
                    )}
                  </p>
                ) : (
                  <p className="se-pop__empty">Loading…</p>
                )}
              </section>

              <section className="se-pop__section">
                <h3 className="se-pop__h">Modified files</h3>
                {info && info.files.length > 0 ? (
                  <div className="se-pop__list se-projmenu__files">
                    {info.files.map((f) => (
                      <div key={f} className="se-projmenu__file">
                        {f}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="se-pop__empty">No changes yet.</p>
                )}
              </section>

              <section className="se-pop__section">
                <h3 className="se-pop__h">Rename</h3>
                <input
                  className="se-input se-projmenu__input"
                  value={renameValue}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && renameOk) void onRename()
                  }}
                  placeholder="lowercase-name"
                />
                <p className="se-projmenu__hint">
                  Lowercase letters, digits, “-” or “_”. No spaces.
                </p>
                <div className="se-projmenu__formrow">
                  <button
                    type="button"
                    className="se-btn is-primary"
                    onClick={() => void onRename()}
                    disabled={busy || !renameOk}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="se-btn is-danger"
                    onClick={() => {
                      setStatus(null)
                      setConfirmingDelete(true)
                    }}
                    disabled={busy}
                  >
                    Delete…
                  </button>
                </div>
              </section>
            </>
          )}

          {status && !pending && !confirmingDelete && (
            <section className="se-pop__section se-pop__section--log">
              <p className="se-projmenu__status">{status}</p>
            </section>
          )}
        </div>
      )}

      <DiscardChangesModal
        open={pending !== null}
        title="Unsaved changes"
        body={`Save your changes to “${current?.name ?? 'this project'}” before switching projects?`}
        error={status}
        saving={busy}
        onSave={() => void onModalSave()}
        onDiscard={() => void onModalDiscard()}
        onCancel={() => {
          setPending(null)
          setStatus(null)
        }}
      />

      <DiscardChangesModal
        open={confirmingDelete && current !== null}
        title="Delete project"
        body={`Permanently delete “${current?.name ?? ''}” and all its changes? This can’t be undone.`}
        confirmLabel="Delete"
        danger
        error={status}
        saving={busy}
        onDiscard={() => void onDelete()}
        onCancel={() => {
          setConfirmingDelete(false)
          setStatus(null)
        }}
      />

      <HelpDialog
        open={appDialog === 'editor-help'}
        title="Level Editor — Help"
        onClose={() => setAppDialog(null)}
      >
        {LEVEL_EDITOR_HELP}
      </HelpDialog>

      <HelpDialog
        open={appDialog === 'about'}
        title="About Shiny Egg"
        onClose={() => setAppDialog(null)}
      >
        <AboutBody />
      </HelpDialog>

      <ImportRomDialog
        open={importOpen}
        projectName={current?.name ?? null}
        onClose={() => setImportOpen(false)}
        onImported={onImported}
      />

      <ImportGbaDialog
        open={importGbaOpen}
        projectName={current?.name ?? null}
        onClose={() => setImportGbaOpen(false)}
        onImported={() => onImported()}
      />
    </div>
  )
}
