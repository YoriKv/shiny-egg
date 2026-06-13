// Validation for the world-map side of vanilla-level removal
// (world-map.ts `removeTranslevelsFromWorldMap`): index-word zeroing, the
// self-unlock progression rewire, the serialize round-trip, and the
// pre-marker-overlay guard. Synthetic asm, cart-free.
//
// Run: node snes-framework/scripts/world-map-removal.test.ts

import {
  parseEntranceTable,
  removeTranslevelsFromWorldMap,
  restoreTranslevelsToWorldMap,
  serializeEntranceTable
} from './world-map.ts'
import { parseLevelIdSymbols } from './asm/entrance-table.ts'

let failures = 0
const check = (cond: boolean, msg: string): void => {
  if (!cond) {
    console.error(`  ✗ ${msg}`)
    failures++
  }
}

const SYMBOLS = parseLevelIdSymbols('')

// Four translevels: 0 plays record $00 (→ tl 1), 1 plays $01 (→ tl 2),
// 2 plays $05 (→ tl 1), 3 unused ($0000 padding). Midway only for tl 1.
const FILE = `
DATA_level_entrance_indexes:
	;@editable:world-map-entrance-indexes begin
	dw $0000,$0004,$0008,$0000
	;@editable:world-map-entrance-indexes end

DATA_map_level_entrances:
	;@editable:world-map-entrances begin
	db $00,$07,$77,$01
	db $01,$07,$7A,$02
	db $05,$03,$7A,$01
	;@editable:world-map-entrances end

DATA_level_midway_entrance_indexes:
	;@editable:world-map-midway-entrance-indexes begin
	dw $0000,$0004,$0000,$0000
	;@editable:world-map-midway-entrance-indexes end

DATA_map_level_midway_entrances:
	;@editable:world-map-midway-entrances begin
	dw $7800,$0076
	dw $7801,$0077
	;@editable:world-map-midway-entrances end
`

{
  const model = parseEntranceTable(FILE, SYMBOLS)
  check(model.entranceIndexWords?.join(',') === '0,4,8,0', `parse index words, got ${model.entranceIndexWords}`)
  check(model.entrances.length === 3 && model.entrances[1].progTarget === 2, 'parse entrances')

  // Remove translevel 1: its index words zero; tl 0's and tl 2's unlocks (both
  // → 1) redirect back at their own slots; tl 1's own progTarget is untouched.
  const r = removeTranslevelsFromWorldMap(model, new Set([1]))
  check(r.clearedTranslevels.join(',') === '1', `cleared slots, got ${r.clearedTranslevels}`)
  check(model.entranceIndexWords![1] === 0, 'main index word zeroed')
  check(model.midwayIndexWords![1] === 0, 'midway index word zeroed')
  check(
    r.rewires.length === 2 &&
      r.rewires.some((w) => w.recordIndex === 0 && w.from === 1 && w.to === 0) &&
      r.rewires.some((w) => w.recordIndex === 2 && w.from === 1 && w.to === 2),
    `both kept unlocks redirect at their own slot, got ${JSON.stringify(r.rewires)}`
  )
  check(model.entrances[0].progTarget === 0 && model.entrances[2].progTarget === 2, 'progTargets rewritten')
  check(model.entrances[1].progTarget === 2, 'the removed slot’s own record is untouched')

  // Serialize: only the changed operands are rewritten, format preserved.
  const out = serializeEntranceTable(FILE, model, SYMBOLS)
  check(out.ok, `serialize ok, got ${JSON.stringify(out)}`)
  if (out.ok) {
    check(out.text.includes('dw $0000,$0000,$0008,$0000'), `main index spliced, got:\n${out.text}`)
    check(out.text.includes('dw $0000,$0000,$0000,$0000'), 'midway index spliced')
    check(out.text.includes('db $00,$07,$77,$00'), 'record 0 progTarget spliced to $00')
    check(out.text.includes('db $05,$03,$7A,$02'), 'record 2 progTarget spliced to $02')
    check(out.text.includes('db $01,$07,$7A,$02'), 'record 1 (removed slot) byte-preserved')
    // Round-trip: re-parsing the spliced text yields the mutated model.
    const reparsed = parseEntranceTable(out.text, SYMBOLS)
    check(reparsed.entranceIndexWords![1] === 0 && reparsed.entrances[0].progTarget === 0, 'splice round-trips')
  }

  // Idempotence: removing the same slot again changes nothing.
  const r2 = removeTranslevelsFromWorldMap(model, new Set([1]))
  check(r2.clearedTranslevels.length === 0 && r2.rewires.length === 0, 'second removal is a no-op')
}

{
  // Restore: remove translevel 1 then restore it — index words and the two
  // self-redirected unlocks return to their base values; a second restore is a
  // no-op. An unlock the USER re-pointed (not a self-redirect) is untouched.
  const base = parseEntranceTable(FILE, SYMBOLS)
  const model = parseEntranceTable(FILE, SYMBOLS)
  removeTranslevelsFromWorldMap(model, new Set([1]))
  const r = restoreTranslevelsToWorldMap(model, base, new Set([1]))
  check(r.restoredTranslevels.join(',') === '1', `restored slots, got ${r.restoredTranslevels}`)
  check(model.entranceIndexWords![1] === 4 && model.midwayIndexWords![1] === 4, 'index words restored to base')
  check(
    r.rewires.length === 2 &&
      r.rewires.some((w) => w.recordIndex === 0 && w.from === 0 && w.to === 1) &&
      r.rewires.some((w) => w.recordIndex === 2 && w.from === 2 && w.to === 1),
    `both self-redirects un-rewired, got ${JSON.stringify(r.rewires)}`
  )
  check(JSON.stringify(model.entrances) === JSON.stringify(base.entrances), 'entrances byte-equal to base after restore')
  const r2 = restoreTranslevelsToWorldMap(model, base, new Set([1]))
  check(r2.restoredTranslevels.length === 0 && r2.rewires.length === 0, 'second restore is a no-op')

  // Customized unlock survives: remove tl 1 (record 0's unlock self-redirects
  // to 0), then the user re-points record 0's unlock at tl 2 — the restore
  // must NOT stomp that back to 1 (it's no longer the self-redirect).
  const model2 = parseEntranceTable(FILE, SYMBOLS)
  removeTranslevelsFromWorldMap(model2, new Set([1]))
  model2.entrances[0].progTarget = 2
  const r3 = restoreTranslevelsToWorldMap(model2, base, new Set([1]))
  check(model2.entrances[0].progTarget === 2, 'a user-re-pointed unlock survives the restore')
  check(model2.entrances[2].progTarget === 1, 'the untouched self-redirect still un-rewires')
  check(r3.rewires.length === 1, `only the genuine self-redirect un-rewires, got ${JSON.stringify(r3.rewires)}`)
}

{
  // Pre-marker overlay (no editable index regions): the model carries no raw
  // index words, so removal must refuse rather than silently skip the zeroing.
  const legacy = FILE.replace(/\t;@editable:world-map-(midway-)?entrance-indexes (begin|end)\n/g, '')
  const model = parseEntranceTable(legacy, SYMBOLS)
  check(model.entranceIndexWords === undefined, 'legacy overlay parses without index words')
  let threw = false
  try {
    removeTranslevelsFromWorldMap(model, new Set([1]))
  } catch {
    threw = true
  }
  check(threw, 'removal throws on a pre-marker overlay')
}

if (failures > 0) {
  console.error(`\nworld-map-removal.test: ${failures} failure(s).`)
  process.exit(1)
}
console.log('world-map-removal.test: OK — index zeroing, self-unlock rewires, restore round-trip, splice round-trip, legacy guard.')
