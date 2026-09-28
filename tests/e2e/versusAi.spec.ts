import { expect, test, type Page } from '@playwright/test'
import { createInitialGame, legalNormalDestinations } from '../../src/game/gameEngine'
import { createGameHistory, currentHistoryState, gameHistoryReducer, type GameHistory, type PlayerView } from '../../src/game/history'
import { normalizeRemoteHistory } from '../../src/game/remoteHistory'

async function savedHistory(page: Page): Promise<GameHistory> {
  return page.evaluate(() => JSON.parse(localStorage.getItem(`whitehall-mystery.saved-game.v1.${localStorage.getItem('whitehall-mystery.active-game.v1')}`)!).history)
}

async function restoreGame(page: Page, history: GameHistory, role: PlayerView) {
  await page.addInitScript(({ history, role }) => {
    const id = 'versus-ai-undo'
    if (localStorage.getItem(`whitehall-mystery.saved-game.v1.${id}`)) return
    localStorage.setItem('whitehall-mystery.saved-games-migrated.v1', 'true')
    localStorage.setItem('whitehall-mystery.active-game.v1', id)
    localStorage.setItem(`whitehall-mystery.saved-game.v1.${id}`, JSON.stringify({ id, mode: 'versus-ai', role, history, startedAt: Date.now(), savedAt: Date.now() }))
  }, { history, role })
}

function jackMoveHistory(moveSlot = 0): GameHistory {
  let history = createGameHistory({ ...createInitialGame(), stage: 'jackMove', currentJack: 33, moveSlot,
    discoveryLocations: [33, 46, 147, 159], reachedDiscoveries: [33], roundTrail: [33],
    investigatorPositions: { yellow: 'FP', blue: 'HP', red: 'HZ' },
    publicRound: { start: 33, moves: [], observations: [] },
  })
  history = gameHistoryReducer(history, { type: 'apply', action: { type: 'selectJackDestination', circleId: legalNormalDestinations(currentHistoryState(history))[0]! } })
  return normalizeRemoteHistory(gameHistoryReducer(history, { type: 'apply', action: { type: 'confirmJackMove' } }))
}

async function start(page: Page, role: 'Jack' | 'Investigator') {
  await page.goto('/')
  await page.getByRole('button', { name: 'New game', exact: true }).click()
  await page.getByRole('button', { name: 'Versus AI', exact: true }).click()
  await page.getByRole('button', { name: `Play as ${role}`, exact: true }).click()
}

test('WaitEnd holds Jack setup and middle-clicked moves until confirmation, including after refresh', async ({ page }) => {
  let workers = 0
  page.on('worker', () => { workers += 1 })
  await start(page, 'Jack')
  await expect(page.getByLabel('WaitEnd', { exact: true })).not.toBeChecked()
  await page.getByLabel('WaitEnd', { exact: true }).check()
  for (const id of [33, 46, 147]) await page.getByLabel(`Location ${id}, selectable`, { exact: true }).click()
  await page.getByLabel('Location 159, selectable', { exact: true }).click({ button: 'middle' })
  const endTurn = page.getByRole('button', { name: 'End turn', exact: true })
  await expect(endTurn).toBeVisible()
  expect(currentHistoryState(await savedHistory(page)).stage).toBe('handoffInspectorsSetup')
  expect(workers).toBe(0)
  await page.reload()
  await expect(page.getByLabel('WaitEnd', { exact: true })).toBeChecked()
  await expect(endTurn).toBeVisible()
  expect(workers).toBe(0)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Jack: Plan the Crime', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(endTurn).toBeVisible()
  expect(workers).toBe(0)
  await endTurn.click()
  await expect(page.getByRole('heading', { name: 'Jack: Choose the Starting Location' })).toBeVisible({ timeout: 15000 })
  expect(workers).toBeGreaterThan(0)
  await page.getByLabel('Secret Discovery Locations').getByRole('button', { name: '33', exact: true }).click()
  const destination = await page.getByLabel('Legal Jack destinations').getByRole('button').first().innerText()
  const beforeMove = workers
  await page.getByLabel(`Location ${destination}, selectable`, { exact: true }).click({ button: 'middle' })
  await expect(endTurn).toBeVisible()
  expect(currentHistoryState(await savedHistory(page)).stage).toBe('handoffInspectorsTurn')
  expect(workers).toBe(beforeMove)
  await page.reload()
  await expect(endTurn).toBeVisible()
  expect(workers).toBe(beforeMove)
  await endTurn.click()
  await expect(page.getByRole('heading', { name: /Jack: Escape in the Night|Jack Was Stopped/ })).toBeVisible({ timeout: 15000 })
  expect(workers).toBeGreaterThan(beforeMove)
})

test('WaitEnd holds investigator deployment before AI Jack chooses a start', async ({ page }) => {
  await start(page, 'Investigator')
  await expect(page.getByRole('heading', { name: 'Deploy the Yellow Investigator' })).toBeVisible({ timeout: 15000 })
  await page.getByLabel('WaitEnd', { exact: true }).check()
  for (const crossing of ['FP', 'HP', 'HZ']) await page.getByLabel('Available deployment crossings').getByRole('button', { name: crossing, exact: true }).click()
  const endTurn = page.getByRole('button', { name: 'End turn', exact: true })
  await expect(endTurn).toBeVisible()
  expect(currentHistoryState(await savedHistory(page)).stage).toBe('investigatorSetupResult')
  await expect(page.locator('.jack-marker')).toHaveCount(0)
  await page.reload()
  await expect(endTurn).toBeVisible()
  await endTurn.click()
  await expect(page.getByRole('heading', { name: 'Yellow Investigator: Move', exact: true })).toBeVisible({ timeout: 15000 })
  await expect(page.getByLabel('WaitEnd', { exact: true })).toBeChecked()
})

for (const finish of ['InvAuto', 'Rand Side'] as const) {
  test(`WaitEnd stops ${finish} before the AI and keeps review through undo/redo`, async ({ page }) => {
    const history = jackMoveHistory()
    await restoreGame(page, history, 'investigators')
    // A held worker lets the test observe the exact confirmation boundary.
    await page.route('**/src/game/ai.worker.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'self.onmessage = () => {}' }))
    let workers = 0
    page.on('worker', () => { workers += 1 })
    await page.goto('/')
    await page.getByLabel('WaitEnd', { exact: true }).check()
    const waitBounds = await page.locator('.wait-end-toggle').boundingBox()
    const autoBounds = await page.locator('.investigator-auto-toggle').boundingBox()
    expect(waitBounds!.x + waitBounds!.width).toBeLessThanOrEqual(autoBounds!.x)
    if (finish === 'InvAuto') {
      await page.getByLabel('InvAuto', { exact: true }).check()
      for (const color of ['yellow', 'blue', 'red']) await page.getByLabel(`Legal ${color} Investigator destinations`).getByRole('button').first().click()
    } else {
      await page.getByRole('button', { name: 'Rand Side', exact: true }).click()
    }
    const endTurn = page.getByRole('button', { name: 'End turn', exact: true })
    await expect(endTurn).toBeVisible()
    const review = await savedHistory(page)
    expect(currentHistoryState(review).stage).toBe('investigatorTurnResult')
    expect(workers).toBe(0)
    await page.getByLabel('Whitehall game board').click({ position: { x: 10, y: 10 } })
    await expect(endTurn).toBeVisible()
    await expect(page.getByRole('button', { name: 'Rand', exact: true })).toBeDisabled()
    await expect(page.locator('.jack-marker')).toHaveCount(0)
    await page.reload()
    await expect(page.getByLabel('WaitEnd', { exact: true })).toBeChecked()
    await expect(endTurn).toBeVisible()
    expect(await savedHistory(page)).toEqual(review)
    expect(workers).toBe(0)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Red Investigator: Clues and Suspicion', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await expect(endTurn).toBeVisible()
    expect(await savedHistory(page)).toEqual(review)
    expect(workers).toBe(0)
    if (finish === 'InvAuto') await endTurn.click()
    else await page.getByLabel('WaitEnd', { exact: true }).uncheck()
    await expect(page.getByRole('heading', { name: 'AI turn', exact: true })).toBeVisible()
    await expect.poll(() => workers).toBeGreaterThan(0)
    if (finish === 'Rand Side') {
      await page.reload()
      await expect(page.getByLabel('WaitEnd', { exact: true })).not.toBeChecked()
      await expect(page.getByRole('heading', { name: 'AI turn', exact: true })).toBeVisible()
    }
  })
}

test('plays as Jack through AI deployment and a coordinated investigator turn, then resumes', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await start(page, 'Jack')
  await expect(page.getByLabel('Versus AI game')).toContainText('You are Jack')
  for (const id of [33, 46, 147]) await page.getByLabel(`Location ${id}, selectable`, { exact: true }).click()
  await page.getByLabel('Location 159, selectable', { exact: true }).click({ button: 'middle' })
  await expect(page.getByRole('heading', { name: 'Jack: Choose the Starting Location' })).toBeVisible({ timeout: 20000 })
  await page.getByLabel('Secret Discovery Locations').getByRole('button', { name: '33', exact: true }).click()
  await page.getByLabel('Legal Jack destinations').getByRole('button').first().click()
  await page.getByRole('button', { name: 'Record move privately' }).click()
  await expect(page.getByRole('heading', { name: /Jack: Escape in the Night|Jack Was Stopped/ })).toBeVisible({ timeout: 20000 })
  await expect(page.locator('.public-log')).toContainText(/searched|arrest|passed/)
  const completed = await savedHistory(page)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'AI turn paused', exact: true })).toBeVisible()
  const undone = await savedHistory(page)
  expect(undone.cursor).toBeLessThan(completed.cursor)
  expect(undone.entries).toEqual(completed.entries)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'AI turn paused', exact: true })).toBeVisible()
  expect(await savedHistory(page)).toEqual(undone)
  await page.getByRole('button', { name: 'Redo Side', exact: true }).click()
  expect(await savedHistory(page)).toEqual(completed)
  await page.getByRole('button', { name: 'Undo Side', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Resume AI turn', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Resume AI turn', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Jack: Escape in the Night|Jack Was Stopped/ })).toBeVisible({ timeout: 20000 })
  await expect(page.getByLabel('Versus AI game')).toContainText('You are Jack')
  await expect(page.locator('.public-log')).toContainText(/searched|arrest|passed/)
  await page.getByRole('button', { name: 'Resume game', exact: true }).click()
  await page.getByRole('button', { name: /Versus AI · Jack/ }).click()
  await expect(page.getByLabel('Versus AI game')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('versus-ai-jack.png'), fullPage: true })
  expect(errors).toEqual([])
})

test('plays as investigator without exposing Jack secrets, preserving partial deployment and turns', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await start(page, 'Investigator')
  await expect(page.getByRole('heading', { name: 'Deploy the Yellow Investigator' })).toBeVisible({ timeout: 15000 })
  await expect(page.getByLabel('peek', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Secret Discovery Locations')).toHaveCount(0)
  await page.getByLabel('Available deployment crossings').getByRole('button').first().click()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Deploy the Blue Investigator' })).toBeVisible()
  await page.getByLabel('Available deployment crossings').getByRole('button').first().click()
  await page.getByLabel('Available deployment crossings').getByRole('button').first().click()
  await expect(page.getByRole('heading', { name: 'Yellow Investigator: Move' })).toBeVisible({ timeout: 15000 })
  await expect(page.getByLabel('Action history controls').getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
  await expect(page.locator('.past-path-line')).toHaveCount(0)
  await expect(page.locator('.jack-peek-toggle')).toHaveCount(0)
  await page.getByRole('button', { name: 'Rand Side', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Yellow Investigator: Move|Jack Was Stopped|Jack Escaped/ })).toBeVisible({ timeout: 15000 })
  await page.reload()
  await expect(page.getByLabel('Versus AI game')).toContainText('You are the investigator')
  await expect(page.locator('.public-log')).toContainText(/M2:|arrested Jack/)
  await page.screenshot({ path: test.info().outputPath('versus-ai-investigator.png'), fullPage: true })
  expect(errors).toEqual([])
})

test('investigator AI advances distant pieces toward future actions in the 36 opening', async ({ page }) => {
  const positions = { yellow: 'FP', blue: 'JD', red: 'JH' }
  const history = createGameHistory({ ...createInitialGame(), stage: 'investigatorMove', currentJack: 37,
    moveSlot: 1, discoveryLocations: [36, 46, 147, 159], reachedDiscoveries: [36], roundTrail: [36, 37],
    investigatorPositions: positions,
    publicLog: ['M0: Jack began the hunt at Discovery Location 36.', 'M1: Jack advanced to move 1.'],
    publicRound: { start: 36, observations: [], moves: [
      { type: 'normal', startSlot: 1, endSlot: 1, investigatorPositions: positions },
    ] },
  })
  await restoreGame(page, history, 'jack')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Jack: Escape in the Night', exact: true })).toBeVisible({ timeout: 15000 })
  const completed = await savedHistory(page)
  const moved = currentHistoryState(completed).investigatorPositions
  for (const color of ['yellow', 'blue', 'red'] as const) {
    expect(moved[color]).not.toBe(positions[color])
    await expect(page.locator('.public-log')).toContainText(`${color} moved ${positions[color]}→${moved[color]}.`)
  }
  await expect(page.locator('.public-log')).toContainText(/blue (searched|attempted an arrest)/)
  await page.reload()
  expect(await savedHistory(page)).toEqual(completed)
})

test('Jack AI revisiting revealed discovery 54 keeps Round 2 and its existing move count', async ({ page }) => {
  const positions = { yellow: 'FP', blue: 'HP', red: 'HZ' }
  const history = createGameHistory({ ...createInitialGame(), stage: 'investigatorAction', activeInvestigator: 2,
    inspectorActionMode: 'search',
    round: 2, moveSlot: 2, currentJack: 54, discoveryLocations: [5, 54, 130, 139],
    reachedDiscoveries: [5, 54], roundTrail: [54, 33, 54], investigatorPositions: positions,
    publicLog: ['M4: Jack reached Discovery Location 54.', 'M0: Round 2 begins from 54.',
      'M1: Jack advanced to move 1.', 'M2: Jack advanced to move 2.'],
    publicRound: { start: 54, observations: [], moves: [1, 2].map(slot => ({
      type: 'normal', startSlot: slot, endSlot: slot, investigatorPositions: positions,
    })) },
  })
  await restoreGame(page, history, 'investigators')
  await page.goto('/')
  await page.getByRole('button', { name: 'Pass', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Yellow Investigator: Move', exact: true })).toBeVisible({ timeout: 15000 })
  const completed = await savedHistory(page)
  const state = currentHistoryState(completed)
  expect(state.round).toBe(2)
  expect(state.moveSlot).toBeGreaterThan(2) // Coach can consume two slots.
  expect(state.reachedDiscoveries).toEqual([5, 54])
  expect(state.publicLog.filter(line => line.includes('reached Discovery Location 54'))).toHaveLength(1)
  expect(state.publicLog.filter(line => line.includes('Round 2 begins'))).toHaveLength(1)
  await expect(page.locator('.track-heading strong')).toHaveText(`Round 2 · Move ${state.moveSlot} · vs AI`)
  await page.reload()
  await expect(page.locator('.track-heading strong')).toHaveText(`Round 2 · Move ${state.moveSlot} · vs AI`)
  expect(await savedHistory(page)).toEqual(completed)
})

test('restarts a pending AI turn on reload and does not overwrite another saved game', async ({ page }) => {
  const history = createGameHistory(createInitialGame())
  await page.addInitScript(history => {
    const id = 'versus-ai-recovery'
    localStorage.setItem('whitehall-mystery.saved-games-migrated.v1', 'true')
    localStorage.setItem('whitehall-mystery.active-game.v1', id)
    localStorage.setItem(`whitehall-mystery.saved-game.v1.${id}`, JSON.stringify({ id, mode: 'versus-ai', role: 'investigators', history, startedAt: Date.now(), savedAt: Date.now() }))
  }, history)
  await page.goto('/')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Deploy the Yellow Investigator' })).toBeVisible({ timeout: 15000 })
  await page.getByRole('button', { name: 'New game', exact: true }).click()
  await page.getByRole('button', { name: 'Same device', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Jack: Plan the Crime' })).toBeVisible()
  await page.getByRole('button', { name: 'Resume game', exact: true }).click()
  await page.getByRole('button', { name: /Versus AI · Investigator/ }).click()
  await expect(page.getByRole('heading', { name: 'Deploy the Yellow Investigator' })).toBeVisible()
})

test('a saved AI turn makes the same randomized decision after refresh', async ({ page }) => {
  const history = createGameHistory({ ...createInitialGame(), stage: 'jackMove', currentJack: 1,
    discoveryLocations: [1, 46, 147, 159], reachedDiscoveries: [1], roundTrail: [1],
    investigatorPositions: { yellow: 'FP', blue: 'HP', red: 'HZ' },
    publicRound: { start: 1, moves: [], observations: [] },
  })
  // Every navigation restores the same pending turn, simulating interruption
  // before the worker saved its reply rather than rolling back a human action.
  await page.addInitScript(history => {
    const id = 'versus-ai-repeatable-turn'
    localStorage.setItem('whitehall-mystery.saved-games-migrated.v1', 'true')
    localStorage.setItem('whitehall-mystery.active-game.v1', id)
    localStorage.setItem(`whitehall-mystery.saved-game.v1.${id}`, JSON.stringify({ id, mode: 'versus-ai', role: 'investigators', history, startedAt: Date.now(), savedAt: Date.now() }))
  }, history)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Yellow Investigator: Move' })).toBeVisible({ timeout: 15000 })
  const first = await page.evaluate(() => JSON.parse(localStorage.getItem('whitehall-mystery.saved-game.v1.versus-ai-repeatable-turn')!).history)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Yellow Investigator: Move' })).toBeVisible({ timeout: 15000 })
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('whitehall-mystery.saved-game.v1.versus-ai-repeatable-turn')!).history)
  expect(restored).toEqual(first)
})

for (const role of ['jack', 'investigators'] as const) {
  test(`${role} can undo a finished game, persist the rewind, and redo without confirmation`, async ({ page }) => {
    const history = jackMoveHistory(14)
    expect(currentHistoryState(history).stage).toBe('gameOver')
    await restoreGame(page, history, role)
    const dialogs: string[] = []
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss() })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Jack Was Stopped' })).toBeVisible()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(page.getByRole('heading', { name: role === 'jack' ? 'Jack: Escape in the Night' : 'AI turn paused', exact: true })).toBeVisible()
    const undone = await savedHistory(page)
    expect(undone.cursor).toBe(history.cursor - 1)
    await page.reload()
    await expect(page.getByRole('heading', { name: role === 'jack' ? 'Jack: Escape in the Night' : 'AI turn paused', exact: true })).toBeVisible()
    expect(await savedHistory(page)).toEqual(undone)
    await expect(page.getByText('Revealed action recap', { exact: true })).toHaveCount(0)
    if (role === 'investigators') {
      await expect(page.locator('.past-path-line')).toHaveCount(0)
      await expect(page.getByLabel('Secret Discovery Locations')).toHaveCount(0)
    }
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Jack Was Stopped' })).toBeVisible()
    expect(await savedHistory(page)).toEqual(history)
    await page.getByRole('button', { name: 'Undo Side', exact: true }).click()
    expect((await savedHistory(page)).cursor).toBe(0)
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
    expect(dialogs).toEqual([])
  })
}

test('undo during AI computation cancels the worker and persists the human decision', async ({ page }) => {
  const history = jackMoveHistory()
  await restoreGame(page, history, 'jack')
  // Hold computation pending so cancellation is independent of machine speed.
  await page.route('**/src/game/ai.worker.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'self.onmessage = () => {}' }))
  const workerStarted = page.waitForEvent('worker')
  await page.goto('/')
  const worker = await workerStarted
  await expect(page.getByRole('heading', { name: 'AI turn', exact: true })).toBeVisible()
  const workerClosed = worker.waitForEvent('close')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await workerClosed
  await expect(page.getByRole('heading', { name: 'Jack: Escape in the Night', exact: true })).toBeVisible()
  const undone = await savedHistory(page)
  expect(undone.cursor).toBe(1)
  expect(undone.entries).toEqual(history.entries)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Jack: Escape in the Night', exact: true })).toBeVisible()
  expect(await savedHistory(page)).toEqual(undone)
})
