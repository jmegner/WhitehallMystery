// Bound bytes while streaming, including requests without Content-Length.
export async function boundedRequestText(request: Request, limit: number): Promise<string | null> {
  const reader = request.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let text = ''
  let bytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) return text + decoder.decode()
      bytes += chunk.value.byteLength
      if (bytes > limit) { await reader.cancel(); return null }
      text += decoder.decode(chunk.value, { stream: true })
    }
  } catch { await reader.cancel(); return null }
}
