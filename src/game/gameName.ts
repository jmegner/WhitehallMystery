export const MAX_GAME_NAME_LENGTH = 80

// Names are short, single-line labels, not arbitrary room data. Empty means unnamed.
export function isGameName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_GAME_NAME_LENGTH && value === value.trim() &&
    !/[\p{Cc}\p{Zl}\p{Zp}\u202a-\u202e\u2066-\u2069]/u.test(value)
}

export function parseGameCreation(value: unknown): { name: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  if (Object.keys(item).some(key => key !== 'name')) return null
  return item.name === undefined ? { name: '' } : isGameName(item.name) ? { name: item.name } : null
}
