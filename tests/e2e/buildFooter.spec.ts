import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'

test('build footer identifies the source commit, keeps build time across refresh, and follows the game', async ({ page }) => {
  await page.goto('/')
  const footer = page.getByRole('contentinfo', { name: 'Build information' })
  await expect(footer).toHaveCount(1)
  const commit = footer.getByRole('link')
  const href = await commit.getAttribute('href')
  expect(href).toMatch(/^https:\/\/github\.com\/jmegner\/WhitehallMystery\/commit\/[a-f0-9]{40,64}$/)
  const hash = href!.split('/').at(-1)!
  await expect(commit).toHaveText(hash.slice(0, 7))
  await expect(commit).toHaveAttribute('title', `View source commit ${hash} on GitHub`)
  const date = execFileSync('git', ['show', '-s', '--format=%cI', hash], { encoding: 'utf8' }).trim()
  await expect(footer.locator('time').first()).toHaveAttribute('datetime', new Date(date).toISOString())
  const builtAt = await footer.locator('time').last().getAttribute('datetime')
  expect(Date.parse(builtAt!)).toBeLessThanOrEqual(Date.now())
  await page.reload()
  await expect(footer.locator('time').last()).toHaveAttribute('datetime', builtAt!)
  await page.getByRole('button', { name: 'New game', exact: true }).click()
  await expect(footer).toHaveCount(1)
  await page.getByRole('button', { name: 'Same device', exact: true }).click()
  await expect(page.locator('.game-board')).toBeVisible()
  await footer.scrollIntoViewIfNeeded()
  await expect(footer).toBeVisible()
  // Floating touch controls can overlap the bottom of the page. The commit
  // link must remain unobscured and clickable without starting a game action.
  await commit.click({ trial: true })
  expect(await page.locator('.app-shell').evaluate((element, top) => element.getBoundingClientRect().bottom <= top,
    (await footer.boundingBox())!.y)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('footer shows RFC 3339 local timestamps while retaining identical UTC timestamps', async ({ browser, baseURL }) => {
  const displays: string[][] = []
  let timestamps: string[] | undefined
  for (const timezoneId of ['America/Chicago', 'Asia/Tokyo', 'Asia/Kolkata', 'UTC']) {
    const context = await browser.newContext({ baseURL, timezoneId, locale: 'en-US' })
    try {
      const page = await context.newPage()
      await page.goto('/')
      const times = page.getByRole('contentinfo', { name: 'Build information' }).locator('time')
      await expect(times).toHaveCount(2)
      const utc = await times.evaluateAll(elements => elements.map(element => element.getAttribute('datetime')!))
      expect(utc.every(value => value.endsWith('Z'))).toBe(true)
      if (timestamps) expect(utc).toEqual(timestamps)
      else timestamps = utc
      const display = await times.allTextContents()
      for (const [index, value] of display.entries()) {
        expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/)
        expect(Date.parse(value)).toBe(Date.parse(utc[index]!))
        const offsetName = new Intl.DateTimeFormat('en-US', { timeZone: timezoneId, timeZoneName: 'longOffset' })
          .formatToParts(new Date(utc[index]!)).find(part => part.type === 'timeZoneName')!.value
        expect(value.endsWith(offsetName === 'GMT' ? '+00:00' : offsetName.replace('GMT', ''))).toBe(true)
      }
      displays.push(display)
      await page.close()
    } finally { await context.close() }
  }
  expect(displays[0]).not.toEqual(displays[1])
})
