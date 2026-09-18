import { createRoleToken, hashRoleToken, allowedOrigin, requestIp, withCors } from './security'
import { GameRoom } from './GameRoom'
import type { WorkerEnv } from './env'

export { GameRoom }

const json = (value: unknown, status = 200): Response =>
  Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })

const rateLimited = () => new Response('Too many requests.', {
  status: 429,
  headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' },
})

const gameSocketMatch = (pathname: string) => pathname.match(/^\/v1\/games\/([a-f0-9]{64})\/connect$/)

const requestHasBody = async (request: Request): Promise<boolean> => {
  const contentLength = Number(request.headers.get('Content-Length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > 0) return true
  if (!request.body) return false
  const reader = request.body.getReader()
  const first = await reader.read()
  await reader.cancel()
  return !first.done || Boolean(first.value?.byteLength)
}

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
      if (await requestHasBody(request)) return withCors(json({ error: 'Game creation does not accept a request body.' }, 400), origin)

      const objectId = env.GAME_ROOMS.newUniqueId()
      const roomId = objectId.toString()
      const jackToken = createRoleToken()
      const investigatorsToken = createRoleToken()
      const response = await env.GAME_ROOMS.get(objectId).fetch('https://room/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId,
          jackTokenHash: await hashRoleToken(jackToken),
          investigatorsTokenHash: await hashRoleToken(investigatorsToken),
        }),
      })
      if (!response.ok) return withCors(json({ error: 'Could not create the game.' }, 500), origin)
      return withCors(json({
        protocolVersion: 1,
        roomId,
        jackToken,
        investigatorsToken,
      }, 201), origin)
    }

    const match = gameSocketMatch(url.pathname)
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
