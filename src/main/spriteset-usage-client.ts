// Main-process client for the sprite tileset usage worker
// (spriteset-usage.worker.ts). One lazily created, long-lived worker (its stat
// cache persists between calls), unref'd so it never holds the app open. A
// crashed worker rejects what's in flight and is recreated on the next call.

import type { Worker } from 'node:worker_threads'
import createUsageWorker from './spriteset-usage.worker?nodeWorker'
import type { UsageRequest, UsageResponse } from './spriteset-usage.worker'

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (byRow: number[][]) => void; reject: (e: Error) => void }>()

function failAll(error: Error): void {
  for (const p of pending.values()) p.reject(error)
  pending.clear()
  worker = null
}

function getWorker(): Worker {
  if (worker) return worker
  const w = createUsageWorker({})
  w.unref()
  w.on('message', (res: UsageResponse) => {
    const p = pending.get(res.id)
    if (!p) return
    pending.delete(res.id)
    if (res.ok) p.resolve(res.byRow)
    else p.reject(new Error(res.error))
  })
  w.on('error', (e) => failAll(e instanceof Error ? e : new Error(String(e))))
  w.on('exit', (code) => {
    if (worker === w) failAll(new Error(`spriteset usage worker exited (${code})`))
  })
  worker = w
  return w
}

/** `byRow[row]` = record ids whose saved header selects `row` (removed levels
 *  excluded). Runs off the main thread. */
export function spritesetUsageAsync(
  workRoot: string,
  overlayRoot: string | undefined,
  removed: readonly number[]
): Promise<number[][]> {
  const w = getWorker()
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    const req: UsageRequest = { id, workRoot, overlayRoot, removed: [...removed] }
    w.postMessage(req)
  })
}
