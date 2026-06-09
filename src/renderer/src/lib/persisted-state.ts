// Tiny `localStorage` wrapper used by the renderer for UI preferences
// (window positions, layer visibility, etc.). One helper absorbs both
// existing call sites — read/parse/JSON-fallback, write/serialize/swallow.
//
// On read: if both `defaults` and the parsed value are plain objects, the
// parsed value is shallow-merged over defaults. That gives the "partial
// read" tolerance callers want — if a future schema adds a new key, old
// stored payloads still hydrate cleanly. Non-object values (arrays,
// primitives) are returned as-is.
//
// Versioned keys (`shinyEgg.foo.v1`) are the recommended convention so a
// future schema change can invalidate cleanly by bumping the suffix.

export interface PersistedState<T> {
  load: () => T
  save: (value: T) => void
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export function persistedState<T>(key: string, defaults: T): PersistedState<T> {
  return {
    load(): T {
      try {
        const raw = window.localStorage.getItem(key)
        if (!raw) return defaults
        const parsed = JSON.parse(raw) as T
        if (isPlainObject(parsed) && isPlainObject(defaults)) {
          return { ...(defaults as object), ...(parsed as object) } as T
        }
        return parsed
      } catch {
        return defaults
      }
    },
    save(value: T): void {
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
      } catch {
        // best-effort; localStorage may be unavailable in some test contexts
      }
    }
  }
}
