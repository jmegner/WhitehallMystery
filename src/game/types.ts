export type CircleColor = 'white' | 'black' | 'blue'

export type Quadrant = 'NW' | 'NE' | 'SW' | 'SE'

export type InvestigatorColor = 'yellow' | 'blue' | 'red'

export const INVESTIGATOR_ORDER: InvestigatorColor[] = ['yellow', 'blue', 'red']

export type JackMoveType = 'normal' | 'coach' | 'alley' | 'boat'

export interface CircleNode {
  id: number
  x: number
  y: number
  color: CircleColor
  quadrant: Quadrant
}

export interface CrossingNode {
  id: string
  x: number
  y: number
  starting: boolean
}

export interface PublicMoveEvidence {
  type: JackMoveType
  startSlot: number
  endSlot: number
  investigatorPositions: Record<InvestigatorColor, string>
}

export type PublicObservation =
  | {
      kind: 'clue'
      circleId: number
      found: boolean
      afterMove: number
      investigator: InvestigatorColor
    }
  | {
      kind: 'arrest'
      circleId: number
      hit: false
      afterMove: number
      investigator: InvestigatorColor
    }

export interface PublicRoundEvidence {
  start: number
  moves: PublicMoveEvidence[]
  observations: PublicObservation[]
}

export type GameStage =
  | 'jackDiscoverySetup'
  | 'handoffInspectorsSetup'
  | 'investigatorSetup'
  | 'handoffJackStart'
  | 'jackChooseStart'
  | 'jackMove'
  | 'handoffInspectorsTurn'
  | 'investigatorMove'
  | 'investigatorAction'
  | 'investigatorTurnResult'
  | 'handoffJackTurn'
  | 'gameOver'

export interface JackMoveSelection {
  type: JackMoveType
  path: number[]
}

export type InspectorActionMode = 'choose' | 'search' | 'arrest'

export interface GameResult {
  winner: 'jack' | 'investigators'
  reason: string
}

export interface GameState {
  stage: GameStage
  round: number
  moveSlot: number
  discoveryLocations: number[]
  reachedDiscoveries: number[]
  currentJack: number | null
  roundTrail: number[]
  investigatorPositions: Partial<Record<InvestigatorColor, string>>
  activeInvestigator: number
  jackMoveSelection: JackMoveSelection
  specialRemaining: Record<Exclude<JackMoveType, 'normal'>, number>
  publicRound: PublicRoundEvidence | null
  clueLocations: number[]
  inspectorActionMode: InspectorActionMode
  checkedThisAction: number[]
  publicLog: string[]
  notice: string
  result: GameResult | null
}

export type GameAction =
  | { type: 'toggleDiscovery'; circleId: number }
  | { type: 'confirmDiscoveries' }
  | { type: 'continueHandoff' }
  | { type: 'placeInvestigator'; crossingId: string }
  | { type: 'chooseJackStart'; circleId: number }
  | { type: 'setJackMoveType'; moveType: JackMoveType }
  | { type: 'selectJackDestination'; circleId: number }
  | { type: 'confirmJackMove' }
  | { type: 'moveInvestigator'; crossingId: string }
  | { type: 'setInspectorActionMode'; mode: Exclude<InspectorActionMode, 'choose'> }
  | { type: 'searchCircle'; circleId: number }
  | { type: 'arrestCircle'; circleId: number }
  | { type: 'passInspectorAction' }
  | { type: 'newGame' }
