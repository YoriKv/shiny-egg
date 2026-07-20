// Credits staff-roll codec pins (asm/credits-staff.ts + the strings.ts region):
//   1. CREDITS_FONT_WIDTHS matches the asm source (Bank09 DATA_09BC2F) exactly;
//   2. the Bank00 region parses to the 34 page bodies (1638 stream bytes) and
//      decodes to the known staff roll ("Directors", "Shigeru Miyamoto", "THE END");
//   3. round-trip identity: serializing the UNCHANGED model reproduces the file
//      byte-for-byte;
//   4. an edited page re-encodes: letters/advances from the width table, X
//      re-centered, Y preserved, cost == creditsPageByteSize, re-parse shows the
//      new text; unchanged pages stay byte-identical;
//   5. validation: unknown char, empty line, line-count change, over-budget.
//
// Run: node snes-framework/scripts/asm/credits-staff.test.ts

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { FRAMEWORK_ROOT } from '../engine/dev-cart.ts'
import { loadFontTable } from './font-table.ts'
import { findRegion } from './markers.ts'
import {
  CREDITS_FONT_WIDTHS,
  creditsCodeToLetterByte,
  creditsLetterByteToCode,
  creditsPageByteSize,
  decodeCreditsPage,
  encodeCreditsPage
} from './credits-staff.ts'
import { CREDITS_STAFF_ID, parseCreditsStaff, serializeCreditsStaff } from '../strings.ts'
import { markupBodyByteSize } from './msg-markup.ts'

let failures = 0
const assert = (c: boolean, m: string): void => {
  if (c) console.log(`  ✓ ${m}`)
  else {
    console.error(`  ✗ ${m}`)
    failures++
  }
}

const ft = loadFontTable(FRAMEWORK_ROOT)
const bank00 = readFileSync(path.join(FRAMEWORK_ROOT, 'yi', 'Banks', 'Bank00.asm'), 'utf8')
const bank09 = readFileSync(path.join(FRAMEWORK_ROOT, 'yi', 'SuperFX', 'Banks', 'Bank09.asm'), 'utf8')

// ── (1) width table matches the asm source ──────────────────────────────────
{
  const at = bank09.indexOf('DATA_09BC2F:')
  const widths: number[] = []
  for (const line of bank09.slice(at).split('\n').slice(1)) {
    const m = /^\s*db\s+(\S.*)$/.exec(line)
    if (!m) break
    for (const tok of m[1].split(',')) widths.push(parseInt(tok.trim().replace('$', ''), 16))
  }
  assert(widths.length === 256, `Bank09 width table is 256 entries (got ${widths.length})`)
  assert(
    widths.length === CREDITS_FONT_WIDTHS.length && widths.every((w, i) => w === CREDITS_FONT_WIDTHS[i]),
    'CREDITS_FONT_WIDTHS matches DATA_09BC2F byte-for-byte'
  )
}

// ── letter byte ↔ code inverse ──────────────────────────────────────────────
{
  let ok = true
  for (let code = 0; code < 256; code++) {
    if (creditsLetterByteToCode(creditsCodeToLetterByte(code)) !== code) ok = false
  }
  assert(ok, 'letterByte(code) round-trips for all 256 font codes')
}

// ── (2) region parse + decode ───────────────────────────────────────────────
const model = parseCreditsStaff(bank00, bank00, ft)
{
  assert(model.entries.length === 34, `34 distinct page bodies (got ${model.entries.length})`)
  assert(model.budgetChars === 1638, `budget = 1638 stream bytes (got ${model.budgetChars})`)
  assert(model.glyphLines === true && model.byteCost === 'credits-page', 'model is glyph-line + credits-page cost')
  const first = model.entries[0]!
  assert(first.lines[0]!.includes('Directors'), `first page says Directors (got "${first.lines[0]}")`)
  assert(
    model.entries.some((e) => e.lines.some((l) => l === 'Shigeru Miyamoto')),
    'a page decodes to "Shigeru Miyamoto" (word gap → space)'
  )
  const last = model.entries[model.entries.length - 1]!
  assert(last.lines[0] === 'THE END', `last page is "THE END" (got "${last.lines[0]}")`)
  assert(first.name.startsWith('Pages 1 & 2'), `shared body named by both slots (got "${first.name}")`)
}

// ── (3) unchanged model → byte-identical file ───────────────────────────────
{
  const r = serializeCreditsStaff(bank00, bank00, model, ft)
  assert(r.ok && r.text === bank00, 'serializing the unchanged model is byte-identical')
}

// ── (4) edit round-trip ─────────────────────────────────────────────────────
{
  const edited = structuredClone(model)
  const miyamoto = edited.entries.find((e) => e.lines.some((l) => l === 'Shigeru Miyamoto'))!
  miyamoto.lines = miyamoto.lines.map((l) => (l === 'Shigeru Miyamoto' ? 'Shiny Egg' : l))
  const r = serializeCreditsStaff(bank00, bank00, edited, ft)
  assert(r.ok, `edit serializes (${r.ok ? 'ok' : r.error})`)
  if (r.ok) {
    const reparsed = parseCreditsStaff(r.text, bank00, ft)
    const hit = reparsed.entries.find((e) => e.label === miyamoto.label)!
    assert(hit.lines.includes('Shiny Egg'), 're-parse shows the edited name')
    // Unchanged pages byte-identical: compare the region inner minus the edited body.
    const before = findRegion(bank00, CREDITS_STAFF_ID)!.inner
    const after = findRegion(r.text, CREDITS_STAFF_ID)!.inner
    const cut = (s: string): string[] => s.split('\n').filter((l) => !/^\s*dw \$/.test(l))
    assert(cut(before).join('\n') === cut(after).join('\n'), 'labels/comments/structure preserved')
  }
}

// ── encode specifics ────────────────────────────────────────────────────────
{
  const enc = encodeCreditsPage(['Shiny Egg'], [168], ft)
  assert(enc.ok, 'encodeCreditsPage ok')
  if (enc.ok) {
    assert(enc.bytes.length === creditsPageByteSize(['Shiny Egg']), 'byte cost matches creditsPageByteSize')
    // letters: 8 (space free) → 2 header + 16 letters + 2 end = 20
    assert(enc.bytes.length === 20, `"Shiny Egg" = 20 stream bytes (got ${enc.bytes.length})`)
    const y = enc.bytes[1]!
    assert(y === 168, 'Y preserved from the base line')
    // width: S+h+i+n+y = 8+8+4+8+7=35 … 'y'=?? recompute from table: sum widths + space
    const widths = [...'ShinyEgg'].map((ch) => CREDITS_FONT_WIDTHS[ft.charToByte.get(ch)!]!)
    const w = widths.reduce((a, b) => a + b, 0) + CREDITS_FONT_WIDTHS[0xd0]!
    assert(enc.bytes[0] === Math.max(8, Math.round(128 - w / 2)), 'X is re-centered on 128')
    // The space folds into 'y''s advance.
    const yIdx = 'Shiny'.length - 1
    const adv = enc.bytes[2 + yIdx * 2 + 1]!
    assert(
      adv === CREDITS_FONT_WIDTHS[ft.charToByte.get('y')!]! + CREDITS_FONT_WIDTHS[0xd0]!,
      'word gap folded into the word-final advance'
    )
    // Decode reverses to the same text.
    const dec = decodeCreditsPage(enc.bytes, ft)
    assert(dec.length === 1 && dec[0]!.markup === 'Shiny Egg', `decode(encode) round-trips (got "${dec[0]?.markup}")`)
  }
}

// ── panel-estimate drift pin ────────────────────────────────────────────────
// The Strings panel computes the live estimate from markupBodyByteSize (the
// renderer-safe helper) with this exact formula; pin it against the codec's
// creditsPageByteSize over every shipped page so the two can never drift.
{
  const panelEstimate = (lines: readonly string[]): number => {
    let n = 2 + lines.length * 2 + Math.max(0, lines.length - 1) * 2
    for (const l of lines) n += 2 * (markupBodyByteSize(l) - (l.match(/ /g)?.length ?? 0))
    return n
  }
  const drift = model.entries.filter((e) => panelEstimate(e.lines) !== creditsPageByteSize(e.lines))
  assert(drift.length === 0, `panel estimate matches creditsPageByteSize for all pages (${drift.length} drift)`)
}

// ── (5) validation ──────────────────────────────────────────────────────────
{
  const bad = structuredClone(model)
  bad.entries[2]!.lines = bad.entries[2]!.lines.map(() => 'ünsupported')
  assert(!serializeCreditsStaff(bank00, bank00, bad, ft).ok, 'unsupported char rejected')

  const empty = structuredClone(model)
  empty.entries[2]!.lines = empty.entries[2]!.lines.map(() => '')
  assert(!serializeCreditsStaff(bank00, bank00, empty, ft).ok, 'empty line rejected')

  const wrongCount = structuredClone(model)
  wrongCount.entries[2]!.lines = ['just one line where two are expected']
  const wc = serializeCreditsStaff(bank00, bank00, wrongCount, ft)
  assert(!wc.ok, 'line-count change rejected')

  const over = structuredClone(model)
  over.entries[2]!.lines = over.entries[2]!.lines.map(() => 'A'.repeat(29))
  const ov = serializeCreditsStaff(bank00, bank00, over, ft)
  assert(!ov.ok, `29 wide letters per line rejected (line width cap) — ${ov.ok ? 'accepted!' : 'ok'}`)

  const glyph = structuredClone(model)
  glyph.entries[2]!.lines = glyph.entries[2]!.lines.map((_, i) => (i === 0 ? 'Star[star]Egg' : 'ok line'))
  assert(serializeCreditsStaff(bank00, bank00, glyph, ft).ok, 'named [star] glyph accepted')

  const hexTok = structuredClone(model)
  hexTok.entries[2]!.lines = hexTok.entries[2]!.lines.map((_, i) => (i === 0 ? '[$F2]Bullets[$D4]' : 'ok line'))
  assert(serializeCreditsStaff(bank00, bank00, hexTok, ft).ok, 'hex [$XX] tokens accepted')
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`)
process.exit(failures === 0 ? 0 : 1)
