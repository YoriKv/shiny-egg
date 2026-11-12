// Run: node --test snes-framework/scripts/asm/strings-line-endings.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import {
  loadFontTable,
  parseIntroStory,
  parseEndingText,
  parseCreditsStaff,
  serializeIntroStory,
  serializeEndingText,
  serializeCreditsStaff
} from '../strings.ts'
import { findRegion } from './markers.ts'

const root = path.resolve(import.meta.dirname, '../..')
const ft = loadFontTable(root)
const tables = [
  { bank: 'Bank0F', parse: parseIntroStory, save: serializeIntroStory, first: 'A long, long time ago ...' },
  { bank: 'Bank0D', parse: parseEndingText, save: serializeEndingText, first: 'Thus, due to the marvelous' },
  { bank: 'Bank00', parse: parseCreditsStaff, save: serializeCreditsStaff, first: '[cursorl]Directors[cursorr]' }
]

for (const table of tables) {
  const lf = readFileSync(path.join(root, 'yi/Banks', `${table.bank}.asm`), 'utf8').replace(/\r\n/g, '\n')
  const baseline = table.parse(lf, lf, ft)
  for (const newline of ['\n', '\r\n']) {
    test(`${baseline.title}: load and save ${newline === '\n' ? 'LF' : 'CRLF'}`, () => {
      const source = lf.replace(/\n/g, newline)
      const model = table.parse(source, source, ft)
      assert.ok(model.entries.length > 0)
      assert.ok(model.budgetChars > 0)
      assert.equal(model.entries[0].lines[0], table.first)
      assert.deepEqual(model, baseline)
      assert.deepEqual(table.save(source, source, model, ft), { ok: true, text: source })

      const edited = structuredClone(model)
      // Shorten one line so the edit stays within the original byte budget.
      edited.entries[0].lines[0] = 'Shiny Egg'
      const saved = table.save(source, source, edited, ft)
      assert.ok(saved.ok, saved.ok ? '' : saved.error)
      const reloaded = table.parse(saved.text, source, ft)
      assert.deepEqual(reloaded.entries.map((e) => e.lines), edited.entries.map((e) => e.lines))
      assert.equal(reloaded.budgetChars, baseline.budgetChars)
      if (newline === '\r\n') assert.ok(!/(?<!\r)\n/.test(saved.text), 'save preserves CRLF')
      else assert.ok(!saved.text.includes('\r'), 'save preserves LF')

      const before = findRegion(source, model.id)!
      const after = findRegion(saved.text, model.id)!
      assert.equal(source.slice(0, before.innerStart), saved.text.slice(0, after.innerStart))
      assert.equal(source.slice(before.innerEnd), saved.text.slice(after.innerEnd))
      if (table.bank !== 'Bank00') {
        assert.equal(saved.text, source.replace(`"${table.first}"`, '"Shiny Egg"'))
      }
    })
  }
}
