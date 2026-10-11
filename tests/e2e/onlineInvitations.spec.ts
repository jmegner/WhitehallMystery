import { expect, test, type Page, type APIRequestContext } from './fixtures'
import { reviewScreenshot } from './reviewScreenshot'
import type { OnlineSession } from '../../src/online/onlineSession'
import type { OnlineSnapshot } from '../../src/game/onlineProtocol'
import { observeInvitationClipboard } from './invitationClipboard'

// These multi-client workflows include several reloads and a cold dev-server
// startup. Individual UI assertions still use their normal five-second limit.
test.setTimeout(60_000)

async function sessionFor(page: Page): Promise<OnlineSession> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('whitehall-mystery.saved-game.v1.' + localStorage.getItem('whitehall-mystery.active-game.v1'))!).session)
}

function post(request: APIRequestContext, origin: string, session: OnlineSession, command: object) {
  expect(new URL(session.apiBase).hostname).toBe('127.0.0.1')
  return request.post(`${session.apiBase}/v1/games/${session.roomId}/session`, {
    headers: { Origin: origin }, data: { token: session.token, ...command },
  })
}

for (const role of ['jack', 'investigators'] as const) {
  test(`online same-side links: ${role} resumes on a fresh device with the existing game`, async ({ page: jack, browser, request }) => {
    const opponentContext = await browser.newContext()
    const resumedContext = await browser.newContext()
    const investigators = await opponentContext.newPage()
    const resumed = await resumedContext.newPage()
    for (const page of [jack, investigators, resumed]) await observeInvitationClipboard(page)
    try {
      await jack.goto('/')
      await jack.getByRole('button', { name: 'New game', exact: true }).click()
      await jack.getByRole('button', { name: 'Online', exact: true }).click()
      await jack.getByRole('button', { name: 'Start new game as Jack', exact: true }).click()
      await investigators.goto(await jack.getByLabel('Online investigator invitation').inputValue())
      await jack.getByRole('button', { name: 'Rand Side', exact: true }).click()
      await expect(investigators.getByRole('heading', { name: 'Deploy the Yellow Investigator' })).toBeVisible()

      const original = role === 'jack' ? jack : investigators
      const summary = original.getByText(`Resume as ${role === 'jack' ? 'Jack' : 'Investigators'} on another device`, { exact: true })
      const linkBox = original.getByLabel('Online same-side resume link')
      await expect(summary).toBeVisible()
      await expect(linkBox).toBeHidden()
      await summary.click()
      const link = await linkBox.inputValue()
      await original.getByRole('button', { name: 'Copy same-side link', exact: true }).click()
      expect(await original.evaluate(() => navigator.clipboard.readText())).toBe(link)
      await expect(original.getByRole('status').filter({ hasText: 'Same-side link copied.' })).toBeVisible()
      if (role === 'investigators') {
        await original.evaluate(() => {
          navigator.clipboard.writeText = async () => { throw new DOMException('Clipboard blocked', 'NotAllowedError') }
        })
        await original.getByRole('button', { name: 'Copy same-side link', exact: true }).click()
        await expect(original.getByRole('status').filter({ hasText: 'Select and copy the same-side link.' })).toBeVisible()
        await expect(linkBox).toHaveValue(link)
      }
      await original.setViewportSize({ width: 390, height: 844 })
      expect(await original.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await original.reload()
      await expect(linkBox).toBeVisible()
      await expect(linkBox).toHaveValue(link)
      await summary.click()
      await expect.poll(() => original.evaluate(() => localStorage.getItem('whitehall-mystery.online.resume-open'))).toBe('false')
      await original.reload()
      await expect(summary).toBeVisible()
      await expect(linkBox).toBeHidden()

      const session = await sessionFor(original)
      const origin = new URL(original.url()).origin
      const before = await (await post(request, origin, session, { type: 'status' })).json()
      await resumed.goto(link)
      await expect(resumed.getByLabel('Online game')).toContainText(`Online · ${role === 'jack' ? 'Jack' : 'Investigators'}`)
      await expect(resumed.getByLabel('Online game')).toContainText('Connected')
      await expect(original.getByLabel('Online game')).toContainText('This role connected on another tab or device.')
      const resumedSession = await sessionFor(resumed)
      expect(resumedSession).toMatchObject({ role: session.role, token: session.token, roomId: session.roomId })
      expect(resumedSession.opponentInvitation).toBeUndefined()
      const after = await (await post(request, origin, resumedSession, { type: 'status' })).json()
      expect(after.snapshot).toEqual(before.snapshot)
      expect(after.seats).toEqual(before.seats)

      if (role === 'jack') {
        await investigators.getByRole('button', { name: 'Rand Side', exact: true }).click()
        await expect(resumed.getByRole('heading', { name: 'Jack: Choose the Starting Location' })).toBeVisible()
        await resumed.getByRole('button', { name: 'Rand Side', exact: true }).click()
        await expect(investigators.getByRole('heading', { name: 'Yellow Investigator: Move', exact: true })).toBeVisible()
      } else {
        await resumed.getByLabel('Available deployment crossings').getByRole('button').first().click()
        await expect(resumed.getByRole('heading', { name: 'Deploy the Blue Investigator' })).toBeVisible()
      }
      await expect.poll(async () => (await (await post(request, origin, resumedSession, { type: 'status' })).json()).snapshot.revision).toBeGreaterThan(before.snapshot.revision)
      // The transferred side remains saved on the new device after a refresh.
      await resumed.reload()
      await expect(resumed.getByLabel('Online game')).toContainText('Connected')
      expect(await sessionFor(resumed)).toMatchObject({ token: session.token, roomId: session.roomId, role })
    } finally {
      await opponentContext.close()
      await resumedContext.close()
    }
  })
}

for (const chosenRole of ['jack', 'investigators'] as const) {
  test(`online invitations: opponent chooses ${chosenRole} and the creator takes the other side`, async ({ page: creator, browser, request }, testInfo) => {
    const invitedContext = await browser.newContext()
    const invited = await invitedContext.newPage()
    await observeInvitationClipboard(creator)
    try {
      await creator.goto('/')
      await creator.getByRole('button', { name: 'New game', exact: true }).click()
      await creator.getByRole('button', { name: 'Online', exact: true }).click()
      const start = creator.getByRole('button', { name: 'Let opponent choose their side', exact: true })
      await expect(start).toHaveAttribute('title', /opponent chooses Jack or Investigators/)
      const name = `Sunday game — ${chosenRole}`
      await creator.getByRole('textbox', { name: 'Game name (optional)' }).fill(name)
      await start.click()
      await expect(creator.getByRole('heading', { name: 'Waiting for opponent to choose a side' })).toBeVisible()
      const invitation = await creator.getByLabel('Online side-choice invitation').inputValue()
      await expect.poll(() => creator.evaluate(() => navigator.clipboard.readText())).toBe(invitation)
      const pendingCreator = await sessionFor(creator)
      const origin = new URL(creator.url()).origin
      const game = await (await post(request, origin, pendingCreator, { type: 'status' })).json()
      const createdAt = new Date(game.createdAt).toISOString()
      const creationTime = (page: Page) => page.getByLabel('Game creation time', { exact: true })
      await expect(creator.getByRole('heading', { name, exact: true })).toBeVisible()
      await expect(creationTime(creator)).toHaveAttribute('datetime', createdAt)
      await expect(creationTime(creator)).toHaveText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} .+/)
      expect(invitation).not.toContain(pendingCreator.token)
      expect(await (await post(request, origin, pendingCreator, { type: 'side-choice' })).json()).toEqual({ pending: true })
      expect((await post(request, origin, pendingCreator, { type: 'side-choice', role: chosenRole })).status()).toBe(403)
      await creator.reload()
      await expect(creator.getByLabel('Online side-choice invitation')).toHaveValue(invitation)
      await expect(creator.getByRole('heading', { name, exact: true })).toBeVisible()
      await expect(creationTime(creator)).toHaveAttribute('datetime', createdAt)
      await reviewScreenshot(creator.getByRole('main'), { path: testInfo.outputPath('waiting-for-side.png') })
      await creator.getByRole('button', { name: 'Resume game', exact: true }).click()
      await expect(creator.getByText('Waiting for opponent to choose a side (last known)', { exact: true })).toBeVisible()
      await creator.getByRole('button', { name: 'Cancel', exact: true }).click()

      await invited.goto(invitation)
      await expect(invited.getByRole('heading', { name: 'Choose your side' })).toBeVisible()
      await expect(invited.getByRole('button', { name: 'Play as Jack', exact: true })).toBeEnabled()
      await expect(invited.getByRole('heading', { name, exact: true })).toBeVisible()
      await expect(creationTime(invited)).toHaveAttribute('datetime', createdAt)
      await expect(creationTime(invited)).toHaveText(await creationTime(creator).innerText())
      await invited.reload()
      await expect(invited.getByRole('heading', { name: 'Choose your side' })).toBeVisible()
      await expect(invited.getByRole('heading', { name, exact: true })).toBeVisible()
      await expect(creationTime(invited)).toHaveAttribute('datetime', createdAt)
      await invited.setViewportSize({ width: 390, height: 844 })
      expect(await invited.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await reviewScreenshot(invited.getByRole('main'), { path: testInfo.outputPath('choose-side.png') })
      const pendingInvited = await sessionFor(invited)
      expect((await post(request, origin, { ...pendingInvited, token: 'X'.repeat(43) }, { type: 'side-choice', role: chosenRole })).status()).toBe(401)
      expect((await post(request, origin, pendingInvited, { type: 'side-choice', role: chosenRole, history: [] })).status()).toBe(400)
      await invited.getByRole('button', { name: chosenRole === 'jack' ? 'Play as Jack' : 'Play as Investigators', exact: true }).click()
      const creatorRole = chosenRole === 'jack' ? 'investigators' : 'jack'
      await expect(invited.getByLabel('Online game')).toContainText(chosenRole === 'jack' ? 'Online · Jack' : 'Online · Investigators')
      await expect(creator.getByLabel('Online game')).toContainText(creatorRole === 'jack' ? 'Online · Jack' : 'Online · Investigators')
      for (const page of [creator, invited]) {
        expect((await sessionFor(page)).sideChoice).toBeUndefined()
        await page.reload()
        await expect(page.getByLabel('Online game')).toContainText('Connected')
        const entries = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('whitehall-mystery.saved-game.v1.')).map(key => JSON.parse(localStorage.getItem(key)!)).filter(game => game.mode === 'online'))
        expect(entries).toHaveLength(1)
      }
      // A repeated invite recovers the assigned side; neither client can flip it.
      await invited.goto(invitation)
      await expect(invited.getByLabel('Online game')).toContainText(chosenRole === 'jack' ? 'Online · Jack' : 'Online · Investigators')
      const statusBefore = await (await post(request, origin, await sessionFor(invited), { type: 'status' })).json()
      expect((await post(request, origin, pendingInvited, { type: 'side-choice', role: creatorRole })).status()).toBe(409)
      expect(await (await post(request, origin, pendingInvited, { type: 'side-choice', role: chosenRole })).json()).toEqual({ role: chosenRole })
      expect((await (await post(request, origin, await sessionFor(invited), { type: 'status' })).json()).snapshot).toEqual(statusBefore.snapshot)
      const jack = chosenRole === 'jack' ? invited : creator
      const investigators = chosenRole === 'jack' ? creator : invited
      await jack.getByRole('button', { name: 'Rand Side', exact: true }).click()
      await expect(investigators.getByRole('heading', { name: 'Deploy the Yellow Investigator' })).toBeVisible()
    } finally { await invitedContext.close() }
  })
}

test('online invitations: leaving before the opponent chooses cancels the unassigned invitation', async ({ page: creator, browser, request }) => {
  const invitedContext = await browser.newContext()
  const invited = await invitedContext.newPage()
  try {
    await creator.goto('/')
    await creator.getByRole('button', { name: 'New game', exact: true }).click()
    await creator.getByRole('button', { name: 'Online', exact: true }).click()
    await creator.getByRole('button', { name: 'Let opponent choose their side', exact: true }).click()
    const invitation = await creator.getByLabel('Online side-choice invitation').inputValue()
    const session = await sessionFor(creator)
    const origin = new URL(creator.url()).origin
    await invited.goto(invitation)
    await expect(invited.getByRole('button', { name: 'Play as Jack', exact: true })).toBeEnabled()
    const invitedSession = await sessionFor(invited)
    const leave = { type: 'leave', requestId: crypto.randomUUID() }
    expect((await post(request, origin, session, leave)).ok()).toBe(true)
    expect((await post(request, origin, session, leave)).ok()).toBe(true)
    expect((await post(request, origin, invitedSession, { type: 'side-choice', role: 'jack' })).status()).toBe(401)
    await invited.getByRole('button', { name: 'Play as Jack', exact: true }).click()
    await expect(invited.getByRole('alert')).toContainText('invalid or the game has expired')
  } finally { await invitedContext.close() }
})

for (const creatorRole of ['jack', 'investigators'] as const) {
  test(`online invitations: invited ${creatorRole === 'jack' ? 'investigators' : 'Jack'} can restore their opponent without losing the game`, async ({ page: creator, browser, request }) => {
    const invitedContext = await browser.newContext()
    const rejoinedContext = await browser.newContext()
    const invited = await invitedContext.newPage()
    const rejoined = await rejoinedContext.newPage()
    for (const page of [creator, invited, rejoined]) await observeInvitationClipboard(page)
    try {
      await creator.goto('/')
      await creator.getByRole('button', { name: 'New game', exact: true }).click()
      await creator.getByRole('button', { name: 'Online', exact: true }).click()
      await creator.getByRole('button', { name: creatorRole === 'jack' ? 'Start new game as Jack' : 'Start new game as Investigators', exact: true }).click()
      const originalInvitation = await creator.getByLabel(creatorRole === 'jack' ? 'Online investigator invitation' : 'Online Jack invitation').inputValue()
      const creatorSession = await sessionFor(creator)
      const origin = new URL(creator.url()).origin
      await invited.goto(originalInvitation)
      const summary = invited.getByText(`Invite the ${creatorRole === 'jack' ? 'Jack' : 'investigator'} player`, { exact: true })
      const createLink = invited.getByRole('button', { name: 'Create rejoin invitation', exact: true })
      await expect(summary).toBeVisible()
      await expect(createLink).toBeEnabled()
      // Collapsing is a remembered local preference, not a credential mutation.
      await summary.click()
      await expect(createLink).not.toBeVisible()
      await expect.poll(() => invited.evaluate(() => localStorage.getItem('whitehall-mystery.online.invitation-open'))).toBe('false')
      await invited.reload()
      await expect(summary).toBeVisible()
      await expect(createLink).not.toBeVisible()
      await summary.click()
      await expect(createLink).toBeEnabled()
      const invitedSession = await sessionFor(invited)

      const jack = creatorRole === 'jack' ? creator : invited
      const investigators = creatorRole === 'jack' ? invited : creator
      await jack.getByRole('button', { name: 'Rand Side', exact: true }).click()
      await expect(investigators.getByRole('heading', { name: 'Deploy the Yellow Investigator' })).toBeVisible()
      await investigators.getByLabel('Available deployment crossings').getByRole('button').first().click()
      await expect(investigators.getByRole('heading', { name: 'Deploy the Blue Investigator' })).toBeVisible()
      await jack.getByRole('button', { name: 'Request undo', exact: true }).click()
      await expect(investigators.getByRole('region', { name: 'Undo request', exact: true })).toBeVisible()
      const before = await (await post(request, origin, invitedSession, { type: 'status' })).json()
      expect(before.undo.status).toBe('pending')

      // One case recovers an offline player; the other revokes a connected
      // session as explicitly warned. Neither requires using Leave.
      if (creatorRole === 'investigators') {
        await creator.close()
        await expect(invited.getByLabel('Online game')).toContainText('Investigators: offline')
      }
      const attempts: Array<{ type: string; requestId: string; expectedGeneration: number }> = []
      let loseReply = true
      await invited.route('**/session', async route => {
        const command = route.request().postDataJSON()
        if (command.type !== 'reinvite') { await route.continue(); return }
        attempts.push(command)
        if (loseReply) {
          loseReply = false
          expect((await route.fetch()).status()).toBe(200)
          await route.abort('failed') // The mutation committed; its response was lost.
        } else await route.continue()
      })
      invited.once('dialog', async dialog => {
        expect(dialog.message()).toContain('old access link will stop working')
        await dialog.dismiss()
      })
      await createLink.click()
      expect(attempts).toHaveLength(0)
      expect((await (await post(request, origin, invitedSession, { type: 'status' })).json()).snapshot).toEqual(before.snapshot)
      invited.once('dialog', dialog => dialog.accept())
      await createLink.click()
      await expect(invited.getByRole('button', { name: 'Retry creating invitation', exact: true })).toBeEnabled()
      const afterResponse = await post(request, origin, invitedSession, { type: 'status' })
      expect(afterResponse.status()).toBe(200)
      const after = await afterResponse.json()
      expect(after.snapshot.history).toEqual(before.snapshot.history)
      expect(after.snapshot.historyHash).toBe(before.snapshot.historyHash)
      expect(after.snapshot.revision).toBe(before.snapshot.revision + 1)
      expect(after.undo).toEqual(before.undo)
      expect(after.seats[creatorRole].leftAt).toBeNull()
      expect(after.seats[creatorRole].generation).toBe(after.snapshot.revision)
      expect(after.seats[invitedSession.role]).toEqual(before.seats[invitedSession.role])
      expect((await post(request, origin, creatorSession, { type: 'status' })).status()).toBe(401)
      if (creatorRole === 'jack') await expect(creator.getByLabel('Online game')).toContainText('Your access link was replaced')

      await invited.getByRole('button', { name: 'Retry creating invitation', exact: true }).click()
      expect(attempts).toHaveLength(2)
      expect(attempts[1]).toEqual(attempts[0])
      const invitationBox = invited.getByLabel(creatorRole === 'jack' ? 'Online Jack invitation' : 'Online investigator invitation')
      await expect(invitationBox).toBeVisible()
      const invitation = await invitationBox.inputValue()
      expect(new URL(invitation).hash).not.toContain(creatorSession.token)
      await invited.getByRole('button', { name: 'Copy invitation link', exact: true }).click()
      expect(await invited.evaluate(() => navigator.clipboard.readText())).toBe(invitation)
      await invited.reload()
      await expect(invitationBox).toHaveValue(invitation)
      await invited.setViewportSize({ width: 390, height: 844 })
      expect(await invited.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await reviewScreenshot(invited.getByLabel('Online game'), { path: `test-results/online-rejoin-${creatorRole}.png` })
      await rejoined.goto(invitation)
      await expect(rejoined.getByLabel('Online game')).toContainText(creatorRole === 'jack' ? 'Online · Jack' : 'Online · Investigators')
      const rejoinedSession = await sessionFor(rejoined)
      expect(rejoinedSession.role).toBe(creatorRole)
      expect(rejoinedSession.roomId).toBe(creatorSession.roomId)
      expect(rejoinedSession.token).not.toBe(creatorSession.token)
      const restored = await (await post(request, origin, rejoinedSession, { type: 'status' })).json()
      expect(restored.snapshot).toEqual(after.snapshot)
      expect(restored.undo).toEqual(before.undo)
      await expect(rejoined.locator('.online-departure')).toHaveCount(0)
      await expect(rejoined.getByText(`Invite the ${creatorRole === 'jack' ? 'investigator' : 'Jack'} player`, { exact: true })).toBeVisible()

      const recover = { type: 'reinvite', requestId: crypto.randomUUID(), expectedGeneration: after.seats[creatorRole].generation }
      expect((await post(request, origin, { ...invitedSession, token: 'X'.repeat(43) }, recover)).status()).toBe(401)
      for (const extra of [{ role: invitedSession.role }, { arbitrary: 'data' }, { expectedGeneration: -1 }]) {
        expect((await post(request, origin, invitedSession, { ...recover, ...extra })).status()).toBe(400)
      }
      expect((await post(request, origin, invitedSession, { ...recover, expectedGeneration: 0 })).status()).toBe(409)
      expect((await (await post(request, origin, invitedSession, { type: 'status' })).json()).snapshot).toEqual(after.snapshot)
      // Normal play and undo decisions remain usable after recovery.
      const currentInvestigators = creatorRole === 'investigators' ? rejoined : invited
      const currentJack = creatorRole === 'jack' ? rejoined : invited
      await currentInvestigators.getByRole('button', { name: 'Deny undo', exact: true }).click()
      await expect(currentJack.getByLabel('Online undo')).toContainText('Your undo request was denied.')
      await currentInvestigators.getByRole('button', { name: 'Rand Side', exact: true }).click()
      await expect(currentJack.getByRole('heading', { name: 'Jack: Choose the Starting Location' })).toBeVisible()

      // Invalid recovery retries still consume the shared per-room IP/role
      // mutation budget, without changing any gameplay or seat generation.
      const settled: { snapshot: OnlineSnapshot } = await (await post(request, origin, invitedSession, { type: 'status' })).json()
      let limited = false
      for (let index = 0; index < 21; index++) {
        const response = await post(request, origin, invitedSession, { ...recover, expectedGeneration: 0, requestId: crypto.randomUUID() })
        if (response.status() === 429) { limited = true; break }
        expect(response.status()).toBe(409)
      }
      expect(limited).toBe(true)
      expect((await (await post(request, origin, invitedSession, { type: 'status' })).json()).snapshot).toEqual(settled.snapshot)
    } finally {
      await invitedContext.close()
      await rejoinedContext.close()
    }
  })
}
