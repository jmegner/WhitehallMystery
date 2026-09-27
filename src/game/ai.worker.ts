import { playAiTurn } from './ai'
import type { GameHistory, PlayerView } from './history'
import { currentHistoryState } from './history'
import { aiTurnRandom } from './aiRandom'

self.onmessage = (event: MessageEvent<{ id: string; history: GameHistory; role: PlayerView }>) => {
  try {
    const { id, history, role } = event.data
    self.postMessage({ history: playAiTurn(history, role, aiTurnRandom(id, currentHistoryState(history))) })
  }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'AI turn failed.' }) }
}
