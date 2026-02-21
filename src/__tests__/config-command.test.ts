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
    mode: 'standalone',
    server: { host: '127.0.0.1', port: 2274 },
    store: { path: '~/.2kc/secrets.json' },
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

  it('creates config with mode=standalone by default', async () => {
    const { configCommand } = await import('../cli/config.js')

    await configCommand.parseAsync(['init'], { from: 'user' })

    expect(mockWriteFileSync).toHaveBeenCalledOnce()
    const writtenJson = mockWriteFileSync.mock.calls[0][1] as string
    const writtenConfig = JSON.parse(writtenJson) as AppConfig
    expect(writtenConfig.mode).toBe('standalone')
    expect(writtenConfig.server).toEqual({ host: '127.0.0.1', port: 2274 })
    expect(writtenConfig.store).toEqual({ path: '~/.2kc/secrets.json' })
  })

  it('accepts --mode client flag', async () => {
    const { configCommand } = await import('../cli/config.js')

    await configCommand.parseAsync(['init', '--mode', 'client'], { from: 'user' })

    const writtenJson = mockWriteFileSync.mock.calls[0][1] as string
    const writtenConfig = JSON.parse(writtenJson) as AppConfig
    expect(writtenConfig.mode).toBe('client')
  })

  it('accepts --server-host and --server-port flags', async () => {
    const { configCommand } = await import('../cli/config.js')

    await configCommand.parseAsync(
      ['init', '--server-host', '192.168.1.1', '--server-port', '8080'],
      { from: 'user' },
    )

    const writtenJson = mockWriteFileSync.mock.calls[0][1] as string
    const writtenConfig = JSON.parse(writtenJson) as AppConfig
    expect(writtenConfig.server.host).toBe('192.168.1.1')
    expect(writtenConfig.server.port).toBe(8080)
  })

  it('accepts --server-auth-token flag', async () => {
    const { configCommand } = await import('../cli/config.js')

    await configCommand.parseAsync(['init', '--server-auth-token', 'my-secret'], { from: 'user' })

    const writtenJson = mockWriteFileSync.mock.calls[0][1] as string
    const writtenConfig = JSON.parse(writtenJson) as AppConfig
    expect(writtenConfig.server.authToken).toBe('my-secret')
  })

  it('accepts --store-path flag', async () => {
    const { configCommand } = await import('../cli/config.js')

    await configCommand.parseAsync(['init', '--store-path', '/custom/secrets.json'], {
      from: 'user',
    })

    const writtenJson = mockWriteFileSync.mock.calls[0][1] as string
    const writtenConfig = JSON.parse(writtenJson) as AppConfig
    expect(writtenConfig.store.path).toBe('/custom/secrets.json')
  })

  it('allows init without discord flags (all optional now)', async () => {
    const { configCommand } = await import('../cli/config.js')

    await configCommand.parseAsync(['init'], { from: 'user' })

    expect(mockWriteFileSync).toHaveBeenCalledOnce()
    const writtenJson = mockWriteFileSync.mock.calls[0][1] as string
    const writtenConfig = JSON.parse(writtenJson) as AppConfig
    expect(writtenConfig.discord).toBeUndefined()
  })

  it('accepts all discord values via flags', async () => {
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
    expect(writtenConfig.discord).toEqual({
      webhookUrl: 'https://discord.com/api/webhooks/999/xyz',
      botToken: 'my-bot-token',
      channelId: '112233',
    })
  })

  it('uses defaults for approvalTimeoutMs and defaultRequireApproval when not provided', async () => {
    const { configCommand } = await import('../cli/config.js')

    await configCommand.parseAsync(['init'], { from: 'user' })

    const writtenJson = mockWriteFileSync.mock.calls[0][1] as string
    const writtenConfig = JSON.parse(writtenJson) as AppConfig
    expect(writtenConfig.defaultRequireApproval).toBe(false)
    expect(writtenConfig.approvalTimeoutMs).toBe(300_000)
  })

  it('calls saveConfig with correct AppConfig shape (full config)', async () => {
    const { configCommand } = await import('../cli/config.js')

    await configCommand.parseAsync(
      [
        'init',
        '--mode',
        'client',
        '--server-host',
        '10.0.0.1',
        '--server-port',
        '3000',
        '--server-auth-token',
        'tok123',
        '--store-path',
        '/my/store.json',
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
      mode: 'client',
      server: { host: '10.0.0.1', port: 3000, authToken: 'tok123' },
      store: { path: '/my/store.json' },
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

  it('displays mode, server, and store fields', async () => {
    const config = createValidConfig()
    mockReadFileSync.mockReturnValue(JSON.stringify(config))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { configCommand } = await import('../cli/config.js')
    await configCommand.parseAsync(['show'], { from: 'user' })

    expect(logSpy).toHaveBeenCalledOnce()
    const output = JSON.parse(logSpy.mock.calls[0][0] as string) as Record<string, unknown>
    expect(output).toHaveProperty('mode', 'standalone')
    expect(output).toHaveProperty('server')
    expect(output).toHaveProperty('store')
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

  it('redacts server.authToken', async () => {
    const config = createValidConfig({
      server: { host: '127.0.0.1', port: 2274, authToken: 'super-secret-token' },
    })
    mockReadFileSync.mockReturnValue(JSON.stringify(config))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { configCommand } = await import('../cli/config.js')
    await configCommand.parseAsync(['show'], { from: 'user' })

    const output = JSON.parse(logSpy.mock.calls[0][0] as string) as {
      server: { authToken: string }
    }
    expect(output.server.authToken).toBe('supe...')
  })

  it('shows config with defaults when file is missing (standalone mode)', async () => {
    const err = new Error('ENOENT') as NodeJS.ErrnoException
    err.code = 'ENOENT'
    mockReadFileSync.mockImplementation(() => {
      throw err
    })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { configCommand } = await import('../cli/config.js')
    await configCommand.parseAsync(['show'], { from: 'user' })

    expect(logSpy).toHaveBeenCalledOnce()
    const output = JSON.parse(logSpy.mock.calls[0][0] as string) as Record<string, unknown>
    expect(output).toHaveProperty('mode', 'standalone')
  })

  it('shows store.path field', async () => {
    const config = createValidConfig()
    mockReadFileSync.mockReturnValue(JSON.stringify(config))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { configCommand } = await import('../cli/config.js')
    await configCommand.parseAsync(['show'], { from: 'user' })

    const output = JSON.parse(logSpy.mock.calls[0][0] as string) as { store: { path: string } }
    expect(output.store).toHaveProperty('path')
  })
})
