import { expect, it } from 'vitest'
import { boundedRequestText } from './requestBody'

it('bounds UTF-8 bytes rather than characters and accepts legacy empty requests', async () => {
  expect(await boundedRequestText(new Request('https://test', { method: 'POST' }), 3)).toBe('')
  expect(await boundedRequestText(new Request('https://test', { method: 'POST', body: '界' }), 3)).toBe('界')
  expect(await boundedRequestText(new Request('https://test', { method: 'POST', body: '界界' }), 3)).toBeNull()
  expect(await boundedRequestText(new Request('https://test', { method: 'POST', body: new Uint8Array([255]) }), 3)).toBeNull()
})

it('handles multibyte characters split between streamed chunks without trusting Content-Length', async () => {
  const bytes = new TextEncoder().encode('界界')
  const request = () => new Request('https://test', {
    method: 'POST', body: new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close() } }),
    ...{ duplex: 'half' },
  })
  expect(await boundedRequestText(request(), 6)).toBe('界界')
  expect(await boundedRequestText(request(), 5)).toBeNull()
})
