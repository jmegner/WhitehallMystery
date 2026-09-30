import { expect, test, type Page } from '@playwright/test'
import { createInitialGame, legalInspectorActionCircles, legalJackDestinations } from '../../src/game/gameEngine'
import { jackEscapeForecast } from '../../src/game/aiJackLookahead'
import { currentHistoryState, type GameHistory } from '../../src/game/history'
import type { GameState } from '../../src/game/types'

const id = 'floating-map-controls'
const jackState = (): GameState => ({ ...createInitialGame(), stage: 'jackMove', currentJack: 85,
  discoveryLocations: [33, 46, 147, 159], reachedDiscoveries: [33], roundTrail: [33, 85], moveSlot: 1,
  investigatorPositions: { yellow: 'FP', blue: 'HP', red: 'HZ' },
  publicRound: { start: 33, observations: [], moves: [{ type: 'normal', startSlot: 1, endSlot: 1,
    investigatorPositions: { yellow: 'FP', blue: 'HP', red: 'HZ' } }] } })
const investigatorState = (): GameState => ({ ...jackState(), stage: 'investigatorAction',
  inspectorActionMode: 'search', investigatorPositions: { yellow: 'CF', blue: 'DC', red: 'HZ' } })

async function restore(page: Page, state: GameState, options: { mode?: 'same-device' | 'versus-ai'; role?: 'jack' | 'investigators'; waitEnd?: boolean } = {}) {
  await page.addInitScript(({ state, id, options }) => {
    if (localStorage.getItem(`whitehall-mystery.saved-game.v1.${id}`)) return
    localStorage.setItem('whitehall-mystery.saved-games-migrated.v1', 'true')
    localStorage.setItem('whitehall-mystery.active-game.v1', id)
    localStorage.setItem('whitehall-mystery.ai-wait-end', String(options.waitEnd ?? false))
    localStorage.setItem(`whitehall-mystery.saved-game.v1.${id}`, JSON.stringify({ id,
      mode: options.mode ?? 'same-device', role: options.role ?? 'jack',
      history: { entries: [{ state, action: null, counted: false }], cursor: 0, pendingReveal: null },
      startedAt: Date.now(), savedAt: Date.now() }))
  }, { state, id, options })
}
async function saved(page: Page): Promise<GameState> {
  const history: GameHistory = await page.evaluate(id => JSON.parse(localStorage.getItem(`whitehall-mystery.saved-game.v1.${id}`)!).history, id)
  return currentHistoryState(history)
}
async function fillViewport(page: Page) {
  await page.setViewportSize({ width: 1000, height: 600 })
  await page.locator('.board-frame').evaluate(element => {
    const rect = element.getBoundingClientRect()
    window.scrollTo(0, window.scrollY + rect.top + (rect.height - window.innerHeight) / 2)
  })
}
const floating = (page: Page) => page.getByRole('group', { name: 'Floating map controls', exact: true })

async function expectFloatingPositions(page: Page) {
  await expect.poll(() => floating(page).evaluate(element => {
    const viewport = window.visualViewport!
    const groups = [...element.querySelectorAll<HTMLElement>('.floating-control-cluster')]
    const bounds = groups.map(group => group.getBoundingClientRect())
    return groups.every((group, index) => {
      const rect = bounds[index]!
      const offset = group.classList.contains('floating-controls-left') ? rect.left - viewport.offsetLeft - 12 / viewport.scale
        : group.classList.contains('floating-controls-right') ? rect.right - viewport.offsetLeft - viewport.width + 12 / viewport.scale
          : rect.left + rect.width / 2 - viewport.offsetLeft - viewport.width / 2
      return Math.abs(offset * viewport.scale) < 2 &&
        Math.abs((rect.bottom - viewport.offsetTop - viewport.height) * viewport.scale + 12) < 2 &&
        [...group.querySelectorAll('button')].every(button => {
          const buttonRect = button.getBoundingClientRect()
          return buttonRect.left >= rect.left && buttonRect.right <= rect.right &&
            buttonRect.top >= rect.top && buttonRect.bottom <= rect.bottom
        }) && bounds.every((other, otherIndex) => index === otherIndex || rect.right <= other.left || other.right <= rect.left)
    })
  })).toBe(true)
}

for (const width of [320, 390, 1000]) {
  test(`floating buttons have stable left/center/right anchors and investigator colors at ${width}px`, async ({ page }) => {
    await restore(page, investigatorState())
    await page.setViewportSize({ width, height: Math.min(600, Math.floor(width * 0.7)) })
    await page.goto('/')
    await page.locator('.board-frame').evaluate(element => {
      const rect = element.getBoundingClientRect()
      window.scrollTo(0, window.scrollY + rect.top + (rect.height - window.innerHeight) / 2)
    })
    for (const [letter, color] of [['Y', 'rgb(255, 248, 191)'], ['B', 'rgb(227, 237, 247)'], ['R', 'rgb(246, 227, 225)']]) {
      const pass = floating(page).getByRole('button', { name: `Pass ${letter}`, exact: true })
      await expect(pass).toBeVisible()
      await expectFloatingPositions(page)
      expect((await pass.boundingBox())!.height).toBe((await floating(page).getByRole('button', { name: 'Focus', exact: true }).boundingBox())!.height)
      for (const button of await floating(page).getByRole('button').all()) await expect(button).toHaveCSS('background-color', color!)
      if (width === 390) await page.screenshot({ path: test.info().outputPath(`floating-${letter}.png`) })
      await pass.click()
    }
    await expect(floating(page)).toHaveCount(0)
  })
}

for (const side of ['Jack', 'Investigators'] as const) {
  test(`${side} floats when the board panel fills the viewport with its toolbar or legend still visible`, async ({ page }) => {
    await restore(page, side === 'Jack' ? jackState() : investigatorState())
    await page.setViewportSize({ width: 1000, height: 1600 })
    await page.goto('/')
    const map = (await page.locator('.board-frame').boundingBox())!
    const panel = (await page.locator('.board-panel').boundingBox())!
    // Make the viewport taller than the map, but shorter than the whole panel.
    const height = Math.floor((map.height + panel.height) / 2)
    await page.setViewportSize({ width: 1000, height })
    for (const edge of ['top', 'bottom'] as const) {
      await page.locator('.board-panel').evaluate((element, edge) => {
        const rect = element.getBoundingClientRect()
        window.scrollTo(0, window.scrollY + (edge === 'top' ? rect.top + 2 : rect.bottom - window.innerHeight - 2))
      }, edge)
      const bounds = (await page.locator('.board-frame').boundingBox())!
      expect(bounds.height).toBeLessThan(height)
      if (edge === 'top') expect(bounds.y).toBeGreaterThan(10)
      else expect(bounds.y + bounds.height).toBeLessThan(height - 10)
      await expect(floating(page)).toHaveCount(1)
      await expect(floating(page)).toHaveCSS('position', 'fixed')
      await expect(floating(page)).toBeInViewport()
      await expect(page.locator('.map-top-controls')).toHaveCount(0)
      await page.screenshot({ path: test.info().outputPath(`${side}-panel-${edge}-floating.png`) })
    }
    // Once the control panel begins to enter view, return to map-top controls.
    await page.locator('.board-panel').evaluate(element => {
      window.scrollTo(0, window.scrollY + element.getBoundingClientRect().bottom - window.innerHeight + 40)
    })
    await expect(floating(page)).toHaveCount(1)
    await expect(floating(page)).toHaveCSS('position', 'absolute')
    await expect(page.locator('body > .floating-map-controls')).toHaveCount(0)
  })
}

async function expectClearMapTop(page: Page) {
  await expect(floating(page)).toHaveCSS('position', 'absolute')
  await expect.poll(() => page.locator('.map-top-controls').evaluate(controls => {
    const bar = controls.getBoundingClientRect()
    return [...document.querySelectorAll('.map-hit-target')].filter(node => {
      const rect = node.getBoundingClientRect()
      return rect.left < bar.right && rect.right > bar.left && rect.top < bar.bottom && rect.bottom > bar.top
    }).map(node => node.getAttribute('aria-label'))
  })).toEqual([])
  const map = (await page.locator('.board-frame').boundingBox())!
  const bar = (await floating(page).boundingBox())!
  expect(bar.y).toBeGreaterThanOrEqual(map.y)
  expect(bar.y - map.y).toBeLessThan(5)
  expect(bar.height).toBeLessThan(map.width * 0.035)
}

for (const side of ['Jack', 'Investigators', 'Discovery setup'] as const) {
  test(`${side} map-top controls clear all locations and crossings as the map shrinks`, async ({ page }) => {
    await restore(page, side === 'Jack' ? jackState() : side === 'Investigators' ? investigatorState() : createInitialGame())
    await page.setViewportSize({ width: 974, height: 1600 })
    await page.goto('/')
    for (const width of [1050, 974, 680, 390, 320]) {
      await page.setViewportSize({ width, height: 1600 })
      await expectClearMapTop(page)
    }
    if (side === 'Jack') {
      for (let type = 0; type < 3; type++) {
        await floating(page).getByRole('button', { name: /^Cycle move type:/ }).click()
        await expectClearMapTop(page)
      }
    } else if (side === 'Investigators') {
      await floating(page).getByRole('button', { name: 'Toggle search/arrest: Search' }).click()
      await expectClearMapTop(page)
    }
    await page.screenshot({ path: test.info().outputPath(`${side}-compact-mobile-controls.png`) })
  })
}

test.describe('narrow desktop with the whole map visible', () => {
  test.use({ deviceScaleFactor: 1.5 })
  for (const side of ['Jack', 'Investigators'] as const) {
    test(`${side} keeps controls at the map top even when the map occupies over 75% of the window`, async ({ page }) => {
      await restore(page, side === 'Jack' ? jackState() : investigatorState())
      await page.setViewportSize({ width: 1600, height: 1200 })
      await page.goto('/')
      await expect(floating(page)).toHaveCount(0)
      await page.setViewportSize({ width: 974, height: 1167 })
      await page.locator('.move-track').evaluate(element => {
        window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top)
      })
      const checkMapTop = async () => {
        await expect(floating(page)).toHaveCount(1)
        await expect(floating(page)).toHaveCSS('position', 'absolute')
        await expect(floating(page)).toBeInViewport()
        const map = (await page.locator('.board-frame').boundingBox())!
        const controls = (await floating(page).boundingBox())!
        expect(map.height).toBeGreaterThan(page.viewportSize()!.height * 0.75)
        expect(map.y).toBeGreaterThanOrEqual(0)
        expect(map.y + map.height).toBeLessThanOrEqual(page.viewportSize()!.height)
        await expectClearMapTop(page)
        expect(Math.abs(controls.x + controls.width / 2 - map.x - map.width / 2)).toBeLessThan(1)
      }
      await checkMapTop()
      await expect(floating(page).getByRole('button', { name: side === 'Jack' ? 'Submit move' : 'Pass Y', exact: true })).toBeVisible()
      await page.screenshot({ path: test.info().outputPath(`${side}-narrow-desktop.png`) })
      // Scroll until the top of the map reaches the viewport; it still fits.
      await page.locator('.board-frame').evaluate(element => {
        window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top)
      })
      await checkMapTop()
      await fillViewport(page)
      await expect(floating(page)).toHaveCount(1)
      await expect(floating(page)).toHaveCSS('position', 'fixed')
      await expect(page.locator('.map-top-controls')).toHaveCount(0)
      await page.setViewportSize({ width: 974, height: 1167 })
      await page.locator('.move-track').evaluate(element => {
        window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top)
      })
      await checkMapTop()
    })
  }
})

test('map-top controls are centered in one column and mutually exclusive with viewport-floating controls', async ({ page }) => {
  await restore(page, jackState())
  await page.setViewportSize({ width: 1000, height: 1600 })
  await page.goto('/')
  const checkTop = async () => {
    await expect(floating(page)).toHaveCount(1)
    await expect(floating(page)).toHaveCSS('position', 'absolute')
    const map = (await page.locator('.board-frame').boundingBox())!
    const controls = (await floating(page).boundingBox())!
    const panel = (await page.locator('.control-panel').boundingBox())!
    expect(Math.abs(controls.x + controls.width / 2 - (map.x + map.width / 2))).toBeLessThan(1)
    await expectClearMapTop(page)
    expect(panel.y).toBeGreaterThanOrEqual(map.y + map.height)
    expect(controls.x).toBeGreaterThanOrEqual(map.x)
    expect(controls.x + controls.width).toBeLessThanOrEqual(map.x + map.width)
  }
  await checkTop()
  await page.screenshot({ path: test.info().outputPath('jack-map-top-controls.png') })
  await page.setViewportSize({ width: 390, height: 1000 })
  await page.locator('.board-frame').scrollIntoViewIfNeeded()
  await checkTop()
  await page.screenshot({ path: test.info().outputPath('jack-map-top-mobile.png') })
  await fillViewport(page)
  await expect(floating(page)).toHaveCount(1)
  await expect(floating(page)).toHaveCSS('position', 'fixed')
  await expect(page.locator('.map-top-controls')).toHaveCount(0)
  await page.setViewportSize({ width: 1050, height: 1600 })
  await checkTop()
  await page.setViewportSize({ width: 1051, height: 1600 })
  await expect(floating(page)).toHaveCount(0)
  await page.setViewportSize({ width: 1000, height: 1600 })
  await checkTop()
  await floating(page).getByRole('button', { name: 'Cycle move type: Street' }).click()
  await expect(floating(page).getByRole('button', { name: 'Cycle move type: Coach' })).toBeVisible()
  await floating(page).getByRole('button', { name: 'Cycle move type: Coach' }).click()
  const destination = legalJackDestinations(await saved(page))[0]!
  await page.getByLabel(`Location ${destination}, selectable`, { exact: true }).click()
  await floating(page).getByRole('button', { name: 'Submit move', exact: true }).click()
  expect((await saved(page)).currentJack).toBe(destination)
  await expect(floating(page)).toHaveCount(0)
})

test('map-top Submit handles discovery setup and a separate Pass works in the stacked action panel', async ({ page }) => {
  await restore(page, { ...createInitialGame(), discoveryLocations: [33, 46, 147, 159] })
  await page.setViewportSize({ width: 1000, height: 1600 })
  await page.goto('/')
  await expect(floating(page)).toHaveCSS('position', 'absolute')
  await floating(page).getByRole('button', { name: 'Submit discoveries', exact: true }).click()
  expect((await saved(page)).stage).toBe('investigatorSetup')
  await expect(floating(page)).toHaveCount(0)
  await page.evaluate(({ id, state }) => {
    const key = `whitehall-mystery.saved-game.v1.${id}`
    const game = JSON.parse(localStorage.getItem(key)!)
    game.history = { entries: [{ state, action: null, counted: false }], cursor: 0, pendingReveal: null }
    localStorage.setItem(key, JSON.stringify(game))
  }, { id, state: investigatorState() })
  await page.reload()
  await expect(floating(page)).toHaveCSS('position', 'absolute')
  await expect(floating(page).getByRole('button', { name: 'Toggle search/arrest: Search' })).toBeVisible()
  await floating(page).getByRole('button', { name: 'Pass Y', exact: true }).click()
  expect((await saved(page)).activeInvestigator).toBe(1)
})

for (const action of ['search', 'arrest'] as const) {
  test(`the toggle and Pass disappear after the final investigator's ${action}`, async ({ page }) => {
    const state = { ...investigatorState(), activeInvestigator: 2, inspectorActionMode: action,
      investigatorPositions: { yellow: 'DC', blue: 'HZ', red: 'CF' } }
    const target = legalInspectorActionCircles(state).find(id => id !== state.currentJack)!
    if (action === 'search') state.roundTrail = [33, target]
    await restore(page, state)
    await page.setViewportSize({ width: 1000, height: 1600 })
    await page.goto('/')
    await expect(floating(page)).toBeVisible()
    await page.getByLabel(`Location ${target}, selectable`, { exact: true }).click()
    expect((await saved(page)).stage).toBe('investigatorTurnResult')
    await expect(floating(page)).toHaveCount(0)
  })
}

test('Jack cycles only legal move types, completes both Coach steps, and submits from the floating controls', async ({ page }) => {
  await restore(page, jackState())
  await page.setViewportSize({ width: 1600, height: 1200 })
  await page.goto('/')
  await expect(page.locator('.game-board')).toBeVisible()
  await expect(floating(page)).toHaveCount(0)
  await fillViewport(page)
  const submit = floating(page).getByRole('button', { name: 'Submit move', exact: true })
  await expect(submit).toBeDisabled()
  const cycle = () => floating(page).getByRole('button', { name: /^Cycle move type:/ })
  await expect(cycle()).toHaveAccessibleName('Cycle move type: Street')
  await cycle().click()
  await expect(cycle()).toHaveAccessibleName('Cycle move type: Coach')
  const first = legalJackDestinations(await saved(page))[0]!
  await page.getByLabel(`Location ${first}, selectable`, { exact: true }).click()
  await expect(submit).toBeDisabled()
  const second = legalJackDestinations(await saved(page))[0]!
  await page.getByLabel(`Location ${second}, selectable`, { exact: true }).click()
  await expect(submit).toBeEnabled()
  await cycle().click()
  await expect(cycle()).toHaveAccessibleName('Cycle move type: Alley')
  expect((await saved(page)).jackMoveSelection.path).toEqual([])
  await expect(submit).toBeDisabled()
  await cycle().click() // Boat is unavailable from 85.
  await expect(cycle()).toHaveAccessibleName('Cycle move type: Street')
  await cycle().click()
  await page.getByLabel(`Location ${first}, selectable`, { exact: true }).click()
  await page.getByLabel(`Location ${second}, selectable`, { exact: true }).click()
  await fillViewport(page)
  await page.screenshot({ path: test.info().outputPath('jack-floating-controls.png') })
  await submit.click()
  expect(await saved(page)).toMatchObject({ stage: 'investigatorMove', currentJack: second,
    moveSlot: 3, specialRemaining: { coach: 1 } })
  await expect(floating(page).getByRole('button')).toHaveCount(1)
  await expect(focusButton(page)).toBeVisible()
})

test('hides the move cycle with only one valid type and removes floating controls when the map leaves view', async ({ page }) => {
  await restore(page, { ...jackState(), specialRemaining: { coach: 0, alley: 0, boat: 0 } })
  await page.goto('/')
  await fillViewport(page)
  await expect(floating(page).getByRole('button', { name: 'Submit move' })).toBeVisible()
  await expect(floating(page).getByRole('button', { name: /^Cycle move type:/ })).toHaveCount(0)
  await page.locator('.control-panel').scrollIntoViewIfNeeded()
  await expect(floating(page)).not.toBeInViewport()
  await fillViewport(page)
  await expect(floating(page)).toBeVisible()
  await page.setViewportSize({ width: 1600, height: 1200 })
  await expect(floating(page)).toHaveCount(0)
})

test('Jack can use a forced special move with the cycle hidden and record it through ordinary history', async ({ page }) => {
  const state = jackState()
  state.investigatorPositions = jackEscapeForecast({ ...state, specialRemaining: { coach: 0, alley: 0, boat: 0 } }).trapPositions!
  state.specialRemaining = { coach: 0, alley: 1, boat: 0 }
  expect(legalJackDestinations(state)).toEqual([])
  const destinations = legalJackDestinations({ ...state, jackMoveSelection: { type: 'alley', path: [] } })
  expect(destinations.length).toBeGreaterThan(0)
  await restore(page, state)
  await page.goto('/')
  await fillViewport(page)
  await expect(floating(page).getByRole('button', { name: /^Cycle move type:/ })).toHaveCount(0)
  const destination = destinations[0]!
  await page.getByLabel(`Location ${destination}, selectable`, { exact: true }).click()
  expect((await saved(page)).jackMoveSelection).toEqual({ type: 'alley', path: [destination] })
  await floating(page).getByRole('button', { name: 'Submit move' }).click()
  expect(await saved(page)).toMatchObject({ stage: 'investigatorMove', currentJack: destination,
    moveSlot: 2, specialRemaining: { alley: 0 } })
})

test('investigators toggle only Search/Arrest and can pass directly from either mode, with refresh and undo', async ({ page }) => {
  const state = investigatorState()
  await restore(page, state)
  // An old uncommitted Pass preference must no longer suppress map targets.
  await page.addInitScript(({ id, state }) => localStorage.setItem(`whitehall-mystery.floating-pass.${id}`,
    JSON.stringify([id, 0, state.round, state.moveSlot, state.stage, state.activeInvestigator, state.inspectorActionMode])), { id, state })
  await page.goto('/')
  await fillViewport(page)
  const toggle = () => floating(page).getByRole('button', { name: /^Toggle search\/arrest:/ })
  const pass = () => floating(page).getByRole('button', { name: /^Pass [YBR]$/, exact: true })
  await expect(toggle()).toHaveAccessibleName('Toggle search/arrest: Search')
  await expect(pass()).toBeEnabled()
  expect(await page.locator('.map-hit-target.selectable').count()).toBeGreaterThan(0)
  await toggle().click()
  await expect(toggle()).toHaveAccessibleName('Toggle search/arrest: Arrest')
  await expect(pass()).toBeEnabled()
  await toggle().click()
  await expect(toggle()).toHaveAccessibleName('Toggle search/arrest: Search')
  await toggle().click()
  await page.reload()
  await fillViewport(page)
  await expect(toggle()).toHaveAccessibleName('Toggle search/arrest: Arrest')
  await expect(floating(page).getByRole('button')).toHaveCount(3)
  await page.screenshot({ path: test.info().outputPath('investigator-floating-controls.png') })
  await pass().click()
  expect((await saved(page)).activeInvestigator).toBe(1)
  await expect(toggle()).toHaveAccessibleName('Toggle search/arrest: Search')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await fillViewport(page)
  expect((await saved(page)).activeInvestigator).toBe(0)
  await expect(toggle()).toHaveAccessibleName('Toggle search/arrest: Arrest')
  await pass().click()
  await pass().click()
  expect((await saved(page)).activeInvestigator).toBe(2)
  await pass().click()
  await expect(floating(page)).toHaveCount(0)
})

test('starting a search hides the toggle while keeping Pass available', async ({ page }) => {
  const state = investigatorState()
  await restore(page, state)
  await page.goto('/')
  await fillViewport(page)
  await expectFloatingPositions(page)
  const focusBefore = await page.getByRole('button', { name: 'Focus', exact: true }).boundingBox()
  const passBefore = await floating(page).getByRole('button', { name: 'Pass Y', exact: true }).boundingBox()
  const miss = legalInspectorActionCircles(state).find(id => !state.roundTrail.includes(id))!
  await page.getByLabel(`Location ${miss}, selectable`, { exact: true }).click()
  await fillViewport(page)
  expect((await saved(page)).checkedThisAction).toEqual([miss])
  await expect(floating(page).getByRole('button', { name: /^Toggle search\/arrest:/ })).toHaveCount(0)
  await expectFloatingPositions(page)
  expect(await page.getByRole('button', { name: 'Focus', exact: true }).boundingBox()).toEqual(focusBefore)
  expect(await floating(page).getByRole('button', { name: 'Pass Y', exact: true }).boundingBox()).toEqual(passBefore)
  await floating(page).getByRole('button', { name: 'Pass Y', exact: true }).click()
  expect((await saved(page)).activeInvestigator).toBe(1)
})

test('floating controls stay inside the visual viewport during pinch zoom and panning', async ({ page, context }) => {
  await restore(page, jackState())
  await page.goto('/')
  await fillViewport(page)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 })
  await expect.poll(() => page.evaluate(() => window.visualViewport!.scale)).toBe(2)
  await expect(floating(page)).toBeVisible()
  const checkBounds = async () => {
    await expectFloatingPositions(page)
    await expect.poll(() => floating(page).evaluate(element => {
      const rect = element.getBoundingClientRect()
      const viewport = window.visualViewport!
      return rect.left >= viewport.offsetLeft && rect.right <= viewport.offsetLeft + viewport.width &&
        rect.top >= viewport.offsetTop && rect.bottom <= viewport.offsetTop + viewport.height
    })).toBe(true)
  }
  await checkBounds()
  await cdp.send('Input.synthesizeScrollGesture', { x: 250, y: 150, xDistance: -120, yDistance: -100, gestureSourceType: 'touch' })
  await checkBounds()
  await page.screenshot({ path: test.info().outputPath('pinched-floating-controls.png') })
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
  await cdp.detach()
})

test('floating Submit respects WaitEnd and hides during the AI turn', async ({ page }) => {
  const state = jackState()
  state.jackMoveSelection.path = [legalJackDestinations(state)[0]!]
  await restore(page, state, { mode: 'versus-ai', role: 'jack', waitEnd: true })
  await page.route('**/src/game/ai.worker.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'self.onmessage = () => {}' }))
  await page.goto('/')
  await fillViewport(page)
  await floating(page).getByRole('button', { name: 'Submit move' }).click()
  await expect(floating(page).getByRole('button', { name: 'End turn', exact: true })).toBeVisible()
  await expect(floating(page).getByRole('button', { name: /^Cycle move type:/ })).toHaveCount(0)
  await floating(page).getByRole('button', { name: 'End turn', exact: true }).click()
  await expect(floating(page)).toHaveCount(0)
  // The worker is held, so any stale controls here would act on the AI's turn.
  expect((await saved(page)).stage).toBe('investigatorMove')
})

const focusButton = (page: Page) => page.getByRole('button', { name: 'Focus', exact: true })
const activePiece = (page: Page) => page.locator('[data-active-playing-piece]')
async function pieceViewport(page: Page) {
  return activePiece(page).evaluate(element => {
    const piece = element.getBoundingClientRect()
    const viewport = window.visualViewport!
    return { x: piece.x + piece.width / 2, y: piece.y + piece.height / 2,
      left: viewport.offsetLeft, top: viewport.offsetTop, width: viewport.width, height: viewport.height,
      scale: viewport.scale }
  })
}

for (const stage of ['jackMove', 'investigatorMove', 'investigatorAction'] as const) {
  test(`Focus stays available and centers the visible active piece during ${stage} without changing the game`, async ({ page }) => {
    const state = stage === 'jackMove' ? jackState() : {
      ...investigatorState(), stage, investigatorPositions: { yellow: 'FP', blue: 'DC', red: 'HZ' },
    }
    await restore(page, state)
    await page.goto('/')
    await fillViewport(page)
    await expect(activePiece(page)).toBeInViewport()
    await expect(focusButton(page)).toBeVisible()
    await expect(floating(page)).toHaveCSS('position', 'fixed')
    const before = await saved(page)
    await focusButton(page).click()
    await expect(focusButton(page)).toBeVisible()
    await expect.poll(async () => {
      const piece = await pieceViewport(page)
      return Math.abs(piece.y - piece.top - piece.height / 2)
    }).toBeLessThan(2)
    expect(await saved(page)).toEqual(before)
    // Focus has no map-top counterpart when the whole map fits.
    await page.setViewportSize({ width: 1000, height: 1600 })
    await expect(focusButton(page)).toHaveCount(0)
  })
}

test('Focus follows the active investigator, stays for a partly visible piece, and respects the panel boundary', async ({ page }) => {
  const state = { ...investigatorState(), investigatorPositions: { yellow: 'LH', blue: 'DC', red: 'HZ' } }
  await restore(page, state)
  await page.goto('/')
  await fillViewport(page)
  await page.locator('.board-panel').evaluate(element => window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top + 1))
  await expect(focusButton(page)).toBeVisible()
  await floating(page).getByRole('button', { name: 'Pass Y', exact: true }).click()
  // Blue is near the top and in view. This update requires no scroll/resize.
  await expect(activePiece(page)).toHaveClass(/blue/)
  await expect(focusButton(page)).toBeVisible()
  await activePiece(page).evaluate(element => {
    const rect = element.getBoundingClientRect()
    window.scrollBy(0, rect.top + rect.height / 2)
  })
  await expect(focusButton(page)).toBeVisible() // The lower half remains visible.
  await page.evaluate(() => window.scrollBy(0, 60))
  await expect(focusButton(page)).toBeVisible()
  await page.locator('.board-panel').evaluate(element => window.scrollTo(0, window.scrollY + element.getBoundingClientRect().bottom - window.innerHeight + 40))
  await expect(focusButton(page)).toHaveCount(0)
  await expect(page.locator('body > .floating-map-controls')).toHaveCount(0)
})

test('Focus centers horizontally and vertically after pinch zoom without changing zoom', async ({ page, context }) => {
  await restore(page, jackState())
  await page.goto('/')
  await fillViewport(page)
  const cdp = await context.newCDPSession(page)
  try {
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 3 })
    await expect(focusButton(page)).toBeVisible()
    await focusButton(page).click()
    await expect(focusButton(page)).toBeVisible()
    await expect.poll(async () => {
      const piece = await pieceViewport(page)
      return Math.max(Math.abs(piece.x - piece.left - piece.width / 2), Math.abs(piece.y - piece.top - piece.height / 2))
    }).toBeLessThan(2)
    expect((await pieceViewport(page)).scale).toBe(3)
    await page.screenshot({ path: test.info().outputPath('focus-pinched.png') })
  } finally {
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
    await cdp.detach()
  }
})

for (const stage of ['jackDiscoverySetup', 'investigatorTurnResult', 'gameOver'] as const) {
  test(`Focus is absent when there is no active piece in ${stage}`, async ({ page }) => {
    await restore(page, stage === 'jackDiscoverySetup' ? createInitialGame() : { ...investigatorState(), stage,
      result: stage === 'gameOver' ? { winner: 'investigators', reason: 'Jack was arrested.' } : null })
    await page.goto('/')
    await fillViewport(page)
    await expect(focusButton(page)).toHaveCount(0)
    await expect(activePiece(page)).toHaveCount(0)
  })
}
