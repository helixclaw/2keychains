/// <reference types="vitest/globals" />

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
import { join } from 'node:path'

import { saveConfig, CONFIG_PATH, type AppConfig } from '../core/config.js'

const mockReadFileSync = vi.mocked(readFileSync)
const mockWriteFileSync = vi.mocked(writeFileSync)
const mockMkdirSync = vi.mocked(mkdirSync)
const mockChmodSync = vi.mocked(chmodSync)

function createValidConfig(overrides?: Partial<AppConfig>): AppConfig {
  return {
    discord: {
      webhookUrl: 'https://discord.com/api/webhooks/123/abc',
      botToken: 'bot-token-1234567890',
      channelId: '999888777',
    },
    requireApproval: {},
    defaultRequireApproval: false,
    approvalTimeoutMs: 300_000,
    ...overrides,
  }
}

describe('saveConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates ~/.2kc directory if missing', () => {
    const config = createValidConfig()
    saveConfig(config)

    expect(mockMkdirSync).toHaveBeenCalledWith(join('/tmp/test-home', '.2kc'), { recursive: true })
  })

  it('writes valid JSON with correct structure', () => {
    const config = createValidConfig()
    saveConfig(config)

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      CONFIG_PATH,
      JSON.stringify(config, null, 2),
      'utf-8',
    )
  })

  it('sets file permissions to 0o600', () => {
    const config = createValidConfig()
    saveConfig(config)

    expect(mockChmodSync).toHaveBeenCalledWith(CONFIG_PATH, 0o600)
  })
})

describe('config init action', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('accepts all values via flags (non-interactive)', async () => {
    const { configCommand } = await import('../cli/config.js')

    await configCommand.parseAsync(
      [
        'init',
        '--webhook-url',
        'https://discord.com/api/webhooks/999/xyz',
        '--bot-token',
        'my-bot-token',
        '--channel-id',
        '112233',
      ],
      { from: 'user' },
    )

    expect(mockWriteFileSync).toHaveBeenCalledOnce()
    const writtenJson = mockWriteFileSync.mock.calls[0][1] as string
    const writtenConfig = JSON.parse(writtenJson) as AppConfig
    expect(writtenConfig.discord.webhookUrl).toBe('https://discord.com/api/webhooks/999/xyz')
    expect(writtenConfig.discord.botToken).toBe('my-bot-token')
    expect(writtenConfig.discord.channelId).toBe('112233')
  })

  it('uses defaults for approvalTimeoutMs and defaultRequireApproval when not provided', async () => {
    const { configCommand } = await import('../cli/config.js')

    await configCommand.parseAsync(
      [
        'init',
        '--webhook-url',
        'https://discord.com/api/webhooks/999/xyz',
        '--bot-token',
        'my-bot-token',
        '--channel-id',
        '112233',
      ],
      { from: 'user' },
    )

    const writtenJson = mockWriteFileSync.mock.calls[0][1] as string
    const writtenConfig = JSON.parse(writtenJson) as AppConfig
    expect(writtenConfig.defaultRequireApproval).toBe(false)
    expect(writtenConfig.approvalTimeoutMs).toBe(300_000)
  })

  it('calls saveConfig with correct AppConfig shape', async () => {
    const { configCommand } = await import('../cli/config.js')

    await configCommand.parseAsync(
      [
        'init',
        '--webhook-url',
        'https://discord.com/api/webhooks/999/xyz',
        '--bot-token',
        'my-bot-token',
        '--channel-id',
        '112233',
        '--approval-timeout',
        '60000',
      ],
      { from: 'user' },
    )

    const writtenJson = mockWriteFileSync.mock.calls[0][1] as string
    const writtenConfig = JSON.parse(writtenJson) as AppConfig
    expect(writtenConfig).toEqual({
      discord: {
        webhookUrl: 'https://discord.com/api/webhooks/999/xyz',
        botToken: 'my-bot-token',
        channelId: '112233',
      },
      requireApproval: {},
      defaultRequireApproval: false,
      approvalTimeoutMs: 60_000,
    })
  })
})

describe('config show action', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads and displays config', async () => {
    const config = createValidConfig()
    mockReadFileSync.mockReturnValue(JSON.stringify(config))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { configCommand } = await import('../cli/config.js')
    await configCommand.parseAsync(['show'], { from: 'user' })

    expect(logSpy).toHaveBeenCalledOnce()
    const output = JSON.parse(logSpy.mock.calls[0][0] as string) as Record<string, unknown>
    expect(output).toHaveProperty('discord')
  })

  it('redacts botToken (shows first 4 chars + "...")', async () => {
    const config = createValidConfig({
      discord: {
        webhookUrl: 'https://discord.com/api/webhooks/123/abcdefghij',
        botToken: 'bot-token-1234567890',
        channelId: '999888777',
      },
    })
    mockReadFileSync.mockReturnValue(JSON.stringify(config))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { configCommand } = await import('../cli/config.js')
    await configCommand.parseAsync(['show'], { from: 'user' })

    const output = JSON.parse(logSpy.mock.calls[0][0] as string) as {
      discord: { botToken: string }
    }
    expect(output.discord.botToken).toBe('bot-...')
  })

  it('redacts webhookUrl (shows first 20 chars + "...")', async () => {
    const config = createValidConfig({
      discord: {
        webhookUrl: 'https://discord.com/api/webhooks/123/abcdefghij',
        botToken: 'bot-token-1234567890',
        channelId: '999888777',
      },
    })
    mockReadFileSync.mockReturnValue(JSON.stringify(config))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { configCommand } = await import('../cli/config.js')
    await configCommand.parseAsync(['show'], { from: 'user' })

    const output = JSON.parse(logSpy.mock.calls[0][0] as string) as {
      discord: { webhookUrl: string }
    }
    expect(output.discord.webhookUrl).toBe('https://discord.com/...')
  })

  it('errors with actionable message when config file missing', async () => {
    const err = new Error('ENOENT') as NodeJS.ErrnoException
    err.code = 'ENOENT'
    mockReadFileSync.mockImplementation(() => {
      throw err
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { configCommand } = await import('../cli/config.js')
    const savedExitCode = process.exitCode
    await configCommand.parseAsync(['show'], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith('No config found. Run: 2kc config init')
    expect(process.exitCode).toBe(1)
    process.exitCode = savedExitCode
  })
})
