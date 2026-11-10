import { describe, expect, test } from 'vitest'
import { availableDiscoveryLevels, chooseDiscoveryCompletion, discoveryDifficulty, DISCOVERY_LEVELS,
  EASY_DISCOVERY_LIMIT, MEDIUM_DISCOVERY_MIN, MEDIUM_DISCOVERY_MAX, HARD_DISCOVERY_MIN, type DiscoveryLevel } from './aiDiscoveries'
import { circlesById } from './mapData'

function expectLevel(ids: number[], level: DiscoveryLevel) {
  const difficulty = discoveryDifficulty(ids)
  expect(Number.isFinite(difficulty)).toBe(true)
  if (level === 'Easy') expect(difficulty).toBeLessThanOrEqual(EASY_DISCOVERY_LIMIT)
  if (level === 'Med') {
    expect(difficulty).toBeGreaterThanOrEqual(MEDIUM_DISCOVERY_MIN)
    expect(difficulty).toBeLessThanOrEqual(MEDIUM_DISCOVERY_MAX)
  }
  if (level === 'Hard') expect(difficulty).toBeGreaterThanOrEqual(HARD_DISCOVERY_MIN)
}

describe('rated discovery completions', () => {
  test('uses the original randomizer thresholds, including gaps', () => {
    expect([EASY_DISCOVERY_LIMIT, MEDIUM_DISCOVERY_MIN, MEDIUM_DISCOVERY_MAX, HARD_DISCOVERY_MIN])
      .toEqual([4.212505796, 5.560504654, 7.136783123, 8.136795311])
  })

  for (const level of DISCOVERY_LEVELS) {
    test(`fills only missing quadrants with varying ${level} sets`, () => {
      let seed = 29
      const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
      const sets = new Set<string>()
      for (const selected of [[], [33], [43, 33]]) for (let attempt = 0; attempt < 20; attempt++) {
        const ids = chooseDiscoveryCompletion(level, selected, random)!
        expect(ids).toHaveLength(4)
        expect(ids).toEqual(expect.arrayContaining(selected))
        expect(new Set(ids.map(id => circlesById.get(id)!.quadrant)).size).toBe(4)
        expect(ids.every(id => circlesById.get(id)!.color === 'white')).toBe(true)
        expectLevel(ids, level)
        sets.add(ids.join(','))
      }
      expect(sets.size).toBeGreaterThan(40)
      expectLevel(chooseDiscoveryCompletion(level, [33], () => 0)!, level)
    })
  }

  test('offers only feasible difficulties when three locations are fixed', () => {
    expect([...availableDiscoveryLevels([33, 43, 130])].sort()).toEqual(['Easy', 'Med'])
    expect(chooseDiscoveryCompletion('Hard', [33, 43, 130])).toBeNull()
    expect([...availableDiscoveryLevels([1, 7, 188])]).toEqual(['Hard'])
    for (const level of ['Easy', 'Med'] as const) expect(chooseDiscoveryCompletion(level, [1, 7, 188])).toBeNull()
    expectLevel(chooseDiscoveryCompletion('Hard', [1, 7, 188])!, 'Hard')
  })

  test('leaves complete or invalid selections alone', () => {
    for (const selected of [[33, 43, 130, 139], [33, 34], [33, 33], [999]]) {
      expect(availableDiscoveryLevels(selected).size).toBe(0)
      for (const level of DISCOVERY_LEVELS) expect(chooseDiscoveryCompletion(level, selected)).toBeNull()
    }
  })
})
