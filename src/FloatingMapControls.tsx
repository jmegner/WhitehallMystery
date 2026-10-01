import { createPortal } from 'react-dom'
import { activeInvestigatorColor, jackMoveReadyToConfirm, legalJackDestinations } from './game/gameEngine'
import { movementLabel } from './game/inference'
import type { GameAction, GameState, JackMoveType } from './game/types'
import { useBoardPanelViewport } from './useBoardPanelViewport'

const MOVE_TYPES: JackMoveType[] = ['normal', 'coach', 'alley', 'boat']

interface Props {
  panel: HTMLElement | null
  state: GameState
  dispatch: (action: GameAction) => void
  waiting: boolean
  endTurnLabel?: string
}

export default function FloatingMapControls({ panel, state, dispatch, waiting, endTurnLabel }: Props) {
  const viewport = useBoardPanelViewport(panel)
  if (waiting) return null
  const investigator = state.stage === 'investigatorMove' || state.stage === 'investigatorAction'
    ? activeInvestigatorColor(state) : undefined
  let controls
  let pass
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
    controls = state.checkedThisAction.length === 0 ? <button type="button" className={mode === 'Arrest' ? 'danger-button' : 'secondary-button'}
        aria-label={`Toggle search/arrest: ${mode}`}
        title={`Change to ${mode === 'Search' ? 'Arrest' : 'Search'}`}
        onClick={() => dispatch({ type: 'setInspectorActionMode', mode: mode === 'Search' ? 'arrest' : 'search' })}>
        {mode} <span aria-hidden="true">↔</span>
      </button> : null
    pass = <button type="button" className="secondary-button"
      title={state.checkedThisAction.length ? 'End this investigator’s search' : 'Pass this investigator’s action'}
      onClick={() => {
        const next = investigator === 'yellow' ? 'blue' : investigator === 'blue' ? 'red' : 'yellow'
        dispatch({ type: 'passInspectorAction' })
        // Use the next color explicitly: Red ends the phase, but still focuses Yellow.
        // Scroll the circle rather than its SVG group for Firefox compatibility.
        panel?.querySelector(`.investigator-piece.${next} circle`)?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
      }}>Pass</button>
  }

  // The CSS breakpoint matches the control panel's single-column layout. This
  // fallback stays anchored to the map; viewport-filling board panels use the portal.
  if (!viewport) return controls || pass ? <div className="floating-map-controls map-top-controls" data-investigator={investigator}
    role="group" aria-label="Floating map controls">
    {controls}
    {pass}
  </div> : null
  if (!controls && !pass && !viewport.hasActivePiece) return null
  return createPortal(<div className="floating-map-controls" data-investigator={investigator} role="group" aria-label="Floating map controls"
    style={{ left: viewport.left, top: viewport.bottom, width: viewport.width,
      transform: `translate(-50%, -100%) scale(${1 / viewport.scale})` }}>
    {viewport.hasActivePiece && <div className="floating-control-cluster floating-controls-left"><button type="button" className="secondary-button"
      title="Center the view on the active playing piece"
      // Scroll the shape: Firefox scrolls an SVG group to the document origin.
      onClick={() => panel?.querySelector('[data-active-playing-piece] circle')?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })}>
      Focus{investigator ? ` ${investigator[0].toUpperCase()}` : ''}
    </button></div>}
    {controls && <div className="floating-control-cluster floating-controls-center">{controls}</div>}
    {pass && <div className="floating-control-cluster floating-controls-right">{pass}</div>}
  </div>, document.body)
}
