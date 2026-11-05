import { createPortal } from 'react-dom'
import { activeInvestigatorColor, jackMoveReadyToConfirm, legalJackDestinations } from './game/gameEngine'
import { movementLabel } from './game/inference'
import type { GameAction, GameState, JackMoveType } from './game/types'
import { useBoardPanelViewport } from './useBoardPanelViewport'
import { focusBoardPiece } from './focusBoardPiece'
import { floatingTurnSummary } from './floatingTurnSummary'
import type { PlayerView } from './game/history'
import { boardZoomRegion, zoomToBoardRegion } from './boardZoom'
import { rememberBoardViewport, useSavedBoardViewport } from './useSavedBoardViewport'

const MOVE_TYPES: JackMoveType[] = ['normal', 'coach', 'alley', 'boat']

interface Props {
  panel: HTMLElement | null
  gameId: string
  state: GameState
  side: PlayerView
  dispatch: (action: GameAction) => void
  onUndo: () => void
  canUndo: boolean
  waiting: boolean
  endTurnLabel?: string
  canContinueFromMap: boolean
  onTypicalDeployment?: () => void
}

export default function FloatingMapControls({ panel, gameId, state, side, dispatch, onUndo, canUndo, waiting, endTurnLabel, canContinueFromMap, onTypicalDeployment }: Props) {
  const zoomRegion = boardZoomRegion(state)
  const viewport = useBoardPanelViewport(panel, !!zoomRegion)
  useSavedBoardViewport(panel, gameId)
  if (waiting) return null
  const investigator = state.stage === 'investigatorMove' || state.stage === 'investigatorAction'
    ? activeInvestigatorColor(state) : undefined
  let controls
  let rightControls
  const floatingResults = canContinueFromMap && viewport && viewport.scale > 1
  if (floatingResults || endTurnLabel) {
    controls = <button type="button" className="primary-button"
      title="Finish reviewing the results and continue to the next turn"
      onClick={() => dispatch({ type: 'continueHandoff' })}>{floatingResults ? 'End Turn' : endTurnLabel}</button>
  } else if (state.stage === 'jackDiscoverySetup') {
    controls = <button type="button" className="primary-button" disabled={state.discoveryLocations.length !== 4}
      title={state.discoveryLocations.length === 4 ? 'Confirm the four selected discovery locations'
        : `Choose one white location in each quadrant before submitting (${state.discoveryLocations.length}/4 selected)`}
      onClick={() => dispatch({ type: 'confirmDiscoveries' })}>Submit disc. locations</button>
  } else if (state.stage === 'jackMove') {
    if (state.jackMoveSelection.type === 'coach' && state.jackMoveSelection.path.length > 0) {
      rightControls = <button type="button" className="secondary-button" disabled={!canUndo}
        title={`Undo the ${state.jackMoveSelection.path.length === 1 ? 'first' : 'second'} Coach location choice`} onClick={onUndo}>Undo</button>
    }
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
        title="Confirm the selected move" onClick={() => dispatch({ type: 'confirmJackMove' })}>Submit</button>
    </>
  } else if (state.stage === 'investigatorSetup' && onTypicalDeployment) {
    controls = <button type="button" className="primary-button"
      title="Place all three investigators at the AI’s usual starting crossings" onClick={onTypicalDeployment}>Typical</button>
  } else if (state.stage === 'investigatorMove' && (investigator === 'blue' || investigator === 'red')) {
    controls = <button type="button" className="secondary-button" disabled={!canUndo}
      title="Undo the previous investigator’s move" onClick={onUndo}>Undo</button>
  } else if (state.stage === 'investigatorAction') {
    const mode = state.inspectorActionMode === 'arrest' ? 'Arrest' : 'Search'
    controls = state.checkedThisAction.length === 0 ? <button type="button" className={mode === 'Arrest' ? 'danger-button' : 'secondary-button'}
        aria-label={`Toggle search/arrest: ${mode}`}
        title={`Change to ${mode === 'Search' ? 'Arrest' : 'Search'}`}
        onClick={() => dispatch({ type: 'setInspectorActionMode', mode: mode === 'Search' ? 'arrest' : 'search' })}>
        {mode} <span aria-hidden="true">↔</span>
      </button> : null
    rightControls = <button type="button" className="secondary-button"
      title={state.checkedThisAction.length ? 'End this investigator’s search' : 'Pass this investigator’s action'}
      onClick={() => {
        const next = investigator === 'yellow' ? 'blue' : investigator === 'blue' ? 'red' : 'yellow'
        dispatch({ type: 'passInspectorAction' })
        // Use the next color explicitly: Red ends the phase, but still focuses Yellow.
        // Scroll the circle rather than its SVG group for Firefox compatibility.
        panel?.querySelector(`.investigator-piece.${next} circle`)?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
      }}>Pass</button>
  }

  const prompt = canContinueFromMap && !floatingResults
    ? <div className="map-continue-prompt">Results shown · Click anywhere on the map to continue</div> : null
  const summary = floatingTurnSummary(state, side)
  const summaryText = <output className="floating-turn-summary" aria-label="Floating turn summary" title={summary.description}
    style={viewport ? { left: viewport.left, top: viewport.top, transform: `translateX(-50%) scale(${1 / viewport.scale})` } : undefined}>
    {summary.text}
  </output>
  // The CSS breakpoint matches the control panel's single-column layout. This
  // fallback stays anchored to the map; viewport-filling board panels use the portal.
  if (!viewport) return <>{prompt}{(controls || rightControls) && <div className="floating-map-controls map-top-controls" data-investigator={investigator}
    role="group" aria-label="Floating map controls">
    {summaryText}
    {controls}
    {rightControls}
  </div>}</>
  if (!controls && !rightControls && !viewport.hasActivePiece && !viewport.touchOverview) return prompt
  return <>{prompt}{createPortal(<>{summaryText}<div className="floating-map-controls" data-investigator={investigator} role="group" aria-label="Floating map controls"
    style={{ left: viewport.left, top: viewport.bottom, width: viewport.width,
      transform: `translate(-50%, -100%) scale(${1 / viewport.scale})` }}>
    {viewport.touchOverview && zoomRegion ? <div className="floating-control-cluster floating-controls-left"><button type="button" className="secondary-button"
      title="Zoom to the map area relevant to the current phase"
      onPointerDown={event => event.preventDefault()}
      onClick={() => {
        if (panel) void zoomToBoardRegion(panel, zoomRegion).then(() => rememberBoardViewport(gameId))
      }}>Zoom</button></div>
    : viewport.hasActivePiece && <div className="floating-control-cluster floating-controls-left"><button type="button" className="secondary-button"
      title="Center on the active piece while keeping the floating controls visible"
      onClick={() => {
        const piece = panel?.querySelector<SVGElement>('[data-active-playing-piece] circle')
        if (panel && piece) focusBoardPiece(panel, piece)
      }}>
      Focus{investigator ? ` ${investigator[0].toUpperCase()}` : ''}
    </button></div>}
    {controls && <div className="floating-control-cluster floating-controls-center">{controls}</div>}
    {rightControls && <div className="floating-control-cluster floating-controls-right">{rightControls}</div>}
  </div></>, document.body)}</>
}
