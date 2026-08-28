import { useReducer, useState } from 'react'
import type { CSSProperties } from 'react'
import './App.css'
import { contrastingBlackOrWhite } from './colorContrast'
import {
  activeInvestigatorColor,
  createInitialGame,
  deploymentChoices,
  gameReducer,
  jackMoveReadyToConfirm,
  legalInspectorActionCircles,
  legalInvestigatorDestinations,
  investigatorPreviewDestinations,
  investigatorSetupPreviewDestinations,
  investigatorStartingCrossingPreviewDestinations,
  jackRouteTurnLabels,
  legalJackDestinations,
  coachReachableJackDestinations,
  randomProgressActions,
  shortestJackRoutePreview,
  shortestInvestigatorRoutePreview,
} from './game/gameEngine'
import {
  movementLabel,
  possibleJackSearchOutcomes,
  possibleJackSearchOutcomesAfterMove,
  type SearchOutcome,
} from './game/inference'
import {
  actionCount,
  canBigUndo,
  canRedo,
  canRedoAll,
  createGameHistory,
  currentHistoryState,
  gameHistoryReducer,
  undoMode,
  type GameHistory,
  type PlayerView,
} from './game/history'
import {
  adjacentCirclesForCrossing,
  circles,
  circlesById,
  crossings,
  crossingsById,
  reachableCrossings,
} from './game/mapData'
import {
  CROSSING_IDS_STORAGE_KEY,
  INVESTIGATOR_AUTO_STORAGE_KEY,
  INVESTIGATOR_KNOW_STORAGE_KEY,
  INVESTIGATOR_MAYBES_STORAGE_KEY,
  JACK_PEEK_STORAGE_KEY,
  PAST_PATH_STORAGE_KEY,
  POSSIBLE_LOCATIONS_STORAGE_KEY,
  loadBooleanPreference,
  loadStoredHistory,
  saveBooleanPreference,
  saveStoredHistory,
} from './game/persistence'
import {
  INVESTIGATOR_ORDER,
  type GameAction,
  type GameState,
  type InvestigatorColor,
  type JackMoveType,
  type Quadrant,
} from './game/types'

const BOARD_SIZE = 1200
const BOARD_VIEWPORT = { x: 70, y: 10, width: 1100, height: 1090 } as const
const EDGE_ARROW_LENGTH = 12
const EDGE_ARROW_HALF_WIDTH = 10
const LOCATION_OUTLINES = {
  mapLocation: { radius: 18, strokeWidth: 0 },
  legal: { radius: 18.5, strokeWidth: 2 },
  clue: { radius: 18, strokeWidth: 3 },
  clueOutsideLegal: { radius: 23, strokeWidth: 3 },
  discovery: { radius: 19, strokeWidth: 4 },
  possible: { radius: 23, strokeWidth: 4 },
  outcomeInner: { radius: 20.5, strokeWidth: 4 },
  outcomeOuter: { radius: 26, strokeWidth: 4 },
  investigatorMaybe: { radius: 21, strokeWidth: 2 },
  hoveredInvestigatorMaybe: { radius: 26, strokeWidth: 2 },
  routePreview: { strokeWidth: 2.5 },
} as const
const LOCATION_OUTLINE_GAP = 1
const enclosingOutlineRadius = (
  outlines: Array<{ radius: number; strokeWidth: number }>,
  enclosingStrokeWidth: number,
) =>
  Math.max(...outlines.map(({ radius, strokeWidth }) => radius + strokeWidth / 2)) +
  LOCATION_OUTLINE_GAP +
  enclosingStrokeWidth / 2
const enclosingLocationOutlineRadius = (outlines: Array<{ radius: number; strokeWidth: number }>) =>
  enclosingOutlineRadius(outlines, LOCATION_OUTLINES.routePreview.strokeWidth)
const CROSSING_OUTLINES = {
  mapCrossing: { radius: 12, strokeWidth: 0 },
  legal: { radius: 12.5, strokeWidth: 2 },
  routePreview: { strokeWidth: 2.5 },
} as const
const ROUTE_CIRCLE_RADIUS = LOCATION_OUTLINES.legal.radius
const COACH_REACHABLE_CIRCLE_RADIUS = LOCATION_OUTLINES.legal.radius
const CLUE_CIRCLE_RADIUS = LOCATION_OUTLINES.clue.radius
const OVERLAPPING_CLUE_CIRCLE_RADIUS = LOCATION_OUTLINES.clueOutsideLegal.radius
const POSSIBLE_CIRCLE_RADIUS = LOCATION_OUTLINES.possible.radius
const OUTCOME_CIRCLE_RADIUS = LOCATION_OUTLINES.possible.radius
const INNER_OUTCOME_CIRCLE_RADIUS = LOCATION_OUTLINES.outcomeInner.radius
const OUTER_OUTCOME_CIRCLE_RADIUS = LOCATION_OUTLINES.outcomeOuter.radius
const INVESTIGATOR_MAYBE_CIRCLE_RADIUS = LOCATION_OUTLINES.investigatorMaybe.radius
const INVESTIGATOR_MAYBE_CROSSING_SIZE = 15
const HOVERED_INVESTIGATOR_MAYBE_CIRCLE_RADIUS = LOCATION_OUTLINES.hoveredInvestigatorMaybe.radius
const HOVERED_INVESTIGATOR_MAYBE_CROSSING_SIZE = 24
const QUADRANTS: Quadrant[] = ['NW', 'NE', 'SW', 'SE']
const MOVE_TYPES: JackMoveType[] = ['normal', 'coach', 'alley', 'boat']
const INVESTIGATOR_COLORS: Record<InvestigatorColor, string> = {
  yellow: '#ffff00',
  blue: '#1f68ab',
  red: '#b02f2e',
}

const investigatorPieceStyle = (color: InvestigatorColor) => {
  const background = INVESTIGATOR_COLORS[color]
  return {
    '--investigator-background': background,
    '--investigator-foreground': contrastingBlackOrWhite(background),
  } as CSSProperties
}

const trimmedRouteSegments = (points: { x: number; y: number }[]) =>
  points.slice(0, -1).flatMap((from, index) => {
    const to = points[index + 1]
    if (!to) return []
    const dx = to.x - from.x
    const dy = to.y - from.y
    const length = Math.hypot(dx, dy)
    if (length <= ROUTE_CIRCLE_RADIUS * 2) return []
    const xInset = (dx / length) * ROUTE_CIRCLE_RADIUS
    const yInset = (dy / length) * ROUTE_CIRCLE_RADIUS
    return [{ x1: from.x + xInset, y1: from.y + yInset, x2: to.x - xInset, y2: to.y - yInset }]
  })

const isHandoff = (stage: GameState['stage']) =>
  stage === 'handoffInspectorsSetup' ||
  stage === 'handoffJackStart' ||
  stage === 'handoffInspectorsTurn' ||
  stage === 'handoffJackTurn'

const isInspectorInteraction = (stage: GameState['stage']) =>
  stage === 'investigatorSetup' ||
  stage === 'investigatorSetupResult' ||
  stage === 'investigatorMove' ||
  stage === 'investigatorAction' ||
  stage === 'investigatorTurnResult'

const isPrivateJackView = (stage: GameState['stage']) =>
  stage === 'jackDiscoverySetup' || stage === 'jackChooseStart' || stage === 'jackMove'

const displayColor = (color: string) => `${color.charAt(0).toUpperCase()}${color.slice(1)}`

const browserStorage = () => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const initializeHistory = () => {
  const storage = browserStorage()
  let history = (storage && loadStoredHistory(storage)) || createGameHistory(createInitialGame())
  if (history.pendingReveal === 'investigators') history = gameHistoryReducer(history, { type: 'revealUndo' })
  const stage = currentHistoryState(history).stage
  if (stage === 'handoffInspectorsSetup' || stage === 'handoffInspectorsTurn') {
    history = gameHistoryReducer(history, { type: 'apply', action: { type: 'continueHandoff' } })
  }
  return history
}

const titleForStage = (state: GameState) => {
  const color = activeInvestigatorColor(state)
  const titles: Record<GameState['stage'], string> = {
    jackDiscoverySetup: 'Jack: Plan the Crime',
    handoffInspectorsSetup: 'Investigators’ Turn',
    investigatorSetup: `Deploy the ${displayColor(color)} Investigator`,
    investigatorSetupResult: 'Investigator Deployment Results',
    handoffJackStart: 'Pass Back to Jack',
    jackChooseStart: 'Jack: Choose the Starting Location',
    jackMove: 'Jack: Escape in the Night',
    handoffInspectorsTurn: 'Investigators’ Turn',
    investigatorMove: `${displayColor(color)} Investigator: Move`,
    investigatorAction: `${displayColor(color)} Investigator: Clues and Suspicion`,
    investigatorTurnResult: 'Investigator Results',
    handoffJackTurn: 'Pass to Jack',
    gameOver: state.result?.winner === 'jack' ? 'Jack Escaped' : 'Jack Was Stopped',
  }
  return titles[state.stage]
}

interface BoardProps {
  state: GameState
  legalCircleIds: Set<number>
  coachReachableCircleIds: Set<number>
  legalCrossingIds: Set<string>
  possibleIds: Set<number>
  possibleOutcomes: Map<number, SearchOutcome>
  showPossible: boolean
  showCrossingIds: boolean
  showPastPath: boolean
  showInvestigatorMaybes: boolean
  showInvestigatorKnowledge: boolean
  showJackPeek: boolean
  onCircle: (circleId: number) => void
  onCircleMiddleClick: (circleId: number) => void
  onCrossing: (crossingId: string) => void
  onMapClick: () => void
}

function BoardEdgeArrows({
  x,
  y,
  targetRadius,
  className,
  label,
}: {
  x: number
  y: number
  targetRadius: number
  className: string
  label: string
}) {
  const left = BOARD_VIEWPORT.x
  const top = BOARD_VIEWPORT.y
  const right = left + BOARD_VIEWPORT.width
  const bottom = top + BOARD_VIEWPORT.height

  return (
    <g className={className} aria-label={label}>
      <line className="edge-guide-line" x1={x} y1={top + EDGE_ARROW_LENGTH} x2={x} y2={y - targetRadius} />
      <line className="edge-guide-line" x1={x} y1={bottom - EDGE_ARROW_LENGTH} x2={x} y2={y + targetRadius} />
      <line className="edge-guide-line" x1={left + EDGE_ARROW_LENGTH} y1={y} x2={x - targetRadius} y2={y} />
      <line className="edge-guide-line" x1={right - EDGE_ARROW_LENGTH} y1={y} x2={x + targetRadius} y2={y} />
      <polygon points={`${x - EDGE_ARROW_HALF_WIDTH},${top} ${x + EDGE_ARROW_HALF_WIDTH},${top} ${x},${top + EDGE_ARROW_LENGTH}`} />
      <polygon points={`${x - EDGE_ARROW_HALF_WIDTH},${bottom} ${x + EDGE_ARROW_HALF_WIDTH},${bottom} ${x},${bottom - EDGE_ARROW_LENGTH}`} />
      <polygon points={`${left},${y - EDGE_ARROW_HALF_WIDTH} ${left},${y + EDGE_ARROW_HALF_WIDTH} ${left + EDGE_ARROW_LENGTH},${y}`} />
      <polygon points={`${right},${y - EDGE_ARROW_HALF_WIDTH} ${right},${y + EDGE_ARROW_HALF_WIDTH} ${right - EDGE_ARROW_LENGTH},${y}`} />
    </g>
  )
}

function GameBoard({
  state,
  legalCircleIds,
  coachReachableCircleIds,
  legalCrossingIds,
  possibleIds,
  possibleOutcomes,
  showPossible,
  showCrossingIds,
  showPastPath,
  showInvestigatorMaybes,
  showInvestigatorKnowledge,
  showJackPeek,
  onCircle,
  onCircleMiddleClick,
  onCrossing,
  onMapClick,
}: BoardProps) {
  const [hoveredMaybeId, setHoveredMaybeId] = useState<number | null>(null)
  const [hoveredInvestigator, setHoveredInvestigator] = useState<InvestigatorColor | null>(null)
  const [hoveredInvestigatorStart, setHoveredInvestigatorStart] = useState<string | null>(null)
  const [hoveredRouteTarget, setHoveredRouteTarget] = useState<number | null>(null)
  const [hoveredInvestigatorRouteTarget, setHoveredInvestigatorRouteTarget] = useState<string | null>(null)
  const [hoveredJack, setHoveredJack] = useState(false)
  const hoveredOutcome = hoveredMaybeId === null ? undefined : possibleOutcomes.get(hoveredMaybeId)
  const peekAtJack = showJackPeek && isInspectorInteraction(state.stage)
  const canPreviewJackDistances = state.stage === 'jackMove' || peekAtJack
  const routePreview = hoveredRouteTarget === null
    ? { segments: [], turnLabels: new Map<number, string>() }
    : shortestJackRoutePreview(state, hoveredRouteTarget)
  const jackHoverTurnLabels = hoveredJack && canPreviewJackDistances
    ? jackRouteTurnLabels(state, peekAtJack ? 'normal' : state.jackMoveSelection.type)
    : new Map<number, string>()
  const displayedTurnLabels = hoveredJack && canPreviewJackDistances ? jackHoverTurnLabels : routePreview.turnLabels
  const mergeTurnLabelsWithOutcomes =
    showPossible && (showInvestigatorKnowledge || (hoveredJack && canPreviewJackDistances))
  const showJack = isPrivateJackView(state.stage) || state.stage === 'gameOver' || peekAtJack
  const activeInvestigatorStartId = isInspectorInteraction(state.stage)
    ? state.investigatorPositions[activeInvestigatorColor(state)]
    : undefined
  const investigatorOneTurnCrossings = activeInvestigatorStartId
    ? reachableCrossings(activeInvestigatorStartId, 2)
    : new Set<string>()
  const investigatorRoutePreview = hoveredInvestigatorRouteTarget
    ? shortestInvestigatorRoutePreview(state, hoveredInvestigatorRouteTarget)
    : { segments: [], turnLabels: new Map<string, string>() }
  const investigatorRouteCrossingIds = new Set(
    investigatorRoutePreview.segments
      .flatMap(({ from, to }) => [from, to])
      .filter((id) => id !== activeInvestigatorStartId),
  )
  const privateSelections =
    isPrivateJackView(state.stage) || state.stage === 'gameOver' || peekAtJack
      ? new Set(state.discoveryLocations)
      : new Set<number>()
  const route =
    state.stage === 'jackMove' && state.currentJack !== null
      ? [state.currentJack, ...state.jackMoveSelection.path]
          .map((id) => circlesById.get(id))
          .filter((circle) => circle !== undefined)
      : []
  const plannedRouteSegments = trimmedRouteSegments(route)
  const activeInvestigator = isInspectorInteraction(state.stage)
    ? crossingsById.get(state.investigatorPositions[activeInvestigatorColor(state)] ?? '')
    : undefined
  const privateJackLocation = (isPrivateJackView(state.stage) || peekAtJack) && state.currentJack !== null
    ? circlesById.get(state.currentJack)
    : undefined
  const pastPath = (showPastPath && isPrivateJackView(state.stage)) || peekAtJack
    ? state.roundTrail.map((id) => circlesById.get(id)).filter((circle) => circle !== undefined)
    : []
  const pastPathSegments = trimmedRouteSegments(pastPath)
  const canPreviewPlacedInvestigators = state.stage === 'jackChooseStart' || state.stage === 'jackMove'
  const displayedInvestigatorColors = canPreviewPlacedInvestigators
    ? INVESTIGATOR_ORDER.filter((color) => showInvestigatorMaybes || hoveredInvestigator === color)
    : []
  const investigatorMaybeCrossings =
    state.stage === 'jackDiscoverySetup' && showInvestigatorMaybes
      ? investigatorSetupPreviewDestinations()
      : new Set<string>()
  for (const color of displayedInvestigatorColors) {
    const start = state.investigatorPositions[color]
    if (start) {
      for (const crossingId of investigatorPreviewDestinations(state, color)) {
        investigatorMaybeCrossings.add(crossingId)
      }
    }
  }
  const investigatorMaybeCircles = new Set<number>()
  for (const crossingId of investigatorMaybeCrossings) {
    for (const circleId of adjacentCirclesForCrossing(crossingId)) investigatorMaybeCircles.add(circleId)
  }
  const hoveredInvestigatorMaybeCrossings =
    state.stage === 'jackDiscoverySetup' && hoveredInvestigatorStart
      ? investigatorStartingCrossingPreviewDestinations(hoveredInvestigatorStart)
      : showInvestigatorMaybes && hoveredInvestigator
        ? investigatorPreviewDestinations(state, hoveredInvestigator)
        : new Set<string>()
  const hoveredInvestigatorColor = hoveredInvestigatorStart ? 'yellow' : hoveredInvestigator
  const hoveredInvestigatorMaybeCircles = new Set<number>()
  for (const crossingId of hoveredInvestigatorMaybeCrossings) {
    for (const circleId of adjacentCirclesForCrossing(crossingId)) hoveredInvestigatorMaybeCircles.add(circleId)
  }
  const routePreviewLocationRadius = (id: number) => {
    const outlines: Array<{ radius: number; strokeWidth: number }> = [LOCATION_OUTLINES.mapLocation]
    const legal = legalCircleIds.has(id) || coachReachableCircleIds.has(id)
    if (legal || state.jackMoveSelection.path.includes(id)) outlines.push(LOCATION_OUTLINES.legal)
    if (investigatorMaybeCircles.has(id)) outlines.push(LOCATION_OUTLINES.investigatorMaybe)
    if (hoveredInvestigatorMaybeCircles.has(id)) outlines.push(LOCATION_OUTLINES.hoveredInvestigatorMaybe)
    if (state.clueLocations.includes(id)) {
      outlines.push(legal ? LOCATION_OUTLINES.clueOutsideLegal : LOCATION_OUTLINES.clue)
    }
    if (state.reachedDiscoveries.includes(id) || privateSelections.has(id)) {
      outlines.push(LOCATION_OUTLINES.discovery)
    }
    if (showPossible && !hoveredOutcome && possibleIds.has(id)) outlines.push(LOCATION_OUTLINES.possible)
    if (showPossible && hoveredOutcome) {
      const remainsIfNo = hoveredOutcome.ifNo.has(id)
      const remainsIfYes = hoveredOutcome.ifYes.has(id)
      if (remainsIfNo && remainsIfYes) outlines.push(LOCATION_OUTLINES.outcomeOuter)
      else if (remainsIfNo || remainsIfYes) outlines.push(LOCATION_OUTLINES.possible)
    }
    return enclosingLocationOutlineRadius(outlines)
  }
  const investigatorRouteCrossingRadius = (id: string) =>
    enclosingOutlineRadius(
      [CROSSING_OUTLINES.mapCrossing, ...(legalCrossingIds.has(id) ? [CROSSING_OUTLINES.legal] : [])],
      CROSSING_OUTLINES.routePreview.strokeWidth,
    )
  const boardImage = `${import.meta.env.BASE_URL}map_pptx_simplified.jpg`

  return (
    <svg
      className={`game-board${showInvestigatorKnowledge ? ' investigator-knowledge-preview' : ''}`}
      viewBox={`${BOARD_VIEWPORT.x} ${BOARD_VIEWPORT.y} ${BOARD_VIEWPORT.width} ${BOARD_VIEWPORT.height}`}
      role="img"
      aria-label="Whitehall game board"
      onClick={onMapClick}
    >
      <image href={boardImage} x="0" y="0" width={BOARD_SIZE} height={BOARD_SIZE} />

      {activeInvestigator && (
        <BoardEdgeArrows
          x={activeInvestigator.x}
          y={activeInvestigator.y}
          targetRadius={17}
          className="active-investigator-edge-arrows"
          label="Active investigator position guides"
        />
      )}

      {privateJackLocation && (
        <BoardEdgeArrows
          x={privateJackLocation.x}
          y={privateJackLocation.y}
          targetRadius={13}
          className="jack-location-edge-arrows"
          label="Jack position guides"
        />
      )}

      {pastPathSegments.map((segment, index) => (
        <line
          key={`past-path-${index}`}
          className="past-path-line"
          x1={segment.x1}
          y1={segment.y1}
          x2={segment.x2}
          y2={segment.y2}
        />
      ))}

      {routePreview.segments.flatMap(({ from, to, crossingPaths }) => crossingPaths.map((routeCrossings, option) => {
        const fromCircle = circlesById.get(from)
        const toCircle = circlesById.get(to)
        if (!fromCircle || !toCircle) return null
        const points = [
          fromCircle,
          ...routeCrossings.map((id) => crossingsById.get(id)).filter((crossing) => crossing !== undefined),
          toCircle,
        ]
        const first = points[0]
        const second = points[1]
        const penultimate = points[points.length - 2]
        const last = points[points.length - 1]
        if (!first || !second || !penultimate || !last) return null
        const startDistance = Math.hypot(second.x - first.x, second.y - first.y)
        const endDistance = Math.hypot(last.x - penultimate.x, last.y - penultimate.y)
        if (startDistance === 0 || endDistance === 0) return null
        const displayedPoints = [
          {
            x: first.x + ((second.x - first.x) / startDistance) * ROUTE_CIRCLE_RADIUS,
            y: first.y + ((second.y - first.y) / startDistance) * ROUTE_CIRCLE_RADIUS,
          },
          ...points.slice(1, -1),
          {
            x: last.x - ((last.x - penultimate.x) / endDistance) * ROUTE_CIRCLE_RADIUS,
            y: last.y - ((last.y - penultimate.y) / endDistance) * ROUTE_CIRCLE_RADIUS,
          },
        ]
        return (
          <polyline
            key={`route-preview-${from}-${to}-${option}`}
            className="route-preview-line"
            points={displayedPoints.map((point) => `${point.x},${point.y}`).join(' ')}
            data-route-from={from}
            data-route-to={to}
            data-route-option={option}
          />
        )
      }))}

      {investigatorRoutePreview.segments.flatMap(({ from, to, throughLocationPaths }) =>
        throughLocationPaths.map((throughLocations, option) => {
          const fromCrossing = crossingsById.get(from)
          const toCrossing = crossingsById.get(to)
          if (!fromCrossing || !toCrossing) return null
          const points = [
            fromCrossing,
            ...throughLocations.map((id) => circlesById.get(id)).filter((circle) => circle !== undefined),
            toCrossing,
          ]
          const first = points[0]
          const second = points[1]
          const penultimate = points[points.length - 2]
          const last = points[points.length - 1]
          if (!first || !second || !penultimate || !last) return null
          const startDistance = Math.hypot(second.x - first.x, second.y - first.y)
          const endDistance = Math.hypot(last.x - penultimate.x, last.y - penultimate.y)
          if (startDistance === 0 || endDistance === 0) return null
          const displayedPoints = [
            {
              x: first.x + ((second.x - first.x) / startDistance) * CROSSING_OUTLINES.legal.radius,
              y: first.y + ((second.y - first.y) / startDistance) * CROSSING_OUTLINES.legal.radius,
            },
            ...points.slice(1, -1),
            {
              x: last.x - ((last.x - penultimate.x) / endDistance) * CROSSING_OUTLINES.legal.radius,
              y: last.y - ((last.y - penultimate.y) / endDistance) * CROSSING_OUTLINES.legal.radius,
            },
          ]
          return (
            <polyline
              key={`investigator-route-preview-${from}-${to}-${option}`}
              className="investigator-route-preview-line"
              points={displayedPoints.map((point) => `${point.x},${point.y}`).join(' ')}
              data-route-from={from}
              data-route-to={to}
              data-route-option={option}
            />
          )
        }),
      )}

      {[...routePreview.turnLabels].map(([id]) => {
        const circle = circlesById.get(id)
        return circle ? (
          <circle
            key={`route-preview-location-${id}`}
            className="route-preview-location"
            cx={circle.x}
            cy={circle.y}
            r={routePreviewLocationRadius(id)}
          />
        ) : null
      })}

      {[...investigatorRouteCrossingIds].map((id) => {
        const crossing = crossingsById.get(id)
        return crossing ? (
          <circle
            key={`investigator-route-preview-crossing-${id}`}
            className="investigator-route-preview-crossing"
            cx={crossing.x}
            cy={crossing.y}
            r={investigatorRouteCrossingRadius(id)}
          />
        ) : null
      })}

      {[...investigatorMaybeCircles].map((id) => {
        const circle = circlesById.get(id)
        return circle ? (
          <circle
            key={`investigator-maybe-circle-${id}`}
            className="investigator-maybe-circle"
            cx={circle.x}
            cy={circle.y}
            r={INVESTIGATOR_MAYBE_CIRCLE_RADIUS}
          />
        ) : null
      })}

      {[...investigatorMaybeCrossings].map((id) => {
        const crossing = crossingsById.get(id)
        return crossing ? (
          <rect
            key={`investigator-maybe-crossing-${id}`}
            className={`investigator-maybe-crossing${state.stage === 'jackDiscoverySetup' && crossing.starting ? ' possible-investigator-start' : ''}`}
            x={crossing.x - INVESTIGATOR_MAYBE_CROSSING_SIZE / 2}
            y={crossing.y - INVESTIGATOR_MAYBE_CROSSING_SIZE / 2}
            width={INVESTIGATOR_MAYBE_CROSSING_SIZE}
            height={INVESTIGATOR_MAYBE_CROSSING_SIZE}
          />
        ) : null
      })}

      {[...hoveredInvestigatorMaybeCircles].map((id) => {
        const circle = circlesById.get(id)
        return circle ? (
          <circle
            key={`hovered-investigator-maybe-circle-${id}`}
            className={`hovered-investigator-maybe-circle ${hoveredInvestigatorColor ?? ''}`}
            cx={circle.x}
            cy={circle.y}
            r={HOVERED_INVESTIGATOR_MAYBE_CIRCLE_RADIUS}
          />
        ) : null
      })}

      {[...hoveredInvestigatorMaybeCrossings].map((id) => {
        const crossing = crossingsById.get(id)
        return crossing ? (
          <rect
            key={`hovered-investigator-maybe-crossing-${id}`}
            className={`hovered-investigator-maybe-crossing ${hoveredInvestigatorColor ?? ''}`}
            x={crossing.x - HOVERED_INVESTIGATOR_MAYBE_CROSSING_SIZE / 2}
            y={crossing.y - HOVERED_INVESTIGATOR_MAYBE_CROSSING_SIZE / 2}
            width={HOVERED_INVESTIGATOR_MAYBE_CROSSING_SIZE}
            height={HOVERED_INVESTIGATOR_MAYBE_CROSSING_SIZE}
          />
        ) : null
      })}

      {showPossible && !hoveredOutcome &&
        [...possibleIds].map((id) => {
          const circle = circlesById.get(id)
          const outcome = possibleOutcomes.get(id)
          return circle ? (
            <g key={`possible-${id}`}>
              {outcome?.positiveMeansJackIsThereNow && (
                <circle
                  className="possible-certainty-marker"
                  cx={circle.x}
                  cy={circle.y}
                  r={POSSIBLE_CIRCLE_RADIUS}
                />
              )}
              <circle className="possible-marker" cx={circle.x} cy={circle.y} r={POSSIBLE_CIRCLE_RADIUS} />
            </g>
          ) : null
        })}

      {showPossible && hoveredOutcome &&
        [...new Set([...hoveredOutcome.ifNo, ...hoveredOutcome.ifYes])].map((id) => {
          const circle = circlesById.get(id)
          if (!circle) return null
          const remainsIfNo = hoveredOutcome.ifNo.has(id)
          const remainsIfYes = hoveredOutcome.ifYes.has(id)
          return (
            <g key={`outcome-${id}`}>
              {remainsIfNo && (
                <circle
                  className="possible-outcome-marker possible-outcome-no"
                  cx={circle.x}
                  cy={circle.y}
                  r={remainsIfYes ? INNER_OUTCOME_CIRCLE_RADIUS : OUTCOME_CIRCLE_RADIUS}
                />
              )}
              {remainsIfYes && (
                <circle
                  className="possible-outcome-marker possible-outcome-yes"
                  cx={circle.x}
                  cy={circle.y}
                  r={remainsIfNo ? OUTER_OUTCOME_CIRCLE_RADIUS : OUTCOME_CIRCLE_RADIUS}
                />
              )}
            </g>
          )
        })}

      {state.clueLocations.map((id) => {
        const circle = circlesById.get(id)
        const outlined = legalCircleIds.has(id) || coachReachableCircleIds.has(id)
        return circle ? (
          <circle
            key={`clue-${id}`}
            className={outlined ? 'clue-marker encircling-legal' : 'clue-marker'}
            cx={circle.x}
            cy={circle.y}
            r={outlined ? OVERLAPPING_CLUE_CIRCLE_RADIUS : CLUE_CIRCLE_RADIUS}
          />
        ) : null
      })}

      {state.reachedDiscoveries.map((id) => {
        const circle = circlesById.get(id)
        return circle ? (
          <circle key={`discovery-${id}`} className="discovery-marker" cx={circle.x} cy={circle.y} r="19" />
        ) : null
      })}

      {[...privateSelections]
        .filter((id) => !state.reachedDiscoveries.includes(id))
        .map((id) => {
          const circle = circlesById.get(id)
          return circle ? (
            <circle key={`private-${id}`} className="private-discovery-marker" cx={circle.x} cy={circle.y} r="19" />
          ) : null
        })}

      {plannedRouteSegments.map((segment, index) => (
        <line
          key={`private-route-${index}`}
          className="private-route"
          x1={segment.x1}
          y1={segment.y1}
          x2={segment.x2}
          y2={segment.y2}
        />
      ))}

      {circles.map((circle) => {
        const legal = legalCircleIds.has(circle.id)
        const selectable = legal || (state.stage === 'jackDiscoverySetup' && state.discoveryLocations.includes(circle.id))
        const coachReachable = coachReachableCircleIds.has(circle.id)
        const inferenceHoverTarget = showPossible && possibleOutcomes.has(circle.id)
        const routePreviewHoverTarget =
          state.stage === 'jackMove' && state.currentJack !== circle.id && !legalCircleIds.has(circle.id)
        const selected = state.jackMoveSelection.path.includes(circle.id)
        return (
          <g key={`circle-target-${circle.id}`}>
            {coachReachable && (
              <>
                <circle
                  className="coach-reachable-circle-gap"
                  cx={circle.x}
                  cy={circle.y}
                  r={COACH_REACHABLE_CIRCLE_RADIUS}
                />
                <circle
                  className="coach-reachable-circle"
                  cx={circle.x}
                  cy={circle.y}
                  r={COACH_REACHABLE_CIRCLE_RADIUS}
                />
              </>
            )}
            {legal && <circle className="legal-circle" cx={circle.x} cy={circle.y} r={ROUTE_CIRCLE_RADIUS} />}
            {selected && <circle className="selected-circle" cx={circle.x} cy={circle.y} r={ROUTE_CIRCLE_RADIUS} />}
            <circle
              className={`map-hit-target${selectable ? ' selectable' : ''}${inferenceHoverTarget ? ' inference-hover-target' : ''}${routePreviewHoverTarget ? ' route-preview-hover-target' : ''}`}
              cx={circle.x}
              cy={circle.y}
              r="18"
              onClick={() => selectable && onCircle(circle.id)}
              onAuxClick={(event) => {
                if (event.button === 1 && legal) {
                  event.preventDefault()
                  onCircleMiddleClick(circle.id)
                }
              }}
              onMouseEnter={() => {
                if (inferenceHoverTarget) setHoveredMaybeId(circle.id)
                if (routePreviewHoverTarget) setHoveredRouteTarget(circle.id)
              }}
              onMouseLeave={() => {
                if (inferenceHoverTarget) setHoveredMaybeId(null)
                if (routePreviewHoverTarget) setHoveredRouteTarget(null)
              }}
              aria-label={`Location ${circle.id}${selectable ? ', selectable' : ''}`}
            />
          </g>
        )
      })}

      {showPossible &&
        [...possibleOutcomes].filter(([, outcome]) => outcome.ifNo.size > 0).map(([id, outcome]) => {
          const circle = circlesById.get(id)
          if (!circle) return null
          const routeTurn = mergeTurnLabelsWithOutcomes ? displayedTurnLabels.get(id) : undefined
          const placeLeft = circle.x > BOARD_SIZE - 70
          const x = circle.x + (placeLeft ? -24 : 24)
          const y = circle.y < 40 ? circle.y + 30 : circle.y - 19
          return (
            <text
              key={`possible-count-${id}`}
              className="possible-outcome-count"
              x={x}
              y={y}
              textAnchor={placeLeft ? 'end' : 'start'}
              aria-label={`Search outcome at ${id}: ${outcome.ifNo.size} if no, ${outcome.ifYes.size} if yes${routeTurn ? `, turn ${routeTurn}` : ''}`}
            >
              <tspan className="outcome-count-no">{outcome.ifNo.size}</tspan>
              <tspan className="outcome-count-separator">/</tspan>
              <tspan className="outcome-count-yes">{outcome.ifYes.size}</tspan>
              {routeTurn && (
                <>
                  <tspan className="outcome-count-separator">/</tspan>
                  <tspan className="outcome-count-turn">{routeTurn}</tspan>
                </>
              )}
            </text>
          )
        })}

      {[...displayedTurnLabels]
        .filter(([id]) => !(mergeTurnLabelsWithOutcomes && (possibleOutcomes.get(id)?.ifNo.size ?? 0) > 0))
        .map(([id, label]) => {
          const circle = circlesById.get(id)
          return circle ? (
            <text
              key={`route-turn-${id}`}
              className="route-turn-count"
              x={circle.x}
              y={circle.y - 24}
              textAnchor="middle"
              aria-label={`Location ${id}: ${label} turns away`}
            >
              {label}
            </text>
          ) : null
        })}

      {crossings.map((crossing) => {
        const legal = legalCrossingIds.has(crossing.id)
        const investigatorStartPreview = state.stage === 'jackDiscoverySetup' && crossing.starting
        const investigatorRoutePreviewTarget =
          activeInvestigatorStartId !== undefined && !investigatorOneTurnCrossings.has(crossing.id)
        return (
          <g key={`crossing-target-${crossing.id}`}>
            {legal && <circle className="legal-crossing" cx={crossing.x} cy={crossing.y} r="12.5" />}
            <circle
              className={`map-hit-target${legal ? ' selectable' : ''}${investigatorStartPreview ? ' investigator-start-hover-target' : ''}${investigatorRoutePreviewTarget ? ' investigator-route-preview-hover-target' : ''}`}
              cx={crossing.x}
              cy={crossing.y}
              r="12"
              onClick={() => legal && onCrossing(crossing.id)}
              onMouseEnter={() => {
                if (investigatorStartPreview) setHoveredInvestigatorStart(crossing.id)
                if (investigatorRoutePreviewTarget) setHoveredInvestigatorRouteTarget(crossing.id)
              }}
              onMouseLeave={() => {
                if (investigatorStartPreview) setHoveredInvestigatorStart(null)
                if (investigatorRoutePreviewTarget) setHoveredInvestigatorRouteTarget(null)
              }}
              aria-label={`Crossing ${crossing.id}${legal ? ', selectable' : ''}${investigatorStartPreview ? ', possible investigator start' : ''}`}
            />
          </g>
        )
      })}

      {[...investigatorRoutePreview.turnLabels].map(([id, label]) => {
        const crossing = crossingsById.get(id)
        return crossing ? (
          <text
            key={`investigator-route-turn-${id}`}
            className="investigator-route-turn-count"
            x={crossing.x}
            y={crossing.y - 19}
            textAnchor="middle"
            aria-label={`Crossing ${id}: ${label} turns away`}
          >
            {label}
          </text>
        ) : null
      })}

      {showCrossingIds &&
        crossings.map((crossing) => (
          <text
            key={`crossing-label-${crossing.id}`}
            className="crossing-id-label"
            x={crossing.x}
            y={crossing.y - 9}
            textAnchor="middle"
          >
            {crossing.id}
          </text>
        ))}

      {pastPath.slice(1).map((circle, index) => (
        <g
          key={`past-path-step-${index + 1}`}
          className="past-path-step"
          transform={`translate(${circle.x + 21} ${circle.y - 17})`}
          aria-label={`Past path move ${index + 1}, location ${circle.id}`}
        >
          <circle r="8" />
          <text y="3" textAnchor="middle">{index + 1}</text>
        </g>
      ))}

      {INVESTIGATOR_ORDER.map((color) => {
        const crossingId = state.investigatorPositions[color]
        const crossing = crossingId ? crossingsById.get(crossingId) : undefined
        const active = isInspectorInteraction(state.stage) && activeInvestigatorColor(state) === color
        return crossing ? (
          <g
            key={`investigator-${color}`}
            className={`investigator-piece ${color}${canPreviewPlacedInvestigators ? ' hoverable' : ''}`}
            style={investigatorPieceStyle(color)}
            onMouseEnter={() => canPreviewPlacedInvestigators && setHoveredInvestigator(color)}
            onMouseLeave={() => canPreviewPlacedInvestigators && setHoveredInvestigator(null)}
          >
            {active && <circle className="active-investigator-ring" cx={crossing.x} cy={crossing.y} r="15" />}
            <circle cx={crossing.x} cy={crossing.y} r="10" />
            <text x={crossing.x} y={crossing.y + 4} textAnchor="middle">
              {color[0]?.toUpperCase()}
            </text>
          </g>
        ) : null
      })}

      {showJack &&
        state.currentJack !== null &&
        (() => {
          const circle = circlesById.get(state.currentJack)
          return circle ? (
            <g
              className={`jack-marker${canPreviewJackDistances ? ' hoverable' : ''}`}
              onMouseEnter={() => canPreviewJackDistances && setHoveredJack(true)}
              onMouseLeave={() => setHoveredJack(false)}
            >
              <circle cx={circle.x} cy={circle.y} r="11" />
              <text x={circle.x} y={circle.y + 4} textAnchor="middle">
                J
              </text>
            </g>
          ) : null
        })()}
    </svg>
  )
}

function MoveTrack({ state, showJackPeek }: { state: GameState; showJackPeek: boolean }) {
  const moves = state.publicRound?.moves ?? []
  const showPrivateLocations = isPrivateJackView(state.stage) || (showJackPeek && isInspectorInteraction(state.stage))
  return (
    <section className="move-track" aria-label="Public Jack move track">
      <div className="track-heading">
        <div>
          <span className="eyebrow">Public move track</span>
          <strong>
            Round {state.round} · Move {state.moveSlot} of 15
          </strong>
        </div>
        <div className="special-counts" aria-label="Jack special movement tiles remaining">
          <span>Coach {state.specialRemaining.coach}/2</span>
          <span>Alley {state.specialRemaining.alley}/2</span>
          <span>Boat {state.specialRemaining.boat}/2</span>
        </div>
      </div>
      <div className="track-slots">
        {Array.from({ length: 16 }, (_, slot) => {
          const special = moves.find(
            (move) => move.type !== 'normal' && slot >= move.startSlot && slot <= move.endSlot,
          )
          const location = showPrivateLocations ? state.roundTrail[slot] : undefined
          return (
            <div
              key={slot}
              className={`track-slot ${slot < state.moveSlot ? 'past' : ''} ${slot === state.moveSlot ? 'current' : ''}`}
              aria-label={`Move ${slot}${special ? `, ${movementLabel(special.type)}` : ''}${location === undefined ? '' : `, location ${location}`}`}
            >
              <span className="track-number">{slot}</span>
              {location !== undefined && <span className="track-location">{location}</span>}
              {special && <span className={`special-badge ${special.type}`}>{special.type[0]?.toUpperCase()}</span>}
              {slot === state.moveSlot && <span className="jack-track-token">J</span>}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function TargetButtons<T extends number | string>({
  values,
  label,
  onSelect,
}: {
  values: T[]
  label: string
  onSelect: (value: T) => void
}) {
  return (
    <div className="target-list" aria-label={label}>
      {values.map((value) => (
        <button key={value} className="target-button" type="button" onClick={() => onSelect(value)}>
          {value}
        </button>
      ))}
    </div>
  )
}

interface HistoryControlsProps {
  history: GameHistory
  onUndo: () => void
  onBigUndo: () => void
  onRedo: () => void
  onRedoAll: () => void
  onRand: () => void
  onRandSide: () => void
}

function HistoryControls({ history, onUndo, onBigUndo, onRedo, onRedoAll, onRand, onRandSide }: HistoryControlsProps) {
  const mode = undoMode(history)
  return (
    <div className="history-controls" aria-label="Action history controls">
      <button type="button" disabled={!canBigUndo(history)} onClick={onBigUndo}>
        Undo Side
      </button>
      <button type="button" disabled={mode === 'disabled'} onClick={onUndo}>
        {mode === 'cross-view' ? 'Undo!' : 'Undo'}
      </button>
      <button type="button" disabled={!canRedo(history)} onClick={onRedo}>
        Redo
      </button>
      <button type="button" disabled={!canRedoAll(history)} onClick={onRedoAll}>
        Redo All
      </button>
      <button type="button" onClick={onRand}>
        Rand
      </button>
      <button type="button" onClick={onRandSide}>
        Rand Side
      </button>
      <span className="action-counter" aria-label={`${actionCount(history)} player actions`}>
        Actions {actionCount(history)}
      </span>
    </div>
  )
}

function DiscoveryChecklist({ state }: { state: GameState }) {
  if (!isPrivateJackView(state.stage) || state.discoveryLocations.length === 0) return null
  return (
    <section className="discovery-checklist" aria-label="Jack discovery locations">
      <span>Discovery locations</span>
      <ol>
        {[...state.discoveryLocations]
          .sort((a, b) => a - b)
          .map((id) => {
            const completed = state.reachedDiscoveries.includes(id)
            return (
              <li
                key={id}
                className={completed ? 'completed' : ''}
                aria-label={`${id}, ${completed ? 'completed' : 'remaining'}`}
              >
                {id}
              </li>
            )
          })}
      </ol>
    </section>
  )
}

interface ControlsProps {
  state: GameState
  dispatch: (action: GameAction) => void
}

interface GameControlsProps extends ControlsProps {
  onUndoRoute: () => void
  onUndoSecondLocation: () => void
}

function GameControls({ state, dispatch, onUndoRoute, onUndoSecondLocation }: GameControlsProps) {
  const activeColor = activeInvestigatorColor(state)

  if (state.stage === 'jackDiscoverySetup') {
    return (
      <>
        <p>
          Select one white numbered circle in each board region. Selecting another location in the same region replaces it.
        </p>
        <div className="quadrant-grid">
          {QUADRANTS.map((quadrant) => {
            const selected = state.discoveryLocations.find((id) => circlesById.get(id)?.quadrant === quadrant)
            return (
              <div key={quadrant} className={selected ? 'quadrant-card complete' : 'quadrant-card'}>
                <span>{quadrant}</span>
                <strong>{selected ?? '—'}</strong>
              </div>
            )
          })}
        </div>
        <button
          className="primary-button"
          type="button"
          disabled={state.discoveryLocations.length !== 4}
          onClick={() => dispatch({ type: 'confirmDiscoveries' })}
        >
          Lock in four locations
        </button>
      </>
    )
  }

  if (state.stage === 'investigatorSetup') {
    const choices = deploymentChoices(state)
    return (
      <>
        <p>
          Place the <strong className={`color-word ${activeColor}`}>{activeColor}</strong> Investigator on one of the remaining yellow-bordered crossings.
        </p>
        <TargetButtons
          values={choices}
          label="Available deployment crossings"
          onSelect={(crossingId) => dispatch({ type: 'placeInvestigator', crossingId })}
        />
      </>
    )
  }

  if (state.stage === 'jackChooseStart') {
    return (
      <>
        <p>Choose which secret Discovery Location begins the hunt. This location will become public.</p>
        <TargetButtons
          values={state.discoveryLocations}
          label="Secret Discovery Locations"
          onSelect={(circleId) => dispatch({ type: 'chooseJackStart', circleId })}
        />
      </>
    )
  }

  if (state.stage === 'jackMove') {
    const legal = legalJackDestinations(state)
    const route = state.jackMoveSelection.path
    return (
      <>
        <p>Your current location and route are private. Special moves cannot enter an unreached Discovery Location.</p>
        <div className="movement-tabs" role="group" aria-label="Jack movement type">
          {MOVE_TYPES.map((type) => {
            const remaining = type === 'normal' ? null : state.specialRemaining[type]
            const disabled =
              remaining === 0 ||
              (type === 'coach' && state.moveSlot > 13) ||
              (type === 'boat' && circlesById.get(state.currentJack ?? -1)?.color !== 'blue')
            return (
              <button
                key={type}
                className={state.jackMoveSelection.type === type ? 'movement-tab active' : 'movement-tab'}
                type="button"
                disabled={disabled}
                onClick={() => dispatch({ type: 'setJackMoveType', moveType: type })}
              >
                {movementLabel(type)} {remaining === null ? '' : `(${remaining})`}
              </button>
            )
          })}
        </div>
        <div className="private-route-summary">
          <span>Private route</span>
          <strong>{[state.currentJack, ...route].filter((id) => id !== null).join(' → ')}</strong>
        </div>
        <p className="subtle">
          {legal.length} legal destination{legal.length === 1 ? '' : 's'} at this step
        </p>
        <TargetButtons
          values={legal}
          label="Legal Jack destinations"
          onSelect={(circleId) => dispatch({ type: 'selectJackDestination', circleId })}
        />
        <div className="button-row">
          <button
            type="button"
            className="secondary-button"
            disabled={route.length === 0}
            onClick={onUndoRoute}
          >
            Undo route
          </button>
          {state.jackMoveSelection.type === 'coach' && route.length === 2 ? (
            <button
              type="button"
              className="secondary-button"
              onClick={onUndoSecondLocation}
            >
              Undo 2nd Loc.
            </button>
          ) : null}
          <button
            type="button"
            className="primary-button"
            disabled={!jackMoveReadyToConfirm(state)}
            onClick={() => dispatch({ type: 'confirmJackMove' })}
          >
            Record move privately
          </button>
        </div>
      </>
    )
  }

  if (state.stage === 'investigatorMove') {
    const choices = legalInvestigatorDestinations(state)
    return (
      <>
        <p>
          Move the <strong className={`color-word ${activeColor}`}>{activeColor}</strong> Investigator zero, one, or two crossings. Other figures may be passed but not shared at the destination.
        </p>
        <TargetButtons
          values={choices}
          label={`Legal ${activeColor} Investigator destinations`}
          onSelect={(crossingId) => dispatch({ type: 'moveInvestigator', crossingId })}
        />
      </>
    )
  }

  if (state.stage === 'investigatorAction') {
    const adjacent = legalInspectorActionCircles(state)
    const available = adjacent.filter((id) => !state.checkedThisAction.includes(id))
    return (
      <>
        <p>
          The <strong className={`color-word ${activeColor}`}>{activeColor}</strong> Investigator may search for clues, attempt one arrest, or pass.
        </p>
        <div className="button-row action-choices">
          <button
            type="button"
            className={state.inspectorActionMode === 'search' ? 'primary-button' : 'secondary-button'}
            onClick={() => dispatch({ type: 'setInspectorActionMode', mode: 'search' })}
          >
            Search for clues
          </button>
          <button
            type="button"
            className={state.inspectorActionMode === 'arrest' ? 'danger-button' : 'secondary-button'}
            disabled={state.checkedThisAction.length > 0}
            onClick={() => dispatch({ type: 'setInspectorActionMode', mode: 'arrest' })}
          >
            Execute arrest
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => dispatch({ type: 'passInspectorAction' })}
          >
            {state.checkedThisAction.length > 0 ? 'End search' : 'Pass'}
          </button>
        </div>
        {state.inspectorActionMode !== 'choose' && (
          <>
            <p className="subtle">
              {state.inspectorActionMode === 'search'
                ? 'Choose adjacent locations one at a time. The action ends when a clue is found.'
                : 'Choose exactly one adjacent location.'}
            </p>
            <TargetButtons
              values={state.inspectorActionMode === 'search' ? available : adjacent}
              label={`Locations adjacent to the ${activeColor} Investigator`}
              onSelect={(circleId) =>
                dispatch(
                  state.inspectorActionMode === 'search'
                    ? { type: 'searchCircle', circleId }
                    : { type: 'arrestCircle', circleId },
                )
              }
            />
          </>
        )}
      </>
    )
  }

  if (state.stage === 'gameOver') {
    return (
      <div className={`result-card ${state.result?.winner}`}>
        <span className="eyebrow">{state.result?.winner === 'jack' ? 'Jack wins' : 'Investigators win'}</span>
        <p>{state.result?.reason}</p>
        <button className="primary-button" type="button" onClick={() => dispatch({ type: 'newGame' })}>
          Play again
        </button>
      </div>
    )
  }

  return null
}

interface HandoffProps extends ControlsProps, HistoryControlsProps {
  historyRevealTarget?: PlayerView | null
  onRevealUndo: () => void
}

function HandoffScreen({
  state,
  dispatch,
  history,
  onUndo,
  onBigUndo,
  onRedo,
  onRedoAll,
  onRand,
  onRandSide,
  historyRevealTarget,
  onRevealUndo,
}: HandoffProps) {
  if (historyRevealTarget) {
    const target = historyRevealTarget === 'jack' ? 'Jack' : 'Investigators'
    const redidAll = history.cursor === history.entries.length - 1
    return (
      <main className="handoff-screen">
        <div className="handoff-card revealable" onClick={onRevealUndo}>
          <span className="eyebrow">{redidAll ? 'Redo handoff' : 'Undo handoff'}</span>
          <h1>{target === 'Investigators' ? 'Investigators’ Turn' : `Pass the device to ${target}`}</h1>
          <p>
            {redidAll
              ? 'All remaining actions have been restored. The resulting private view is ready.'
              : 'The previous player’s view has been restored just before their last confirmed action.'}
          </p>
          <button
            className="reveal-button"
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onRevealUndo()
            }}
          >
            I am the {target} player — reveal the {redidAll ? 'updated' : 'restored'} view
          </button>
          <div onClick={(event) => event.stopPropagation()}>
            <HistoryControls
              history={history}
              onUndo={onUndo}
              onBigUndo={onBigUndo}
              onRedo={onRedo}
              onRedoAll={onRedoAll}
              onRand={onRevealUndo}
              onRandSide={onRevealUndo}
            />
          </div>
        </div>
      </main>
    )
  }
  const target =
    state.stage === 'handoffInspectorsSetup' || state.stage === 'handoffInspectorsTurn' ? 'Investigators' : 'Jack'
  const detail =
    state.stage === 'handoffInspectorsSetup'
      ? 'Jack’s four locations are locked and hidden.'
      : state.stage === 'handoffJackStart'
        ? 'Investigator deployment is complete.'
        : state.stage === 'handoffInspectorsTurn'
          ? 'Jack’s secret move has been recorded.'
          : 'The Investigator turn is complete.'
  return (
    <main className="handoff-screen">
      <div className="handoff-card revealable" onClick={() => dispatch({ type: 'continueHandoff' })}>
        <span className="eyebrow">Hot-seat handoff</span>
        <h1>{target === 'Investigators' ? 'Investigators’ Turn' : `Pass the device to ${target}`}</h1>
        <p>{detail} Private information is not shown on this screen.</p>
        <button
          className="reveal-button"
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            dispatch({ type: 'continueHandoff' })
          }}
        >
          I am the {target} player — reveal my view
        </button>
        <div onClick={(event) => event.stopPropagation()}>
          <HistoryControls
            history={history}
            onUndo={onUndo}
            onBigUndo={onBigUndo}
            onRedo={onRedo}
            onRedoAll={onRedoAll}
            onRand={onRand}
            onRandSide={onRandSide}
          />
        </div>
      </div>
    </main>
  )
}

function App() {
  const [history, historyDispatch] = useReducer(gameHistoryReducer, undefined, initializeHistory)
  const state = currentHistoryState(history)
  const [showPossible, setShowPossible] = useState(() => {
    const storage = browserStorage()
    return storage ? loadBooleanPreference(storage, POSSIBLE_LOCATIONS_STORAGE_KEY) : false
  })
  const [showJackPeek, setShowJackPeek] = useState(() => {
    const storage = browserStorage()
    return storage ? loadBooleanPreference(storage, JACK_PEEK_STORAGE_KEY) : false
  })
  const [showCrossingIds, setShowCrossingIds] = useState(() => {
    const storage = browserStorage()
    return storage ? loadBooleanPreference(storage, CROSSING_IDS_STORAGE_KEY) : false
  })
  const [showPastPath, setShowPastPath] = useState(() => {
    const storage = browserStorage()
    return storage ? loadBooleanPreference(storage, PAST_PATH_STORAGE_KEY) : false
  })
  const [showInvestigatorMaybes, setShowInvestigatorMaybes] = useState(() => {
    const storage = browserStorage()
    return storage ? loadBooleanPreference(storage, INVESTIGATOR_MAYBES_STORAGE_KEY) : false
  })
  const [showInvestigatorKnowledge, setShowInvestigatorKnowledge] = useState(() => {
    const storage = browserStorage()
    return storage ? loadBooleanPreference(storage, INVESTIGATOR_KNOW_STORAGE_KEY) : false
  })
  const [showInvestigatorTurnAnnouncement, setShowInvestigatorTurnAnnouncement] = useState(false)
  const [investigatorAuto, setInvestigatorAuto] = useState(() => {
    const storage = browserStorage()
    return storage ? loadBooleanPreference(storage, INVESTIGATOR_AUTO_STORAGE_KEY) : false
  })
  const automaticInvestigatorActions = (initial: GameHistory) => {
    const commands: Parameters<typeof gameHistoryReducer>[1][] = []
    let next = initial
    while (commands.length < 12) {
      const nextState = currentHistoryState(next)
      if (nextState.stage !== 'investigatorAction' || nextState.inspectorActionMode !== 'search') break
      const adjacent = legalInspectorActionCircles(nextState)
      const outcomes = possibleJackSearchOutcomes(nextState.publicRound)
      const possibleAdjacent = adjacent.filter(
        (id) => !nextState.checkedThisAction.includes(id) && outcomes.has(id),
      )
      let actions: GameAction[] = []
      if (nextState.checkedThisAction.length > 0) {
        if (possibleAdjacent.length === 0) actions = [{ type: 'passInspectorAction' }]
        else if (possibleAdjacent.length === 1) {
          actions = [{ type: 'searchCircle', circleId: possibleAdjacent[0]! }]
        }
      } else if (possibleAdjacent.length === 0) {
        actions = [{ type: 'passInspectorAction' }]
      } else if (
        possibleAdjacent.length === 1 &&
        outcomes.get(possibleAdjacent[0]!)?.positiveMeansJackIsThereNow
      ) {
        actions = [
          { type: 'setInspectorActionMode', mode: 'arrest' },
          { type: 'arrestCircle', circleId: possibleAdjacent[0]! },
        ]
      }
      if (actions.length === 0) break
      for (const action of actions) {
        const command = { type: 'apply' as const, action }
        const advanced = gameHistoryReducer(next, command)
        if (advanced === next) return { next, commands }
        next = advanced
        commands.push(command)
      }
    }
    return { next, commands }
  }
  const applyHistoryCommands = (
    commands: Parameters<typeof gameHistoryReducer>[1][],
    runInvestigatorAuto = false,
  ) => {
    let next = history
    for (const command of commands) {
      next = gameHistoryReducer(next, command)
      historyDispatch(command)
    }
    if (runInvestigatorAuto) {
      const automatic = automaticInvestigatorActions(next)
      next = automatic.next
      for (const command of automatic.commands) historyDispatch(command)
    }
    if (next.pendingReveal === 'investigators') {
      const revealCommand = { type: 'revealUndo' as const }
      next = gameHistoryReducer(next, revealCommand)
      historyDispatch(revealCommand)
      setShowInvestigatorTurnAnnouncement(true)
      window.setTimeout(() => setShowInvestigatorTurnAnnouncement(false), 1000)
    }
    const nextStage = currentHistoryState(next).stage
    if (nextStage === 'handoffInspectorsSetup' || nextStage === 'handoffInspectorsTurn') {
      const continueCommand = { type: 'apply' as const, action: { type: 'continueHandoff' as const } }
      next = gameHistoryReducer(next, continueCommand)
      historyDispatch(continueCommand)
      setShowInvestigatorTurnAnnouncement(true)
      window.setTimeout(() => setShowInvestigatorTurnAnnouncement(false), 1000)
    }
    const storage = browserStorage()
    if (storage) saveStoredHistory(storage, next)
  }
  const applyHistoryCommand = (command: Parameters<typeof gameHistoryReducer>[1]) => {
    applyHistoryCommands([command])
  }
  const dispatch = (action: GameAction) => {
    applyHistoryCommands([{ type: 'apply', action }], investigatorAuto)
  }
  const handleUndo = () => applyHistoryCommand({ type: 'undo' })
  const handleUndoRoute = () => {
    applyHistoryCommands(state.jackMoveSelection.path.map(() => ({ type: 'undo' as const })))
  }
  const handleBigUndo = () => applyHistoryCommand({ type: 'bigUndo' })
  const handleRedo = () => applyHistoryCommand({ type: 'redo' })
  const handleRedoAll = () => applyHistoryCommand({ type: 'redoAll' })
  const handleRand = () => {
    const actions = randomProgressActions(state)
    if (actions.length > 0) applyHistoryCommands(actions.map((action) => ({ type: 'apply' as const, action })))
  }
  const handleRandSide = () => {
    const startingStage = state.stage
    const side =
      startingStage === 'jackDiscoverySetup' ||
      startingStage === 'handoffJackStart' ||
      startingStage === 'jackChooseStart' ||
      startingStage === 'handoffJackTurn' ||
      startingStage === 'jackMove'
        ? 'jack'
        : 'investigators'
    let next = history
    const commands: Parameters<typeof gameHistoryReducer>[1][] = []

    // A side contains only a handful of actions, but cap the loop so malformed
    // or future game states cannot lock up the UI.
    for (let actionCount = 0; actionCount < 100; actionCount += 1) {
      const nextState = currentHistoryState(next)
      if (
        side === 'jack' &&
        (nextState.stage === 'handoffInspectorsSetup' || nextState.stage === 'handoffInspectorsTurn')
      ) break
      if (
        side === 'investigators' &&
        (nextState.stage === 'handoffJackStart' || nextState.stage === 'handoffJackTurn')
      ) break

      const actions = randomProgressActions(nextState)
      if (actions.length === 0) break
      let progressed = false
      for (const action of actions) {
        const command = { type: 'apply' as const, action }
        const advanced = gameHistoryReducer(next, command)
        if (advanced !== next) {
          next = advanced
          commands.push(command)
          progressed = true
        }
      }
      if (!progressed) break
    }

    if (commands.length > 0) applyHistoryCommands(commands)
  }
  const handleRevealUndo = () => applyHistoryCommand({ type: 'revealUndo' })
  if (history.pendingReveal || isHandoff(state.stage)) {
    return (
      <HandoffScreen
        state={state}
        dispatch={dispatch}
        history={history}
        onUndo={handleUndo}
        onBigUndo={handleBigUndo}
        onRedo={handleRedo}
        onRedoAll={handleRedoAll}
        onRand={history.pendingReveal ? handleRevealUndo : handleRand}
        onRandSide={history.pendingReveal ? handleRevealUndo : handleRandSide}
        historyRevealTarget={history.pendingReveal}
        onRevealUndo={handleRevealUndo}
      />
    )
  }

  const legalCircleIds = new Set<number>()
  const coachReachableCircleIds = new Set<number>()
  const legalCrossingIds = new Set<string>()
  if (state.stage === 'jackDiscoverySetup') {
    const selectedQuadrants = new Set(state.discoveryLocations.map((id) => circlesById.get(id)?.quadrant))
    for (const circle of circles) {
      if (circle.color === 'white' && !selectedQuadrants.has(circle.quadrant)) legalCircleIds.add(circle.id)
    }
  } else if (state.stage === 'jackChooseStart') {
    for (const id of state.discoveryLocations) legalCircleIds.add(id)
  } else if (state.stage === 'jackMove') {
    for (const id of legalJackDestinations(state)) legalCircleIds.add(id)
    for (const id of coachReachableJackDestinations(state)) coachReachableCircleIds.add(id)
  } else if (state.stage === 'investigatorSetup') {
    for (const id of deploymentChoices(state)) legalCrossingIds.add(id)
  } else if (state.stage === 'investigatorMove') {
    for (const id of legalInvestigatorDestinations(state)) legalCrossingIds.add(id)
  } else if (state.stage === 'investigatorAction' && state.inspectorActionMode !== 'choose') {
    for (const id of legalInspectorActionCircles(state)) {
      if (state.inspectorActionMode !== 'search' || !state.checkedThisAction.includes(id)) legalCircleIds.add(id)
    }
  }

  let possibleOutcomes = new Map<number, SearchOutcome>()
  if (showPossible && isInspectorInteraction(state.stage)) {
    possibleOutcomes = possibleJackSearchOutcomes(state.publicRound)
  } else if (showInvestigatorKnowledge && state.stage === 'jackMove') {
    const { yellow, blue, red } = state.investigatorPositions
    if (yellow && blue && red) {
      possibleOutcomes = possibleJackSearchOutcomesAfterMove(
        state.publicRound,
        state.jackMoveSelection.type,
        { yellow, blue, red },
        state.moveSlot,
      )
    }
  }
  const possibleIds = new Set<number>()
  for (const outcome of possibleOutcomes.values()) {
    for (const id of outcome.ifYes) possibleIds.add(id)
  }
  const showPossibilityMarkers =
    (showPossible && isInspectorInteraction(state.stage)) ||
    (showInvestigatorKnowledge && state.stage === 'jackMove')
  const handleCircle = (circleId: number) => {
    if (state.stage === 'jackDiscoverySetup') dispatch({ type: 'toggleDiscovery', circleId })
    else if (state.stage === 'jackChooseStart') dispatch({ type: 'chooseJackStart', circleId })
    else if (state.stage === 'jackMove') dispatch({ type: 'selectJackDestination', circleId })
    else if (state.stage === 'investigatorAction' && state.inspectorActionMode === 'search') {
      dispatch({ type: 'searchCircle', circleId })
    } else if (state.stage === 'investigatorAction' && state.inspectorActionMode === 'arrest') {
      dispatch({ type: 'arrestCircle', circleId })
    }
  }
  const handleCircleMiddleClick = (circleId: number) => {
    if (state.stage === 'jackMove') {
      const select = { type: 'selectJackDestination' as const, circleId }
      const afterSelection = gameReducer(state, select)
      const commands: Parameters<typeof gameHistoryReducer>[1][] = [{ type: 'apply', action: select }]
      if (jackMoveReadyToConfirm(afterSelection)) {
        commands.push({ type: 'apply', action: { type: 'confirmJackMove' } })
      }
      applyHistoryCommands(commands)
    } else if (
      state.stage === 'investigatorAction' &&
      (state.inspectorActionMode === 'search' || state.inspectorActionMode === 'arrest') &&
      state.checkedThisAction.length === 0
    ) {
      const commands: Parameters<typeof gameHistoryReducer>[1][] = []
      if (state.inspectorActionMode !== 'arrest') {
        commands.push({ type: 'apply', action: { type: 'setInspectorActionMode', mode: 'arrest' } })
      }
      commands.push({ type: 'apply', action: { type: 'arrestCircle', circleId } })
      applyHistoryCommands(commands, investigatorAuto)
    }
  }
  const handleCrossing = (crossingId: string) => {
    if (state.stage === 'investigatorSetup') dispatch({ type: 'placeInvestigator', crossingId })
    else if (state.stage === 'investigatorMove') dispatch({ type: 'moveInvestigator', crossingId })
  }

  return (
    <div
      className="app-shell"
      onClick={() => {
        if (showInvestigatorTurnAnnouncement) setShowInvestigatorTurnAnnouncement(false)
      }}
    >
      <header className="app-header">
        <div>
          <span className="brand-kicker">A hidden movement game</span>
          <h1>Whitehall Mystery</h1>
        </div>
        <div className="header-actions">
          <a
            href={`${import.meta.env.BASE_URL}whitehall_mystery_rulebook_small_copy.pdf`}
            target="_blank"
            rel="noreferrer"
          >
            Rulebook
          </a>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              if (state.stage === 'jackDiscoverySetup' || window.confirm('Start a new game and lose the current progress?')) {
                dispatch({ type: 'newGame' })
              }
            }}
          >
            New game
          </button>
        </div>
      </header>

      <MoveTrack state={state} showJackPeek={showJackPeek} />

      <main className="game-layout">
        <section className="board-panel">
          <div className="board-toolbar">
            <div className="board-options">
              <HistoryControls
                history={history}
                onUndo={handleUndo}
                onBigUndo={handleBigUndo}
                onRedo={handleRedo}
                onRedoAll={handleRedoAll}
                onRand={handleRand}
                onRandSide={handleRandSide}
              />
              <label className="crossing-toggle">
                <input
                  type="checkbox"
                  checked={showCrossingIds}
                  onChange={(event) => {
                    const checked = event.target.checked
                    setShowCrossingIds(checked)
                    const storage = browserStorage()
                    if (storage) saveBooleanPreference(storage, CROSSING_IDS_STORAGE_KEY, checked)
                  }}
                />
                crossing ids
              </label>
              {isPrivateJackView(state.stage) && (
                <label className="past-path-toggle">
                  <input
                    type="checkbox"
                    checked={showPastPath}
                    onChange={(event) => {
                      const checked = event.target.checked
                      setShowPastPath(checked)
                      const storage = browserStorage()
                      if (storage) saveBooleanPreference(storage, PAST_PATH_STORAGE_KEY, checked)
                    }}
                  />
                  past path
                </label>
              )}
              {isPrivateJackView(state.stage) && (
                <label className="investigator-maybes-toggle">
                  <input
                    type="checkbox"
                    checked={showInvestigatorMaybes}
                    onChange={(event) => {
                      const checked = event.target.checked
                      setShowInvestigatorMaybes(checked)
                      const storage = browserStorage()
                      if (storage) saveBooleanPreference(storage, INVESTIGATOR_MAYBES_STORAGE_KEY, checked)
                    }}
                  />
                  inv future
                </label>
              )}
              {state.stage === 'jackMove' && (
                <label className="investigator-knowledge-toggle">
                  <input
                    type="checkbox"
                    checked={showInvestigatorKnowledge}
                    onChange={(event) => {
                      const checked = event.target.checked
                      setShowInvestigatorKnowledge(checked)
                      const storage = browserStorage()
                      if (storage) saveBooleanPreference(storage, INVESTIGATOR_KNOW_STORAGE_KEY, checked)
                    }}
                  />
                  inv know
                  {showInvestigatorKnowledge && <strong>{possibleIds.size}</strong>}
                </label>
              )}
              {isInspectorInteraction(state.stage) && state.publicRound && (
                <label className="possibility-toggle">
                  <input
                    type="checkbox"
                    checked={showPossible}
                    onChange={(event) => {
                      const checked = event.target.checked
                      setShowPossible(checked)
                      const storage = browserStorage()
                      if (storage) saveBooleanPreference(storage, POSSIBLE_LOCATIONS_STORAGE_KEY, checked)
                    }}
                  />
                  Jack maybes
                  {showPossible && <strong>{possibleIds.size}</strong>}
                </label>
              )}
              {isInspectorInteraction(state.stage) && (
                <label className="jack-peek-toggle">
                  <input
                    type="checkbox"
                    checked={showJackPeek}
                    onChange={(event) => {
                      const checked = event.target.checked
                      setShowJackPeek(checked)
                      const storage = browserStorage()
                      if (storage) saveBooleanPreference(storage, JACK_PEEK_STORAGE_KEY, checked)
                    }}
                  />
                  Jack peek
                </label>
              )}
            </div>
          </div>
          <div className="board-stage">
            <div
              className={
                isInspectorInteraction(state.stage)
                  ? `board-scroll active-investigator-${activeInvestigatorColor(state)}`
                  : 'board-scroll'
              }
            >
              <GameBoard
                state={state}
                legalCircleIds={legalCircleIds}
                coachReachableCircleIds={coachReachableCircleIds}
                legalCrossingIds={legalCrossingIds}
                possibleIds={possibleIds}
                possibleOutcomes={possibleOutcomes}
                showPossible={showPossibilityMarkers}
                showCrossingIds={showCrossingIds}
                showPastPath={showPastPath}
                showInvestigatorMaybes={showInvestigatorMaybes}
                showInvestigatorKnowledge={showInvestigatorKnowledge && state.stage === 'jackMove'}
                showJackPeek={showJackPeek}
                onCircle={handleCircle}
                onCircleMiddleClick={handleCircleMiddleClick}
                onCrossing={handleCrossing}
                onMapClick={() => {
                  if (state.stage === 'investigatorTurnResult' || state.stage === 'investigatorSetupResult') {
                    dispatch({ type: 'continueHandoff' })
                  }
                }}
              />
            </div>
            {showInvestigatorTurnAnnouncement && (
              <div className="investigator-turn-announcement" role="status" aria-live="assertive">
                Investigators’ Turn
              </div>
            )}
            {(state.stage === 'investigatorTurnResult' || state.stage === 'investigatorSetupResult') && (
              <div className="map-continue-prompt">Results shown · Click anywhere on the map to continue</div>
            )}
          </div>
          <div className="board-legend" aria-label="Board marker legend">
            <span>
              <i className="legend-dot discovery" /> Discovery
            </span>
            <span>
              <i className="legend-dot clue" /> Clue
            </span>
            <span>
              <i className="legend-dot possible" /> Possible Jack location
            </span>
            <span>
              <i className="legend-dot new-possible" /> New possible Jack location
            </span>
            <span>
              <i className="legend-dot legal" /> Legal target
            </span>
            {isPrivateJackView(state.stage) && (
              <span>
                <i className="legend-dot coach-reachable" /> Reachable via Coach
              </span>
            )}
            {(isPrivateJackView(state.stage) || (showJackPeek && isInspectorInteraction(state.stage))) &&
              state.discoveryLocations.length > 0 && (
              <span>
                <i className="legend-dot private-discovery" /> Unreached discovery
              </span>
            )}
          </div>
        </section>

        <aside className="control-panel">
          <div className="control-panel-heading">
            <span className="eyebrow">
              Round {state.round} · Move {state.moveSlot}
            </span>
            {isInspectorInteraction(state.stage) && (
              <label className="investigator-auto-toggle">
                <input
                  type="checkbox"
                  checked={investigatorAuto}
                  onChange={(event) => {
                    const checked = event.target.checked
                    setInvestigatorAuto(checked)
                    const storage = browserStorage()
                    if (storage) saveBooleanPreference(storage, INVESTIGATOR_AUTO_STORAGE_KEY, checked)
                    if (checked) applyHistoryCommands([], true)
                  }}
                />
                inv auto
              </label>
            )}
          </div>
          <h2>{titleForStage(state)}</h2>
          <div className="notice" role="status">
            {state.notice}
          </div>
          <DiscoveryChecklist state={state} />
          <GameControls
            state={state}
            dispatch={dispatch}
            onUndoRoute={handleUndoRoute}
            onUndoSecondLocation={handleUndo}
          />

          <details className="public-log" open>
            <summary>Public hunt log</summary>
            <ol>
              {state.publicLog.slice(-8).map((entry, index) => (
                <li key={`${index}-${entry}`}>{entry}</li>
              ))}
            </ol>
          </details>
        </aside>
      </main>
    </div>
  )
}

export default App
