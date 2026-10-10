import worker from './index'
import type { WorkerEnv } from './env'
export { GameRoom } from './index'

// Local Playwright entry point only. Browser WebSockets cannot set the edge IP
// header, so simulate Cloudflare adding it before the real Worker handles the
// request. The production configuration continues to use index.ts.
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    if (url.hostname !== '127.0.0.1') return new Response('Local QA only.', { status: 403 })
    const address = url.searchParams.get('qa-client-ip')
    if (address) {
      url.searchParams.delete('qa-client-ip')
      const headers = new Headers(request.headers)
      headers.set('CF-Connecting-IP', address)
      request = new Request(url, {
        method: request.method, headers, body: request.body, cf: request.cf,
      }) as typeof request
    }
    const response = await worker.fetch(request, env)
    // HTTP requests carry the synthetic header directly. Allow it on successful
    // local preflights, preserving the real service's origin checks and limits.
    if (request.method === 'OPTIONS' && response.status === 204) {
      const headers = new Headers(response.headers)
      headers.set('Access-Control-Allow-Headers', `${headers.get('Access-Control-Allow-Headers')}, CF-Connecting-IP`)
      return new Response(response.body, { status: response.status, headers })
    }
    return response
  },
} satisfies ExportedHandler<WorkerEnv>
