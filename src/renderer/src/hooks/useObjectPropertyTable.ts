import { useEffect, useState } from 'react'
import { getObjectPropertyTable } from '../data/object-record'

/**
 * The cart object-property table (per-cart static, cached by
 * `getObjectPropertyTable`). Three components inlined the same
 * fetch-into-state effect; this is the shared hook. `null` until the cached
 * promise resolves — callers treat null as permissive (`objectSizeMode` → 'wh').
 */
export function useObjectPropertyTable(): Uint8Array | null {
  const [propTable, setPropTable] = useState<Uint8Array | null>(null)
  useEffect(() => {
    let alive = true
    void getObjectPropertyTable().then((t) => {
      if (alive) setPropTable(t)
    })
    return () => {
      alive = false
    }
  }, [])
  return propTable
}
