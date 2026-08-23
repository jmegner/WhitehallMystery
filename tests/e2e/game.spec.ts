import { expect, test } from '@playwright/test'

test('plays a complete hot-seat turn without exposing Jack during handoffs', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Whitehall Mystery' })).toBeVisible()

  for (const id of [33, 46, 147, 159]) {
    await page.getByLabel(`Location ${id}, selectable`).click()
  }
  await page.getByRole('button', { name: 'Lock in four locations' }).click()

  await expect(page.getByRole('heading', { name: 'Pass the device to Investigators' })).toBeVisible()
  await expect(page.getByText('Private route')).toHaveCount(0)
  await page.getByRole('button', { name: /reveal my view/i }).click()

  const deployment = page.getByLabel('Available deployment crossings')
  for (const crossing of ['FP', 'HP', 'HZ']) {
    await deployment.getByRole('button', { name: crossing, exact: true }).click()
  }
  await expect(page.getByRole('heading', { name: 'Pass the device to Jack' })).toBeVisible()
  await page.getByRole('button', { name: /reveal my view/i }).click()

  await page.getByLabel('Secret Discovery Locations').getByRole('button', { name: '33', exact: true }).click()
  const destinations = page.getByLabel('Legal Jack destinations')
  await destinations.getByRole('button').first().click()
  await page.getByRole('button', { name: 'Record move privately' }).click()

  await expect(page.getByRole('heading', { name: 'Pass the device to Investigators' })).toBeVisible()
  await expect(page.getByText('Private route')).toHaveCount(0)
  await page.getByRole('button', { name: /reveal my view/i }).click()

  await page.getByLabel('Show possible Jack locations').check()
  await expect(page.locator('.possible-marker').first()).toBeVisible()

  for (const crossing of ['FP', 'HP', 'HZ']) {
    await page.getByRole('button', { name: crossing, exact: true }).click()
  }
  for (let index = 0; index < 3; index += 1) {
    await page.getByRole('button', { name: 'Pass', exact: true }).click()
  }

  await expect(page.getByRole('heading', { name: 'Pass the device to Jack' })).toBeVisible()
  await expect(page.getByText('Private route')).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Pass the device to Jack' })).toBeVisible()
  await page.getByRole('button', { name: /reveal my view/i }).click()
  await expect(page.getByText('Round 1 · Move 1 of 15')).toBeVisible()
})

test('keeps the mobile layout within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('.game-board')).toBeVisible()
  await expect(page.locator('.crossing-id-label')).toHaveCount(0)
  await page.getByLabel('Show crossing IDs').check()
  await expect(page.locator('.crossing-id-label')).toHaveCount(174)
  await page.reload()
  await expect(page.getByLabel('Show crossing IDs')).toBeChecked()
  await expect(page.locator('.crossing-id-label')).toHaveCount(174)
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }))
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport)
})
