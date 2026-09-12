import { prepareZXingModule, readBarcodes, writeBarcode } from 'zxing-wasm/full'
import wasmUrl from 'zxing-wasm/full/zxing_full.wasm?url'
import { mailQrBytes, mailTextFromQr, mailUrl } from './game/byMail'

prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => path.endsWith('.wasm') ? wasmUrl : prefix + path } })

export async function createMailQr(text: string, binary: boolean) {
  const result = await writeBarcode(binary ? mailQrBytes(text) : mailUrl(text), { format: 'QRCode', options: 'ecLevel=L', scale: 6 })
  if (result.error || !result.svg) throw new Error('This game is too large for a single QR code. Use Copy text or Copy link.')
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`
}

export async function readMailQr(input: ImageData): Promise<string | null> {
  const results = await readBarcodes(input, { formats: ['QRCode'], tryHarder: true, tryInvert: true })
  const messages = new Set<string>()
  for (const result of results) {
    if (!result.isValid) continue
    try { messages.add(mailTextFromQr(result.bytes)) } catch { /* Other QR codes are not game updates. */ }
  }
  if (messages.size > 1) throw new Error('Multiple game QR codes found. Show only the code you want to load.')
  return messages.values().next().value ?? null
}
