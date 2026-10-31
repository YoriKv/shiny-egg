// Turns a failed asar run into a message a user can act on. asar's own text
// cites where an assert or error physically lives: every `%FREE_BYTES` /
// fixed-address assert reports `global/HardwareRegisters/SNES.asm` with only
// the address it guarded, and an asm-patch error reports a line of the
// generated `Custom/Asar_Patches_YI.asm` hook. Neither says which level pool
// overflowed or which patch broke, so this maps them back: an assert address to
// the level pool / free region whose span holds it, a hook line to the patch
// body it came from. Electron-free so it unit-tests with plain `node`
// (build-errors.test.ts).

import type { AsarDiagnostic } from 'snes-framework/types'
import { poolLevels, type PoolMap } from 'snes-framework/pool-map'

export interface BuildErrorContext {
  /** Text of the generated asm-patch hook, when the build assembled asm patches. */
  patchHook: string | null
  /** The active cart's pool map (null before a base build). */
  poolMap: PoolMap | null
}

const PATCH_HOOK_FILE = /Custom[\\/]Asar_Patches_YI\.asm$/
const PATCH_MARKER = /^;--- patch: (.+) ---$/
// The `%endpatchcode` assert's custom message (build-tree.ts generateAsarPatchesAsm).
const PATCH_POOL_OVERFLOW = 'asm-patch pool overflow'
// The guarded address in a fixed-address assert, as asar echoes the source:
// `[assert pc() <= $5110DB|$000000|$000000]` or `[assert pc() <= ($00F7A7|$800000)^$400000]`.
const ASSERT_ADDR = /assert pc\(\) <= \(?\$([0-9A-Fa-f]{6})/

const hex2 = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0')
const snesHex = (a: number): string => `0x${hex2(a >>> 16)}:${(a & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`

/** The patch (id + 1-based line within its own asm) that hook line `line` came
 *  from, or null for the hook's own scaffolding. A patch's body runs from the
 *  line after its marker to the line before the next marker, or before the
 *  hook's closing `endmacro` for the last one. */
export function patchAtHookLine(hook: string, line: number): { id: string; line: number } | null {
  const lines = hook.split(/\r?\n/)
  let end = lines.length
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.trim() === 'endmacro') {
      end = i + 1 // 1-based line of the closing endmacro
      break
    }
  }
  if (line >= end) return null
  let current: { id: string; markerLine: number } | null = null
  for (let i = 0; i < line && i < lines.length; i++) {
    const m = PATCH_MARKER.exec(lines[i]!)
    if (m) current = { id: m[1]!, markerLine: i + 1 }
  }
  if (!current || line <= current.markerLine) return null
  return { id: current.id, line: line - current.markerLine }
}

/** What an assert at SNES address `addr` guarded, when it falls inside a level
 *  pool's span (first blob → end of its fill) or a free region. Null otherwise:
 *  fixed-address asserts sit all over the cart, so a bare bank match would
 *  misattribute an unrelated code overflow to a pool. */
export function describeOverflow(addr: number, map: PoolMap | null): string | null {
  if (!map) return null
  for (const pool of map.pools) {
    if (pool.blobs.length === 0) continue
    const start = Math.min(...pool.blobs.map((b) => b.snesAddr))
    const end = pool.tail.boundary + pool.tail.fillSize
    if (addr < start || addr > end) continue
    const levels = poolLevels(pool).map((l) => `0x${l}`).join(', ')
    const fix = pool.tail.reclaimable
      ? 'Migrate one of them to free space in the Level Banks panel, or shrink one'
      : 'Shrink one of them'
    return `Level data in ${pool.id} doesn't fit (levels ${levels}). ${fix}, then rebuild.`
  }
  for (const r of map.freeRegions) {
    if (addr < r.boundary || addr > r.boundary + r.capacityBytes) continue
    return (
      `Free space ${r.id} is full: the level data migrated into it doesn't fit. ` +
      'Un-migrate or shrink some levels, or reduce the asm-patch pool, then rebuild.'
    )
  }
  return null
}

/** One user-facing line for one asar error. */
function explainOne(d: AsarDiagnostic, ctx: BuildErrorContext): string {
  if (PATCH_HOOK_FILE.test(d.file)) {
    if (d.message.includes(PATCH_POOL_OVERFLOW)) {
      return (
        'The enabled asm patches need more room than the asm-patch pool reserves. ' +
        'Raise the pool size in the Patches panel or disable a patch, then rebuild.'
      )
    }
    // asar 1.91 numbers lines inside a macro body one lower than the file line,
    // and every patch body sits inside the hook's YI_ApplyPatchesPostAssembly.
    const p = ctx.patchHook ? patchAtHookLine(ctx.patchHook, d.line + 1) : null
    if (p) return `Patch "${p.id}" (${p.id}.asm, line ${p.line}): ${d.message}`
  }
  if (d.code === 'Eassertion_failed') {
    const m = ASSERT_ADDR.exec(d.message)
    if (m) {
      const addr = parseInt(m[1]!, 16)
      return (
        describeOverflow(addr, ctx.poolMap) ??
        `Data in bank 0x${hex2(addr >>> 16)} runs past ${snesHex(addr)}, the end of the space it has ` +
          'there. A recent edit (a level, graphics, text or an asm edit) grew too large to fit.'
      )
    }
  }
  return `${d.file.replace(/^(\.\.\/)+/, '')}:${d.line}: ${d.message}`
}

/** A multi-line explanation of a failed asar run, or null when it carries no
 *  parsed errors (the caller then keeps asar's own message). At most 5 lines,
 *  de-duplicated: one overflow can trip several asserts. */
export function explainAsarFailure(diagnostics: AsarDiagnostic[], ctx: BuildErrorContext): string | null {
  if (diagnostics.length === 0) return null
  const lines = [...new Set(diagnostics.map((d) => explainOne(d, ctx)))].slice(0, 5)
  return ['Build failed:', ...lines.map((l) => `• ${l}`)].join('\n')
}
