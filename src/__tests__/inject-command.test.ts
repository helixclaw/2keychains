/// <reference types="vitest/globals" />

import type { AppConfig } from '../core/config.js'
import type { AccessRequest } from '../core/request.js'
import type { Service } from '../core/service.js'

const mockLoadConfig = vi.fn<() => AppConfig>()

const mockRequestsCreate = vi.fn<Service['requests']['create']>()
const mockGrantsGetStatus = vi.fn<Service['grants']['getStatus']>()
const mockInject = vi.fn<Service['inject']>()
const mockHealth = vi.fn<Service['health']>()
const mockSecretsList = vi.fn<Service['secrets']['list']>()
const mockSecretsAdd = vi.fn<Service['secrets']['add']>()
const mockSecretsRemove = vi.fn<Service['secrets']['remove']>()
const mockSecretsGetMetadata = vi.fn<Service['secrets']['getMetadata']>()
const mockSecretsResolve = vi.fn<Service['secrets']['resolve']>()

const mockService: Service = {
  health: mockHealth,
  secrets: {
    list: mockSecretsList,
    add: mockSecretsAdd,
    remove: mockSecretsRemove,
    getMetadata: mockSecretsGetMetadata,
    resolve: mockSecretsResolve,
  },
  requests: {
    create: mockRequestsCreate,
  },
  grants: {
    getStatus: mockGrantsGetStatus,
  },
  inject: mockInject,
}

const mockResolveService = vi.fn<() => Service>()

vi.mock('../core/config.js', () => ({
  loadConfig: (...args: unknown[]) => mockLoadConfig(...(args as [])),
  CONFIG_DIR: '/tmp/.2kc',
}))

vi.mock('../core/service.js', () => ({
  resolveService: (...args: unknown[]) => mockResolveService(...(args as [])),
}))

function createTestConfig(): AppConfig {
  return {
    mode: 'standalone',
    server: { host: '127.0.0.1', port: 2274 },
    store: { path: '~/.2kc/secrets.json' },
    discord: {
      botToken: 'bot-token-123',
      channelId: '999888777',
    },
    requireApproval: {},
    defaultRequireApproval: false,
    approvalTimeoutMs: 300_000,
    unlock: { ttlMs: 900_000 },
  }
}

function createTestAccessRequest(overrides?: Partial<AccessRequest>): AccessRequest {
  return {
    id: 'test-request-id',
    secretUuids: ['test-secret-uuid'],
    reason: 'need for deploy',
    taskRef: 'TICKET-123',
    durationSeconds: 300,
    requestedAt: '2026-01-01T00:00:00.000Z',
    status: 'pending',
    ...overrides,
  }
}

const baseArgs = ['--reason', 'need for deploy', '--task', 'TICKET-123', '--cmd', 'echo hello']

async function runInject(args: string[] = baseArgs): Promise<void> {
  const { injectCommand } = await import('../cli/inject.js')
  await injectCommand.parseAsync(args, { from: 'user' })
}

describe('inject command', () => {
  let savedExitCode: number | undefined
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    savedExitCode = process.exitCode
    process.exitCode = undefined
    originalEnv = { ...process.env }

    mockLoadConfig.mockReturnValue(createTestConfig())
    mockResolveService.mockReturnValue(mockService)
    mockSecretsResolve.mockImplementation(async (refOrUuid: string) => ({
      uuid: `${refOrUuid}-uuid`,
      ref: refOrUuid,
      tags: [],
    }))
    mockRequestsCreate.mockResolvedValue(createTestAccessRequest())
    mockGrantsGetStatus.mockResolvedValue({ status: 'approved' })
    mockInject.mockResolvedValue({ exitCode: 0, stdout: 'output', stderr: '' })
  })

  afterEach(() => {
    process.exitCode = savedExitCode
    process.env = originalEnv
    vi.clearAllMocks()
  })

  it('scans env vars for 2k:// placeholders and injects secrets', async () => {
    process.env.DB_PASS = '2k://db-password'
    process.env.API_KEY = '2k://api-key'
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runInject()

    expect(mockSecretsResolve).toHaveBeenCalledWith('db-password')
    expect(mockSecretsResolve).toHaveBeenCalledWith('api-key')
    expect(mockRequestsCreate).toHaveBeenCalledWith(
      expect.arrayContaining(['db-password-uuid', 'api-key-uuid']),
      'need for deploy',
      'TICKET-123',
      300,
      'echo hello',
    )
    expect(process.exitCode).toBe(0)
    stdoutSpy.mockRestore()
  })

  it('only checks specified vars when --vars is provided', async () => {
    process.env.DB_PASS = '2k://db-password'
    process.env.API_KEY = '2k://api-key'
    process.env.OTHER = '2k://other-secret'
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runInject(['--vars', 'DB_PASS', '--reason', 'test', '--task', 'T-1', '--cmd', 'echo'])

    expect(mockSecretsResolve).toHaveBeenCalledWith('db-password')
    expect(mockSecretsResolve).not.toHaveBeenCalledWith('api-key')
    expect(mockSecretsResolve).not.toHaveBeenCalledWith('other-secret')
    expect(mockRequestsCreate).toHaveBeenCalledWith(
      ['db-password-uuid'],
      'test',
      'T-1',
      300,
      'echo',
    )
    stdoutSpy.mockRestore()
  })

  it('handles comma-separated --vars list', async () => {
    process.env.VAR1 = '2k://secret-1'
    process.env.VAR2 = '2k://secret-2'
    process.env.VAR3 = '2k://secret-3'
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runInject(['--vars', 'VAR1,VAR2', '--reason', 'test', '--task', 'T-1', '--cmd', 'echo'])

    expect(mockSecretsResolve).toHaveBeenCalledWith('secret-1')
    expect(mockSecretsResolve).toHaveBeenCalledWith('secret-2')
    expect(mockSecretsResolve).not.toHaveBeenCalledWith('secret-3')
    stdoutSpy.mockRestore()
  })

  it('exits with error when no 2k:// placeholders found', async () => {
    process.env.REGULAR_VAR = 'regular-value'
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await runInject()

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('No 2k:// placeholders found'))
    expect(process.exitCode).toBe(1)
    expect(mockRequestsCreate).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('exits with error when specified --vars have no placeholders', async () => {
    process.env.MY_VAR = 'regular-value'
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await runInject(['--vars', 'MY_VAR', '--reason', 'test', '--task', 'T-1', '--cmd', 'echo'])

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('No 2k:// placeholders found'))
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('MY_VAR'))
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })

  it('exits with error when secret resolution fails', async () => {
    process.env.DB_PASS = '2k://unknown-secret'
    mockSecretsResolve.mockRejectedValue(new Error('Secret not found'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await runInject()

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to resolve secret ref 'unknown-secret'"),
    )
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })

  it('exits with error when request is denied', async () => {
    process.env.SECRET = '2k://my-secret'
    mockGrantsGetStatus.mockResolvedValue({ status: 'denied' })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await runInject()

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('denied'))
    expect(process.exitCode).toBe(1)
    expect(mockInject).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('times out while polling if deadline passes', async () => {
    process.env.SECRET = '2k://my-secret'
    const baseTime = 1_000_000
    const nowSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(baseTime)
      .mockReturnValue(baseTime + 5 * 60 * 1000 + 1)

    mockGrantsGetStatus.mockResolvedValue({ status: 'pending' })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await runInject()

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Timed out'))
    expect(process.exitCode).toBe(1)

    nowSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('passes --duration to service.requests.create', async () => {
    process.env.SECRET = '2k://my-secret'
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runInject(['--reason', 'test', '--task', 'T-1', '--cmd', 'echo', '--duration', '600'])

    expect(mockRequestsCreate).toHaveBeenCalledWith(['my-secret-uuid'], 'test', 'T-1', 600, 'echo')
    stdoutSpy.mockRestore()
  })

  it('invalid duration: prints error and exits with code 1', async () => {
    process.env.SECRET = '2k://my-secret'
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await runInject(['--reason', 'test', '--task', 'T-1', '--cmd', 'echo', '--duration', 'abc'])

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid --duration'))
    expect(process.exitCode).toBe(1)
    expect(mockRequestsCreate).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('outputs stdout and stderr from child process', async () => {
    process.env.SECRET = '2k://my-secret'
    mockInject.mockResolvedValue({ exitCode: 0, stdout: 'stdout output', stderr: 'stderr output' })
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await runInject()

    expect(stdoutSpy).toHaveBeenCalledWith('stdout output')
    expect(stderrSpy).toHaveBeenCalledWith('stderr output')
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
  })

  it('returns child process exit code', async () => {
    process.env.SECRET = '2k://my-secret'
    mockInject.mockResolvedValue({ exitCode: 42, stdout: '', stderr: '' })

    await runInject()

    expect(process.exitCode).toBe(42)
  })

  it('maps null exit code to 1', async () => {
    process.env.SECRET = '2k://my-secret'
    mockInject.mockResolvedValue({ exitCode: null, stdout: '', stderr: '' })

    await runInject()

    expect(process.exitCode).toBe(1)
  })

  it('handles grant expired error', async () => {
    process.env.SECRET = '2k://my-secret'
    mockInject.mockRejectedValue(new Error('Grant is not valid'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await runInject()

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Grant expired'))
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })

  it('handles generic errors', async () => {
    process.env.SECRET = '2k://my-secret'
    mockInject.mockRejectedValue(new Error('Something went wrong'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await runInject()

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Something went wrong'))
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })
})
