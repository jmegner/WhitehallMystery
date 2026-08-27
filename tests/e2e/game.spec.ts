import { expect, test } from '@playwright/test'

test('Jack can preview investigator reach and reveal a handoff by clicking the card', async ({ page }) => {
  await page.goto('/')
  const randSide = page.getByRole('button', { name: 'Rand Side', exact: true })
  await randSide.click()
  await randSide.click()

  const handoffCard = page.locator('.handoff-card')
  await expect(handoffCard).toContainText('Pass the device to Jack')
  await handoffCard.click({ position: { x: 20, y: 20 } })
  await expect(page.getByRole('heading', { name: 'Jack: Choose the Starting Location' })).toBeVisible()

  await page.getByLabel('Secret Discovery Locations').getByRole('button').first().click()
  await expect(page.getByText('inv maybes', { exact: true })).toBeVisible()
  await expect(page.locator('.investigator-maybe-crossing')).toHaveCount(0)

  await page.locator('.investigator-piece').first().hover()
  expect(await page.locator('.investigator-maybe-crossing').count()).toBeGreaterThan(0)
  expect(await page.locator('.investigator-maybe-circle').count()).toBeGreaterThan(0)
  const crossingMaybe = page.locator('.investigator-maybe-crossing').first()
  await expect(crossingMaybe).toHaveCSS('stroke', 'rgb(255, 77, 0)')
  await expect(crossingMaybe).toHaveCSS('stroke-width', '2px')
  await expect(crossingMaybe).toHaveAttribute('width', '14')
  await expect(crossingMaybe).toHaveAttribute('height', '14')
  await expect(crossingMaybe.evaluate((element) => element.tagName.toLowerCase())).resolves.toBe('rect')
  await expect(page.locator('.investigator-maybe-circle').first()).toHaveAttribute('r', '21')

  await page.getByText('inv maybes', { exact: true }).click()
  await page.mouse.move(0, 0)
  expect(await page.locator('.investigator-maybe-crossing').count()).toBeGreaterThan(0)
  await expect(page.locator('.hovered-investigator-maybe-crossing')).toHaveCount(0)
  const hoveredPiece = page.locator('.investigator-piece').first()
  const investigatorColor = (await hoveredPiece.getAttribute('class'))?.split(' ')[1]
  await hoveredPiece.hover()
  const coloredCrossingMaybe = page.locator('.hovered-investigator-maybe-crossing').first()
  expect(await page.locator('.hovered-investigator-maybe-circle').count()).toBeGreaterThan(0)
  await expect(coloredCrossingMaybe).toHaveAttribute('width', '18')
  await expect(coloredCrossingMaybe).toHaveClass(new RegExp(`\\b${investigatorColor}\\b`))
  await expect(coloredCrossingMaybe).toHaveCSS('stroke', 'rgb(216, 173, 0)')
  await page.reload()
  await expect(page.getByLabel('inv maybes')).toBeChecked()
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
  await expect(page.getByLabel('Location 34')).toBeVisible()
  await expect(page.getByLabel('Location 33, selectable').locator('xpath=..').locator('.legal-circle')).toHaveCount(0)

  // The selected location remains clickable so Jack can clear that quadrant.
  await page.getByLabel('Location 33, selectable').click()
  await expect(page.getByLabel('Location 34, selectable')).toBeVisible()
})

test('Rand Side completes each side without showing that side its results', async ({ page }) => {
  await page.goto('/')
  const randSide = page.getByRole('button', { name: 'Rand Side', exact: true })

  await expect(page.getByRole('button', { name: 'Undo Side', exact: true })).toBeDisabled()
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
  await page.getByRole('button', { name: 'Alley (2)', exact: true }).click()
  await expect(coachReachableRings).toHaveCount(0)
  await page.getByRole('button', { name: 'Boat (2)', exact: true }).click()
  await expect(coachReachableRings).toHaveCount(0)
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
  await expect(page.getByLabel('14 player actions')).toHaveText('Actions 14')
  await expect(page.locator('.private-route-summary strong')).toHaveText(`33 → ${firstId} → ${secondId}`)
  await expect(page.getByRole('button', { name: 'Record move privately' })).toBeEnabled()
  await expect(undoSecond.evaluate((button) => button.previousElementSibling?.textContent?.trim())).resolves.toBe(
    'Undo route',
  )

  await undoSecond.click()
  await expect(undoSecond).toHaveCount(0)
  await expect(page.getByLabel('13 player actions')).toHaveText('Actions 13')
  await expect(page.locator('.private-route-summary strong')).toHaveText(`33 → ${firstId}`)
  await expect(page.getByRole('button', { name: 'Record move privately' })).toBeDisabled()
  await expect(destinations.getByRole('button', { name: secondId, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled()

  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(undoSecond).toBeVisible()
  await expect(page.getByLabel('14 player actions')).toHaveText('Actions 14')
  await expect(page.locator('.private-route-summary strong')).toHaveText(`33 → ${firstId} → ${secondId}`)

  await page.getByRole('button', { name: 'Undo route', exact: true }).click()
  await expect(page.locator('.private-route-summary strong')).toHaveText('33')
  await expect(page.getByLabel('12 player actions')).toHaveText('Actions 12')
  await expect(page.getByRole('button', { name: 'Undo route', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(page.locator('.private-route-summary strong')).toHaveText(`33 → ${firstId}`)
  await expect(page.getByLabel('13 player actions')).toHaveText('Actions 13')
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
  const setupJackPeek = page.getByRole('checkbox', { name: 'Jack peek', exact: true })
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
  expect(jackGuideClearances).toEqual([13, 13, 13, 13])
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
  await expect(page.getByLabel('inv auto')).toBeVisible()
  await expect(page.getByRole('button', { name: /reveal my view/i })).toHaveCount(0)
  await expect(page.getByText('Reachable via Coach', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Private route')).toHaveCount(0)
  await page.locator('.app-header').click()
  await expect(page.locator('.public-log').getByText('M1: Jack advanced to move 1.')).toBeVisible()

  await page.getByLabel('Jack maybes').check()
  await page.reload()
  await expect(page.getByLabel('Jack maybes')).toBeChecked()
  await expect(page.locator('.jack-location-edge-arrows')).toHaveCount(0)
  await expect(page.locator('.track-location')).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: 'past path', exact: true })).toHaveCount(0)
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
  expect(investigatorGuideClearances).toEqual([17, 17, 17, 17])

  const jackPeek = page.getByRole('checkbox', { name: 'Jack peek', exact: true })
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

  await page.locator('[aria-label="Crossing FP, selectable"]').click()
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
  const pastPathToggle = page.getByRole('checkbox', { name: 'past path', exact: true })
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
  await expect(page.getByRole('checkbox', { name: 'past path', exact: true })).toBeChecked()
  await expect(page.locator('.past-path-line')).toBeVisible()

  await page.getByLabel('crossing ids').check()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'New game' }).click()
  await expect(page.getByRole('heading', { name: 'Jack: Plan the Crime' })).toBeVisible()
  await expect(page.getByLabel('crossing ids')).toBeChecked()
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
  await page.getByLabel('crossing ids').check()
  await expect(page.locator('.crossing-id-label')).toHaveCount(174)
  await page.reload()
  await expect(page.getByLabel('crossing ids')).toBeChecked()
  await expect(page.locator('.crossing-id-label')).toHaveCount(174)
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }))
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport)
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
  await page.getByRole('button', { name: /reveal the restored view/i }).click()
  await expect(page.getByRole('heading', { name: 'Jack: Plan the Crime' })).toBeVisible()
  await expect(page.getByLabel('4 player actions')).toHaveText('Actions 4')

  await page.getByRole('button', { name: 'Lock in four locations' }).click()
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled()
  await expect(page.getByRole('heading', { name: /Deploy the Yellow Investigator/i })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled()
})

test('bulk undo and redo cross sides without exposing private views', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Undo Side', exact: true })).toBeDisabled()

  for (const id of [33, 46, 147, 159]) await page.getByLabel(`Location ${id}, selectable`).click()
  await page.getByRole('button', { name: 'Lock in four locations' }).click()
  await page.getByLabel('Available deployment crossings').getByRole('button', { name: 'FP', exact: true }).click()
  await expect(page.getByLabel('6 player actions')).toHaveText('Actions 6')

  await page.getByRole('button', { name: 'Undo Side', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Pass the device to Jack' })).toBeVisible()
  await expect(page.getByText(/restored just before their last confirmed action/i)).toBeVisible()
  await page.getByRole('button', { name: /reveal the restored view/i }).click()
  await expect(page.getByLabel('4 player actions')).toHaveText('Actions 4')

  await page.getByRole('button', { name: 'Redo All', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Deploy the Blue Investigator/i })).toBeVisible()
  await expect(page.locator('.investigator-turn-announcement')).toHaveText('Investigators’ Turn')
  await expect(page.getByRole('heading', { name: /Pass the device to Investigators/i })).toHaveCount(0)
  await expect(page.getByLabel('6 player actions')).toHaveText('Actions 6')
  await expect(page.getByRole('button', { name: 'Redo All', exact: true })).toBeDisabled()
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
  await page.getByLabel('Jack maybes').check()

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
      noRadius: noRing?.getAttribute('r'),
      noStroke: noRing ? getComputedStyle(noRing).stroke : null,
      yesRadius: yesRing?.getAttribute('r'),
      yesStroke: yesRing ? getComputedStyle(yesRing).stroke : null,
    }
  })
  expect(dualOutcomeRings).toEqual({
    noRadius: '20.5',
    noStroke: 'rgb(18, 63, 104)',
    yesRadius: '26',
    yesStroke: 'rgb(255, 3, 167)',
  })
})
