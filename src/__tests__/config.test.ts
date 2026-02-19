/// <reference types="vitest/globals" />

import { join } from 'node:path'

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}))

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/tmp/test-home'),
}))

import { readFileSync } from 'node:fs'
import { loadConfig, parseConfig } from '../core/config.js'

const mockReadFileSync = vi.mocked(readFileSync)

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

  it('should throw descriptive error when config file is missing', () => {
    const err = new Error('ENOENT') as NodeJS.ErrnoException
    err.code = 'ENOENT'
    mockReadFileSync.mockImplementation(() => {
      throw err
    })

    expect(() => loadConfig()).toThrow('Config file not found: /tmp/test-home/.2kc/config.json')
  })

  it('should throw on invalid JSON', () => {
    mockReadFileSync.mockReturnValue('{ not valid json }}}')

    expect(() => loadConfig()).toThrow('Invalid JSON in config file')
  })

  it('should throw when discord section is missing entirely', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ someOtherKey: true }))

    expect(() => loadConfig()).toThrow('Config must contain a "discord" object')
  })
})

describe('parseConfig', () => {
  const minimalValid = {
    discord: {
      webhookUrl: 'https://discord.com/api/webhooks/123/abc',
      channelId: '123456',
      botToken: 'bot-token',
    },
  }

  it('parses a minimal config with default approval fields', () => {
    const config = parseConfig(minimalValid)
    expect(config.requireApproval).toEqual({})
    expect(config.defaultRequireApproval).toBe(false)
    expect(config.approvalTimeoutMs).toBe(300_000)
  })

  it('parses config with approval fields', () => {
    const config = parseConfig({
      ...minimalValid,
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
      ...minimalValid,
      requireApproval: { production: true, bad: 'yes', worse: 42 },
    })
    expect(config.requireApproval).toEqual({ production: true })
  })

  it('defaults approvalTimeoutMs for invalid values', () => {
    const config = parseConfig({
      ...minimalValid,
      approvalTimeoutMs: -1,
    })
    expect(config.approvalTimeoutMs).toBe(300_000)
  })

  it('throws if config is not an object', () => {
    expect(() => parseConfig('string')).toThrow('Config must be a JSON object')
  })

  it('throws if discord config is missing', () => {
    expect(() => parseConfig({})).toThrow('Config must contain a "discord" object')
  })

  it('parses discord config fields', () => {
    const config = parseConfig(minimalValid)
    expect(config.discord.webhookUrl).toBe('https://discord.com/api/webhooks/123/abc')
    expect(config.discord.channelId).toBe('123456')
    expect(config.discord.botToken).toBe('bot-token')
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
