/// <reference types="vitest/globals" />

import type { AppConfig } from '../core/config.js'
import type { ChildProcess } from 'node:child_process'

const mockLoadConfig = vi.fn<() => AppConfig>()
const mockGetRunningPid = vi.fn<() => number | null>()
const mockWritePid = vi.fn<(pid: number) => void>()
const mockRemovePidFile = vi.fn<() => void>()
const mockFork = vi.fn()

vi.mock('../core/config.js', () => ({
  loadConfig: (...args: unknown[]) => mockLoadConfig(...(args as [])),
  CONFIG_DIR: '/tmp/.2kc',
}))

vi.mock('../core/pid-manager.js', () => ({
  getRunningPid: () => mockGetRunningPid(),
  writePid: (pid: number) => mockWritePid(pid),
  removePidFile: () => mockRemovePidFile(),
  LOG_FILE_PATH: '/tmp/test-server.log',
}))

vi.mock('node:child_process', () => ({
  fork: (...args: unknown[]) => mockFork(...args),
}))

vi.mock('node:fs', () => ({
  openSync: vi.fn(() => 3),
  closeSync: vi.fn(),
  mkdirSync: vi.fn(),
}))

// Mock http for health check
let mockHealthResponse: { statusCode: number; data: string } | Error = {
  statusCode: 200,
  data: '{"status":"ok","pid":12345,"uptime":100}',
}

vi.mock('node:http', () => ({
  default: {
    get: vi.fn((url: string, opts: unknown, callback: (res: unknown) => void) => {
      const mockReq = {
        on: vi.fn((event: string, handler: (arg?: unknown) => void) => {
          if (event === 'error' && mockHealthResponse instanceof Error) {
            setTimeout(() => handler(mockHealthResponse), 0)
          }
          return mockReq
        }),
      }

      if (!(mockHealthResponse instanceof Error)) {
        setTimeout(() => {
          const res = {
            on: vi.fn((event: string, handler: (chunk?: unknown) => void) => {
              if (event === 'data') {
                handler(mockHealthResponse instanceof Error ? '' : mockHealthResponse.data)
              } else if (event === 'end') {
                handler()
              }
              return res
            }),
          }
          callback(res)
        }, 0)
      }

      return mockReq
    }),
  },
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

function createMockChildProcess(pid: number): ChildProcess {
  return {
    pid,
    disconnect: vi.fn(),
    unref: vi.fn(),
  } as unknown as ChildProcess
}

describe('server start command', () => {
  let savedExitCode: number | undefined
  let originalKill: typeof process.kill

  beforeEach(() => {
    savedExitCode = process.exitCode
    process.exitCode = undefined
    originalKill = process.kill
    mockLoadConfig.mockReturnValue(createTestConfig())
    mockHealthResponse = { statusCode: 200, data: '{"status":"ok","pid":12345,"uptime":100}' }
  })

  afterEach(() => {
    process.exitCode = savedExitCode
    process.kill = originalKill
    vi.clearAllMocks()
  })

  it('exits with error if server is already running', async () => {
    mockGetRunningPid.mockReturnValue(12345)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { serverCommand } = await import('../cli/server.js')
    await serverCommand.parseAsync(['start'], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('already running'))
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('12345'))
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })

  it('starts server process and writes PID on success', async () => {
    mockGetRunningPid.mockReturnValue(null)
    mockFork.mockReturnValue(createMockChildProcess(54321))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { serverCommand } = await import('../cli/server.js')
    await serverCommand.parseAsync(['start'], { from: 'user' })

    expect(mockFork).toHaveBeenCalled()
    expect(mockWritePid).toHaveBeenCalledWith(54321)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Server started'))
    logSpy.mockRestore()
  })

  it('exits with error when fork fails (no PID)', async () => {
    mockGetRunningPid.mockReturnValue(null)
    mockFork.mockReturnValue({ pid: undefined, disconnect: vi.fn(), unref: vi.fn() })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { serverCommand } = await import('../cli/server.js')
    await serverCommand.parseAsync(['start'], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith('Failed to start server process')
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })

  it('cleans up when health check fails after fork', async () => {
    mockGetRunningPid.mockReturnValue(null)
    mockFork.mockReturnValue(createMockChildProcess(54321))
    mockHealthResponse = new Error('Connection refused')

    const mockKill = vi.fn()
    process.kill = mockKill as unknown as typeof process.kill

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { serverCommand } = await import('../cli/server.js')
    await serverCommand.parseAsync(['start'], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('health check failed'))
    expect(mockRemovePidFile).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })

  it('handles invalid JSON in health response', async () => {
    mockGetRunningPid.mockReturnValue(null)
    mockFork.mockReturnValue(createMockChildProcess(54321))
    // Invalid JSON will cause JSON.parse to throw
    mockHealthResponse = { statusCode: 200, data: 'not-valid-json' }

    const mockKill = vi.fn()
    process.kill = mockKill as unknown as typeof process.kill

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { serverCommand } = await import('../cli/server.js')
    await serverCommand.parseAsync(['start'], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('health check failed'))
    expect(mockRemovePidFile).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })

  it('handles process.kill throwing during cleanup', async () => {
    mockGetRunningPid.mockReturnValue(null)
    mockFork.mockReturnValue(createMockChildProcess(54321))
    mockHealthResponse = new Error('Connection refused')

    // Mock kill to throw an error (process already exited)
    const mockKill = vi.fn().mockImplementation(() => {
      throw new Error('ESRCH')
    })
    process.kill = mockKill as unknown as typeof process.kill

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { serverCommand } = await import('../cli/server.js')
    await serverCommand.parseAsync(['start'], { from: 'user' })

    // Should still clean up even when kill throws
    expect(mockKill).toHaveBeenCalledWith(54321, 'SIGTERM')
    expect(mockRemovePidFile).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })
})

describe('server stop command', () => {
  let savedExitCode: number | undefined
  let originalKill: typeof process.kill
  let killCallCount: number

  beforeEach(() => {
    savedExitCode = process.exitCode
    process.exitCode = undefined
    originalKill = process.kill
    killCallCount = 0
    mockLoadConfig.mockReturnValue(createTestConfig())
  })

  afterEach(() => {
    process.exitCode = savedExitCode
    process.kill = originalKill
    vi.clearAllMocks()
  })

  it('shows message if server is not running', async () => {
    mockGetRunningPid.mockReturnValue(null)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { serverCommand } = await import('../cli/server.js')
    await serverCommand.parseAsync(['stop'], { from: 'user' })

    expect(logSpy).toHaveBeenCalledWith('Server is not running')
    expect(process.exitCode).toBeUndefined()
    logSpy.mockRestore()
  })

  it('handles stale PID (ESRCH) and cleans up', async () => {
    mockGetRunningPid.mockReturnValue(99999)
    const esrchError = new Error('ESRCH') as NodeJS.ErrnoException
    esrchError.code = 'ESRCH'

    process.kill = vi.fn().mockImplementation(() => {
      throw esrchError
    }) as unknown as typeof process.kill

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { serverCommand } = await import('../cli/server.js')
    await serverCommand.parseAsync(['stop'], { from: 'user' })

    expect(mockRemovePidFile).toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('already stopped'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('stale PID'))
    logSpy.mockRestore()
  })

  it('kills process and waits for exit', async () => {
    mockGetRunningPid.mockReturnValue(12345)

    // First call: SIGTERM succeeds, subsequent calls: process is dead
    process.kill = vi.fn().mockImplementation(() => {
      killCallCount++
      if (killCallCount === 1) {
        return true // SIGTERM succeeds
      }
      // After SIGTERM, process exits, so check throws ESRCH
      const esrchError = new Error('ESRCH') as NodeJS.ErrnoException
      esrchError.code = 'ESRCH'
      throw esrchError
    }) as unknown as typeof process.kill

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { serverCommand } = await import('../cli/server.js')
    await serverCommand.parseAsync(['stop'], { from: 'user' })

    expect(mockRemovePidFile).toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Server stopped'))
    logSpy.mockRestore()
  })

  it('exits with error if process does not stop within timeout', async () => {
    mockGetRunningPid.mockReturnValue(12345)

    // Process never dies
    process.kill = vi.fn().mockReturnValue(true) as unknown as typeof process.kill

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { serverCommand } = await import('../cli/server.js')
    await serverCommand.parseAsync(['stop'], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('did not stop'))
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  }, 10000)

  it('re-throws non-ESRCH errors from kill', async () => {
    mockGetRunningPid.mockReturnValue(12345)
    const permError = new Error('EPERM') as NodeJS.ErrnoException
    permError.code = 'EPERM'

    process.kill = vi.fn().mockImplementation(() => {
      throw permError
    }) as unknown as typeof process.kill

    const { serverCommand } = await import('../cli/server.js')
    await expect(serverCommand.parseAsync(['stop'], { from: 'user' })).rejects.toThrow('EPERM')
  })
})

describe('server status command', () => {
  let savedExitCode: number | undefined

  beforeEach(() => {
    savedExitCode = process.exitCode
    process.exitCode = undefined
    mockLoadConfig.mockReturnValue(createTestConfig())
    mockHealthResponse = { statusCode: 200, data: '{"status":"ok","pid":12345,"uptime":100}' }
  })

  afterEach(() => {
    process.exitCode = savedExitCode
    vi.clearAllMocks()
  })

  it('shows message if server is not running', async () => {
    mockGetRunningPid.mockReturnValue(null)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { serverCommand } = await import('../cli/server.js')
    await serverCommand.parseAsync(['status'], { from: 'user' })

    expect(logSpy).toHaveBeenCalledWith('Server is not running')
    logSpy.mockRestore()
  })

  it('shows running status with uptime when healthy', async () => {
    mockGetRunningPid.mockReturnValue(12345)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { serverCommand } = await import('../cli/server.js')
    await serverCommand.parseAsync(['status'], { from: 'user' })

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Server running'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('uptime'))
    logSpy.mockRestore()
  })

  it('shows running but not responding when health check fails', async () => {
    mockGetRunningPid.mockReturnValue(12345)
    mockHealthResponse = new Error('Connection refused')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { serverCommand } = await import('../cli/server.js')
    await serverCommand.parseAsync(['status'], { from: 'user' })

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('not responding'))
    logSpy.mockRestore()
  })
})

describe('server token generate command', () => {
  it('generates a 64-character hex token', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { serverCommand } = await import('../cli/server.js')
    await serverCommand.parseAsync(['token', 'generate'], { from: 'user' })

    expect(logSpy).toHaveBeenCalledTimes(1)
    const token = logSpy.mock.calls[0][0] as string
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    logSpy.mockRestore()
  })
})
