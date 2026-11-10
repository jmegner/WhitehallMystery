import { expect, test, vi } from 'vitest'
import { chooseJackMove, type JackPlan } from './aiJack'
import { alleyDestinations, boatDestinations, circles, jackTransitions } from './mapData'
import { createInitialGame, legalJackDestinations } from './gameEngine'
import type { GameState } from './types'
import * as scoring from './aiJackScoring'

// Independent forward search, spending each available shortcut once per use.
// Future investigator positions are unknown. Coach uses two slots for two
// Street edges, so it cannot shorten these optimistic arrival times.
function canFinish(from: number, goal: number, slots: number, alley: number, boat: number) {
  const queue = [{ id: from, slots, alley, boat }]
  const seen = new Set<string>()
  for (let index = 0; index < queue.length; index++) {
    const visit = queue[index]!
    if (visit.slots <= 0) continue
    const key = `${visit.id}:${visit.slots}:${visit.alley}:${visit.boat}`
    if (seen.has(key)) continue
    seen.add(key)
    for (const id of jackTransitions.get(visit.id)!.keys()) {
      if (id === goal) return true
      queue.push({ ...visit, id, slots: visit.slots - 1 })
    }
    for (const type of ['alley', 'boat'] as const) {
      if (!visit[type]) continue
      const destinations = type === 'alley' ? alleyDestinations : boatDestinations
      for (const id of destinations.get(visit.id)!) {
        if (id !== goal) queue.push({ ...visit, id, slots: visit.slots - 1, [type]: visit[type] - 1 })
      }
    }
  }
  return false
}

function legalPlans(state: GameState) {
  const plans: Pick<JackPlan, 'type' | 'path'>[] = []
  for (const type of ['normal', 'alley', 'boat', 'coach'] as const) {
    const planning = { ...state, jackMoveSelection: { type, path: [] } }
    for (const first of legalJackDestinations(planning)) {
      if (type !== 'coach') plans.push({ type, path: [first] })
      else for (const second of legalJackDestinations({ ...planning, jackMoveSelection: { type, path: [first] } })) {
        plans.push({ type, path: [first, second] })
      }
    }
  }
  return plans
}

const scenarios = [
  { goal: 71, slots: 1, alley: 0, boat: 0 },
  { goal: 71, slots: 2, alley: 1, boat: 0 },
  { goal: 130, slots: 2, alley: 0, boat: 1 },
  { goal: 71, slots: 3, alley: 2, boat: 0 },
  { goal: 130, slots: 4, alley: 1, boat: 1 },
  { goal: 71, slots: 5, alley: 2, boat: 2 },
]

test.each(scenarios)('keeps a finish possible with $slots slots to $goal, Alley=$alley Boat=$boat', ({ goal, slots, alley, boat }) => {
  let checked = 0
  const cache = new Map<string, boolean>()
  for (const { id: currentJack } of circles) {
    if (currentJack === goal) continue
    const state: GameState = { ...createInitialGame(), stage: 'jackMove', currentJack,
      moveSlot: 15 - slots, discoveryLocations: [33, goal], reachedDiscoveries: [33],
      roundTrail: [currentJack], investigatorPositions: { yellow: 'FP', blue: 'HP', red: 'HZ' },
      specialRemaining: { coach: 2, alley, boat } }
    const viable = (plan: Pick<JackPlan, 'type' | 'path'>) => {
      const destination = plan.path.at(-1)!
      if (plan.type === 'normal' && destination === goal) return true
      const remaining = slots - (plan.type === 'coach' ? 2 : 1)
      const nextAlley = alley - Number(plan.type === 'alley')
      const nextBoat = boat - Number(plan.type === 'boat')
      const key = `${destination}:${remaining}:${nextAlley}:${nextBoat}`
      if (!cache.has(key)) cache.set(key, canFinish(destination, goal, remaining, nextAlley, nextBoat))
      return cache.get(key)!
    }
    const plans = legalPlans(state)
    if (!plans.some(viable) || plans.every(viable)) continue
    for (const random of [() => 0, () => 0.999]) {
      const plan = chooseJackMove(state, random)!
      expect(plan, `No legal plan from ${currentJack}`).not.toBeNull()
      expect(viable(plan), `From ${currentJack}: ${plan.type} to ${plan.path.join('→')} loses the deadline`).toBe(true)
    }
    checked++
  }
  expect(checked).toBeGreaterThan(0)
})

test('an already lost deadline still produces a legal move rather than stalling the AI', () => {
  const state: GameState = { ...createInitialGame(), stage: 'jackMove', currentJack: 33, moveSlot: 14,
    discoveryLocations: [33, 159], reachedDiscoveries: [33],
    specialRemaining: { coach: 0, alley: 0, boat: 0 } }
  const plan = chooseJackMove(state, () => 0)!
  expect(legalPlans(state)).toContainEqual({ type: plan.type, path: plan.path })
})

test('the deadline remains mandatory even when scoring heavily favors a doomed special move', () => {
  const state: GameState = { ...createInitialGame(), stage: 'jackMove', currentJack: 33, moveSlot: 14,
    discoveryLocations: [33, 13], reachedDiscoveries: [33],
    specialRemaining: { coach: 0, alley: 1, boat: 0 } }
  expect(legalPlans(state).some(plan => plan.type === 'alley')).toBe(true)
  // Exaggerate the preference for special moves: heuristics may evolve,
  // but none of them should be able to buy their way around a hard deadline.
  const specialCost = vi.spyOn(scoring, 'jackSpecialCost').mockImplementation(type => type === 'normal' ? 10000 : 0)
  try {
    expect(chooseJackMove(state, () => 0)).toMatchObject({ type: 'normal', path: [13] })
  } finally {
    specialCost.mockRestore()
  }
})
