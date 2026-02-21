/// <reference types="vitest/globals" />

import type { AppConfig } from '../core/config.js'
import type { AccessRequest } from '../core/request.js'
import type { AccessGrant } from '../core/grant.js'
import type { ProcessResult } from '../core/types.js'

const mockLoadConfig = vi.fn<() => AppConfig>()
const mockSendNotification = vi.fn<(message: string) => Promise<void>>()
const mockSendApprovalRequest = vi.fn<() => Promise<string>>()
const mockWaitForResponse = vi.fn<() => Promise<'approved' | 'denied' | 'timeout'>>()
const mockProcessRequest = vi.fn<() => Promise<'approved' | 'denied' | 'timeout'>>()
const mockCreateGrant = vi.fn<(req: AccessRequest) => AccessGrant>()
const mockValidateGrant = vi.fn<() => boolean>()
const mockGetGrant = vi.fn()
const mockMarkUsed = vi.fn()
const mockInject = vi.fn<() => Promise<ProcessResult>>()
const mockCreateAccessRequest = vi.fn(
  (secretUuid: string, reason: string, taskRef: string, durationSeconds: number) => ({
    id: 'test-request-id',
    secretUuid,
    reason,
    taskRef,
    durationSeconds,
    requestedAt: '2026-01-01T00:00:00.000Z',
    status: 'pending' as const,
  }),
)

vi.mock('../core/config.js', () => ({
  loadConfig: (...args: unknown[]) => mockLoadConfig(...(args as [])),
}))

vi.mock('../core/secret-store.js', () => ({
  SecretStore: vi.fn(),
}))

vi.mock('../channels/discord.js', () => ({
  DiscordChannel: vi.fn().mockImplementation(() => ({
    sendApprovalRequest: mockSendApprovalRequest,
    waitForResponse: mockWaitForResponse,
    sendNotification: (...args: unknown[]) => mockSendNotification(...(args as [string])),
  })),
}))

vi.mock('../core/workflow.js', () => ({
  WorkflowEngine: vi.fn().mockImplementation(() => ({
    processRequest: (...args: unknown[]) => mockProcessRequest(...(args as [])),
  })),
}))

vi.mock('../core/grant.js', () => ({
  GrantManager: vi.fn().mockImplementation(() => ({
    createGrant: (...args: unknown[]) => mockCreateGrant(...(args as [AccessRequest])),
    validateGrant: (...args: unknown[]) => mockValidateGrant(...(args as [])),
    getGrant: (...args: unknown[]) => mockGetGrant(...(args as [])),
    markUsed: (...args: unknown[]) => mockMarkUsed(...(args as [])),
  })),
}))

vi.mock('../core/injector.js', () => ({
  SecretInjector: vi.fn().mockImplementation(() => ({
    inject: (...args: unknown[]) => mockInject(...(args as [])),
  })),
}))

vi.mock('../core/request.js', () => ({
  createAccessRequest: (...args: unknown[]) =>
    mockCreateAccessRequest(...(args as [string, string, string, number])),
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

function createTestGrant(overrides?: Partial<AccessGrant>): AccessGrant {
  return {
    id: 'test-grant-id',
    requestId: 'test-request-id',
    secretUuid: 'test-secret-uuid',
    grantedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T00:05:00.000Z',
    used: false,
    revokedAt: null,
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
    mockProcessRequest.mockResolvedValue('approved')
    mockCreateGrant.mockReturnValue(createTestGrant())
    mockInject.mockResolvedValue({ exitCode: 0, stdout: 'output', stderr: '' })
    mockSendNotification.mockResolvedValue(undefined)
  })

  afterEach(() => {
    process.exitCode = savedExitCode
    vi.clearAllMocks()
  })

  it('happy path: approved request -> grant -> inject -> returns child exit code', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await runRequest()

    expect(mockLoadConfig).toHaveBeenCalled()
    expect(mockProcessRequest).toHaveBeenCalled()
    expect(mockCreateGrant).toHaveBeenCalled()
    expect(mockInject).toHaveBeenCalledWith('test-grant-id', 'MY_SECRET', [
      'sh',
      '-c',
      'echo hello',
    ])
    expect(stdoutSpy).toHaveBeenCalledWith('output')
    expect(process.exitCode).toBe(0)
    stdoutSpy.mockRestore()
  })

  it('sends 4 audit log notifications in correct order', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await runRequest()

    expect(mockSendNotification).toHaveBeenCalledTimes(4)
    const calls = mockSendNotification.mock.calls.map((c) => c[0] as string)
    expect(calls[0]).toContain('Request created')
    expect(calls[1]).toContain('Approval approved')
    expect(calls[2]).toContain('Secret injected')
    expect(calls[3]).toContain('Grant used')
  })

  it('audit log messages include request ID and timestamp', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await runRequest()

    const calls = mockSendNotification.mock.calls.map((c) => c[0] as string)
    for (const msg of calls) {
      expect(msg).toContain('[test-request-id]')
      // ISO timestamp pattern: YYYY-MM-DDTHH:mm:ss
      expect(msg).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    }
  })

  it('audit log for injection does NOT include secret value', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await runRequest()

    const injectionMsg = mockSendNotification.mock.calls[2][0] as string
    expect(injectionMsg).toContain('Secret injected')
    expect(injectionMsg).toContain('env=MY_SECRET')
    expect(injectionMsg).toContain('command=')
    // Should not contain any secret value -- only metadata
    expect(injectionMsg).not.toContain('bot-token')
  })

  it('denied request: logs denial, exits with code 1, does NOT create grant', async () => {
    mockProcessRequest.mockResolvedValue('denied')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await runRequest()

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('denied'))
    expect(process.exitCode).toBe(1)
    expect(mockCreateGrant).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('timeout request: logs timeout, exits with code 1', async () => {
    mockProcessRequest.mockResolvedValue('timeout')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await runRequest()

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('timeout'))
    expect(process.exitCode).toBe(1)
    expect(mockCreateGrant).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('discord not configured: prints actionable error pointing to "2kc config init"', async () => {
    mockLoadConfig.mockReturnValue({
      ...createTestConfig(),
      discord: undefined,
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await runRequest()

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Discord not configured'))
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('config init'))
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })

  it('audit log failure (sendNotification throws): prints warning to stderr, continues main flow', async () => {
    mockSendNotification.mockRejectedValue(new Error('Discord down'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await runRequest()

    // Should still complete the flow successfully
    expect(mockInject).toHaveBeenCalled()
    expect(stdoutSpy).toHaveBeenCalledWith('output')
    expect(process.exitCode).toBe(0)

    // Should have printed warnings for each failed audit
    const errorCalls = errorSpy.mock.calls.map((c) => c[0] as string)
    const auditWarnings = errorCalls.filter((msg) => msg.includes('[audit] Warning'))
    expect(auditWarnings.length).toBeGreaterThan(0)
    stdoutSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('child process failure: still logs grant-used audit event', async () => {
    mockInject.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'error output' })
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await runRequest()

    // All 4 audit logs should still be sent
    expect(mockSendNotification).toHaveBeenCalledTimes(4)
    const lastAuditMsg = mockSendNotification.mock.calls[3][0] as string
    expect(lastAuditMsg).toContain('Grant used')

    expect(stderrSpy).toHaveBeenCalledWith('error output')
    expect(process.exitCode).toBe(1)
    stderrSpy.mockRestore()
  })

  it('--duration flag is passed through to createAccessRequest', async () => {
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

    expect(mockCreateAccessRequest).toHaveBeenCalledWith(
      'test-secret-uuid',
      'need for deploy',
      'TICKET-123',
      600,
    )
  })

  it('--duration defaults to 300 when not provided', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await runRequest()

    expect(mockCreateAccessRequest).toHaveBeenCalledWith(
      'test-secret-uuid',
      'need for deploy',
      'TICKET-123',
      300,
    )
  })
})
