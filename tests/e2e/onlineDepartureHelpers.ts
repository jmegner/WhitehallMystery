import { expect, type Page, type APIRequestContext } from '@playwright/test'
import type { OnlineSession } from '../../src/online/onlineSession'

export const onlineEntry = (page: Page) => page.locator('.saved-game-list li').filter({ hasText: 'Online ·' })
export async function sessionFor(page: Page): Promise<OnlineSession> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('whitehall-mystery.saved-game.v1.' + localStorage.getItem('whitehall-mystery.active-game.v1'))!).session)
}
export async function start(page: Page, blockAutomatic = false) {
  await page.goto('/')
  await page.evaluate(block => { window.invitationClipboardProbe.blockAutomatic = block }, blockAutomatic)
  await page.getByRole('button', { name: 'New game', exact: true }).click()
  await page.getByRole('button', { name: 'Online', exact: true }).click()
  await page.getByRole('button', { name: 'Start new game as Jack' }).click()
  await expect(page.getByLabel('Online investigator invitation')).toBeVisible()
  const session = await sessionFor(page)
  expect(new URL(session.apiBase).hostname).toBe('127.0.0.1')
  return session
}
export const post = (request: APIRequestContext, origin: string, session: OnlineSession, data: object) => request.post(`${session.apiBase}/v1/games/${session.roomId}/session`, {
  headers: { Origin: origin }, data: { token: session.token, ...data },
})

