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

import { saveConfig, defaultConfig, CONFIG_PATH, type AppConfig } from '../core/config.js'

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
  let savedExitCode: number | undefined

  beforeEach(() => {
    savedExitCode = process.exitCode
    process.exitCode = undefined
  })

  afterEach(() => {
    process.exitCode = savedExitCode
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
        '--bot-token',
        'my-bot-token',
        '--channel-id',
        '112233',
        '--authorized-user-ids',
        'user1,user2',
      ],
      { from: 'user' },
    )

    expect(mockWriteFileSync).toHaveBeenCalledOnce()
    const writtenJson = mockWriteFileSync.mock.calls[0][1] as string
    const writtenConfig = JSON.parse(writtenJson) as AppConfig
    expect(writtenConfig.discord).toEqual({
      botToken: 'my-bot-token',
      channelId: '112233',
      authorizedUserIds: ['user1', 'user2'],
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
      unlock: defaultConfig().unlock,
      discord: {
        botToken: 'my-bot-token',
        channelId: '112233',
      },
      requireApproval: {},
      defaultRequireApproval: false,
      approvalTimeoutMs: 60_000,
      bindCommand: false,
    })
  })

  it('rejects invalid --mode value', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { configCommand } = await import('../cli/config.js')
    await configCommand.parseAsync(['init', '--mode', 'invalid-mode'], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid --mode: must be "standalone" or "client"'),
    )
    expect(process.exitCode).toBe(1)
    expect(mockWriteFileSync).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('rejects non-numeric --server-port', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { configCommand } = await import('../cli/config.js')
    await configCommand.parseAsync(['init', '--server-port', 'abc'], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid --server-port: must be an integer between 1 and 65535'),
    )
    expect(process.exitCode).toBe(1)
    expect(mockWriteFileSync).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('rejects --server-port out of range (too high)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { configCommand } = await import('../cli/config.js')
    await configCommand.parseAsync(['init', '--server-port', '70000'], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid --server-port: must be an integer between 1 and 65535'),
    )
    expect(process.exitCode).toBe(1)
    expect(mockWriteFileSync).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('rejects --server-port out of range (zero)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { configCommand } = await import('../cli/config.js')
    await configCommand.parseAsync(['init', '--server-port', '0'], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid --server-port: must be an integer between 1 and 65535'),
    )
    expect(process.exitCode).toBe(1)
    expect(mockWriteFileSync).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('rejects invalid --approval-timeout', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { configCommand } = await import('../cli/config.js')
    await configCommand.parseAsync(['init', '--approval-timeout', 'not-a-number'], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid --approval-timeout: must be a positive integer'),
    )
    expect(process.exitCode).toBe(1)
    expect(mockWriteFileSync).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('rejects zero --approval-timeout', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { configCommand } = await import('../cli/config.js')
    await configCommand.parseAsync(['init', '--approval-timeout', '0'], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid --approval-timeout: must be a positive integer'),
    )
    expect(process.exitCode).toBe(1)
    expect(mockWriteFileSync).not.toHaveBeenCalled()
    errorSpy.mockRestore()
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

  it('does not truncate short authToken (<=4 chars)', async () => {
    const config = createValidConfig({
      server: { host: '127.0.0.1', port: 2274, authToken: 'abc' },
    })
    mockReadFileSync.mockReturnValue(JSON.stringify(config))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { configCommand } = await import('../cli/config.js')
    await configCommand.parseAsync(['show'], { from: 'user' })

    const output = JSON.parse(logSpy.mock.calls[0][0] as string) as {
      server: { authToken: string }
    }
    expect(output.server.authToken).toBe('abc')
    logSpy.mockRestore()
  })

  it('shows bindCommand field in output', async () => {
    const config = createValidConfig({ bindCommand: true } as Partial<AppConfig>)
    mockReadFileSync.mockReturnValue(JSON.stringify(config))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { configCommand } = await import('../cli/config.js')
    await configCommand.parseAsync(['show'], { from: 'user' })

    const output = JSON.parse(logSpy.mock.calls[0][0] as string) as Record<string, unknown>
    expect(output).toHaveProperty('bindCommand', true)
    logSpy.mockRestore()
  })

  it('does not truncate short botToken (<=4 chars)', async () => {
    const config = createValidConfig({
      discord: {
        botToken: 'tok',
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
    expect(output.discord.botToken).toBe('tok')
    logSpy.mockRestore()
  })
})
