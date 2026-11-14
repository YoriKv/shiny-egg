import { describe, expect, test } from 'vitest'
import type { ScreenExit } from '../../../preload/api'
import { incomingIdentity, roomGraph, rotatingDoorEdges, withLiveWarpEdges, type WarpEdge } from './warp-graph'

function edge(source: number, dest: number, screen = 0): WarpEdge {
  return { sourceLevelRecordId: source, destLevelRecordId: dest,
    sourceScreenIndex: screen, destX: source + 1, destY: 8, entranceType: 0 }
}

describe('project room graph', () => {
  test('rotating-door sprites add all four table-defined links with distinct identities', () => {
    const destinations = [0xb8, 0xc6, 0xcd, 0xd3].map((id) => ({
      destLevelRecordId: id, destX: 5, destY: 119, entranceType: 0
    }))
    const sprite = { num: 0x1f, index: 2, x: 40, y: 20 }
    const doors = rotatingDoorEdges(0, [sprite], destinations)
    expect(doors).toHaveLength(4)
    expect(new Set(doors.map(incomingIdentity)).size).toBe(4)
    expect(doors.every((e) => e.sourceScreenIndex === 0x12)).toBe(true)
    const graph = roomGraph(0, 0, doors)
    expect(graph.subLevels).toEqual([0, 0xb8, 0xc6, 0xcd, 0xd3])
    expect(graph.incomingByLevel.get(0xb8)?.[0].kind).toBe('rotating-door')
    expect(graph.incomingByLevel.get(0xb8)?.[0].doorIndex).toBe(0)
    expect(withLiveWarpEdges(doors, 0, [], [], destinations)).toEqual([]) // deleting the sprite removes links
    expect(rotatingDoorEdges(0, [{ ...sprite, num: 0x20 }], destinations)).toEqual([])
    const ordinary = { sourceLevelRecordId: 0, sourceScreenIndex: 0x12 }
    expect(doors.map(incomingIdentity)).not.toContain(incomingIdentity(ordinary))
    const live = withLiveWarpEdges([], 0, [], [sprite], destinations)
    expect(roomGraph(0, 0, live).subLevels).toEqual(graph.subLevels) // unsaved placement
  })
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
