import { afterEach, expect, it, vi } from 'vitest'
import { copyInvitationWhenReady } from './invitationClipboard'

afterEach(() => vi.unstubAllGlobals())

function clipboard(write: (items: Array<{ data: Record<string, Promise<Blob>> }>) => Promise<void>) {
  vi.stubGlobal('ClipboardItem', class { data: Record<string, Promise<Blob>>; constructor(data: Record<string, Promise<Blob>>) { this.data = data } })
  vi.stubGlobal('navigator', { clipboard: { write } })
}

it('starts the clipboard write immediately, but waits for the real invitation before supplying text', async () => {
  let ready!: (text: string) => void
  const invitation = new Promise<string>(resolve => { ready = resolve })
  let copied = ''
  const write = vi.fn(async items => { copied = await (await items[0].data['text/plain']).text() })
  clipboard(write)
  const result = copyInvitationWhenReady(invitation)
  expect(write).toHaveBeenCalledTimes(1)
  expect(copied).toBe('')
  ready('https://game.invalid/#online=opponent-credential')
  expect(await result).toBe(true)
  expect(copied).toBe('https://game.invalid/#online=opponent-credential')
})

it('reports blocked writes without claiming success or retrying permission requests', async () => {
  const write = vi.fn(async () => { throw new Error('Not allowed') })
  clipboard(write)
  expect(await copyInvitationWhenReady(Promise.resolve('invitation'))).toBe(false)
  expect(write).toHaveBeenCalledTimes(1)
})

it('does not overwrite the clipboard if creating the game fails', async () => {
  let copied = 'Keep this'
  clipboard(async items => { copied = await (await items[0].data['text/plain']).text() })
  expect(await copyInvitationWhenReady(Promise.reject(new Error('Creation failed')))).toBe(false)
  expect(copied).toBe('Keep this')
})

it('handles failed creation even when a refused write never consumes the data promise', async () => {
  clipboard(async () => { throw new Error('Not allowed') })
  expect(await copyInvitationWhenReady(Promise.reject(new Error('Creation failed')))).toBe(false)
})

it('falls back to writeText on older browsers and reports missing clipboard support', async () => {
  vi.stubGlobal('ClipboardItem', undefined)
  const writeText = vi.fn(async () => {})
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  expect(await copyInvitationWhenReady(Promise.resolve('invitation'))).toBe(true)
  expect(writeText).toHaveBeenCalledWith('invitation')
  vi.stubGlobal('navigator', {})
  expect(await copyInvitationWhenReady(Promise.resolve('invitation'))).toBe(false)
  expect(await copyInvitationWhenReady(Promise.reject(new Error('Creation failed')))).toBe(false)
})
