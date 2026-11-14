// Line-ending pins for every `;@editable` string region (strings.ts), run on
// both the LF source and a CRLF copy of it (a Windows checkout or install):
//   1. the CRLF parse is identical to the LF parse (non-empty, same budget);
//   2. serializing the UNCHANGED model reproduces the file byte-for-byte;
//   3. an edit serializes, re-parses to the edited content, and keeps the
//      file's line ending (no bare LF in a CRLF file, no CR in an LF file);
//   4. text outside the edited region is untouched.
// Covers the six tables: level names, message text and message pointers
// (Bank51), intro story (Bank0F), ending text (Bank0D), credits (Bank00).
//
// Run: node snes-framework/scripts/asm/strings-line-endings.test.ts

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { FRAMEWORK_ROOT } from '../engine/dev-cart.ts'
import { loadFontTable } from './font-table.ts'
import { findRegion } from './markers.ts'
import {
  parseCreditsStaff,
  parseEndingText,
  parseIntroStory,
  parseLevelNameStrings,
  parseMessagePtrTable,
  parseMessageText,
  serializeCreditsStaff,
  serializeEndingText,
  serializeIntroStory,
  serializeLevelNameStrings,
  serializeMessagePtrTable,
  serializeMessageText
} from '../strings.ts'
import type { FontTable } from './font-table.ts'
import type { MessagePtrTableModel, StringTableModel } from '../types.ts'

let failures = 0
const assert = (c: boolean, m: string): void => {
  if (c) console.log(`  ✓ ${m}`)
  else {
    console.error(`  ✗ ${m}`)
    failures++
  }
}

type SaveResult = { ok: true; text: string } | { ok: false; error: string }

interface Table<M> {
  /** Asm file under yi/. */
  file: string
  parse: (content: string, budget: string, ft: FontTable) => M
  save: (content: string, budget: string, model: M, ft: FontTable) => SaveResult
  /** Apply one edit that stays within the base byte budget. */
  edit: (model: M) => void
  /** The editable content a re-parse must reproduce after the edit. */
  content: (model: M) => unknown
  /** The model is empty when the region failed to parse (the original bug). */
  nonEmpty: (model: M) => boolean
  /** For tables whose edit is a plain literal swap, the exact expected text. */
  literalSwap?: [from: string, to: string]
}

const lines = (m: StringTableModel): unknown => m.entries.map((e) => e.lines)
const markups = (m: StringTableModel): unknown => m.entries.map((e) => e.markup)
const hasEntries = (m: StringTableModel): boolean => m.entries.length > 0 && m.budgetChars > 0
const shortenFirstLine = (m: StringTableModel): void => {
  m.entries[0]!.lines[0] = 'Shiny Egg'
}

const tables: Table<any>[] = [
  {
    file: 'SuperFX/Banks/Bank51.asm',
    parse: parseLevelNameStrings,
    save: serializeLevelNameStrings,
    edit: shortenFirstLine,
    content: lines,
    nonEmpty: hasEntries
  } satisfies Table<StringTableModel>,
  {
    file: 'SuperFX/Banks/Bank51.asm',
    parse: parseMessageText,
    save: serializeMessageText,
    edit: (m) => {
      m.entries[0]!.markup = 'Shiny Egg'
    },
    content: markups,
    nonEmpty: hasEntries
  } satisfies Table<StringTableModel>,
  {
    file: 'SuperFX/Banks/Bank51.asm',
    parse: parseMessagePtrTable,
    save: serializeMessagePtrTable,
    edit: (m) => {
      m.slots[0] = m.options.find((o) => o.id !== m.slots[0])!.id
    },
    content: (m) => m.slots,
    nonEmpty: (m) => m.slots.length > 0 && m.options.length > 1
  } satisfies Table<MessagePtrTableModel>,
  {
    file: 'Banks/Bank0F.asm',
    parse: parseIntroStory,
    save: serializeIntroStory,
    edit: shortenFirstLine,
    content: lines,
    nonEmpty: hasEntries,
    literalSwap: ['"A long, long time ago ..."', '"Shiny Egg"']
  } satisfies Table<StringTableModel>,
  {
    file: 'Banks/Bank0D.asm',
    parse: parseEndingText,
    save: serializeEndingText,
    edit: shortenFirstLine,
    content: lines,
    nonEmpty: hasEntries,
    literalSwap: ['"Thus, due to the marvelous"', '"Shiny Egg"']
  } satisfies Table<StringTableModel>,
  {
    file: 'Banks/Bank00.asm',
    parse: parseCreditsStaff,
    save: serializeCreditsStaff,
    edit: shortenFirstLine,
    content: lines,
    nonEmpty: hasEntries
  } satisfies Table<StringTableModel>
]

const ft = loadFontTable(FRAMEWORK_ROOT)

for (const table of tables) {
  const lf = readFileSync(path.join(FRAMEWORK_ROOT, 'yi', table.file), 'utf8').replace(/\r\n/g, '\n')
  const baseline = table.parse(lf, lf, ft)
  for (const [eolName, eol] of [['LF', '\n'], ['CRLF', '\r\n']] as const) {
    const source = lf.replace(/\n/g, eol)
    const model = table.parse(source, source, ft)
    const label = `${model.title} (${eolName})`
    console.log(label)

    assert(table.nonEmpty(model), 'parses to a non-empty model')
    assert(isDeepStrictEqual(model, baseline), 'parse matches the LF parse')
    const same = table.save(source, source, model, ft)
    assert(same.ok && same.text === source, 'unchanged model saves byte-identical')

    const edited = structuredClone(model)
    table.edit(edited)
    const saved = table.save(source, source, edited, ft)
    if (!saved.ok) {
      assert(false, `edit serializes (${saved.error})`)
      continue
    }
    assert(true, 'edit serializes')
    const reloaded = table.parse(saved.text, source, ft)
    assert(isDeepStrictEqual(table.content(reloaded), table.content(edited)), 're-parse shows the edit')
    assert(
      eol === '\r\n' ? !/(?<!\r)\n/.test(saved.text) : !saved.text.includes('\r'),
      `save keeps ${eolName} line endings`
    )

    const before = findRegion(source, model.id)!
    const after = findRegion(saved.text, model.id)!
    assert(
      source.slice(0, before.innerStart) === saved.text.slice(0, after.innerStart) &&
        source.slice(before.innerEnd) === saved.text.slice(after.innerEnd),
      'text outside the region is untouched'
    )
    if (table.literalSwap) {
      const [from, to] = table.literalSwap
      assert(saved.text === source.replace(from, to), 'edit is exactly the literal swap')
    }
  }
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`)
process.exit(failures === 0 ? 0 : 1)
