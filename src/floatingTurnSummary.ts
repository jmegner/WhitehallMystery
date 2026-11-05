import { nearestUnvisitedDiscoveryStreetDistance } from './game/gameEngine'
import { movementLabel } from './game/inference'
import type { PlayerView } from './game/history'
import type { GameState, JackMoveType } from './game/types'

const MOVE_LETTERS: Record<JackMoveType, string> = { normal: 'S', alley: 'A', boat: 'B', coach: 'C' }

export function floatingTurnSummary(state: GameState, side: PlayerView) {
  const { alley, boat, coach } = state.specialRemaining
  const text = [`R${state.round}`, `M${state.moveSlot}`]
  const details = [`Round ${state.round}, move ${state.moveSlot}.`]
  const lastMove = state.publicRound?.moves.at(-1)
  if (side === 'investigators' && lastMove) {
    text.push(MOVE_LETTERS[lastMove.type])
    details.push(`Jack’s last move: ${movementLabel(lastMove.type)}.`)
  }
  text.push(`${alley}${boat}${coach}`)
  details.push(`Special moves remaining: Alley ${alley}, Boat ${boat}, Coach ${coach}.`)
  if (side === 'jack') {
    const distance = nearestUnvisitedDiscoveryStreetDistance(state)
    if (distance !== undefined) {
      text.push(`D${distance === Infinity ? '∞' : distance}`)
      details.push(distance === Infinity ? 'No unvisited discovery is reachable by Street moves.'
        : `Nearest unvisited discovery: ${distance} Street ${distance === 1 ? 'move' : 'moves'}.`)
      details.push('Investigators block crossings for the next Street move only.')
    }
  }
  return { text: text.join(' '), description: details.join(' ') }
}
