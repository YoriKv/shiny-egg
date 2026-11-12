import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import type { LevelData } from '../../../preload/api'
import { roomGraph, type WarpEdge } from '../lib/warp-graph'
import { ExitsBody } from './ExitsPanel'

test('the exit map renders external incoming sources and live landing coordinates', () => {
  const edges: WarpEdge[] = [0, 1, 20].map((id) => ({
    sourceLevelRecordId: id, sourceScreenIndex: 0, destLevelRecordId: 9,
    destX: 1, destY: 1, entranceType: 0
  }))
  const graph = roomGraph(0, 9, edges)
  const incoming = graph.incomingByLevel.get(9)!.map((i) =>
    i.sourceLevelRecordId === 20 ? { ...i, destX: 32, destY: 16 } : i)
  const html = renderToStaticMarkup(createElement(ExitsBody, {
    level: { recordId: 9, empty: false, special: false, exits: [] } as unknown as LevelData,
    selection: [], subLevels: graph.subLevels, edges: graph.edges, incoming,
    loading: false, onSelectExit: () => {}, onSelectIncoming: () => {}, onJump: () => {}
  }))
  expect(html).toContain('Room 0x14') // external one-way source has a clickable stub
  expect(html).toContain('Room 0x01') // another stage's source is also visible
  expect(html).toContain('Screen 0x12 — a warp lands here: Room 0x14 screen 0x00')
  expect(html).toContain('Screen 0x00 — 2 warps land here:')
})
