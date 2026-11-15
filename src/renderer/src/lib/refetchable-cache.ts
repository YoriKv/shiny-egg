// A single fetched value that can go stale: a cart table read from the render
// ROM, which changes on a project switch, a ROM import, a rebuild or a table
// edit (App invalidates on project scope / `renderRefresh`; see
// docs/notes-edit-architecture.md §Table previews). Shared fetch, refetch on
// invalidate, and a `useSyncExternalStore`-shaped snapshot/subscribe pair
// (`hooks/useRefetchableCache`).
//
//   - The last value is kept while a refetch is in flight, so consumers don't
//     flicker back to "not loaded".
//   - A refetch that returns an equal value keeps the old identity: consumers
//     keyed on it don't recompute, and subscribers aren't notified.
//   - A fetch started before an invalidation answers its own caller but is
//     never cached (it describes the old project / build).
//   - A failed fetch isn't cached; the next `get` retries.

export interface RefetchableCache<T> {
  /** What it holds, for log messages. */
  readonly label: string
  /** The last fetched value (possibly being refreshed), else null. */
  current(): T | null
  /** The value, fetching it if never fetched or invalidated since. */
  get(): Promise<T>
  /** Called when a fetch produces a new (non-equal) value. */
  subscribe(listener: () => void): () => void
  /** Mark the value stale and refetch it now. */
  invalidate(): void
}

export function createRefetchableCache<T>(
  label: string,
  fetch: () => Promise<T>,
  equal: (a: T, b: T) => boolean
): RefetchableCache<T> {
  let value: T | null = null
  let fresh = false
  let fetching: Promise<T> | null = null
  let generation = 0
  const listeners = new Set<() => void>()

  const get = (): Promise<T> => {
    if (value !== null && fresh) return Promise.resolve(value)
    if (fetching) return fetching
    const started = generation
    const p = fetch().then(
      (next) => {
        if (started !== generation) return next
        fetching = null
        fresh = true
        if (value !== null && equal(value, next)) return value
        value = next
        for (const listener of listeners) listener()
        return next
      },
      (e: unknown) => {
        if (started === generation) fetching = null
        throw e
      }
    )
    fetching = p
    return p
  }

  return {
    label,
    current: () => value,
    get,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    invalidate() {
      generation++
      fresh = false
      fetching = null
      get().catch((e: unknown) => {
        console.warn(`${label} refetch failed:`, e)
      })
    }
  }
}
