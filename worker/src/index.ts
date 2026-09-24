import { createRoleToken, hashRoleToken, allowedOrigin, requestIp, withCors } from './security'
import { GameRoom } from './GameRoom'
import type { WorkerEnv } from './env'
import { parseGameCreation } from '../../src/game/gameName'
import { boundedRequestText } from './requestBody'

export { GameRoom }

const json = (value: unknown, status = 200): Response =>
  Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })

const rateLimited = () => new Response('Too many requests.', {
  status: 429,
  headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' },
})

const gameSocketMatch = (pathname: string) => pathname.match(/^\/v1\/games\/([a-f0-9]{64})\/connect$/)

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/v1/health') return json({ ok: true })
    const origin = allowedOrigin(request, env.ALLOWED_ORIGINS)
    if (!origin) return new Response('Origin not allowed.', { status: 403 })
    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), origin)

    if (request.method === 'POST' && url.pathname === '/v1/games') {
      const limit = await env.CREATE_GAME_LIMITER.limit({ key: requestIp(request) })
      if (!limit.success) return withCors(rateLimited(), origin)
      const text = await boundedRequestText(request, 512)
      if (text === null) return withCors(json({ error: 'Game creation request too large or invalid UTF-8.' }, 413), origin)
      let creation
      try { creation = parseGameCreation(text ? JSON.parse(text) : {}) } catch { creation = null }
      if (!creation) return withCors(json({ error: 'Only an optional game name of up to 80 characters is accepted.' }, 400), origin)

      const objectId = env.GAME_ROOMS.newUniqueId()
      const roomId = objectId.toString()
      const jackToken = createRoleToken()
      const investigatorsToken = createRoleToken()
      const response = await env.GAME_ROOMS.get(objectId).fetch('https://room/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId,
          name: creation.name,
          jackTokenHash: await hashRoleToken(jackToken),
          investigatorsTokenHash: await hashRoleToken(investigatorsToken),
        }),
      })
      if (!response.ok) return withCors(json({ error: 'Could not create the game.' }, 500), origin)
      const initialized = await response.json() as { createdAt: number }
      return withCors(json({
        protocolVersion: 1,
        roomId,
        jackToken,
        investigatorsToken,
        createdAt: initialized.createdAt,
      }, 201), origin)
    }

    const match = gameSocketMatch(url.pathname)
    const sessionMatch = url.pathname.match(/^\/v1\/games\/([a-f0-9]{64})\/session$/)
    if (request.method === 'POST' && sessionMatch) {
      const limit = await env.SESSION_LIMITER.limit({ key: requestIp(request) })
      if (!limit.success) return withCors(rateLimited(), origin)
      let objectId: DurableObjectId
      try { objectId = env.GAME_ROOMS.idFromString(sessionMatch[1]!) }
      catch { return withCors(json({ error: 'The game credential is invalid or the game has expired.' }, 401), origin) }
      const headers = new Headers(request.headers)
      headers.set('X-Whitehall-Client-IP', requestIp(request))
      const response = await env.GAME_ROOMS.get(objectId).fetch('https://room/session', { method: 'POST', headers, body: request.body })
      return withCors(response, origin)
    }
    if (request.method === 'GET' && match && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const limit = await env.CONNECT_LIMITER.limit({ key: requestIp(request) })
      if (!limit.success) return withCors(rateLimited(), origin)
      let objectId: DurableObjectId
      try {
        objectId = env.GAME_ROOMS.idFromString(match[1]!)
      } catch {
        return withCors(new Response('Game not found.', { status: 404 }), origin)
      }
      const headers = new Headers(request.headers)
      headers.set('X-Whitehall-Client-IP', requestIp(request))
      const response = await env.GAME_ROOMS.get(objectId).fetch('https://room/connect', { method: 'GET', headers })
      const responseHeaders = new Headers(response.headers)
      responseHeaders.set('Access-Control-Allow-Origin', origin)
      responseHeaders.set('Vary', 'Origin')
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        webSocket: response.webSocket,
      })
    }

    return withCors(new Response('Not found.', { status: 404 }), origin)
  },
} satisfies ExportedHandler<WorkerEnv>
