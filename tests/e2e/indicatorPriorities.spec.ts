import { expect, test, type Page } from '@playwright/test'
import { createInitialGame } from '../../src/game/gameEngine'
import { possibleJackLocationsAfterMove, possibleJackSearchOutcomes, publicMovementPaths, worstCaseCrossingEliminations } from '../../src/game/inference'
import { circles } from '../../src/game/mapData'

async function openHunt(page: Page) {
  const investigatorPositions = { yellow: 'DM', blue: 'FP', red: 'HZ' }
  const state = { ...createInitialGame(), stage: 'investigatorAction', inspectorActionMode: 'search',
    moveSlot: 4, currentJack: 99, discoveryLocations: [51, 46, 147, 159], reachedDiscoveries: [51], investigatorPositions,
    publicRound: { start: 51, observations: [], moves: [1, 2, 3, 4].map(slot => ({
      type: 'normal', startSlot: slot, endSlot: slot, investigatorPositions,
    })) } }
  await page.addInitScript(state => {
    if (localStorage.getItem('whitehall-mystery.game.v1')) return
    localStorage.setItem('whitehall-mystery.game.v1', JSON.stringify({ version: 1, state }))
    localStorage.setItem('whitehall-mystery.show-possible-locations', 'true')
    localStorage.setItem('whitehall-mystery.show-jack-peek', 'true')
  }, state)
  await page.goto('/')
  return state
}

async function expectPositions(page: Page, alternate: boolean, withClues = true) {
  await page.locator('.jack-marker').hover()
  await expect(page.locator('.route-turn-count').first()).toBeVisible()
  const positions = await page.locator('text[data-indicator-kind]').evaluateAll(elements => elements.map(element => ({
    kind: element.getAttribute('data-indicator-kind'),
    angle: element.getAttribute('data-indicator-angle'),
    anchorX: Number(element.getAttribute('data-indicator-x')),
    anchorY: Number(element.getAttribute('data-indicator-y')),
    x: Number(element.getAttribute('x')), y: Number(element.getAttribute('y')),
  })))
  const clues = positions.filter(p => p.kind === 'clue')
  expect(clues.length > 0).toBe(withClues)
  for (const clue of clues) {
    expect(clue.angle).toBe(alternate ? 'right' : 'top')
    expect(clue.x).toBe(clue.anchorX + (alternate ? 16 : 0))
    expect(clue.y).toBe(clue.anchorY - (alternate ? 0 : 16))
  }
  const distances = positions.filter(p => p.kind === 'locationDistance')
  let paired = 0, unpaired = 0
  for (const distance of distances) {
    const hasClue = clues.some(clue => clue.anchorX === distance.anchorX && clue.anchorY === distance.anchorY)
    if (hasClue) paired += 1
    else unpaired += 1
    const diagonal = hasClue && !alternate
    expect(distance.angle).toBe(diagonal ? 'top-right' : 'top')
    expect(distance.x).toBe(distance.anchorX + (diagonal ? 13 : 0))
    expect(distance.y).toBe(distance.anchorY - (diagonal ? 13 : 19))
  }
  expect(paired > 0).toBe(withClues)
  expect(unpaired).toBeGreaterThan(0)
}

test('clue and distance positions stay fixed through Alt, resizing, and hiding clues', async ({ page }) => {
  await openHunt(page)
  for (const width of [1500, 700]) {
    await page.setViewportSize({ width, height: 1400 })
    await expectPositions(page, false)
    if (width === 700) await page.locator('.game-board').screenshot({ path: test.info().outputPath('fixed-indicators.png') })
    await page.getByLabel('alt', { exact: true }).check()
    await expectPositions(page, true)
    if (width === 700) await page.locator('.game-board').screenshot({ path: test.info().outputPath('alternate-indicators.png') })
    await page.getByLabel('alt', { exact: true }).uncheck()
    await expectPositions(page, false)
    await page.getByLabel('maybes').uncheck()
    await expectPositions(page, false, false)
    await page.getByLabel('maybes').check()
  }
})

test('Shift temporarily inverts either saved Alt state without toggling or persisting it', async ({ page }) => {
  await openHunt(page)
  const alt = page.getByLabel('alt', { exact: true })
  const clue = page.locator('.possible-outcome-count[aria-label^="Search outcome at 34:"]')
  const distance = page.locator('.route-turn-count[aria-label^="Location 34:"]')
  const expectAngles = async (alternate: boolean) => {
    await expect(clue).toHaveAttribute('data-indicator-angle', alternate ? 'right' : 'top')
    await expect(distance).toHaveAttribute('data-indicator-angle', alternate ? 'top' : 'top-right')
  }
  for (const savedAlt of [false, true]) {
    await alt.setChecked(savedAlt)
    const stored = await page.evaluate(() => localStorage.getItem('whitehall-mystery.alt-indicator-angle'))
    await page.locator('.jack-marker').hover()
    await expectAngles(savedAlt)
    for (const key of ['ShiftLeft', 'ShiftRight']) {
      await page.keyboard.down(key)
      await expectAngles(!savedAlt)
      // Auto-repeat must leave the temporary state alone.
      await page.keyboard.down(key)
      await expectAngles(!savedAlt)
      await expect(alt).toBeChecked({ checked: savedAlt })
      expect(await page.evaluate(() => localStorage.getItem('whitehall-mystery.alt-indicator-angle'))).toBe(stored)
      await page.keyboard.up(key)
      await expectAngles(savedAlt)
    }
    await page.reload()
    await expect(alt).toBeChecked({ checked: savedAlt })
    await page.locator('.jack-marker').hover()
    await expectAngles(savedAlt)
  }
})

test('lost focus clears Shift and pointer modifiers recover missed key events', async ({ page }) => {
  await openHunt(page)
  const clue = page.locator('.possible-outcome-count[aria-label^="Search outcome at 34:"]')
  await page.keyboard.down('ShiftLeft')
  await expect(clue).toHaveAttribute('data-indicator-angle', 'right')
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect(clue).toHaveAttribute('data-indicator-angle', 'top')
  // A real pointer event recovers Shift when returning with it still held.
  await page.mouse.move(0, 0)
  await expect(clue).toHaveAttribute('data-indicator-angle', 'right')
  await page.keyboard.up('ShiftLeft')
  await expect(clue).toHaveAttribute('data-indicator-angle', 'top')
  // Resynchronize if the browser missed the key-up outside the window.
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true })))
  await expect(clue).toHaveAttribute('data-indicator-angle', 'right')
  await page.mouse.move(10, 10)
  await expect(clue).toHaveAttribute('data-indicator-angle', 'top')
  await page.reload()
  await expect(page.getByLabel('alt', { exact: true })).not.toBeChecked()
  await expect(clue).toHaveAttribute('data-indicator-angle', 'top')
})

test('worst counts use the public evidence, persist, and yield to crossing hover indicators', async ({ page }) => {
  const state = await openHunt(page)
  const worst = page.getByLabel('worst', { exact: true })
  const indicators = page.locator('.crossing-worst-count')
  await expect(indicators).toHaveCount(0)
  await worst.check()
  await worst.hover()
  const expected = new Map([...worstCaseCrossingEliminations(state.publicRound)].filter(([, count]) => count > 0))
  expect(await indicators.allTextContents()).toEqual([...expected.values()].map(String))
  expect(expected.size).toBeGreaterThan(0)
  expect(expected.size).toBeLessThan(174)
  const ranked = [...expected.values()].sort((a, b) => b - a)
  const orangeCutoff = ranked[Math.min(2, ranked.length - 1)]!
  const expectBadgeLayout = async () => {
    const badges = await page.locator('.crossing-worst-indicator').evaluateAll(elements => elements.map(element => {
      const text = element.querySelector('text')!
      const rect = element.querySelector('rect')!
      const textBounds = text.getBBox()
      const context = document.createElement('canvas').getContext('2d')!
      context.font = getComputedStyle(text).font
      const metrics = context.measureText(text.textContent!)
      // SVG's box includes the font's unused ascent/descent space. Check the
      // painted digits vertically, while reserving the full advance width.
      const baselineY = textBounds.y + metrics.fontBoundingBoxAscent
      return {
        crossingId: element.getAttribute('aria-label')!.match(/^Crossing (\w+):/)![1],
        offsetY: (element as SVGGElement).transform.baseVal.consolidate()?.matrix.f ?? 0,
        count: Number(text.textContent),
        x: Number(text.getAttribute('x')), y: Number(text.getAttribute('y')),
        centerX: Number(text.getAttribute('data-indicator-x')), centerY: Number(text.getAttribute('data-indicator-y')),
        angle: text.getAttribute('data-indicator-angle'),
        rectX: Number(rect.getAttribute('x')), rectY: Number(rect.getAttribute('y')),
        width: Number(rect.getAttribute('width')), height: Number(rect.getAttribute('height')),
        textBounds: { x: textBounds.x, y: baselineY - metrics.actualBoundingBoxAscent,
          width: textBounds.width, height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent },
        textFill: getComputedStyle(text).fill, textStroke: getComputedStyle(text).stroke,
        background: getComputedStyle(rect).fill,
      }
    }))
    expect(badges).toHaveLength(expected.size)
    expect(badges.some(badge => badge.count < orangeCutoff)).toBe(true)
    expect(badges.filter(badge => badge.background === 'rgb(255, 140, 0)').map(badge => badge.count))
      .toEqual([...expected.values()].filter(count => count >= orangeCutoff))
    expect(badges.some(badge => Object.values(state.investigatorPositions).includes(badge.crossingId))).toBe(true)
    for (const badge of badges) {
      expect(badge.angle).toBe('center')
      expect(badge.x).toBe(badge.centerX)
      expect(badge.y).toBe(badge.centerY)
      expect(badge.rectX + badge.width / 2).toBe(badge.centerX)
      expect(badge.rectY + badge.height / 2).toBe(badge.centerY)
      if (Object.values(state.investigatorPositions).includes(badge.crossingId)) {
        expect(badge.offsetY).toBeLessThan(0)
        const overlap = badge.rectY + badge.height + badge.offsetY - (badge.centerY - 9)
        expect(overlap).toBeGreaterThan(0)
        expect(overlap).toBeLessThanOrEqual(3)
        expect(badge.rectY + badge.height + badge.offsetY).toBeLessThan(badge.centerY)
      } else {
        expect(badge.offsetY).toBe(0)
      }
      expect(badge.width).toBeLessThan(Math.max(14, String(badge.count).length * 7 + 4))
      expect(badge.height).toBeLessThan(14)
      expect(badge.rectX).toBeLessThan(badge.textBounds.x)
      expect(badge.rectY).toBeLessThanOrEqual(badge.textBounds.y)
      expect(badge.rectX + badge.width).toBeGreaterThan(badge.textBounds.x + badge.textBounds.width)
      expect(badge.rectY + badge.height).toBeGreaterThanOrEqual(badge.textBounds.y + badge.textBounds.height)
      expect(badge.textFill).toBe('rgb(0, 0, 0)')
      expect(badge.textStroke).toBe('none')
      expect(badge.background).toBe(badge.count >= orangeCutoff ? 'rgb(255, 140, 0)' : 'rgb(255, 255, 255)')
    }
  }
  await expectBadgeLayout()
  const labels = await worst.evaluate(input => [...input.closest('label')!.parentElement!.querySelectorAll('label')]
    .map(label => label.textContent?.trim().replace(/\d+$/, '')))
  expect(labels[labels.indexOf('worst') + 1]).toBe('maybes')
  // The new indicator works independently of location clues.
  await page.getByLabel('maybes').uncheck()
  await expect(indicators).toHaveCount(expected.size)
  await page.locator('[data-board-hover="investigator:red:HZ"]').hover()
  await expect(page.locator('.investigator-hover-turn-count').first()).toBeVisible()
  await expect(indicators).toHaveCount(0)
  await worst.hover()
  await expect(indicators).toHaveCount(expected.size)
  await page.locator('[data-board-hover="crossing:HB"]').hover()
  await expect(page.locator('.investigator-route-turn-count').first()).toBeVisible()
  await expect(indicators).toHaveCount(0)
  await worst.hover()
  await expect(indicators).toHaveCount(expected.size)
  await page.getByLabel('xings', { exact: true }).check()
  await page.locator('.game-board').screenshot({ path: test.info().outputPath('worst-crossings.png') })
  await page.getByLabel('alt', { exact: true }).check()
  await page.setViewportSize({ width: 700, height: 1400 })
  await expectBadgeLayout()
  await page.locator('.game-board').screenshot({ path: test.info().outputPath('worst-crossings-alternate.png') })
  await page.reload()
  await expect(worst).toBeChecked()
  await expect(indicators).toHaveCount(expected.size)
})

test('Ctrl temporarily inverts next and recovers from lost focus without persisting the override', async ({ page }) => {
  const state = await openHunt(page)
  const next = page.getByLabel('next', { exact: true })
  const worst = page.getByLabel('worst', { exact: true })
  const indicators = page.locator('.crossing-worst-count')
  const currentOutcomes = possibleJackSearchOutcomes(state.publicRound)
  const futureOutcomes = possibleJackSearchOutcomes(state.publicRound, state.investigatorPositions)
  const currentIds = new Set([...currentOutcomes.values()].flatMap(outcome => [...outcome.ifYes]))
  const futureIds = new Set([...futureOutcomes.values()].flatMap(outcome => [...outcome.ifYes]))
  const currentCounts = [...worstCaseCrossingEliminations(state.publicRound).values()].filter(count => count > 0).map(String)
  const futureCounts = [...worstCaseCrossingEliminations(state.publicRound, state.investigatorPositions).values()]
    .filter(count => count > 0).map(String)
  const clue = page.locator('.possible-outcome-count[aria-label^="Search outcome at 34:"]')
  const expectPerspective = async (future: boolean, worstEnabled = true) => {
    await expect(page.locator('.game-board')).toHaveAttribute('data-possibility-perspective', future ? 'next' : 'current')
    const ids = future ? futureIds : currentIds
    expect(await page.locator('.possible-marker').evaluateAll(elements => elements.map(element =>
      `${element.getAttribute('cx')},${element.getAttribute('cy')}`).sort()))
      .toEqual(circles.filter(circle => ids.has(circle.id)).map(circle => `${circle.x},${circle.y}`).sort())
    const outcome = (future ? futureOutcomes : currentOutcomes).get(34)!
    await expect(clue).toHaveText(`${outcome.ifNo.size}/${outcome.ifYes.size}`)
    expect(await indicators.allTextContents()).toEqual(worstEnabled ? future ? futureCounts : currentCounts : [])
  }
  await worst.check()
  for (const saved of [false, true]) {
    await next.setChecked(saved)
    await next.hover()
    const stored = await page.evaluate(() => localStorage.getItem('whitehall-mystery.show-next-turn'))
    await expectPerspective(saved)
    for (const key of ['ControlLeft', 'ControlRight']) {
      await page.keyboard.down(key)
      await expectPerspective(!saved)
      await page.keyboard.down(key)
      await expectPerspective(!saved)
      await expect(next).toBeChecked({ checked: saved })
      await expect(worst).toBeChecked()
      expect(await page.evaluate(() => localStorage.getItem('whitehall-mystery.show-next-turn'))).toBe(stored)
      expect(await page.evaluate(() => localStorage.getItem('whitehall-mystery.show-worst-crossings'))).toBe('true')
      await page.keyboard.up(key)
      await expectPerspective(saved)
    }
    await page.reload()
    await expect(next).toBeChecked({ checked: saved })
    await expectPerspective(saved)
  }
  await next.uncheck()
  await next.hover()
  await worst.uncheck()
  await page.keyboard.down('ControlLeft')
  await expectPerspective(true, false)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expectPerspective(false, false)
  await page.mouse.move(0, 0)
  await expectPerspective(true, false)
  await page.keyboard.up('ControlLeft')
  await expectPerspective(false, false)
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true })))
  await expectPerspective(true, false)
  await page.mouse.move(10, 10)
  await expectPerspective(false, false)
})

test('next projects outlines, search outcomes, and worst counts through a Street move and persists independently', async ({ page }) => {
  const state = await openHunt(page)
  const next = page.getByLabel('next', { exact: true })
  const worst = page.getByLabel('worst', { exact: true })
  const maybes = page.getByLabel('maybes')
  const indicators = page.locator('.crossing-worst-count')
  const storedGame = await page.evaluate(() => localStorage.getItem('whitehall-mystery.game.v1'))
  const currentOutcomes = possibleJackSearchOutcomes(state.publicRound)
  const project = (ids: Set<number>) => new Set([...ids].flatMap(id => publicMovementPaths(id, {
    type: 'normal', startSlot: 5, endSlot: 5, investigatorPositions: state.investigatorPositions,
  }).map(path => path.at(-1)!)))
  const future = possibleJackLocationsAfterMove(state.publicRound, 'normal', state.investigatorPositions, state.moveSlot)
  const current = new Set([...currentOutcomes.values()].flatMap(outcome => [...outcome.ifYes]))
  const expectMarkers = async (selector: string, ids: Set<number>) => {
    const coordinates = await page.locator(selector).evaluateAll(elements => elements.map(element =>
      `${element.getAttribute('cx')},${element.getAttribute('cy')}`).sort())
    expect(coordinates).toEqual(circles.filter(circle => ids.has(circle.id)).map(circle => `${circle.x},${circle.y}`).sort())
  }
  await expect(next).not.toBeChecked()
  await expectMarkers('.possible-marker', current)
  await worst.check()
  await next.check()
  await next.hover()
  await expect(page.locator('.game-board')).toHaveAttribute('data-possibility-perspective', 'next')
  const labels = await next.evaluate(input => [...input.closest('label')!.parentElement!.querySelectorAll('label')]
    .map(label => label.textContent?.trim().replace(/\d+$/, '')))
  expect(labels[labels.indexOf('next') + 1]).toBe('worst')
  await expect(next.locator('..')).toHaveAttribute('title', /searches this turn/)
  expect(future).not.toEqual(current)
  await expectMarkers('.possible-marker', future)
  await expect(page.locator('.possibility-toggle strong')).toHaveText(String(future.size))
  await expectMarkers('.possible-certainty-marker', new Set([...currentOutcomes].filter(([id, outcome]) => {
    const projected = project(outcome.ifYes)
    return future.has(id) && projected.size === 1 && projected.has(id)
  }).map(([id]) => id)))
  const expectedCounts = new Map([...worstCaseCrossingEliminations(state.publicRound, state.investigatorPositions)]
    .filter(([, count]) => count > 0))
  expect(await indicators.allTextContents()).toEqual([...expectedCounts.values()].map(String))
  expect(expectedCounts).not.toEqual(new Map([...worstCaseCrossingEliminations(state.publicRound)].filter(([, count]) => count > 0)))
  const ranked = [...expectedCounts.values()].sort((a, b) => b - a)
  const cutoff = ranked[Math.min(2, ranked.length - 1)]!
  expect(await page.locator('.crossing-worst-indicator.highlighted .crossing-worst-count').allTextContents())
    .toEqual([...expectedCounts.values()].filter(count => count >= cutoff).map(String))
  for (const [id, outcome] of currentOutcomes) {
    const ifNo = project(outcome.ifNo), ifYes = project(outcome.ifYes)
    if (ifNo.size === 0) continue
    const clue = page.locator(`.possible-outcome-count[aria-label^="Search outcome at ${id}:"]`)
    await expect(clue).toHaveText(`${ifNo.size}/${ifYes.size}`)
    await expect(clue).toHaveAttribute('aria-label', /after Jack’s next Street move$/)
  }
  const [searchId, outcome] = [...currentOutcomes].find(([id, outcome]) => id !== state.currentJack && outcome.ifNo.size > 0 && outcome.ifYes.size > 0)!
  await page.locator(`[data-board-hover="location:${searchId}"]`).hover()
  await expectMarkers('.possible-outcome-no', project(outcome.ifNo))
  await expectMarkers('.possible-outcome-yes', project(outcome.ifYes))
  await page.keyboard.down('ControlLeft')
  await expectMarkers('.possible-outcome-no', outcome.ifNo)
  await expectMarkers('.possible-outcome-yes', outcome.ifYes)
  await page.keyboard.up('ControlLeft')
  await expectMarkers('.possible-outcome-no', project(outcome.ifNo))
  await expectMarkers('.possible-outcome-yes', project(outcome.ifYes))
  await next.hover()
  await maybes.uncheck()
  await next.hover()
  await expect(page.locator('.possible-marker')).toHaveCount(0)
  expect(await indicators.allTextContents()).toEqual([...expectedCounts.values()].map(String))
  await page.keyboard.down('ControlLeft')
  await expect(page.locator('.game-board')).toHaveAttribute('data-possibility-perspective', 'current')
  expect(await indicators.allTextContents()).toEqual([...worstCaseCrossingEliminations(state.publicRound).values()]
    .filter(count => count > 0).map(String))
  await expect(next).toBeChecked()
  await expect(worst).toBeChecked()
  await page.keyboard.up('ControlLeft')
  await expect(page.locator('.game-board')).toHaveAttribute('data-possibility-perspective', 'next')
  await expect(indicators).toHaveCount(expectedCounts.size)
  await maybes.check()
  await page.locator('[data-board-hover="investigator:red:HZ"]').hover()
  await expect(page.locator('.investigator-hover-turn-count').first()).toBeVisible()
  await expect(indicators).toHaveCount(0)
  await next.hover()
  await expect(indicators).toHaveCount(expectedCounts.size)
  await page.locator('.game-board').screenshot({ path: test.info().outputPath('next-turn-indicators.png') })
  await page.reload()
  await expect(next).toBeChecked()
  await expect(worst).toBeChecked()
  await expect(maybes).toBeChecked()
  await expectMarkers('.possible-marker', future)
  expect(await page.evaluate(() => localStorage.getItem('whitehall-mystery.game.v1'))).toBe(storedGame)
  await next.uncheck()
  await next.hover()
  await expectMarkers('.possible-marker', current)
  await expect(worst).toBeChecked()
  await expect(maybes).toBeChecked()
  await page.reload()
  await expect(next).not.toBeChecked()
})
