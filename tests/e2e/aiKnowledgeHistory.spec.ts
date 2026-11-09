import { expect, test, type Page } from '@playwright/test'
import { createInitialGame } from '../../src/game/gameEngine'
import { aiHistoryReducer } from '../../src/game/aiSession'
import { createGameHistory, currentHistoryState, gameHistoryReducer, type GameHistory } from '../../src/game/history'
import { possibleJackSearchOutcomes, possibleJackSearchOutcomesAfterMove, publicMovementPaths, worstCaseCrossingEliminations } from '../../src/game/inference'
import { adjacentCirclesForCrossing, circles, reachableCrossings } from '../../src/game/mapData'
import { normalizeRemoteHistory } from '../../src/game/remoteHistory'
import type { GameAction, PublicMoveEvidence } from '../../src/game/types'

function investigatorTurn(): GameHistory {
  // Record legal moves, an informative negative search, and a missed arrest.
  // The redo tail lets Jack review each public observation without rerunning AI.
  const positions = { yellow: 'DG', blue: 'DT', red: 'CG' }
  const moves: PublicMoveEvidence[] = [1, 2, 3].map(slot => ({
    type: 'normal', startSlot: slot, endSlot: slot, investigatorPositions: positions,
  }))
  const trail = [33]
  for (const move of moves) trail.push(publicMovementPaths(trail.at(-1)!, move)[0]![0]!)
  let history = createGameHistory({ ...createInitialGame(), stage: 'investigatorMove', moveSlot: 3,
    currentJack: trail.at(-1)!, roundTrail: trail, investigatorPositions: positions,
    discoveryLocations: [33, 46, 147, 159], reachedDiscoveries: [33],
    publicRound: { start: 33, moves, observations: [] },
  })
  const outcomes = possibleJackSearchOutcomes(currentHistoryState(history).publicRound)
  const possible = new Set([...outcomes.values()].flatMap(outcome => [...outcome.ifYes]))
  const yellow = [...reachableCrossings(positions.yellow, 2)].filter(id => ![positions.blue, positions.red].includes(id))
    .flatMap(crossing => adjacentCirclesForCrossing(crossing).map(circleId => ({ crossing, circleId })))
    .find(({ circleId }) => !trail.includes(circleId) && outcomes.get(circleId)?.ifNo.size &&
      outcomes.get(circleId)!.ifNo.size < possible.size)!
  expect(yellow).toBeDefined()
  const remaining = outcomes.get(yellow.circleId)!.ifNo
  const blue = [...reachableCrossings(positions.blue, 2)].filter(id => ![yellow.crossing, positions.red].includes(id))
    .flatMap(crossing => adjacentCirclesForCrossing(crossing).map(circleId => ({ crossing, circleId })))
    .find(({ circleId }) => remaining.has(circleId) && circleId !== trail.at(-1))!
  expect(blue).toBeDefined()
  const apply = (action: GameAction) => {
    const next = gameHistoryReducer(history, { type: 'apply', action })
    expect(next).not.toBe(history)
    history = next
  }
  for (const crossingId of [yellow.crossing, blue.crossing, positions.red]) apply({ type: 'moveInvestigator', crossingId })
  apply({ type: 'searchCircle', circleId: yellow.circleId })
  if (currentHistoryState(history).activeInvestigator === 0) apply({ type: 'passInspectorAction' })
  apply({ type: 'setInspectorActionMode', mode: 'arrest' })
  apply({ type: 'arrestCircle', circleId: blue.circleId })
  apply({ type: 'passInspectorAction' })
  return normalizeRemoteHistory(history)
}

async function expectKnowledge(page: Page, history: GameHistory, sprint: boolean) {
  const state = currentHistoryState(history)
  const outcomes = state.stage === 'jackMove'
    ? possibleJackSearchOutcomesAfterMove(state.publicRound, state.jackMoveSelection.type,
      state.investigatorPositions as PublicMoveEvidence['investigatorPositions'], state.moveSlot, sprint)
    : possibleJackSearchOutcomes(state.publicRound, undefined, sprint)
  const ids = new Set([...outcomes.values()].flatMap(outcome => [...outcome.ifYes]))
  await page.mouse.move(0, 0)
  await expect.poll(() => page.locator('.possible-marker').evaluateAll(elements => elements.map(element =>
    `${element.getAttribute('cx')},${element.getAttribute('cy')}`).sort())).toEqual(
    circles.filter(circle => ids.has(circle.id)).map(circle => `${circle.x},${circle.y}`).sort())
  await expect(page.locator('.investigator-knowledge-toggle strong')).toHaveText(String(ids.size))
  await expect(page.locator('.jack-marker')).toHaveCount(1)
  const round = state.publicRound!
  const worstEvidence = state.stage === 'jackMove' ? { ...round, moves: [...round.moves, {
    type: state.jackMoveSelection.type, startSlot: state.moveSlot + 1,
    endSlot: state.moveSlot + (state.jackMoveSelection.type === 'coach' ? 2 : 1),
    investigatorPositions: state.investigatorPositions as PublicMoveEvidence['investigatorPositions'],
  }] } : round
  await expect.poll(() => page.locator('.crossing-worst-count').allTextContents()).toEqual(
    [...worstCaseCrossingEliminations(worstEvidence, undefined, sprint).values()].filter(count => count > 0).map(String))
}

for (const sprint of [false, true]) {
  test(`Jack maybes follows each AI investigator undo/redo step with sprint ${sprint}`, async ({ page }) => {
    let history = investigatorTurn()
    await page.addInitScript(({ history, sprint }) => {
      const id = 'ai-knowledge-history'
      if (localStorage.getItem(`whitehall-mystery.saved-game.v1.${id}`)) return
      localStorage.setItem('whitehall-mystery.saved-games-migrated.v1', 'true')
      localStorage.setItem('whitehall-mystery.active-game.v1', id)
      localStorage.setItem(`whitehall-mystery.saved-game.v1.${id}`, JSON.stringify({
        id, mode: 'versus-ai', role: 'jack', history, startedAt: Date.now(), savedAt: Date.now(),
      }))
      localStorage.setItem('whitehall-mystery.show-investigator-knowledge', 'true')
      localStorage.setItem('whitehall-mystery.show-possible-locations', 'false')
      localStorage.setItem('whitehall-mystery.show-next-turn', 'true')
      localStorage.setItem('whitehall-mystery.show-worst-crossings', 'true')
      localStorage.setItem('whitehall-mystery.sprint', String(sprint))
    }, { history, sprint })
    await page.goto('/')
    await expectKnowledge(page, history, sprint)
    while (history.cursor > 0) {
      history = aiHistoryReducer(history, { type: 'undo' }, 'jack')
      await page.getByRole('button', { name: 'Undo', exact: true }).click()
      await expectKnowledge(page, history, sprint)
    }
    await page.reload()
    await expectKnowledge(page, history, sprint)
    while (history.cursor < history.entries.length - 1) {
      history = aiHistoryReducer(history, { type: 'redo' }, 'jack')
      await page.getByRole('button', { name: 'Redo', exact: true }).click()
      await expectKnowledge(page, history, sprint)
    }
  })
}
