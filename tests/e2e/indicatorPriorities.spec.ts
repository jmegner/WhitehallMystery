import { expect, test, type Page } from '@playwright/test'
import { createInitialGame } from '../../src/game/gameEngine'

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
    expect(clue.x).toBe(clue.anchorX + (alternate ? 19 : 0))
    expect(clue.y).toBe(clue.anchorY - (alternate ? 0 : 19))
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
