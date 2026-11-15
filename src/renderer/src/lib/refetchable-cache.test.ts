// Pins the refetchable cart-table cache contract (lib/refetchable-cache.ts),
// used for the object property and collision tables read from the render ROM:
// a fetch that started before an invalidation is never cached, an equal
// refetch keeps the old identity (consumers keyed on it don't recompute) and
// doesn't notify, the last value is kept while refetching, and a failed fetch
// is retried. Fetches are resolved by hand to drive the races.
//
// Run via Vitest (renderer config): `pnpm run test:renderer`.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createRefetchableCache } from './refetchable-cache'

type Pending = Array<{ resolve: (t: Uint8Array) => void; reject: (e: unknown) => void }>

function setup(): { cache: ReturnType<typeof createRefetchableCache<Uint8Array>>; pending: Pending } {
  const pending: Pending = []
  const cache = createRefetchableCache(
    'test table',
    () => new Promise<Uint8Array>((resolve, reject) => pending.push({ resolve, reject })),
    (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
  )
  return { cache, pending }
}

const table = (fill: number): Uint8Array => new Uint8Array(256).fill(fill)

describe('refetchable cache', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}))
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  test('fetches once, then serves the cached value', async () => {
    const { cache, pending } = setup()
    const first = cache.get()
    expect(cache.get()).toBe(first) // in-flight shared
    pending[0]!.resolve(table(2))
    const t = await first
    expect(cache.current()).toBe(t)
    expect(await cache.get()).toBe(t)
    expect(pending).toHaveLength(1)
  })

  test('invalidate refetches; a new value replaces the old and notifies', async () => {
    const { cache, pending } = setup()
    const p = cache.get()
    pending[0]!.resolve(table(2))
    const old = await p
    const listener = vi.fn()
    cache.subscribe(listener)
    cache.invalidate()
    expect(pending).toHaveLength(2)
    expect(cache.current()).toBe(old) // last value kept while refetching
    const next = table(1)
    pending[1]!.resolve(next)
    await cache.get()
    expect(cache.current()).toBe(next)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  test('an equal refetch keeps the old identity and does not notify', async () => {
    const { cache, pending } = setup()
    const p = cache.get()
    pending[0]!.resolve(table(2))
    const old = await p
    const listener = vi.fn()
    cache.subscribe(listener)
    cache.invalidate()
    pending[1]!.resolve(table(2)) // same bytes, new array
    expect(await cache.get()).toBe(old)
    expect(listener).not.toHaveBeenCalled()
  })

  test('a fetch started before an invalidation is not cached', async () => {
    const { cache, pending } = setup()
    const stale = cache.get()
    cache.invalidate() // e.g. project switch mid-fetch
    pending[1]!.resolve(table(1)) // new project's answer arrives first
    pending[0]!.resolve(table(2)) // old project's answer arrives late
    await stale
    await Promise.resolve()
    expect(cache.current()![0]).toBe(1)
  })

  test('a failed fetch is retried on the next call', async () => {
    const { cache, pending } = setup()
    const failed = cache.get()
    pending[0]!.reject(new Error('no build yet'))
    await expect(failed).rejects.toThrow('no build yet')
    const retry = cache.get()
    expect(pending).toHaveLength(2)
    pending[1]!.resolve(table(2))
    expect((await retry)[0]).toBe(2)
  })

  test('the collision table cache treats a structurally equal refetch as unchanged', async () => {
    const result = () => ({
      table: [{ tag: 3, flags: { al: true } }, { tag: 0, flags: { al: false } }],
      pipeEntryBits: new Uint8Array([1, 2, 3])
    })
    vi.stubGlobal('window', { shinyEgg: { render: { collisionTable: vi.fn(async () => result()) } } })
    vi.resetModules()
    const { collisionTableCache } = await import('../data/collision-info')
    const first = await collisionTableCache.get()
    collisionTableCache.invalidate()
    expect(await collisionTableCache.get()).toBe(first)
  })
})
