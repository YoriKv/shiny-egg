import type { CollisionTableResult } from '../../../preload/api'
import { collisionTableCache } from '../data/collision-info'
import { useRefetchableCache } from './useRefetchableCache'

/**
 * The cart collision table + pipe-entry bits (from the render ROM; App
 * invalidates it on a project switch or render refresh). `null` until the
 * first fetch resolves. Re-renders only when a refetch returns new data.
 */
export function useCollisionTableData(): CollisionTableResult | null {
  return useRefetchableCache(collisionTableCache)
}
