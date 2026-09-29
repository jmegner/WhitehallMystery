import { expect, test } from '@playwright/test'
import { createInitialGame } from '../../src/game/gameEngine'

for (const color of ['blue', 'yellow'] as const) {
  test(`53 text avoids ${color} at DM even with Alt enabled, preferring overlap with 54 outlines`, async ({ page }) => {
    const investigatorPositions = color === 'blue' ? { yellow: 'FP', blue: 'DM', red: 'HZ' } : { yellow: 'DM', blue: 'FP', red: 'HZ' }
    const state = { ...createInitialGame(), stage: 'investigatorAction', inspectorActionMode: 'search', activeInvestigator: color === 'blue' ? 1 : 0, moveSlot: 4, currentJack: 53,
      discoveryLocations: [72, 46, 147, 159], reachedDiscoveries: [72], investigatorPositions,
      publicRound: { start: 72, observations: [], moves: [1, 2, 3, 4].map(slot => ({
        type: 'normal', startSlot: slot, endSlot: slot, investigatorPositions,
      })) } }
    await page.addInitScript(state => {
      if (localStorage.getItem('whitehall-mystery.game.v1')) return
      localStorage.setItem('whitehall-mystery.game.v1', JSON.stringify({ version: 1, state }))
      localStorage.setItem('whitehall-mystery.show-possible-locations', 'true')
      localStorage.setItem('whitehall-mystery.show-crossing-ids', 'true')
    }, state)
    await page.setViewportSize({ width: 1500, height: 1400 })
    await page.goto('/')
    await page.evaluate(() => document.fonts.ready)
    const label = page.locator('.possible-outcome-count[aria-label^="Search outcome at 53:"]')
    await expect(label).toHaveAttribute('data-indicator-angle', 'top')
    const overlap = await label.evaluate((element, color) => {
      const box = (element as SVGTextElement).getBBox()
      const touches = (circle: SVGCircleElement) => {
        const x = circle.cx.baseVal.value, y = circle.cy.baseVal.value
        const stroke = Number.parseFloat(getComputedStyle(circle).strokeWidth) / 2
        const near = Math.hypot(x - Math.max(box.x, Math.min(x, box.x + box.width)),
          y - Math.max(box.y, Math.min(y, box.y + box.height)))
        const far = Math.hypot(Math.max(Math.abs(x - box.x), Math.abs(x - box.x - box.width)),
          Math.max(Math.abs(y - box.y), Math.abs(y - box.y - box.height)))
        return near < circle.r.baseVal.value + stroke && far > circle.r.baseVal.value - stroke
      }
      const location54 = document.querySelector<SVGCircleElement>('.map-hit-target[data-board-hover="location:54"]')!
      return {
        piece: [...document.querySelectorAll<SVGCircleElement>(`.investigator-piece.${color} circle`)].some(touches),
        outline: [...document.querySelectorAll<SVGCircleElement>('.possible-marker, .possible-certainty-marker')]
          .filter(circle => circle.cx.baseVal.value === location54.cx.baseVal.value && circle.cy.baseVal.value === location54.cy.baseVal.value)
          .some(touches),
      }
    }, color)
    expect(overlap).toEqual({ piece: false, outline: true })
    await page.locator('.game-board').screenshot({ path: test.info().outputPath(`53-${color}-at-DM.png`) })
    await page.getByLabel('alt', { exact: true }).check()
    // Both alternatives hide text behind the piece, so Alt retains the only safe angle.
    await expect(label).toHaveAttribute('data-indicator-angle', 'top')
    await page.reload()
    await expect(page.getByLabel('alt', { exact: true })).toBeChecked()
    await expect(label).toHaveAttribute('data-indicator-angle', 'top')
    await page.setViewportSize({ width: 700, height: 1100 })
    await expect(label).toHaveAttribute('data-indicator-angle', 'top')
    await page.getByLabel('xings', { exact: true }).uncheck()
    await expect(label).toHaveAttribute('data-indicator-angle', 'top')
    await page.getByLabel('xings', { exact: true }).check()
    await expect(label).toHaveAttribute('data-indicator-angle', 'top')
    await page.getByLabel('alt', { exact: true }).uncheck()
    await expect(label).toHaveAttribute('data-indicator-angle', 'top')
  })
}
