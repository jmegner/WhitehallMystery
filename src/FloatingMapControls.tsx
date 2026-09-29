import type { RefObject } from 'react'
import { createPortal } from 'react-dom'
import { jackMoveReadyToConfirm, legalJackDestinations } from './game/gameEngine'
import { movementLabel } from './game/inference'
import type { GameAction, GameState, JackMoveType } from './game/types'
import { useMapViewport } from './useMapViewport'

const MOVE_TYPES: JackMoveType[] = ['normal', 'coach', 'alley', 'boat']

interface Props {
  board: RefObject<HTMLDivElement | null>
  state: GameState
  dispatch: (action: GameAction) => void
  waiting: boolean
  endTurnLabel?: string
}

export default function FloatingMapControls({ board, state, dispatch, waiting, endTurnLabel }: Props) {
  const viewport = useMapViewport(board)
  if (waiting) return null
  let controls
  if (endTurnLabel) {
    controls = <button type="button" className="primary-button" onClick={() => dispatch({ type: 'continueHandoff' })}>{endTurnLabel}</button>
  } else if (state.stage === 'jackDiscoverySetup') {
    controls = <button type="button" className="primary-button" disabled={state.discoveryLocations.length !== 4}
      onClick={() => dispatch({ type: 'confirmDiscoveries' })}>Submit discoveries</button>
  } else if (state.stage === 'jackMove') {
    // Start from an empty draft, including when halfway through a Coach route.
    // A remaining tile is insufficient: there must be a legal destination too.
    const types = MOVE_TYPES.filter(type => legalJackDestinations({ ...state, jackMoveSelection: { type, path: [] } }).length > 0)
    const current = state.jackMoveSelection.type
    const next = types[(types.indexOf(current) + 1) % types.length]
    controls = <>
      {types.length > 1 && next && <button type="button" className="secondary-button"
        aria-label={`Cycle move type: ${movementLabel(current)}`}
        title={`Change to ${movementLabel(next)}`}
        onClick={() => dispatch({ type: 'setJackMoveType', moveType: next })}>
        {movementLabel(current)} <span aria-hidden="true">↻</span>
      </button>}
      <button type="button" className="primary-button" disabled={!jackMoveReadyToConfirm(state)}
        onClick={() => dispatch({ type: 'confirmJackMove' })}>Submit move</button>
    </>
  } else if (state.stage === 'investigatorAction') {
    const mode = state.inspectorActionMode === 'arrest' ? 'Arrest' : 'Search'
    controls = <>
      {state.checkedThisAction.length === 0 && <button type="button" className={mode === 'Arrest' ? 'danger-button' : 'secondary-button'}
        aria-label={`Toggle search/arrest: ${mode}`}
        title={`Change to ${mode === 'Search' ? 'Arrest' : 'Search'}`}
        onClick={() => dispatch({ type: 'setInspectorActionMode', mode: mode === 'Search' ? 'arrest' : 'search' })}>
        {mode} <span aria-hidden="true">↔</span>
      </button>}
      <button type="button" className="secondary-button"
        title={state.checkedThisAction.length ? 'End this investigator’s search' : 'Pass this investigator’s action'}
        onClick={() => dispatch({ type: 'passInspectorAction' })}>Pass</button>
    </>
  } else return null

  // The CSS breakpoint matches the control panel's single-column layout. This
  // fallback stays anchored to the map; viewport-filling maps use the portal.
  if (!viewport) return <div className="floating-map-controls map-top-controls" role="group" aria-label="Floating map controls">
    {controls}
  </div>
  return createPortal(<div className="floating-map-controls" role="group" aria-label="Floating map controls"
    style={{ left: viewport.left, top: viewport.bottom, maxWidth: viewport.width,
      transform: `translate(-50%, -100%) scale(${1 / viewport.scale})` }}>
    {controls}
  </div>, document.body)
}
