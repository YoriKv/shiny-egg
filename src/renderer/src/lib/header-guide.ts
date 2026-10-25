// Level Header panel guides — pure text/option builders over the base-cart
// header-usage index (`render:headerGuide`, level.ts `headerValueUsage`). Kept
// out of the panel so the wording and the option list are unit-testable.
//
// Why usage: names for a header value are partly inferred (several are
// GoldenEgg's appearance names, some fields have none at all), but which shipped
// levels pick a value is a fact the cart states. It describes the unnamed fields
// (sprite tileset, animation tileset, palette rows) and exposes values the curated
// lists missed (shipped levels use BG scroll rates the source table never named).

import type { HeaderGuide } from '../../../preload/api'
import type { EnumOption } from '../data/property-schema'

/** How the panel names a record in a usage summary. `order` sorts the groups
 *  (world-map order for levels; orphans after). */
export interface UsageLabel {
  short: string
  long: string
  order: number
}

export interface UsageSummary {
  /** Rooms (records) that use the value. */
  count: number
  /** One line for under the field. */
  text: string
  /** Every group, one per line — the line's tooltip. */
  full: string
}

/** Groups visible in `text` before it collapses to "+N more". */
const SHOWN_GROUPS = 4

/** Summarize the records using one header value, grouped by the world-map level
 *  that reaches each (`rootOf`; a record with no root is its own group). */
export function summarizeUsage(
  ids: readonly number[],
  rootOf: readonly (number | null | undefined)[],
  labelFor: (recordId: number) => UsageLabel
): UsageSummary {
  if (ids.length === 0) {
    return { count: 0, text: 'No shipped level uses this value.', full: '' }
  }
  const groups = new Map<number, number>()
  for (const id of ids) {
    const key = rootOf[id] ?? id
    groups.set(key, (groups.get(key) ?? 0) + 1)
  }
  const sorted = [...groups.entries()]
    .map(([key, rooms]) => ({ label: labelFor(key), rooms }))
    .sort((a, b) => a.label.order - b.label.order)
  const tag = (g: { label: UsageLabel; rooms: number }): string =>
    g.rooms > 1 ? `${g.label.short} ×${g.rooms}` : g.label.short
  const shown = sorted.slice(0, SHOWN_GROUPS).map(tag).join(', ')
  const more = sorted.length > SHOWN_GROUPS ? ` +${sorted.length - SHOWN_GROUPS} more` : ''
  const rooms = `${ids.length} room${ids.length === 1 ? '' : 's'}`
  return {
    count: ids.length,
    text: `Used in ${rooms}: ${shown}${more}`,
    full: sorted
      .map((g) => `${g.label.long}${g.rooms > 1 ? ` — ${g.rooms} rooms` : ''}`)
      .join('\n')
  }
}

/** A name for an unnamed header value, from the records that use it: their most
 *  common `keyOf` (a companion tileset's name, or the level they belong to), up
 *  to `max`, most frequent first, joined by `sep`, with "+N" for the rest.
 *  Undefined when no record names anything. */
export function usageName(
  ids: readonly number[],
  keyOf: (recordId: number) => string | undefined,
  max: number,
  sep = ', '
): string | undefined {
  const tally = new Map<string, number>()
  for (const id of ids) {
    const key = keyOf(id)
    if (key) tally.set(key, (tally.get(key) ?? 0) + 1)
  }
  if (tally.size === 0) return undefined
  const keys = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k) // stable: ties keep first-seen order
  const more = keys.length > max ? ` +${keys.length - max}` : ''
  return keys.slice(0, max).join(sep) + more
}

/** A field's option list with each entry's shipped-level count folded into its
 *  label, plus an entry for every value shipped levels use that the list lacks
 *  — so a value the game relies on is never unpickable. An option with an empty
 *  label takes `fallbackName(value)` (usage-derived), else "unnamed". Values
 *  neither listed nor used stay off (EnumField still shows the current one as a
 *  raw fallback). `used[value]` = the records using `value`. */
export function guideOptions(
  options: readonly EnumOption[],
  used: readonly (readonly number[] | undefined)[] | undefined,
  fallbackName: (value: number) => string | undefined = () => undefined
): EnumOption[] {
  const count = (v: number): number => used?.[v]?.length ?? 0
  const name = (o: EnumOption): string => o.label || fallbackName(o.value) || 'unnamed'
  const listed = new Set(options.map((o) => o.value))
  const out: EnumOption[] = options.map((o) => ({
    ...o,
    label: !used
      ? name(o)
      : count(o.value) > 0
        ? `${name(o)} (${count(o.value)})`
        : o.label
          ? `${o.label} — unused`
          : 'unused'
  }))
  used?.forEach((ids, value) => {
    if (!listed.has(value) && ids && ids.length > 0) {
      out.push({ value, label: `${fallbackName(value) || 'unnamed'} (${ids.length})` })
    }
  })
  return out.sort((a, b) => a.value - b.value)
}

/** Each record's header, rebuilt from the inverted usage index — so a value can
 *  be described by what else its levels set (a palette by its tileset). */
export function recordHeaders(usage: HeaderGuide['usage']): Map<number, number[]> {
  const out = new Map<number, number[]>()
  usage.byField.forEach((values, field) =>
    values.forEach((ids, value) => {
      for (const id of ids) {
        const h = out.get(id) ?? out.set(id, []).get(id)!
        h[field] = value
      }
    })
  )
  return out
}
