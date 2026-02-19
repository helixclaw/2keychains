/// <reference types="vitest/globals" />

import { join } from 'node:path'

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}))

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/tmp/test-home'),
}))

import { readFileSync } from 'node:fs'
import { loadConfig } from '../core/config.js'

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
    expect(config).toEqual(validConfig)
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

  it('should throw when discord config fields are missing', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ discord: {} }))

    expect(() => loadConfig()).toThrow(
      'Config must include discord.webhookUrl, discord.botToken, and discord.channelId',
    )
  })

  it('should throw when discord section is missing entirely', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ someOtherKey: true }))

    expect(() => loadConfig()).toThrow(
      'Config must include discord.webhookUrl, discord.botToken, and discord.channelId',
    )
  })
})
