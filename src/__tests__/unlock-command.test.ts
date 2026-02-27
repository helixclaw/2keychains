/// <reference types="vitest/globals" />

import type { AppConfig } from '../core/config.js'
import type { Service } from '../core/service.js'

const mockPromptPassword = vi.fn<() => Promise<string>>()

vi.mock('../cli/password-prompt.js', () => ({
  promptPassword: (...args: unknown[]) => mockPromptPassword(...(args as [])),
}))

const mockExistsSync = vi.fn<() => boolean>()

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...(args as [])),
}))

const mockLoadConfig = vi.fn<() => AppConfig>()

vi.mock('../core/config.js', () => ({
  loadConfig: (...args: unknown[]) => mockLoadConfig(...(args as [])),
}))

const mockServiceUnlock = vi.fn<() => Promise<void>>()
const mockServiceLock = vi.fn<() => void>()

const mockService = {
  unlock: mockServiceUnlock,
  lock: mockServiceLock,
} as unknown as Service

const mockResolveService = vi.fn<() => Promise<Service>>()

vi.mock('../core/service.js', () => ({
  resolveService: (...args: unknown[]) => mockResolveService(...(args as [])),
  LocalService: vi.fn(),
}))

const mockSessionLockExists = vi.fn<() => boolean>()

vi.mock('../core/session-lock.js', () => ({
  SessionLock: vi.fn().mockImplementation(() => ({
    exists: mockSessionLockExists,
  })),
}))

function createTestConfig(): AppConfig {
  return {
    mode: 'standalone',
    server: { host: '127.0.0.1', port: 2274 },
    store: { path: '~/.2kc/secrets.json' },
    unlock: { ttlMs: 900_000 },
    requireApproval: {},
    defaultRequireApproval: false,
    approvalTimeoutMs: 300_000,
    bindCommand: false,
  }
}

describe('unlock command', () => {
  let savedExitCode: number | undefined

  beforeEach(() => {
    savedExitCode = process.exitCode
    process.exitCode = undefined
    vi.clearAllMocks()
    mockLoadConfig.mockReturnValue(createTestConfig())
    mockResolveService.mockResolvedValue(mockService)
  })

  afterEach(() => {
    process.exitCode = savedExitCode
  })

  it('unlocks successfully with correct password', async () => {
    mockExistsSync.mockReturnValue(true)
    mockPromptPassword.mockResolvedValue('correct-password')
    mockServiceUnlock.mockResolvedValue(undefined)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { unlockCommand } = await import('../cli/unlock.js')
    await unlockCommand.parseAsync([], { from: 'user' })

    expect(mockPromptPassword).toHaveBeenCalled()
    expect(mockResolveService).toHaveBeenCalled()
    expect(mockServiceUnlock).toHaveBeenCalledWith('correct-password')
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Store unlocked'))
    expect(process.exitCode).toBeUndefined()

    logSpy.mockRestore()
  })

  it('prints error and sets exitCode=1 when password is wrong', async () => {
    mockExistsSync.mockReturnValue(true)
    mockPromptPassword.mockResolvedValue('wrong-password')
    mockServiceUnlock.mockRejectedValue(new Error('Incorrect password'))

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { unlockCommand } = await import('../cli/unlock.js')
    await unlockCommand.parseAsync([], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith('Incorrect password.')
    expect(process.exitCode).toBe(1)

    errorSpy.mockRestore()
  })

  it('prints error and sets exitCode=1 when store file is missing', async () => {
    mockExistsSync.mockReturnValue(false)

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { unlockCommand } = await import('../cli/unlock.js')
    await unlockCommand.parseAsync([], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Encrypted store not found'))
    expect(process.exitCode).toBe(1)
    expect(mockPromptPassword).not.toHaveBeenCalled()

    errorSpy.mockRestore()
  })

  it('prints error and sets exitCode=1 when in client mode', async () => {
    mockLoadConfig.mockReturnValue({
      ...createTestConfig(),
      mode: 'client',
    })

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { unlockCommand } = await import('../cli/unlock.js')
    await unlockCommand.parseAsync([], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith(
      'Error: Unlock persistence is not supported in client mode.',
    )
    expect(process.exitCode).toBe(1)
    expect(mockPromptPassword).not.toHaveBeenCalled()

    errorSpy.mockRestore()
  })

  it('formats TTL in seconds when ttlMs < 60000', async () => {
    mockExistsSync.mockReturnValue(true)
    mockPromptPassword.mockResolvedValue('correct-password')
    mockServiceUnlock.mockResolvedValue(undefined)
    mockLoadConfig.mockReturnValue({
      ...createTestConfig(),
      unlock: { ttlMs: 30_000 },
    })

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { unlockCommand } = await import('../cli/unlock.js')
    await unlockCommand.parseAsync([], { from: 'user' })

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('30 seconds'))

    logSpy.mockRestore()
  })

  it('formats TTL as "1 second" (singular) for exactly 1000ms', async () => {
    mockExistsSync.mockReturnValue(true)
    mockPromptPassword.mockResolvedValue('correct-password')
    mockServiceUnlock.mockResolvedValue(undefined)
    mockLoadConfig.mockReturnValue({
      ...createTestConfig(),
      unlock: { ttlMs: 1000 },
    })

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { unlockCommand } = await import('../cli/unlock.js')
    await unlockCommand.parseAsync([], { from: 'user' })

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('1 second'))

    logSpy.mockRestore()
  })

  it('formats TTL in hours when ttlMs >= 3600000', async () => {
    mockExistsSync.mockReturnValue(true)
    mockPromptPassword.mockResolvedValue('correct-password')
    mockServiceUnlock.mockResolvedValue(undefined)
    mockLoadConfig.mockReturnValue({
      ...createTestConfig(),
      unlock: { ttlMs: 7_200_000 },
    })

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { unlockCommand } = await import('../cli/unlock.js')
    await unlockCommand.parseAsync([], { from: 'user' })

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('2 hours'))

    logSpy.mockRestore()
  })

  it('formats TTL as "1 hour" (singular) for exactly 3600000ms', async () => {
    mockExistsSync.mockReturnValue(true)
    mockPromptPassword.mockResolvedValue('correct-password')
    mockServiceUnlock.mockResolvedValue(undefined)
    mockLoadConfig.mockReturnValue({
      ...createTestConfig(),
      unlock: { ttlMs: 3_600_000 },
    })

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { unlockCommand } = await import('../cli/unlock.js')
    await unlockCommand.parseAsync([], { from: 'user' })

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('1 hour'))

    logSpy.mockRestore()
  })
})

describe('lock command', () => {
  let savedExitCode: number | undefined

  beforeEach(() => {
    savedExitCode = process.exitCode
    process.exitCode = undefined
    vi.clearAllMocks()
    mockLoadConfig.mockReturnValue(createTestConfig())
    mockResolveService.mockResolvedValue(mockService)
  })

  afterEach(() => {
    process.exitCode = savedExitCode
  })

  it('locks the service and prints "Store locked."', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { lockCommand } = await import('../cli/unlock.js')
    await lockCommand.parseAsync([], { from: 'user' })

    expect(mockResolveService).toHaveBeenCalled()
    expect(mockServiceLock).toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith('Store locked.')

    logSpy.mockRestore()
  })
})

describe('status command', () => {
  let savedExitCode: number | undefined

  beforeEach(() => {
    savedExitCode = process.exitCode
    process.exitCode = undefined
    vi.clearAllMocks()
    mockLoadConfig.mockReturnValue(createTestConfig())
  })

  afterEach(() => {
    process.exitCode = savedExitCode
  })

  it('prints "Encrypted store not found" when store file does not exist', async () => {
    mockExistsSync.mockReturnValue(false)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { statusCommand } = await import('../cli/unlock.js')
    await statusCommand.parseAsync([], { from: 'user' })

    expect(logSpy).toHaveBeenCalledWith(
      'Encrypted store not found. Run store initialization first.',
    )

    logSpy.mockRestore()
  })

  it('prints "Store is unlocked." when session exists and is valid', async () => {
    mockExistsSync.mockReturnValue(true)
    mockSessionLockExists.mockReturnValue(true)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { statusCommand } = await import('../cli/unlock.js')
    await statusCommand.parseAsync([], { from: 'user' })

    expect(logSpy).toHaveBeenCalledWith('Store is unlocked.')

    logSpy.mockRestore()
  })

  it('prints "Store is locked." when session does not exist or is expired', async () => {
    mockExistsSync.mockReturnValue(true)
    mockSessionLockExists.mockReturnValue(false)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { statusCommand } = await import('../cli/unlock.js')
    await statusCommand.parseAsync([], { from: 'user' })

    expect(logSpy).toHaveBeenCalledWith('Store is locked.')

    logSpy.mockRestore()
  })
})
