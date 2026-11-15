import { objectPropertyTableCache } from '../data/object-record'
import { useRefetchableCache } from './useRefetchableCache'

/**
 * The cart object-property table (from the render ROM; App invalidates it on a
 * project switch or render refresh). Shared by every component that gates size
 * fields / resize handles. `null` until the first fetch resolves — callers
 * treat null as permissive (`objectSizeMode` → 'wh'). Re-renders only when a
 * refetch returns new bytes.
 */
export function useObjectPropertyTable(): Uint8Array | null {
  return useRefetchableCache(objectPropertyTableCache)
}
