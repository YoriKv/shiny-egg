// Pins explainAsarFailure (build-errors.ts), Electron-free, no cart: an assert
// address inside a level pool's span names the pool and its levels, one in a
// free region names the region, an unknown one gets the generic bank message;
// an asm-patch hook line maps back to its patch id + line, the patch-pool
// overflow assert gets its own fix; anything else passes through.
//
// Run: node src/main/build-errors.test.ts

import type { AsarDiagnostic } from 'snes-framework/types'
import type { LevelPool, PoolMap } from 'snes-framework/pool-map'
import { describeOverflow, explainAsarFailure, patchAtHookLine } from './build-errors.ts'

let failures = 0
function assert(cond: boolean, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`)
  else {
    console.error(`  ✗ ${msg}`)
    failures++
  }
}

// Bank51's V1.0 shape: levels 0x32/0x69 from $51:0000, closed at $51:10DB with
// no fill; FreeRegion51 from $51:5348.
const pool51: LevelPool = {
  id: 'Bank51',
  bank: 0x51,
  capacityBytes: 0x10db,
  headroomBytes: 0,
  tail: { bankFile: 'Banks/Bank51.asm', boundary: 0x5110db, fillSize: 0, movable: false, reclaimable: true },
  blobs: [
    { level: '32', kind: 'obj', label: 'DATA_level_32_obj', file: 'DATA_level_32_obj.bin', snesAddr: 0x510000, baseBytes: 0x800 },
    { level: '69', kind: 'obj', label: 'DATA_level_69_obj', file: 'DATA_level_69_obj.bin', snesAddr: 0x510800, baseBytes: 0x8db }
  ]
}
const map: PoolMap = {
  romVersion: 'YI_U1',
  pools: [pool51],
  poolByFile: new Map(pool51.blobs.map((b) => [b.file, pool51])),
  freeRegions: [{ id: 'FreeRegion51', bankFile: 'Banks/Bank51.asm', boundary: 0x515348, capacityBytes: 44216 }]
}
const assertDiag = (expr: string): AsarDiagnostic => ({
  file: '../global/HardwareRegisters/SNES.asm',
  line: 651,
  code: 'Eassertion_failed',
  message: `Assertion failed. [assert pc() <= ${expr}]`
})

const HOOK = [
  'if !Define_Global_ApplyAsarPatches == !TRUE', // 1
  'macro endpatchcode()', // 2
  'assert pc() <= !PatchPool_End, "asm-patch pool overflow: …"', // 3
  'endmacro', // 4
  'macro YI_ApplyPatchesPostAssembly()', // 5
  ';--- patch: first ---', // 6
  'org $008000', // 7
  'db $EA', // 8
  '', // 9
  '', // 10
  ';--- patch: second ---', // 11
  'org $008001', // 12
  'LDQ #$01', // 13
  'endmacro', // 14
  'endif' // 15
].join('\n')

console.log('=== patchAtHookLine ===')
{
  const p = patchAtHookLine(HOOK, 13)
  assert(p?.id === 'second' && p.line === 2, `line 13 → "second" line 2, got ${JSON.stringify(p)}`)
  const q = patchAtHookLine(HOOK, 8)
  assert(q?.id === 'first' && q.line === 2, `line 8 → "first" line 2, got ${JSON.stringify(q)}`)
  assert(patchAtHookLine(HOOK, 3) === null, 'scaffolding before the first marker → null')
  assert(patchAtHookLine(HOOK, 11) === null, 'a marker line itself → null')
  assert(patchAtHookLine(HOOK, 14) === null, 'the closing endmacro → null')
}

console.log('=== describeOverflow ===')
{
  assert(describeOverflow(0x5110db, map)?.startsWith("Level data in Bank51 doesn't fit (levels 0x32, 0x69)") === true, 'pool boundary → pool + its levels')
  assert(describeOverflow(0x5110db, map)?.includes('Migrate one of them') === true, 'reclaimable pool offers migration')
  assert(describeOverflow(0x516000, map)?.startsWith('Free space FreeRegion51 is full') === true, 'inside the free region → region')
  assert(describeOverflow(0x512000, map) === null, 'between the pool and the region (the GSU block) → null')
  assert(describeOverflow(0x03b273, map) === null, 'another bank → null')
  assert(describeOverflow(0x5110db, null) === null, 'no pool map (V1.1) → null')
}

console.log('=== explainAsarFailure ===')
{
  const ctx = { patchHook: HOOK, poolMap: map }
  assert(explainAsarFailure([], ctx) === null, 'no diagnostics → null (caller keeps asar\'s message)')

  const pool = explainAsarFailure([assertDiag('$5110DB|$000000|$000000'), assertDiag('$5110DB|$000000|$000000')], ctx)!
  assert(pool.split('\n').length === 2 && pool.includes('Level data in Bank51'), `pool overflow, repeat folded:\n${pool}`)

  const lorom = explainAsarFailure([assertDiag('($00F7A7|$800000)^$400000')], { patchHook: null, poolMap: null })!
  assert(lorom.includes('Data in bank 0x00 runs past 0x00:F7A7'), `LoROM-form assert, no map → generic bank message:\n${lorom}`)

  const patch = explainAsarFailure(
    // asar reports macro-body lines one low: file line 13 arrives as 12.
    [{ file: '../yi/Custom/Asar_Patches_YI.asm', line: 12, code: 'Eunknown_command', message: 'Unknown command. [LDQ #$01]' }],
    ctx
  )!
  assert(patch.includes('Patch "second" (second.asm, line 2): Unknown command. [LDQ #$01]'), `patch error mapped:\n${patch}`)

  const overflow = explainAsarFailure(
    [{ file: '../yi/Custom/Asar_Patches_YI.asm', line: 3, code: 'Eassertion_failed', message: 'asm-patch pool overflow: the enabled patches need more than the reserved $51 slice' }],
    ctx
  )!
  assert(overflow.includes('Raise the pool size in the Patches panel'), `patch-pool overflow gets its fix:\n${overflow}`)

  const other = explainAsarFailure(
    [{ file: '../yi/Banks/Bank03.asm', line: 120, code: 'Elabel_not_found', message: "Label 'Foo' wasn't found. [JSL Foo]" }],
    ctx
  )!
  assert(other.includes("yi/Banks/Bank03.asm:120: Label 'Foo' wasn't found."), `other errors pass through:\n${other}`)
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('\nAll build-errors tests passed.')
