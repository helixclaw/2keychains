/// <reference types="vitest/globals" />

import { join } from 'node:path'

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}))

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/tmp/test-home'),
}))

import { readFileSync } from 'node:fs'
import { loadConfig, parseConfig, resolveTilde } from '../core/config.js'

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
        webhookUrl: 'https://discord.com/api/webhooks/123/abc',
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
    expect(config.store.path).toBe(join('/tmp/test-home', '.2kc', 'secrets.json'))
    expect(config.discord).toBeUndefined()
    expect(config.requireApproval).toEqual({})
    expect(config.defaultRequireApproval).toBe(false)
    expect(config.approvalTimeoutMs).toBe(300_000)
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
      webhookUrl: 'https://discord.com/api/webhooks/123/abc',
      channelId: '123456',
      botToken: 'bot-token',
    },
  }

  it('parses a minimal config with all defaults', () => {
    const config = parseConfig(minimalValid)
    expect(config.mode).toBe('standalone')
    expect(config.server).toEqual({ host: '127.0.0.1', port: 2274 })
    expect(config.store.path).toBe(join('/tmp/test-home', '.2kc', 'secrets.json'))
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
    expect(() => parseConfig({ mode: 'invalid' })).toThrow('mode must be "standalone" or "client"')
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
    expect(() => parseConfig({ server: { port: 'abc' } })).toThrow(
      'server.port must be an integer between 1 and 65535',
    )
  })

  it('throws on invalid server.port (out of range)', () => {
    expect(() => parseConfig({ server: { port: 99999 } })).toThrow(
      'server.port must be an integer between 1 and 65535',
    )
  })

  it('throws on invalid server.port (zero)', () => {
    expect(() => parseConfig({ server: { port: 0 } })).toThrow(
      'server.port must be an integer between 1 and 65535',
    )
  })

  it('throws on server.authToken being empty string when provided', () => {
    expect(() => parseConfig({ server: { authToken: '' } })).toThrow(
      'server.authToken must be a non-empty string when provided',
    )
  })

  it('parses store.path and resolves ~ to homedir', () => {
    const config = parseConfig({ store: { path: '~/.2kc/my-secrets.json' } })
    expect(config.store.path).toBe(join('/tmp/test-home', '.2kc', 'my-secrets.json'))
  })

  it('uses default store.path when missing', () => {
    const config = parseConfig({})
    expect(config.store.path).toBe(join('/tmp/test-home', '.2kc', 'secrets.json'))
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

  it('ignores non-boolean values in requireApproval', () => {
    const config = parseConfig({
      ...withDiscord,
      requireApproval: { production: true, bad: 'yes', worse: 42 },
    })
    expect(config.requireApproval).toEqual({ production: true })
  })

  it('defaults approvalTimeoutMs for invalid values', () => {
    const config = parseConfig({
      approvalTimeoutMs: -1,
    })
    expect(config.approvalTimeoutMs).toBe(300_000)
  })

  it('throws if config is not an object', () => {
    expect(() => parseConfig('string')).toThrow('Config must be a JSON object')
  })

  it('throws if discord.webhookUrl is missing', () => {
    expect(() => parseConfig({ discord: { channelId: '123', botToken: 'tok' } })).toThrow(
      'discord.webhookUrl must be a non-empty string',
    )
  })

  it('throws if discord.webhookUrl is empty string', () => {
    expect(() =>
      parseConfig({ discord: { webhookUrl: '', channelId: '123', botToken: 'tok' } }),
    ).toThrow('discord.webhookUrl must be a non-empty string')
  })

  it('throws if discord.channelId is missing', () => {
    expect(() =>
      parseConfig({ discord: { webhookUrl: 'https://example.com', botToken: 'tok' } }),
    ).toThrow('discord.channelId must be a non-empty string')
  })

  it('throws if discord.botToken is empty string', () => {
    expect(() =>
      parseConfig({
        discord: { webhookUrl: 'https://example.com', channelId: '123', botToken: '' },
      }),
    ).toThrow('discord.botToken must be a non-empty string')
  })
})
