import { describe, expect, test } from 'vitest'
import { boardZoomFrame, boardZoomRegion, ZOOM_GUTTERS } from './boardZoom'
import { createInitialGame } from './game/gameEngine'
import { adjacentCirclesForCrossing, circlesById, startingCrossings } from './game/mapData'
import type { GameState } from './game/types'

const state = (): GameState => ({ ...createInitialGame(), stage: 'jackMove', currentJack: 85,
  discoveryLocations: [33, 46, 147, 159], reachedDiscoveries: [33],
  investigatorPositions: { yellow: 'BS', blue: 'HP', red: 'HZ' } })

describe('phase-specific map zoom regions', () => {
  test('discovery planning narrows to unfilled quadrants and then frames the completed choices', () => {
    const setup = createInitialGame()
    const all = boardZoomRegion(setup)!
    expect(all.locations.length).toBeGreaterThan(100)
    expect(all.locations.every(id => circlesById.get(id)?.color === 'white')).toBe(true)
    const chosen = [46, 147, 159]
    const last = boardZoomRegion({ ...setup, discoveryLocations: chosen })!
    expect(last.locations.length).toBeLessThan(all.locations.length / 2)
    expect(last.locations.every(id => circlesById.get(id)?.quadrant === 'NW')).toBe(true)
    expect(last.locations).toContain(33)
    expect(boardZoomRegion({ ...setup, discoveryLocations: [33, ...chosen] })?.locations).toEqual([33, ...chosen])
  })

  test('Jack starting selection and investigator deployment frame only their valid choices', () => {
    expect(boardZoomRegion({ ...state(), stage: 'jackChooseStart' })?.locations).toEqual([33, 46, 147, 159])
    const region = boardZoomRegion({ ...state(), stage: 'investigatorSetup', investigatorPositions: { yellow: 'HP' }, activeInvestigator: 1 })!
    expect(region.crossings).toEqual(startingCrossings.map(node => node.id).filter(id => id !== 'HP'))
    expect(region.locations).toEqual([])
    expect(region.center).toBeUndefined()
  })

  test('Jack framing includes special-move reach and is independent of his current draft', () => {
    const base = state()
    const full = boardZoomRegion(base)!
    const streets = boardZoomRegion({ ...base, specialRemaining: { coach: 0, alley: 0, boat: 0 } })!
    expect(full.locations).toContain(85)
    expect(full.locations.length).toBeGreaterThan(streets.locations.length)
    expect(full.locations).not.toContain(46)
    expect(full.locations).not.toContain(147)
    expect(full.locations).not.toContain(159)
    expect(boardZoomRegion({ ...base, jackMoveSelection: { type: 'coach', path: [72] } })).toEqual(full)
    expect(full.center).toMatchObject({ x: circlesById.get(85)!.x, y: circlesById.get(85)!.y })
  })

  test('includes Coach first and second stops, Alley destinations and distant Boat destinations only when available', () => {
    const base = state()
    expect(boardZoomRegion(base)?.locations).toEqual(expect.arrayContaining([71, 52, 121]))
    expect(boardZoomRegion({ ...base, specialRemaining: { ...base.specialRemaining, coach: 0 } })?.locations).not.toContain(52)
    expect(boardZoomRegion({ ...base, specialRemaining: { ...base.specialRemaining, alley: 0 } })?.locations).not.toContain(121)
    const water = { ...base, currentJack: 110 }
    expect(boardZoomRegion(water)?.locations).toContain(184)
    expect(boardZoomRegion({ ...water, specialRemaining: { ...water.specialRemaining, boat: 0 } })?.locations).not.toContain(184)
  })

  test('investigator movement includes adjacent locations, without depending on Jack’s secrets', () => {
    const base: GameState = { ...state(), stage: 'investigatorMove' }
    const region = boardZoomRegion(base)!
    expect(region.crossings).toContain('BS')
    expect(region.crossings).not.toContain('HP')
    for (const id of region.crossings) for (const location of adjacentCirclesForCrossing(id)) expect(region.locations).toContain(location)
    expect(boardZoomRegion({ ...base, currentJack: null, discoveryLocations: [], reachedDiscoveries: [] })).toEqual(region)
  })

  test('search and arrest include next-turn crossing reach even where earlier investigators may move away', () => {
    const base: GameState = { ...state(), stage: 'investigatorAction', activeInvestigator: 2,
      investigatorPositions: { yellow: 'HK', blue: 'GZ', red: 'HC' } }
    const region = boardZoomRegion(base)!
    expect(region.crossings).toContain('HK')
    expect(region.crossings).toContain('GZ')
    expect(region.locations).toEqual(expect.arrayContaining(adjacentCirclesForCrossing('HK')))
    expect(boardZoomRegion({ ...base, inspectorActionMode: 'arrest' })).toEqual(region)
    expect(boardZoomRegion({ ...base, stage: 'investigatorMove' })?.crossings).not.toContain('GZ')
  })

  test('handoffs, results and finished games do not offer framing', () => {
    for (const stage of ['handoffJackTurn', 'investigatorTurnResult', 'gameOver'] as const) {
      expect(boardZoomRegion({ ...state(), stage })).toBeNull()
    }
  })
})

describe('map zoom framing', () => {
  test('centers an active piece while fitting the complete region, including room for floating controls', () => {
    const bounds = { left: 0, right: 100, top: 0, bottom: 100 }
    const frame = boardZoomFrame(bounds, { width: 390, height: 600 }, { x: 50, y: 50 })
    expect(frame.center).toEqual({ x: 50, y: 50 })
    expect(frame.scale).toBeCloseTo(3.836)
  })

  test('keeps a wide asymmetric region visible when exact centering would crop its far side', () => {
    const bounds = { left: 0, right: 240, top: 0, bottom: 120 }
    const size = { width: 390, height: 600 }
    const frame = boardZoomFrame(bounds, size, { x: 20, y: 30 })
    expect(frame.center.x).toBeCloseTo(120)
    expect((bounds.left - frame.center.x) * frame.scale + size.width / 2).toBeCloseTo(ZOOM_GUTTERS.side)
    expect((bounds.right - frame.center.x) * frame.scale + size.width / 2).toBeCloseTo(size.width - ZOOM_GUTTERS.side)
  })

  test('caps very small regions and uses the actual browser scale for final positioning', () => {
    const bounds = { left: 5, right: 6, top: 5, bottom: 6 }
    expect(boardZoomFrame(bounds, { width: 390, height: 600 }).scale).toBe(5)
    expect(boardZoomFrame(bounds, { width: 390, height: 600 }, undefined, 2).scale).toBe(2)
  })

  test('fits a broad map overview into a short landscape viewport', () => {
    const bounds = { left: 0, right: 800, top: 0, bottom: 800 }
    const size = { width: 844, height: 390 }
    const frame = boardZoomFrame(bounds, size)
    expect(frame.scale).toBeLessThan(1)
    expect((bounds.top - frame.center.y) * frame.scale + size.height / 2).toBeCloseTo(ZOOM_GUTTERS.top)
    expect((bounds.bottom - frame.center.y) * frame.scale + size.height / 2).toBeCloseTo(size.height - Math.min(ZOOM_GUTTERS.bottom, size.height * 0.06))
  })
})
