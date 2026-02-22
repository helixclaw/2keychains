/// <reference types="vitest/globals" />

import type { AppConfig } from '../core/config.js'
import type { AccessRequest } from '../core/request.js'
import type { Service } from '../core/service.js'

const mockLoadConfig = vi.fn<() => AppConfig>()

const mockRequestsCreate = vi.fn<Service['requests']['create']>()
const mockGrantsValidate = vi.fn<Service['grants']['validate']>()
const mockInject = vi.fn<Service['inject']>()
const mockHealth = vi.fn<Service['health']>()
const mockSecretsList = vi.fn<Service['secrets']['list']>()
const mockSecretsAdd = vi.fn<Service['secrets']['add']>()
const mockSecretsRemove = vi.fn<Service['secrets']['remove']>()
const mockSecretsGetMetadata = vi.fn<Service['secrets']['getMetadata']>()

const mockService: Service = {
  health: mockHealth,
  secrets: {
    list: mockSecretsList,
    add: mockSecretsAdd,
    remove: mockSecretsRemove,
    getMetadata: mockSecretsGetMetadata,
  },
  requests: {
    create: mockRequestsCreate,
  },
  grants: {
    validate: mockGrantsValidate,
  },
  inject: mockInject,
}

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
    discord: {
      webhookUrl: 'https://discord.com/api/webhooks/123/abc',
      botToken: 'bot-token-123',
      channelId: '999888777',
    },
    requireApproval: {},
    defaultRequireApproval: false,
    approvalTimeoutMs: 300_000,
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

const baseArgs = [
  'test-secret-uuid',
  '--reason',
  'need for deploy',
  '--task',
  'TICKET-123',
  '--env',
  'MY_SECRET',
  '--cmd',
  'echo hello',
]

async function runRequest(args: string[] = baseArgs): Promise<void> {
  const { requestCommand } = await import('../cli/request.js')
  await requestCommand.parseAsync(args, { from: 'user' })
}

describe('request command orchestration', () => {
  let savedExitCode: number | undefined

  beforeEach(() => {
    savedExitCode = process.exitCode
    process.exitCode = undefined

    mockLoadConfig.mockReturnValue(createTestConfig())
    mockResolveService.mockReturnValue(mockService)
    mockRequestsCreate.mockResolvedValue(createTestAccessRequest())
    mockGrantsValidate.mockResolvedValue(true)
    mockInject.mockResolvedValue({ exitCode: 0, stdout: 'output', stderr: '' })
  })

  afterEach(() => {
    process.exitCode = savedExitCode
    vi.clearAllMocks()
  })

  it('happy path: approved request -> validate grant -> inject -> returns child exit code', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await runRequest()

    expect(mockLoadConfig).toHaveBeenCalled()
    expect(mockResolveService).toHaveBeenCalled()
    expect(mockRequestsCreate).toHaveBeenCalledWith(
      ['test-secret-uuid'],
      'need for deploy',
      'TICKET-123',
      300,
    )
    expect(mockGrantsValidate).toHaveBeenCalledWith('test-request-id')
    expect(mockInject).toHaveBeenCalledWith('test-request-id', 'MY_SECRET', 'echo hello')
    expect(stdoutSpy).toHaveBeenCalledWith('output')
    expect(process.exitCode).toBe(0)
    stdoutSpy.mockRestore()
  })

  it('denied request (grant not valid): exits with code 1', async () => {
    mockGrantsValidate.mockResolvedValue(false)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await runRequest()

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('denied'))
    expect(process.exitCode).toBe(1)
    expect(mockInject).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('service.requests.create throws: exits with code 1', async () => {
    mockRequestsCreate.mockRejectedValue(new Error('not implemented'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await runRequest()

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not implemented'))
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })

  it('child process failure: returns child exit code', async () => {
    mockInject.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'error output' })
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await runRequest()

    expect(stderrSpy).toHaveBeenCalledWith('error output')
    expect(process.exitCode).toBe(1)
    stderrSpy.mockRestore()
  })

  it('--duration flag is passed through to service.requests.create', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await runRequest([
      'test-secret-uuid',
      '--reason',
      'need for deploy',
      '--task',
      'TICKET-123',
      '--env',
      'MY_SECRET',
      '--cmd',
      'echo hello',
      '--duration',
      '600',
    ])

    expect(mockRequestsCreate).toHaveBeenCalledWith(
      ['test-secret-uuid'],
      'need for deploy',
      'TICKET-123',
      600,
    )
  })

  it('--duration defaults to 300 when not provided', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await runRequest()

    expect(mockRequestsCreate).toHaveBeenCalledWith(
      ['test-secret-uuid'],
      'need for deploy',
      'TICKET-123',
      300,
    )
  })

  it('invalid duration: prints error and exits with code 1', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await runRequest([
      'test-secret-uuid',
      '--reason',
      'need for deploy',
      '--task',
      'TICKET-123',
      '--env',
      'MY_SECRET',
      '--cmd',
      'echo hello',
      '--duration',
      'abc',
    ])

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid --duration'))
    expect(process.exitCode).toBe(1)
    expect(mockRequestsCreate).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('secret not found error: prints user-friendly message', async () => {
    mockRequestsCreate.mockRejectedValue(new Error('Secret not found'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await runRequest()

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Secret UUID not found'))
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })

  it('grant expired error: prints user-friendly message', async () => {
    mockInject.mockRejectedValue(new Error('Grant is not valid'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await runRequest()

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Grant expired'))
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })

  it('null exit code (signal-killed): maps to exit code 1', async () => {
    mockInject.mockResolvedValue({ exitCode: null, stdout: '', stderr: '' })
    await runRequest()

    expect(process.exitCode).toBe(1)
  })

  describe('batch', () => {
    it('passes multiple UUIDs to service.requests.create', async () => {
      vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
      await runRequest([
        'uuid-1',
        'uuid-2',
        'uuid-3',
        '--reason',
        'need for deploy',
        '--task',
        'TICKET-123',
        '--env',
        'MY_SECRET',
        '--cmd',
        'echo hello',
      ])

      expect(mockRequestsCreate).toHaveBeenCalledWith(
        ['uuid-1', 'uuid-2', 'uuid-3'],
        'need for deploy',
        'TICKET-123',
        300,
      )
    })

    it('works with single UUID (backwards compat)', async () => {
      vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
      await runRequest()

      expect(mockRequestsCreate).toHaveBeenCalledWith(
        ['test-secret-uuid'],
        'need for deploy',
        'TICKET-123',
        300,
      )
    })
  })
})
