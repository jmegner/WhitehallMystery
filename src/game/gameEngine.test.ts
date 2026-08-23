import { describe, expect, test } from 'vitest'
import {
  createInitialGame,
  gameReducer,
  legalInspectorActionCircles,
  legalJackDestinations,
  legalNormalDestinations,
} from './gameEngine'
import { possibleJackLocations } from './inference'
import {
  alleyDestinations,
  circles,
  circlesById,
  crossings,
  investigatorNeighbors,
  jackTransitions,
  startingCrossings,
  waterGroups,
} from './mapData'
import {
  CROSSING_IDS_STORAGE_KEY,
  GAME_STORAGE_KEY,
  loadBooleanPreference,
  loadStoredGame,
  saveBooleanPreference,
  saveStoredGame,
} from './persistence'
import type { GameAction, GameState, PublicRoundEvidence } from './types'

const apply = (state: GameState, ...actions: GameAction[]) =>
  actions.reduce((current, action) => gameReducer(current, action), state)

const setupGame = () => {
  let state = createInitialGame()
  state = apply(
    state,
    { type: 'toggleDiscovery', circleId: 33 },
    { type: 'toggleDiscovery', circleId: 46 },
    { type: 'toggleDiscovery', circleId: 147 },
    { type: 'toggleDiscovery', circleId: 159 },
    { type: 'confirmDiscoveries' },
    { type: 'continueHandoff' },
  )
  for (const crossing of startingCrossings.slice(0, 3)) {
    state = gameReducer(state, { type: 'placeInvestigator', crossingId: crossing.id })
  }
  state = apply(state, { type: 'continueHandoff' }, { type: 'chooseJackStart', circleId: 33 })
  return state
}

describe('Whitehall map data', () => {
  test('loads the complete, validated board', () => {
    expect(circles).toHaveLength(189)
    expect(crossings).toHaveLength(174)
    expect(startingCrossings).toHaveLength(6)
    expect(circles.filter((circle) => circle.color === 'white')).toHaveLength(105)
    expect(circles.filter((circle) => circle.color === 'black')).toHaveLength(64)
    expect(circles.filter((circle) => circle.color === 'blue')).toHaveLength(20)
    expect(waterGroups.flat().every((id) => circlesById.get(id)?.color === 'blue')).toBe(true)
    expect(circlesById.get(33)?.quadrant).toBe('NW')
    expect(circlesById.get(46)?.quadrant).toBe('NE')
    expect(circlesById.get(159)?.quadrant).toBe('SW')
    expect(circlesById.get(147)?.quadrant).toBe('SE')
  })

  test('derives the two movement graphs', () => {
    const jackEdges = [...jackTransitions.values()].reduce((total, destinations) => total + destinations.size, 0) / 2
    const investigatorEdges =
      [...investigatorNeighbors.values()].reduce((total, destinations) => total + destinations.size, 0) / 2
    expect(jackEdges).toBe(673)
    expect(investigatorEdges).toBe(365)
    expect([...jackTransitions.get(101)!.keys()].sort((a, b) => a - b)).toEqual([
      70, 82, 83, 84, 85, 99, 100, 103, 118,
    ])
    expect(jackTransitions.get(101)?.get(84)).toContainEqual(['FF', 'FB'])
    expect(jackTransitions.get(101)?.get(85)).toContainEqual(['FK', 'FG'])
    expect(jackTransitions.get(101)?.get(118)).toContainEqual(['FJ', 'FM'])
    for (const [from, destinations] of jackTransitions) {
      for (const [to, paths] of destinations) {
        for (const path of paths) expect(jackTransitions.get(to)?.get(from)).toContainEqual([...path].reverse())
      }
    }
  })
})

describe('local persistence', () => {
  const createMemoryStorage = () => {
    const values = new Map<string, string>()
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
  }

  test('round-trips a complete game snapshot and crossing-label preference', () => {
    const storage = createMemoryStorage()
    const state = setupGame()
    saveStoredGame(storage, state)
    saveBooleanPreference(storage, CROSSING_IDS_STORAGE_KEY, true)
    expect(loadStoredGame(storage)).toEqual(state)
    expect(loadBooleanPreference(storage, CROSSING_IDS_STORAGE_KEY)).toBe(true)
  })

  test('rejects corrupt or outdated game snapshots', () => {
    const storage = createMemoryStorage()
    storage.setItem(GAME_STORAGE_KEY, '{not-json')
    expect(loadStoredGame(storage)).toBeNull()
    storage.setItem(GAME_STORAGE_KEY, JSON.stringify({ version: 99, state: setupGame() }))
    expect(loadStoredGame(storage)).toBeNull()
  })
})

describe('game reducer', () => {
  test('enforces private setup and completes a normal hot-seat turn', () => {
    let state = setupGame()
    expect(state.stage).toBe('jackMove')
    expect(state.reachedDiscoveries).toEqual([33])
    const publicPossibilities = legalNormalDestinations(state)
    expect(publicPossibilities.length).toBeGreaterThan(0)

    state = apply(
      state,
      { type: 'selectJackDestination', circleId: publicPossibilities[0] as number },
      { type: 'confirmJackMove' },
    )
    expect(state.stage).toBe('handoffInspectorsTurn')
    expect(state.moveSlot).toBe(1)
    expect(possibleJackLocations(state.publicRound)).toEqual(new Set(publicPossibilities))

    state = gameReducer(state, { type: 'continueHandoff' })
    for (const color of ['yellow', 'blue', 'red'] as const) {
      state = gameReducer(state, {
        type: 'moveInvestigator',
        crossingId: state.investigatorPositions[color] as string,
      })
    }
    expect(state.stage).toBe('investigatorAction')
    state = apply(
      state,
      { type: 'passInspectorAction' },
      { type: 'passInspectorAction' },
      { type: 'passInspectorAction' },
    )
    expect(state.stage).toBe('handoffJackTurn')
  })

  test('Coach consumes two slots, ignores crossings, and records its intermediate location', () => {
    let state = setupGame()
    state = gameReducer(state, { type: 'setJackMoveType', moveType: 'coach' })
    const first = legalJackDestinations(state)[0] as number
    state = gameReducer(state, { type: 'selectJackDestination', circleId: first })
    const second = legalJackDestinations(state)[0] as number
    state = apply(state, { type: 'selectJackDestination', circleId: second }, { type: 'confirmJackMove' })
    expect(state.moveSlot).toBe(2)
    expect(state.roundTrail).toEqual([33, first, second])
    expect(state.specialRemaining.coach).toBe(1)
    expect(state.publicRound?.moves[0]?.type).toBe('coach')
  })

  test('blocks an ordinary route through an occupied crossing', () => {
    const base = setupGame()
    const transition = [...(jackTransitions.get(33)?.entries() ?? [])].find(([, paths]) => paths.length === 1)
    expect(transition).toBeDefined()
    const [destination, paths] = transition as [number, string[][]]
    const blockedCrossing = paths[0]?.[0] as string
    const otherCrossings = crossings.map((crossing) => crossing.id).filter((id) => id !== blockedCrossing)
    const blocked: GameState = {
      ...base,
      investigatorPositions: {
        yellow: blockedCrossing,
        blue: otherCrossings[0] as string,
        red: otherCrossings[1] as string,
      },
    }
    expect(legalNormalDestinations(blocked)).not.toContain(destination)
  })

  test('Coach traverses consecutive crossings before reaching each numbered circle', () => {
    const state: GameState = {
      ...setupGame(),
      currentJack: 100,
      roundTrail: [100],
      jackMoveSelection: { type: 'coach', path: [101] },
    }
    expect(legalJackDestinations(state)).toEqual([70, 82, 83, 84, 85, 99, 103, 118])
  })

  test('supports Alley and Boat destinations while excluding unreached discoveries', () => {
    const base = setupGame()
    const alleyStart = [...alleyDestinations.entries()].find(([, destinations]) => destinations.size > 0)?.[0]
    expect(alleyStart).toBeDefined()
    let alleyState: GameState = {
      ...base,
      currentJack: alleyStart as number,
      reachedDiscoveries: [33],
      jackMoveSelection: { type: 'alley', path: [] },
    }
    const destination = legalJackDestinations(alleyState)[0] as number
    expect(destination).toBeDefined()
    alleyState = { ...alleyState, discoveryLocations: [33, 46, 147, destination] }
    expect(legalJackDestinations(alleyState)).not.toContain(destination)

    const boatStart = waterGroups.find((group) => group.length > 1)?.[0] as number
    const boatState: GameState = {
      ...base,
      currentJack: boatStart,
      jackMoveSelection: { type: 'boat', path: [] },
    }
    expect(legalJackDestinations(boatState).length).toBeGreaterThan(0)
  })

  test('finds clues on the entire trail and resolves an arrest', () => {
    const base = setupGame()
    const yellowCrossing = base.investigatorPositions.yellow as string
    const adjacent = legalInspectorActionCircles({ ...base, stage: 'investigatorAction' })
    const target = adjacent[0] as number
    let state: GameState = {
      ...base,
      stage: 'investigatorAction',
      moveSlot: 4,
      currentJack: target,
      roundTrail: [33, target],
      activeInvestigator: 0,
      investigatorPositions: { ...base.investigatorPositions, yellow: yellowCrossing },
      inspectorActionMode: 'choose',
    }
    state = apply(
      state,
      { type: 'setInspectorActionMode', mode: 'search' },
      { type: 'searchCircle', circleId: target },
    )
    expect(state.clueLocations).toContain(target)
    expect(state.activeInvestigator).toBe(1)
    expect(state.publicLog.at(-1)).toBe(`M4: yellow searched ${target}: clue found.`)

    state = {
      ...state,
      stage: 'investigatorAction',
      activeInvestigator: 0,
      inspectorActionMode: 'choose',
      currentJack: target,
    }
    state = apply(
      state,
      { type: 'setInspectorActionMode', mode: 'arrest' },
      { type: 'arrestCircle', circleId: target },
    )
    expect(state.result?.winner).toBe('investigators')
  })

  test('does not allow an Investigator to abandon a clue search after the first query', () => {
    const base = setupGame()
    const adjacent = legalInspectorActionCircles({ ...base, stage: 'investigatorAction' })
    const miss = adjacent.find((id) => !base.roundTrail.includes(id)) as number
    let state: GameState = {
      ...base,
      stage: 'investigatorAction',
      activeInvestigator: 0,
      inspectorActionMode: 'search',
      checkedThisAction: [],
    }
    state = gameReducer(state, { type: 'searchCircle', circleId: miss })
    expect(state.checkedThisAction).toContain(miss)
    const activeBefore = state.activeInvestigator
    state = gameReducer(state, { type: 'setInspectorActionMode', mode: 'arrest' })
    expect(state.inspectorActionMode).toBe('search')
    state = gameReducer(state, { type: 'passInspectorAction' })
    expect(state.activeInvestigator).toBe(activeBefore)
  })

  test('reveals a reached Discovery Location only after all Investigator actions', () => {
    const base = setupGame()
    const state = gameReducer(
      {
        ...base,
        stage: 'investigatorAction',
        activeInvestigator: 2,
        currentJack: 46,
        roundTrail: [33, 46],
        clueLocations: [33],
      },
      { type: 'passInspectorAction' },
    )
    expect(state.stage).toBe('handoffJackTurn')
    expect(state.round).toBe(2)
    expect(state.moveSlot).toBe(0)
    expect(state.reachedDiscoveries).toEqual([33, 46])
    expect(state.clueLocations).toEqual([])
    expect(state.publicRound?.start).toBe(46)
  })

  test('ends the round at move fifteen when no Discovery Location is reached', () => {
    let state: GameState = { ...setupGame(), moveSlot: 14 }
    const destination = legalNormalDestinations(state).find((id) => !state.discoveryLocations.includes(id)) as number
    state = apply(
      state,
      { type: 'selectJackDestination', circleId: destination },
      { type: 'confirmJackMove' },
    )
    expect(state.stage).toBe('gameOver')
    expect(state.result?.winner).toBe('investigators')
  })
})

describe('public inference', () => {
  test('uses Coach intermediate clues, negative clues, and failed arrests', () => {
    const start = 33
    const first = [...(jackTransitions.get(start)?.keys() ?? [])].find(
      (id) => circlesById.get(id)?.color !== 'blue',
    ) as number
    const second = [...(jackTransitions.get(first)?.keys() ?? [])].find(
      (id) => id !== start && circlesById.get(id)?.color !== 'blue',
    ) as number
    const move = {
      type: 'coach' as const,
      startSlot: 1,
      endSlot: 2,
      investigatorPositions: { yellow: 'FP', blue: 'HP', red: 'HZ' },
    }
    const positive: PublicRoundEvidence = {
      start,
      moves: [move],
      observations: [{ kind: 'clue', circleId: first, found: true, afterMove: 1, investigator: 'yellow' }],
    }
    expect(possibleJackLocations(positive)).toContain(second)

    const negative: PublicRoundEvidence = {
      ...positive,
      observations: [{ kind: 'clue', circleId: second, found: false, afterMove: 1, investigator: 'yellow' }],
    }
    expect(possibleJackLocations(negative)).not.toContain(second)

    const arrest: PublicRoundEvidence = {
      ...positive,
      observations: [{ kind: 'arrest', circleId: second, hit: false, afterMove: 1, investigator: 'yellow' }],
    }
    expect(possibleJackLocations(arrest)).not.toContain(second)
  })
})
