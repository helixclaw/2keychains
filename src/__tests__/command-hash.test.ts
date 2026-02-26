import { describe, it, expect } from 'vitest'
import { normalizeCommand, hashCommand } from '../core/command-hash.js'

describe('normalizeCommand', () => {
  it('trims leading/trailing whitespace', () => {
    expect(normalizeCommand('  echo hello  ')).toBe('echo hello')
  })

  it('collapses internal whitespace to single spaces', () => {
    expect(normalizeCommand('echo   hello\t\tworld')).toBe('echo hello world')
  })

  it('lowercases the entire string', () => {
    expect(normalizeCommand('ECHO HELLO')).toBe('echo hello')
  })

  it('handles combined: "  FOO   BAR  " → "foo bar"', () => {
    expect(normalizeCommand('  FOO   BAR  ')).toBe('foo bar')
  })

  it('throws on empty string', () => {
    expect(() => normalizeCommand('')).toThrow('command must not be empty')
  })

  it('throws on whitespace-only string', () => {
    expect(() => normalizeCommand('   ')).toThrow('command must not be empty')
  })
})

describe('hashCommand', () => {
  it('returns a 64-character hex string', () => {
    const hash = hashCommand('echo hello')
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic — same input yields same hash', () => {
    const hash1 = hashCommand('echo hello')
    const hash2 = hashCommand('echo hello')
    expect(hash1).toBe(hash2)
  })

  it('different inputs yield different hashes', () => {
    const hash1 = hashCommand('echo hello')
    const hash2 = hashCommand('echo world')
    expect(hash1).not.toBe(hash2)
  })

  it('round-trip: normalizeCommand then hashCommand is stable across calls', () => {
    const input = '  ECHO   Hello World  '
    const hash1 = hashCommand(normalizeCommand(input))
    const hash2 = hashCommand(normalizeCommand(input))
    expect(hash1).toBe(hash2)
    expect(hash1).toBe(hashCommand('echo hello world'))
  })
})
