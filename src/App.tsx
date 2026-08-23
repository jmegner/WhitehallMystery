import { useReducer, useState } from 'react'
import './App.css'
import {
  activeInvestigatorColor,
  createInitialGame,
  deploymentChoices,
  jackMoveReadyToConfirm,
  legalInspectorActionCircles,
  legalInvestigatorDestinations,
  legalJackDestinations,
} from './game/gameEngine'
import { movementLabel, possibleJackLocations } from './game/inference'
import {
  actionCount,
  canRedo,
  createGameHistory,
  currentHistoryState,
  gameHistoryReducer,
  undoMode,
  type GameHistory,
  type PlayerView,
} from './game/history'
import { circles, circlesById, crossings, crossingsById } from './game/mapData'
import {
  CROSSING_IDS_STORAGE_KEY,
  loadBooleanPreference,
  loadStoredHistory,
  saveBooleanPreference,
  saveStoredHistory,
} from './game/persistence'
import {
  INVESTIGATOR_ORDER,
  type GameAction,
  type GameState,
  type JackMoveType,
  type Quadrant,
} from './game/types'

const BOARD_SIZE = 1200
const QUADRANTS: Quadrant[] = ['NW', 'NE', 'SW', 'SE']
const MOVE_TYPES: JackMoveType[] = ['normal', 'coach', 'alley', 'boat']

const isHandoff = (stage: GameState['stage']) =>
  stage === 'handoffInspectorsSetup' ||
  stage === 'handoffJackStart' ||
  stage === 'handoffInspectorsTurn' ||
  stage === 'handoffJackTurn'

const isInspectorInteraction = (stage: GameState['stage']) =>
  stage === 'investigatorSetup' || stage === 'investigatorMove' || stage === 'investigatorAction'

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
  return (storage && loadStoredHistory(storage)) || createGameHistory(createInitialGame())
}

const titleForStage = (state: GameState) => {
  const color = activeInvestigatorColor(state)
  const titles: Record<GameState['stage'], string> = {
    jackDiscoverySetup: 'Jack: Plan the Crime',
    handoffInspectorsSetup: 'Pass to the Investigators',
    investigatorSetup: `Deploy the ${displayColor(color)} Investigator`,
    handoffJackStart: 'Pass Back to Jack',
    jackChooseStart: 'Jack: Choose the Starting Location',
    jackMove: 'Jack: Escape in the Night',
    handoffInspectorsTurn: 'Pass to the Investigators',
    investigatorMove: `${displayColor(color)} Investigator: Move`,
    investigatorAction: `${displayColor(color)} Investigator: Clues and Suspicion`,
    handoffJackTurn: 'Pass to Jack',
    gameOver: state.result?.winner === 'jack' ? 'Jack Escaped' : 'Jack Was Stopped',
  }
  return titles[state.stage]
}

interface BoardProps {
  state: GameState
  legalCircleIds: Set<number>
  legalCrossingIds: Set<string>
  possibleIds: Set<number>
  showPossible: boolean
  showCrossingIds: boolean
  onCircle: (circleId: number) => void
  onCrossing: (crossingId: string) => void
}

function GameBoard({
  state,
  legalCircleIds,
  legalCrossingIds,
  possibleIds,
  showPossible,
  showCrossingIds,
  onCircle,
  onCrossing,
}: BoardProps) {
  const showJack = isPrivateJackView(state.stage) || state.stage === 'gameOver'
  const privateSelections =
    state.stage === 'jackDiscoverySetup' || state.stage === 'jackChooseStart' || state.stage === 'gameOver'
      ? new Set(state.discoveryLocations)
      : new Set<number>()
  const route =
    state.stage === 'jackMove' && state.currentJack !== null
      ? [state.currentJack, ...state.jackMoveSelection.path]
          .map((id) => circlesById.get(id))
          .filter((circle) => circle !== undefined)
      : []
  const boardImage = `${import.meta.env.BASE_URL}map_pptx_simplified.jpg`

  return (
    <svg
      className="game-board"
      viewBox={`0 0 ${BOARD_SIZE} ${BOARD_SIZE}`}
      role="img"
      aria-label="Whitehall game board"
    >
      <image href={boardImage} x="0" y="0" width={BOARD_SIZE} height={BOARD_SIZE} />

      {showPossible &&
        [...possibleIds].map((id) => {
          const circle = circlesById.get(id)
          return circle ? (
            <circle key={`possible-${id}`} className="possible-marker" cx={circle.x} cy={circle.y} r="21" />
          ) : null
        })}

      {state.clueLocations.map((id) => {
        const circle = circlesById.get(id)
        return circle ? (
          <circle key={`clue-${id}`} className="clue-marker" cx={circle.x} cy={circle.y} r="18" />
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

      {route.length > 1 && (
        <polyline
          className="private-route"
          points={route.map((circle) => `${circle.x},${circle.y}`).join(' ')}
        />
      )}

      {circles.map((circle) => {
        const legal = legalCircleIds.has(circle.id)
        const selected = state.jackMoveSelection.path.includes(circle.id)
        return (
          <g key={`circle-target-${circle.id}`}>
            {legal && <circle className="legal-circle" cx={circle.x} cy={circle.y} r="20" />}
            {selected && <circle className="selected-circle" cx={circle.x} cy={circle.y} r="22" />}
            <circle
              className={legal ? 'map-hit-target selectable' : 'map-hit-target'}
              cx={circle.x}
              cy={circle.y}
              r="18"
              onClick={() => legal && onCircle(circle.id)}
              aria-label={`Location ${circle.id}${legal ? ', selectable' : ''}`}
            >
              <title>Location {circle.id}</title>
            </circle>
          </g>
        )
      })}

      {crossings.map((crossing) => {
        const legal = legalCrossingIds.has(crossing.id)
        return (
          <g key={`crossing-target-${crossing.id}`}>
            {legal && <circle className="legal-crossing" cx={crossing.x} cy={crossing.y} r="14" />}
            <circle
              className={legal ? 'map-hit-target selectable' : 'map-hit-target'}
              cx={crossing.x}
              cy={crossing.y}
              r="12"
              onClick={() => legal && onCrossing(crossing.id)}
              aria-label={`Crossing ${crossing.id}${legal ? ', selectable' : ''}`}
            >
              <title>Crossing {crossing.id}</title>
            </circle>
          </g>
        )
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

      {INVESTIGATOR_ORDER.map((color) => {
        const crossingId = state.investigatorPositions[color]
        const crossing = crossingId ? crossingsById.get(crossingId) : undefined
        const active = isInspectorInteraction(state.stage) && activeInvestigatorColor(state) === color
        return crossing ? (
          <g key={`investigator-${color}`} className={`investigator-piece ${color}`}>
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
            <g className="jack-marker">
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

function MoveTrack({ state }: { state: GameState }) {
  const moves = state.publicRound?.moves ?? []
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
          return (
            <div
              key={slot}
              className={`track-slot ${slot < state.moveSlot ? 'past' : ''} ${slot === state.moveSlot ? 'current' : ''}`}
              aria-label={`Move ${slot}${special ? `, ${movementLabel(special.type)}` : ''}`}
            >
              <span className="track-number">{slot}</span>
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
  onRedo: () => void
}

function HistoryControls({ history, onUndo, onRedo }: HistoryControlsProps) {
  const mode = undoMode(history)
  return (
    <div className="history-controls" aria-label="Action history controls">
      <button type="button" disabled={mode === 'disabled'} onClick={onUndo}>
        {mode === 'cross-view' ? 'Undo!' : 'Undo'}
      </button>
      <button type="button" disabled={!canRedo(history)} onClick={onRedo}>
        Redo
      </button>
      <span className="action-counter" aria-label={`${actionCount(history)} player actions`}>
        Actions {actionCount(history)}
      </span>
    </div>
  )
}

interface ControlsProps {
  state: GameState
  dispatch: (action: GameAction) => void
}

function GameControls({ state, dispatch }: ControlsProps) {
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
            const disabled = remaining === 0 || (type === 'coach' && state.moveSlot > 13)
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
            onClick={() => dispatch({ type: 'clearJackSelection' })}
          >
            Clear route
          </button>
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
            onClick={() => dispatch({ type: 'setInspectorActionMode', mode: 'arrest' })}
          >
            Execute arrest
          </button>
          <button
            type="button"
            className="text-button"
            disabled={state.inspectorActionMode === 'search' && state.checkedThisAction.length > 0}
            onClick={() => dispatch({ type: 'passInspectorAction' })}
          >
            Pass
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
  undoRevealTarget?: PlayerView | null
  onRevealUndo: () => void
}

function HandoffScreen({
  state,
  dispatch,
  history,
  onUndo,
  onRedo,
  undoRevealTarget,
  onRevealUndo,
}: HandoffProps) {
  if (undoRevealTarget) {
    const target = undoRevealTarget === 'jack' ? 'Jack' : 'Investigators'
    return (
      <main className="handoff-screen">
        <div className="handoff-card">
          <span className="eyebrow">Undo handoff</span>
          <h1>Pass the device to {target}</h1>
          <p>The previous player’s view has been restored just before their last confirmed action.</p>
          <button className="reveal-button" type="button" onClick={onRevealUndo}>
            I am the {target} player — reveal the restored view
          </button>
          <HistoryControls history={history} onUndo={onUndo} onRedo={onRedo} />
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
      <div className="handoff-card">
        <span className="eyebrow">Hot-seat handoff</span>
        <h1>Pass the device to {target}</h1>
        <p>{detail} Private information is not shown on this screen.</p>
        <button className="reveal-button" type="button" onClick={() => dispatch({ type: 'continueHandoff' })}>
          I am the {target} player — reveal my view
        </button>
        <HistoryControls history={history} onUndo={onUndo} onRedo={onRedo} />
      </div>
    </main>
  )
}

function App() {
  const [history, historyDispatch] = useReducer(gameHistoryReducer, undefined, initializeHistory)
  const state = currentHistoryState(history)
  const applyHistoryCommand = (command: Parameters<typeof gameHistoryReducer>[1]) => {
    const next = gameHistoryReducer(history, command)
    historyDispatch(command)
    const storage = browserStorage()
    if (storage) saveStoredHistory(storage, next)
  }
  const dispatch = (action: GameAction) => {
    applyHistoryCommand({ type: 'apply', action })
  }
  const handleUndo = () => applyHistoryCommand({ type: 'undo' })
  const handleRedo = () => applyHistoryCommand({ type: 'redo' })
  const handleRevealUndo = () => applyHistoryCommand({ type: 'revealUndo' })
  const [zoom, setZoom] = useState(1)
  const [showPossible, setShowPossible] = useState(false)
  const [showCrossingIds, setShowCrossingIds] = useState(() => {
    const storage = browserStorage()
    return storage ? loadBooleanPreference(storage, CROSSING_IDS_STORAGE_KEY) : false
  })

  if (history.pendingReveal || isHandoff(state.stage)) {
    return (
      <HandoffScreen
        state={state}
        dispatch={dispatch}
        history={history}
        onUndo={handleUndo}
        onRedo={handleRedo}
        undoRevealTarget={history.pendingReveal}
        onRevealUndo={handleRevealUndo}
      />
    )
  }

  const legalCircleIds = new Set<number>()
  const legalCrossingIds = new Set<string>()
  if (state.stage === 'jackDiscoverySetup') {
    for (const circle of circles) if (circle.color === 'white') legalCircleIds.add(circle.id)
  } else if (state.stage === 'jackChooseStart') {
    for (const id of state.discoveryLocations) legalCircleIds.add(id)
  } else if (state.stage === 'jackMove') {
    for (const id of legalJackDestinations(state)) legalCircleIds.add(id)
  } else if (state.stage === 'investigatorSetup') {
    for (const id of deploymentChoices(state)) legalCrossingIds.add(id)
  } else if (state.stage === 'investigatorMove') {
    for (const id of legalInvestigatorDestinations(state)) legalCrossingIds.add(id)
  } else if (state.stage === 'investigatorAction' && state.inspectorActionMode !== 'choose') {
    for (const id of legalInspectorActionCircles(state)) {
      if (state.inspectorActionMode !== 'search' || !state.checkedThisAction.includes(id)) legalCircleIds.add(id)
    }
  }

  const possibleIds =
    showPossible && isInspectorInteraction(state.stage)
      ? possibleJackLocations(state.publicRound)
      : new Set<number>()
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
  const handleCrossing = (crossingId: string) => {
    if (state.stage === 'investigatorSetup') dispatch({ type: 'placeInvestigator', crossingId })
    else if (state.stage === 'investigatorMove') dispatch({ type: 'moveInvestigator', crossingId })
  }

  return (
    <div className="app-shell">
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
                setShowPossible(false)
              }
            }}
          >
            New game
          </button>
        </div>
      </header>

      <MoveTrack state={state} />

      <main className="game-layout">
        <section className="board-panel">
          <div className="board-toolbar">
            <div>
              <button type="button" onClick={() => setZoom(Math.max(0.7, zoom - 0.15))} aria-label="Zoom out">
                −
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => setZoom(Math.min(2, zoom + 0.15))} aria-label="Zoom in">
                +
              </button>
              <button className="zoom-reset-button" type="button" onClick={() => setZoom(1)}>
                Zoom Reset
              </button>
            </div>
            <div className="board-options">
              <HistoryControls history={history} onUndo={handleUndo} onRedo={handleRedo} />
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
                Show crossing IDs
              </label>
              {isInspectorInteraction(state.stage) && state.publicRound && (
                <label className="possibility-toggle">
                  <input
                    type="checkbox"
                    checked={showPossible}
                    onChange={(event) => setShowPossible(event.target.checked)}
                  />
                  Show possible Jack locations
                  {showPossible && <strong>{possibleIds.size}</strong>}
                </label>
              )}
            </div>
          </div>
          <div className="board-scroll">
            <div className="board-zoom" style={{ width: `${zoom * 100}%` }}>
              <GameBoard
                state={state}
                legalCircleIds={legalCircleIds}
                legalCrossingIds={legalCrossingIds}
                possibleIds={possibleIds}
                showPossible={showPossible}
                showCrossingIds={showCrossingIds}
                onCircle={handleCircle}
                onCrossing={handleCrossing}
              />
            </div>
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
              <i className="legend-dot legal" /> Legal target
            </span>
          </div>
        </section>

        <aside className="control-panel">
          <span className="eyebrow">
            Round {state.round} · Move {state.moveSlot}
          </span>
          <h2>{titleForStage(state)}</h2>
          <div className="notice" role="status">
            {state.notice}
          </div>
          <GameControls state={state} dispatch={dispatch} />

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
