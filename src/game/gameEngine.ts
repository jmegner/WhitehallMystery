import {
  adjacentCirclesForCrossing,
  alleyDestinations,
  boatDestinations,
  circlesById,
  crossingsById,
  jackTransitions,
  reachableCrossings,
  startingCrossings,
} from './mapData'
import {
  INVESTIGATOR_ORDER,
  type GameAction,
  type GameResult,
  type GameState,
  type InvestigatorColor,
  type JackMoveType,
} from './types'

const baseJackSelection = { type: 'normal' as const, path: [] as number[] }
const JACK_MOVE_TYPES: JackMoveType[] = ['normal', 'coach', 'alley', 'boat']

export const createInitialGame = (): GameState => ({
  stage: 'jackDiscoverySetup',
  round: 1,
  moveSlot: 0,
  discoveryLocations: [],
  reachedDiscoveries: [],
  currentJack: null,
  roundTrail: [],
  investigatorPositions: {},
  activeInvestigator: 0,
  jackMoveSelection: baseJackSelection,
  specialRemaining: { coach: 2, alley: 2, boat: 2 },
  publicRound: null,
  clueLocations: [],
  inspectorActionMode: 'choose',
  checkedThisAction: [],
  publicLog: ['Jack must secretly choose four Discovery Locations.'],
  notice: 'Choose one white circle in each board region: NW, NE, SW, and SE.',
  result: null,
})

export const activeInvestigatorColor = (state: GameState): InvestigatorColor =>
  INVESTIGATOR_ORDER[state.activeInvestigator] ?? 'yellow'

const occupiedCrossings = (state: GameState): Set<string> =>
  new Set(Object.values(state.investigatorPositions).filter((value): value is string => Boolean(value)))

const unreachedDiscoveries = (state: GameState): Set<number> =>
  new Set(state.discoveryLocations.filter((id) => !state.reachedDiscoveries.includes(id)))

const isCoachCircle = (circleId: number) => circlesById.get(circleId)?.color !== 'blue'

export const legalNormalDestinations = (state: GameState, from = state.currentJack): number[] => {
  if (from === null) return []
  const occupied = occupiedCrossings(state)
  return [...(jackTransitions.get(from)?.entries() ?? [])]
    .filter(([, paths]) => paths.some((path) => path.every((crossingId) => !occupied.has(crossingId))))
    .map(([destination]) => destination)
    .sort((a, b) => a - b)
}

const legalCoachSecondDestinations = (state: GameState, first: number): number[] => {
  const start = state.currentJack
  if (start === null || !isCoachCircle(first)) return []
  const forbiddenDiscoveries = unreachedDiscoveries(state)
  return [...(jackTransitions.get(first)?.keys() ?? [])]
    .filter(
      (destination) =>
        destination !== start &&
        destination !== first &&
        isCoachCircle(destination) &&
        !forbiddenDiscoveries.has(destination),
    )
    .sort((a, b) => a - b)
}

const legalCoachFirstDestinations = (state: GameState): number[] => {
  const start = state.currentJack
  if (start === null || state.moveSlot > 13 || state.specialRemaining.coach < 1) return []
  const forbiddenDiscoveries = unreachedDiscoveries(state)
  return [...(jackTransitions.get(start)?.keys() ?? [])]
    .filter(
      (destination) =>
        destination !== start && isCoachCircle(destination) && !forbiddenDiscoveries.has(destination),
    )
    .filter((destination) => legalCoachSecondDestinations(state, destination).length > 0)
    .sort((a, b) => a - b)
}

const legalGroupedDestinations = (state: GameState, type: 'alley' | 'boat'): number[] => {
  const start = state.currentJack
  if (start === null || state.specialRemaining[type] < 1) return []
  const grouped = type === 'alley' ? alleyDestinations : boatDestinations
  const forbiddenDiscoveries = unreachedDiscoveries(state)
  return [...(grouped.get(start) ?? [])]
    .filter((destination) => destination !== start && !forbiddenDiscoveries.has(destination))
    .sort((a, b) => a - b)
}

export const legalJackDestinations = (state: GameState): number[] => {
  const { type, path } = state.jackMoveSelection
  if (type === 'normal') return legalNormalDestinations(state)
  if (type === 'alley' || type === 'boat') return legalGroupedDestinations(state, type)
  return path.length === 0 ? legalCoachFirstDestinations(state) : legalCoachSecondDestinations(state, path[0] ?? -1)
}

export const coachReachableJackDestinations = (state: GameState): number[] => {
  if (state.stage !== 'jackMove' || state.currentJack === null) return []
  const { type, path } = state.jackMoveSelection
  if (type === 'alley' || type === 'boat' || (type === 'coach' && path.length > 0)) return []

  const normalDestinations = new Set([state.currentJack, ...legalNormalDestinations(state)])
  const coachDestinations = new Set<number>()
  for (const first of legalCoachFirstDestinations(state)) {
    for (const destination of legalCoachSecondDestinations(state, first)) {
      if (!normalDestinations.has(destination)) coachDestinations.add(destination)
    }
  }
  return [...coachDestinations].sort((a, b) => a - b)
}

export interface JackRoutePreview {
  segments: Array<{ from: number; to: number; crossingPaths: string[][] }>
  turnLabels: Map<number, string>
}

const emptyJackRoutePreview = (): JackRoutePreview => ({ segments: [], turnLabels: new Map() })

export const shortestJackRoutePreview = (state: GameState, target: number): JackRoutePreview => {
  const start = state.currentJack
  if (
    state.stage !== 'jackMove' ||
    start === null ||
    target === start ||
    legalJackDestinations(state).includes(target)
  ) {
    return emptyJackRoutePreview()
  }

  const planningState: GameState = {
    ...state,
    jackMoveSelection: { type: state.jackMoveSelection.type, path: [] },
  }
  const initialRoutes: number[][] = []
  if (planningState.jackMoveSelection.type === 'normal') {
    for (const destination of legalNormalDestinations(planningState)) initialRoutes.push([destination])
  } else if (planningState.jackMoveSelection.type === 'coach') {
    for (const first of legalCoachFirstDestinations(planningState)) {
      for (const second of legalCoachSecondDestinations(planningState, first)) initialRoutes.push([first, second])
    }
  } else {
    for (const destination of legalGroupedDestinations(planningState, planningState.jackMoveSelection.type)) {
      initialRoutes.push([destination])
    }
  }
  if (initialRoutes.length === 0) return emptyJackRoutePreview()

  const distances = new Map<number, number>()
  const predecessors = new Map<number, Set<number>>()
  const queue: number[] = []
  for (const route of initialRoutes) {
    const destination = route[route.length - 1]
    if (destination === undefined || distances.has(destination)) continue
    distances.set(destination, 1)
    queue.push(destination)
  }

  let targetDistance = distances.get(target)
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]
    if (current === undefined) continue
    const distance = distances.get(current)
    if (distance === undefined || (targetDistance !== undefined && distance >= targetDistance)) continue
    for (const destination of legalNormalDestinations(planningState, current)) {
      const nextDistance = distance + 1
      const knownDistance = distances.get(destination)
      if (knownDistance === undefined) {
        distances.set(destination, nextDistance)
        predecessors.set(destination, new Set([current]))
        queue.push(destination)
        if (destination === target) targetDistance = nextDistance
      } else if (knownDistance === nextDistance) {
        const existing = predecessors.get(destination) ?? new Set<number>()
        existing.add(current)
        predecessors.set(destination, existing)
      }
    }
  }
  if (targetDistance === undefined) return emptyJackRoutePreview()

  const neededNodes = new Set([target])
  const segmentKeys = new Set<string>()
  const segments: JackRoutePreview['segments'] = []
  const streetSegment = (from: number, to: number) => ({
    from,
    to,
    crossingPaths: jackTransitions.get(from)?.get(to) ?? [],
  })
  const backtrack = [target]
  for (let index = 0; index < backtrack.length; index += 1) {
    const destination = backtrack[index]
    if (destination === undefined) continue
    for (const predecessor of predecessors.get(destination) ?? []) {
      const key = `${predecessor}:${destination}`
      if (!segmentKeys.has(key)) {
        segmentKeys.add(key)
        segments.push(streetSegment(predecessor, destination))
      }
      if (!neededNodes.has(predecessor)) {
        neededNodes.add(predecessor)
        backtrack.push(predecessor)
      }
    }
  }

  const labelSets = new Map<number, Set<string>>()
  const addLabel = (circleId: number, label: string) => {
    if (circleId === start) return
    const labels = labelSets.get(circleId) ?? new Set<string>()
    labels.add(label)
    labelSets.set(circleId, labels)
  }
  for (const circleId of neededNodes) {
    const distance = distances.get(circleId)
    if (distance !== undefined && distance > 1) addLabel(circleId, String(distance))
  }

  const coach = planningState.jackMoveSelection.type === 'coach'
  for (const route of initialRoutes) {
    const destination = route[route.length - 1]
    if (destination === undefined || !neededNodes.has(destination)) continue
    const first = route[0]
    if (first === undefined) continue
    const usesStreetCrossings = coach || planningState.jackMoveSelection.type === 'normal'
    const initialSegments = coach && route[1] !== undefined
      ? [streetSegment(start, first), streetSegment(first, route[1])]
      : [
          usesStreetCrossings
            ? streetSegment(start, first)
            : { from: start, to: first, crossingPaths: [[]] },
        ]
    for (const segment of initialSegments) {
      const key = `${segment.from}:${segment.to}`
      if (!segmentKeys.has(key)) {
        segmentKeys.add(key)
        segments.push(segment)
      }
    }
    if (coach) {
      addLabel(first, '1a')
      addLabel(destination, '1b')
    } else {
      addLabel(destination, '1')
    }
  }

  return {
    segments,
    turnLabels: new Map(
      [...labelSets].map(([circleId, labels]) => [circleId, [...labels].sort().join(',')]),
    ),
  }
}

export const hasAnyLegalJackMove = (state: GameState): boolean =>
  legalNormalDestinations(state).length > 0 ||
  legalCoachFirstDestinations(state).length > 0 ||
  legalGroupedDestinations(state, 'alley').length > 0 ||
  legalGroupedDestinations(state, 'boat').length > 0

export const legalInvestigatorDestinations = (state: GameState): string[] => {
  const color = activeInvestigatorColor(state)
  const start = state.investigatorPositions[color]
  if (!start) return []
  const occupiedByOthers = new Set(
    INVESTIGATOR_ORDER.filter((other) => other !== color)
      .map((other) => state.investigatorPositions[other])
      .filter((value): value is string => Boolean(value)),
  )
  return [...reachableCrossings(start, 2)]
    .filter((crossingId) => !occupiedByOthers.has(crossingId))
    .sort((a, b) => a.localeCompare(b))
}

export const investigatorPreviewDestinations = (
  state: GameState,
  color: InvestigatorColor,
): Set<string> => {
  const start = state.investigatorPositions[color]
  if (!start) return new Set()
  const colorIndex = INVESTIGATOR_ORDER.indexOf(color)
  const occupiedByInvestigatorsYetToMove = new Set(
    INVESTIGATOR_ORDER.slice(colorIndex + 1)
      .map((other) => state.investigatorPositions[other])
      .filter((value): value is string => Boolean(value)),
  )
  return new Set(
    [...reachableCrossings(start, 2)].filter(
      (crossingId) => !occupiedByInvestigatorsYetToMove.has(crossingId),
    ),
  )
}

export const investigatorSetupPreviewDestinations = (): Set<string> =>
  new Set(startingCrossings.flatMap((crossing) => [...reachableCrossings(crossing.id, 2)]))

export const investigatorStartingCrossingPreviewDestinations = (crossingId: string): Set<string> =>
  startingCrossings.some((crossing) => crossing.id === crossingId)
    ? reachableCrossings(crossingId, 2)
    : new Set<string>()

export const legalInspectorActionCircles = (state: GameState): number[] => {
  const crossingId = state.investigatorPositions[activeInvestigatorColor(state)]
  return crossingId ? adjacentCirclesForCrossing(crossingId) : []
}

const withNotice = (state: GameState, notice: string): GameState => ({ ...state, notice })
const moveLog = (moveSlot: number, message: string) => `M${moveSlot}: ${message}`

const completedInvestigatorPositions = (
  positions: GameState['investigatorPositions'],
): Record<InvestigatorColor, string> | null => {
  const yellow = positions.yellow
  const blue = positions.blue
  const red = positions.red
  return yellow && blue && red ? { yellow, blue, red } : null
}

const endGame = (state: GameState, result: GameResult): GameState => ({
  ...state,
  stage: 'gameOver',
  result,
  notice: result.reason,
  jackMoveSelection: baseJackSelection,
  inspectorActionMode: 'choose',
})

const enterJackTurn = (state: GameState): GameState => {
  const ready = {
    ...state,
    stage: 'jackMove' as const,
    jackMoveSelection: baseJackSelection,
    notice: 'Choose Jack’s movement type and destination.',
  }
  return hasAnyLegalJackMove(ready)
    ? ready
    : endGame(ready, {
        winner: 'investigators',
        reason: 'Jack has no legal movement and is trapped by the Investigators.',
      })
}

const showEndOfTurnResult = (state: GameState): GameState => ({
  ...state,
  stage: 'investigatorTurnResult',
  inspectorActionMode: 'choose',
  checkedThisAction: [],
})

const finalizeEndOfTurn = (state: GameState): GameState => {
  const current = state.currentJack
  if (current !== null && state.discoveryLocations.includes(current) && !state.reachedDiscoveries.includes(current)) {
    const reachedDiscoveries = [...state.reachedDiscoveries, current]
    const publicLog = [...state.publicLog, moveLog(state.moveSlot, `Jack reached Discovery Location ${current}.`)]
    if (reachedDiscoveries.length === 4) {
      return endGame(
        { ...state, reachedDiscoveries, publicLog },
        { winner: 'jack', reason: `Jack reached all four Discovery Locations and escaped at location ${current}.` },
      )
    }

    return {
      ...state,
      stage: 'handoffJackTurn',
      round: state.round + 1,
      moveSlot: 0,
      reachedDiscoveries,
      roundTrail: [current],
      publicRound: { start: current, moves: [], observations: [] },
      clueLocations: [],
      activeInvestigator: 0,
      inspectorActionMode: 'choose',
      checkedThisAction: [],
      publicLog: [...publicLog, moveLog(0, `Round ${state.round + 1} begins from ${current}.`)],
      notice: `Round complete. Pass the device to Jack for round ${state.round + 1}.`,
    }
  }

  return {
    ...state,
    stage: 'handoffJackTurn',
    activeInvestigator: 0,
    inspectorActionMode: 'choose',
    checkedThisAction: [],
    notice: 'The Investigator turn is complete. Pass the device to Jack.',
  }
}

const advanceInspectorAction = (state: GameState): GameState => {
  if (state.activeInvestigator < INVESTIGATOR_ORDER.length - 1) {
    return {
      ...state,
      activeInvestigator: state.activeInvestigator + 1,
      inspectorActionMode: 'search',
      checkedThisAction: [],
      notice: `${INVESTIGATOR_ORDER[state.activeInvestigator + 1]} Investigator: search, arrest, or pass.`,
    }
  }
  return showEndOfTurnResult(state)
}

const moveCost = (type: JackMoveType) => (type === 'coach' ? 2 : 1)

const selectedMoveIsComplete = (state: GameState) =>
  state.jackMoveSelection.type === 'coach'
    ? state.jackMoveSelection.path.length === 2
    : state.jackMoveSelection.path.length === 1

export const gameReducer = (state: GameState, action: GameAction): GameState => {
  if (action.type === 'newGame') return createInitialGame()

  switch (action.type) {
    case 'toggleDiscovery': {
      if (state.stage !== 'jackDiscoverySetup') return state
      const circle = circlesById.get(action.circleId)
      if (!circle || circle.color !== 'white') return withNotice(state, 'Discovery Locations must be white circles.')
      if (state.discoveryLocations.includes(circle.id)) {
        return {
          ...state,
          discoveryLocations: state.discoveryLocations.filter((id) => id !== circle.id),
          notice: `Removed location ${circle.id}.`,
        }
      }
      const withoutQuadrant = state.discoveryLocations.filter(
        (id) => circlesById.get(id)?.quadrant !== circle.quadrant,
      )
      return {
        ...state,
        discoveryLocations: [...withoutQuadrant, circle.id].sort((a, b) => a - b),
        notice: `Selected a secret Discovery Location in the ${circle.quadrant} region.`,
      }
    }
    case 'confirmDiscoveries': {
      if (state.stage !== 'jackDiscoverySetup') return state
      const quadrants = new Set(state.discoveryLocations.map((id) => circlesById.get(id)?.quadrant))
      if (state.discoveryLocations.length !== 4 || quadrants.size !== 4) {
        return withNotice(state, 'Choose exactly one white circle in each of the NW, NE, SW, and SE regions.')
      }
      return {
        ...state,
        stage: 'handoffInspectorsSetup',
        publicLog: ['Jack has locked in four secret Discovery Locations.'],
        notice: 'Pass the device to the Investigator player. Jack’s selections are hidden.',
      }
    }
    case 'continueHandoff': {
      if (state.stage === 'handoffInspectorsSetup') {
        return {
          ...state,
          stage: 'investigatorSetup',
          activeInvestigator: 0,
          notice: 'Place the yellow Investigator on a highlighted starting crossing.',
        }
      }
      if (state.stage === 'handoffJackStart') {
        return {
          ...state,
          stage: 'jackChooseStart',
          notice: 'Choose one of your four Discovery Locations as Jack’s public starting point.',
        }
      }
      if (state.stage === 'investigatorSetupResult') {
        return {
          ...state,
          stage: 'handoffJackStart',
          notice: 'Deployment complete. Pass the device back to Jack.',
        }
      }
      if (state.stage === 'handoffInspectorsTurn') {
        return {
          ...state,
          stage: 'investigatorMove',
          activeInvestigator: 0,
          notice: 'Yellow Investigator: move zero, one, or two crossings.',
        }
      }
      if (state.stage === 'investigatorTurnResult') {
        return finalizeEndOfTurn(state)
      }
      if (state.stage === 'handoffJackTurn') return enterJackTurn(state)
      return state
    }
    case 'placeInvestigator': {
      if (state.stage !== 'investigatorSetup') return state
      const crossing = crossingsById.get(action.crossingId)
      if (!crossing?.starting) return withNotice(state, 'Investigators must deploy on yellow starting crossings.')
      if (occupiedCrossings(state).has(crossing.id)) return withNotice(state, 'That starting crossing is occupied.')
      const color = activeInvestigatorColor(state)
      const investigatorPositions = { ...state.investigatorPositions, [color]: crossing.id }
      if (state.activeInvestigator === INVESTIGATOR_ORDER.length - 1) {
        return {
          ...state,
          investigatorPositions,
          stage: action.review ? 'investigatorSetupResult' : 'handoffJackStart',
          activeInvestigator: 0,
          publicLog: [...state.publicLog, 'All three Investigators have deployed.'],
          notice: 'Deployment complete. Pass the device back to Jack.',
        }
      }
      const next = state.activeInvestigator + 1
      return {
        ...state,
        investigatorPositions,
        activeInvestigator: next,
        notice: `Place the ${INVESTIGATOR_ORDER[next]} Investigator on a different starting crossing.`,
      }
    }
    case 'chooseJackStart': {
      if (state.stage !== 'jackChooseStart' || !state.discoveryLocations.includes(action.circleId)) return state
      const next: GameState = {
        ...state,
        stage: 'jackMove',
        currentJack: action.circleId,
        reachedDiscoveries: [action.circleId],
        roundTrail: [action.circleId],
        publicRound: { start: action.circleId, moves: [], observations: [] },
        publicLog: [...state.publicLog, moveLog(0, `Jack began the hunt at Discovery Location ${action.circleId}.`)],
        jackMoveSelection: baseJackSelection,
        notice: 'The starting location is public. Make Jack’s first secret move.',
      }
      return hasAnyLegalJackMove(next)
        ? next
        : endGame(next, {
            winner: 'investigators',
            reason: 'Jack has no legal movement from the starting location.',
          })
    }
    case 'setJackMoveType': {
      if (state.stage !== 'jackMove') return state
      if (state.jackMoveSelection.type === action.moveType) return state
      if (action.moveType !== 'normal' && state.specialRemaining[action.moveType] < 1) {
        return withNotice(state, `No ${action.moveType} tiles remain.`)
      }
      if (action.moveType === 'coach' && state.moveSlot > 13) {
        return withNotice(state, 'Coach needs two available move-track spaces.')
      }
      return {
        ...state,
        jackMoveSelection: { type: action.moveType, path: [] },
        notice:
          action.moveType === 'coach'
            ? 'Choose the Coach’s intermediate circle, then its destination.'
            : `Choose a legal ${action.moveType} destination.`,
      }
    }
    case 'selectJackDestination': {
      if (state.stage !== 'jackMove') return state
      const legal = legalJackDestinations(state)
      if (!legal.includes(action.circleId)) return withNotice(state, 'That location is not legal for this movement.')
      const path =
        state.jackMoveSelection.type === 'coach'
          ? [...state.jackMoveSelection.path, action.circleId].slice(0, 2)
          : [action.circleId]
      return {
        ...state,
        jackMoveSelection: { ...state.jackMoveSelection, path },
        notice:
          state.jackMoveSelection.type === 'coach' && path.length === 1
            ? 'Now choose the Coach’s final destination.'
            : 'Review the private route, then confirm the move.',
      }
    }
    case 'confirmJackMove': {
      if (state.stage !== 'jackMove' || !selectedMoveIsComplete(state) || !state.publicRound) return state
      const selectedPath = state.jackMoveSelection.path
      const last = selectedPath[selectedPath.length - 1]
      if (last === undefined) return state

      const verificationState: GameState = { ...state, jackMoveSelection: { ...state.jackMoveSelection, path: [] } }
      const firstLegal = legalJackDestinations(verificationState)
      if (!firstLegal.includes(selectedPath[0] ?? -1)) return withNotice(state, 'The selected route is no longer legal.')
      if (
        state.jackMoveSelection.type === 'coach' &&
        !legalCoachSecondDestinations(state, selectedPath[0] ?? -1).includes(last)
      ) {
        return withNotice(state, 'The Coach destination is no longer legal.')
      }

      const cost = moveCost(state.jackMoveSelection.type)
      const moveSlot = state.moveSlot + cost
      const positions = completedInvestigatorPositions(state.investigatorPositions)
      if (!positions) return withNotice(state, 'All Investigators must be on the board.')
      const specialRemaining = { ...state.specialRemaining }
      if (state.jackMoveSelection.type !== 'normal') specialRemaining[state.jackMoveSelection.type] -= 1
      const publicMove = {
        type: state.jackMoveSelection.type,
        startSlot: state.moveSlot + 1,
        endSlot: moveSlot,
        investigatorPositions: positions,
      }
      const publicLog = [
        ...state.publicLog,
        moveLog(
          moveSlot,
          state.jackMoveSelection.type === 'normal'
            ? `Jack advanced to move ${moveSlot}.`
            : `Jack publicly used ${state.jackMoveSelection.type} on move ${publicMove.startSlot}${cost === 2 ? `-${moveSlot}` : ''}.`,
        ),
      ]
      const moved: GameState = {
        ...state,
        stage: 'handoffInspectorsTurn',
        moveSlot,
        currentJack: last,
        roundTrail: [...state.roundTrail, ...selectedPath],
        jackMoveSelection: baseJackSelection,
        specialRemaining,
        publicRound: { ...state.publicRound, moves: [...state.publicRound.moves, publicMove] },
        publicLog,
        notice: 'Jack’s move is recorded. Pass the device to the Investigator player.',
      }
      const reachedNewDiscovery =
        state.discoveryLocations.includes(last) && !state.reachedDiscoveries.includes(last)
      return moveSlot === 15 && !reachedNewDiscovery
        ? endGame(moved, {
            winner: 'investigators',
            reason: 'Jack used all fifteen moves without reaching a new Discovery Location.',
          })
        : moved
    }
    case 'moveInvestigator': {
      if (state.stage !== 'investigatorMove') return state
      if (!legalInvestigatorDestinations(state).includes(action.crossingId)) {
        return withNotice(state, 'That crossing is not a legal destination within two moves.')
      }
      const color = activeInvestigatorColor(state)
      const investigatorPositions = { ...state.investigatorPositions, [color]: action.crossingId }
      if (state.activeInvestigator === INVESTIGATOR_ORDER.length - 1) {
        return {
          ...state,
          investigatorPositions,
          stage: 'investigatorAction',
          activeInvestigator: 0,
          inspectorActionMode: 'search',
          checkedThisAction: [],
          notice: 'Yellow Investigator: search for clues, execute an arrest, or pass.',
        }
      }
      const next = state.activeInvestigator + 1
      return {
        ...state,
        investigatorPositions,
        activeInvestigator: next,
        notice: `${INVESTIGATOR_ORDER[next]} Investigator: move zero, one, or two crossings.`,
      }
    }
    case 'setInspectorActionMode': {
      if (state.stage !== 'investigatorAction') return state
      if (state.inspectorActionMode === action.mode) return state
      if (state.inspectorActionMode === 'search' && state.checkedThisAction.length > 0) {
        return withNotice(state, 'End the current clue search before choosing another action.')
      }
      return {
        ...state,
        inspectorActionMode: action.mode,
        checkedThisAction: [],
        notice:
          action.mode === 'search'
            ? 'Inspect adjacent circles one at a time until a clue is found.'
            : 'Choose exactly one adjacent circle for the arrest attempt.',
      }
    }
    case 'searchCircle': {
      if (state.stage !== 'investigatorAction' || state.inspectorActionMode !== 'search' || !state.publicRound) {
        return state
      }
      const adjacent = legalInspectorActionCircles(state)
      if (!adjacent.includes(action.circleId) || state.checkedThisAction.includes(action.circleId)) return state
      const found = state.roundTrail.includes(action.circleId)
      const color = activeInvestigatorColor(state)
      const checkedThisAction = [...state.checkedThisAction, action.circleId]
      const observations = [
        ...state.publicRound.observations,
        {
          kind: 'clue' as const,
          circleId: action.circleId,
          found,
          afterMove: state.publicRound.moves.length,
          investigator: color,
        },
      ]
      const clueLocations = found
        ? [...new Set([...state.clueLocations, action.circleId])].sort((a, b) => a - b)
        : state.clueLocations
      const next = {
        ...state,
        publicRound: { ...state.publicRound, observations },
        clueLocations,
        checkedThisAction,
        publicLog: [
          ...state.publicLog,
          moveLog(state.moveSlot, `${color} searched ${action.circleId}: ${found ? 'clue found' : 'no clue'}.`),
        ],
        notice: found ? `A clue was found at ${action.circleId}.` : `No clue at ${action.circleId}.`,
      }
      return found || checkedThisAction.length >= adjacent.length ? advanceInspectorAction(next) : next
    }
    case 'arrestCircle': {
      if (state.stage !== 'investigatorAction' || state.inspectorActionMode !== 'arrest' || !state.publicRound) {
        return state
      }
      if (!legalInspectorActionCircles(state).includes(action.circleId)) return state
      const color = activeInvestigatorColor(state)
      if (state.currentJack === action.circleId) {
        return endGame(
          {
            ...state,
            publicLog: [...state.publicLog, moveLog(state.moveSlot, `${color} arrested Jack at ${action.circleId}.`)],
          },
          { winner: 'investigators', reason: `Jack was arrested at location ${action.circleId}.` },
        )
      }
      const miss = {
        ...state,
        publicRound: {
          ...state.publicRound,
          observations: [
            ...state.publicRound.observations,
            {
              kind: 'arrest' as const,
              circleId: action.circleId,
              hit: false as const,
              afterMove: state.publicRound.moves.length,
              investigator: color,
            },
          ],
        },
        publicLog: [
          ...state.publicLog,
          moveLog(state.moveSlot, `${color} attempted an arrest at ${action.circleId}: missed.`),
        ],
        notice: `No arrest at ${action.circleId}.`,
      }
      return advanceInspectorAction(miss)
    }
    case 'passInspectorAction': {
      if (state.stage !== 'investigatorAction') return state
      const color = activeInvestigatorColor(state)
      const passed = {
        ...state,
        publicLog: [
          ...state.publicLog,
          moveLog(
            state.moveSlot,
            state.checkedThisAction.length > 0
              ? `${color} ended the clue search.`
              : `${color} passed the action phase.`,
          ),
        ],
        notice: state.checkedThisAction.length > 0 ? `${color} ended the clue search.` : `${color} passed.`,
      }
      return advanceInspectorAction(passed)
    }
    default:
      return state
  }
}

export const deploymentChoices = (state: GameState): string[] => {
  const occupied = occupiedCrossings(state)
  return startingCrossings.map((crossing) => crossing.id).filter((id) => !occupied.has(id))
}

export const jackMoveReadyToConfirm = selectedMoveIsComplete

const randomChoice = <T>(values: T[], random: () => number): T | undefined =>
  values[Math.min(values.length - 1, Math.floor(random() * values.length))]

/**
 * Returns one button press worth of legal, random progress. Keeping this in the
 * engine makes the probability rules testable and lets the UI record each
 * generated action in normal game history.
 */
export const randomProgressActions = (state: GameState, random: () => number = Math.random): GameAction[] => {
  if (state.stage === 'jackDiscoverySetup') {
    if (state.discoveryLocations.length === 4) return [{ type: 'confirmDiscoveries' }]
    const selectedQuadrants = new Set(state.discoveryLocations.map((id) => circlesById.get(id)?.quadrant))
    const choice = randomChoice(
      [...circlesById.values()].filter(
        (circle) => circle.color === 'white' && !selectedQuadrants.has(circle.quadrant),
      ),
      random,
    )
    return choice ? [{ type: 'toggleDiscovery', circleId: choice.id }] : []
  }

  if (
    state.stage === 'handoffInspectorsSetup' ||
    state.stage === 'handoffJackStart' ||
    state.stage === 'handoffInspectorsTurn' ||
    state.stage === 'investigatorSetupResult' ||
    state.stage === 'investigatorTurnResult' ||
    state.stage === 'handoffJackTurn'
  ) {
    return [{ type: 'continueHandoff' }]
  }

  if (state.stage === 'investigatorSetup') {
    const crossingId = randomChoice(deploymentChoices(state), random)
    return crossingId
      ? [{ type: 'placeInvestigator', crossingId, review: state.activeInvestigator === INVESTIGATOR_ORDER.length - 1 }]
      : []
  }

  if (state.stage === 'jackChooseStart') {
    const circleId = randomChoice(state.discoveryLocations, random)
    return circleId === undefined ? [] : [{ type: 'chooseJackStart', circleId }]
  }

  if (state.stage === 'jackMove') {
    if (selectedMoveIsComplete(state)) return [{ type: 'confirmJackMove' }]
    if (state.jackMoveSelection.path.length > 0) {
      const circleId = randomChoice(legalJackDestinations(state), random)
      return circleId === undefined ? [] : [{ type: 'selectJackDestination', circleId }]
    }

    const validMoveTypes = JACK_MOVE_TYPES.filter((type) => {
      if (type === 'normal') return legalNormalDestinations(state).length > 0
      if (type === 'coach') return legalCoachFirstDestinations(state).length > 0
      return legalGroupedDestinations(state, type).length > 0
    })
    const boatIsValid = validMoveTypes.includes('boat')
    const streetIsValid = validMoveTypes.includes('normal')
    const otherSpecials = (['alley', 'coach'] as const).filter((type) => validMoveTypes.includes(type))
    let moveType: JackMoveType | undefined
    if (boatIsValid && random() < 0.5) {
      moveType = 'boat'
    } else if (streetIsValid && (otherSpecials.length === 0 || random() < 0.8)) {
      moveType = 'normal'
    } else {
      moveType = randomChoice(otherSpecials, random)
        ?? (streetIsValid ? 'normal' : randomChoice(validMoveTypes, random))
    }
    if (moveType === undefined) return []

    const typedState = moveType === state.jackMoveSelection.type
      ? state
      : gameReducer(state, { type: 'setJackMoveType', moveType })
    const first = randomChoice(legalJackDestinations(typedState), random)
    if (first === undefined) return []
    const actions: GameAction[] = []
    if (moveType !== state.jackMoveSelection.type) actions.push({ type: 'setJackMoveType', moveType })
    actions.push({ type: 'selectJackDestination', circleId: first })
    if (moveType === 'coach') {
      const afterFirst = gameReducer(typedState, { type: 'selectJackDestination', circleId: first })
      const second = randomChoice(legalJackDestinations(afterFirst), random)
      if (second !== undefined) actions.push({ type: 'selectJackDestination', circleId: second })
    }
    return actions
  }

  if (state.stage === 'investigatorMove') {
    const crossingId = randomChoice(legalInvestigatorDestinations(state), random)
    return crossingId ? [{ type: 'moveInvestigator', crossingId }] : []
  }

  if (state.stage === 'investigatorAction') {
    const adjacent = legalInspectorActionCircles(state)
    const available = adjacent.filter((id) => !state.checkedThisAction.includes(id))
    if (state.checkedThisAction.length > 0) {
      const circleId = randomChoice(available, random)
      return circleId === undefined
        ? [{ type: 'passInspectorAction' }]
        : [{ type: 'searchCircle', circleId }]
    }
    const roll = random()
    if (roll >= 0.9 || adjacent.length === 0) return [{ type: 'passInspectorAction' }]
    const circleId = randomChoice(adjacent, random)
    if (circleId === undefined) return [{ type: 'passInspectorAction' }]
    if (roll < 0.3) {
      return [
        { type: 'setInspectorActionMode', mode: 'arrest' },
        { type: 'arrestCircle', circleId },
      ]
    }
    const actions: GameAction[] = []
    if (state.inspectorActionMode !== 'search') actions.push({ type: 'setInspectorActionMode', mode: 'search' })
    actions.push({ type: 'searchCircle', circleId })
    return actions
  }

  return []
}
