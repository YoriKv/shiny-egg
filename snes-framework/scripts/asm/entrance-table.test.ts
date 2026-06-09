// Round-trip + cart-oracle test for the world-map entrance-table codec.
//   1. Parse the base asm → model; pin a few known records + the index table.
//   2. No-op serialize → byte-identical (the format-preserving contract).
//   3. Edit spawn / progTarget → serialize → re-parse round-trips the new value,
//      and only the edited operand's bytes change.
//   4. (cart-gated) Every parsed record matches the assembled bytes in the built
//      V1.0 cart — proves the asm parse agrees with what asar emits.
// Run: node snes-framework/scripts/asm/entrance-table.test.ts

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDevCart } from '../engine/dev-cart.ts'
import { loadLevelIdSymbols } from './entrance-table.ts'
import {
  parseEntranceTable,
  serializeEntranceTable,
  WORLD_MAP_ENTRANCES_ID
} from '../world-map.ts'
import type { WorldMapModel } from '../types.ts'

let failed = 0
function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    console.error(`  ✗ ${msg}`)
    failed = 1
  }
}

const here = path.dirname(fileURLToPath(import.meta.url))
const WORK_ROOT = path.join(here, '..', '..')
const ASM_FILE = path.join(
  WORK_ROOT,
  'yi',
  'Routines',
  'DATATABLE_YI_LevelDataPtrsAndEntranceData.asm'
)

const asm = fs.readFileSync(ASM_FILE, 'utf8')
const symbols = loadLevelIdSymbols(WORK_ROOT)
const model = parseEntranceTable(asm, symbols)

console.log('parse:')
assert(model.entrances.length === 56, `56 entrance records (got ${model.entrances.length})`)

// Hand-verified records (against the asm + LevelIDs.asm).
const rec0 = model.entrances[0]
assert(
  rec0.levelDataId === 0x00 && rec0.spawnX === 0x07 && rec0.spawnY === 0x77 && rec0.progTarget === 0x01,
  `record 0 = level $00, spawn (0x07,0x77), prog WatchOutBelow ($01) — got ` +
    `level $${rec0.levelDataId.toString(16)}, spawn (0x${rec0.spawnX.toString(16)},0x${rec0.spawnY.toString(16)}), prog $${rec0.progTarget.toString(16)}`
)
const rec7 = model.entrances[7]
assert(
  rec7.levelDataId === 0x9b && rec7.spawnX === 0x68 && rec7.spawnY === 0x4a && rec7.progTarget === 0x0c,
  `record 7 = level $9B (Visit Koopa intro sub-room), prog VisitKoopa ($0C)`
)

console.log('index table:')
assert(model.translevelToRecordIndex['0x00'] === 0, "translevel 0x00 → record 0")
assert(model.translevelToRecordIndex['0x08'] === 8, "translevel 0x08 → record 8 (offset $0020)")
assert(model.translevelToRecordIndex['0x0A'] === 54, "translevel 0x0A → record 54 (offset $00D8)")
assert(model.translevelToRecordIndex['0x0B'] === 55, "translevel 0x0B → record 55 (offset $00DC)")
// Bonus / padding slots ($0000 main offset) are excluded so they don't collapse
// onto record 0 and collide with 1-1 (translevel 0x09 = Flip Cards bonus icon).
assert(model.translevelToRecordIndex['0x09'] === undefined, "bonus slot 0x09 ($0000) → excluded (no main entrance)")

console.log('midway parse:')
assert(model.midway.length === 122, `122 midway records (got ${model.midway.length})`)
const m0 = model.midway[0]
assert(
  m0.levelDataId === 0x00 && m0.spawnX === 0x78 && m0.spawnY === 0x76 && m0.entranceState === 0x00,
  `midway record 0 = level $00, spawn (0x78,0x76), state $00 (dw $7800,$0076)`
)
const m1 = model.midway[1]
assert(
  m1.levelDataId === 0x01 && m1.spawnX === 0x82 && m1.spawnY === 0x7b,
  `midway record 1 = level $01, spawn (0x82,0x7B) (dw $8201,$007B)`
)
assert(model.midwayIndex['0x00'] === 0, 'midway translevel 0x00 → base record 0')
assert(model.midwayIndex['0x07'] === 10, 'midway translevel 0x07 → base record 10 (offset $0028)')
assert(model.midwayIndex['0x08'] === undefined, 'midway translevel 0x08 (1-Extra, $0000) → no midway (absent)')

console.log('no-op serialize:')
const noop = serializeEntranceTable(asm, model, symbols)
assert(noop.ok, 'no-op serialize ok')
assert(noop.ok && noop.text === asm, 'no-op serialize is byte-identical (both regions)')

console.log('edit midway (dw word repacking):')
const editMid: WorldMapModel = {
  ...model,
  // record 0: spawnX 0x78 → 0x10 (high byte of word0), entranceState 0x00 → 0x05 (high byte of word1).
  midway: model.midway.map((e) =>
    e.index === 0 ? { ...e, spawnX: 0x10, entranceState: 0x05 } : e
  )
}
const sMid = serializeEntranceTable(asm, editMid, symbols)
assert(sMid.ok, 'edit-midway serialize ok')
if (sMid.ok) {
  assert(sMid.text.includes('dw $1000,$0576,'), 'word0 repacked to $1000 (spawnX hi), word1 to $0576 (state hi)')
  const re = parseEntranceTable(sMid.text, symbols)
  assert(
    re.midway[0].spawnX === 0x10 && re.midway[0].entranceState === 0x05 &&
      re.midway[0].levelDataId === 0x00 && re.midway[0].spawnY === 0x76,
    're-parse round-trips the edited midway record, other fields intact'
  )
  assert(re.midway[1].spawnX === model.midway[1].spawnX, 'midway record 1 untouched')
}

console.log('add/remove checkpoint (populate/zero an empty midway page):')
const emptyIdx = model.midway.findIndex(
  (m) => m.levelDataId === 0 && m.spawnX === 0 && m.spawnY === 0 && m.entranceState === 0
)
assert(emptyIdx >= 0, `found an empty (all-zero) midway page to populate (record ${emptyIdx})`)
if (emptyIdx >= 0) {
  const added = { levelDataId: 0x05, spawnX: 0x10, spawnY: 0x20, entranceState: 0x03 }
  const editAdd: WorldMapModel = {
    ...model,
    midway: model.midway.map((e) => (e.index === emptyIdx ? { ...e, ...added } : e))
  }
  const sAdd = serializeEntranceTable(asm, editAdd, symbols)
  assert(sAdd.ok, 'add serialize ok')
  if (sAdd.ok) {
    const re = parseEntranceTable(sAdd.text, symbols).midway[emptyIdx]
    assert(
      re.levelDataId === 0x05 && re.spawnX === 0x10 && re.spawnY === 0x20 && re.entranceState === 0x03,
      'populated empty record round-trips (both dw words rewritten)'
    )
    // Removing it (zero the record) restores the original bytes exactly.
    const editRemove: WorldMapModel = {
      ...editAdd,
      midway: editAdd.midway.map((e) =>
        e.index === emptyIdx ? { ...e, levelDataId: 0, spawnX: 0, spawnY: 0, entranceState: 0 } : e
      )
    }
    const sRem = serializeEntranceTable(sAdd.text, editRemove, symbols)
    assert(sRem.ok && sRem.text === asm, 'remove (zero) restores the original byte-for-byte')
  }
}

console.log('edit spawn:')
const editSpawn: WorldMapModel = {
  ...model,
  entrances: model.entrances.map((e) => (e.index === 0 ? { ...e, spawnX: 0x10 } : e))
}
const sSpawn = serializeEntranceTable(asm, editSpawn, symbols)
assert(sSpawn.ok, 'edit-spawn serialize ok')
if (sSpawn.ok) {
  assert(sSpawn.text.length === asm.length, 'spawn edit keeps file length ($07 → $10)')
  // Exactly one contiguous differing run, inside record 0's line — the digits of
  // the spawnX operand ($07 → $10; the shared `$` isn't part of the diff run).
  const diff = firstDiff(asm, sSpawn.text)
  assert(diff !== null && sSpawn.text.slice(diff.start, diff.end) === '10', 'only the spawnX operand digits changed (07 → 10)')
  assert(
    sSpawn.text.includes('db $00,$10,$77,!Define_YI_LevelID_WatchOutBelow'),
    'record 0 line reads back with the new spawnX, everything else intact'
  )
  const re = parseEntranceTable(sSpawn.text, symbols)
  assert(re.entrances[0].spawnX === 0x10, 're-parse round-trips spawnX = 0x10')
  assert(re.entrances[0].levelDataId === 0x00 && re.entrances[0].progTarget === 0x01, 'other fields of record 0 unchanged')
  assert(re.entrances[1].spawnX === model.entrances[1].spawnX, 'record 1 untouched')
}

console.log('edit levelDataId (Phase 3 remap):')
const editRemap: WorldMapModel = {
  ...model,
  entrances: model.entrances.map((e) => (e.index === 0 ? { ...e, levelDataId: 0x10 } : e))
}
const sRemap = serializeEntranceTable(asm, editRemap, symbols)
assert(sRemap.ok, 'edit-remap serialize ok')
if (sRemap.ok) {
  assert(
    sRemap.text.includes('db $10,$07,$77,!Define_YI_LevelID_WatchOutBelow'),
    'remap rewrites byte +0 to $10, preserving the rest of the record'
  )
  assert(parseEntranceTable(sRemap.text, symbols).entrances[0].levelDataId === 0x10, 're-parse levelDataId = 0x10')
}

console.log('edit progTarget (known symbol):')
const editProg: WorldMapModel = {
  ...model,
  entrances: model.entrances.map((e) => (e.index === 0 ? { ...e, progTarget: 0x04 } : e))
}
const sProg = serializeEntranceTable(asm, editProg, symbols)
assert(sProg.ok, 'edit-prog serialize ok')
if (sProg.ok) {
  assert(
    sProg.text.includes('db $00,$07,$77,!Define_YI_LevelID_HopHopDonutLifts'),
    'prog edit re-emits the !Define symbol for $04 (HopHopDonutLifts)'
  )
  assert(parseEntranceTable(sProg.text, symbols).entrances[0].progTarget === 0x04, 're-parse progTarget = 0x04')
}

console.log('edit progTarget (no symbol → hex):')
const editProgHex: WorldMapModel = {
  ...model,
  entrances: model.entrances.map((e) => (e.index === 0 ? { ...e, progTarget: 0x0a } : e))
}
const sProgHex = serializeEntranceTable(asm, editProgHex, symbols)
assert(sProgHex.ok, 'edit-prog-hex serialize ok')
if (sProgHex.ok) {
  assert(sProgHex.text.includes('db $00,$07,$77,$0A'), 'gap value $0A (no LevelID symbol) emits a $XX literal')
  assert(parseEntranceTable(sProgHex.text, symbols).entrances[0].progTarget === 0x0a, 're-parse progTarget = 0x0A')
}

console.log('out-of-range rejected:')
const bad: WorldMapModel = {
  ...model,
  entrances: model.entrances.map((e) => (e.index === 0 ? { ...e, spawnX: 0x100 } : e))
}
const sBad = serializeEntranceTable(asm, bad, symbols)
assert(!sBad.ok, 'a non-byte field value is rejected')

// ── Cart oracle (gated) ─────────────────────────────────────────────────────
console.log('cart oracle:')
let cart: ReturnType<typeof loadDevCart> | null = null
try {
  cart = loadDevCart(WORK_ROOT)
} catch {
  console.log('  SKIP: built V1.0 cart/.sym not present (run a build first).')
}
if (cart) {
  const base = cart.symbols.pc('YI_LevelDataPtrsAndEntranceData_DATA_map_level_entrances')
  let mismatches = 0
  for (const e of model.entrances) {
    const off = base + e.index * 4
    const got = [cart.cart[off], cart.cart[off + 1], cart.cart[off + 2], cart.cart[off + 3]]
    const want = [e.levelDataId, e.spawnX, e.spawnY, e.progTarget]
    if (got.some((b, i) => b !== want[i])) mismatches++
  }
  assert(mismatches === 0, `all 56 main records match the assembled cart bytes (${mismatches} mismatch)`)

  const midBase = cart.symbols.pc('YI_LevelDataPtrsAndEntranceData_DATA_map_level_midway_entrances')
  let midMismatches = 0
  for (const e of model.midway) {
    const off = midBase + e.index * 4
    const got = [cart.cart[off], cart.cart[off + 1], cart.cart[off + 2], cart.cart[off + 3]]
    const want = [e.levelDataId, e.spawnX, e.spawnY, e.entranceState]
    if (got.some((b, i) => b !== want[i])) midMismatches++
  }
  assert(midMismatches === 0, `all 122 midway records match the assembled cart bytes (${midMismatches} mismatch)`)
}

/** First contiguous differing `[start,end)` range between two equal-length
 *  strings (start in a, end exclusive in a-coords), or null if identical. */
function firstDiff(a: string, b: string): { start: number; end: number } | null {
  let s = 0
  while (s < a.length && a[s] === b[s]) s++
  if (s === a.length && a.length === b.length) return null
  let e = a.length
  while (e > s && a[e - 1] === b[e - 1]) e--
  return { start: s, end: e }
}

console.log(failed ? '\nFAIL' : `\nPASS (region "${WORLD_MAP_ENTRANCES_ID}")`)
process.exit(failed)
