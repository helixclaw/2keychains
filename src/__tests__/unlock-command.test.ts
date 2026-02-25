/// <reference types="vitest/globals" />

import type { AppConfig } from '../core/config.js'

const mockQuestion = vi.fn()
const mockRlClose = vi.fn()

vi.mock('node:readline', () => ({
  createInterface: vi.fn(() => ({
    question: mockQuestion,
    close: mockRlClose,
  })),
}))

const mockExistsSync = vi.fn<() => boolean>()
const mockReadFileSync = vi.fn<() => string>()

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...(args as [])),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...(args as [])),
}))

const mockLoadConfig = vi.fn<() => AppConfig>()

vi.mock('../core/config.js', () => ({
  loadConfig: (...args: unknown[]) => mockLoadConfig(...(args as [])),
}))

const mockDeriveKek = vi.fn<() => Promise<Buffer>>()

vi.mock('../core/kdf.js', () => ({
  deriveKek: (...args: unknown[]) => mockDeriveKek(...(args as [])),
}))

const mockUnwrapDek = vi.fn<() => Buffer>()

vi.mock('../core/crypto.js', () => ({
  unwrapDek: (...args: unknown[]) => mockUnwrapDek(...(args as [])),
}))

const mockSessionUnlock = vi.fn<() => void>()
const mockSessionLock = vi.fn<() => void>()

vi.mock('../core/unlock-session.js', () => ({
  UnlockSession: vi.fn(),
}))

import { UnlockSession } from '../core/unlock-session.js'
const MockUnlockSession = vi.mocked(UnlockSession)

const MOCK_STORE_FILE = {
  version: 1,
  kdf: {
    algorithm: 'scrypt',
    salt: Buffer.from('testsalt').toString('base64'),
    params: { N: 1024, r: 8, p: 1 },
  },
  wrappedDek: {
    ciphertext: 'aGVsbG8=',
    nonce: 'bm9uY2U=',
    tag: 'dGFn',
  },
  secrets: [],
}

function createTestConfig(): AppConfig {
  return {
    mode: 'standalone',
    server: { host: '127.0.0.1', port: 2274 },
    store: { path: '~/.2kc/secrets.json' },
    unlock: { ttlMs: 900_000 },
    requireApproval: {},
    defaultRequireApproval: false,
    approvalTimeoutMs: 300_000,
  }
}

describe('unlock command', () => {
  let savedExitCode: number | undefined

  beforeEach(() => {
    savedExitCode = process.exitCode
    process.exitCode = undefined
    vi.clearAllMocks()

    // Reset the mock session methods to fresh fns after clearAllMocks
    MockUnlockSession.mockImplementation(function () {
      return {
        unlock: mockSessionUnlock,
        lock: mockSessionLock,
        isUnlocked: vi.fn(() => true),
        getDek: vi.fn(() => null),
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
      }
    })
  })

  afterEach(() => {
    process.exitCode = savedExitCode
  })

  it('unlocks successfully with correct password', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify(MOCK_STORE_FILE))

    mockQuestion.mockImplementation((_prompt: string, cb: (answer: string) => void) => {
      cb('correct-password')
    })

    const mockDek = Buffer.alloc(32, 0xde)
    mockDeriveKek.mockResolvedValue(Buffer.alloc(32, 0xab))
    mockUnwrapDek.mockReturnValue(mockDek)
    mockLoadConfig.mockReturnValue(createTestConfig())

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { unlockCommand } = await import('../cli/unlock.js')
    await unlockCommand.parseAsync([], { from: 'user' })

    expect(mockDeriveKek).toHaveBeenCalled()
    expect(mockUnwrapDek).toHaveBeenCalled()
    expect(MockUnlockSession).toHaveBeenCalledWith({ ttlMs: 900_000 })
    expect(mockSessionUnlock).toHaveBeenCalledWith(mockDek)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Store unlocked'))
    expect(process.exitCode).toBeUndefined()

    logSpy.mockRestore()
  })

  it('prints error and sets exitCode=1 when password is wrong', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify(MOCK_STORE_FILE))

    mockQuestion.mockImplementation((_prompt: string, cb: (answer: string) => void) => {
      cb('wrong-password')
    })

    mockDeriveKek.mockResolvedValue(Buffer.alloc(32, 0xab))
    mockUnwrapDek.mockImplementation(() => {
      throw new Error('Unsupported state or unable to authenticate data')
    })

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

    errorSpy.mockRestore()
  })

  it('formats TTL in hours when ttlMs >= 3600000', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify(MOCK_STORE_FILE))

    mockQuestion.mockImplementation((_prompt: string, cb: (answer: string) => void) => {
      cb('correct-password')
    })

    const mockDek = Buffer.alloc(32, 0xde)
    mockDeriveKek.mockResolvedValue(Buffer.alloc(32, 0xab))
    mockUnwrapDek.mockReturnValue(mockDek)
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
    mockReadFileSync.mockReturnValue(JSON.stringify(MOCK_STORE_FILE))

    mockQuestion.mockImplementation((_prompt: string, cb: (answer: string) => void) => {
      cb('correct-password')
    })

    const mockDek = Buffer.alloc(32, 0xde)
    mockDeriveKek.mockResolvedValue(Buffer.alloc(32, 0xab))
    mockUnwrapDek.mockReturnValue(mockDek)
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

  it('sets exitCode=1 when store file is malformed (bad version)', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: 99, kdf: null, wrappedDek: null }))

    mockQuestion.mockImplementation((_prompt: string, cb: (answer: string) => void) => {
      cb('password')
    })

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { unlockCommand } = await import('../cli/unlock.js')
    await unlockCommand.parseAsync([], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith('Error: Malformed encrypted store file.')
    expect(process.exitCode).toBe(1)

    errorSpy.mockRestore()
  })

  it('sets exitCode=1 when store file cannot be read (parse error)', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('not valid json{{{')

    mockQuestion.mockImplementation((_prompt: string, cb: (answer: string) => void) => {
      cb('password')
    })

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { unlockCommand } = await import('../cli/unlock.js')
    await unlockCommand.parseAsync([], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith('Error: Failed to read encrypted store file.')
    expect(process.exitCode).toBe(1)

    errorSpy.mockRestore()
  })
})

describe('lock command', () => {
  let savedExitCode: number | undefined

  beforeEach(() => {
    savedExitCode = process.exitCode
    process.exitCode = undefined
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.exitCode = savedExitCode
  })

  it('prints "Store locked."', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { lockCommand } = await import('../cli/unlock.js')
    await lockCommand.parseAsync([], { from: 'user' })

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

  it('prints "Store is locked." when store file exists', async () => {
    mockExistsSync.mockReturnValue(true)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { statusCommand } = await import('../cli/unlock.js')
    await statusCommand.parseAsync([], { from: 'user' })

    expect(logSpy).toHaveBeenCalledWith('Store is locked.')

    logSpy.mockRestore()
  })
})
