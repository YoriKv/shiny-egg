// Live canvas zoom, published by Canvas on every view change and read by the
// toolbar ZoomMenu. A module-level subscribable (the data/levels.ts store
// pattern) rather than App state, so wheel-zoom re-renders only the small
// ZoomMenu — App deliberately mirrors the camera through a ref (cameraRef)
// to stay out of the per-tick render path, and this must not undo that.

import { useSyncExternalStore } from 'react'

let zoom = 1
const listeners = new Set<() => void>()

/** Publish the current canvas zoom factor (Canvas's view-mirror effect). */
export function publishZoom(z: number): void {
  if (z === zoom) return
  zoom = z
  for (const cb of listeners) cb()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

const getZoom = (): number => zoom

/** The live canvas zoom factor (1 = 100%). */
export function useCanvasZoom(): number {
  return useSyncExternalStore(subscribe, getZoom, getZoom)
}
