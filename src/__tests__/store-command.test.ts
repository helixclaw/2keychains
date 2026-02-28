/// <reference types="vitest/globals" />

import type { AppConfig } from '../core/config.js'

// Mock readline so promptNewPassword resolves immediately
const mockQuestion = vi.fn()
const mockRlClose = vi.fn()

vi.mock('node:readline', () => ({
  createInterface: vi.fn(() => ({
    question: mockQuestion,
    close: mockRlClose,
  })),
}))

const mockLoadConfig = vi.fn<() => AppConfig>()
const mockSaveConfig = vi.fn()

vi.mock('../core/config.js', () => ({
  loadConfig: (...args: unknown[]) => mockLoadConfig(...(args as [])),
  saveConfig: (...args: unknown[]) => mockSaveConfig(...(args as [])),
  CONFIG_DIR: '/tmp/.2kc',
}))

const mockInitialize = vi.fn()
const mockAdd = vi.fn()

vi.mock('../core/encrypted-store.js', () => ({
  EncryptedSecretStore: vi.fn(() => ({
    initialize: mockInitialize,
    add: mockAdd,
  })),
}))

// Mock fs operations used by initStore/migrateStore
const mockExistsSync = vi.fn(() => false)
const mockUnlinkSync = vi.fn()
const mockReadFileSync = vi.fn()
const mockRenameSync = vi.fn()

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...(args as [])),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...(args as [])),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...(args as [])),
  renameSync: (...args: unknown[]) => mockRenameSync(...(args as [])),
}))

function createTestConfig(overrides?: Partial<AppConfig>): AppConfig {
  return {
    mode: 'standalone',
    server: { host: '127.0.0.1', port: 2274 },
    store: { path: '/tmp/.2kc/secrets.json' },
    unlock: { ttlMs: 900_000 },
    requireApproval: {},
    defaultRequireApproval: false,
    approvalTimeoutMs: 300_000,
    ...overrides,
  }
}

function mockPasswordPrompt(password: string) {
  // promptNewPassword calls question twice (enter + confirm)
  mockQuestion
    .mockImplementationOnce((_prompt: string, cb: (answer: string) => void) => {
      cb(password)
    })
    .mockImplementationOnce((_prompt: string, cb: (answer: string) => void) => {
      cb(password)
    })
}

describe('store init command', () => {
  let savedExitCode: number | undefined

  beforeEach(() => {
    savedExitCode = process.exitCode
    process.exitCode = undefined
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(false)
  })

  afterEach(() => {
    process.exitCode = savedExitCode
  })

  it('initializes encrypted store and updates config', async () => {
    const config = createTestConfig()
    mockLoadConfig.mockReturnValue(config)
    mockPasswordPrompt('my-password')
    mockInitialize.mockResolvedValue(undefined)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const { storeCommand } = await import('../cli/store.js')
    await storeCommand.parseAsync(['init'], { from: 'user' })

    expect(mockSaveConfig).toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Initialized encrypted store'))
    expect(process.exitCode).toBeUndefined()

    logSpy.mockRestore()
    stderrSpy.mockRestore()
  })

  it('sets exitCode=1 when store is already encrypted', async () => {
    const config = createTestConfig({ store: { path: '/tmp/.2kc/secrets.enc.json' } })
    mockLoadConfig.mockReturnValue(config)

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { storeCommand } = await import('../cli/store.js')
    await storeCommand.parseAsync(['init'], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Store is already encrypted'))
    expect(process.exitCode).toBe(1)

    errorSpy.mockRestore()
  })

  it('sets exitCode=1 when initialize throws', async () => {
    const config = createTestConfig()
    mockLoadConfig.mockReturnValue(config)
    mockPasswordPrompt('pw')
    mockInitialize.mockRejectedValue(new Error('disk full'))

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const { storeCommand } = await import('../cli/store.js')
    await storeCommand.parseAsync(['init'], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith('Error: disk full')
    expect(process.exitCode).toBe(1)

    errorSpy.mockRestore()
    stderrSpy.mockRestore()
  })

  it('sets exitCode=1 when store path does not end with .json', async () => {
    const config = createTestConfig({ store: { path: '/tmp/.2kc/secrets.txt' } })
    mockLoadConfig.mockReturnValue(config)

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { storeCommand } = await import('../cli/store.js')
    await storeCommand.parseAsync(['init'], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('store.path must end in .json'))
    expect(process.exitCode).toBe(1)

    errorSpy.mockRestore()
  })
})

describe('store migrate command', () => {
  let savedExitCode: number | undefined

  beforeEach(() => {
    savedExitCode = process.exitCode
    process.exitCode = undefined
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(false)
  })

  afterEach(() => {
    process.exitCode = savedExitCode
  })

  it('migrates plaintext store and updates config', async () => {
    const config = createTestConfig()
    mockLoadConfig.mockReturnValue(config)
    mockPasswordPrompt('migrate-pw')
    // existsSync: first call for plaintextPath (true), second for encryptedPath (false),
    // third for .bak (false)
    mockExistsSync
      .mockReturnValueOnce(true) // plaintextPath exists
      .mockReturnValueOnce(false) // encryptedPath doesn't exist
      .mockReturnValueOnce(false) // .bak doesn't exist
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ secrets: [{ ref: 'test', value: 'val', tags: [] }] }),
    )
    mockInitialize.mockResolvedValue(undefined)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const { storeCommand } = await import('../cli/store.js')
    await storeCommand.parseAsync(['migrate'], { from: 'user' })

    expect(mockSaveConfig).toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Migrated'))
    expect(process.exitCode).toBeUndefined()

    logSpy.mockRestore()
    stderrSpy.mockRestore()
  })

  it('deletes existing .bak file before renaming', async () => {
    const config = createTestConfig()
    mockLoadConfig.mockReturnValue(config)
    mockPasswordPrompt('migrate-pw')
    // existsSync: plaintextPath (true), encryptedPath (false), .bak (true - exists!)
    mockExistsSync
      .mockReturnValueOnce(true) // plaintextPath exists
      .mockReturnValueOnce(false) // encryptedPath doesn't exist
      .mockReturnValueOnce(true) // .bak already exists
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ secrets: [{ ref: 'test', value: 'val', tags: [] }] }),
    )
    mockInitialize.mockResolvedValue(undefined)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const { storeCommand } = await import('../cli/store.js')
    await storeCommand.parseAsync(['migrate'], { from: 'user' })

    // Should have called unlinkSync for the .bak file
    expect(mockUnlinkSync).toHaveBeenCalledWith('/tmp/.2kc/secrets.json.bak')
    expect(mockRenameSync).toHaveBeenCalled()
    expect(process.exitCode).toBeUndefined()

    logSpy.mockRestore()
    stderrSpy.mockRestore()
  })

  it('sets exitCode=1 when store is already encrypted', async () => {
    const config = createTestConfig({ store: { path: '/tmp/.2kc/secrets.enc.json' } })
    mockLoadConfig.mockReturnValue(config)

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { storeCommand } = await import('../cli/store.js')
    await storeCommand.parseAsync(['migrate'], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Store is already encrypted'))
    expect(process.exitCode).toBe(1)

    errorSpy.mockRestore()
  })

  it('sets exitCode=1 on non-Error throws', async () => {
    const config = createTestConfig()
    mockLoadConfig.mockReturnValue(config)
    mockPasswordPrompt('pw')
    // plaintextPath does not exist - will cause an error
    mockExistsSync.mockReturnValue(false)

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const { storeCommand } = await import('../cli/store.js')
    await storeCommand.parseAsync(['migrate'], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error:'))
    expect(process.exitCode).toBe(1)

    errorSpy.mockRestore()
    stderrSpy.mockRestore()
  })
})
