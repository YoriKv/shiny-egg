import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type Dispatch,
  type JSX,
  type SetStateAction
} from 'react'
import { useDropdown } from './hooks/useDropdown'
import type {
  CartIdentification,
  ExtractFreshness,
  ExtractionState,
  RomVersion
} from '../../preload/api'
import { refreshLevelsCatalog } from './data/levels'

const VERSION_LABELS: Record<RomVersion, string> = {
  YI_U1: 'USA V1.0',
  YI_U2: 'USA V1.1',
  YI_E1: 'Europe V1.0',
  YI_E2: 'Europe V1.1',
  YI_J1: 'Japan V1.0',
  YI_J2: 'Japan V1.1',
  YI_J3: 'Japan V1.2'
}

type Operation = 'extract' | 'build' | null

function fileBaseName(p: string): string {
  const sep = p.lastIndexOf('\\') >= 0 ? '\\' : '/'
  const i = p.lastIndexOf(sep)
  return i >= 0 ? p.slice(i + 1) : p
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

export interface RomMenuProps {
  state: ExtractionState | null
  setState: (s: ExtractionState | null) => void
  /** Out-of-date-extract verdict (App refreshes it with `state`). When stale,
   *  the Status section prompts a re-extract. */
  freshness: ExtractFreshness | null
  refreshState: () => Promise<void>
  log: string[]
  setLog: Dispatch<SetStateAction<string[]>>
  running: Operation
  setRunning: (op: Operation) => void
  /** Called after a manual build succeeds so App can clear its
   *  "needs rebuild" flag (otherwise Test Level would rebuild again). */
  onBuildSuccess?: () => void
  /** Called when a build fails so App can keep its "needs rebuild" flag set —
   *  the next Test Level / Launch must rebuild rather than boot a stale ROM. */
  onBuildFailure?: () => void
  /** Bumped by App to request the menu open its log popover (e.g. to surface a
   *  build failure that happened during Test Level / Launch). */
  requestOpen?: number
}

export function RomMenu({
  state,
  freshness,
  refreshState,
  log,
  setLog,
  running,
  setRunning,
  onBuildSuccess,
  onBuildFailure,
  requestOpen
}: RomMenuProps): JSX.Element {
  const { open, setOpen, containerRef } = useDropdown()
  const [pending, setPending] = useState<CartIdentification | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const logRef = useRef<HTMLDivElement>(null)


  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log])

  // App can request the popover open (e.g. to show a build failure from Test
  // Level / Launch). `requestOpen` is a bumped counter; ignore the initial 0.
  useEffect(() => {
    if (requestOpen) setOpen(true)
  }, [requestOpen])

  function startOp(op: Operation, initialLine: string): void {
    setRunning(op)
    setLog([initialLine])
  }

  function append(line: string): void {
    setLog((l) => [...l, line])
  }

  async function identifyFile(file: File): Promise<void> {
    const cartPath = window.shinyEgg.getPathForFile(file)
    if (!cartPath) {
      append('Could not resolve a filesystem path for the dropped file.')
      return
    }
    try {
      const ident = await window.shinyEgg.identifyCart(cartPath)
      setPending(ident)
      // First-run convenience: with no assets yet, a recognized cart extracts
      // immediately (no separate Extract click). Re-extracts (assets already
      // present) stay manual.
      if (!state && ident.romVersion) await runExtract(ident)
    } catch (err) {
      append(`Identify failed: ${(err as Error).message}`)
    }
  }

  async function onDrop(e: DragEvent<HTMLDivElement>): Promise<void> {
    e.preventDefault()
    setDragOver(false)
    if (running) return
    const file = e.dataTransfer.files[0]
    if (file) await identifyFile(file)
  }

  async function onFileInput(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    if (file) await identifyFile(file)
    e.target.value = ''
  }

  async function runExtract(cart?: CartIdentification): Promise<void> {
    const target = cart ?? pending
    if (running || !target?.romVersion) return
    startOp('extract', `Extracting ${VERSION_LABELS[target.romVersion]}…`)
    try {
      const result = await window.shinyEgg.extract({
        romVersion: target.romVersion,
        referenceCartPath: target.path
      })
      append(`Extracted ${result.extracted} files (${result.empty} empty).`)
      // Pull the freshly emitted levels.json into the renderer-side store
      // so the level dropdown reflects the new cart's name table.
      await refreshLevelsCatalog()
      setPending(null)
      await refreshState()
    } catch (err) {
      append(`Extract failed: ${(err as Error).message}`)
    } finally {
      setRunning(null)
    }
  }

  async function runBuild(): Promise<void> {
    if (running || !state) return
    startOp('build', `Building ${VERSION_LABELS[state.romVersion]}…`)
    try {
      const result = await window.shinyEgg.build()
      append(`Built → ${fileBaseName(result.outputPath)}`)
      onBuildSuccess?.()
    } catch (err) {
      append(`Build failed: ${(err as Error).message}`)
      onBuildFailure?.()
    } finally {
      setRunning(null)
    }
  }

  const triggerLabel = state ? VERSION_LABELS[state.romVersion] : 'No assets'

  return (
    <div className="se-rommenu" ref={containerRef}>
      <button
        type="button"
        className={`se-rommenu__trigger${open ? ' is-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`se-rommenu__dot${state ? ' is-ready' : ' is-empty'}`} />
        <span className="se-rommenu__label">{triggerLabel}</span>
        {running && <span className="se-rommenu__spinner" />}
        <svg
          className="se-rommenu__chevron"
          viewBox="0 0 10 6"
          width="10"
          height="6"
        >
          <path
            d="M1 1 L5 5 L9 1"
            stroke="currentColor"
            strokeWidth="1.25"
            fill="none"
          />
        </svg>
      </button>

      {open && (
        <div className="se-rommenu__pop">
          <section className="se-pop__section">
            <h3 className="se-pop__h">Status</h3>
            {state ? (
              <p className="se-pop__status">
                <span className="se-pop__status-main">
                  {VERSION_LABELS[state.romVersion]}
                </span>
                <span className="se-meta se-pop__status-meta">
                  {state.extractedFiles.toLocaleString()} files ·{' '}
                  {formatTimestamp(state.extractedAt)}
                </span>
              </p>
            ) : (
              <p className="se-pop__empty">
                No reference cart has been extracted yet.
              </p>
            )}
            {state && freshness?.status === 'stale' && (
              <p className="se-detect is-bad" title={freshness.reasons.join('\n')}>
                Extracted data is out of date — re-extract the reference cart.
              </p>
            )}
          </section>

          <section className="se-pop__section">
            <h3 className="se-pop__h">Reference cart</h3>
            <div
              className={`se-drop${dragOver ? ' is-over' : ''}${
                running ? ' is-disabled' : ''
              }`}
              onDragOver={(e) => {
                e.preventDefault()
                if (!running) setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => !running && fileInputRef.current?.click()}
            >
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path
                  d="M12 3 L12 15 M7 10 L12 15 L17 10 M4 19 L20 19"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>Drop a YI USA v1.0 cart here, or click to browse</span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".sfc,.smc"
              onChange={onFileInput}
              style={{ display: 'none' }}
            />

            {pending && (
              <p
                className={`se-detect${
                  pending.romVersion ? ' is-ok' : ' is-bad'
                }`}
              >
                {pending.romVersion ? (
                  <>
                    <strong>{VERSION_LABELS[pending.romVersion]}</strong>{' '}
                    detected — {fileBaseName(pending.path)}
                  </>
                ) : (
                  <>
                    Unrecognized cart ({fileBaseName(pending.path)}). Only USA
                    V1.0 and V1.1 are supported.
                  </>
                )}
              </p>
            )}
          </section>

          <section className="se-pop__section">
            <div className="se-pop__ops">
              <button
                type="button"
                className="se-btn is-primary"
                onClick={() => runExtract()}
                disabled={running !== null || !pending?.romVersion}
              >
                {running === 'extract' ? 'Extracting…' : 'Extract'}
              </button>
              <button
                type="button"
                className="se-btn"
                onClick={runBuild}
                disabled={running !== null || !state}
              >
                {running === 'build' ? 'Building…' : 'Build'}
              </button>
            </div>
          </section>

          {log.length > 0 && (
            <section className="se-pop__section se-pop__section--log">
              <h3 className="se-pop__h">Log</h3>
              <div className="se-pop__log" ref={logRef}>
                {log.map((line, i) => (
                  <div className="se-pop__logline" key={i}>
                    {line}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
