// Central save/dirty coordinator for the editor's disconnected tools (level
// editor, future string editor, …). Each tool keeps its own state and
// registers a uniform handle via `useEditDocument`; the session aggregates
// dirty state and orchestrates save-all / discard-all. See
// research/plan-project-storage.md §"Shared edit state across tools".

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode
} from 'react'

export interface EditDocumentHandle {
  /** Persist this document's edits to the overlay; resolves true on success. */
  save: () => Promise<boolean>
  /** Revert this document's edits to its last-saved baseline. */
  discard: () => void
}

export interface EditSessionApi {
  /** True when any registered document has unsaved edits. */
  anyDirty: boolean
  /** Keys of the currently-dirty documents. */
  dirtyKeys: string[]
  /** Save every dirty document. Resolves true only if all succeeded. */
  saveAll: () => Promise<boolean>
  /** Discard edits in every dirty document. */
  discardAll: () => void
  // Internal plumbing for useEditDocument.
  _register: (key: string, handle: EditDocumentHandle) => void
  _unregister: (key: string) => void
  _setDirty: (key: string, dirty: boolean) => void
}

const Ctx = createContext<EditSessionApi | null>(null)

export function EditSessionProvider({
  children
}: {
  children: ReactNode
}): JSX.Element {
  // Handles live in a ref — their save/discard fns change every render, but
  // that shouldn't re-render consumers. Only the dirty SET is reactive.
  const handles = useRef(new Map<string, EditDocumentHandle>())
  const [dirty, setDirty] = useState<ReadonlySet<string>>(() => new Set())
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  const _register = useCallback((key: string, handle: EditDocumentHandle) => {
    handles.current.set(key, handle)
  }, [])

  const _unregister = useCallback((key: string) => {
    handles.current.delete(key)
    setDirty((prev) => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }, [])

  const _setDirty = useCallback((key: string, isDirty: boolean) => {
    setDirty((prev) => {
      if (prev.has(key) === isDirty) return prev
      const next = new Set(prev)
      if (isDirty) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  const saveAll = useCallback(async (): Promise<boolean> => {
    let allOk = true
    // Snapshot the dirty set at call time; tools flip clean asynchronously.
    for (const key of dirtyRef.current) {
      const ok = await handles.current.get(key)?.save()
      if (ok === false) allOk = false
    }
    return allOk
  }, [])

  const discardAll = useCallback((): void => {
    for (const key of dirtyRef.current) handles.current.get(key)?.discard()
  }, [])

  const api = useMemo<EditSessionApi>(
    () => ({
      anyDirty: dirty.size > 0,
      dirtyKeys: Array.from(dirty),
      saveAll,
      discardAll,
      _register,
      _unregister,
      _setDirty
    }),
    [dirty, saveAll, discardAll, _register, _unregister, _setDirty]
  )

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useEditSession(): EditSessionApi {
  const ctx = useContext(Ctx)
  if (!ctx) {
    throw new Error('useEditSession must be used within an EditSessionProvider')
  }
  return ctx
}

/**
 * Register an editing tool's document with the session. `dirty` is the tool's
 * current unsaved state; `save`/`discard` operate on it. The tool keeps its own
 * state — this only exposes a uniform handle for save-all / discard-all and the
 * unsaved-changes prompt.
 */
export function useEditDocument(
  key: string,
  doc: { dirty: boolean; save: () => Promise<boolean>; discard: () => void }
): void {
  // Pull the STABLE registry fns (each a `useCallback([])` — referentially
  // constant) rather than depending on the whole session object, which is
  // recreated whenever the dirty set changes. Depending on `session` here
  // caused an effect ↔ setState loop: register/unregister/setDirty re-ran on
  // every dirty change, and each of those mutates the dirty set → infinite.
  const { _register, _unregister, _setDirty } = useEditSession()
  // Keep the latest save/discard reachable without re-registering each render.
  const docRef = useRef(doc)
  docRef.current = doc

  useEffect(() => {
    _register(key, {
      save: () => docRef.current.save(),
      discard: () => docRef.current.discard()
    })
    return () => _unregister(key)
  }, [key, _register, _unregister])

  useEffect(() => {
    _setDirty(key, doc.dirty)
  }, [key, _setDirty, doc.dirty])
}
