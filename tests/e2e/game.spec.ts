import { expect, test } from '@playwright/test'

test('keeps history buttons left-aligned ahead of the action count and options', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('label.crossing-toggle')).toHaveAttribute('title', 'show crossing ids')
  await expect(page.locator('label.alternate-angle-toggle')).toHaveAttribute(
    'title',
    'use alternate angle for placing indicators; swap above and up-right positions for indicators',
  )
  await expect(page.locator('label.past-path-toggle')).toHaveAttribute('title', "show Jack's taken path for this round")
  await expect(page.locator('label.investigator-maybes-toggle')).toHaveAttribute(
    'title',
    'show what crossings are reachable and locations are searchable/arrestable by investigators after they move',
  )

  const historyControls = page.getByLabel('Action history controls')
  const undoSideBox = await historyControls.getByRole('button', { name: 'Undo Side' }).boundingBox()
  const randSideBox = await historyControls.getByRole('button', { name: 'Rand Side' }).boundingBox()
  const actionBox = await historyControls.getByLabel(/player actions/).boundingBox()
  const crossingBox = await page.getByLabel('xings').boundingBox()

  expect(undoSideBox).not.toBeNull()
  expect(randSideBox).not.toBeNull()
  expect(actionBox).not.toBeNull()
  expect(crossingBox).not.toBeNull()
  expect(undoSideBox!.x).toBeLessThan(randSideBox!.x)
  expect(randSideBox!.x).toBeLessThan(actionBox!.x)
  expect(actionBox!.x).toBeLessThan(crossingBox!.x)
  await expect(page.locator('.board-options')).toHaveCSS('justify-content', 'flex-start')
})

test('shows the complete action recap in the public log after game over', async ({ page }) => {
  const baseState = {
    stage: 'jackChooseStart',
    round: 1,
    moveSlot: 0,
    discoveryLocations: [33, 46, 147, 159],
    reachedDiscoveries: [],
    currentJack: null,
    roundTrail: [],
    investigatorPositions: { yellow: 'FP', blue: 'HP', red: 'HZ' },
    activeInvestigator: 0,
    jackMoveSelection: { type: 'normal', path: [] },
    specialRemaining: { coach: 2, alley: 2, boat: 2 },
    publicRound: null,
    clueLocations: [],
    inspectorActionMode: 'choose',
    checkedThisAction: [],
    publicLog: ['This current-round entry should be replaced by the recap.'],
    notice: '',
    result: null,
  }
  const started = {
    ...baseState,
    stage: 'jackMove',
    currentJack: 33,
    reachedDiscoveries: [33],
    roundTrail: [33],
    publicRound: { start: 33, moves: [], observations: [] },
  }
  const selected = { ...started, jackMoveSelection: { type: 'coach', path: [44, 55] } }
  const moved = {
    ...started,
    stage: 'investigatorMove',
    currentJack: 55,
    roundTrail: [33, 44, 55],
  }
  const yellowMoved = {
    ...moved,
    activeInvestigator: 1,
    investigatorPositions: { yellow: 'BB', blue: 'HP', red: 'HZ' },
  }
  const blueMoved = {
    ...yellowMoved,
    activeInvestigator: 2,
    investigatorPositions: { yellow: 'BB', blue: 'BC', red: 'HZ' },
  }
  const investigatorsMoved = {
    ...blueMoved,
    stage: 'investigatorAction',
    activeInvestigator: 0,
    investigatorPositions: { yellow: 'BB', blue: 'BC', red: 'BD' },
  }
  const clueFound = { ...investigatorsMoved, activeInvestigator: 1 }
  const gameOver = {
    ...clueFound,
    stage: 'gameOver',
    result: { winner: 'investigators', reason: 'Jack was arrested.' },
  }
  const storedHistory = {
    entries: [
      { state: baseState, action: null, counted: false },
      { state: started, action: { type: 'chooseJackStart', circleId: 33 }, counted: true },
      { state: selected, action: { type: 'selectJackDestination', circleId: 44 }, counted: true },
      { state: moved, action: { type: 'confirmJackMove' }, counted: true },
      { state: yellowMoved, action: { type: 'moveInvestigator', crossingId: 'BB' }, counted: true },
      { state: blueMoved, action: { type: 'moveInvestigator', crossingId: 'BC' }, counted: true },
      { state: investigatorsMoved, action: { type: 'moveInvestigator', crossingId: 'BD' }, counted: true },
      { state: clueFound, action: { type: 'searchCircle', circleId: 55 }, counted: true },
      { state: gameOver, action: { type: 'arrestCircle', circleId: 55 }, counted: true },
    ],
    cursor: 8,
    pendingReveal: null,
  }
  await page.addInitScript((history) => {
    localStorage.setItem('whitehall-mystery.game.v1', JSON.stringify({ version: 2, history }))
  }, storedHistory)
  await page.goto('/')

  const publicLog = page.locator('.public-log')
  await expect(publicLog.getByText('Jack started at location 33.')).toBeVisible()
  await expect(publicLog.getByText('Jack moved via Coach to {44, 55}.')).toBeVisible()
  await expect(publicLog.getByText('Investigators moved {BB, BC, BD}.')).toBeVisible()
  await expect(publicLog.getByText('Yellow found a clue at 55.')).toBeVisible()
  await expect(publicLog.getByText('Blue executed an arrest at 55: caught Jack.')).toBeVisible()
  await expect(publicLog.getByText('This current-round entry should be replaced by the recap.')).toHaveCount(0)
})

test('Jack can preview investigator reach while choosing discovery locations', async ({ page }) => {
  await page.goto('/')

  const investigatorMaybes = page.getByLabel('future')
  await expect(investigatorMaybes).toBeVisible()
  await expect(investigatorMaybes).not.toBeChecked()
  await expect(page.locator('.investigator-maybe-crossing')).toHaveCount(0)

  await investigatorMaybes.check()

  expect(await page.locator('.investigator-maybe-crossing').count()).toBeGreaterThan(6)
  expect(await page.locator('.investigator-maybe-circle').count()).toBeGreaterThan(0)
  await expect(page.locator('.investigator-maybe-crossing').first()).toHaveCSS('stroke', 'rgb(255, 122, 0)')
  const possibleStarts = page.locator('.investigator-maybe-crossing.possible-investigator-start')
  await expect(possibleStarts).toHaveCount(6)
  await expect(possibleStarts.first()).toHaveCSS('fill', 'rgb(255, 255, 0)')
  await expect(possibleStarts.first()).toHaveCSS('stroke', 'rgb(255, 122, 0)')

  const allCrossingCount = await page.locator('.investigator-maybe-crossing').count()
  await page.getByLabel('Crossing FP, possible investigator start').hover()

  const hoveredCrossings = page.locator('.hovered-investigator-maybe-crossing.yellow')
  const hoveredCircles = page.locator('.hovered-investigator-maybe-circle.yellow')
  expect(await hoveredCrossings.count()).toBeGreaterThan(0)
  expect(await hoveredCrossings.count()).toBeLessThan(allCrossingCount)
  expect(await hoveredCircles.count()).toBeGreaterThan(0)
  await expect(hoveredCrossings.first()).toHaveCSS('stroke', 'rgb(255, 255, 0)')
  await expect(hoveredCrossings.first()).toHaveAttribute('width', '24')
  await expect(hoveredCircles.first()).toHaveAttribute('r', '26')
})

test('Jack can preview unrestricted Street distances while choosing discovery and starting locations', async ({ page }) => {
  await page.goto('/')

  for (const location of [33, 19, 138]) {
    await page.getByLabel(`Location ${location}${location === 33 ? ', selectable' : ''}`, { exact: true }).hover()
    await expect(page.locator('.route-turn-count')).toHaveCount(188)
    await expect(page.locator(`[aria-label^="Location ${location}:"]`)).toHaveCount(0)
    await expect(page.locator('.route-preview-line')).toHaveCount(0)
    await expect(page.locator('.route-preview-location')).toHaveCount(0)
  }

  for (const id of [33, 46, 147, 159]) await page.getByLabel(`Location ${id}, selectable`).click()
  await page.getByRole('button', { name: 'Lock in four locations' }).click()
  const deployment = page.getByLabel('Available deployment crossings')
  for (const crossing of ['FP', 'HP', 'HZ']) {
    await deployment.getByRole('button', { name: crossing, exact: true }).click()
  }
  await page.getByRole('button', { name: /reveal my view/i }).click()
  await expect(page.getByRole('heading', { name: 'Jack: Choose the Starting Location' })).toBeVisible()

  for (const location of [33, 19, 138]) {
    await page.getByLabel(`Location ${location}${location === 33 ? ', selectable' : ''}`, { exact: true }).hover()
    await expect(page.locator('.route-turn-count')).toHaveCount(188)
    await expect(page.locator(`[aria-label^="Location ${location}:"]`)).toHaveCount(0)
    await expect(page.locator('.route-preview-line')).toHaveCount(0)
    await expect(page.locator('.route-preview-location')).toHaveCount(0)
  }
})

test('alt angle swaps map indicator positions and persists', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('xings').check()
  await page.getByLabel('Location 33, selectable').hover()

  const crossingLabel = page.locator('.crossing-id-label').filter({ hasText: /^FP$/ })
  const routeLabel = page.locator('.route-turn-count[aria-label^="Location 34:"]')
  const defaultCrossingX = await crossingLabel.getAttribute('x')
  const defaultRouteX = await routeLabel.getAttribute('x')
  await expect(crossingLabel).toHaveAttribute('text-anchor', 'middle')
  await expect(routeLabel).toHaveAttribute('text-anchor', 'middle')

  await page.getByLabel('alt').check()
  await page.getByLabel('Location 33, selectable').hover()

  await expect(crossingLabel).not.toHaveAttribute('x', defaultCrossingX!)
  await expect(routeLabel).not.toHaveAttribute('x', defaultRouteX!)
  await expect(crossingLabel).toHaveAttribute('text-anchor', 'start')
  await expect(routeLabel).toHaveAttribute('text-anchor', 'start')

  await page.reload()
  await expect(page.getByLabel('alt')).toBeChecked()
})

test('reveals a private handoff when the handoff card is clicked', async ({ page }) => {
  await page.goto('/')
  const randSide = page.getByRole('button', { name: 'Rand Side', exact: true })
  await randSide.click()
  await randSide.click()

  const handoffCard = page.locator('.handoff-card')
  await expect(handoffCard).toContainText('Pass the device to Jack')
  await handoffCard.click({ position: { x: 20, y: 20 } })
  await expect(page.getByRole('heading', { name: 'Jack: Choose the Starting Location' })).toBeVisible()
})

test('Jack-view future checkbox shows investigator reach and searchable locations', async ({ page }) => {
  await page.goto('/')
  const randSide = page.getByRole('button', { name: 'Rand Side', exact: true })
  await randSide.click()
  await randSide.click()
  await page.getByRole('button', { name: /reveal my view/i }).click()

  await page.getByLabel('Secret Discovery Locations').getByRole('button').first().click()
  await expect(page.getByText('future', { exact: true })).toBeVisible()
  await expect(page.locator('.investigator-maybe-crossing')).toHaveCount(0)

  const investigatorPieces = page.locator('.investigator-piece')
  await expect(investigatorPieces).toHaveCount(3)
  expect(
    await investigatorPieces.evaluateAll((pieces) =>
      pieces.map((piece) => ({
        animationDuration: getComputedStyle(piece).animationDuration,
        animationName: getComputedStyle(piece).animationName,
        color: getComputedStyle(piece).getPropertyValue('--investigator-background').trim(),
      })),
    ),
  ).toEqual([
    { animationDuration: '1.5s', animationName: 'investigator-color-glow', color: '#ffff00' },
    { animationDuration: '1.5s', animationName: 'investigator-color-glow', color: '#1f68ab' },
    { animationDuration: '1.5s', animationName: 'investigator-color-glow', color: '#b02f2e' },
  ])
  await expect(page.locator('.jack-marker')).toHaveCSS('animation-name', 'jack-color-glow')
  await expect(page.locator('.jack-marker')).toHaveCSS('animation-duration', '1.5s')

  await page.locator('.investigator-piece').first().hover()
  expect(await page.locator('.investigator-maybe-crossing').count()).toBeGreaterThan(0)
  expect(await page.locator('.investigator-maybe-circle').count()).toBeGreaterThan(0)
  expect(await page.locator('.investigator-hover-turn-count').count()).toBeGreaterThan(0)
  await expect(page.locator('.investigator-hover-turn-count', { hasText: /^1[ab]$/ })).toHaveCount(0)
  await expect(page.locator('.investigator-route-preview-line')).toHaveCount(0)
  const crossingMaybe = page.locator('.investigator-maybe-crossing').first()
  await expect(crossingMaybe).toHaveCSS('stroke', 'rgb(255, 122, 0)')
  await expect(crossingMaybe).toHaveCSS('stroke-width', '3px')
  await expect(crossingMaybe).toHaveAttribute('width', '15')
  await expect(crossingMaybe).toHaveAttribute('height', '15')
  await expect(crossingMaybe.evaluate((element) => element.tagName.toLowerCase())).resolves.toBe('rect')
  await expect(page.locator('.investigator-maybe-circle').first()).toHaveAttribute('r', '21')

  await page.getByText('future', { exact: true }).click()
  await page.mouse.move(0, 0)
  expect(await page.locator('.investigator-maybe-crossing').count()).toBeGreaterThan(0)
  await expect(page.locator('.hovered-investigator-maybe-crossing')).toHaveCount(0)
  const hoveredPiece = page.locator('.investigator-piece').first()
  const investigatorColor = (await hoveredPiece.getAttribute('class'))?.split(' ')[1]
  await hoveredPiece.hover()
  const coloredCrossingMaybe = page.locator('.hovered-investigator-maybe-crossing').first()
  const coloredCircleMaybe = page.locator('.hovered-investigator-maybe-circle').first()
  expect(await page.locator('.hovered-investigator-maybe-circle').count()).toBeGreaterThan(0)
  await expect(coloredCircleMaybe).toHaveAttribute('r', '26')
  await expect(coloredCrossingMaybe).toHaveAttribute('width', '24')
  await expect(coloredCrossingMaybe).toHaveAttribute('height', '24')
  await expect(coloredCrossingMaybe).toHaveClass(new RegExp(`\\b${investigatorColor}\\b`))
  await expect(coloredCrossingMaybe).toHaveCSS('stroke', 'rgb(255, 255, 0)')
  await expect(hoveredPiece.locator('circle').last()).toHaveCSS('fill', 'rgb(255, 255, 0)')
  await page.reload()
  await expect(page.getByLabel('future')).toBeChecked()
})

test('Jack can preview investigator knowledge for the selected movement type', async ({ page }) => {
  await page.goto('/')
  for (const id of [33, 46, 147, 159]) await page.getByLabel(`Location ${id}, selectable`).click()
  await page.getByRole('button', { name: 'Lock in four locations' }).click()

  const deployment = page.getByLabel('Available deployment crossings')
  for (const crossing of ['FP', 'HP', 'HZ']) {
    await deployment.getByRole('button', { name: crossing, exact: true }).click()
  }
  await page.getByRole('button', { name: /reveal my view/i }).click()
  await page.getByLabel('Secret Discovery Locations').getByRole('button', { name: '33', exact: true }).click()

  const investigatorKnowledge = page.getByLabel('know')
  await expect(investigatorKnowledge).toBeVisible()
  await expect(page.locator('label.coach-preview-toggle')).toHaveAttribute(
    'title',
    'show possible coach moves when street move is selected',
  )
  await expect(page.locator('label.investigator-knowledge-toggle')).toHaveAttribute(
    'title',
    'show what investigators know for your possible locations (more precisely, locations that are worth searching/arresting)',
  )
  await expect(page.locator('.possible-marker')).toHaveCount(0)
  await investigatorKnowledge.check()

  const streetCount = await page.locator('.possible-marker').count()
  expect(streetCount).toBeGreaterThan(0)
  await expect(page.locator('.possible-marker').first()).toHaveCSS('stroke', 'rgb(122, 60, 175)')
  await expect(page.locator('.possible-marker').first()).toHaveCSS('stroke-width', '2.5px')
  await expect(page.locator('.possible-certainty-marker').first()).toHaveCSS('stroke', 'rgb(176, 0, 104)')
  const projectedOutcomeCount = page.locator('.possible-outcome-count').first()
  await expect(projectedOutcomeCount).toHaveText(/\d+\/\d+/)
  await expect(projectedOutcomeCount.locator('.outcome-count-yes')).toHaveCSS('fill', 'rgb(176, 0, 104)')
  await expect(projectedOutcomeCount).not.toHaveAttribute('text-anchor', 'middle')
  await page.getByLabel('alt').check()
  await expect(projectedOutcomeCount).toHaveAttribute('text-anchor', 'middle')
  await page.getByLabel('alt').uncheck()
  await expect(page.locator('.investigator-knowledge-toggle strong')).toHaveText(String(streetCount))

  await page.locator('.map-hit-target.inference-hover-target').first().hover()
  await expect(page.locator('.possible-outcome-yes').first()).toHaveCSS('stroke', 'rgb(176, 0, 104)')
  await page.mouse.move(0, 0)

  await page.getByRole('button', { name: 'Coach (2)' }).click()
  const coachCount = await page.locator('.possible-marker').count()
  expect(coachCount).toBeGreaterThan(streetCount)
  await expect(page.locator('.investigator-knowledge-toggle strong')).toHaveText(String(coachCount))
  await page.getByLabel('future').check()
  await expect(page.locator('.investigator-maybe-circle').first()).toHaveCSS('stroke-width', '2px')
  const overlappingIndicatorGap = await page.locator('.possible-marker').evaluateAll((possibleMarkers) => {
    const futureMarkers = [...document.querySelectorAll<SVGCircleElement>('.investigator-maybe-circle')]
    for (const possible of possibleMarkers) {
      if (!(possible instanceof SVGCircleElement)) continue
      const future = futureMarkers.find(
        (candidate) =>
          candidate.getAttribute('cx') === possible.getAttribute('cx') &&
          candidate.getAttribute('cy') === possible.getAttribute('cy'),
      )
      if (!future) continue
      const possibleInnerEdge = Number(possible.getAttribute('r')) - Number.parseFloat(getComputedStyle(possible).strokeWidth) / 2
      const futureOuterEdge = Number(future.getAttribute('r')) + Number.parseFloat(getComputedStyle(future).strokeWidth) / 2
      return possibleInnerEdge - futureOuterEdge
    }
    return null
  })
  expect(overlappingIndicatorGap).not.toBeNull()
  expect(overlappingIndicatorGap as number).toBeGreaterThanOrEqual(1)
  const validChoiceGap = await page.locator('.investigator-maybe-circle').evaluateAll((futureMarkers) => {
    const choiceMarkers = [
      ...document.querySelectorAll<SVGCircleElement>('.legal-circle, .coach-reachable-circle'),
    ]
    for (const future of futureMarkers) {
      if (!(future instanceof SVGCircleElement)) continue
      const choice = choiceMarkers.find(
        (candidate) =>
          candidate.getAttribute('cx') === future.getAttribute('cx') &&
          candidate.getAttribute('cy') === future.getAttribute('cy'),
      )
      if (!choice) continue
      const futureInnerEdge = Number(future.getAttribute('r')) - Number.parseFloat(getComputedStyle(future).strokeWidth) / 2
      const choiceOuterEdge = Number(choice.getAttribute('r')) + Number.parseFloat(getComputedStyle(choice).strokeWidth) / 2
      return futureInnerEdge - choiceOuterEdge
    }
    return null
  })
  expect(validChoiceGap).not.toBeNull()
  expect(validChoiceGap as number).toBeGreaterThanOrEqual(1)

  await page.reload()
  await expect(page.getByLabel('know')).toBeChecked()
  await expect(page.locator('.possible-marker')).toHaveCount(coachCount)
})

test('keeps unrevealed Discovery outlines outside inv future outlines', async ({ page }) => {
  await page.goto('/')
  for (const id of [71, 46, 147, 159]) await page.getByLabel(`Location ${id}, selectable`).click()
  await page.getByRole('button', { name: 'Lock in four locations' }).click()

  const deployment = page.getByLabel('Available deployment crossings')
  for (const crossing of ['FP', 'HP', 'HZ']) {
    await deployment.getByRole('button', { name: crossing, exact: true }).click()
  }
  await page.getByRole('button', { name: /reveal my view/i }).click()
  await page.getByLabel('Secret Discovery Locations').getByRole('button', { name: '46', exact: true }).click()
  await page.getByLabel('future').check()

  const privateDiscoveryGap = await page.locator('.private-discovery-marker').evaluateAll((privateMarkers) => {
    const futureMarkers = [...document.querySelectorAll<SVGCircleElement>('.investigator-maybe-circle')]
    for (const discovery of privateMarkers) {
      if (!(discovery instanceof SVGCircleElement)) continue
      const future = futureMarkers.find(
        (candidate) =>
          candidate.getAttribute('cx') === discovery.getAttribute('cx') &&
          candidate.getAttribute('cy') === discovery.getAttribute('cy'),
      )
      if (!future) continue
      const discoveryInnerEdge = Number(discovery.getAttribute('r')) - Number.parseFloat(getComputedStyle(discovery).strokeWidth) / 2
      const futureOuterEdge = Number(future.getAttribute('r')) + Number.parseFloat(getComputedStyle(future).strokeWidth) / 2
      return discoveryInnerEdge - futureOuterEdge
    }
    return null
  })
  expect(privateDiscoveryGap).not.toBeNull()
  expect(privateDiscoveryGap as number).toBeGreaterThanOrEqual(1)
})

test('Jack can preview all shortest routes to a hovered future location', async ({ page }) => {
  await page.goto('/')
  for (const id of [33, 46, 147, 159]) await page.getByLabel(`Location ${id}, selectable`).click()
  await page.getByRole('button', { name: 'Lock in four locations' }).click()

  const deployment = page.getByLabel('Available deployment crossings')
  for (const crossing of ['FP', 'HP', 'HZ']) {
    await deployment.getByRole('button', { name: crossing, exact: true }).click()
  }
  await page.getByRole('button', { name: /reveal my view/i }).click()
  await page.getByLabel('Secret Discovery Locations').getByRole('button', { name: '33', exact: true }).click()

  const jackMarker = page.locator('.jack-marker')
  await jackMarker.hover()
  await expect(page.locator('.route-turn-count')).toHaveCount(188)
  await expect(page.locator('[aria-label^="Location 33:"]')).toHaveCount(0)
  await expect(page.locator('.route-preview-line')).toHaveCount(0)
  await expect(page.locator('.route-preview-location')).toHaveCount(0)

  const legalDestination = page.locator('.map-hit-target.selectable[aria-label^="Location"]').first()
  const legalDestinationId = (await legalDestination.getAttribute('aria-label'))?.match(/Location (\d+)/)?.[1]
  expect(legalDestinationId).toBeDefined()
  await expect(legalDestination).toHaveClass(/unrestricted-distance-hover-target/)
  await legalDestination.hover()
  await expect(page.locator('.route-turn-count')).toHaveCount(188)
  await expect(page.locator(`[aria-label^="Location ${legalDestinationId}:"]`)).toHaveCount(0)
  await expect(page.locator('.route-preview-line')).toHaveCount(0)
  await expect(page.locator('.route-preview-location')).toHaveCount(0)

  await page.getByRole('button', { name: 'Coach (2)' }).click()
  await jackMarker.hover()
  await expect(page.locator('.route-turn-count', { hasText: /1a/ }).first()).toBeVisible()
  await expect(page.locator('.route-turn-count', { hasText: /1b/ }).first()).toBeVisible()
  await expect(page.locator('.route-preview-line')).toHaveCount(0)
  await page.getByRole('button', { name: 'Street', exact: true }).click()

  const target = page.getByLabel('Location 159', { exact: true })
  await expect(target.locator('title')).toHaveCount(0)
  await expect(target).toHaveClass(/route-preview-hover-target/)
  await target.hover()
  expect(await page.locator('.route-preview-line').count()).toBeGreaterThan(0)
  await expect(page.locator('.route-preview-line').first().evaluate((route) => route.tagName.toLowerCase())).resolves.toBe(
    'polyline',
  )
  expect(
    await page.locator('.route-preview-line').first().getAttribute('points').then((points) => points?.split(' ').length),
  ).toBeGreaterThanOrEqual(3)
  const routeOptionCounts = await page.locator('.route-preview-line').evaluateAll((lines) => {
    const counts: Record<string, number> = {}
    for (const line of lines) {
      const key = `${line.getAttribute('data-route-from')}:${line.getAttribute('data-route-to')}`
      counts[key] = (counts[key] ?? 0) + 1
    }
    return Object.values(counts)
  })
  expect(routeOptionCounts.some((count) => count > 1)).toBe(true)
  const routeLocationOutlines = page.locator('.route-preview-location')
  expect(await routeLocationOutlines.count()).toBeGreaterThan(0)
  const routeLocationRadii = await routeLocationOutlines.evaluateAll((outlines) =>
    outlines.map((outline) => Number(outline.getAttribute('r'))),
  )
  expect(Math.min(...routeLocationRadii)).toBe(20.25)
  expect(new Set(routeLocationRadii).size).toBeGreaterThan(1)
  await expect(routeLocationOutlines.first()).toHaveCSS('stroke', 'rgb(4, 98, 199)')
  await expect(page.locator('.route-preview-line').first()).toHaveCSS('stroke', 'rgb(4, 98, 199)')
  await expect(page.locator('[aria-label^="Location 159:"]')).toHaveText(/[2-9]\d*/)
  await expect(page.locator('.route-turn-count').first()).toHaveCSS('fill', 'rgb(23, 23, 23)')

  await page.getByRole('button', { name: 'Coach (2)' }).click()
  const coachTarget = page.locator('g:has(.coach-reachable-circle) .route-preview-hover-target').first()
  await coachTarget.hover()
  await expect(page.locator('.route-turn-count', { hasText: /^1a$/ }).first()).toBeVisible()
  await expect(page.locator('.route-turn-count', { hasText: /^1b$/ }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Street', exact: true }).click()
  await target.hover()

  await page.getByLabel('know').check()
  await target.hover()
  await expect(page.locator('.possible-outcome-count .outcome-count-turn')).toHaveCount(0)
  await expect(page.locator('.possible-outcome-count').first()).toHaveText(/^\d+\/\d+$/)
  await expect(page.locator('.route-turn-count').first()).toBeVisible()
})

test('middle-clicking an unselected valid Jack destination selects and submits the move', async ({ page }) => {
  await page.goto('/')
  for (const id of [33, 46, 147, 159]) await page.getByLabel(`Location ${id}, selectable`).click()
  await page.getByRole('button', { name: 'Lock in four locations' }).click()

  const deployment = page.getByLabel('Available deployment crossings')
  for (const crossing of ['FP', 'HP', 'HZ']) {
    await deployment.getByRole('button', { name: crossing, exact: true }).click()
  }
  await page.getByRole('button', { name: /reveal my view/i }).click()
  await page.getByLabel('Secret Discovery Locations').getByRole('button', { name: '33', exact: true }).click()

  const destination = await page.getByLabel('Legal Jack destinations').getByRole('button').first().innerText()
  await page.getByLabel(`Location ${destination}, selectable`).click({ button: 'middle' })

  await expect(page.getByRole('heading', { name: 'Yellow Investigator: Move' })).toBeVisible()
})

test('Jack peek uses Street turn distances when hovering over Jack', async ({ page }) => {
  await page.goto('/')
  for (const id of [33, 46, 147, 159]) await page.getByLabel(`Location ${id}, selectable`).click()
  await page.getByRole('button', { name: 'Lock in four locations' }).click()

  const deployment = page.getByLabel('Available deployment crossings')
  for (const crossing of ['FP', 'HP', 'HZ']) {
    await deployment.getByRole('button', { name: crossing, exact: true }).click()
  }
  await page.getByRole('button', { name: /reveal my view/i }).click()
  await page.getByLabel('Secret Discovery Locations').getByRole('button', { name: '33', exact: true }).click()

  const destinations = page.getByLabel('Legal Jack destinations')
  const destination = Number(await destinations.getByRole('button').first().innerText())
  await destinations.getByRole('button').first().click()
  await page.getByRole('button', { name: 'Record move privately' }).click()
  await expect(page.getByRole('heading', { name: 'Yellow Investigator: Move' })).toBeVisible()
  await page.getByLabel('xings').check()
  await expect(page.locator('.crossing-id-label')).toHaveCount(174)

  const distantCrossing = page.locator('.investigator-route-preview-hover-target').first()
  await distantCrossing.hover()
  await expect(page.locator('.crossing-id-label')).toHaveCount(0)
  const investigatorRouteLines = page.locator('.investigator-route-preview-line')
  expect(await investigatorRouteLines.count()).toBeGreaterThan(0)
  await expect(investigatorRouteLines.first()).toHaveCSS('stroke', 'rgb(4, 98, 199)')
  await expect(investigatorRouteLines.first().evaluate((route) => route.tagName.toLowerCase())).resolves.toBe('polyline')
  const investigatorRouteOutlines = page.locator('.investigator-route-preview-crossing')
  expect(await investigatorRouteOutlines.count()).toBeGreaterThan(0)
  await expect(investigatorRouteOutlines.first()).toHaveCSS('stroke', 'rgb(4, 98, 199)')
  const investigatorRouteTurn = page.locator('.investigator-route-turn-count', { hasText: /^2a$/ }).first()
  await expect(investigatorRouteTurn).toBeVisible()
  await expect(investigatorRouteTurn).toHaveAttribute('text-anchor', 'middle')
  await page.getByLabel('alt').check()
  await distantCrossing.hover()
  await expect(investigatorRouteTurn).toHaveAttribute('text-anchor', 'start')
  await page.getByLabel('alt').uncheck()
  await distantCrossing.hover()
  await expect(page.locator('.investigator-route-turn-count', { hasText: /^1[ab]$/ })).toHaveCount(0)
  await page.mouse.move(0, 0)
  await expect(investigatorRouteLines).toHaveCount(0)
  await expect(page.locator('.crossing-id-label')).toHaveCount(174)

  const legalMoveChoice = page.locator(
    '.investigator-distance-preview-hover-target:not([aria-label^="Crossing FP,"])',
  ).first()
  await legalMoveChoice.hover()
  await expect(page.locator('.crossing-id-label')).toHaveCount(0)
  expect(await page.locator('.investigator-hover-turn-count').count()).toBeGreaterThan(0)
  await expect(page.locator('.investigator-hover-turn-count', { hasText: /^1a$/ }).first()).toBeVisible()
  await expect(page.locator('.investigator-hover-turn-count', { hasText: /^1b$/ }).first()).toBeVisible()
  await expect(page.locator('.investigator-route-preview-line')).toHaveCount(0)
  await expect(page.locator('.investigator-route-preview-crossing')).toHaveCount(0)
  await page.mouse.move(0, 0)
  await expect(page.locator('.crossing-id-label')).toHaveCount(174)

  await page.locator('.investigator-piece.yellow').hover()
  expect(await page.locator('.investigator-hover-turn-count').count()).toBeGreaterThan(0)
  await expect(page.locator('.investigator-hover-turn-count', { hasText: /^1[ab]$/ })).toHaveCount(0)
  await expect(page.locator('.investigator-route-preview-line')).toHaveCount(0)
  await expect(page.locator('.investigator-route-preview-crossing')).toHaveCount(0)
  await page.mouse.move(0, 0)

  await page.locator('.investigator-piece.blue').hover()
  await expect(page.locator('.investigator-hover-turn-count', { hasText: /^1a$/ }).first()).toBeVisible()
  await expect(page.locator('.investigator-hover-turn-count', { hasText: /^1b$/ }).first()).toBeVisible()
  await page.mouse.move(0, 0)

  await page.getByLabel('peek').check()
  await page.locator('.jack-marker').hover()
  await expect(page.locator('.route-turn-count')).toHaveCount(188)
  await expect(page.locator(`[aria-label^="Location ${destination}:"]`)).toHaveCount(0)
  await expect(page.locator('.route-preview-line')).toHaveCount(0)
  await expect(page.locator('.route-preview-location')).toHaveCount(0)
})

test('active investigator can stay by clicking the piece', async ({ page }) => {
  await page.goto('/')
  for (const id of [33, 46, 147, 159]) await page.getByLabel(`Location ${id}, selectable`).click()
  await page.getByRole('button', { name: 'Lock in four locations' }).click()

  const deployment = page.getByLabel('Available deployment crossings')
  for (const crossing of ['FP', 'HP', 'HZ']) {
    await deployment.getByRole('button', { name: crossing, exact: true }).click()
  }
  await page.getByRole('button', { name: /reveal my view/i }).click()
  await page.getByLabel('Secret Discovery Locations').getByRole('button', { name: '33', exact: true }).click()

  const destinations = page.getByLabel('Legal Jack destinations')
  await destinations.getByRole('button').first().click()
  await page.getByRole('button', { name: 'Record move privately' }).click()
  await expect(page.getByRole('heading', { name: 'Yellow Investigator: Move' })).toBeVisible()
  await expect(page.getByLabel('Legal yellow Investigator destinations').getByRole('button').first()).toHaveText('FP')

  const yellow = page.getByLabel('Yellow Investigator at crossing FP, selectable to stay')
  const positionBefore = await yellow.locator('circle').last().evaluate((circle) => ({
    x: circle.getAttribute('cx'),
    y: circle.getAttribute('cy'),
  }))
  await yellow.click()

  await expect(page.getByRole('heading', { name: 'Blue Investigator: Move' })).toBeVisible()
  await expect(page.locator('.investigator-piece.blue .active-investigator-ring')).toBeVisible()
  await expect(page.getByLabel('Yellow Investigator at crossing FP')).toBeVisible()
  expect(
    await page.locator('.investigator-piece.yellow circle').last().evaluate((circle) => ({
      x: circle.getAttribute('cx'),
      y: circle.getAttribute('cy'),
    })),
  ).toEqual(positionBefore)
})

test('moving to a hovered crossing clears its shortest-path indicators', async ({ page }) => {
  await page.goto('/')
  for (const id of [33, 46, 147, 159]) await page.getByLabel(`Location ${id}, selectable`).click()
  await page.getByRole('button', { name: 'Lock in four locations' }).click()

  const deployment = page.getByLabel('Available deployment crossings')
  for (const crossing of ['FP', 'HP', 'HZ']) {
    await deployment.getByRole('button', { name: crossing, exact: true }).click()
  }
  await page.getByRole('button', { name: /reveal my view/i }).click()
  await page.getByLabel('Secret Discovery Locations').getByRole('button', { name: '33', exact: true }).click()
  await page.getByLabel('Legal Jack destinations').getByRole('button').first().click()
  await page.getByRole('button', { name: 'Record move privately' }).click()

  const moveChoice = page.locator(
    '.investigator-distance-preview-hover-target:not([aria-label^="Crossing FP,"])',
  ).first()
  await moveChoice.hover()
  expect(await page.locator('.investigator-hover-turn-count').count()).toBeGreaterThan(0)
  await moveChoice.click()

  await expect(page.getByRole('heading', { name: 'Blue Investigator: Move' })).toBeVisible()
  await expect(page.locator('.investigator-hover-turn-count')).toHaveCount(0)
  await expect(page.locator('.investigator-route-turn-count')).toHaveCount(0)
  await expect(page.locator('.investigator-route-preview-line')).toHaveCount(0)
  await expect(page.locator('.investigator-route-preview-crossing')).toHaveCount(0)

  await page.mouse.move(0, 0)
  await page.locator('.investigator-piece.yellow').hover()
  expect(await page.locator('.investigator-hover-turn-count').count()).toBeGreaterThan(0)
})

test('Rand enters the public investigator view without a reveal handoff', async ({ page }) => {
  await page.goto('/')
  const rand = page.getByRole('button', { name: 'Rand', exact: true })
  for (let selection = 0; selection < 4; selection += 1) await rand.click()
  await rand.click()

  await expect(page.getByRole('heading', { name: /Deploy the Yellow Investigator/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /reveal my view/i })).toHaveCount(0)
  await expect(page.locator('.investigator-turn-announcement')).toHaveText('Investigators’ Turn')
  await expect(page.locator('.investigator-turn-announcement')).toBeHidden({ timeout: 2500 })
})

test('discovery choices only outline quadrants that still need a location', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Location 33, selectable').click()

  await expect(page.getByLabel('Location 34, selectable')).toHaveCount(0)
  await expect(page.getByLabel('Location 34', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Location 33, selectable').locator('xpath=..').locator('.legal-circle')).toHaveCount(0)

  // The selected location remains clickable so Jack can clear that quadrant.
  await page.getByLabel('Location 33, selectable').click()
  await expect(page.getByLabel('Location 34, selectable')).toBeVisible()
})

test('Rand Side completes each side without showing that side its results', async ({ page }) => {
  await page.goto('/')
  const randSide = page.getByRole('button', { name: 'Rand Side', exact: true })

  const historyControls = page.getByLabel('Action history controls')
  await expect(historyControls.locator(':scope > *').last()).toHaveClass(/action-counter/)
  const undoSide = page.getByRole('button', { name: 'Undo Side', exact: true })
  const undo = page.getByRole('button', { name: 'Undo', exact: true })
  expect(Number.parseFloat(await undoSide.evaluate((button) => getComputedStyle(button).fontSize)))
    .toBeLessThan(Number.parseFloat(await undo.evaluate((button) => getComputedStyle(button).fontSize)))
  expect((await undoSide.boundingBox())!.width).toBeLessThan(60)

  await expect(undoSide).toBeDisabled()
  await randSide.click()
  await expect(page.getByRole('heading', { name: /Deploy the Yellow Investigator/i })).toBeVisible()

  await randSide.click()
  await expect(page.getByRole('heading', { name: 'Pass the device to Jack' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Investigator Deployment Results' })).toHaveCount(0)
  await page.getByRole('button', { name: /reveal my view/i }).click()

  await randSide.click()
  await expect(page.getByRole('heading', { name: 'Yellow Investigator: Move' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Record move privately' })).toHaveCount(0)
  await randSide.click()
  await expect(page.getByRole('heading', { name: 'Pass the device to Jack' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Investigator Results' })).toHaveCount(0)
})

test('undoes Coach route locations onto the redo stack', async ({ page }) => {
  await page.goto('/')
  for (const id of [33, 46, 147, 159]) await page.getByLabel(`Location ${id}, selectable`).click()
  await page.getByRole('button', { name: 'Lock in four locations' }).click()

  const deployment = page.getByLabel('Available deployment crossings')
  for (const crossing of ['FP', 'HP', 'HZ']) {
    await deployment.getByRole('button', { name: crossing, exact: true }).click()
  }
  await page.getByRole('button', { name: /reveal my view/i }).click()
  await page.getByLabel('Secret Discovery Locations').getByRole('button', { name: '33', exact: true }).click()
  const coachReachableRings = page.locator('.coach-reachable-circle')
  expect(await coachReachableRings.count()).toBeGreaterThan(0)
  await expect(coachReachableRings.first()).toHaveCSS('stroke', 'rgb(46, 230, 107)')
  await expect(coachReachableRings.first()).toHaveCSS('stroke-dasharray', '5px, 3px')
  await expect(page.locator('.coach-reachable-circle-gap').first()).toHaveCSS('stroke', 'rgb(20, 156, 255)')
  await expect(page.getByText('Reachable via Coach', { exact: true })).toBeVisible()
  const coachReachableLegend = page.locator('.legend-dot.coach-reachable')
  await expect(coachReachableLegend).toHaveCSS('border-color', 'rgb(20, 156, 255)')
  expect(await coachReachableLegend.evaluate((element) => getComputedStyle(element, '::after').borderColor)).toBe(
    'rgb(46, 230, 107)',
  )
  const coachPreview = page.getByLabel('coach')
  await expect(coachPreview).toBeChecked()
  await coachPreview.uncheck()
  await expect(coachReachableRings).toHaveCount(0)
  await expect(page.getByText('Reachable via Coach', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Coach (2)', exact: true }).click()
  expect(await coachReachableRings.count()).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Street', exact: true }).click()
  await expect(coachReachableRings).toHaveCount(0)
  await page.reload()
  await expect(coachPreview).not.toBeChecked()
  await expect(coachReachableRings).toHaveCount(0)
  await coachPreview.check()
  expect(await coachReachableRings.count()).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Alley (2)', exact: true }).click()
  await expect(coachReachableRings).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Boat (2)', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Coach (2)', exact: true }).click()
  expect(await coachReachableRings.count()).toBeGreaterThan(0)

  const destinations = page.getByLabel('Legal Jack destinations')
  const first = destinations.getByRole('button').first()
  const firstId = await first.innerText()
  await first.click()
  await expect(coachReachableRings).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Undo 2nd Loc.', exact: true })).toHaveCount(0)

  const second = destinations.getByRole('button').first()
  const secondId = await second.innerText()
  await second.click()
  const undoSecond = page.getByRole('button', { name: 'Undo 2nd Loc.', exact: true })
  await expect(undoSecond).toBeVisible()
  await expect(page.getByLabel('15 player actions')).toHaveText('Actions 15')
  await expect(page.locator('.private-route-summary strong')).toHaveText(`33 → ${firstId} → ${secondId}`)
  await expect(page.getByRole('button', { name: 'Record move privately' })).toBeEnabled()
  await expect(undoSecond.evaluate((button) => button.previousElementSibling?.textContent?.trim())).resolves.toBe(
    'Undo route',
  )

  await undoSecond.click()
  await expect(undoSecond).toHaveCount(0)
  await expect(page.getByLabel('14 player actions')).toHaveText('Actions 14')
  await expect(page.locator('.private-route-summary strong')).toHaveText(`33 → ${firstId}`)
  await expect(page.getByRole('button', { name: 'Record move privately' })).toBeDisabled()
  await expect(destinations.getByRole('button', { name: secondId, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled()

  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(undoSecond).toBeVisible()
  await expect(page.getByLabel('15 player actions')).toHaveText('Actions 15')
  await expect(page.locator('.private-route-summary strong')).toHaveText(`33 → ${firstId} → ${secondId}`)

  await page.getByRole('button', { name: 'Undo route', exact: true }).click()
  await expect(page.locator('.private-route-summary strong')).toHaveText('33')
  await expect(page.getByLabel('13 player actions')).toHaveText('Actions 13')
  await expect(page.getByRole('button', { name: 'Undo route', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(page.locator('.private-route-summary strong')).toHaveText(`33 → ${firstId}`)
  await expect(page.getByLabel('14 player actions')).toHaveText('Actions 14')
})

test('plays a complete hot-seat turn without exposing Jack during handoffs', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Whitehall Mystery' })).toBeVisible()
  await expect(page.locator('.game-board')).toHaveAttribute('viewBox', '70 10 1100 1090')

  for (const id of [33, 46, 147, 159]) {
    await page.getByLabel(`Location ${id}, selectable`).click()
  }
  await page.getByRole('button', { name: 'Lock in four locations' }).click()

  await expect(page.getByRole('heading', { name: /Deploy the Yellow Investigator/i })).toBeVisible()
  await expect(page.locator('.investigator-turn-announcement')).toHaveText('Investigators’ Turn')
  await expect(page.getByRole('heading', { name: 'Pass the device to Investigators' })).toHaveCount(0)
  await expect(page.getByText('Private route')).toHaveCount(0)
  const setupJackPeek = page.getByRole('checkbox', { name: 'peek', exact: true })
  await expect(page.locator('label.jack-peek-toggle')).toHaveAttribute(
    'title',
    "peek at Jack's current location and path this round",
  )
  await expect(setupJackPeek).toBeVisible()
  await expect(page.locator('.private-discovery-marker')).toHaveCount(0)
  await setupJackPeek.check()
  await expect(page.locator('.private-discovery-marker')).toHaveCount(4)
  await setupJackPeek.uncheck()
  await expect(page.locator('.private-discovery-marker')).toHaveCount(0)

  const deployment = page.getByLabel('Available deployment crossings')
  for (const crossing of ['FP', 'HP', 'HZ']) {
    await deployment.getByRole('button', { name: crossing, exact: true }).click()
  }
  await expect(page.getByRole('heading', { name: 'Pass the device to Jack' })).toBeVisible()
  await page.getByRole('button', { name: /reveal my view/i }).click()

  await page.getByLabel('Secret Discovery Locations').getByRole('button', { name: '33', exact: true }).click()
  const jackPositionGuides = page.locator('.jack-location-edge-arrows')
  await expect(jackPositionGuides.locator('polygon')).toHaveCount(4)
  await expect(jackPositionGuides.locator('polygon').first()).toHaveAttribute('points', /,10 /)
  await expect(jackPositionGuides).toHaveCSS('color', 'rgb(255, 3, 167)')
  await expect(jackPositionGuides.locator('.edge-guide-line')).toHaveCount(4)
  await expect(jackPositionGuides.locator('.edge-guide-line').first()).toHaveCSS('stroke-width', '0.6px')
  await expect(jackPositionGuides.locator('.edge-guide-line').first()).toHaveCSS('opacity', '0.4')
  const jackGuideClearances = await jackPositionGuides.locator('.edge-guide-line').evaluateAll((lines) => {
    const marker = document.querySelector('.jack-marker circle')
    if (!(marker instanceof SVGCircleElement)) return []
    const x = Number(marker.getAttribute('cx'))
    const y = Number(marker.getAttribute('cy'))
    return lines.map((line) =>
      Math.hypot(x - Number(line.getAttribute('x2')), y - Number(line.getAttribute('y2'))),
    )
  })
  expect(jackGuideClearances).toEqual([12, 12, 12, 12])
  const discoveryList = page.getByLabel('Jack discovery locations')
  await expect(discoveryList.locator('li')).toHaveText(['33', '46', '147', '159'])
  await expect(page.getByLabel('33, completed')).toHaveClass(/completed/)
  await expect(page.getByLabel('46, remaining')).toBeVisible()
  await expect(page.locator('.private-discovery-marker')).toHaveCount(3)
  await expect(page.locator('.private-discovery-marker').first()).toHaveCSS('stroke', 'rgb(150, 25, 25)')
  const destinations = page.getByLabel('Legal Jack destinations')
  const firstDestination = Number(await destinations.getByRole('button').first().innerText())
  await destinations.getByRole('button').first().click()
  const selectedOutline = page.locator('.selected-circle')
  await expect(selectedOutline).toHaveAttribute('r', '18.5')
  await expect(selectedOutline).toHaveCSS('stroke-width', '2px')
  await expect(selectedOutline).toHaveCSS('stroke', 'rgb(255, 3, 167)')
  const plannedSegment = page.locator('.private-route')
  await expect(plannedSegment).toHaveCount(1)
  await expect(plannedSegment).toHaveCSS('stroke-width', '5px')
  await expect(plannedSegment).toHaveCSS('stroke', 'rgb(255, 3, 167)')
  const routeEndClearance = await plannedSegment.evaluate((line, destinationId) => {
    const destination = document.querySelector(`[aria-label="Location ${destinationId}, selectable"]`)
    if (!(line instanceof SVGLineElement) || !(destination instanceof SVGCircleElement)) return 0
    return Math.hypot(
      Number(destination.getAttribute('cx')) - Number(line.getAttribute('x2')),
      Number(destination.getAttribute('cy')) - Number(line.getAttribute('y2')),
    )
  }, firstDestination)
  expect(routeEndClearance).toBeGreaterThanOrEqual(18.4)
  await page.getByLabel(`Location ${firstDestination}, selectable`).click({ button: 'middle' })

  await expect(page.getByRole('heading', { name: 'Yellow Investigator: Move' })).toBeVisible()
  await expect(page.locator('label.possibility-toggle')).toHaveAttribute(
    'title',
    "show what places are useful to search/arrest because Jack may be/was there; does not show places that he could have been but can't be now and searching would not help narrow down where he is",
  )
  await expect(page.getByLabel('inv auto')).toBeVisible()
  await expect(page.getByRole('button', { name: /reveal my view/i })).toHaveCount(0)
  await expect(page.getByText('Reachable via Coach', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Private route')).toHaveCount(0)
  await page.locator('.app-header').click()
  await expect(page.locator('.public-log').getByText('M1: Jack advanced to move 1.')).toBeVisible()

  await page.getByLabel('maybes').check()
  await page.reload()
  await expect(page.getByLabel('maybes')).toBeChecked()
  await expect(page.locator('.jack-location-edge-arrows')).toHaveCount(0)
  await expect(page.locator('.track-location')).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: 'past', exact: true })).toHaveCount(0)
  await expect(page.locator('.possible-marker').first()).toBeVisible()
  await expect(page.locator('.investigator-piece.yellow .active-investigator-ring')).toBeVisible()
  await expect(page.locator('.board-scroll')).toHaveClass(/active-investigator-yellow/)
  const positionGuides = page.locator('.active-investigator-edge-arrows')
  await expect(positionGuides.locator('polygon')).toHaveCount(4)
  await expect(positionGuides).toHaveCSS('color', 'rgb(136, 255, 51)')
  await expect(positionGuides).toHaveCSS('opacity', '1')
  await expect(positionGuides.locator('.edge-guide-line')).toHaveCount(4)
  const investigatorGuideClearances = await positionGuides.locator('.edge-guide-line').evaluateAll((lines) => {
    const ring = document.querySelector('.investigator-piece.yellow .active-investigator-ring')
    if (!(ring instanceof SVGCircleElement)) return []
    const x = Number(ring.getAttribute('cx'))
    const y = Number(ring.getAttribute('cy'))
    return lines.map((line) =>
      Math.hypot(x - Number(line.getAttribute('x2')), y - Number(line.getAttribute('y2'))),
    )
  })
  expect(investigatorGuideClearances).toEqual([16, 16, 16, 16])

  const jackPeek = page.getByRole('checkbox', { name: 'peek', exact: true })
  await jackPeek.check()
  await page.reload()
  await expect(jackPeek).toBeChecked()
  await expect(page.locator('.jack-marker')).toBeVisible()
  await expect(page.locator('.jack-location-edge-arrows polygon')).toHaveCount(4)
  await expect(page.locator('.past-path-line')).toBeVisible()
  await expect(page.locator('.past-path-step')).toHaveCount(1)
  await expect(page.locator('.discovery-marker')).toHaveCount(1)
  await expect(page.locator('.private-discovery-marker')).toHaveCount(3)
  await expect(page.locator('.track-location')).toHaveText(['33', String(firstDestination)])
  await jackPeek.uncheck()
  await expect(page.locator('.jack-marker')).toHaveCount(0)
  await expect(page.locator('.past-path-line')).toHaveCount(0)
  await expect(page.locator('.private-discovery-marker')).toHaveCount(0)
  await expect(page.locator('.track-location')).toHaveCount(0)
  await jackPeek.check()

  await page.getByLabel('Yellow Investigator at crossing FP, selectable to stay').click()
  await expect(page.locator('.investigator-piece.blue .active-investigator-ring')).toBeVisible()
  await expect(page.locator('.board-scroll')).toHaveClass(/active-investigator-blue/)
  for (const crossing of ['HP', 'HZ']) await page.getByRole('button', { name: crossing, exact: true }).click()
  await expect(page.getByRole('button', { name: 'Search for clues' })).toHaveClass(/primary-button/)
  const arrestTargetId = await page.locator('.map-hit-target.selectable').evaluateAll((targets, jackId) =>
    targets
      .map((target) => Number(target.getAttribute('aria-label')?.match(/Location (\d+)/)?.[1]))
      .find((id) => id !== jackId), firstDestination)
  await page.getByLabel(`Location ${arrestTargetId}, selectable`).click({ button: 'middle' })
  await expect(page.locator('.investigator-piece.blue .active-investigator-ring')).toBeVisible()
  await page.getByRole('button', { name: 'Execute arrest' }).click()
  const arrestModeTarget = page.locator('.map-hit-target.selectable').first()
  await arrestModeTarget.click({ button: 'middle' })
  await expect(page.locator('.investigator-piece.red .active-investigator-ring')).toBeVisible()
  await page.getByRole('button', { name: 'Pass', exact: true }).click()
  await expect(page.getByText('Results shown · Click anywhere on the map to continue')).toBeVisible()
  await page.getByRole('img', { name: 'Whitehall game board' }).click({ position: { x: 5, y: 5 } })

  await expect(page.getByRole('heading', { name: 'Pass the device to Jack' })).toBeVisible()
  await expect(page.getByText('Private route')).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Pass the device to Jack' })).toBeVisible()
  await page.getByRole('button', { name: /reveal my view/i }).click()
  await expect(page.getByText('Round 1 · Move 1 of 15')).toBeVisible()
  await expect(page.getByLabel('Move 0, location 33')).toContainText('33')
  await expect(page.getByLabel(`Move 1, location ${firstDestination}`)).toContainText(String(firstDestination))
  const pastPathToggle = page.getByRole('checkbox', { name: 'past', exact: true })
  await pastPathToggle.check()
  await expect(page.locator('.past-path-line')).toBeVisible()
  await expect(page.locator('.past-path-line')).toHaveCSS('stroke-dasharray', '5px, 3px')
  await expect(page.getByLabel(`Past path move 1, location ${firstDestination}`)).toBeVisible()
  await expect(page.locator('.past-path-step')).toHaveCount(1)
  const pastPathClearances = await page.locator('.past-path-line').evaluate((line, destinationId) => {
    const start = document.querySelector('[aria-label^="Location 33"]')
    const destination = document.querySelector(`[aria-label^="Location ${destinationId}"]`)
    if (!(line instanceof SVGLineElement) || !(start instanceof SVGCircleElement) || !(destination instanceof SVGCircleElement)) {
      return [0, 0]
    }
    return [
      Math.hypot(
        Number(start.getAttribute('cx')) - Number(line.getAttribute('x1')),
        Number(start.getAttribute('cy')) - Number(line.getAttribute('y1')),
      ),
      Math.hypot(
        Number(destination.getAttribute('cx')) - Number(line.getAttribute('x2')),
        Number(destination.getAttribute('cy')) - Number(line.getAttribute('y2')),
      ),
    ]
  }, firstDestination)
  expect(pastPathClearances[0]).toBeGreaterThanOrEqual(18.4)
  expect(pastPathClearances[1]).toBeGreaterThanOrEqual(18.4)
  await page.reload()
  await expect(page.getByRole('checkbox', { name: 'past', exact: true })).toBeChecked()
  await expect(page.locator('.past-path-line')).toBeVisible()

  await page.getByLabel('xings').check()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'New game' }).click()
  await expect(page.getByRole('heading', { name: 'Jack: Plan the Crime' })).toBeVisible()
  await expect(page.getByLabel('xings')).toBeChecked()
  await expect.poll(() => page.evaluate(() => ({
    maybes: localStorage.getItem('whitehall-mystery.show-possible-locations'),
    peek: localStorage.getItem('whitehall-mystery.show-jack-peek'),
    pastPath: localStorage.getItem('whitehall-mystery.show-past-path'),
  }))).toEqual({ maybes: 'true', peek: 'true', pastPath: 'true' })
})

test('remembers the investigator auto preference', async ({ page }) => {
  await page.goto('/')
  for (const id of [33, 46, 147, 159]) await page.getByLabel(`Location ${id}, selectable`).click()
  await page.getByRole('button', { name: 'Lock in four locations' }).click()
  await page.locator('.app-header').click()

  const investigatorAuto = page.getByLabel('inv auto')
  await investigatorAuto.check()
  await page.reload()
  await expect(page.getByLabel('inv auto')).toBeChecked()
})

test('keeps the mobile layout within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('.game-board')).toBeVisible()
  await expect(page.getByRole('button', { name: /zoom/i })).toHaveCount(0)
  await expect(page.getByText('New possible Jack location', { exact: true })).toBeVisible()
  const newPossibleLegend = page.locator('.legend-dot.new-possible')
  await expect(newPossibleLegend).toHaveCSS('border-color', 'rgb(255, 3, 167)')
  expect(await newPossibleLegend.evaluate((element) => getComputedStyle(element, '::after').borderColor)).toBe(
    'rgb(122, 60, 175)',
  )
  await expect(page.locator('.crossing-id-label')).toHaveCount(0)
  await page.getByLabel('xings').check()
  await expect(page.locator('.crossing-id-label')).toHaveCount(174)
  await page.reload()
  await expect(page.getByLabel('xings')).toBeChecked()
  await expect(page.locator('.crossing-id-label')).toHaveCount(174)
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }))
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport)
})

test('caps and aligns the map for single- and two-column layouts', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1200 })
  await page.goto('/')

  const mapBounds = await page.locator('.game-board').boundingBox()
  const viewportBounds = await page.locator('.board-scroll').boundingBox()
  const controlBounds = await page.locator('.control-panel').boundingBox()
  const layoutBounds = await page.locator('.game-layout').boundingBox()
  const trackBounds = await page.locator('.move-track').boundingBox()
  expect(mapBounds).not.toBeNull()
  expect(viewportBounds).not.toBeNull()
  expect(controlBounds).not.toBeNull()
  expect(layoutBounds).not.toBeNull()
  expect(trackBounds).not.toBeNull()
  expect(mapBounds!.width).toBeLessThanOrEqual(900)
  expect(mapBounds!.height).toBeLessThanOrEqual(900)
  expect(viewportBounds!.width).toBeLessThanOrEqual(900)
  expect(viewportBounds!.height).toBeLessThanOrEqual(900)
  expect(controlBounds!.x - (viewportBounds!.x + viewportBounds!.width)).toBeLessThanOrEqual(14)
  expect(layoutBounds!.width).toBe(1318)
  expect(trackBounds!.width).toBe(layoutBounds!.width)

  await page.setViewportSize({ width: 1000, height: 1200 })
  const singleColumnMap = await page.locator('.board-scroll').boundingBox()
  const boardPanel = await page.locator('.board-panel').boundingBox()
  expect(singleColumnMap).not.toBeNull()
  expect(boardPanel).not.toBeNull()
  const leftGap = singleColumnMap!.x - boardPanel!.x
  const rightGap = boardPanel!.x + boardPanel!.width - (singleColumnMap!.x + singleColumnMap!.width)
  expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(1)
})

test('scales pieces and outline strokes with the map', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1400 })
  await page.goto('/')
  const randSide = page.getByRole('button', { name: 'Rand Side', exact: true })
  await randSide.click()
  await randSide.click()
  await page.getByRole('button', { name: /reveal my view/i }).click()
  await page.getByLabel('Secret Discovery Locations').getByRole('button').first().click()

  const board = page.locator('.game-board')
  const investigator = page.locator('.investigator-piece circle:not(.active-investigator-ring)').first()
  const jack = page.locator('.jack-marker circle')
  const outline = page.locator('.legal-circle').first()
  await expect(investigator).toHaveAttribute('r', '9')
  await expect(jack).toHaveAttribute('r', '10')
  await expect(outline).toHaveCSS('vector-effect', 'none')
  await expect(investigator).toHaveCSS('vector-effect', 'none')

  const large = {
    board: await board.boundingBox(),
    investigator: await investigator.boundingBox(),
    jack: await jack.boundingBox(),
  }
  await page.setViewportSize({ width: 700, height: 1200 })
  const small = {
    board: await board.boundingBox(),
    investigator: await investigator.boundingBox(),
    jack: await jack.boundingBox(),
  }
  expect(large.board).not.toBeNull()
  expect(large.investigator).not.toBeNull()
  expect(large.jack).not.toBeNull()
  expect(small.board).not.toBeNull()
  expect(small.investigator).not.toBeNull()
  expect(small.jack).not.toBeNull()
  const mapScale = small.board!.width / large.board!.width
  expect(small.investigator!.width / large.investigator!.width).toBeCloseTo(mapScale, 2)
  expect(small.jack!.width / large.jack!.width).toBeCloseTo(mapScale, 2)
})

test('undoes and redoes actions across private-view handoffs', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('0 player actions')).toHaveText('Actions 0')
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()

  for (const id of [33, 46, 147, 159]) {
    await page.getByLabel(`Location ${id}, selectable`).click()
  }
  await expect(page.getByLabel('4 player actions')).toHaveText('Actions 4')

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByLabel('2 player actions')).toHaveText('Actions 2')
  await page.getByLabel('Location 147, selectable').click()
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(page.getByLabel('4 player actions')).toHaveText('Actions 4')

  await page.getByRole('button', { name: 'Lock in four locations' }).click()
  await expect(page.getByRole('button', { name: 'Undo!', exact: true })).toBeEnabled()

  await page.getByRole('button', { name: 'Undo!', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Pass the device to Jack' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Jack: Plan the Crime' })).toBeVisible()
  await expect(page.getByLabel('3 player actions')).toHaveText('Actions 3')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Jack: Plan the Crime' })).toBeVisible()
  await expect(page.getByLabel('4 player actions')).toHaveText('Actions 4')

  await page.getByRole('button', { name: 'Lock in four locations' }).click()
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled()
  await expect(page.getByRole('heading', { name: /Deploy the Yellow Investigator/i })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled()
})

test('bulk redo from a handoff dismisses the handoff screen', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Undo Side', exact: true })).toBeDisabled()

  for (const id of [33, 46, 147, 159]) await page.getByLabel(`Location ${id}, selectable`).click()
  await page.getByRole('button', { name: 'Lock in four locations' }).click()
  await page.getByLabel('Available deployment crossings').getByRole('button', { name: 'FP', exact: true }).click()
  await expect(page.getByLabel('6 player actions')).toHaveText('Actions 6')

  await page.getByRole('button', { name: 'Undo Side', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Pass the device to Jack' })).toBeVisible()
  await expect(page.getByText(/restored just before their last confirmed action/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Redo Side', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Redo Side', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Deploy the Blue Investigator/i })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Pass the device to Investigators/i })).toHaveCount(0)
  await expect(page.getByLabel('6 player actions')).toHaveText('Actions 6')
  await expect(page.getByRole('button', { name: 'Redo Side', exact: true })).toBeDisabled()
})

test('draws a clue ring outside a valid-choice ring at the same location', async ({ page }) => {
  await page.goto('/')
  for (const id of [33, 46, 121, 147]) await page.getByLabel(`Location ${id}, selectable`).click()
  await page.getByRole('button', { name: 'Lock in four locations' }).click()

  const deployment = page.getByLabel('Available deployment crossings')
  for (const crossing of ['FP', 'HP', 'HZ']) {
    await deployment.getByRole('button', { name: crossing, exact: true }).click()
  }
  await page.getByRole('button', { name: /reveal my view/i }).click()
  await page.getByLabel('Secret Discovery Locations').getByRole('button', { name: '121', exact: true }).click()
  await page.getByLabel('Legal Jack destinations').getByRole('button', { name: '104', exact: true }).click()
  await page.getByRole('button', { name: 'Record move privately' }).click()
  await page.locator('.app-header').click()

  await page.getByLabel('Legal yellow Investigator destinations').getByRole('button', { name: 'FR', exact: true }).click()
  await page.getByLabel('Legal blue Investigator destinations').getByRole('button', { name: 'FP', exact: true }).click()
  await page.getByLabel('Legal red Investigator destinations').getByRole('button', { name: 'HZ', exact: true }).click()

  await page.getByRole('button', { name: 'Search for clues' }).click()
  await page.getByLabel('Locations adjacent to the yellow Investigator').getByRole('button', { name: '104', exact: true }).click()
  await page.getByRole('button', { name: 'Search for clues' }).click()

  const clue = page.locator('.clue-marker.encircling-legal')
  await expect(clue).toHaveCount(1)
  await expect(clue).toHaveAttribute('r', '23')
  await expect(clue).toHaveCSS('stroke', 'rgb(225, 173, 0)')

  const ringGeometry = await clue.evaluate((clueElement) => {
    const cx = clueElement.getAttribute('cx')
    const cy = clueElement.getAttribute('cy')
    const legal = [...document.querySelectorAll('.legal-circle')].find(
      (element) => element.getAttribute('cx') === cx && element.getAttribute('cy') === cy,
    )
    if (!(legal instanceof SVGCircleElement)) return null
    return {
      clueRadius: Number(clueElement.getAttribute('r')),
      legalRadius: Number(legal.getAttribute('r')),
      legalStroke: getComputedStyle(legal).stroke,
    }
  })
  expect(ringGeometry).toEqual({ clueRadius: 23, legalRadius: 18.5, legalStroke: 'rgb(46, 230, 107)' })
})

test('previews positive and negative search outcomes for Jack maybes', async ({ page }) => {
  await page.goto('/')
  for (const id of [33, 46, 147, 159]) await page.getByLabel(`Location ${id}, selectable`).click()
  await page.getByRole('button', { name: 'Lock in four locations' }).click()

  const deployment = page.getByLabel('Available deployment crossings')
  for (const crossing of ['FP', 'HP', 'HZ']) {
    await deployment.getByRole('button', { name: crossing, exact: true }).click()
  }
  await page.getByRole('button', { name: /reveal my view/i }).click()
  await page.getByLabel('Secret Discovery Locations').getByRole('button', { name: '33', exact: true }).click()
  await page.getByLabel('Legal Jack destinations').getByRole('button').first().click()
  await page.getByRole('button', { name: 'Record move privately' }).click()
  await page.locator('.app-header').click()

  await page.getByLabel('Legal yellow Investigator destinations').getByRole('button', { name: 'FP', exact: true }).click()
  await page.getByLabel('Legal blue Investigator destinations').getByRole('button', { name: 'HP', exact: true }).click()
  await page.getByLabel('Legal red Investigator destinations').getByRole('button', { name: 'HZ', exact: true }).click()
  for (let index = 0; index < 3; index += 1) await page.getByRole('button', { name: 'Pass', exact: true }).click()
  await expect(page.getByText('Results shown · Click anywhere on the map to continue')).toBeVisible()
  await page.getByRole('img', { name: 'Whitehall game board' }).click({ position: { x: 5, y: 5 } })

  await page.getByRole('button', { name: /reveal my view/i }).click()
  await page.getByLabel('Legal Jack destinations').getByRole('button').first().click()
  await page.getByRole('button', { name: 'Record move privately' }).click()
  await page.locator('.app-header').click()
  await page.getByLabel('maybes').check()

  const outcomeCount = page.locator('[aria-label^="Search outcome at 13:"]')
  await expect(outcomeCount).toHaveText('40/12')
  await expect(page.locator('[aria-label^="Search outcome at 33:"]')).toHaveCount(0)
  await expect(outcomeCount.locator('.outcome-count-no')).toHaveCSS('fill', 'rgb(18, 63, 104)')
  await expect(outcomeCount.locator('.outcome-count-yes')).toHaveCSS('fill', 'rgb(255, 3, 167)')
  await expect(page.locator('.possible-marker').first()).toBeVisible()
  const certaintyMarker = page.locator('.possible-certainty-marker').first()
  await expect(certaintyMarker).toHaveCSS('stroke', 'rgb(255, 3, 167)')
  const certaintyPresentation = await certaintyMarker.evaluate((pinkRing) => {
    const purpleRing = pinkRing.nextElementSibling
    return {
      pinkRadius: pinkRing.getAttribute('r'),
      purpleRadius: purpleRing?.getAttribute('r'),
      purpleStroke: purpleRing ? getComputedStyle(purpleRing).stroke : null,
      purpleDashes: purpleRing ? getComputedStyle(purpleRing).strokeDasharray : null,
    }
  })
  expect(certaintyPresentation).toEqual({
    pinkRadius: '23',
    purpleRadius: '23',
    purpleStroke: 'rgb(122, 60, 175)',
    purpleDashes: '3px, 3px',
  })

  await page.getByLabel('Location 13', { exact: true }).hover()
  await expect(page.locator('.possible-marker')).toHaveCount(0)
  await expect(page.locator('.possible-outcome-no').first()).toBeVisible()
  await expect(page.locator('.possible-outcome-yes').first()).toBeVisible()

  const dualOutcomeRings = await page.getByLabel('Location 10', { exact: true }).evaluate((target) => {
    const cx = target.getAttribute('cx')
    const cy = target.getAttribute('cy')
    const ring = (className: string) =>
      [...document.querySelectorAll(className)].find(
        (element) => element.getAttribute('cx') === cx && element.getAttribute('cy') === cy,
      )
    const noRing = ring('.possible-outcome-no')
    const yesRing = ring('.possible-outcome-yes')
    return {
      noStroke: noRing ? getComputedStyle(noRing).stroke : null,
      yesStroke: yesRing ? getComputedStyle(yesRing).stroke : null,
      gap: noRing && yesRing
        ? Number(yesRing.getAttribute('r')) - Number.parseFloat(getComputedStyle(yesRing).strokeWidth) / 2 -
          (Number(noRing.getAttribute('r')) + Number.parseFloat(getComputedStyle(noRing).strokeWidth) / 2)
        : null,
    }
  })
  expect(dualOutcomeRings).toMatchObject({
    noStroke: 'rgb(18, 63, 104)',
    yesStroke: 'rgb(255, 3, 167)',
  })
  expect(dualOutcomeRings.gap).toBeGreaterThanOrEqual(1)
})
