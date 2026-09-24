export type InvitationCopyStatus = 'copying' | 'copied' | 'unavailable'

// Call directly from the Create button's event handler. Passing promised data
// keeps clipboard.write inside the user gesture while the room is created.
// https://webkit.org/blog/10855/async-clipboard-api/
export function copyInvitationWhenReady(invitation: Promise<string>): Promise<boolean> {
  const blob = invitation.then(text => new Blob([text], { type: 'text/plain' }))
  // A browser may refuse the write before it consumes the promised data. A
  // failed creation must not then cause an unhandled rejection or an empty copy.
  void blob.catch(() => {})
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      return navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]).then(() => true, () => false)
    }
  } catch { return Promise.resolve(false) }
  // Older browsers may only expose writeText. It is best-effort after the
  // network response; the normal Copy button supplies a fresh gesture if needed.
  return invitation.then(async text => {
    try { await navigator.clipboard.writeText(text); return true }
    catch { return false }
  }, () => false)
}
