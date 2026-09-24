import { expect, type Page } from '@playwright/test'
import { SECRET_INFO_UNDO_WARNING } from '../../src/game/undoWarning'

export async function answerUndo(page: Page, button: string, accept: boolean) {
  const dialogPromise = page.waitForEvent('dialog')
  const click = page.getByRole('button', { name: button, exact: true }).click()
  const dialog = await dialogPromise
  expect(dialog.message()).toBe(SECRET_INFO_UNDO_WARNING)
  if (accept) await dialog.accept(); else await dialog.dismiss()
  await click
}
