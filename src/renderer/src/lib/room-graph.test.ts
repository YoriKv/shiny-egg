import { describe, expect, test } from 'vitest'
import type { ScreenExit } from '../../../preload/api'
import { roomGraph, withLiveWarpEdges, type WarpEdge } from './warp-graph'

function edge(source: number, dest: number, screen = 0): WarpEdge {
  return { sourceLevelRecordId: source, destLevelRecordId: dest,
    sourceScreenIndex: screen, destX: source + 1, destY: 8, entranceType: 0 }
}

describe('project room graph', () => {
  test('shared rooms expose every entrance regardless of the selected stage', () => {
    const edges = [edge(0, 9), edge(1, 9), edge(9, 10), edge(20, 9), edge(30, 31)]
    const first = roomGraph(0, 9, edges)
    const second = roomGraph(1, 9, edges)
    expect(first.subLevels).toEqual([0, 9, 10])
    expect(second.subLevels).toEqual([1, 9, 10])
    expect(first.incomingByLevel.get(9)).toEqual(second.incomingByLevel.get(9))
    expect(first.incomingByLevel.get(9)?.map((i) => i.sourceLevelRecordId)).toEqual([0, 1, 20])
    expect(first.edges).toContainEqual(edge(20, 9)) // one-way, orphan source
    expect(first.edges).not.toContainEqual(edge(30, 31)) // unrelated network
    expect(first.subLevels).not.toContain(20) // external source stays compact
  })

  test('new and catalogued rooms expand by their actual exits, including cycles', () => {
    const graph = roomGraph(0xdc, 0xdc, [edge(0xdc, 0xdd), edge(0xdd, 1), edge(1, 0xdc)])
    expect(graph.subLevels).toEqual([0xdc, 0xdd, 1])
    expect(graph.edges).toHaveLength(3)
  })

  test('unsaved exit edits replace disk edges for room lists and incoming markers together', () => {
    const saved = [edge(0xdc, 2), edge(1, 0xdc)]
    const exits = [{ variant: 'warp', screenIndex: 3, destLevelRecordId: 4,
      destX: 12, destY: 16, entranceType: 2 }] as ScreenExit[]
    const draft = withLiveWarpEdges(saved, 0xdc, exits)
    const graph = roomGraph(0xdc, 0xdc, draft)
    expect(graph.subLevels).toEqual([0xdc, 4])
    expect(graph.incomingByLevel.has(2)).toBe(false)
    expect(graph.incomingByLevel.get(4)).toEqual([{
      sourceLevelRecordId: 0xdc, sourceScreenIndex: 3, destX: 12, destY: 16, entranceType: 2
    }])
    expect(roomGraph(0xdc, 0xdc, withLiveWarpEdges(saved, 0xdc, [])).subLevels).toEqual([0xdc])
    // Discard/undo returns to the saved network without retaining draft links.
    expect(roomGraph(0xdc, 0xdc, saved).subLevels).toEqual([0xdc, 2])
  })

  test('a disconnected room currently being viewed keeps its entrances and exits visible', () => {
    const graph = roomGraph(0, 9, [edge(1, 9), edge(9, 10)])
    expect(graph.subLevels).toEqual([0, 9, 10])
    expect(graph.incomingByLevel.get(9)).toHaveLength(1)
    expect(graph.edges).toHaveLength(2)
  })
})
