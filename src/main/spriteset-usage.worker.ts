// Worker-thread host for the sprite tileset usage sweep (spriteset-usage.ts),
// so its ~220 level decodes/stats never block the main process. Long-lived:
// the per-record stat cache lives here between calls. Bundled by electron-vite
// via the `?nodeWorker` import in spriteset-usage-client.ts.

import { parentPort } from 'node:worker_threads'
import { spritesetUsage } from './spriteset-usage'

export interface UsageRequest {
  id: number
  workRoot: string
  overlayRoot: string | undefined
  removed: number[]
}

export type UsageResponse =
  | { id: number; ok: true; byRow: number[][] }
  | { id: number; ok: false; error: string }

parentPort?.on('message', (req: UsageRequest) => {
  let res: UsageResponse
  try {
    res = { id: req.id, ok: true, byRow: spritesetUsage(req.workRoot, req.overlayRoot, new Set(req.removed)) }
  } catch (e) {
    res = { id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  parentPort?.postMessage(res)
})
