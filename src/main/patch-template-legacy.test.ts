// Pins stripLegacyTemplateChunks (patch-template-legacy.ts), Electron-free, no
// cart: the old "New Patch" template's two live sample chunks are removed in
// any hex spelling the codec accepts, and nothing else is touched (other
// chunks, or different bytes at the same addresses).
//
// Run: node src/main/patch-template-legacy.test.ts

import type { StoredPatchChunk } from 'snes-framework/types'
import { stripLegacyTemplateChunks } from './patch-template-legacy.ts'

let failures = 0
function assert(cond: boolean, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`)
  else {
    console.error(`  ✗ ${msg}`)
    failures++
  }
}

const OFFSET_SAMPLE: StoredPatchChunk = { offset: '0x0093E2', bytes: 'EAEA' }
const LABEL_SAMPLE: StoredPatchChunk = { label: 'CODE_018041', labelOffset: '0x0', bytes: '60' }
const OTHER: StoredPatchChunk = { offset: '0x0062D2', bytes: 'EA' }

console.log('=== the exact old template samples are removed ===')
{
  const out = stripLegacyTemplateChunks([OFFSET_SAMPLE, LABEL_SAMPLE])
  assert(out.length === 0, 'both template samples stripped')
}

console.log('=== other hex spellings of the samples are removed ===')
{
  const variants: StoredPatchChunk[] = [
    { offset: '$0093E2', bytes: '$EA $EA' },
    { offset: '0x93e2', bytes: '0xea, 0xea' },
    { offset: '93E2', bytes: 'eaea' },
    { label: 'CODE_018041', bytes: '60' }, // labelOffset absent == 0x0
    { label: 'CODE_018041', labelOffset: '$00', bytes: '$60' },
    { label: 'CODE_018041', labelOffset: '0X0', bytes: '0x60' }
  ]
  for (const v of variants) {
    assert(stripLegacyTemplateChunks([v]).length === 0, `stripped ${JSON.stringify(v)}`)
  }
}

console.log('=== everything else is kept ===')
{
  const keep: StoredPatchChunk[] = [
    OTHER,
    { offset: '0x0093E2', bytes: 'EA' }, // same address, different bytes
    { offset: '0x0093E2', bytes: 'EAEAEA' },
    { offset: '0x0093E3', bytes: 'EAEA' }, // same bytes, different address
    { label: 'CODE_018041', labelOffset: '0x0', bytes: '6B' },
    { label: 'CODE_018041', labelOffset: '0x1', bytes: '60' },
    { label: 'CODE_018042', bytes: '60' },
    { label: 'CODE_0093E2', bytes: 'EAEA' }
  ]
  const out = stripLegacyTemplateChunks(keep)
  assert(out === keep, 'no match returns the same array (callers detect change by identity)')
  assert(out.length === keep.length, 'all non-sample chunks kept')
}

console.log('=== mixed list keeps order of the survivors ===')
{
  const out = stripLegacyTemplateChunks([OFFSET_SAMPLE, OTHER, LABEL_SAMPLE])
  assert(out.length === 1 && out[0] === OTHER, 'only the user chunk remains')
}

console.log('=== malformed chunks are left for the codec to reject ===')
{
  const bad = { offset: '0x0093E2' } as unknown as StoredPatchChunk
  assert(stripLegacyTemplateChunks([bad]).length === 1, 'chunk without bytes is kept, not thrown on')
}

if (failures > 0) {
  console.error(`\n✗ ${failures} failure(s)`)
  process.exit(1)
}
console.log('\n✓ patch-template-legacy: all checks pass')
