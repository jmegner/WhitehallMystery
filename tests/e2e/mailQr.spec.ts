import { expect, test, type Page } from '@playwright/test'

async function scan(page: Page, buffer: Buffer) {
    // Feed a real QR image through the live camera path and observe track cleanup.
    await page.evaluate(async data => {
      const image = new Image(); image.src = data; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 640
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 640, 640)
      ctx.drawImage(image, 100, 100, 440, 440)
      const stream = canvas.captureStream(5)
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => stream })
      Object.assign(window, { qrTestStream: stream })
    }, `data:image/png;base64,${buffer.toString('base64')}`)
    await page.getByRole('button', { name: 'Scan QR code', exact: true }).click()
    await expect(page.locator('video')).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { qrTestStream: MediaStream }).qrTestStream.getTracks().every(track => track.readyState === 'ended'))).toBe(true)
}

test('QR links and binary scan by camera, remember preferences, and preserve load validation', async ({ page, browser }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New game', exact: true }).click()
  await page.getByRole('button', { name: 'By Mail', exact: true }).click()
  await page.getByRole('button', { name: 'Start new game as Jack' }).click()
  for (const id of [33, 46, 147, 159]) await page.getByLabel(`Location ${id}, selectable`, { exact: true }).click()
  await page.getByRole('button', { name: 'Lock in four locations' }).click()
  const text = await page.getByLabel('Outgoing game text').inputValue()
  for (const [first, second] of [['Show QR code', 'Copy text'], ['Scan QR code', 'Undo']]) {
    const left = await page.getByRole('button', { name: first, exact: true }).boundingBox()
    const right = await page.getByRole('button', { name: second, exact: true }).boundingBox()
    expect(left!.x + left!.width).toBeLessThanOrEqual(right!.x)
    expect(left!.y).toBe(right!.y)
  }
  await expect(page.locator('input[type="file"]')).toHaveCount(0)
  await expect(page.getByAltText('Game QR code')).toHaveCount(0)
  await page.getByRole('button', { name: 'Show QR code', exact: true }).click()
  const qr = page.getByAltText('Game QR code')
  await expect(qr).toBeVisible()
  const linkImage = await qr.screenshot()
  await page.getByLabel('QR code contains').selectOption('binary')
  await expect(qr).toBeVisible()
  const binaryImage = await qr.screenshot()
  expect(binaryImage.equals(linkImage)).toBe(false)
  await page.reload()
  await expect(page.getByLabel('QR code contains')).toHaveValue('binary')
  await expect(qr).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Hide QR code', exact: true }).click()
  await page.reload()
  await expect(qr).toHaveCount(0)

  const context = await browser.newContext()
  const partner = await context.newPage()
  try {
    await partner.goto('/')
    await partner.getByRole('button', { name: 'New game', exact: true }).click()
    await partner.getByRole('button', { name: 'By Mail', exact: true }).click()
    await expect(partner.locator('input[type="file"]')).toHaveCount(0)
    for (const image of [linkImage, binaryImage]) {
      await scan(partner, image)
      await expect(partner.getByLabel('Game text or link from your partner')).toHaveValue(text)
    }
    await partner.getByRole('button', { name: 'Join existing game', exact: true }).click()
    await expect(partner.getByRole('heading', { name: 'Deploy the Yellow Investigator' })).toBeVisible()
    await partner.getByRole('button', { name: 'Show sharing', exact: true }).click()
    await scan(partner, binaryImage)
    await expect(partner.getByLabel('Game text or link from your partner')).toHaveValue(text)
    await expect(partner.getByRole('button', { name: 'Load partner’s reply', exact: true })).toBeDisabled()
    await expect(partner.getByRole('button', { name: 'Load partner’s correction', exact: true })).toBeEnabled()
  } finally { await context.close() }
})
