import { describe, expect, it } from 'vitest'
import { isGameName, parseGameCreation } from './gameName'
import { parseOnlineSessionRequest } from './onlineSeats'

describe('bounded game names', () => {
  it('accepts empty labels and Unicode, and rejects oversized, multiline, and hidden control text', () => {
    for (const name of ['', 'Evening game', '秘密 🕵️', '界'.repeat(80)]) expect(isGameName(name)).toBe(true)
    for (const name of [null, {}, 3, 'a'.repeat(81), ' padded ', 'two\nlines', 'two\u2028lines', 'bad\u0000', 'bad\u202e']) expect(isGameName(name)).toBe(false)
  })
  it('accepts only a name on creation, never arbitrary fields or supplied game state', () => {
    expect(parseGameCreation({})).toEqual({ name: '' })
    expect(parseGameCreation({ name: 'Friday' })).toEqual({ name: 'Friday' })
    for (const value of [null, [], { name: null }, { name: 'a'.repeat(81) }, { history: [] }, { name: 'Fine', extra: 'data' }]) expect(parseGameCreation(value)).toBeNull()
  })
  it('requires an exact, authenticated rename with an expected name and idempotency ID', () => {
    const rename = { type: 'rename', token: 'A'.repeat(43), requestId: '12345678-1234-1234-1234-123456789abc', expectedName: 'Old', name: 'New' }
    expect(parseOnlineSessionRequest(rename)).toEqual(rename)
    for (const patch of [{ name: 'x'.repeat(81) }, { expectedName: null }, { token: '' }, { requestId: '123' }, { role: 'jack' }, { state: {} }]) {
      expect(parseOnlineSessionRequest({ ...rename, ...patch })).toBeNull()
    }
    const largest = { ...rename, name: '界'.repeat(80), expectedName: '界'.repeat(80) }
    expect(new TextEncoder().encode(JSON.stringify(largest)).length).toBeLessThanOrEqual(768)
  })
})
