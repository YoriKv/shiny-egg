// Pure backup-core pins (backup-core.ts) — Electron-free, no cart.
// Covers the three mechanisms the auto-backup safety net rests on:
//   1. collectFiles: excludes regenerable build/ + build-tree/, includes the
//      rest, path-sorted;
//   2. signature: stable for unchanged trees, changes on edit/add/delete;
//   3. buildProjectZip: produces a real, unzippable archive whose entries are
//      `<id>/`-prefixed and byte-identical to the source (round-tripped through
//      fflate's independent unzip).
//
// Run: node src/main/backup-core.test.ts

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import {
  collectFiles,
  signature,
  buildProjectZip,
  stamp,
  backupsToPrune
} from './backup-core.ts'

let failures = 0
function assert(cond: boolean, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`)
  else {
    console.error(`  ✗ ${msg}`)
    failures++
  }
}

// ── fixture: a realistic project folder ───────────────────────────────────────
const root = mkdtempSync(join(tmpdir(), 'backup-core-'))
try {
  mkdirSync(join(root, 'overlay', 'yi'), { recursive: true })
  mkdirSync(join(root, 'patches'), { recursive: true })
  mkdirSync(join(root, 'build'), { recursive: true })
  mkdirSync(join(root, 'build-tree', 'yi'), { recursive: true })
  writeFileSync(join(root, 'project.json'), '{"id":"demo"}')
  writeFileSync(join(root, 'overlay', 'yi', 'level.bin'), Buffer.from([1, 2, 3, 4]))
  writeFileSync(join(root, 'patches', 'p.ips'), 'PATCH')
  // Regenerable caches that MUST be excluded:
  writeFileSync(join(root, 'build', 'rom.sfc'), Buffer.alloc(16))
  writeFileSync(join(root, 'build-tree', 'yi', 'merged.asm'), 'merged')

  // ── collectFiles ────────────────────────────────────────────────────────────
  const files = await collectFiles(root)
  const rels = files.map((f) => f.rel)
  assert(
    JSON.stringify(rels) ===
      JSON.stringify(['overlay/yi/level.bin', 'patches/p.ips', 'project.json']),
    'collectFiles: includes overlay/patches/project.json, excludes build + build-tree, sorted'
  )
  assert(
    !rels.some((r) => r.startsWith('build/') || r.startsWith('build-tree/')),
    'collectFiles: no build/ or build-tree/ entries'
  )

  // ── signature: stable + change-sensitive ─────────────────────────────────────
  const sig0 = signature(await collectFiles(root))
  assert(sig0 === signature(await collectFiles(root)), 'signature: stable for an unchanged tree')

  writeFileSync(join(root, 'overlay', 'yi', 'level.bin'), Buffer.from([1, 2, 3, 4, 5])) // size change
  assert(sig0 !== signature(await collectFiles(root)), 'signature: changes when a file is edited')

  const sigAfterEdit = signature(await collectFiles(root))
  writeFileSync(join(root, 'overlay', 'yi', 'new.bin'), Buffer.from([9])) // add
  assert(sigAfterEdit !== signature(await collectFiles(root)), 'signature: changes when a file is added')

  const sigAfterAdd = signature(await collectFiles(root))
  rmSync(join(root, 'overlay', 'yi', 'new.bin')) // delete
  assert(sigAfterAdd !== signature(await collectFiles(root)), 'signature: changes when a file is deleted')

  // mtime-only change (same size + content) is still detected.
  const sigBeforeTouch = signature(await collectFiles(root))
  const past = new Date(Date.now() - 60_000)
  utimesSync(join(root, 'project.json'), past, past)
  assert(
    sigBeforeTouch !== signature(await collectFiles(root)),
    'signature: changes when only mtime changes'
  )

  // ── buildProjectZip: valid archive, id-prefixed, byte-exact round-trip ────────
  const finalFiles = await collectFiles(root)
  const zip = await buildProjectZip('demo', finalFiles)
  assert(zip.length > 0, 'buildProjectZip: produces non-empty bytes')

  const unzipped = unzipSync(zip)
  const keys = Object.keys(unzipped).sort()
  assert(
    keys.every((k) => k.startsWith('demo/')),
    'buildProjectZip: every entry is prefixed with the project id'
  )
  assert(
    JSON.stringify(keys) ===
      JSON.stringify(['demo/overlay/yi/level.bin', 'demo/patches/p.ips', 'demo/project.json']),
    'buildProjectZip: archive holds exactly the collected files'
  )
  assert(strFromU8(unzipped['demo/project.json']!) === '{"id":"demo"}', 'buildProjectZip: content round-trips byte-exact')
  assert(
    JSON.stringify([...unzipped['demo/overlay/yi/level.bin']!]) === JSON.stringify([1, 2, 3, 4, 5]),
    'buildProjectZip: binary content round-trips byte-exact'
  )

  // ── stamp: filesystem-safe, deterministic for a fixed instant ─────────────────
  const s = stamp(new Date(2026, 5, 30, 21, 5, 3)) // months are 0-based → June
  assert(s === '2026-06-30_21-05-03', 'stamp: formats YYYY-MM-DD_HH-MM-SS with zero-padding')
  assert(/^[0-9_-]+$/.test(s), 'stamp: filesystem-safe (digits, - and _ only)')

  // ── backupsToPrune: keep newest N, drop the oldest excess ─────────────────────
  const mk = (n: number): string[] =>
    Array.from({ length: n }, (_, i) => `2026-06-30_10-00-${String(i).padStart(2, '0')}.zip`)
  assert(backupsToPrune(mk(30), 30).length === 0, 'backupsToPrune: at the limit → delete nothing')
  assert(backupsToPrune(mk(5), 30).length === 0, 'backupsToPrune: under the limit → delete nothing')
  const pruned = backupsToPrune(mk(33), 30)
  assert(
    JSON.stringify(pruned) ===
      JSON.stringify([
        '2026-06-30_10-00-00.zip',
        '2026-06-30_10-00-01.zip',
        '2026-06-30_10-00-02.zip'
      ]),
    'backupsToPrune: over the limit → drops exactly the oldest excess, newest kept'
  )
  assert(
    JSON.stringify(backupsToPrune(['b.zip', 'a.zip', 'c.zip'], 1)) === JSON.stringify(['a.zip', 'b.zip']),
    'backupsToPrune: unsorted input → oldest-first regardless of readdir order'
  )
  assert(
    JSON.stringify(backupsToPrune(['.backup-state.json', 'x.zip.tmp', 'a.zip', 'b.zip'], 1)) ===
      JSON.stringify(['a.zip']),
    'backupsToPrune: ignores non-.zip names (state file, transient .tmp)'
  )
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nAll backup-core tests passed.' : `\n${failures} failure(s).`)
process.exit(failures === 0 ? 0 : 1)
