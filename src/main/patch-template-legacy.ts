// One-time cleanup of the two sample chunks the "New Patch" template used to
// ship LIVE (see the `templatePatchFile` comment in patches.ts). Users enabled
// the template unedited, and those samples broke Hookbill's fight in 4-8: an
// RTS over the fog-init state's entry and two NOPs over an opcode in the
// wall-turn routine. Neither write is ever useful, so `readPatchFile` strips
// them from any user patch on load, whatever the patch is now called.
// Electron-free so it can be unit-tested with plain `node`
// (patch-template-legacy.test.ts). Safe to delete after a few releases.

import type { StoredPatchChunk } from 'snes-framework/types'

/** Stored hex addressing value → number, the same reading as the chunk codec
 *  (`$NN` / `0xNN` / bare hex equivalent; legacy decimal numbers accepted). */
function addr(v: number | string | undefined): number | undefined {
  if (v === undefined) return undefined
  if (typeof v === 'number') return v
  const s = v.trim()
  return parseInt(s.replace(/^\$/, '').replace(/^0x/i, ''), 16)
}

/** Hex bytes → packed uppercase, the same sugar the codec strips
 *  (`$NN` / `0xNN` prefixes, whitespace, commas). */
function packedHex(b: string): string {
  return b.replace(/0x/gi, '').replace(/[$\s,]/g, '').toUpperCase()
}

/** True for one of the old template's two sample writes:
 *  `{ offset: '0x0093E2', bytes: 'EAEA' }` (no label) or
 *  `{ label: 'CODE_018041', labelOffset: '0x0', bytes: '60' }` (no offset;
 *  an absent labelOffset counts as 0). */
function isLegacyTemplateChunk(c: StoredPatchChunk): boolean {
  if (typeof c?.bytes !== 'string') return false // malformed: leave it to the codec's error
  const bytes = packedHex(c.bytes)
  if (c.label === undefined && c.labelOffset === undefined) {
    return addr(c.offset) === 0x0093e2 && bytes === 'EAEA'
  }
  if (c.offset === undefined) {
    return c.label === 'CODE_018041' && (addr(c.labelOffset) ?? 0) === 0 && bytes === '60'
  }
  return false
}

/** `chunks` minus the old template's sample writes (same array when none
 *  match, so callers can detect a change by identity). */
export function stripLegacyTemplateChunks(chunks: StoredPatchChunk[]): StoredPatchChunk[] {
  const kept = chunks.filter((c) => !isLegacyTemplateChunk(c))
  return kept.length === chunks.length ? chunks : kept
}
