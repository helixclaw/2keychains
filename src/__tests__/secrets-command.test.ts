/// <reference types="vitest/globals" />

import type { AppConfig } from '../core/config.js'
import type { Service } from '../core/service.js'

// Mock readline before imports
const mockQuestion = vi.fn()
const mockClose = vi.fn()
vi.mock('node:readline', () => ({
  createInterface: vi.fn(() => ({
    question: mockQuestion,
    close: mockClose,
  })),
}))

const mockLoadConfig = vi.fn<() => AppConfig>()

const mockSecretsList = vi.fn<Service['secrets']['list']>()
const mockSecretsAdd = vi.fn<Service['secrets']['add']>()
const mockSecretsRemove = vi.fn<Service['secrets']['remove']>()
const mockSecretsResolve = vi.fn<Service['secrets']['resolve']>()

const mockService = {
  secrets: {
    list: mockSecretsList,
    add: mockSecretsAdd,
    remove: mockSecretsRemove,
    resolve: mockSecretsResolve,
  },
} as unknown as Service

const mockResolveService = vi.fn<() => Service>()

vi.mock('../core/config.js', () => ({
  loadConfig: (...args: unknown[]) => mockLoadConfig(...(args as [])),
}))

vi.mock('../core/service.js', () => ({
  resolveService: (...args: unknown[]) => mockResolveService(...(args as [])),
}))

function createTestConfig(): AppConfig {
  return {
    mode: 'standalone',
    server: { host: '127.0.0.1', port: 2274 },
    store: { path: '~/.2kc/secrets.json' },
    requireApproval: {},
    defaultRequireApproval: false,
    approvalTimeoutMs: 300_000,
  }
}

describe('secrets add command', () => {
  let savedExitCode: number | undefined
  let originalStdin: typeof process.stdin

  beforeEach(() => {
    savedExitCode = process.exitCode
    process.exitCode = undefined
    mockLoadConfig.mockReturnValue(createTestConfig())
    mockResolveService.mockReturnValue(mockService)
    originalStdin = process.stdin
  })

  afterEach(() => {
    process.exitCode = savedExitCode
    Object.defineProperty(process, 'stdin', { value: originalStdin, writable: true })
    vi.clearAllMocks()
  })

  it('adds secret with --value option', async () => {
    mockSecretsAdd.mockResolvedValue({ uuid: 'new-secret-uuid', ref: 'my-ref', tags: [] })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { secretsCommand } = await import('../cli/secrets.js')
    await secretsCommand.parseAsync(['add', '--ref', 'my-ref', '--value', 'my-secret-value'], {
      from: 'user',
    })

    expect(mockSecretsAdd).toHaveBeenCalledWith('my-ref', 'my-secret-value', undefined)
    expect(logSpy).toHaveBeenCalledWith('new-secret-uuid')
    logSpy.mockRestore()
  })

  it('adds secret with tags', async () => {
    mockSecretsAdd.mockResolvedValue({ uuid: 'uuid-with-tags', ref: 'tagged-ref', tags: ['prod'] })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { secretsCommand } = await import('../cli/secrets.js')
    await secretsCommand.parseAsync(
      ['add', '--ref', 'tagged-ref', '--value', 'secret', '--tags', 'prod', 'staging'],
      { from: 'user' },
    )

    expect(mockSecretsAdd).toHaveBeenCalledWith('tagged-ref', 'secret', ['prod', 'staging'])
    expect(logSpy).toHaveBeenCalledWith('uuid-with-tags')
    logSpy.mockRestore()
  })

  it('exits with error if value is empty', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { secretsCommand } = await import('../cli/secrets.js')
    await secretsCommand.parseAsync(['add', '--ref', 'my-ref', '--value', ''], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith('Error: secret value must not be empty')
    expect(process.exitCode).toBe(1)
    expect(mockSecretsAdd).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('reads value from stdin when not a TTY', async () => {
    mockSecretsAdd.mockResolvedValue({ uuid: 'stdin-uuid', ref: 'stdin-ref', tags: [] })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    // Create a mock stdin that emits data and then ends
    const mockStdin = {
      isTTY: false,
      setEncoding: vi.fn(),
      on: vi.fn((event: string, callback: (data?: string) => void) => {
        if (event === 'data') {
          setTimeout(() => callback('stdin-secret-value'), 0)
        } else if (event === 'end') {
          setTimeout(() => callback(), 10)
        }
        return mockStdin
      }),
    }
    Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true })

    const { secretsCommand } = await import('../cli/secrets.js')
    await secretsCommand.parseAsync(['add', '--ref', 'stdin-ref'], { from: 'user' })

    expect(mockSecretsAdd).toHaveBeenCalledWith('stdin-ref', 'stdin-secret-value', undefined)
    expect(logSpy).toHaveBeenCalledWith('stdin-uuid')
    logSpy.mockRestore()
  })

  it('exits with error when stdin is empty', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Create a mock stdin that emits empty data
    const mockStdin = {
      isTTY: false,
      setEncoding: vi.fn(),
      on: vi.fn((event: string, callback: (data?: string) => void) => {
        if (event === 'data') {
          setTimeout(() => callback('   '), 0)
        } else if (event === 'end') {
          setTimeout(() => callback(), 10)
        }
        return mockStdin
      }),
    }
    Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true })

    const { secretsCommand } = await import('../cli/secrets.js')
    await secretsCommand.parseAsync(['add', '--ref', 'empty-ref'], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith('Error: secret value must not be empty')
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })

  it('prompts for value when stdin is a TTY', async () => {
    mockSecretsAdd.mockResolvedValue({ uuid: 'prompt-uuid', ref: 'prompt-ref', tags: [] })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    // Mock stdin as TTY
    const mockStdin = {
      isTTY: true,
    }
    Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true })

    // Mock readline to call callback with value
    mockQuestion.mockImplementation((prompt: string, callback: (answer: string) => void) => {
      callback('prompted-secret-value')
    })

    const { secretsCommand } = await import('../cli/secrets.js')
    await secretsCommand.parseAsync(['add', '--ref', 'prompt-ref'], { from: 'user' })

    expect(mockQuestion).toHaveBeenCalled()
    expect(mockClose).toHaveBeenCalled()
    expect(mockSecretsAdd).toHaveBeenCalledWith('prompt-ref', 'prompted-secret-value', undefined)
    expect(logSpy).toHaveBeenCalledWith('prompt-uuid')
    logSpy.mockRestore()
  })
})

describe('secrets list command', () => {
  let savedExitCode: number | undefined

  beforeEach(() => {
    savedExitCode = process.exitCode
    process.exitCode = undefined
    mockLoadConfig.mockReturnValue(createTestConfig())
    mockResolveService.mockReturnValue(mockService)
  })

  afterEach(() => {
    process.exitCode = savedExitCode
    vi.clearAllMocks()
  })

  it('outputs JSON list of secrets', async () => {
    const secretsList = [
      { uuid: 'uuid-1', ref: 'ref-1', tags: [] },
      { uuid: 'uuid-2', ref: 'ref-2', tags: ['prod'] },
    ]
    mockSecretsList.mockResolvedValue(secretsList)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { secretsCommand } = await import('../cli/secrets.js')
    await secretsCommand.parseAsync(['list'], { from: 'user' })

    expect(mockSecretsList).toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(secretsList, null, 2))
    logSpy.mockRestore()
  })

  it('sets exitCode=1 on error', async () => {
    mockSecretsList.mockRejectedValue(new Error('Store corrupted'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { secretsCommand } = await import('../cli/secrets.js')
    await secretsCommand.parseAsync(['list'], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith('Error: Store corrupted')
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })
})

describe('secrets remove command', () => {
  let savedExitCode: number | undefined

  beforeEach(() => {
    savedExitCode = process.exitCode
    process.exitCode = undefined
    mockLoadConfig.mockReturnValue(createTestConfig())
    mockResolveService.mockReturnValue(mockService)
  })

  afterEach(() => {
    process.exitCode = savedExitCode
    vi.clearAllMocks()
  })

  it('resolves ref and removes secret', async () => {
    mockSecretsResolve.mockResolvedValue({ uuid: 'resolved-uuid', ref: 'my-ref', tags: [] })
    mockSecretsRemove.mockResolvedValue(undefined)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { secretsCommand } = await import('../cli/secrets.js')
    await secretsCommand.parseAsync(['remove', 'my-ref'], { from: 'user' })

    expect(mockSecretsResolve).toHaveBeenCalledWith('my-ref')
    expect(mockSecretsRemove).toHaveBeenCalledWith('resolved-uuid')
    expect(logSpy).toHaveBeenCalledWith('Removed')
    logSpy.mockRestore()
  })

  it('sets exitCode=1 when secret not found', async () => {
    mockSecretsResolve.mockRejectedValue(new Error('Secret not found'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { secretsCommand } = await import('../cli/secrets.js')
    await secretsCommand.parseAsync(['remove', 'nonexistent'], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith('Error: Secret not found')
    expect(process.exitCode).toBe(1)
    expect(mockSecretsRemove).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
