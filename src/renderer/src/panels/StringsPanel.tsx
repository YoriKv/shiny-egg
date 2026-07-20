import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type RefObject } from 'react'
import { markupBodyByteSize, markupByteSize } from 'snes-framework/msg-markup'
import type {
  MarkupToken,
  MessagePtrOption,
  MessagePtrTableModel,
  StringTableModel
} from '../../../preload/api'
import { useOverlayDocument, type DocHistory } from '../edit-session/useOverlayDocument'

/**
 * A model's live byte usage — mirrors each region's on-save budget accounting
 * exactly, so the footer estimate and Save gating never disagree with the
 * serializer:
 *   - markup (message text): the ENCODED size (markupByteSize — tokens are 1–3
 *     bytes, cosmetic `\n`s are 0); a raw char count over-counts.
 *   - credits staff-roll: OAM letter streams — 2 bytes/letter (spaces free) +
 *     2/line header word + 2/line break + 2 terminator per page. Letters per
 *     line = markupBodyByteSize minus the free spaces; matches the codec's
 *     creditsPageByteSize (drift-pinned in asm/credits-staff.test.ts). Computed
 *     from the renderer-safe msg-markup helper — the codec module is node-side.
 *   - glyph lines (intro/ending): per-line body size only — the cutscene
 *     terminators are separate control directives outside the budget.
 *   - plain lines (level names): 1 font byte per char.
 */
function modelUsedBytes(model: StringTableModel): number {
  let n = 0
  if (model.markup) {
    for (const e of model.entries) n += markupByteSize(e.markup ?? '')
  } else if (model.byteCost === 'credits-page') {
    for (const e of model.entries) {
      n += 2 + e.lines.length * 2 + Math.max(0, e.lines.length - 1) * 2
      for (const l of e.lines) n += 2 * (markupBodyByteSize(l) - (l.match(/ /g)?.length ?? 0))
    }
  } else if (model.glyphLines) {
    for (const e of model.entries) for (const l of e.lines) n += markupBodyByteSize(l)
  } else {
    for (const e of model.entries) for (const l of e.lines) n += [...l].length
  }
  return n
}
import { useCommitOnBlur } from '../hooks/useCommitOnBlur'
import { persistedState } from '../lib/persisted-state'

/** Markup-keyboard dock open/collapsed state — persisted so it survives reloads. */
const kbdDockPref = persistedState('shinyEgg.stringsKbd.v1', true)
import { useWindowedList } from '../hooks/useWindowedList'

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
  // Keyed on `allowedChars` (the legal charset, constant per table — `commit`'s
  // spread keeps the same array ref), not the whole `draft`, so the Set isn't
  // reallocated on every line edit (keeps its identity stable for memoized rows).
  const allowed = useMemo(() => new Set(draft?.allowedChars ?? []), [draft?.allowedChars])

  // Bytes used — the live estimate matches the on-save budget exactly for every
  // model (see modelUsedBytes).
  const usedBytes = useMemo(() => (draft ? modelUsedBytes(draft) : 0), [draft])

  // Markup tokens (`[B]`, `[$cc]`) contain chars outside the font's legal set, so
  // per-char validation would false-positive — the codec validates tokens on save.
  // (Same for the glyph-line model's `[glyph]` tokens.)
  const hasInvalid = useMemo(() => {
    if (!draft || draft.markup || draft.glyphLines) return false
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

/** Caret-targeted text insertion for a focusable text field. `insert` focuses
 *  the element and splices via execCommand('insertText') rather than a manual
 *  splice, so the edit lands on the field's NATIVE undo stack (Ctrl+Z reverts a
 *  keyboard-inserted token like any typed text) and the caret lands after it.
 *  The resulting `input` event flows through onChange → local state, keeping
 *  the controlled value in sync; since the value then matches the DOM, React's
 *  re-render is a no-op write and the undo stack survives. (The keyboard
 *  button's mousedown is preventDefault'd, so focus + selection stay put.) */
function useCaretInsert<T extends HTMLInputElement | HTMLTextAreaElement>(): {
  ref: RefObject<T | null>
  insert: (text: string) => void
} {
  const ref = useRef<T>(null)
  const insert = useCallback((text: string) => {
    const el = ref.current
    if (!el) return
    el.focus()
    document.execCommand('insertText', false, text)
  }, [])
  return { ref, insert }
}

/** A single editable string line. Holds its own value while focused so typing
 *  stays local + snappy; commits up to the draft model (which triggers the
 *  table-wide budget/dirty recompute) only on blur or Enter — not per
 *  keystroke. Re-syncs when the committed `value` changes externally
 *  (discard / reload / tab switch). On the glyph-line tabs (intro/ending) it's
 *  `tokenAware` — `[glyph]` tokens are excluded from the per-char validation
 *  (the codec validates them on save) — and registers an `insert` fn with the
 *  glyph keyboard on focus (undoable execCommand insert, like MarkupInput). */
function LineInput({
  value,
  allowed,
  onCommit,
  tokenAware,
  onActivate
}: {
  value: string
  allowed: ReadonlySet<string>
  onCommit: (v: string) => void
  tokenAware?: boolean
  onActivate?: (insert: ((text: string) => void) | null) => void
}): JSX.Element {
  const { local, setLocal, commit } = useCommitOnBlur(value, onCommit)
  const { ref, insert } = useCaretInsert<HTMLInputElement>()
  // Ignore `[token]` spans when token-aware — they're validated by the codec.
  const check = tokenAware ? local.replace(/\[[^\]]*\]/g, '') : local
  const invalid = [...check].some((ch) => !allowed.has(ch))
  return (
    <input
      ref={ref}
      className={`se-strings__field se-strings__line${invalid ? ' is-invalid' : ''}`}
      value={local}
      spellCheck={false}
      onFocus={onActivate ? () => onActivate(insert) : undefined}
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
 *  markup); commit is on blur only. On focus it hands the markup keyboard an
 *  `insert` fn (splice-at-caret) so token buttons target THIS textarea. */
function MarkupInput({
  value,
  onCommit,
  onActivate
}: {
  value: string
  onCommit: (v: string) => void
  /** Register/forget this input's splice-at-caret fn as the keyboard's target. */
  onActivate: (insert: ((text: string) => void) | null) => void
}): JSX.Element {
  const { local, setLocal, commit } = useCommitOnBlur(value, onCommit)
  const { ref: taRef, insert } = useCaretInsert<HTMLTextAreaElement>()

  const rows = Math.min(8, Math.max(2, local.split('\n').length))
  return (
    <textarea
      ref={taRef}
      className="se-strings__field se-strings__markup"
      value={local}
      rows={rows}
      spellCheck={false}
      onFocus={() => onActivate(insert)}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
    />
  )
}

/** The markup "keyboard" — a dock of token buttons that splice `[token]` into the
 *  focused message textarea at the caret (`onInsert`). Docked to the LEFT of the
 *  message list (not inside it), so it stays put while the messages scroll. Its
 *  own body scrolls independently. Collapsible via the header toggle (`open` /
 *  `onToggle`). Special glyphs show their real in-game pixel image
 *  (`glyphPreviews`, keyed by token); control codes have no glyph, so they stay
 *  text-labelled. Any byte can also be typed by hand as `[$XX]` / `[$XXFF]`. */
function MarkupKeyboard({
  guide,
  onInsert,
  glyphPreviews,
  open,
  onToggle
}: {
  guide: MarkupToken[]
  onInsert: (token: string) => void
  glyphPreviews?: ReadonlyMap<string, string>
  open: boolean
  onToggle: () => void
}): JSX.Element {
  const glyphs = guide.filter((g) => g.kind === 'glyph')
  const controls = guide.filter((g) => g.kind === 'control')
  const group = (title: string, items: MarkupToken[], showGlyph: boolean): JSX.Element | null =>
    items.length === 0 ? null : (
    <div className="se-strings__guide-group">
      <div className="se-strings__guide-head">{title}</div>
      <div className="se-strings__guide-grid">
        {items.map((t) => {
          const preview = showGlyph ? glyphPreviews?.get(t.token) : undefined
          return (
            <button
              type="button"
              className="se-strings__guide-row se-strings__guide-btn"
              key={`${t.kind}:${t.token}`}
              title={`${t.label} — insert [${t.token}]`}
              // Keep focus (and the caret) on the textarea so insert targets it.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onInsert(t.token)}
            >
              {preview ? (
                <img className="se-strings__guide-glyph" src={preview} alt={t.label} />
              ) : (
                <code className="se-strings__guide-token">[{t.token}]</code>
              )}
              <span className="se-strings__guide-label">{t.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
  return (
    <div className={`se-strings__kbd${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="se-strings__kbd-toggle"
        onClick={onToggle}
        title={open ? 'Collapse the markup keyboard' : 'Expand the markup keyboard'}
      >
        {open ? '◀ Keyboard' : '⌨'}
      </button>
      {open && (
        <div className="se-strings__kbd-body">
          <p className="se-strings__guide-note">
            {controls.length > 0 ? (
              <>
                Click a token to insert it at the cursor. Any raw byte can also be typed as{' '}
                <code>[$XX]</code> / <code>[$XXFF]</code>; repeat with <code>[scroll_8]</code>. A line
                break in the box is cosmetic — use <code>[br]</code> / <code>[row2]</code> for layout.
              </>
            ) : (
              <>
                Click a glyph to insert it at the cursor. A glyph costs 1–2 bytes of the budget, so
                shorten the text to make room. Any raw font byte can also be typed as <code>[$XX]</code>.
              </>
            )}
          </p>
          {group('Special glyphs', glyphs, true)}
          {group('Control codes', controls, false)}
        </div>
      )}
    </div>
  )
}

/** Fetch the special-glyph PNG previews once (markup token → data URL) for the
 *  keyboard, decoded main-side from the static 1bpp message font. Empty until
 *  loaded / when disabled — buttons then fall back to their text token. */
function useGlyphPreviews(enabled: boolean): ReadonlyMap<string, string> {
  const [map, setMap] = useState<ReadonlyMap<string, string>>(new Map())
  useEffect(() => {
    if (!enabled || map.size > 0) return
    let live = true
    void window.shinyEgg.render
      .messageFontGlyphs()
      .then((list) => {
        if (live) setMap(new Map(list.map((g) => [g.token, g.dataUrl])))
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [enabled, map.size])
  return map
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
  // The focused message textarea's splice-at-caret fn — the markup keyboard's
  // current target. Set by each MarkupInput on focus; a token button calls it.
  const activeInsert = useRef<((text: string) => void) | null>(null)
  const insertToken = useCallback((token: string) => activeInsert.current?.(`[${token}]`), [])
  // Registered by each input on focus — the keyboard's current splice target.
  const activate = useCallback((fn: ((text: string) => void) | null) => {
    activeInsert.current = fn
  }, [])
  const glyphPreviews = useGlyphPreviews(!!model?.markup || !!model?.glyphLines)
  const [kbdOpen, setKbdOpen] = useState(() => kbdDockPref.load())
  const toggleKbd = useCallback(
    () => setKbdOpen((v) => (kbdDockPref.save(!v), !v)),
    []
  )

  // Filter by the entry's display name + asm label — both carry the friendly
  // alias and the memory address (e.g. "DATA_msg_minigame_watermelon_seed
  // (0x5140D3)"), so a name or address substring matches. `ei` is the entry's
  // index in the FULL model — kept through the filter so the reducer edits the
  // right entry while a search is active. Memoized so a line/markup commit (which
  // re-renders the whole view) doesn't re-filter the table on every keystroke.
  const q = query.trim().toLowerCase()
  const visible = useMemo(() => {
    if (!model) return []
    return model.entries
      .map((entry, ei) => ({ entry, ei }))
      .filter(
        ({ entry }) =>
          !q || entry.name.toLowerCase().includes(q) || entry.label.toLowerCase().includes(q)
      )
  }, [model, q])

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
      <input
        className="se-strings__field se-strings__search"
        type="search"
        value={query}
        spellCheck={false}
        placeholder="Search by name or address…"
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="se-strings__body">
        {model.markupGuide && (
          <MarkupKeyboard
            guide={model.markupGuide}
            onInsert={insertToken}
            glyphPreviews={glyphPreviews}
            open={kbdOpen}
            onToggle={toggleKbd}
          />
        )}
        <div className="se-strings__list">
          {visible.map(({ entry, ei }) => (
            <div className="se-strings__entry" key={entry.label} title={entry.label}>
              <span className="se-strings__entry-name">{entry.name}</span>
              {isMarkup ? (
                <MarkupInput
                  value={entry.markup ?? ''}
                  onCommit={(v) => editMarkup(ei, v)}
                  onActivate={activate}
                />
              ) : (
                <div className="se-strings__entry-lines">
                  {entry.lines.map((line, li) => (
                    <LineInput
                      key={li}
                      value={line}
                      allowed={allowed}
                      onCommit={(v) => editLine(ei, li, v)}
                      tokenAware={model.glyphLines}
                      onActivate={model.glyphLines ? activate : undefined}
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

// Windowed pointer-table rows: a fixed pitch so only the visible slice mounts
// (300 slots × a ~80-option <select> each is ~24k DOM nodes un-windowed — see
// useWindowedList). PTR_ROW_H must match `.se-strings__list--windowed
// .se-strings__ptr-row`'s CSS height; the +2 is the inter-row gap (rows are
// absolutely positioned, so the gap lives in the pitch, not CSS).
const PTR_ROW_H = 26
const PTR_ROW_PITCH = PTR_ROW_H + 2
const PTR_OVERSCAN = 8

const ptrIdHex = (i: number): string => `0x${i.toString(16).toUpperCase().padStart(2, '0')}`

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
  // shared as children of every row's <select>. With the row list windowed only
  // the visible <select>s mount, so this materializes ~(viewport rows × options)
  // option nodes, not 300 × options.
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

  // Match the message ID (hex) or the current target's id / name / preview. `i`
  // is the message ID (slot index), preserved through the filter for setSlot.
  // Memoized — it feeds the windowing math + reset key below.
  const q = query.trim().toLowerCase()
  const visible = useMemo(() => {
    if (!model) return []
    return model.slots
      .map((slot, i) => ({ slot, i }))
      .filter(({ slot, i }) => {
        if (!q) return true
        const opt = optionById.get(slot)
        return (
          ptrIdHex(i).toLowerCase().includes(q) ||
          slot.toLowerCase().includes(q) ||
          (opt?.name.toLowerCase().includes(q) ?? false) ||
          (opt?.preview.toLowerCase().includes(q) ?? false)
        )
      })
  }, [model, q, optionById])

  // Window the rows (fixed-height): only the visible slice of `visible` mounts.
  const win = useWindowedList(visible, PTR_ROW_PITCH, { overscan: PTR_OVERSCAN, resetKey: q })

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
      <div
        className="se-strings__list se-strings__list--windowed"
        ref={win.listRef}
        onScroll={win.onScroll}
      >
        <div className="se-strings__ptr-sizer" style={{ height: win.sizerHeight }}>
          {win.slice.map(({ item: { slot, i }, top }) => (
            <div className="se-strings__ptr-row" key={i} style={{ top }}>
              <span className="se-strings__ptr-id" title={`Message ID ${ptrIdHex(i)}`}>
                {ptrIdHex(i)}
              </span>
              <select
                className="se-strings__field se-strings__ptr-select"
                value={slot}
                onChange={(e) => setSlot(i, e.target.value)}
              >
                <option value="">(none — $0000)</option>
                {optionEls}
              </select>
              <span className="se-strings__ptr-preview">
                {optionById.get(slot)?.preview ?? ''}
              </span>
            </div>
          ))}
        </div>
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
