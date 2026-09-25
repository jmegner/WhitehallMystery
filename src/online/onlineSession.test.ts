import { afterEach, expect, it, vi } from 'vitest'
import { createOnlineGame, inviteOnlineRejoin, onlineInviteUrl, onlineSessionFromInvite, parseOnlineSession } from './onlineSession'

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

it('validates rejoin responses and sends only a scoped recovery command', async () => {
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  const session = { apiBase: 'https://worker.invalid', roomId: 'a'.repeat(64), role: 'investigators' as const, token: 'I'.repeat(43) }
  const requestId = crypto.randomUUID()
  const result = { token: 'J'.repeat(43), role: 'jack', generation: 8 }
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(result))
  vi.stubGlobal('fetch', fetch)
  expect(await inviteOnlineRejoin(session, requestId, 7)).toEqual({ token: result.token, generation: 8 })
  expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({ type: 'reinvite', token: session.token, requestId, expectedGeneration: 7 })
  for (const invalid of [{ ...result, role: 'investigators' }, { ...result, generation: 7 }, { ...result, token: 'bad' }]) {
    fetch.mockImplementationOnce(async () => Response.json(invalid))
    await expect(inviteOnlineRejoin(session, requestId, 7)).rejects.toThrow('invalid rejoin invitation')
  }
  fetch.mockImplementationOnce(async () => Response.json({ error: 'Invalid session request.' }, { status: 400 }))
  await expect(inviteOnlineRejoin(session, requestId, 7)).rejects.toThrow('updated multiplayer Worker')
})
