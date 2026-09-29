import { expect, test } from '@playwright/test'
import { observeInvitationClipboard } from './invitationClipboard'
import { onlineEntry, sessionFor, start, post } from './onlineDepartureHelpers'

test.beforeEach(async ({ page }) => { await observeInvitationClipboard(page) })

// Each suite gets a separate local Worker so it stays within the simulated
// per-network game-creation and connection limits (npm run test:e2e).
test('online departures: Leave Done Games waits for an explicit opponent departure and retains retry or forget on failure', async ({ page, request }) => {
  const session = await start(page)
  const origin = new URL(page.url()).origin
  await page.getByRole('button', { name: 'Resume game', exact: true }).click()
  const done = page.getByRole('button', { name: 'Leave Done Games', exact: true })
  await expect(done).toBeDisabled() // An opponent who has not connected has not left.
  const opponent = { ...session, token: session.opponentInvitation!.token }
  expect((await post(request, origin, opponent, { type: 'leave', requestId: crypto.randomUUID() })).status()).toBe(200)
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
  await expect(onlineEntry(page)).toContainText('Opponent left the game')
  let fail = true
  const ids: string[] = []
  await page.route('**/session', async route => {
    const body = route.request().postDataJSON()
    if (body.type !== 'leave') { await route.continue(); return }
    ids.push(body.requestId)
    if (fail) { fail = false; await route.abort('failed') } else await route.continue()
  })
  page.once('dialog', dialog => dialog.accept())
  await done.click()
  await expect(onlineEntry(page).getByRole('alert')).toContainText('Your saved game has been kept')
  await expect(onlineEntry(page).getByRole('button', { name: 'Forget game', exact: true })).toBeEnabled()
  page.once('dialog', dialog => dialog.accept())
  await done.click()
  await expect(onlineEntry(page)).toHaveCount(0)
  await expect(page.locator('.saved-game-resume')).toHaveCount(1) // Ongoing local game survives.
  expect(ids).toHaveLength(2)
  expect(ids[1]).toBe(ids[0])
  expect((await post(request, origin, session, { type: 'status' })).status()).toBe(401)
  await page.reload()
  await expect(onlineEntry(page)).toHaveCount(0)
})

test('online departures: Leave Done Games keeps an online game when fresh status no longer has a winner', async ({ page, request }) => {
  const session = await start(page)
  const origin = new URL(page.url()).origin
  let unavailable = true
  let leaveRequests = 0
  await page.route('**/session', async route => {
    const body = route.request().postDataJSON()
    if (body.type === 'leave') leaveRequests++
    if (body.type === 'status' && unavailable) await route.fulfill({ status: 503, json: { error: 'Status unavailable.' } })
    else await route.continue()
  })
  await page.getByRole('button', { name: 'Resume game', exact: true }).click()
  // Model a cached win followed by an undo on the server while this browser was offline.
  await page.evaluate(() => {
    const key = 'whitehall-mystery.saved-game.v1.' + localStorage.getItem('whitehall-mystery.active-game.v1')
    const game = JSON.parse(localStorage.getItem(key)!)
    game.summary = { ...game.summary, stage: 'gameOver', winner: 'jack' }
    localStorage.setItem(key, JSON.stringify(game))
    localStorage.setItem('whitehall-mystery.active-game.v1', '')
  })
  await page.reload()
  await expect(onlineEntry(page)).toContainText('Jack won')
  const done = page.getByRole('button', { name: 'Leave Done Games', exact: true })
  page.once('dialog', dialog => dialog.accept())
  await done.click()
  await expect(onlineEntry(page).getByRole('alert')).toContainText('Status unavailable.')
  await expect(onlineEntry(page).getByRole('button', { name: 'Forget game', exact: true })).toBeEnabled()
  unavailable = false
  page.once('dialog', dialog => dialog.accept())
  await done.click()
  await expect(page.getByRole('status').filter({ hasText: 'Kept 1 that are no longer done.' })).toBeVisible()
  await expect(onlineEntry(page)).toHaveCount(1)
  await expect(done).toBeDisabled()
  expect(leaveRequests).toBe(0)
  expect((await post(request, origin, session, { type: 'status' })).status()).toBe(200)
})

test('online departures: Leave All continues after a failure and offers local forgetting after removing the active game', async ({ page, request }) => {
  const failed = await start(page)
  await page.getByRole('button', { name: 'New game', exact: true }).click()
  await page.getByRole('button', { name: 'Online', exact: true }).click()
  await page.getByRole('button', { name: 'Start new game as Jack' }).click()
  await expect(page.getByLabel('Online investigator invitation')).toBeVisible()
  const succeeded = await sessionFor(page)
  expect(succeeded.roomId).not.toBe(failed.roomId)
  const origin = new URL(page.url()).origin
  const failedKey = await page.evaluate(roomId => Object.keys(localStorage).find(key => key.startsWith('whitehall-mystery.saved-game.v1.') && key.includes(roomId))!, failed.roomId)
  await page.route(`**/games/${failed.roomId}/session`, async route => {
    if (route.request().postDataJSON()?.type === 'leave') await route.fulfill({ status: 503, json: { error: 'Service temporarily unavailable.' } })
    else await route.continue()
  })
  await page.getByRole('button', { name: 'Resume game', exact: true }).click()
  await expect(page.locator('.saved-game-resume')).toHaveCount(3)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Leave All', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Left 2 of 3 games.' })).toBeVisible()
  await expect(page.locator('.saved-game-resume')).toHaveCount(1)
  const error = onlineEntry(page).getByRole('alert')
  await expect(error).toContainText('Service temporarily unavailable.')
  await expect(error).toContainText('your partner may still see you in the game')
  expect((await post(request, origin, succeeded, { type: 'status' })).status()).toBe(401)
  expect((await post(request, origin, failed, { type: 'status' })).status()).toBe(200)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/leave-all-partial-failure.png', fullPage: true })
  await error.getByRole('button', { name: 'Forget game', exact: true }).click()
  await expect(page.locator('.saved-game-resume')).toHaveCount(0)
  expect(await page.evaluate(key => localStorage.getItem(key), failedKey)).toBeNull()
  expect((await post(request, origin, failed, { type: 'status' })).status()).toBe(200)
  await page.reload()
  await expect(page.getByText('No saved games.', { exact: false })).toBeVisible()
})

test('online departures: failed Leave+New Game can be forgotten, but reports local removal failures', async ({ page, request }) => {
  const session = await start(page)
  const origin = new URL(page.url()).origin
  const key = await page.evaluate(() => 'whitehall-mystery.saved-game.v1.' + localStorage.getItem('whitehall-mystery.active-game.v1'))
  await page.route('**/session', async route => {
    if (route.request().postDataJSON()?.type === 'leave') await route.abort('failed')
    else await route.continue()
  })
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Leave+New Game', exact: true }).click()
  const failure = page.locator('.leave-game-failure')
  await expect(failure).toContainText('Could not confirm leaving the online game.')
  await page.evaluate(() => {
    const remove = Storage.prototype.removeItem
    Storage.prototype.removeItem = function(key: string) {
      if (key.startsWith('whitehall-mystery.saved-game.v1.')) {
        Storage.prototype.removeItem = remove
        throw new Error('Storage temporarily unavailable')
      }
      remove.call(this, key)
    }
  })
  await failure.getByRole('button', { name: 'Forget game', exact: true }).click()
  await expect(failure).toContainText('Could not remove the saved game from browser storage.')
  expect(await page.evaluate(key => localStorage.getItem(key), key)).not.toBeNull()
  await failure.getByRole('button', { name: 'Forget game', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'New game', exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull()
  expect((await post(request, origin, session, { type: 'status' })).status()).toBe(200)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(onlineEntry(page)).toHaveCount(0)
  await page.reload()
  await expect(onlineEntry(page)).toHaveCount(0)
})
