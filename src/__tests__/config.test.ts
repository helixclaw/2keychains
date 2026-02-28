/// <reference types="vitest/globals" />

import { join } from 'node:path'

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  chmodSync: vi.fn(),
}))

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/tmp/test-home'),
}))

import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs'
import { loadConfig, parseConfig, resolveTilde, saveConfig, defaultConfig } from '../core/config.js'
import { ZodError } from 'zod'

/** Helper to assert ZodError is thrown with a specific path */
function expectZodErrorPath(fn: () => void, expectedPath: (string | number)[]): void {
  try {
    fn()
    expect.fail('Expected ZodError to be thrown')
  } catch (err) {
    expect(err).toBeInstanceOf(ZodError)
    expect((err as ZodError).issues[0].path).toEqual(expectedPath)
  }
}

const mockReadFileSync = vi.mocked(readFileSync)

describe('resolveTilde', () => {
  it('replaces leading ~ with homedir', () => {
    expect(resolveTilde('~/.2kc/secrets.json')).toBe(join('/tmp/test-home', '.2kc', 'secrets.json'))
  })

  it('leaves absolute paths unchanged', () => {
    expect(resolveTilde('/absolute/path')).toBe('/absolute/path')
  })

  it('resolves bare ~ to homedir', () => {
    expect(resolveTilde('~')).toBe('/tmp/test-home')
  })
})

describe('loadConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should load and parse config from ~/.2kc/config.json', () => {
    const validConfig = {
      discord: {
        botToken: 'bot-token-123',
        channelId: '999888777',
      },
    }
    mockReadFileSync.mockReturnValue(JSON.stringify(validConfig))

    const config = loadConfig()

    expect(mockReadFileSync).toHaveBeenCalledWith(
      join('/tmp/test-home', '.2kc', 'config.json'),
      'utf-8',
    )
    expect(config.discord).toEqual(validConfig.discord)
  })

  it('should return default standalone config when file is missing', () => {
    const err = new Error('ENOENT') as NodeJS.ErrnoException
    err.code = 'ENOENT'
    mockReadFileSync.mockImplementation(() => {
      throw err
    })

    const config = loadConfig()
    expect(config.mode).toBe('standalone')
    expect(config.server).toEqual({ host: '127.0.0.1', port: 2274 })
    expect(config.store.path).toBe(join('/tmp/test-home', '.2kc', 'secrets.enc.json'))
    expect(config.discord).toBeUndefined()
    expect(config.requireApproval).toEqual({})
    expect(config.defaultRequireApproval).toBe(false)
    expect(config.approvalTimeoutMs).toBe(300_000)
    expect(config.bindCommand).toBe(false)
  })

  it('should throw on invalid JSON', () => {
    mockReadFileSync.mockReturnValue('{ not valid json }}}')

    expect(() => loadConfig()).toThrow('Invalid JSON in config file')
  })

  it('should allow config without discord section', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ mode: 'standalone' }))

    const config = loadConfig()
    expect(config.discord).toBeUndefined()
    expect(config.mode).toBe('standalone')
  })
})

describe('parseConfig', () => {
  const minimalValid = {}

  const withDiscord = {
    discord: {
      channelId: '123456',
      botToken: 'bot-token',
    },
  }

  it('parses a minimal config with all defaults', () => {
    const config = parseConfig(minimalValid)
    expect(config.mode).toBe('standalone')
    expect(config.server).toEqual({ host: '127.0.0.1', port: 2274 })
    expect(config.store.path).toBe(join('/tmp/test-home', '.2kc', 'secrets.enc.json'))
    expect(config.discord).toBeUndefined()
    expect(config.requireApproval).toEqual({})
    expect(config.defaultRequireApproval).toBe(false)
    expect(config.approvalTimeoutMs).toBe(300_000)
  })

  it('parses mode field (standalone)', () => {
    const config = parseConfig({ mode: 'standalone' })
    expect(config.mode).toBe('standalone')
  })

  it('parses mode field (client)', () => {
    const config = parseConfig({ mode: 'client' })
    expect(config.mode).toBe('client')
  })

  it('defaults mode to standalone when missing', () => {
    const config = parseConfig({})
    expect(config.mode).toBe('standalone')
  })

  it('throws on invalid mode value', () => {
    expect(() => parseConfig({ mode: 'invalid' })).toThrow(ZodError)
  })

  it('parses server config with defaults', () => {
    const config = parseConfig({})
    expect(config.server.host).toBe('127.0.0.1')
    expect(config.server.port).toBe(2274)
    expect(config.server.authToken).toBeUndefined()
  })

  it('parses server config with custom values', () => {
    const config = parseConfig({
      server: { host: '192.168.1.1', port: 8080, authToken: 'my-secret-token' },
    })
    expect(config.server.host).toBe('192.168.1.1')
    expect(config.server.port).toBe(8080)
    expect(config.server.authToken).toBe('my-secret-token')
  })

  it('throws on invalid server.port (non-number)', () => {
    expect(() => parseConfig({ server: { port: 'abc' } })).toThrow(ZodError)
  })

  it('throws on invalid server.port (out of range)', () => {
    expect(() => parseConfig({ server: { port: 99999 } })).toThrow(ZodError)
  })

  it('throws on invalid server.port (zero)', () => {
    expect(() => parseConfig({ server: { port: 0 } })).toThrow(ZodError)
  })

  it('throws on server.authToken being empty string when provided', () => {
    expect(() => parseConfig({ server: { authToken: '' } })).toThrow(ZodError)
  })

  it('parses store.path and resolves ~ to homedir', () => {
    const config = parseConfig({ store: { path: '~/.2kc/my-secrets.json' } })
    expect(config.store.path).toBe(join('/tmp/test-home', '.2kc', 'my-secrets.json'))
  })

  it('uses default store.path when missing', () => {
    const config = parseConfig({})
    expect(config.store.path).toBe(join('/tmp/test-home', '.2kc', 'secrets.enc.json'))
  })

  it('allows config with no discord section (all optional)', () => {
    const config = parseConfig({})
    expect(config.discord).toBeUndefined()
  })

  it('parses discord config when present', () => {
    const config = parseConfig(withDiscord)
    expect(config.discord).toEqual(withDiscord.discord)
  })

  it('parses config with approval fields', () => {
    const config = parseConfig({
      ...withDiscord,
      requireApproval: { production: true, dev: false },
      defaultRequireApproval: true,
      approvalTimeoutMs: 60_000,
    })
    expect(config.requireApproval).toEqual({ production: true, dev: false })
    expect(config.defaultRequireApproval).toBe(true)
    expect(config.approvalTimeoutMs).toBe(60_000)
  })

  it('throws on invalid approvalTimeoutMs', () => {
    expectZodErrorPath(() => parseConfig({ approvalTimeoutMs: -1 }), ['approvalTimeoutMs'])
  })

  it('throws if config is not an object', () => {
    expect(() => parseConfig('string')).toThrow(ZodError)
  })

  it('throws if discord.channelId is missing', () => {
    expectZodErrorPath(
      () => parseConfig({ discord: { botToken: 'tok' } }),
      ['discord', 'channelId'],
    )
  })

  it('throws if discord.botToken is empty string', () => {
    expectZodErrorPath(
      () => parseConfig({ discord: { channelId: '123', botToken: '' } }),
      ['discord', 'botToken'],
    )
  })

  it('parses discord.authorizedUserIds when present', () => {
    const config = parseConfig({
      discord: {
        channelId: '123',
        botToken: 'tok',
        authorizedUserIds: ['user1', 'user2'],
      },
    })
    expect(config.discord?.authorizedUserIds).toEqual(['user1', 'user2'])
  })

  it('throws if discord.authorizedUserIds is not an array', () => {
    expectZodErrorPath(
      () =>
        parseConfig({
          discord: { channelId: '123', botToken: 'tok', authorizedUserIds: 'invalid' },
        }),
      ['discord', 'authorizedUserIds'],
    )
  })

  it('throws if discord.authorizedUserIds contains non-string', () => {
    expectZodErrorPath(
      () =>
        parseConfig({
          discord: { channelId: '123', botToken: 'tok', authorizedUserIds: ['valid', 123] },
        }),
      ['discord', 'authorizedUserIds', 1],
    )
  })

  it('parses unlock config with custom values', () => {
    const config = parseConfig({
      unlock: { ttlMs: 30_000, idleTtlMs: 10_000, maxGrantsBeforeRelock: 5 },
    })
    expect(config.unlock.ttlMs).toBe(30_000)
    expect(config.unlock.idleTtlMs).toBe(10_000)
    expect(config.unlock.maxGrantsBeforeRelock).toBe(5)
  })

  it('uses defaults for unlock config when missing', () => {
    const config = parseConfig({})
    expect(config.unlock.ttlMs).toBe(900_000)
    expect(config.unlock.idleTtlMs).toBeUndefined()
    expect(config.unlock.maxGrantsBeforeRelock).toBeUndefined()
  })

  it('validates unlock.ttlMs is positive number', () => {
    expectZodErrorPath(() => parseConfig({ unlock: { ttlMs: -1 } }), ['unlock', 'ttlMs'])
    expectZodErrorPath(() => parseConfig({ unlock: { ttlMs: 0 } }), ['unlock', 'ttlMs'])
    expectZodErrorPath(() => parseConfig({ unlock: { ttlMs: 'bad' } }), ['unlock', 'ttlMs'])
  })

  it('validates unlock.idleTtlMs is positive number when provided', () => {
    expectZodErrorPath(() => parseConfig({ unlock: { idleTtlMs: -1 } }), ['unlock', 'idleTtlMs'])
  })

  it('validates unlock.maxGrantsBeforeRelock is positive integer when provided', () => {
    expectZodErrorPath(
      () => parseConfig({ unlock: { maxGrantsBeforeRelock: 0 } }),
      ['unlock', 'maxGrantsBeforeRelock'],
    )
    expectZodErrorPath(
      () => parseConfig({ unlock: { maxGrantsBeforeRelock: 1.5 } }),
      ['unlock', 'maxGrantsBeforeRelock'],
    )
  })

  it('throws if unlock is not an object', () => {
    expectZodErrorPath(() => parseConfig({ unlock: 'bad' }), ['unlock'])
  })

  it('throws if store.path is empty string', () => {
    expectZodErrorPath(() => parseConfig({ store: { path: '' } }), ['store', 'path'])
  })

  it('throws if store.path is non-string', () => {
    expectZodErrorPath(() => parseConfig({ store: { path: 123 } }), ['store', 'path'])
  })

  it('throws if store is not an object', () => {
    expectZodErrorPath(() => parseConfig({ store: 'bad' }), ['store'])
  })

  it('throws if server is not an object', () => {
    expectZodErrorPath(() => parseConfig({ server: 'bad' }), ['server'])
  })

  it('parses server.sessionTtlMs when provided', () => {
    const config = parseConfig({ server: { sessionTtlMs: 1800000 } })
    expect(config.server.sessionTtlMs).toBe(1800000)
  })

  it('defaults server.sessionTtlMs to undefined (applied at runtime)', () => {
    const config = parseConfig({})
    expect(config.server.sessionTtlMs).toBeUndefined()
  })

  it('throws on server.sessionTtlMs below minimum (1000ms)', () => {
    expectZodErrorPath(
      () => parseConfig({ server: { sessionTtlMs: 0 } }),
      ['server', 'sessionTtlMs'],
    )
    expectZodErrorPath(
      () => parseConfig({ server: { sessionTtlMs: -1 } }),
      ['server', 'sessionTtlMs'],
    )
    expectZodErrorPath(
      () => parseConfig({ server: { sessionTtlMs: 999 } }),
      ['server', 'sessionTtlMs'],
    )
  })

  it('throws if server.host is empty string', () => {
    expectZodErrorPath(() => parseConfig({ server: { host: '' } }), ['server', 'host'])
  })

  it('throws if discord is not an object', () => {
    expectZodErrorPath(() => parseConfig({ discord: 'bad' }), ['discord'])
  })

  it('parses bindCommand: true correctly', () => {
    const config = parseConfig({ bindCommand: true })
    expect(config.bindCommand).toBe(true)
  })

  it('parses bindCommand: false correctly', () => {
    const config = parseConfig({ bindCommand: false })
    expect(config.bindCommand).toBe(false)
  })

  it('defaults bindCommand to false when missing', () => {
    const config = parseConfig({})
    expect(config.bindCommand).toBe(false)
  })
})

describe('saveConfig', () => {
  const mockWriteFileSync = vi.mocked(writeFileSync)
  const mockMkdirSync = vi.mocked(mkdirSync)
  const mockChmodSync = vi.mocked(chmodSync)

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes config JSON to the specified path with 0600 permissions', () => {
    const config = defaultConfig()
    saveConfig(config, '/tmp/test-config/config.json')

    expect(mockMkdirSync).toHaveBeenCalledWith('/tmp/test-config', { recursive: true })
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/tmp/test-config/config.json',
      expect.any(String),
      'utf-8',
    )
    expect(mockChmodSync).toHaveBeenCalledWith('/tmp/test-config/config.json', 0o600)

    // Verify JSON is valid and matches config
    const writtenJson = mockWriteFileSync.mock.calls[0][1] as string
    const parsed = JSON.parse(writtenJson)
    expect(parsed.mode).toBe('standalone')
  })
})

describe('loadConfig edge cases', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('re-throws non-ENOENT errors from readFileSync', () => {
    const err = new Error('EACCES') as NodeJS.ErrnoException
    err.code = 'EACCES'
    mockReadFileSync.mockImplementation(() => {
      throw err
    })

    expect(() => loadConfig()).toThrow('EACCES')
  })
})
