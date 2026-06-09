import { useCallback, useMemo, useState, type JSX } from 'react'
import type { MarkupToken, StringTableModel } from '../../../preload/api'
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
  usedChars: number
  budgetChars: number
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
  const isMarkup = !!draft?.markup
  const allowed = useMemo(() => new Set(draft?.allowedChars ?? []), [draft])

  // For the line model this is the exact byte budget (1 font byte per char). For
  // the markup model it's an informational character tally — the real byte budget
  // (tokens encode to 1–3 bytes each) is enforced main-side on save, since the
  // renderer has no font byte-map to encode `[token]`s with.
  const usedChars = useMemo(() => {
    let n = 0
    if (draft) {
      if (draft.markup) for (const e of draft.entries) n += [...(e.markup ?? '')].length
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

  const budgetChars = draft?.budgetChars ?? 0
  // The markup region's byte budget can't be measured client-side, so never block
  // Save on it here; the save path re-encodes and rejects an over-budget edit.
  const overBudget = !!draft && !isMarkup && usedChars > budgetChars

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
    usedChars,
    budgetChars,
    overBudget,
    hasInvalid,
    allowed,
    editLine,
    editMarkup,
    save: doc.save,
    discard: doc.discard
  }
}

/** The Strings window body — a tab bar over the App-level table editors, showing
 *  the active one. Each editor stays alive (state in App), so switching tabs
 *  preserves edits and dirty state. */
export function StringsBody({ tables }: { tables: StringsEditorState[] }): JSX.Element {
  const [activeId, setActiveId] = useState<string>(tables[0]?.id ?? '')
  const active = tables.find((t) => t.id === activeId) ?? tables[0]

  return (
    <div className="se-strings">
      <div className="se-tabs">
        {tables.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`se-tab${t.id === active?.id ? ' is-active' : ''}`}
            onClick={() => setActiveId(t.id)}
            title={t.dirty ? `${t.title} — unsaved changes` : t.title}
          >
            {t.title}
            {t.dirty ? ' •' : ''}
          </button>
        ))}
      </div>
      {active && <StringTableView editor={active} />}
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
      className={`se-strings__line${invalid ? ' is-invalid' : ''}`}
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
      className="se-strings__markup"
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
    usedChars,
    budgetChars,
    overBudget,
    hasInvalid,
    allowed,
    editLine,
    editMarkup,
    save
  } = editor
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

  return (
    <div className="se-strings__panel">
      <div className="se-strings__list">
        {isMarkup && model.markupGuide && <MarkupGuide guide={model.markupGuide} />}
        {model.entries.map((entry, ei) => (
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
      </div>
      <div className="se-strings__footer">
        <span className={`se-strings__budget${overBudget ? ' is-over' : ''}`}>
          {isMarkup ? `${usedChars} chars · ${budgetChars} byte budget` : `${usedChars} / ${budgetChars} bytes`}
        </span>
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
