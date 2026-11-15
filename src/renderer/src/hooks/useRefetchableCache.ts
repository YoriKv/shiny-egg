import { useEffect, useSyncExternalStore } from 'react'
import type { RefetchableCache } from '../lib/refetchable-cache'

/**
 * The cache's current value, re-rendering only when a (re)fetch produces a new
 * value. `null` until the first fetch resolves. Starts the fetch on mount.
 */
export function useRefetchableCache<T>(cache: RefetchableCache<T>): T | null {
  const value = useSyncExternalStore(cache.subscribe, cache.current)
  useEffect(() => {
    cache.get().catch((e: unknown) => {
      console.warn(`${cache.label} fetch failed:`, e)
    })
  }, [cache])
  return value
}
