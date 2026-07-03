// Pure conflict-core + checksum-gate pins (gfx-import-conflict.ts) — cart-free, no Electron.
// Covers the two new mechanisms the standardized graphics import is built on:
//   1. the checksum gate (changedSinceExport): unchanged → skip, edited/absent-stored → import;
//   2. the cross-file conflict tracker: agreeing sources → one winner; disagreeing → drop + log.
//
// Run: node src/main/gfx-import-conflict.test.ts

import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileChecksum, changedSinceExport, fileChangeState, FileHashCache, ConflictTracker, bytesEq, numEq, countChangedUnits } from './gfx-import-conflict.ts'

let failures = 0
function assert(cond: boolean, msg: string): void {
  if (cond) { console.log(`  ✓ ${msg}`) } else { console.error(`  ✗ ${msg}`); failures++ }
}

// ── fileChecksum ────────────────────────────────────────────────────────────
const a = Uint8Array.of(1, 2, 3, 4)
const b = Uint8Array.of(1, 2, 3, 5)
assert(fileChecksum(a) === fileChecksum(a.slice()), 'fileChecksum is deterministic')
assert(fileChecksum(a) !== fileChecksum(b), 'fileChecksum differs for different bytes')
assert(/^[0-9a-f]{64}$/.test(fileChecksum(a)), 'fileChecksum is 64 hex chars (sha256)')

// ── changedSinceExport (the gate) ─────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'gfx-gate-'))
try {
  writeFileSync(join(dir, 'sheet.png'), Buffer.from(a))
  const stored = fileChecksum(a)
  assert(changedSinceExport(dir, 'sheet.png', stored) === 'unchanged', 'matching checksum ⇒ unchanged (skip)')
  assert(changedSinceExport(dir, 'sheet.png', fileChecksum(b)) === 'changed', 'differing checksum ⇒ changed (import)')
  assert(changedSinceExport(dir, 'sheet.png', undefined) === 'changed', 'absent stored checksum ⇒ changed (old export imports)')
  assert(changedSinceExport(dir, 'missing.png', stored) === 'missing', 'absent file ⇒ missing')
  // Edit the file on disk → its bytes no longer match the stored hash ⇒ changed.
  writeFileSync(join(dir, 'sheet.png'), Buffer.from(b))
  assert(changedSinceExport(dir, 'sheet.png', stored) === 'changed', 'edited-on-disk file ⇒ changed')
  // fileChangeState: the same gate with the computed hash exposed (preview-cache key).
  const st = fileChangeState(dir, 'sheet.png', stored)
  assert(st.status === 'changed' && st.hash === fileChecksum(b), 'fileChangeState exposes the current on-disk hash')
  assert(fileChangeState(dir, 'sheet.png', fileChecksum(b)).status === 'unchanged', 'fileChangeState agrees with the bare gate')
  assert(fileChangeState(dir, 'missing.png', stored).hash === null, 'missing file ⇒ null hash')

  // ── FileHashCache (the stat-validated status-sweep gate) ────────────────────
  const cache = new FileHashCache()
  const st1 = cache.state(dir, 'sheet.png', stored) // file currently holds `b`
  assert(st1.status === 'changed' && st1.hash === fileChecksum(b), 'cache agrees with the exact gate')
  assert(cache.recomputes === 1, 'first look hashes the file')
  cache.state(dir, 'sheet.png', stored)
  assert(cache.recomputes === 1, 'untouched file (same mtime+size) ⇒ no re-hash')
  // A real save: different bytes AND a bumped mtime → re-hash.
  writeFileSync(join(dir, 'sheet.png'), Buffer.from(a))
  utimesSync(join(dir, 'sheet.png'), new Date(), new Date(Date.now() + 5000))
  const st2 = cache.state(dir, 'sheet.png', stored)
  assert(st2.status === 'unchanged' && st2.hash === stored, 'edited file re-hashed to the new bytes')
  assert(cache.recomputes === 2, 'changed mtime ⇒ exactly one re-hash')
  assert(cache.state(dir, 'gone.png', stored).status === 'missing', 'missing file ⇒ missing (entry dropped)')
  cache.clear()
  cache.state(dir, 'sheet.png', stored)
  assert(cache.recomputes === 3, 'clear() forgets hashes')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

// ── ConflictTracker (number values) ───────────────────────────────────────────
{
  const t = new ConflictTracker<number>(numEq)
  t.record('palOffset:10', 0x1234, 'fileA')
  t.record('palOffset:10', 0x1234, 'fileB') // SAME value → agree, no conflict
  t.record('palOffset:20', 0x5678, 'fileA')
  const r = t.resolve()
  assert(r.conflicts.length === 0, 'two files agreeing on a value ⇒ no conflict')
  assert(r.winners.get('palOffset:10') === 0x1234, 'agreed value wins')
  assert(r.winners.get('palOffset:20') === 0x5678, 'untouched-by-others value wins')
  assert(r.winners.size === 2, 'both keys applied')
}
{
  const t = new ConflictTracker<number>(numEq)
  t.record('palOffset:10', 0x1111, 'fileA') // red
  t.record('palOffset:10', 0x2222, 'fileB') // blue — DISAGREE
  t.record('palOffset:20', 0x3333, 'fileA') // only A → fine
  const r = t.resolve()
  assert(r.conflicts.length === 1, 'two files disagreeing on a value ⇒ one conflict')
  assert(r.conflicts[0]!.key === 'palOffset:10' && r.conflicts[0]!.sources.length === 2, 'conflict names the key + both sources')
  assert(!r.winners.has('palOffset:10'), 'the conflicting datum is DROPPED (skipped)')
  assert(r.winners.get('palOffset:20') === 0x3333, 'the non-conflicting datum still applies (rest imported)')
  assert(r.winners.size === 1, 'exactly the non-conflicting key applied')
}
// Three sources, two agree + one disagrees → still a conflict (any disagreement drops it).
{
  const t = new ConflictTracker<number>(numEq)
  t.record('k', 1, 'a'); t.record('k', 1, 'b'); t.record('k', 9, 'c')
  const r = t.resolve()
  assert(r.conflicts.length === 1 && !r.winners.has('k'), 'any disagreeing source ⇒ conflict (drop)')
  assert(r.conflicts[0]!.sources.includes('a') && r.conflicts[0]!.sources.includes('c'), 'conflict lists the disagreeing sources')
}

// ── ConflictTracker (byte-array values) ───────────────────────────────────────
{
  const t = new ConflictTracker<Uint8Array>(bytesEq)
  t.record('tile:5', Uint8Array.of(1, 2, 3), 'sprites/0x42.png')
  t.record('tile:5', Uint8Array.of(1, 2, 3), 'metasprite/0A2.png') // identical bytes → agree
  t.record('tile:6', Uint8Array.of(9, 9, 9), 'metasprite/0A2.png')
  const r1 = t.resolve()
  assert(r1.conflicts.length === 0, 'identical tile bytes from two files ⇒ no conflict (merge)')
  assert(bytesEq(r1.winners.get('tile:5')!, Uint8Array.of(1, 2, 3)), 'agreed tile bytes win')

  const t2 = new ConflictTracker<Uint8Array>(bytesEq)
  t2.record('tile:5', Uint8Array.of(1, 2, 3), 'sprites/0x42.png')
  t2.record('tile:5', Uint8Array.of(4, 5, 6), 'metasprite/0A2.png') // different bytes → conflict
  const r2 = t2.resolve()
  assert(r2.conflicts.length === 1 && !r2.winners.has('tile:5'), 'two files painting one CHR tile differently ⇒ conflict (skip)')
}

// ── countChangedUnits (the change-vs-base magnitude the inventory reports) ─────
{
  // Two 32-byte CHR tiles; edit one byte in the 2nd → 1 of 2 tiles changed.
  const base = new Uint8Array(64)
  const next = base.slice(); next[40] = 0xff
  const r = countChangedUnits(next, base, 32)
  assert(r.totalUnits === 2 && r.changedUnits === 1, 'CHR: one edited tile of two ⇒ 1/2 changed')

  // Identical blobs ⇒ nothing changed.
  assert(countChangedUnits(base, base.slice(), 32).changedUnits === 0, 'identical blobs ⇒ 0 changed')

  // Tilemap words (2-byte stride): edit one word → 1 cell changed.
  const tmBase = new Uint8Array(8) // 4 cells
  const tmNext = tmBase.slice(); tmNext[5] = 0x12 // 3rd word, high byte
  const tm = countChangedUnits(tmNext, tmBase, 2)
  assert(tm.totalUnits === 4 && tm.changedUnits === 1, 'tilemap: one edited word of four ⇒ 1/4 cells')

  // Raw bytes (stride 1): count exactly the differing bytes.
  const rawBase = Uint8Array.of(0, 0, 0, 0, 0)
  const rawNext = Uint8Array.of(0, 9, 0, 9, 9)
  const raw = countChangedUnits(rawNext, rawBase, 1)
  assert(raw.totalUnits === 5 && raw.changedUnits === 3, 'raw: 3 differing bytes ⇒ 3/5')

  // No base (new file): every unit counts as changed.
  const grown = countChangedUnits(new Uint8Array(64), new Uint8Array(0), 32)
  assert(grown.totalUnits === 2 && grown.changedUnits === 2, 'no base ⇒ all units changed (new file)')

  // A length increase: the extra unit beyond base counts as changed.
  const longer = countChangedUnits(new Uint8Array(96), new Uint8Array(64), 32)
  assert(longer.totalUnits === 3 && longer.changedUnits === 1, 'grown blob ⇒ the extra tile is changed')
}

console.log(failures === 0 ? '\nAll conflict-core pins passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
