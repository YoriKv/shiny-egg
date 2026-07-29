// String-table editor backend — parse/serialize every `;@editable` text region:
// level names + message text + the message pointer table (Bank51), the intro
// storybook (Bank0F), the ending epilogue (Bank0D), and the credits staff roll
// (Bank00 `dw` letter streams). Built on the reusable asm primitives in ./asm
// (markers / text-literals / font-table / glyph-line / msg-markup /
// credits-staff) so each region is a parse+serialize pair over one shared
// region-table skeleton.
//
// Edit strategy: format-preserving in-place splice. We never re-emit the region
// — we replace only the contents of the `"..."` literals the user edited. So
// control bytes ($FF,$00 / $FE,$10,$00 / $FD), the pointer table, comments,
// label aliases, indentation, and the garbage sentinel all survive byte-for-byte.
//
// Newline insertion is intentionally NOT supported: level-name layout is fixed at
// 2 lines (a 3rd needs layout asm), the char-budget counter ignores control bytes
// (so a new $FF/$FE record would under-count cost), and message text is a sequence
// of quoted-literal segments — not visual rows. Multi-line editing, if ever needed,
// must be a structured control-record edit, not a text edit.

import { findRegion, spliceRegion } from './asm/markers.ts'
import { escapeDefineBangs, findQuotedLiterals, stripComment, applyEdits, type TextEdit } from './asm/text-literals.ts'
import {
  invalidChars,
  loadFontTable,
  type FontTable
} from './asm/font-table.ts'
import {
  CONTROL_CODES,
  SPECIAL_GLYPHS,
  decodeMessageBytes,
  encodeMessageMarkup
} from './asm/msg-markup.ts'
import {
  bytesToMessageDirectives,
  messageBodyToBytes,
  splitMessageEntries
} from './asm/msg-asm.ts'
import {
  dbArgsToLine,
  encodeLineToDbArgs,
  isTextLineArgs,
  parseDbArgs
} from './asm/glyph-line.ts'
import { decodeCreditsPage, encodeCreditsPage } from './asm/credits-staff.ts'
import { snesToPC } from './engine/symbol-map.ts'
import type {
  MarkupToken,
  MessagePtrOption,
  MessagePtrTableModel,
  StringTableEntry,
  StringTableModel
} from './types.ts'

/** The insertable-token guide for the markup editor (glyphs then control codes). */
const MARKUP_GUIDE: MarkupToken[] = [
  ...SPECIAL_GLYPHS.map((g) => ({ token: g.token, label: g.label, kind: 'glyph' as const })),
  ...CONTROL_CODES.map((c) => ({ token: c.token, label: c.label, kind: 'control' as const }))
]

/** Glyph-only guide for the cutscene (intro/ending) editors — those edit plain
 *  text + special glyphs; the layout control bytes are preserved verbatim, not
 *  exposed as insertable tokens. */
const GLYPH_GUIDE: MarkupToken[] = SPECIAL_GLYPHS.map((g) => ({
  token: g.token,
  label: g.label,
  kind: 'glyph' as const
}))

export { loadFontTable, type FontTable }

/** Marker id of the level-name string region in Bank51. */
export const LEVEL_NAME_STRINGS_ID = 'level-name-strings'

/** Marker id of the intro/message-box text region in Bank51 (interleaved with
 *  glyph-bitmap data, which the parser skips — it has no quoted literals). */
export const MESSAGE_TEXT_ID = 'message-box-text'

/** Marker id of the message-pointer table region in Bank51
 *  (`DATA_message_box_text_ptrs`: 300 symbolic `dw <body>` slots, message ID →
 *  message body). */
export const MESSAGE_PTR_TABLE_ID = 'message-box-text-ptrs'

/**
 * Free-space headroom for a growable region — extra bytes it may claim BEYOND
 * the pristine-base region size.
 *
 * Bank $51's two text regions are growable: the message bodies and, after them,
 * the level-name strings (the bank's last data). Both are addressed by symbolic
 * pointer tables (`DATA_message_box_text_ptrs` / `DATA_level_name_string_ptrs`)
 * and everything downstream of them is label-addressed, so asar re-resolves every
 * address when a body grows; the only hard stop is the bank's closing
 * `%FREE_BYTES($515348, 44216, $FF)` — an `assert pc() <= $515348` then `org`.
 * The build moves that boundary forward by their COMBINED growth
 * (`bank51SpillBytes` → relocate.ts `shiftRegionHead`), so they simply eat into
 * the bank's 44 KB `$FF` tail. That one tail is also shared with level-data
 * migration + the asm-patch pool, so the caller computes each region's headroom
 * from what those — and the sibling region — leave free: see
 * src/main/resources.ts `stringHeadroomBytes`.
 *
 * Absent / 0 ⇒ the classic fixed budget (every region outside bank $51).
 */
export interface RegionBudgetOptions {
  headroomBytes?: number
}

/** Where a bank $51 region's overflow goes — named in the editor's budget
 *  readout and in the over-budget error. */
const FREE_TAIL_LABEL = 'bank $51 free space'

/** Marker id of the intro-cutscene storybook text region in Bank0F ("A long,
 *  long time ago …"). One `DATA_0F<addr>` body per cutscene screen; the bodies
 *  are addressed by the symbolic `dw` sequence table at `DATA_0FCEDB`, so asar
 *  recomputes them when the in-place splice shrinks a body. */
export const INTRO_STORY_ID = 'intro-story'

/** Marker id of the ending/epilogue text region in Bank0D ("…the twins are
 *  reunited."). A single `DATA_0DF3E8` body of several quoted lines interleaved
 *  with `dw` row-advance control words (preserved byte-for-byte by the splice). */
export const ENDING_TEXT_ID = 'ending-text'

/** A located editable literal: its text plus its char range within the region
 *  body (`inner`), so the save path can splice new text back in place. */
interface LocatedLine {
  text: string
  start: number
  end: number
}

interface ParsedEntry {
  /** Primary label — the one the pointer table references; the save-match key. */
  label: string
  /** All labels on the body (incl. the primary), for choosing a display name. */
  labels: string[]
  lines: LocatedLine[]
}

const LABEL_RE = /^([A-Za-z_.][\w.]*):/

// ── Shared region-table skeleton ────────────────────────────────────────────
// Every text region is edited the same way: locate the region in BOTH texts
// (content = overlay-first, budget = pristine base), diff the model against the
// parsed base entries, enforce the stale-model + byte-budget guards, then
// splice only the changed spans. These helpers are that shared skeleton; each
// region supplies its own entry parser + per-entry differ.

/**
 * The shared label-walk skeleton: split a region body into label-keyed entries.
 * A label line begins an entry (or, when the current entry has no content yet,
 * records a descriptive alias on it); every non-blank line — including the
 * label line itself — is offered to `onLine`, which appends the region's own
 * kind of content (quoted literals / text `db` directives / `dw` stream rows)
 * to the current entry. Entries that end up with no content are dropped.
 */
function walkLabeledEntries<E extends { label: string; labels: string[] }>(
  inner: string,
  makeEntry: (label: string) => E,
  hasContent: (e: E) => boolean,
  onLine: (e: E, rawLine: string, code: string, lineStart: number) => void
): E[] {
  const entries: E[] = []
  let cur: E | null = null
  let offset = 0
  for (const rawLine of inner.split('\n')) {
    const lineStart = offset
    offset += rawLine.length + 1 // account for the consumed '\n'
    const code = stripComment(rawLine)
    const trimmed = code.trim()
    if (trimmed === '') continue
    const label = LABEL_RE.exec(trimmed)?.[1]
    if (label) {
      if (!cur || hasContent(cur)) {
        // Primary label (pointer-referenced — the save-match key) begins an entry.
        cur = makeEntry(label)
        entries.push(cur)
      } else {
        // An extra label line on the same body — a descriptive alias, kept for
        // display-name choice; the key stays the primary.
        cur.labels.push(label)
      }
    }
    if (cur) onLine(cur, rawLine, code, lineStart)
  }
  return entries.filter(hasContent)
}

interface RegionPair {
  region: NonNullable<ReturnType<typeof findRegion>>
  budgetRegion: NonNullable<ReturnType<typeof findRegion>>
}

const missingMarkers = (id: string, base: boolean): string =>
  `${base ? 'The base file' : 'The file'} is missing the ;@editable:${id} markers.`

/** Locate a region in the content + budget texts, or an error string. */
function findRegionPair(contentText: string, budgetText: string, id: string): RegionPair | string {
  const region = findRegion(contentText, id)
  if (!region) return missingMarkers(id, false)
  const budgetRegion = findRegion(budgetText, id)
  if (!budgetRegion) return missingMarkers(id, true)
  return { region, budgetRegion }
}

/** Throwing variant for the parse side. */
function requireRegionPair(contentText: string, budgetText: string, id: string): RegionPair {
  const pair = findRegionPair(contentText, budgetText, id)
  if (typeof pair === 'string') throw new Error(pair)
  return pair
}

/** The stale-model guard: every model entry must still exist in the base. */
function staleEntryError(entries: readonly { label: string }[], known: ReadonlySet<string>): string | null {
  for (const e of entries) {
    if (!known.has(e.label)) return `Entry "${e.label}" is not in the current base file (out of date?).`
  }
  return null
}

/** The longest of a body's labels — the most descriptive alias, for display. */
const longestLabel = (labels: readonly string[]): string =>
  labels.reduce((a, b) => (b.length > a.length ? b : a), labels[0])

/** One region entry's serialize outcome: its byte cost + the in-place edits. */
type EntryDiff = { cost: number; edits: TextEdit[] } | { error: string }

/**
 * The shared serialize skeleton: region pair → base entries → stale guard →
 * per-entry diff (each region's `diffEntry` handles validation, the unchanged
 * fast path, and its own edit spans) → budget gate → splice. `budgetNoun`
 * flavors the overflow message ("character(s)" / "byte(s)" / "letter(s)").
 */
function serializeEntryTable<E extends { label: string }>(opts: {
  contentText: string
  budgetText: string
  id: string
  model: StringTableModel
  parse: (inner: string) => E[]
  totalCost: (entries: E[]) => number
  diffEntry: (base: E, edited: StringTableEntry | undefined) => EntryDiff
  budgetNoun: string
  /** Divide the overflow byte count for the message (credits: 2 bytes/letter). */
  budgetUnitBytes?: number
  /** Extra bytes past the base region size (growable regions only — see
   *  `RegionBudgetOptions`). Absent/0 = the classic fixed budget. */
  headroomBytes?: number
  /** Names the headroom's source in the overflow message ("bank $51 free space"). */
  headroomLabel?: string
}): SerializeResult {
  const pair = findRegionPair(opts.contentText, opts.budgetText, opts.id)
  if (typeof pair === 'string') return { ok: false, error: pair }

  const base = opts.parse(pair.region.inner)
  const stale = staleEntryError(opts.model.entries, new Set(base.map((e) => e.label)))
  if (stale) return { ok: false, error: stale }
  const baseBytes = opts.totalCost(opts.parse(pair.budgetRegion.inner))
  const headroom = Math.max(0, opts.headroomBytes ?? 0)
  const budget = baseBytes + headroom

  const edits: TextEdit[] = []
  let newTotal = 0
  for (const baseEntry of base) {
    const d = opts.diffEntry(baseEntry, opts.model.entries.find((e) => e.label === baseEntry.label))
    if ('error' in d) return { ok: false, error: d.error }
    newTotal += d.cost
    edits.push(...d.edits)
  }

  if (newTotal > budget) {
    const over = Math.ceil((newTotal - budget) / (opts.budgetUnitBytes ?? 1))
    const room = headroom > 0 ? ` (${baseBytes} + ${headroom} of ${opts.headroomLabel})` : ''
    return {
      ok: false,
      error: `The text uses ${newTotal} bytes but the budget is ${budget}${room}. Shorten ${over} ${opts.budgetNoun}.`
    }
  }

  return { ok: true, text: spliceRegion(opts.contentText, opts.id, applyEdits(pair.region.inner, edits)) }
}

/**
 * Walk a region body into entries. An entry = a label plus the `"..."` literals
 * that follow it (until the next label). Consecutive label lines with no
 * literals between them are aliases of one entry (its primary label — the one
 * the pointer table references — is the first). Entries with no literals (the
 * raw-byte garbage sentinel) are dropped: there's nothing to edit, and the
 * in-place splice leaves their bytes untouched regardless.
 */
function parseRegionEntries(inner: string): ParsedEntry[] {
  return walkLabeledEntries<ParsedEntry>(
    inner,
    (label) => ({ label, labels: [label], lines: [] }),
    (e) => e.lines.length > 0,
    (e, rawLine, _code, lineStart) => {
      for (const lit of findQuotedLiterals(rawLine)) {
        e.lines.push({ text: lit.value, start: lineStart + lit.start, end: lineStart + lit.end })
      }
    }
  )
}

function totalChars(entries: ParsedEntry[]): number {
  let n = 0
  for (const e of entries) for (const l of e.lines) n += [...l.text].length
  return n
}

// ── Friendly names (from the pointer table, outside the editable region) ───
// The level-name pointer table `DATA_level_name_string_ptrs` is 12 slots per world × 6 worlds:
// slots 0-7 = levels 1-8, slot 8 = "Extra", slots 9-11 = padding → sentinel
// (except world 1 slot 11 → the welcome splash). That gives an authoritative
// "1-1" … "Extra 6" name for every body; specials fall back to a humanized alias.

const PTR_TABLE_LABELS = ['DATA_level_name_string_ptrs']

/** Ordered list of the level-name body labels the pointer table references, one
 *  per translevel slot. The importer uses this to map a foreign cart's name slot
 *  → the asm label its `StringTableModel` entry is keyed by. */
export function levelNameSlotLabels(fileText: string): string[] {
  return parsePointerTable(fileText)
}

/** Ordered list of body labels the pointer table references (one per slot). */
function parsePointerTable(fileText: string): string[] {
  const lines = fileText.split('\n')
  const start = lines.findIndex((l) => {
    const t = stripComment(l).trim()
    return PTR_TABLE_LABELS.some((p) => t === `${p}:`)
  })
  if (start < 0) return []
  const refs: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const code = stripComment(lines[i]).trim()
    const m = /^dw\s+([A-Za-z_.][\w.]*)$/.exec(code)
    if (m) {
      refs.push(m[1])
      continue
    }
    if (refs.length === 0) continue // skip alias label line(s) before the first dw
    break // first non-dw line after the table ends it
  }
  return refs
}

/** Friendly name for a pointer-table slot, or null for a padding slot. */
function slotName(slotIndex: number): string | null {
  const world = Math.floor(slotIndex / 12) + 1
  const within = slotIndex % 12
  if (within <= 7) return `${world}-${within + 1}`
  if (within === 8) return `Extra ${world}`
  return null
}

function buildNameMap(fileText: string): Map<string, string> {
  const byLabel = new Map<string, string>()
  parsePointerTable(fileText).forEach((label, slot) => {
    const name = slotName(slot)
    if (name && !byLabel.has(label)) byLabel.set(label, name)
  })
  return byLabel
}

/** Name a cutscene text block's entries by their physical order — "<title> N"
 *  (1-based), or just "<title>" for a single-entry block. For sequential text
 *  with no external name table (the intro storybook, the ending). The asm
 *  `DATA_<addr>` label still rides along in parens. */
function sequentialNames(entries: { label: string }[], title: string): Map<string, string> {
  return new Map(
    entries.map((e, i) => [e.label, entries.length > 1 ? `${title} ${i + 1}` : title])
  )
}

/** Build the editor model entries. The display name uses the friendly label when
 *  available with the asm label in parens (e.g. "1-1 (DATA_514A73)"); otherwise
 *  just the asm label, preferring the longest when a body has several (the more
 *  descriptive alias, e.g. `DATA_welcome_to_yoshis_island` over `DATA_welcome_to_yoshis_island`). */
function entriesToModel(
  entries: ParsedEntry[],
  nameByLabel: Map<string, string>
): StringTableEntry[] {
  return entries.map((e) => {
    const longest = longestLabel(e.labels)
    const friendly = nameByLabel.get(e.label)
    return {
      label: e.label,
      name: friendly ? `${friendly} (${longest})` : longest,
      lines: e.lines.map((l) => l.text)
    }
  })
}

/** Per-table strategy for the friendly entry name, given the parsed entries and
 *  the full file text (some strategies, like level names, read another table). */
type NameStrategy = (entries: ParsedEntry[], contentText: string) => Map<string, string>

/** Generic region parse: extract the editable entries, name them per strategy,
 *  and size the budget against the pristine base. Throws if markers are absent. */
function parseStringTableRegion(
  contentText: string,
  budgetText: string,
  ft: FontTable,
  id: string,
  title: string,
  nameStrategy?: NameStrategy,
  opts: RegionBudgetOptions = {}
): StringTableModel {
  const { region: contentRegion, budgetRegion } = requireRegionPair(contentText, budgetText, id)
  const entries = parseRegionEntries(contentRegion.inner)
  const nameByLabel = nameStrategy ? nameStrategy(entries, contentText) : new Map<string, string>()
  return {
    id,
    title,
    allowedChars: ft.chars,
    budgetChars: totalChars(parseRegionEntries(budgetRegion.inner)),
    ...(opts.headroomBytes ? { headroomBytes: opts.headroomBytes } : {}),
    ...(id === LEVEL_NAME_STRINGS_ID ? { headroomLabel: FREE_TAIL_LABEL } : {}),
    entries: entriesToModel(entries, nameByLabel)
  }
}

/**
 * Parse a string table from a Bank51 file's text into the editor model.
 * `budgetText` (the pristine base) sets the fixed byte budget; `contentText`
 * (overlay-first) supplies the current entries. Pass the same text for both
 * when there's no overlay. Throws if the `;@editable` markers are absent.
 */
export function parseLevelNameStrings(
  contentText: string,
  budgetText: string,
  ft: FontTable,
  opts: RegionBudgetOptions = {}
): StringTableModel {
  return parseStringTableRegion(
    contentText,
    budgetText,
    ft,
    LEVEL_NAME_STRINGS_ID,
    'Level Names',
    (_entries, text) => buildNameMap(text),
    opts
  )
}

// ── Glyph-line tables (intro storybook / ending) ───────────────────────────
// Like the level-name in-place splice, but each text line is plain Main.txt text
// PLUS insertable `[glyph]` tokens (button icons, star, …) emitted as raw font
// bytes — `db "a",$F6,$F7,"b"`. The cutscene layout/control directives (intro
// `$FE/$FD/$FC` byte directives, ending `$xxFF` word directives) are SEPARATE
// directives, left byte-for-byte untouched; only text `db` directives flow
// through the glyph-line codec. Verified safe: both renderers use the message
// font and no glyph byte collides with either region's control bytes.

/** A located editable text line: its decoded markup (text + `[glyph]`s), the
 *  char range of its `db` argument list within the region body (for the splice),
 *  and its byte cost (text chars + glyph bytes). */
interface GlyphLocatedLine {
  markup: string
  argStart: number
  argEnd: number
  bytes: number
}

interface GlyphParsedEntry {
  label: string
  labels: string[]
  lines: GlyphLocatedLine[]
}

/** Matches a `db` directive, capturing leading indent + the `db ` keyword (group
 *  1) so the argument list starts right after it. */
const DB_DIRECTIVE_RE = /^(\s*db\s+)(\S.*)$/

/** Byte cost of a parsed text-line arg list (text chars × 1 + one per glyph byte). */
function argsByteCount(args: ReturnType<typeof parseDbArgs>): number {
  if (!args) return 0
  let n = 0
  for (const a of args) n += a.kind === 'text' ? [...a.value].length : 1
  return n
}

/**
 * Walk a region body into entries, directive-aware: a label begins an entry; a
 * `db` directive whose args contain a quoted run is a TEXT line (decoded to
 * markup, arg span recorded). `db $XX,…` / `dw …` control directives have no
 * quoted run and are skipped (preserved verbatim by the splice). Entries with no
 * text lines are dropped.
 */
function parseGlyphLineRegion(inner: string): GlyphParsedEntry[] {
  return walkLabeledEntries<GlyphParsedEntry>(
    inner,
    (label) => ({ label, labels: [label], lines: [] }),
    (e) => e.lines.length > 0,
    (e, _rawLine, code, lineStart) => {
      const dbm = DB_DIRECTIVE_RE.exec(code)
      if (!dbm) return
      const argText = dbm[2].replace(/\s+$/, '') // drop trailing ws before any comment
      const args = parseDbArgs(argText)
      if (!isTextLineArgs(args)) return // control directive — leave untouched
      const argStart = lineStart + dbm[1].length
      e.lines.push({
        markup: dbArgsToLine(args!),
        argStart,
        argEnd: argStart + argText.length,
        bytes: argsByteCount(args)
      })
    }
  )
}

function totalGlyphBytes(entries: GlyphParsedEntry[]): number {
  let n = 0
  for (const e of entries) for (const l of e.lines) n += l.bytes
  return n
}

/** Parse a glyph-line region (intro/ending) into the editor model. `contentText`
 *  (overlay-first) supplies the current lines; `budgetText` (pristine base) sizes
 *  the byte budget. Entries are named sequentially (`title N`). */
function parseGlyphLineTable(
  contentText: string,
  budgetText: string,
  ft: FontTable,
  id: string,
  title: string,
  namePrefix: string
): StringTableModel {
  const { region, budgetRegion } = requireRegionPair(contentText, budgetText, id)
  const entries = parseGlyphLineRegion(region.inner)
  const nameByLabel = sequentialNames(entries, namePrefix)
  return {
    id,
    title,
    allowedChars: ft.chars,
    budgetChars: totalGlyphBytes(parseGlyphLineRegion(budgetRegion.inner)),
    glyphLines: true,
    markupGuide: GLYPH_GUIDE,
    entries: entries.map((e) => {
      const longest = longestLabel(e.labels)
      const friendly = nameByLabel.get(e.label)
      return {
        label: e.label,
        name: friendly ? `${friendly} (${longest})` : longest,
        lines: e.lines.map((l) => l.markup)
      }
    })
  }
}

/** Parse the intro storybook text (Bank0F) — one entry per cutscene screen,
 *  named "Page N". Text + insertable `[glyph]` tokens; control bytes preserved. */
export function parseIntroStory(
  contentText: string,
  budgetText: string,
  ft: FontTable
): StringTableModel {
  return parseGlyphLineTable(contentText, budgetText, ft, INTRO_STORY_ID, 'Intro Story', 'Page')
}

/** Parse the ending/epilogue text (Bank0D) — a single entry of several lines,
 *  named "Ending". Text + insertable `[glyph]` tokens; control bytes preserved. */
export function parseEndingText(
  contentText: string,
  budgetText: string,
  ft: FontTable
): StringTableModel {
  return parseGlyphLineTable(contentText, budgetText, ft, ENDING_TEXT_ID, 'Ending Text', 'Ending')
}

/**
 * Splice edited glyph-line table entries back onto `contentText` (overlay-first),
 * sizing the byte budget from `budgetText` (pristine base). Re-emits only CHANGED
 * lines (encode markup → `db` arg list); unchanged lines + all control directives
 * stay byte-for-byte. Validates charset / glyph tokens / line-count / budget.
 */
function serializeGlyphLineTable(
  contentText: string,
  budgetText: string,
  model: StringTableModel,
  ft: FontTable,
  id: string
): SerializeResult {
  return serializeEntryTable({
    contentText,
    budgetText,
    id,
    model,
    parse: parseGlyphLineRegion,
    totalCost: totalGlyphBytes,
    budgetNoun: 'byte(s)',
    diffEntry: (baseEntry, edited) => {
      const lines = edited ? edited.lines : baseEntry.lines.map((l) => l.markup)
      if (edited && edited.lines.length !== baseEntry.lines.length) {
        return {
          error: `Entry "${baseEntry.label}" has ${edited.lines.length} line(s); the cart expects ${baseEntry.lines.length}.`
        }
      }
      const edits: TextEdit[] = []
      let cost = 0
      for (let i = 0; i < baseEntry.lines.length; i++) {
        const orig = baseEntry.lines[i]
        const want = lines[i]
        if (want === orig.markup) {
          cost += orig.bytes
          continue
        }
        const enc = encodeLineToDbArgs(want, ft)
        if (!enc.ok) return { error: `Entry "${baseEntry.label}": ${enc.error}` }
        cost += enc.bytes
        edits.push({ start: orig.argStart, end: orig.argEnd, replacement: enc.args })
      }
      return { cost, edits }
    }
  })
}

/** Total message byte size of a message region (the shared byte budget). */
function messageRegionBytes(inner: string, ft: FontTable): number {
  let total = 0
  for (const e of splitMessageEntries(inner)) {
    const bytes = messageBodyToBytes(e.body, ft)
    if (!bytes) continue
    const dec = decodeMessageBytes(bytes, 0, ft.byteToChar)
    if (dec.ok) total += dec.bytesConsumed
  }
  return total
}

/** A message body's address label is the disassembly's `DATA_<bank><offset4>`
 *  symbol (e.g. `DATA_5140D3` = SNES `$51:40D3`) — the reference-cart memory
 *  address the body sits at. A friendly-aliased body carries it as a second
 *  label line right before the alias (an empty-body entry); a non-aliased body
 *  uses it as its only label. */
const MSG_ADDR_LABEL_RE = /^DATA_([0-9A-Fa-f]{6})$/

/** A decoded message body: its primary label (the edit/reference key), display
 *  name, every asm label that resolves to it, and its markup. */
interface MessageBody {
  /** Primary label — friendly alias if present, else the address label. */
  primaryLabel: string
  /** Display name: friendly alias + reference address, or the bare address label. */
  name: string
  /** All labels that resolve to this body (primary + its address sibling). The
   *  pointer table may reference a body by either, so both map to the primary. */
  labels: string[]
  /** Decoded markup string (plain text + `[token]`s). */
  markup: string
}

/** Walk a message-text region body into decoded message bodies, pairing each
 *  body's `DATA_<bank><offset>` address label with its friendly alias (when the
 *  body carries both). Shared by the message-text editor and the pointer-table
 *  editor (which needs the alias+address name and label→body resolution). */
function messageBodies(inner: string, ft: FontTable): MessageBody[] {
  const bodies: MessageBody[] = []
  // The `DATA_<bank><offset>` label addressing the next body — for an aliased
  // body the (empty) entry right before the alias, for a non-aliased one the
  // body's own label. Reset after each body so a missing address label can't
  // leak a stale address onto a later message.
  let addrLabel: string | null = null
  for (const e of splitMessageEntries(inner)) {
    if (MSG_ADDR_LABEL_RE.test(e.label)) addrLabel = e.label
    const bytes = messageBodyToBytes(e.body, ft)
    if (!bytes) continue
    const dec = decodeMessageBytes(bytes, 0, ft.byteToChar)
    if (!dec.ok) continue // not a terminated message body (header/padding)
    // Prefer the friendly alias for display, with the reference-cart memory
    // address (from the `DATA_<bank><offset>` symbol) in parens. A body with no
    // alias is keyed by that address label itself — show it bare (the address is
    // already the name, so no redundant parenthetical).
    const m = addrLabel ? MSG_ADDR_LABEL_RE.exec(addrLabel) : null
    const aliased = !MSG_ADDR_LABEL_RE.test(e.label)
    const name = aliased && m ? `${e.label} (0x${m[1].toUpperCase()})` : e.label
    const labels = aliased && addrLabel ? [e.label, addrLabel] : [e.label]
    bodies.push({ primaryLabel: e.label, name, labels, markup: dec.markup })
    addrLabel = null
  }
  return bodies
}

/**
 * Parse the message-text region into the MARKUP model: each message body's
 * `dw`/`db` directives are assembled to bytes (msg-asm) then decoded to an
 * editable markup string (msg-markup) — plain text + `[token]`s for control codes
 * and special glyphs. `budgetText` (pristine base) sets the byte budget.
 */
export function parseMessageText(
  contentText: string,
  budgetText: string,
  ft: FontTable,
  opts: RegionBudgetOptions = {}
): StringTableModel {
  const region = findRegion(contentText, MESSAGE_TEXT_ID)
  if (!region) throw new Error(`Bank51 is missing the ;@editable:${MESSAGE_TEXT_ID} markers.`)
  const budgetRegion = findRegion(budgetText, MESSAGE_TEXT_ID)
  if (!budgetRegion) throw new Error(`Base Bank51 is missing the ;@editable:${MESSAGE_TEXT_ID} markers.`)

  const entries: StringTableEntry[] = messageBodies(region.inner, ft).map((b) => ({
    label: b.primaryLabel,
    name: b.name,
    lines: [],
    markup: b.markup
  }))
  return {
    id: MESSAGE_TEXT_ID,
    title: 'Message Text',
    allowedChars: ft.chars,
    budgetChars: messageRegionBytes(budgetRegion.inner, ft),
    ...(opts.headroomBytes ? { headroomBytes: opts.headroomBytes } : {}),
    headroomLabel: FREE_TAIL_LABEL,
    entries,
    markup: true,
    markupGuide: MARKUP_GUIDE
  }
}


export type SerializeResult =
  | { ok: true; text: string }
  | { ok: false; error: string }

/**
 * Splice the model's edited text back onto `contentText` (overlay-first, so a
 * sibling region's existing edits in the same file survive) while sizing the
 * fixed byte budget from `budgetText` (the pristine base). Pass the same text for
 * both when there's no overlay. Validates the font charset and the budget; on any
 * violation returns an error and does not produce text. Only `"..."` contents
 * change — everything else in the file is preserved byte-for-byte.
 */
function serializeStringTable(
  contentText: string,
  budgetText: string,
  model: StringTableModel,
  ft: FontTable,
  id: string,
  budget: RegionBudgetOptions = {}
): SerializeResult {
  return serializeEntryTable({
    contentText,
    budgetText,
    id,
    model,
    parse: parseRegionEntries,
    totalCost: totalChars,
    budgetNoun: 'character(s)',
    ...(budget.headroomBytes ? { headroomBytes: budget.headroomBytes } : {}),
    headroomLabel: FREE_TAIL_LABEL,
    diffEntry: (baseEntry, edited) => {
      const lines = edited ? edited.lines : baseEntry.lines.map((l) => l.text)
      if (edited && edited.lines.length !== baseEntry.lines.length) {
        return {
          error: `Entry "${baseEntry.label}" has ${edited.lines.length} line(s); the cart expects ${baseEntry.lines.length}.`
        }
      }
      const edits: TextEdit[] = []
      let cost = 0
      for (let i = 0; i < baseEntry.lines.length; i++) {
        const text = lines[i]
        const bad = invalidChars(text, ft)
        if (bad.length > 0) {
          return {
            error: `Unsupported character(s) ${bad.map((c) => JSON.stringify(c)).join(', ')} in "${text}".`
          }
        }
        cost += [...text].length
        const orig = baseEntry.lines[i]
        if (text !== orig.text) {
          edits.push({ start: orig.start, end: orig.end, replacement: escapeDefineBangs(text) })
        }
      }
      return { cost, edits }
    }
  })
}

export function serializeLevelNameStrings(
  contentText: string,
  budgetText: string,
  model: StringTableModel,
  ft: FontTable,
  opts: RegionBudgetOptions = {}
): SerializeResult {
  return serializeStringTable(contentText, budgetText, model, ft, LEVEL_NAME_STRINGS_ID, opts)
}

export function serializeIntroStory(
  contentText: string,
  budgetText: string,
  model: StringTableModel,
  ft: FontTable
): SerializeResult {
  return serializeGlyphLineTable(contentText, budgetText, model, ft, INTRO_STORY_ID)
}

export function serializeEndingText(
  contentText: string,
  budgetText: string,
  model: StringTableModel,
  ft: FontTable
): SerializeResult {
  return serializeGlyphLineTable(contentText, budgetText, model, ft, ENDING_TEXT_ID)
}

// ── Credits staff-roll text (Bank00 OAM letter streams) ────────────────────
// Unlike every other region, the credits pages are raw `dw` word streams (OAM
// letter records), not quoted text literals — decoded/encoded by the
// asm/credits-staff codec. Each entry = one page body (label + `dw` rows); a
// changed page's body is re-emitted whole (its label survives, so the symbolic
// pointer table `DATA_00D2C2` — outside the region — re-resolves via asar).
// Budget = the pristine base region's total stream bytes: the streams live
// inside the boot-relocated WRAM code block, so growth is capped (shrinking is
// fine — asar recomputes every following label).

/** Marker id of the credits staff-roll letter-stream region in Bank00. */
export const CREDITS_STAFF_ID = 'credits-staff'

/** The symbolic per-page pointer table (outside the region; slot order = the
 *  roll's page order — some slots share a body, e.g. the opening heading). */
const CREDITS_PTR_TABLE_LABEL = 'DATA_00D2C2'

interface CreditsParsedEntry {
  label: string
  labels: string[]
  bytes: number[]
  /** Char range of the entry's `dw` body within the region inner (splice target). */
  bodyStart: number
  bodyEnd: number
}

const DW_WORDS_RE = /^\s*dw\s+(\S.*)$/

/** Walk the credits region body: a label begins an entry; `dw $XXXX,…` rows are
 *  its stream words (2 bytes LE each). The body span covers the entry's dw rows
 *  (label lines excluded), so a re-emit swaps only the data. */
function parseCreditsRegion(inner: string): CreditsParsedEntry[] {
  return walkLabeledEntries<CreditsParsedEntry>(
    inner,
    (label) => ({ label, labels: [label], bytes: [], bodyStart: -1, bodyEnd: -1 }),
    (e) => e.bytes.length > 0,
    (e, rawLine, code, lineStart) => {
      const m = DW_WORDS_RE.exec(code)
      if (!m) return
      const rowBytes: number[] = []
      for (const tok of m[1].split(',')) {
        const w = /^\s*\$([0-9A-Fa-f]{1,4})\s*$/.exec(tok)
        if (!w) return // symbolic dw (a pointer row) — not stream data
        const v = parseInt(w[1], 16)
        rowBytes.push(v & 0xff, (v >> 8) & 0xff)
      }
      if (e.bodyStart < 0) e.bodyStart = lineStart
      e.bodyEnd = lineStart + rawLine.length
      e.bytes.push(...rowBytes)
    }
  )
}

/** Total stream bytes across the region's page bodies (the credits budget). */
const creditsStreamBytes = (entries: CreditsParsedEntry[]): number =>
  entries.reduce((a, e) => a + e.bytes.length, 0)

/** Per-page display names from the pointer table's slot order: "Page N" (or
 *  "Pages N & M" for a shared body), with a text snippet from the first line. */
function creditsPageNames(
  fileText: string,
  entries: CreditsParsedEntry[],
  ft: FontTable
): Map<string, string> {
  const lines = fileText.split('\n')
  const start = lines.findIndex((l) => stripComment(l).trim() === `${CREDITS_PTR_TABLE_LABEL}:`)
  const slotsByLabel = new Map<string, number[]>()
  if (start >= 0) {
    let slot = 0
    for (let i = start + 1; i < lines.length; i++) {
      const code = stripComment(lines[i]).trim()
      const m = /^dw\s+(\S.*)$/.exec(code)
      if (!m) {
        if (slot === 0) continue
        break
      }
      for (const tok of m[1].split(',')) {
        const label = tok.trim()
        if (!/^[A-Za-z_.][\w.]*$/.test(label)) continue
        const arr = slotsByLabel.get(label) ?? []
        arr.push(slot)
        slotsByLabel.set(label, arr)
        slot++
      }
    }
  }
  const names = new Map<string, string>()
  entries.forEach((e, i) => {
    const slots = e.labels.flatMap((l) => slotsByLabel.get(l) ?? [])
    const pageNo =
      slots.length > 1
        ? `Pages ${slots.map((s) => s + 1).join(' & ')}`
        : `Page ${slots.length === 1 ? slots[0] + 1 : i + 1}`
    const first = decodeCreditsPage(e.bytes, ft)[0]?.markup ?? ''
    const snippet = first.length > 22 ? `${first.slice(0, 22)}…` : first
    names.set(e.label, snippet ? `${pageNo} — ${snippet}` : pageNo)
  })
  return names
}

/** Parse the credits staff-roll region into the editor model — one entry per
 *  page body, lines = decoded markup (text + `[glyph]`/`[$XX]` tokens). */
export function parseCreditsStaff(
  contentText: string,
  budgetText: string,
  ft: FontTable
): StringTableModel {
  const { region, budgetRegion } = requireRegionPair(contentText, budgetText, CREDITS_STAFF_ID)
  const entries = parseCreditsRegion(region.inner)
  const names = creditsPageNames(contentText, entries, ft)
  return {
    id: CREDITS_STAFF_ID,
    title: 'Credits',
    allowedChars: ft.chars,
    budgetChars: creditsStreamBytes(parseCreditsRegion(budgetRegion.inner)),
    glyphLines: true,
    byteCost: 'credits-page',
    markupGuide: GLYPH_GUIDE,
    entries: entries.map((e) => ({
      label: e.label,
      name: names.get(e.label) ?? e.label,
      lines: decodeCreditsPage(e.bytes, ft).map((l) => l.markup)
    }))
  }
}

/** Format a page's stream bytes as `dw` rows (8 words per row, original shape). */
function creditsBytesToDwRows(bytes: readonly number[]): string {
  const words: string[] = []
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    words.push(`$${((bytes[i]! | (bytes[i + 1]! << 8)) >>> 0).toString(16).toUpperCase().padStart(4, '0')}`)
  }
  const rows: string[] = []
  for (let i = 0; i < words.length; i += 8) rows.push(`\tdw ${words.slice(i, i + 8).join(',')}`)
  return rows.join('\n')
}

/** Serialize edited credits pages: a changed page re-encodes (letters from the
 *  markup, advances from the font width table, X re-centered, Y preserved from
 *  the base page) and its `dw` body is re-emitted; unchanged pages stay
 *  byte-for-byte. Budget: total stream bytes ≤ the pristine base total. */
export function serializeCreditsStaff(
  contentText: string,
  budgetText: string,
  model: StringTableModel,
  ft: FontTable
): SerializeResult {
  return serializeEntryTable({
    contentText,
    budgetText,
    id: CREDITS_STAFF_ID,
    model,
    parse: parseCreditsRegion,
    totalCost: creditsStreamBytes,
    budgetNoun: 'letter(s)',
    budgetUnitBytes: 2,
    diffEntry: (baseEntry, edited) => {
      const baseLines = decodeCreditsPage(baseEntry.bytes, ft)
      const lines = edited ? edited.lines : baseLines.map((l) => l.markup)
      if (lines.length === baseLines.length && lines.every((l, i) => l === baseLines[i].markup)) {
        return { cost: baseEntry.bytes.length, edits: [] }
      }
      const enc = encodeCreditsPage(
        lines,
        baseLines.map((l) => l.y),
        ft
      )
      if (!enc.ok) return { error: `"${edited?.name ?? baseEntry.label}": ${enc.error}` }
      return {
        cost: enc.bytes.length,
        edits: [{ start: baseEntry.bodyStart, end: baseEntry.bodyEnd, replacement: creditsBytesToDwRows(enc.bytes) }]
      }
    }
  })
}

/**
 * Serialize the markup model back into the message region: re-emit only the
 * messages whose markup changed (encode markup → bytes → `dw`/`db` directives),
 * preserving every unedited message's original text byte-for-byte. Splices onto
 * `contentText` (overlay-first, so a sibling region's edits in the same file
 * survive); sizes the shared byte budget from `budgetText` (the pristine base).
 * Validates the budget + the markup (charset / known tokens) via the codec.
 */
export function serializeMessageText(
  contentText: string,
  budgetText: string,
  model: StringTableModel,
  ft: FontTable,
  opts: RegionBudgetOptions = {}
): SerializeResult {
  const pair = findRegionPair(contentText, budgetText, MESSAGE_TEXT_ID)
  if (typeof pair === 'string') return { ok: false, error: pair }
  const { region, budgetRegion } = pair
  const fontMap = ft.byteToChar
  const byLabel = new Map(model.entries.map((e) => [e.label, e]))
  const contentEntries = splitMessageEntries(region.inner)
  const stale = staleEntryError(model.entries, new Set(contentEntries.map((e) => e.label)))
  if (stale) return { ok: false, error: stale }

  const baseBytes = messageRegionBytes(budgetRegion.inner, ft)
  const headroom = Math.max(0, opts.headroomBytes ?? 0)
  const budget = baseBytes + headroom
  const edits: TextEdit[] = []
  let newTotal = 0
  for (const e of contentEntries) {
    const bytes = messageBodyToBytes(e.body, ft)
    if (!bytes) continue
    const dec = decodeMessageBytes(bytes, 0, fontMap)
    if (!dec.ok) continue
    const markup = byLabel.get(e.label)?.markup ?? dec.markup
    if (markup === dec.markup) {
      newTotal += dec.bytesConsumed // unchanged — keep the original body
      continue
    }
    const enc = encodeMessageMarkup(markup, ft)
    if (enc.error) return { ok: false, error: `Message "${e.label}": ${enc.error}` }
    newTotal += enc.bytes.length
    edits.push({
      start: e.bodyStart,
      end: e.bodyEnd,
      replacement: bytesToMessageDirectives(enc.bytes, fontMap) + '\n'
    })
  }

  if (newTotal > budget) {
    const room = headroom > 0 ? ` (${baseBytes} + ${headroom} of ${FREE_TAIL_LABEL})` : ''
    return {
      ok: false,
      error: `Messages use ${newTotal} bytes but the budget is ${budget}${room}. Shorten ${newTotal - budget} byte(s).`
    }
  }

  return { ok: true, text: spliceRegion(contentText, MESSAGE_TEXT_ID, applyEdits(region.inner, edits)) }
}

/**
 * How far the message region in `contentText` (overlay-first) has grown past the
 * pristine base — the bytes it claims from bank $51's `$FF` tail. The build
 * feeds this (summed with its sibling, see `bank51SpillBytes`) to the free-region
 * head shift so the tail's `%FREE_BYTES` boundary moves out of the way; it is
 * also what the Strings panel reports as free space used.
 *
 * Exact, not an estimate: `messageRegionBytes` sums the region's assembled body
 * bytes, and in the base it equals the region's span ($51:1333–$51:49BC = 13961),
 * so the delta IS the number of bytes everything after the region shifts by.
 * Never negative — a region that shrank leaves `$FF` behind (asar re-fills it),
 * it doesn't pull the boundary back.
 */
export function messageSpillBytes(contentText: string, baseText: string, ft: FontTable): number {
  const region = findRegion(contentText, MESSAGE_TEXT_ID)
  const baseRegion = findRegion(baseText, MESSAGE_TEXT_ID)
  if (!region || !baseRegion) return 0
  return Math.max(0, messageRegionBytes(region.inner, ft) - messageRegionBytes(baseRegion.inner, ft))
}

/**
 * The level-name region's counterpart to {@link messageSpillBytes}. Its budget is
 * counted in CHARACTERS, but the splice only ever rewrites `"…"` literal contents
 * (every control byte is preserved), and the font encodes one byte per char — so
 * the char delta IS the byte delta, and the region grows by exactly that much.
 * The name strings are the LAST data in the bank before the `$FF` tail, so this
 * adds straight onto the message region's spill.
 */
export function levelNameSpillBytes(contentText: string, baseText: string): number {
  const region = findRegion(contentText, LEVEL_NAME_STRINGS_ID)
  const baseRegion = findRegion(baseText, LEVEL_NAME_STRINGS_ID)
  if (!region || !baseRegion) return 0
  return Math.max(
    0,
    totalChars(parseRegionEntries(region.inner)) - totalChars(parseRegionEntries(baseRegion.inner))
  )
}

/**
 * Total bytes bank $51's two growable text regions claim from its `$FF` tail —
 * what the build shifts the tail's `%FREE_BYTES` boundary by (relocate.ts
 * `stringSpillBytes`). They share one tail and both sit immediately before it
 * (messages → name pointer table → name strings → tail), so their growth simply
 * adds: everything downstream is label-addressed and asar re-resolves it.
 */
export function bank51SpillBytes(contentText: string, baseText: string, ft: FontTable): number {
  return messageSpillBytes(contentText, baseText, ft) + levelNameSpillBytes(contentText, baseText)
}

// ── Message-pointer table (DATA_message_box_text_ptrs) ──────────────────────
// 300 symbolic `dw <body>` slots indexed by message ID. The editor repoints a
// slot (swap the label) but never adds/removes — the table is fixed-size, so
// there's no byte budget. Saves are a format-preserving in-place splice of only
// the changed slots' label arguments (comments / blank lines / order preserved).

/** First plain-text line of a message (markup tokens stripped, whitespace
 *  collapsed, clipped) — for identifying a slot's target at a glance. */
function messagePreview(markup: string): string {
  const text = markup.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length > 60 ? `${text.slice(0, 59)}…` : text
}

/** A located `dw <label>` slot: its target label plus the char range of the
 *  label argument within the region body, so a save can splice it in place. */
interface PtrSlot {
  target: string
  argStart: number
  argEnd: number
}

const PTR_SLOT_RE = /^(\s*dw\s+)(\S+)\s*$/

/** Parse a pointer-table region body into its `dw <label>` slots, in order (slot
 *  index = message ID). Non-`dw` lines (the region comment, blanks) are skipped. */
function parsePtrSlots(inner: string): PtrSlot[] {
  const slots: PtrSlot[] = []
  let offset = 0
  for (const raw of inner.split('\n')) {
    const lineStart = offset
    offset += raw.length + 1 // + the consumed '\n'
    const m = PTR_SLOT_RE.exec(stripComment(raw))
    if (!m) continue
    const argStart = lineStart + m[1].length
    slots.push({ target: m[2], argStart, argEnd: argStart + m[2].length })
  }
  return slots
}

/** Resolve a slot's `dw` argument to a model slot value: '' for the `$0000` null
 *  slot, else the body primary label `labelToPrimary` maps it to, else the raw
 *  label (a target with no decoded body — preserved as-is). */
function resolveSlotTarget(target: string, labelToPrimary: Map<string, string>): string {
  if (/^\$?0+$/.test(target)) return '' // $0000 / $0 / 0 → null slot
  return labelToPrimary.get(target) ?? target
}

/** label → primary-body-label map (every alias + address resolves to the body's
 *  primary label), built from the message-text region's bodies. */
function messageLabelIndex(msgInner: string, ft: FontTable): Map<string, string> {
  const labelToPrimary = new Map<string, string>()
  for (const b of messageBodies(msgInner, ft)) {
    for (const l of b.labels) labelToPrimary.set(l, b.primaryLabel)
  }
  return labelToPrimary
}

/**
 * Parse `DATA_message_box_text_ptrs` (the `;@editable:message-box-text-ptrs`
 * region) into the dropdown model: the selectable message bodies (`options`,
 * from the sibling message-text region) and the per-slot body each `dw`
 * resolves to. `budgetText` is unused — the table is fixed-size.
 */
export function parseMessagePtrTable(
  contentText: string,
  _budgetText: string,
  ft: FontTable
): MessagePtrTableModel {
  const region = findRegion(contentText, MESSAGE_PTR_TABLE_ID)
  if (!region) throw new Error(missingMarkers(MESSAGE_PTR_TABLE_ID, false))
  const msgRegion = findRegion(contentText, MESSAGE_TEXT_ID)
  if (!msgRegion) throw new Error(missingMarkers(MESSAGE_TEXT_ID, false))

  const bodies = messageBodies(msgRegion.inner, ft)
  const labelToPrimary = messageLabelIndex(msgRegion.inner, ft)

  const options: MessagePtrOption[] = bodies.map((b) => ({
    id: b.primaryLabel,
    name: b.name,
    preview: messagePreview(b.markup)
  }))
  const optionIds = new Set(options.map((o) => o.id))
  const slots = parsePtrSlots(region.inner).map((s) => resolveSlotTarget(s.target, labelToPrimary))
  // A slot pointing at a label with no decoded body (never in the base cart, but
  // an out-of-date overlay could) gets a fallback option, so the dropdown can
  // still show + round-trip it rather than silently dropping the slot.
  for (const id of slots) {
    if (id !== '' && !optionIds.has(id)) {
      optionIds.add(id)
      options.push({ id, name: id, preview: '' })
    }
  }
  return { kind: 'pointer-table', id: MESSAGE_PTR_TABLE_ID, title: 'Message Pointers', options, slots }
}

/**
 * Splice the edited slots back into the pointer-table region: re-emit only the
 * slots whose target changed (swap the `dw` label argument), preserving every
 * unchanged slot — and all comments / blank lines / formatting — byte-for-byte.
 * Writes onto `contentText` (overlay-first). `budgetText` is unused (fixed size).
 */
export function serializeMessagePtrTable(
  contentText: string,
  _budgetText: string,
  model: MessagePtrTableModel,
  ft: FontTable
): SerializeResult {
  const region = findRegion(contentText, MESSAGE_PTR_TABLE_ID)
  if (!region) return { ok: false, error: missingMarkers(MESSAGE_PTR_TABLE_ID, false) }
  const msgRegion = findRegion(contentText, MESSAGE_TEXT_ID)
  if (!msgRegion) return { ok: false, error: missingMarkers(MESSAGE_TEXT_ID, false) }
  const labelToPrimary = messageLabelIndex(msgRegion.inner, ft)
  const validIds = new Set(model.options.map((o) => o.id))

  const slots = parsePtrSlots(region.inner)
  if (slots.length !== model.slots.length) {
    return {
      ok: false,
      error: `Pointer table has ${slots.length} slots; the editor has ${model.slots.length} (out of date?).`
    }
  }

  const edits: TextEdit[] = []
  for (let i = 0; i < slots.length; i++) {
    const want = model.slots[i] // '' = null ($0000), else a body primary label
    const orig = resolveSlotTarget(slots[i].target, labelToPrimary)
    if (want === orig) continue // untouched — preserve the original label byte-for-byte
    if (want !== '' && !validIds.has(want)) {
      return { ok: false, error: `Slot ${i} points at unknown message "${want}".` }
    }
    edits.push({
      start: slots[i].argStart,
      end: slots[i].argEnd,
      replacement: want === '' ? '$0000' : want
    })
  }

  return { ok: true, text: spliceRegion(contentText, MESSAGE_PTR_TABLE_ID, applyEdits(region.inner, edits)) }
}

/** One foreign message body decoded from a cart. */
export interface ForeignMessage {
  /** Decoded markup (plain text + `[token]`s). Empty when `ok` is false. */
  markup: string
  /** True when a `$FFFF` terminator was found within bounds (a real message). */
  ok: boolean
  /** True when this message's pointer slot is `$0000` — the hack deleted it (vs a
   *  valid pointer that simply failed to decode, which leaves `ok` false but
   *  `removed` false). */
  removed?: boolean
}

/** `DATA_message_box_text_ptrs` — message-ID → 16-bit `$51:xxxx` low word. */
export const MESSAGE_PTR_TABLE_SNES = 0x5110db
/** Slot count: the table runs $51:10DB up to the first payload at $51:1333. */
export const MESSAGE_PTR_COUNT = (0x1333 - 0x10db) / 2

/**
 * Decode a target cart's message bodies, keyed by base asm label, by FOLLOWING
 * the message pointer table (`$51:10DB`) — NOT by reading at the base label's
 * baked `$51:XXXX` address. A hack can repoint the table (GoldenEgg edits in
 * place, but a from-scratch repack like Flutter rewrites every slot), so message
 * N lives at a different offset than the base build and an address read would
 * decode a misaligned fragment that still *looks* like text. We map each editable
 * body's base low-word → its message ID (via the BASE/reference table) → the
 * target offset (via the TARGET cart's table), then decode there.
 *
 * `referenceCart` supplies the base pointer table; `cart` is the cart being read
 * (pass the base cart for both to read the base side). A body whose target slot
 * is `$0000` (removed in the hack) returns `ok: false`. The ROM importer uses
 * this to diff a modified cart's messages against base.
 */
export function readForeignMessages(
  cart: Buffer | Uint8Array,
  referenceCart: Buffer | Uint8Array,
  baseText: string,
  ft: FontTable
): Map<string, ForeignMessage> {
  const out = new Map<string, ForeignMessage>()
  const region = findRegion(baseText, MESSAGE_TEXT_ID)
  if (!region) return out
  const ptPc = snesToPC(MESSAGE_PTR_TABLE_SNES)
  const rd16 = (buf: Buffer | Uint8Array, off: number): number =>
    off >= 0 && off + 1 < buf.length ? buf[off] | (buf[off + 1] << 8) : 0

  // Map each editable body's base low-word → the first message ID that points at
  // it (restricted to the body words, so a stray non-pointer read can't collide).
  const entries = splitMessageEntries(region.inner)
  const bodyWords = new Set<number>()
  for (const e of entries) {
    const m = /DATA_51([0-9A-Fa-f]{4})/.exec(e.label)
    if (m) bodyWords.add(parseInt(m[1], 16))
  }
  const idByBaseWord = new Map<number, number>()
  for (let id = 0; id < MESSAGE_PTR_COUNT; id++) {
    const w = rd16(referenceCart, ptPc + id * 2)
    if (bodyWords.has(w) && !idByBaseWord.has(w)) idByBaseWord.set(w, id)
  }

  for (const e of entries) {
    const m = /DATA_51([0-9A-Fa-f]{4})/.exec(e.label)
    if (!m) continue
    const baseWord = parseInt(m[1], 16)
    const id = idByBaseWord.get(baseWord)
    // Follow the target table for this id; if the body isn't pointer-referenced
    // (shouldn't happen for a real message), fall back to its base offset — which
    // is correct when reading the base cart itself.
    const targetWord = id === undefined ? baseWord : rd16(cart, ptPc + id * 2)
    if (targetWord === 0) {
      out.set(e.label, { markup: '', ok: false, removed: true }) // deleted in the hack
      continue
    }
    const addr = snesToPC(0x510000 | targetWord)
    if (addr < 0 || addr >= cart.length) {
      out.set(e.label, { markup: '', ok: false })
      continue
    }
    const dec = decodeMessageBytes(cart, addr, ft.byteToChar)
    out.set(e.label, { markup: dec.markup, ok: dec.ok })
  }
  return out
}

/** A foreign glyph-line body (intro story / ending text) decoded from a cart. */
export interface ForeignGlyphEntry {
  /** Decoded text lines — one markup string per glyph run (matches the editor
   *  model's one-line-per-quoted-`db` structure). Empty when `ok` is false. */
  lines: string[]
  /** True when a terminator was reached within bounds (a sane body). */
  ok: boolean
}

/** Control-byte layout of a glyph-line table's binary form. Intro uses single
 *  bytes ($FE/$FD/$FC + 1 param, $FB alone) and a 1-byte $FF terminator; ending
 *  (message-style) uses `dw $XXFF` control words and a `dw $FFFF` terminator. */
interface GlyphLineFormat {
  /** True ⇒ a `$FF` byte introduces a 2-byte control word and `$FF,$FF` terminates
   *  (ending). False ⇒ $FE/$FD/$FC take one param byte, $FB is alone, a lone `$FF`
   *  terminates (intro). */
  wordControls: boolean
}

const GLYPH_LINE_FORMATS: Record<string, GlyphLineFormat> = {
  [INTRO_STORY_ID]: { wordControls: false },
  [ENDING_TEXT_ID]: { wordControls: true }
}

/** Max bytes scanned for one glyph-line body (guards a missing terminator). */
const MAX_GLYPH_LINE_BYTES = 4096

/**
 * Decode one glyph-line body at `start` into its text lines. The body interleaves
 * glyph runs with layout control bytes; the editor's model has one line per quoted
 * `db "..."` run (controls sit between lines, preserved by the splice), so we split
 * the byte stream into glyph RUNS at every control boundary. `fmt` selects the
 * control layout. A run of glyph bytes becomes one markup line (byte→char via
 * `fontMap`; an unmapped byte → `[$xx]`). Empty runs (back-to-back controls) are
 * dropped, matching `parseGlyphLineRegion`. `ok` is set on a terminator in bounds.
 */
function decodeGlyphLineBody(
  bytes: Uint8Array | Buffer,
  start: number,
  fontMap: Map<number, string>,
  fmt: GlyphLineFormat
): ForeignGlyphEntry {
  const lines: string[] = []
  let run = ''
  const flush = (): void => {
    if (run !== '') {
      lines.push(run)
      run = ''
    }
  }
  let p = start
  const cap = Math.min(bytes.length, start + MAX_GLYPH_LINE_BYTES)
  let ok = false
  while (p < cap) {
    const b = bytes[p]!
    if (fmt.wordControls) {
      if (b === 0xff) {
        const cmd = bytes[p + 1]
        if (cmd === undefined) break
        if (cmd === 0xff) {
          ok = true
          p += 2
          break // dw $FFFF terminator
        }
        flush() // dw $XXFF control word ends the current text run
        p += 2
        continue
      }
    } else {
      if (b === 0xff) {
        ok = true
        p += 1
        break // db $FF terminator
      }
      if (b === 0xfe || b === 0xfd || b === 0xfc) {
        flush() // single-byte control + one param byte
        p += 2
        continue
      }
      if (b === 0xfb) {
        flush() // lone single-byte control
        p += 1
        continue
      }
    }
    const ch = fontMap.get(b)
    run += ch !== undefined ? ch : `[$${b.toString(16).padStart(2, '0')}]`
    p += 1
  }
  flush()
  return { lines, ok }
}

/**
 * Decode a foreign cart's glyph-line text table (intro story / ending text),
 * keyed by base asm label. Each editable body is read at the address its
 * auto-named label encodes (`DATA_<bank><offset>` → SNES bank:offset), so an
 * in-place edit (the common case) aligns. There's no pointer table to follow
 * (unlike messages), so a hack that RELOCATED a body decodes as garbage / no
 * terminator and the caller skips it. The ROM importer diffs this against base +
 * the editable model (importing only entries whose binary form matches the model,
 * so layout-control or special-glyph entries are skipped rather than corrupted).
 */
export function readForeignGlyphTable(
  cart: Buffer | Uint8Array,
  baseText: string,
  ft: FontTable,
  id: string
): Map<string, ForeignGlyphEntry> {
  const out = new Map<string, ForeignGlyphEntry>()
  const fmt = GLYPH_LINE_FORMATS[id]
  const region = findRegion(baseText, id)
  if (!fmt || !region) return out
  for (const e of parseGlyphLineRegion(region.inner)) {
    const addrLabel = [e.label, ...e.labels].find((l) => /^DATA_[0-9A-Fa-f]{6}$/.test(l))
    if (!addrLabel) continue
    const addr = snesToPC(parseInt(addrLabel.slice(5), 16))
    if (addr < 0 || addr >= cart.length) {
      out.set(e.label, { lines: [], ok: false })
      continue
    }
    out.set(e.label, decodeGlyphLineBody(cart, addr, ft.byteToChar, fmt))
  }
  return out
}
