export const MAX_CLUE_TURN_LABEL_WIDTH = 44

// Approximate advances for the board's bold 11px Inter text, in SVG units.
// Narrow digits and punctuation matter; character count alone is insufficient.
const GLYPH_WIDTHS: Record<string, number> = {
  '0': 7.2, '1': 5, '2': 6.8, '3': 7, '4': 7.2,
  '5': 6.9, '6': 7.1, '7': 6.4, '8': 7.2, '9': 7.1,
  ',': 3, '-': 4.5, '.': 3,
}

export const estimatedClueTurnLabelWidth = (text: string): number =>
  [...text].reduce((width, character) => width + (GLYPH_WIDTHS[character] ?? 7.2), 0) - Math.max(0, text.length - 1) * 0.44

export function clueTurnLabel(turns: number[], maximumWidth = MAX_CLUE_TURN_LABEL_WIDTH) {
  const ordered = [...new Set(turns)].sort((a, b) => a - b)
  const ranges: string[] = []
  for (let index = 0; index < ordered.length; index++) {
    const start = ordered[index]!
    let end = start
    while (ordered[index + 1] === end + 1) end = ordered[++index]!
    ranges.push(start === end ? String(start) : `${start}-${end}`)
  }
  const fullText = ranges.join(',')
  const text = ordered.length && estimatedClueTurnLabelWidth(fullText) > maximumWidth
    ? `${ordered[0]}..${ordered.at(-1)}` : fullText
  return { text, fullText }
}
