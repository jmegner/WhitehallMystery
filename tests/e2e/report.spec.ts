import { expect, test } from '@playwright/test'

test('interactive report loads its full analysis and persists movement controls', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/reports/initial_report/')

  await expect(page.getByRole('heading', { name: 'Routes Through Whitehall', level: 1 })).toBeVisible()
  await expect(page.locator('#jack-content')).toContainText('Nine locations minimize the worst trip.')
  await expect(page.locator('#discoveries-content')).toContainText('444,360')
  await expect(page.locator('#investigators-content')).toContainText('FP, JD, JH is the strongest robust start.')

  const movementControls = page.locator('#scenario-controls')
  for (const label of ['≤2 Boats', '≤2 Alleys', '≤2 of each', 'Street only']) {
    await movementControls.getByRole('button', { name: label, exact: true }).click()
    await expect(movementControls.getByRole('button', { name: label, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  }

  await movementControls.getByRole('button', { name: '≤2 Alleys', exact: true }).click()
  await expect(movementControls.getByRole('button', { name: '≤2 Alleys', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.locator('#jack-content .stat-card').first()).toContainText('6 turns')

  await movementControls.getByRole('button', { name: 'Track slots', exact: true }).click()
  await page.reload()
  await expect(movementControls.getByRole('button', { name: '≤2 Alleys', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(movementControls.getByRole('button', { name: 'Track slots', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(pageErrors).toEqual([])
})

test('discovery-set controls distinguish action turns from move-track slots', async ({ page }) => {
  await page.goto('/reports/initial_report/')

  const discoveries = page.locator('#discoveries-content')
  await discoveries.getByRole('button', { name: '≤2 Coach', exact: true }).click()
  await expect(discoveries.locator('.finding-panel').first()).toContainText('6 Jack action-turns')
  await expect(discoveries.locator('.stat-card').nth(2)).toContainText('C2')

  await page.locator('#scenario-controls').getByRole('button', { name: 'Track slots', exact: true }).click()
  await expect(discoveries.locator('.finding-panel').first()).toContainText('8 move-track slots')

  await discoveries.getByRole('button', { name: 'Longest', exact: true }).click()
  await expect(discoveries.locator('.finding-panel').first()).toContainText('24 move-track slots')
})

test('report remains readable at a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/reports/initial_report/')

  await expect(page.locator('#overview')).toBeVisible()
  await expect(page.locator('#methods')).toBeAttached()
  const bodyWidth = await page.locator('body').evaluate((body) => body.scrollWidth)
  expect(bodyWidth).toBeLessThanOrEqual(390)
})
