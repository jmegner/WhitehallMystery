import { test, type Locator, type Page } from '@playwright/test'

// These images support manual review; assertions run regardless. Keep actual
// screenshot inputs (such as QR decoding) separate and unconditional.
export async function reviewScreenshot(target: Page | Locator, options: Parameters<Page['screenshot']>[0]) {
  const trace = test.info().project.use.trace
  const mode = typeof trace === 'string' ? trace : trace?.mode
  if (mode && mode !== 'off') await target.screenshot(options)
}
