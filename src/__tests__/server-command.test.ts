/// <reference types="vitest/globals" />

import type { AppConfig } from '../core/config.js'
import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'

const mockLoadConfig = vi.fn<() => AppConfig>()
const mockGetRunningPid = vi.fn<() => number | null>()
const mockWritePid = vi.fn<(pid: number) => void>()
const mockRemovePidFile = vi.fn<() => void>()
const mockFork = vi.fn()
const mockExistsSync = vi.fn<(path: string) => boolean>().mockReturnValue(true)
const mockPromptPassword = vi.fn<() => Promise<string>>()
const mockResolveService = vi.fn()
const mockStartServer = vi.fn()

vi.mock('../core/config.js', () => ({
  loadConfig: (...args: unknown[]) => mockLoadConfig(...(args as [])),
  getConfig: (...args: unknown[]) => mockLoadConfig(...(args as [])),
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
  existsSync: (path: string) => mockExistsSync(path),
}))

vi.mock('../cli/password-prompt.js', () => ({
  promptPassword: (...args: unknown[]) => mockPromptPassword(...(args as [])),
}))

vi.mock('../core/service.js', () => ({
  resolveService: (...args: unknown[]) => mockResolveService(...args),
  LocalService: class {},
}))

vi.mock('../server/app.js', () => ({
  startServer: (...args: unknown[]) => mockStartServer(...args),
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

function createMockChildProcess(pid: number): ChildProcess & EventEmitter {
  const emitter = new EventEmitter() as ChildProcess & EventEmitter
  emitter.pid = pid
  emitter.disconnect = vi.fn()
  emitter.unref = vi.fn()
  emitter.send = vi.fn().mockReturnValue(true)
  return emitter
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

describe('server start --unlock', () => {
  let savedExitCode: number | undefined
  let originalKill: typeof process.kill
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    savedExitCode = process.exitCode
    process.exitCode = undefined
    originalKill = process.kill
    originalEnv = { ...process.env }
    mockLoadConfig.mockReturnValue(createTestConfig())
    mockHealthResponse = { statusCode: 200, data: '{"status":"ok","pid":12345,"uptime":100}' }
    mockExistsSync.mockReturnValue(true)
    mockPromptPassword.mockResolvedValue('test-password')
  })

  afterEach(() => {
    process.exitCode = savedExitCode
    process.kill = originalKill
    process.env = originalEnv
    vi.clearAllMocks()
  })

  it('rejects --unlock in client mode', async () => {
    mockGetRunningPid.mockReturnValue(null)
    mockLoadConfig.mockReturnValue({
      ...createTestConfig(),
      mode: 'client',
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { serverCommand } = await import('../cli/server.js')
    await serverCommand.parseAsync(['start', '--unlock'], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith('Error: --unlock is not supported in client mode.')
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })

  it('rejects --unlock when store does not exist', async () => {
    mockGetRunningPid.mockReturnValue(null)
    mockExistsSync.mockReturnValue(false)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { serverCommand } = await import('../cli/server.js')
    await serverCommand.parseAsync(['start', '--unlock'], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith(
      'Error: Encrypted store not found. Run store initialization first.',
    )
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })

  it('uses password from env var when available', async () => {
    mockGetRunningPid.mockReturnValue(null)
    process.env['2KC_UNLOCK_PASSWORD'] = 'env-password'

    const child = createMockChildProcess(54321)
    mockFork.mockReturnValue(child)

    const { serverCommand } = await import('../cli/server.js')
    const parsePromise = serverCommand.parseAsync(['start', '--unlock'], { from: 'user' })

    // Simulate ready and unlock-result
    await vi.waitFor(() => {
      expect(child.listenerCount('message')).toBeGreaterThan(0)
    })
    child.emit('message', { type: 'ready' })
    await vi.waitFor(() => {
      expect(child.send).toHaveBeenCalledWith({ type: 'unlock', password: 'env-password' })
    })
    child.emit('message', { type: 'unlock-result', success: true })

    await parsePromise

    expect(mockPromptPassword).not.toHaveBeenCalled()
    delete process.env['2KC_UNLOCK_PASSWORD']
  })

  it('successfully unlocks via IPC when child sends ready and unlock-result', async () => {
    mockGetRunningPid.mockReturnValue(null)

    const child = createMockChildProcess(54321)
    mockFork.mockReturnValue(child)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { serverCommand } = await import('../cli/server.js')
    const parsePromise = serverCommand.parseAsync(['start', '--unlock'], { from: 'user' })

    // Simulate IPC flow
    await vi.waitFor(() => {
      expect(child.listenerCount('message')).toBeGreaterThan(0)
    })
    child.emit('message', { type: 'ready' })
    await vi.waitFor(() => {
      expect(child.send).toHaveBeenCalledWith({ type: 'unlock', password: 'test-password' })
    })
    child.emit('message', { type: 'unlock-result', success: true })

    await parsePromise

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('(unlocked)'))
    logSpy.mockRestore()
  })

  it('handles unlock failure from child', async () => {
    mockGetRunningPid.mockReturnValue(null)

    const child = createMockChildProcess(54321)
    mockFork.mockReturnValue(child)

    const mockKill = vi.fn()
    process.kill = mockKill as unknown as typeof process.kill

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { serverCommand } = await import('../cli/server.js')
    const parsePromise = serverCommand.parseAsync(['start', '--unlock'], { from: 'user' })

    // Simulate IPC flow with failure
    await vi.waitFor(() => {
      expect(child.listenerCount('message')).toBeGreaterThan(0)
    })
    child.emit('message', { type: 'ready' })
    await vi.waitFor(() => {
      expect(child.send).toHaveBeenCalled()
    })
    child.emit('message', { type: 'unlock-result', success: false, error: 'Incorrect password' })

    await parsePromise

    expect(errorSpy).toHaveBeenCalledWith('Failed to unlock: Incorrect password')
    expect(mockKill).toHaveBeenCalledWith(54321, 'SIGTERM')
    expect(mockRemovePidFile).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })

  it('handles child exit before unlock completes', async () => {
    mockGetRunningPid.mockReturnValue(null)

    const child = createMockChildProcess(54321)
    mockFork.mockReturnValue(child)

    const mockKill = vi.fn()
    process.kill = mockKill as unknown as typeof process.kill

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { serverCommand } = await import('../cli/server.js')
    const parsePromise = serverCommand.parseAsync(['start', '--unlock'], { from: 'user' })

    // Simulate child exit before unlock completes
    await vi.waitFor(() => {
      expect(child.listenerCount('exit')).toBeGreaterThan(0)
    })
    child.emit('exit', 1)

    await parsePromise

    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to unlock: Server exited with code 1 before unlock completed',
    )
    expect(mockRemovePidFile).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })

  it('handles child error event', async () => {
    mockGetRunningPid.mockReturnValue(null)

    const child = createMockChildProcess(54321)
    mockFork.mockReturnValue(child)

    const mockKill = vi.fn()
    process.kill = mockKill as unknown as typeof process.kill

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { serverCommand } = await import('../cli/server.js')
    const parsePromise = serverCommand.parseAsync(['start', '--unlock'], { from: 'user' })

    // Simulate child error
    await vi.waitFor(() => {
      expect(child.listenerCount('error')).toBeGreaterThan(0)
    })
    child.emit('error', new Error('spawn ENOENT'))

    await parsePromise

    expect(errorSpy).toHaveBeenCalledWith('Failed to unlock: Child process error: spawn ENOENT')
    expect(mockRemovePidFile).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })

  it('handles kill throwing during unlock cleanup', async () => {
    mockGetRunningPid.mockReturnValue(null)

    const child = createMockChildProcess(54321)
    mockFork.mockReturnValue(child)

    // Mock kill to throw (process may have already exited)
    const mockKill = vi.fn().mockImplementation(() => {
      throw new Error('ESRCH')
    })
    process.kill = mockKill as unknown as typeof process.kill

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { serverCommand } = await import('../cli/server.js')
    const parsePromise = serverCommand.parseAsync(['start', '--unlock'], { from: 'user' })

    // Simulate unlock failure
    await vi.waitFor(() => {
      expect(child.listenerCount('message')).toBeGreaterThan(0)
    })
    child.emit('message', { type: 'ready' })
    await vi.waitFor(() => {
      expect(child.send).toHaveBeenCalled()
    })
    child.emit('message', { type: 'unlock-result', success: false })

    await parsePromise

    // Should still clean up even when kill throws
    expect(mockRemovePidFile).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })
})

describe('server start --unlock --foreground', () => {
  let savedExitCode: number | undefined
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    savedExitCode = process.exitCode
    process.exitCode = undefined
    originalEnv = { ...process.env }
    mockLoadConfig.mockReturnValue(createTestConfig())
    mockExistsSync.mockReturnValue(true)
    mockPromptPassword.mockResolvedValue('test-password')
  })

  afterEach(() => {
    process.exitCode = savedExitCode
    process.env = originalEnv
    vi.clearAllMocks()
  })

  it('unlocks and starts server in foreground', async () => {
    mockGetRunningPid.mockReturnValue(null)
    const mockService = {
      unlock: vi.fn().mockResolvedValue(undefined),
    }
    mockResolveService.mockResolvedValue(mockService)
    mockStartServer.mockResolvedValue(undefined)

    const { serverCommand } = await import('../cli/server.js')
    await serverCommand.parseAsync(['start', '--unlock', '--foreground'], { from: 'user' })

    expect(mockService.unlock).toHaveBeenCalledWith('test-password', { serverMode: true })
    expect(mockStartServer).toHaveBeenCalled()
    expect(process.exitCode).toBeUndefined()
  })

  it('shows error for incorrect password in foreground mode', async () => {
    mockGetRunningPid.mockReturnValue(null)
    const mockService = {
      unlock: vi.fn().mockRejectedValue(new Error('Incorrect password')),
    }
    mockResolveService.mockResolvedValue(mockService)

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { serverCommand } = await import('../cli/server.js')
    await serverCommand.parseAsync(['start', '--unlock', '--foreground'], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith('Incorrect password.')
    expect(process.exitCode).toBe(1)
    expect(mockStartServer).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('health check timeout', () => {
  beforeEach(() => {
    mockLoadConfig.mockReturnValue(createTestConfig())
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('handles health check timeout', async () => {
    // This tests the timeout branch in healthCheck function
    // We need to trigger the 'timeout' event on the request
    const mockReq = {
      on: vi.fn((event: string, handler: () => void) => {
        if (event === 'timeout') {
          setTimeout(() => handler(), 0)
        }
        return mockReq
      }),
      destroy: vi.fn(),
    }

    const http = await import('node:http')
    vi.mocked(http.default.get).mockImplementation(
      () => mockReq as unknown as ReturnType<typeof http.default.get>,
    )

    mockGetRunningPid.mockReturnValue(null)
    mockFork.mockReturnValue(createMockChildProcess(54321))

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mockKill = vi.fn()
    const originalKill = process.kill
    process.kill = mockKill as unknown as typeof process.kill

    const { serverCommand } = await import('../cli/server.js')
    await serverCommand.parseAsync(['start'], { from: 'user' })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('health check failed'))
    expect(process.exitCode).toBe(1)

    process.kill = originalKill
    errorSpy.mockRestore()
  })
})
