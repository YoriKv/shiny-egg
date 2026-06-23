import { useCallback, useMemo, useState, type JSX } from 'react'
import { markupByteSize } from 'snes-framework/msg-markup'
import type {
  MarkupToken,
  MessagePtrOption,
  MessagePtrTableModel,
  StringTableModel
} from '../../../preload/api'
import { useOverlayDocument, type DocHistory } from '../edit-session/useOverlayDocument'
import { useCommitOnBlur } from '../hooks/useCommitOnBlur'

export interface StringsEditorState {
  /** Resource id (the `;@editable` marker id) — also the EditSession key suffix. */
  id: string
  /** Tab label. */
  title: string
  model: StringTableModel | null
  status: string
  error: string | null
  saveError: string | null
  saving: boolean
  dirty: boolean
  /** Bytes used / budget. For the line model 1 char = 1 font byte; for the markup
   *  model the encoded byte size (markupByteSize) — NOT the raw char count. */
  usedBytes: number
  budgetBytes: number
  overBudget: boolean
  hasInvalid: boolean
  allowed: ReadonlySet<string>
  editLine: (entryIdx: number, lineIdx: number, value: string) => void
  /** Edit a markup-model entry's whole markup string (message-text region). */
  editMarkup: (entryIdx: number, value: string) => void
  save: () => Promise<boolean>
  /** Revert the draft to the last-saved baseline (the close-prompt "Discard"). */
  discard: () => void
}

/**
 * Owns one string table's editing state. Called once per table at App level (NOT
 * inside the floating window) so the draft + EditSession registration survive the
 * window being closed and tab switches — closing/switching must not drop unsaved
 * edits, and "Save all" / the switch prompt must see them. Reloads on project
 * change (switch = reload). `onSaved` marks the build dirty (asm edits don't
 * render live → Test Level / Launch rebuild first).
 */
export function useStringsEditor(
  id: string,
  title: string,
  projectId: string | null,
  onSaved: () => void,
  history: DocHistory
): StringsEditorState {
  const doc = useOverlayDocument<StringTableModel>({
    key: `strings:${id}`,
    reloadKey: `${id}:${projectId ?? ''}`,
    load: () =>
      window.shinyEgg.editor.loadResource({ kind: 'asm-region', id }) as Promise<StringTableModel>,
    persist: (draft) => window.shinyEgg.editor.saveResource({ kind: 'asm-region', id }, draft),
    equals: (a, b) => JSON.stringify(a.entries) === JSON.stringify(b.entries),
    clone: (v) => structuredClone(v),
    onSaved,
    history
  })

  const draft = doc.draft
  const allowed = useMemo(() => new Set(draft?.allowedChars ?? []), [draft])

  // Bytes used. Line model: 1 font byte per char. Markup model: the ENCODED byte
  // size (markupByteSize — tokens are 1–3 bytes, cosmetic `\n`s are 0), which
  // matches the on-save budget; a raw char count over-counts multi-char tokens +
  // newlines and made a pristine cart read as over budget.
  const usedBytes = useMemo(() => {
    let n = 0
    if (draft) {
      if (draft.markup) for (const e of draft.entries) n += markupByteSize(e.markup ?? '')
      else for (const e of draft.entries) for (const l of e.lines) n += [...l].length
    }
    return n
  }, [draft])

  // Markup tokens (`[B]`, `[$cc]`) contain chars outside the font's legal set, so
  // per-char validation would false-positive — the codec validates tokens on save.
  const hasInvalid = useMemo(() => {
    if (!draft || draft.markup) return false
    for (const e of draft.entries)
      for (const l of e.lines) for (const ch of l) if (!allowed.has(ch)) return true
    return false
  }, [draft, allowed])

  const budgetBytes = draft?.budgetChars ?? 0
  // Both models can now be measured exactly client-side (markupByteSize mirrors
  // the encoder), so block Save when over — matching the on-save enforcement.
  const overBudget = !!draft && usedBytes > budgetBytes

  // One undo step per committed line edit (blur/Enter) — `doc.commit` snapshots
  // before/after onto the unified history.
  const editLine = useCallback(
    (entryIdx: number, lineIdx: number, value: string) => {
      const prev = doc.read()
      if (!prev) return
      const next: StringTableModel = {
        ...prev,
        entries: prev.entries.map((e, i) =>
          i === entryIdx
            ? { ...e, lines: e.lines.map((l, j) => (j === lineIdx ? value : l)) }
            : e
        )
      }
      doc.commit(next)
    },
    [doc]
  )

  // One undo step per committed markup edit (blur) — mirrors `editLine` for the
  // message model, where the whole entry is a single markup string.
  const editMarkup = useCallback(
    (entryIdx: number, value: string) => {
      const prev = doc.read()
      if (!prev) return
      const next: StringTableModel = {
        ...prev,
        entries: prev.entries.map((e, i) => (i === entryIdx ? { ...e, markup: value } : e))
      }
      doc.commit(next)
    },
    [doc]
  )

  return {
    id,
    title,
    model: draft,
    status: doc.status,
    error: doc.error,
    saveError: doc.saveError,
    saving: doc.saving,
    dirty: doc.dirty,
    usedBytes,
    budgetBytes,
    overBudget,
    hasInvalid,
    allowed,
    editLine,
    editMarkup,
    save: doc.save,
    discard: doc.discard
  }
}

export interface MessagePtrEditorState {
  id: string
  title: string
  model: MessagePtrTableModel | null
  status: string
  error: string | null
  saveError: string | null
  saving: boolean
  dirty: boolean
  /** Repoint a slot (message ID) at a body option id, or '' for the null slot. */
  setSlot: (slotIdx: number, optionId: string) => void
  save: () => Promise<boolean>
  discard: () => void
}

/**
 * Owns the message-pointer-table editing state (DATA_message_box_text_ptrs).
 * Mirrors `useStringsEditor` — App-level so the draft + EditSession registration
 * survive the window closing / tab switches, and reloads on project change.
 * `onSaved` marks the build dirty (asm edits don't render live → Test Level /
 * Launch rebuild first).
 */
export function useMessagePtrTableEditor(
  id: string,
  title: string,
  projectId: string | null,
  onSaved: () => void,
  history: DocHistory
): MessagePtrEditorState {
  const doc = useOverlayDocument<MessagePtrTableModel>({
    key: `strings:${id}`,
    reloadKey: `${id}:${projectId ?? ''}`,
    load: () =>
      window.shinyEgg.editor.loadResource({
        kind: 'asm-region',
        id
      }) as Promise<MessagePtrTableModel>,
    persist: (draft) => window.shinyEgg.editor.saveResource({ kind: 'asm-region', id }, draft),
    equals: (a, b) => JSON.stringify(a.slots) === JSON.stringify(b.slots),
    clone: (v) => structuredClone(v),
    onSaved,
    history
  })

  // One undo step per repoint — `doc.commit` snapshots before/after onto the
  // unified history.
  const setSlot = useCallback(
    (slotIdx: number, optionId: string) => {
      const prev = doc.read()
      if (!prev) return
      const next: MessagePtrTableModel = {
        ...prev,
        slots: prev.slots.map((s, i) => (i === slotIdx ? optionId : s))
      }
      doc.commit(next)
    },
    [doc]
  )

  return {
    id,
    title,
    model: doc.draft,
    status: doc.status,
    error: doc.error,
    saveError: doc.saveError,
    saving: doc.saving,
    dirty: doc.dirty,
    setSlot,
    save: doc.save,
    discard: doc.discard
  }
}

/** A Strings-panel tab: either a text/markup table editor or the message-pointer
 *  table editor. Both editors expose `{ id, title, dirty }` for the tab bar. */
export type StringsTab =
  | { kind: 'strings'; editor: StringsEditorState }
  | { kind: 'ptr-table'; editor: MessagePtrEditorState }

/** The Strings window body — a tab bar over the App-level editors, showing the
 *  active one. Each editor stays alive (state in App), so switching tabs
 *  preserves edits and dirty state. */
export function StringsBody({ tabs }: { tabs: StringsTab[] }): JSX.Element {
  const [activeId, setActiveId] = useState<string>(tabs[0]?.editor.id ?? '')
  const active = tabs.find((t) => t.editor.id === activeId) ?? tabs[0]

  return (
    <div className="se-strings">
      <div className="se-tabs">
        {tabs.map(({ editor: t }) => (
          <button
            key={t.id}
            type="button"
            className={`se-tab${t.id === active?.editor.id ? ' is-active' : ''}`}
            onClick={() => setActiveId(t.id)}
            title={t.dirty ? `${t.title} — unsaved changes` : t.title}
          >
            {t.title}
            {t.dirty ? ' •' : ''}
          </button>
        ))}
      </div>
      {active &&
        (active.kind === 'strings' ? (
          <StringTableView key={active.editor.id} editor={active.editor} />
        ) : (
          <MessagePtrTableView key={active.editor.id} editor={active.editor} />
        ))}
    </div>
  )
}

/** A single editable string line. Holds its own value while focused so typing
 *  stays local + snappy; commits up to the draft model (which triggers the
 *  table-wide budget/dirty recompute) only on blur or Enter — not per
 *  keystroke. Re-syncs when the committed `value` changes externally
 *  (discard / reload / tab switch). */
function LineInput({
  value,
  allowed,
  onCommit
}: {
  value: string
  allowed: ReadonlySet<string>
  onCommit: (v: string) => void
}): JSX.Element {
  const { local, setLocal, commit } = useCommitOnBlur(value, onCommit)
  const invalid = [...local].some((ch) => !allowed.has(ch))
  return (
    <input
      className={`se-strings__field se-strings__line${invalid ? ' is-invalid' : ''}`}
      value={local}
      spellCheck={false}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}

/** A single editable message body in the markup model — the whole message as one
 *  multiline string of plain text + `[token]`s (see asm/msg-markup.ts). Mirrors
 *  `LineInput`'s local-state / commit-on-blur pattern, but a textarea (messages
 *  span several visual rows + scroll runs). Enter inserts a newline (cosmetic in
 *  markup); commit is on blur only. */
function MarkupInput({
  value,
  onCommit
}: {
  value: string
  onCommit: (v: string) => void
}): JSX.Element {
  const { local, setLocal, commit } = useCommitOnBlur(value, onCommit)
  const rows = Math.min(8, Math.max(2, local.split('\n').length))
  return (
    <textarea
      className="se-strings__field se-strings__markup"
      value={local}
      rows={rows}
      spellCheck={false}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
    />
  )
}

/** Collapsible reference of the insertable markup tokens (special glyphs +
 *  control codes), read from the model's `markupGuide`. Each row shows the
 *  `[token]` to type and its meaning; any byte can also be written as `[$XX]`. */
function MarkupGuide({ guide }: { guide: MarkupToken[] }): JSX.Element {
  const glyphs = guide.filter((g) => g.kind === 'glyph')
  const controls = guide.filter((g) => g.kind === 'control')
  const group = (title: string, items: MarkupToken[]): JSX.Element => (
    <div className="se-strings__guide-group">
      <div className="se-strings__guide-head">{title}</div>
      <div className="se-strings__guide-grid">
        {items.map((t) => (
          <div className="se-strings__guide-row" key={`${t.kind}:${t.token}`}>
            <code className="se-strings__guide-token">[{t.token}]</code>
            <span className="se-strings__guide-label">{t.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
  return (
    <details className="se-strings__guide">
      <summary>Markup guide</summary>
      <p className="se-strings__guide-note">
        Type a token in brackets to insert a glyph or control code. Any raw byte can
        be written as <code>[$XX]</code> (or <code>[$XXFF]</code> for a control word).
        Repeat a token with <code>[scroll_8]</code> (= eight <code>[scroll]</code>s).
        A line break in the box is cosmetic — use <code>[br]</code> / <code>[row2]</code>
        for in-game layout.
      </p>
      {group('Special glyphs', glyphs)}
      {group('Control codes', controls)}
    </details>
  )
}

function StringTableView({ editor }: { editor: StringsEditorState }): JSX.Element {
  const {
    model,
    status,
    error,
    saveError,
    saving,
    dirty,
    usedBytes,
    budgetBytes,
    overBudget,
    hasInvalid,
    allowed,
    editLine,
    editMarkup,
    save
  } = editor
  const [query, setQuery] = useState('')
  const canSave = dirty && !overBudget && !hasInvalid && !saving

  if (error) {
    return (
      <div className="se-strings__panel">
        <p className="se-strings__warn">Error: {error}</p>
      </div>
    )
  }
  if (!model) {
    return (
      <div className="se-strings__panel">
        <p className="se-strings__hint">{status}</p>
      </div>
    )
  }

  const isMarkup = !!model.markup
  // Filter by the entry's display name + asm label — both carry the friendly
  // alias and the memory address (e.g. "DATA_msg_minigame_watermelon_seed
  // (0x5140D3)"), so a name or address substring matches. `ei` is the entry's
  // index in the FULL model — kept through the filter so the reducer edits the
  // right entry while a search is active.
  const q = query.trim().toLowerCase()
  const visible = model.entries
    .map((entry, ei) => ({ entry, ei }))
    .filter(
      ({ entry }) =>
        !q || entry.name.toLowerCase().includes(q) || entry.label.toLowerCase().includes(q)
    )

  return (
    <div className="se-strings__panel">
      <input
        className="se-strings__field se-strings__search"
        type="search"
        value={query}
        spellCheck={false}
        placeholder="Search by name or address…"
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="se-strings__list">
        {isMarkup && model.markupGuide && <MarkupGuide guide={model.markupGuide} />}
        {visible.map(({ entry, ei }) => (
          <div className="se-strings__entry" key={entry.label} title={entry.label}>
            <span className="se-strings__entry-name">{entry.name}</span>
            {isMarkup ? (
              <MarkupInput value={entry.markup ?? ''} onCommit={(v) => editMarkup(ei, v)} />
            ) : (
              <div className="se-strings__entry-lines">
                {entry.lines.map((line, li) => (
                  <LineInput
                    key={li}
                    value={line}
                    allowed={allowed}
                    onCommit={(v) => editLine(ei, li, v)}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
        {q && visible.length === 0 && (
          <p className="se-strings__hint">No entries match “{query}”.</p>
        )}
      </div>
      <div className="se-strings__footer">
        <span className={`se-strings__budget${overBudget ? ' is-over' : ''}`}>
          {usedBytes} / {budgetBytes} bytes
        </span>
        {q && (
          <span className="se-strings__count">
            {visible.length} of {model.entries.length}
          </span>
        )}
        {hasInvalid && <span className="se-strings__warn">unsupported characters</span>}
        {saveError && <span className="se-strings__warn">{saveError}</span>}
        <button
          type="button"
          className="se-btn is-primary se-strings__save"
          disabled={!canSave}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

/** The message-pointer-table editor (DATA_message_box_text_ptrs): one row per
 *  message-ID slot, each a dropdown that repoints the slot at a message body (or
 *  the null `$0000` option). The preview shows the target's first text line for
 *  identification; the search box filters by message ID (hex) or target. The
 *  table is fixed-size (300 slots) — slots are repointed, never added/removed. */
function MessagePtrTableView({ editor }: { editor: MessagePtrEditorState }): JSX.Element {
  const { model, status, error, saveError, saving, dirty, setSlot, save } = editor
  const [query, setQuery] = useState('')
  const canSave = dirty && !saving

  // Option <option> elements are immutable descriptors, so the same array can be
  // shared as children of every row's <select> (300 selects × ~80 options is a
  // lot of DOM — if this ever feels heavy, virtualize the row list).
  const optionEls = useMemo(
    () =>
      (model?.options ?? []).map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      )),
    [model]
  )
  const optionById = useMemo(() => {
    const m = new Map<string, MessagePtrOption>()
    for (const o of model?.options ?? []) m.set(o.id, o)
    return m
  }, [model])

  if (error) {
    return (
      <div className="se-strings__panel">
        <p className="se-strings__warn">Error: {error}</p>
      </div>
    )
  }
  if (!model) {
    return (
      <div className="se-strings__panel">
        <p className="se-strings__hint">{status}</p>
      </div>
    )
  }

  const idHex = (i: number): string => `0x${i.toString(16).toUpperCase().padStart(2, '0')}`
  const q = query.trim().toLowerCase()
  // Match the message ID (hex) or the current target's id / name / preview. `i`
  // is the message ID (slot index), preserved through the filter for setSlot.
  const visible = model.slots
    .map((slot, i) => ({ slot, i }))
    .filter(({ slot, i }) => {
      if (!q) return true
      const opt = optionById.get(slot)
      return (
        idHex(i).toLowerCase().includes(q) ||
        slot.toLowerCase().includes(q) ||
        (opt?.name.toLowerCase().includes(q) ?? false) ||
        (opt?.preview.toLowerCase().includes(q) ?? false)
      )
    })

  return (
    <div className="se-strings__panel">
      <input
        className="se-strings__field se-strings__search"
        type="search"
        value={query}
        spellCheck={false}
        placeholder="Search by message ID or target…"
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="se-strings__list">
        {visible.map(({ slot, i }) => (
          <div className="se-strings__ptr-row" key={i}>
            <span className="se-strings__ptr-id" title={`Message ID ${idHex(i)}`}>
              {idHex(i)}
            </span>
            <select
              className="se-strings__field se-strings__ptr-select"
              value={slot}
              onChange={(e) => setSlot(i, e.target.value)}
            >
              <option value="">(none — $0000)</option>
              {optionEls}
            </select>
            <span className="se-strings__ptr-preview">{optionById.get(slot)?.preview ?? ''}</span>
          </div>
        ))}
        {q && visible.length === 0 && (
          <p className="se-strings__hint">No slots match “{query}”.</p>
        )}
      </div>
      <div className="se-strings__footer">
        <span className="se-strings__budget">{model.slots.length} message slots</span>
        {q && (
          <span className="se-strings__count">
            {visible.length} of {model.slots.length}
          </span>
        )}
        {saveError && <span className="se-strings__warn">{saveError}</span>}
        <button
          type="button"
          className="se-btn is-primary se-strings__save"
          disabled={!canSave}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
