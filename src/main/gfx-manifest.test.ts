// Manifest fs-helper pins (gfx-manifest.ts): the yychr manifest reader + the import's
// checksum write-back (updateManifestChecksums must advance ONLY the given keys and
// preserve every other manifest section byte-structurally). Cart-free, no Electron.
//
// Run: node src/main/gfx-manifest.test.ts

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MANIFEST, isNewerAppVersion, readYychrManifest, updateManifestChecksums } from './gfx-manifest.ts'

let failures = 0
function assert(cond: boolean, msg: string): void {
  if (cond) { console.log(`  ✓ ${msg}`) } else { console.error(`  ✗ ${msg}`); failures++ }
}

const dir = mkdtempSync(join(tmpdir(), 'gfx-manifest-'))
try {
  // ── readYychrManifest ───────────────────────────────────────────────────────
  assert(readYychrManifest(dir) === null, 'missing manifest → null')
  writeFileSync(join(dir, MANIFEST), 'not json {')
  assert(readYychrManifest(dir) === null, 'malformed manifest → null')
  writeFileSync(join(dir, MANIFEST), JSON.stringify({ checksums: {}, entries: [] }))
  assert(readYychrManifest(dir) === null, 'manifest with no yychr rows → null (a PNG-track folder)')

  const manifest = {
    exportedBy: '0.5.12',
    checksums: { 'bg2/f10.2bpp.gb': 'aaaa', 'other/f20.4bpp.sfc': 'bbbb' },
    entries: [{ file: 'x.png', description: 'kept-verbatim' }],
    yychr: [
      { file: 'bg2/f10.2bpp.gb', description: 'BG2 background', kind: 'chr', format: 'lz16', fileId: 16, bpp: 2, sizeBytes: 4096, tileBytes: 16 }
    ],
    fonts: null
  }
  writeFileSync(join(dir, MANIFEST), JSON.stringify(manifest, null, 2))
  const read = readYychrManifest(dir)
  assert(read !== null && read.yychr.length === 1 && read.yychr[0]!.file === 'bg2/f10.2bpp.gb', 'yychr rows read back')
  assert(read!.checksums?.['bg2/f10.2bpp.gb'] === 'aaaa', 'checksums map read back')
  assert(read!.exportedBy === '0.5.12', 'exportedBy version stamp read back')

  // ── isNewerAppVersion (the export version-stamp gate) ───────────────────────
  assert(!isNewerAppVersion(undefined, '0.5.12'), 'unstamped (pre-stamp export) is never newer')
  assert(!isNewerAppVersion('0.5.12', '0.5.12'), 'same version is not newer')
  assert(!isNewerAppVersion('0.5.11', '0.5.12'), 'older export is not newer')
  assert(!isNewerAppVersion('0.5', '0.5.0'), 'missing segments compare as 0')
  assert(isNewerAppVersion('0.5.13', '0.5.12'), 'newer patch detected')
  assert(isNewerAppVersion('0.6.0', '0.5.99'), 'newer minor beats larger patch')
  assert(isNewerAppVersion('1.0.0', '0.5.12'), 'newer major detected')
  assert(isNewerAppVersion('0.5.12.1', '0.5.12'), 'extra segment counts as newer')
  assert(isNewerAppVersion('0.10.0', '0.9.0'), 'numeric (not lexicographic) segment compare')

  // ── updateManifestChecksums (the import write-back) ─────────────────────────
  assert(updateManifestChecksums(dir, {}), 'empty updates → true no-op')
  assert(updateManifestChecksums(dir, { 'bg2/f10.2bpp.gb': 'cccc', 'new/file.1bpp': 'dddd' }), 'write-back returns true')
  const after = JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8'))
  assert(after.checksums['bg2/f10.2bpp.gb'] === 'cccc', 'updated key advanced to the new hash')
  assert(after.checksums['other/f20.4bpp.sfc'] === 'bbbb', 'untouched checksum key preserved')
  assert(after.checksums['new/file.1bpp'] === 'dddd', 'new key merged in')
  assert(after.entries[0].description === 'kept-verbatim', 'other manifest sections preserved structurally')
  assert(after.yychr.length === 1 && after.fonts === null, 'yychr rows + null sections preserved')

  // A manifest without a checksums map gains one.
  writeFileSync(join(dir, MANIFEST), JSON.stringify({ yychr: manifest.yychr }))
  assert(updateManifestChecksums(dir, { a: '1' }), 'write-back creates checksums when absent')
  assert(JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8')).checksums.a === '1', 'created map holds the update')

  // Unwritable/missing manifest → false (statuses just stay changed; caller warns).
  rmSync(join(dir, MANIFEST))
  assert(!updateManifestChecksums(dir, { a: '1' }), 'missing manifest → false')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nAll gfx-manifest pins passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
