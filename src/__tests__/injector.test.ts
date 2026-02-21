/// <reference types="vitest/globals" />

import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { SecretInjector, MAX_BUFFER_BYTES } from '../core/injector.js'
import type { GrantManager } from '../core/grant.js'
import type { SecretStore } from '../core/secret-store.js'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

const mockedSpawn = vi.mocked(spawn)

interface MockChildProcess extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

function createMockChild(): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  return child
}

function createMockGrantManager(overrides: Partial<GrantManager> = {}): GrantManager {
  return {
    validateGrant: vi.fn().mockReturnValue(true),
    getGrant: vi.fn().mockReturnValue({
      id: 'grant-1',
      requestId: 'req-1',
      secretUuid: 'secret-uuid-1',
      grantedAt: '2026-01-15T10:00:00.000Z',
      expiresAt: '2026-01-15T10:05:00.000Z',
      used: false,
      revokedAt: null,
    }),
    markUsed: vi.fn(),
    createGrant: vi.fn(),
    revokeGrant: vi.fn(),
    cleanup: vi.fn(),
    ...overrides,
  } as unknown as GrantManager
}

function createMockSecretStore(overrides: Partial<SecretStore> = {}): SecretStore {
  return {
    getValue: vi.fn().mockReturnValue('super-secret-value'),
    ...overrides,
  } as unknown as SecretStore
}

describe('SecretInjector', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('inject', () => {
    it('spawns process with secret as env var and returns exit code + stdout + stderr', async () => {
      const grantManager = createMockGrantManager()
      const secretStore = createMockSecretStore()
      const injector = new SecretInjector(grantManager, secretStore)

      const mockChild = createMockChild()
      mockedSpawn.mockReturnValue(mockChild as never)

      const resultPromise = injector.inject('grant-1', 'SECRET_VAR', ['echo', 'hello'])

      mockChild.stdout.emit('data', Buffer.from('hello\n'))
      mockChild.emit('close', 0)

      const result = await resultPromise

      expect(result).toEqual({ exitCode: 0, stdout: 'hello\n', stderr: '' })
      expect(mockedSpawn).toHaveBeenCalledWith('echo', ['hello'], {
        env: expect.objectContaining({ SECRET_VAR: 'super-secret-value' }),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    })

    it('marks the grant as used after successful execution', async () => {
      const grantManager = createMockGrantManager()
      const secretStore = createMockSecretStore()
      const injector = new SecretInjector(grantManager, secretStore)

      const mockChild = createMockChild()
      mockedSpawn.mockReturnValue(mockChild as never)

      const resultPromise = injector.inject('grant-1', 'SECRET_VAR', ['echo', 'hello'])

      mockChild.stdout.emit('data', Buffer.from('hello\n'))
      mockChild.emit('close', 0)

      await resultPromise

      expect(grantManager.markUsed).toHaveBeenCalledWith('grant-1')
    })

    it('rejects immediately if command is empty', async () => {
      const grantManager = createMockGrantManager()
      const secretStore = createMockSecretStore()
      const injector = new SecretInjector(grantManager, secretStore)

      await expect(injector.inject('grant-1', 'SECRET_VAR', [])).rejects.toThrow(
        'Command must not be empty',
      )

      expect(mockedSpawn).not.toHaveBeenCalled()
      expect(secretStore.getValue).not.toHaveBeenCalled()
    })

    it('rejects immediately if grant is invalid', async () => {
      const grantManager = createMockGrantManager({
        validateGrant: vi.fn().mockReturnValue(false),
      })
      const secretStore = createMockSecretStore()
      const injector = new SecretInjector(grantManager, secretStore)

      await expect(injector.inject('bad-grant', 'SECRET_VAR', ['echo', 'hello'])).rejects.toThrow(
        'Grant is not valid: bad-grant',
      )

      expect(mockedSpawn).not.toHaveBeenCalled()
      expect(secretStore.getValue).not.toHaveBeenCalled()
    })

    it('rejects immediately if grant is expired', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-15T10:06:00.000Z'))

      const grantManager = createMockGrantManager({
        validateGrant: vi.fn().mockReturnValue(false),
      })
      const secretStore = createMockSecretStore()
      const injector = new SecretInjector(grantManager, secretStore)

      await expect(injector.inject('grant-1', 'SECRET_VAR', ['echo', 'hello'])).rejects.toThrow(
        'Grant is not valid: grant-1',
      )

      expect(mockedSpawn).not.toHaveBeenCalled()

      vi.useRealTimers()
    })

    it('handles process non-zero exit code', async () => {
      const grantManager = createMockGrantManager()
      const secretStore = createMockSecretStore()
      const injector = new SecretInjector(grantManager, secretStore)

      const mockChild = createMockChild()
      mockedSpawn.mockReturnValue(mockChild as never)

      const resultPromise = injector.inject('grant-1', 'SECRET_VAR', ['false'])

      mockChild.stderr.emit('data', Buffer.from('error occurred\n'))
      mockChild.emit('close', 1)

      const result = await resultPromise

      expect(result).toEqual({ exitCode: 1, stdout: '', stderr: 'error occurred\n' })
    })

    it('handles spawn failure (bad command)', async () => {
      const grantManager = createMockGrantManager()
      const secretStore = createMockSecretStore()
      const injector = new SecretInjector(grantManager, secretStore)

      const mockChild = createMockChild()
      mockedSpawn.mockReturnValue(mockChild as never)

      const resultPromise = injector.inject('grant-1', 'SECRET_VAR', ['nonexistent-command'])

      mockChild.emit('error', new Error('spawn nonexistent-command ENOENT'))

      await expect(resultPromise).rejects.toThrow('Spawn failure: spawn nonexistent-command ENOENT')

      // Grant should still be marked used in finally block
      expect(grantManager.markUsed).toHaveBeenCalledWith('grant-1')
    })

    it('handles process timeout', async () => {
      vi.useFakeTimers()

      const grantManager = createMockGrantManager()
      const secretStore = createMockSecretStore()
      const injector = new SecretInjector(grantManager, secretStore)

      const mockChild = createMockChild()
      mockedSpawn.mockReturnValue(mockChild as never)

      const resultPromise = injector.inject('grant-1', 'SECRET_VAR', ['sleep', '999'], {
        timeoutMs: 5000,
      })

      // When kill is called, simulate the close event
      mockChild.kill.mockImplementation(() => {
        process.nextTick(() => mockChild.emit('close', null))
        return true
      })

      // Advance past timeout - this triggers the setTimeout callback which calls kill
      vi.advanceTimersByTime(5001)

      await expect(resultPromise).rejects.toThrow('Process timed out after 5000ms')

      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL')

      vi.useRealTimers()
    })

    it('marks grant as used even if process exits with non-zero code', async () => {
      const grantManager = createMockGrantManager()
      const secretStore = createMockSecretStore()
      const injector = new SecretInjector(grantManager, secretStore)

      const mockChild = createMockChild()
      mockedSpawn.mockReturnValue(mockChild as never)

      const resultPromise = injector.inject('grant-1', 'SECRET_VAR', ['false'])

      mockChild.emit('close', 1)

      await resultPromise

      expect(grantManager.markUsed).toHaveBeenCalledWith('grant-1')
    })

    it('does not mask original error when markUsed throws', async () => {
      const grantManager = createMockGrantManager({
        markUsed: vi.fn().mockImplementation(() => {
          throw new Error('Grant is not valid: grant-1')
        }),
      })
      const secretStore = createMockSecretStore()
      const injector = new SecretInjector(grantManager, secretStore)

      const mockChild = createMockChild()
      mockedSpawn.mockReturnValue(mockChild as never)

      const resultPromise = injector.inject('grant-1', 'SECRET_VAR', ['fail-cmd'])

      mockChild.emit('error', new Error('spawn fail-cmd ENOENT'))

      // Original spawn error should surface, not the markUsed error
      await expect(resultPromise).rejects.toThrow('Spawn failure: spawn fail-cmd ENOENT')
    })

    it('kills process when stdout exceeds MAX_BUFFER_BYTES', async () => {
      const grantManager = createMockGrantManager()
      const secretStore = createMockSecretStore()
      const injector = new SecretInjector(grantManager, secretStore)

      const mockChild = createMockChild()
      mockedSpawn.mockReturnValue(mockChild as never)

      mockChild.kill.mockImplementation(() => {
        process.nextTick(() => mockChild.emit('close', null))
        return true
      })

      const resultPromise = injector.inject('grant-1', 'SECRET_VAR', ['big-output'])

      // Emit a chunk that exceeds the buffer limit
      const oversizedChunk = Buffer.alloc(MAX_BUFFER_BYTES + 1, 'x')
      mockChild.stdout.emit('data', oversizedChunk)

      await expect(resultPromise).rejects.toThrow(
        `Process killed: output exceeded ${MAX_BUFFER_BYTES} byte buffer limit`,
      )

      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL')
    })

    it('kills process when stderr exceeds MAX_BUFFER_BYTES', async () => {
      const grantManager = createMockGrantManager()
      const secretStore = createMockSecretStore()
      const injector = new SecretInjector(grantManager, secretStore)

      const mockChild = createMockChild()
      mockedSpawn.mockReturnValue(mockChild as never)

      mockChild.kill.mockImplementation(() => {
        process.nextTick(() => mockChild.emit('close', null))
        return true
      })

      const resultPromise = injector.inject('grant-1', 'SECRET_VAR', ['big-errors'])

      const oversizedChunk = Buffer.alloc(MAX_BUFFER_BYTES + 1, 'x')
      mockChild.stderr.emit('data', oversizedChunk)

      await expect(resultPromise).rejects.toThrow(
        `Process killed: output exceeded ${MAX_BUFFER_BYTES} byte buffer limit`,
      )

      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL')
    })

    it('captures both stdout and stderr', async () => {
      const grantManager = createMockGrantManager()
      const secretStore = createMockSecretStore()
      const injector = new SecretInjector(grantManager, secretStore)

      const mockChild = createMockChild()
      mockedSpawn.mockReturnValue(mockChild as never)

      const resultPromise = injector.inject('grant-1', 'SECRET_VAR', ['my-cmd'])

      mockChild.stdout.emit('data', Buffer.from('out1'))
      mockChild.stdout.emit('data', Buffer.from('out2'))
      mockChild.stderr.emit('data', Buffer.from('err1'))
      mockChild.emit('close', 0)

      const result = await resultPromise

      expect(result.stdout).toBe('out1out2')
      expect(result.stderr).toBe('err1')
    })
  })
})
