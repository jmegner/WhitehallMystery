import { afterEach, expect, it, vi } from 'vitest'
import { createOnlineGame, onlineInviteUrl, onlineSessionFromInvite, parseOnlineSession } from './onlineSession'

afterEach(() => vi.unstubAllGlobals())

it('creates as either side and saves a reloadable invitation for the opposite role', async () => {
  const response = { protocolVersion: 1, roomId: 'a'.repeat(64), jackToken: 'J'.repeat(43), investigatorsToken: 'I'.repeat(43), createdAt: Date.now() }
  const fetch = vi.fn(async () => Response.json(response, { status: 201 }))
  vi.stubGlobal('fetch', fetch)
  for (const role of ['jack', 'investigators'] as const) {
    const session = await createOnlineGame({ role, name: 'Friday' }, 'https://worker.invalid')
    expect(parseOnlineSession(session)).toEqual(session)
    expect(session.token).toBe(role === 'jack' ? response.jackToken : response.investigatorsToken)
    const invitation = onlineSessionFromInvite(onlineInviteUrl(session, 'https://game.invalid/'), session.apiBase)
    expect(invitation?.role).toBe(role === 'jack' ? 'investigators' : 'jack')
    expect(invitation?.token).toBe(role === 'jack' ? response.investigatorsToken : response.jackToken)
  }
  expect(fetch).toHaveBeenLastCalledWith('https://worker.invalid/v1/games', expect.objectContaining({ body: JSON.stringify({ name: 'Friday' }) }))
})
