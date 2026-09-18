import { describe, expect, it } from 'vitest'
import { allowedOrigin, createRoleToken, fixedTimeEqual, hashRoleToken } from './security'

describe('Worker security helpers', () => {
  it('creates high-entropy role credentials and stores them as hashes', async () => {
    const first = createRoleToken()
    const second = createRoleToken()
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(second).not.toBe(first)
    expect(await hashRoleToken(first)).toMatch(/^[a-f0-9]{64}$/)
  })

  it('compares token hashes without an early length or character exit', () => {
    expect(fixedTimeEqual('abc', 'abc')).toBe(true)
    expect(fixedTimeEqual('abc', 'abd')).toBe(false)
    expect(fixedTimeEqual('abc', 'abc0')).toBe(false)
  })

  it('allows configured production origins and local origins only on a local Worker', () => {
    expect(allowedOrigin(new Request('https://worker.example/v1/games', {
      headers: { Origin: 'https://game.example' },
    }), 'https://game.example')).toBe('https://game.example')
    expect(allowedOrigin(new Request('https://worker.example/v1/games', {
      headers: { Origin: 'http://127.0.0.1:5000' },
    }), 'https://game.example')).toBeNull()
    expect(allowedOrigin(new Request('http://127.0.0.1:8787/v1/games', {
      headers: { Origin: 'http://127.0.0.1:5000' },
    }), 'https://game.example')).toBe('http://127.0.0.1:5000')
  })
})
