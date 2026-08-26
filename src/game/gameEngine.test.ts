import { describe, expect, test } from 'vitest'
import {
  createInitialGame,
  gameReducer,
  legalInspectorActionCircles,
  legalInvestigatorDestinations,
  legalJackDestinations,
  legalNormalDestinations,
  coachReachableJackDestinations,
  randomProgressActions,
} from './gameEngine'
import { possibleJackLocations, possibleJackSearchOutcomes } from './inference'
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
  INVESTIGATOR_AUTO_STORAGE_KEY,
  JACK_PEEK_STORAGE_KEY,
  POSSIBLE_LOCATIONS_STORAGE_KEY,
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

  test('round-trips a complete game snapshot and display preferences', () => {
    const storage = createMemoryStorage()
    const state = setupGame()
    saveStoredGame(storage, state)
    saveBooleanPreference(storage, CROSSING_IDS_STORAGE_KEY, true)
    saveBooleanPreference(storage, POSSIBLE_LOCATIONS_STORAGE_KEY, true)
    saveBooleanPreference(storage, JACK_PEEK_STORAGE_KEY, true)
    saveBooleanPreference(storage, INVESTIGATOR_AUTO_STORAGE_KEY, true)
    expect(loadStoredGame(storage)).toEqual(state)
    expect(loadBooleanPreference(storage, CROSSING_IDS_STORAGE_KEY)).toBe(true)
    expect(loadBooleanPreference(storage, POSSIBLE_LOCATIONS_STORAGE_KEY)).toBe(true)
    expect(loadBooleanPreference(storage, JACK_PEEK_STORAGE_KEY)).toBe(true)
    expect(loadBooleanPreference(storage, INVESTIGATOR_AUTO_STORAGE_KEY)).toBe(true)
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
  test('random progress selects a Jack route but leaves it ready for private review', () => {
    const state = setupGame()
    const actions = randomProgressActions(state, () => 0)
    expect(actions).toHaveLength(1)
    expect(actions[0]?.type).toBe('selectJackDestination')
    expect(actions.some((action) => action.type === 'confirmJackMove')).toBe(false)

    const selected = apply(state, ...actions)
    expect(selected.stage).toBe('jackMove')
    expect(selected.jackMoveSelection.type).toBe('normal')
    expect(selected.jackMoveSelection.path).toHaveLength(1)
    expect(randomProgressActions(selected, () => 0)).toEqual([{ type: 'confirmJackMove' }])
  })

  test('random progress uses the requested investigator action probabilities', () => {
    const base = setupGame()
    const state: GameState = { ...base, stage: 'investigatorAction', inspectorActionMode: 'search' }
    const adjacent = legalInspectorActionCircles(state)
    expect(adjacent.length).toBeGreaterThan(0)
    expect(randomProgressActions(state, () => 0.29).map((action) => action.type)).toEqual([
      'setInspectorActionMode',
      'arrestCircle',
    ])
    expect(randomProgressActions(state, () => 0.3).at(-1)?.type).toBe('searchCircle')
    expect(randomProgressActions(state, () => 0.89).at(-1)?.type).toBe('searchCircle')
    expect(randomProgressActions(state, () => 0.9)).toEqual([{ type: 'passInspectorAction' }])
  })

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
    expect(state.stage).toBe('investigatorTurnResult')
    state = gameReducer(state, { type: 'continueHandoff' })
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

  test('shows Coach destinations that an ordinary street move cannot reach', () => {
    const normal = setupGame()
    const normalDestinations = new Set(legalJackDestinations(normal))
    let coach = gameReducer(normal, { type: 'setJackMoveType', moveType: 'coach' })
    const expected = new Set<number>()
    for (const first of legalJackDestinations(coach)) {
      const afterFirst = gameReducer(coach, { type: 'selectJackDestination', circleId: first })
      for (const destination of legalJackDestinations(afterFirst)) {
        if (!normalDestinations.has(destination) && destination !== normal.currentJack) expected.add(destination)
      }
    }
    const coachReachable = coachReachableJackDestinations(normal)
    expect(coachReachable).toEqual([...expected].sort((a, b) => a - b))
    expect(coachReachable.length).toBeGreaterThan(0)
    expect(coachReachable.every((id) => !normalDestinations.has(id))).toBe(true)
    expect(coachReachableJackDestinations(coach)).toEqual(coachReachable)

    coach = gameReducer(coach, {
      type: 'selectJackDestination',
      circleId: legalJackDestinations(coach)[0] as number,
    })
    expect(coachReachableJackDestinations(coach)).toEqual([])

    expect(
      coachReachableJackDestinations({ ...normal, jackMoveSelection: { type: 'alley', path: [] } }),
    ).toEqual([])
    expect(
      coachReachableJackDestinations({ ...normal, jackMoveSelection: { type: 'boat', path: [] } }),
    ).toEqual([])
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

  test('allows an Investigator to end a clue search after the first query but not switch to arrest', () => {
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
    expect(state.activeInvestigator).toBe(activeBefore + 1)
    expect(state.publicLog.at(-1)).toContain('ended the clue search')
  })

  test('defaults each Investigator to searching during the action phase', () => {
    const base = setupGame()
    let state: GameState = {
      ...base,
      stage: 'investigatorMove',
      activeInvestigator: 2,
      inspectorActionMode: 'choose',
    }
    const destination = legalInvestigatorDestinations(state)[0] as string

    state = gameReducer(state, { type: 'moveInvestigator', crossingId: destination })
    expect(state.stage).toBe('investigatorAction')
    expect(state.inspectorActionMode).toBe('search')

    state = gameReducer(state, { type: 'passInspectorAction' })
    expect(state.activeInvestigator).toBe(1)
    expect(state.inspectorActionMode).toBe('search')
  })

  test('keeps the red Investigator’s final arrest result visible until the map is acknowledged', () => {
    const base = setupGame()
    const resultState: GameState = {
      ...base,
      stage: 'investigatorAction',
      activeInvestigator: 2,
      inspectorActionMode: 'arrest',
      currentJack: 33,
    }
    const miss = legalInspectorActionCircles(resultState).find((id) => id !== resultState.currentJack) as number
    let state = gameReducer(resultState, { type: 'arrestCircle', circleId: miss })

    expect(state.stage).toBe('investigatorTurnResult')
    expect(state.activeInvestigator).toBe(2)
    expect(state.notice).toBe(`No arrest at ${miss}.`)

    state = gameReducer(state, { type: 'continueHandoff' })
    expect(state.stage).toBe('handoffJackTurn')
    expect(state.activeInvestigator).toBe(0)
  })

  test('keeps the red Investigator’s final clue result on the board until the map is acknowledged', () => {
    const base = setupGame()
    const resultState: GameState = {
      ...base,
      stage: 'investigatorAction',
      activeInvestigator: 2,
      inspectorActionMode: 'search',
    }
    const target = legalInspectorActionCircles(resultState).find(
      (id) => !resultState.discoveryLocations.includes(id),
    ) as number
    let state = gameReducer(
      { ...resultState, currentJack: target, roundTrail: [33, target] },
      { type: 'searchCircle', circleId: target },
    )

    expect(state.stage).toBe('investigatorTurnResult')
    expect(state.clueLocations).toContain(target)
    expect(state.notice).toBe(`A clue was found at ${target}.`)

    state = gameReducer(state, { type: 'continueHandoff' })
    expect(state.stage).toBe('handoffJackTurn')
  })

  test('reveals a reached Discovery Location only after all Investigator actions', () => {
    const base = setupGame()
    let state = gameReducer(
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
    expect(state.stage).toBe('investigatorTurnResult')
    expect(state.reachedDiscoveries).toEqual([33])

    state = gameReducer(state, { type: 'continueHandoff' })
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
  test('calculates remaining current locations after hypothetical positive and negative searches', () => {
    const evidence: PublicRoundEvidence = {
      start: 33,
      moves: [
        {
          type: 'normal',
          startSlot: 1,
          endSlot: 1,
          investigatorPositions: { yellow: 'FP', blue: 'HP', red: 'HZ' },
        },
      ],
      observations: [],
    }
    const current = possibleJackLocations(evidence)
    const outcomes = possibleJackSearchOutcomes(evidence)
    const destination = [...current][0] as number

    expect(outcomes.get(33)?.ifNo).toEqual(new Set())
    expect(outcomes.get(33)?.ifYes).toEqual(current)
    expect(outcomes.get(33)?.positiveMeansJackIsThereNow).toBe(false)
    expect(outcomes.get(destination)?.ifYes).toEqual(new Set([destination]))
    expect(outcomes.get(destination)?.ifNo).toEqual(new Set([...current].filter((id) => id !== destination)))
    expect(outcomes.get(destination)?.positiveMeansJackIsThereNow).toBe(true)
    expect(new Set(outcomes.keys())).toEqual(new Set([33, ...current]))
  })

  test('preserves current locations compatible with either hypothetical clue result', () => {
    const move = {
      type: 'normal' as const,
      startSlot: 1,
      endSlot: 1,
      investigatorPositions: { yellow: 'FP', blue: 'HP', red: 'HZ' } as const,
    }
    const evidence: PublicRoundEvidence = {
      start: 33,
      moves: [move, { ...move, startSlot: 2, endSlot: 2 }],
      observations: [],
    }
    const outcome = possibleJackSearchOutcomes(evidence).get(13)

    expect(outcome?.ifNo.size).toBe(40)
    expect(outcome?.ifYes.size).toBe(12)
    expect(outcome?.ifNo).toContain(10)
    expect(outcome?.ifYes).toContain(10)
  })

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
