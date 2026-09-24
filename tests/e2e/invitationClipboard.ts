import type { Page } from '@playwright/test'

declare global {
  interface Window {
    invitationClipboardProbe: { text: string; writes: number; writeTexts: number; blockAutomatic: boolean; gestures: boolean[] }
  }
}

// Isolate parallel games from each other and from the user's OS clipboard.
// Use real ClipboardItems, with a strict click-only write gate to model browsers
// that lose clipboard activation across the asynchronous game-creation request.
export async function observeInvitationClipboard(page: Page) {
  await page.addInitScript(() => {
    const probe = window.invitationClipboardProbe = { text: 'Clipboard before creation', writes: 0, writeTexts: 0, blockAutomatic: false, gestures: [] as boolean[] }
    let inClick = false
    document.addEventListener('click', () => { inClick = true; setTimeout(() => { inClick = false }, 0) }, true)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      write: async (items: ClipboardItem[]) => {
        probe.writes += 1
        probe.gestures.push(inClick)
        if (!inClick || probe.blockAutomatic) throw new DOMException('Clipboard blocked', 'NotAllowedError')
        const text = await (await items[0].getType('text/plain')).text()
        probe.text = text
      },
      writeText: async (text: string) => {
        probe.writeTexts += 1
        if (!inClick) throw new DOMException('Clipboard needs a click', 'NotAllowedError')
        probe.text = text
      },
      readText: async () => probe.text,
    } })
  })
}
