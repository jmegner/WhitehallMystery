import { sha256Hex } from '../../src/game/onlineProtocol'

const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export const createRoleToken = (): string => {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return bytesToBase64Url(bytes)
}

export const hashRoleToken = (token: string): Promise<string> => sha256Hex(token)

// Retry-safe invitation tokens without persisting plaintext credentials. The
// authenticated requester's secret keys a domain-separated HMAC for this invite.
export const replacementToken = async (token: string, roomId: string, requestId: string, generation = 0): Promise<string> => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`whitehall-replacement-v1:${roomId}:${requestId}:${generation}`))
  return bytesToBase64Url(new Uint8Array(signature))
}

export const fixedTimeEqual = (left: string, right: string): boolean => {
  const length = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return difference === 0
}

export const requestIp = (request: Request): string =>
  request.headers.get('CF-Connecting-IP') ?? 'local-development'

const localHostnames = new Set(['localhost', '127.0.0.1', '[::1]'])

export const allowedOrigin = (request: Request, configuredOrigins: string): string | null => {
  const origin = request.headers.get('Origin')
  if (!origin) return null
  let originUrl: URL
  try {
    originUrl = new URL(origin)
  } catch {
    return null
  }
  const requestHost = new URL(request.url).hostname
  if (localHostnames.has(requestHost) && localHostnames.has(originUrl.hostname)) return origin
  const allowed = configuredOrigins.split(',').map((value) => value.trim()).filter(Boolean)
  return allowed.includes(origin) ? origin : null
}

export const withCors = (response: Response, origin: string): Response => {
  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Access-Control-Allow-Headers', 'Content-Type')
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  headers.set('Access-Control-Max-Age', '86400')
  headers.set('Vary', 'Origin')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
