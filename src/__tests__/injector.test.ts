/// <reference types="vitest/globals" />

import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawn } from 'node:child_process'
import { SecretInjector, MAX_BUFFER_BYTES } from '../core/injector.js'
import type { GrantManager } from '../core/grant.js'
import type { SecretStore } from '../core/secret-store.js'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

const mockedSpawn = vi.mocked(spawn)

interface MockChildProcess extends EventEmitter {
  stdout: PassThrough
  stderr: PassThrough
  kill: ReturnType<typeof vi.fn>
}

function createMockChild(): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = vi.fn()
  return child
}

function createMockGrantManager(overrides: Partial<GrantManager> = {}): GrantManager {
  return {
    validateGrant: vi.fn().mockReturnValue(true),
    getGrant: vi.fn().mockReturnValue({
      id: 'grant-1',
      requestId: 'req-1',
      secretUuids: ['secret-uuid-1'],
      grantedAt: '2026-01-15T10:00:00.000Z',
      expiresAt: '2026-01-15T10:05:00.000Z',
      used: false,
      revokedAt: null,
    }),
    markUsed: vi.fn(),
    createGrant: vi.fn(),
    revokeGrant: vi.fn(),
    cleanup: vi.fn(),
    getGrantSecrets: vi.fn().mockReturnValue(['secret-uuid-1']),
    ...overrides,
  } as unknown as GrantManager
}

function createMockSecretStore(overrides: Partial<SecretStore> = {}): SecretStore {
  return {
    getValue: vi.fn().mockReturnValue('super-secret-value'),
    resolveRef: vi.fn().mockReturnValue({ uuid: 'secret-uuid-1', value: 'resolved-secret' }),
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

      const resultPromise = injector.inject('grant-1', ['echo', 'hello'], {
        envVarName: 'SECRET_VAR',
      })

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

      const resultPromise = injector.inject('grant-1', ['echo', 'hello'], {
        envVarName: 'SECRET_VAR',
      })

      mockChild.stdout.emit('data', Buffer.from('hello\n'))
      mockChild.emit('close', 0)

      await resultPromise

      expect(grantManager.markUsed).toHaveBeenCalledWith('grant-1')
    })

    it('rejects immediately if command is empty', async () => {
      const grantManager = createMockGrantManager()
      const secretStore = createMockSecretStore()
      const injector = new SecretInjector(grantManager, secretStore)

      await expect(injector.inject('grant-1', [])).rejects.toThrow('Command must not be empty')

      expect(mockedSpawn).not.toHaveBeenCalled()
      expect(secretStore.getValue).not.toHaveBeenCalled()
    })

    it('rejects immediately if grant is invalid', async () => {
      const grantManager = createMockGrantManager({
        validateGrant: vi.fn().mockReturnValue(false),
      })
      const secretStore = createMockSecretStore()
      const injector = new SecretInjector(grantManager, secretStore)

      await expect(
        injector.inject('bad-grant', ['echo', 'hello'], { envVarName: 'SECRET_VAR' }),
      ).rejects.toThrow('Grant is not valid: bad-grant')

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

      await expect(
        injector.inject('grant-1', ['echo', 'hello'], { envVarName: 'SECRET_VAR' }),
      ).rejects.toThrow('Grant is not valid: grant-1')

      expect(mockedSpawn).not.toHaveBeenCalled()

      vi.useRealTimers()
    })

    it('handles process non-zero exit code', async () => {
      const grantManager = createMockGrantManager()
      const secretStore = createMockSecretStore()
      const injector = new SecretInjector(grantManager, secretStore)

      const mockChild = createMockChild()
      mockedSpawn.mockReturnValue(mockChild as never)

      const resultPromise = injector.inject('grant-1', ['false'], { envVarName: 'SECRET_VAR' })

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

      const resultPromise = injector.inject('grant-1', ['nonexistent-command'], {
        envVarName: 'SECRET_VAR',
      })

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

      const resultPromise = injector.inject('grant-1', ['sleep', '999'], {
        envVarName: 'SECRET_VAR',
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

      const resultPromise = injector.inject('grant-1', ['false'], { envVarName: 'SECRET_VAR' })

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

      const resultPromise = injector.inject('grant-1', ['fail-cmd'], { envVarName: 'SECRET_VAR' })

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

      const resultPromise = injector.inject('grant-1', ['big-output'], {
        envVarName: 'SECRET_VAR',
      })

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

      const resultPromise = injector.inject('grant-1', ['big-errors'], {
        envVarName: 'SECRET_VAR',
      })

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

      const resultPromise = injector.inject('grant-1', ['my-cmd'], { envVarName: 'SECRET_VAR' })

      mockChild.stdout.emit('data', Buffer.from('out1'))
      mockChild.stdout.emit('data', Buffer.from('out2'))
      mockChild.stderr.emit('data', Buffer.from('err1'))
      mockChild.emit('close', 0)

      const result = await resultPromise

      expect(result.stdout).toBe('out1out2')
      expect(result.stderr).toBe('err1')
    })

    it('redacts secret value from stdout', async () => {
      const grantManager = createMockGrantManager()
      const secretStore = createMockSecretStore()
      const injector = new SecretInjector(grantManager, secretStore)

      const mockChild = createMockChild()
      mockedSpawn.mockReturnValue(mockChild as never)

      const resultPromise = injector.inject('grant-1', 'SECRET_VAR', ['leaky-cmd'])

      mockChild.stdout.emit('data', Buffer.from('token is super-secret-value ok'))
      mockChild.emit('close', 0)

      const result = await resultPromise

      expect(result.stdout).toBe('token is [REDACTED] ok')
      expect(result.stdout).not.toContain('super-secret-value')
    })

    it('redacts secret value from stderr', async () => {
      const grantManager = createMockGrantManager()
      const secretStore = createMockSecretStore()
      const injector = new SecretInjector(grantManager, secretStore)

      const mockChild = createMockChild()
      mockedSpawn.mockReturnValue(mockChild as never)

      const resultPromise = injector.inject('grant-1', 'SECRET_VAR', ['leaky-cmd'])

      mockChild.stderr.emit('data', Buffer.from('error: super-secret-value leaked'))
      mockChild.emit('close', 1)

      const result = await resultPromise

      expect(result.stderr).toBe('error: [REDACTED] leaked')
      expect(result.stderr).not.toContain('super-secret-value')
    })

    it('redacts secret spanning multiple stdout chunks', async () => {
      const grantManager = createMockGrantManager()
      const secretStore = createMockSecretStore()
      const injector = new SecretInjector(grantManager, secretStore)

      const mockChild = createMockChild()
      mockedSpawn.mockReturnValue(mockChild as never)

      const resultPromise = injector.inject('grant-1', 'SECRET_VAR', ['leaky-cmd'])

      // Split "super-secret-value" across two chunks
      mockChild.stdout.emit('data', Buffer.from('begin super-sec'))
      mockChild.stdout.emit('data', Buffer.from('ret-value end'))
      mockChild.emit('close', 0)

      const result = await resultPromise

      expect(result.stdout).toBe('begin [REDACTED] end')
      expect(result.stdout).not.toContain('super-secret-value')
    })
  })

  describe('scanAndReplace (via inject)', () => {
    it('replaces 2k://name placeholder with secret value', async () => {
      const grantManager = createMockGrantManager()
      const secretStore = createMockSecretStore({
        getValue: vi.fn().mockReturnValue('super-secret-value'),
        resolveRef: vi.fn().mockReturnValue({ uuid: 'secret-uuid-1', value: 'real-api-key' }),
      })
      const injector = new SecretInjector(grantManager, secretStore)

      const mockChild = createMockChild()
      mockedSpawn.mockReturnValue(mockChild as never)

      // Set a placeholder in process.env
      const origEnv = process.env['TEST_API_KEY']
      process.env['TEST_API_KEY'] = '2k://my-api-key'

      try {
        const resultPromise = injector.inject('grant-1', ['echo', 'hello'])

        mockChild.emit('close', 0)
        await resultPromise

        expect(secretStore.resolveRef).toHaveBeenCalledWith('my-api-key')
        expect(mockedSpawn).toHaveBeenCalledWith('echo', ['hello'], {
          env: expect.objectContaining({ TEST_API_KEY: 'real-api-key' }),
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } finally {
        if (origEnv === undefined) {
          delete process.env['TEST_API_KEY']
        } else {
          process.env['TEST_API_KEY'] = origEnv
        }
      }
    })

    it('replaces 2k://uuid placeholder with secret value', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000'
      const grantManager = createMockGrantManager({
        getGrant: vi.fn().mockReturnValue({
          id: 'grant-1',
          requestId: 'req-1',
          secretUuids: [uuid],
          grantedAt: '2026-01-15T10:00:00.000Z',
          expiresAt: '2026-01-15T10:05:00.000Z',
          used: false,
          revokedAt: null,
        }),
      })
      const secretStore = createMockSecretStore({
        getValue: vi.fn().mockReturnValue('super-secret-value'),
        resolveRef: vi.fn().mockReturnValue({ uuid, value: 'db-password-123' }),
      })
      const injector = new SecretInjector(grantManager, secretStore)

      const mockChild = createMockChild()
      mockedSpawn.mockReturnValue(mockChild as never)

      const origEnv = process.env['DB_PASS']
      process.env['DB_PASS'] = `2k://${uuid}`

      try {
        const resultPromise = injector.inject('grant-1', ['echo', 'hello'])

        mockChild.emit('close', 0)
        await resultPromise

        expect(secretStore.resolveRef).toHaveBeenCalledWith(uuid)
        expect(mockedSpawn).toHaveBeenCalledWith('echo', ['hello'], {
          env: expect.objectContaining({ DB_PASS: 'db-password-123' }),
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } finally {
        if (origEnv === undefined) {
          delete process.env['DB_PASS']
        } else {
          process.env['DB_PASS'] = origEnv
        }
      }
    })

    it('leaves non-placeholder env vars unchanged', async () => {
      const grantManager = createMockGrantManager()
      const secretStore = createMockSecretStore({
        getValue: vi.fn().mockReturnValue('super-secret-value'),
        resolveRef: vi.fn().mockReturnValue({ uuid: 'secret-uuid-1', value: 'resolved' }),
      })
      const injector = new SecretInjector(grantManager, secretStore)

      const mockChild = createMockChild()
      mockedSpawn.mockReturnValue(mockChild as never)

      const origPath = process.env['PATH']
      const origKey = process.env['TEST_SCAN_KEY']
      process.env['TEST_SCAN_KEY'] = '2k://my-key'

      try {
        const resultPromise = injector.inject('grant-1', ['echo', 'hello'])

        mockChild.emit('close', 0)
        await resultPromise

        // PATH should be preserved as-is
        expect(mockedSpawn).toHaveBeenCalledWith('echo', ['hello'], {
          env: expect.objectContaining({ PATH: origPath, TEST_SCAN_KEY: 'resolved' }),
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } finally {
        if (origKey === undefined) {
          delete process.env['TEST_SCAN_KEY']
        } else {
          process.env['TEST_SCAN_KEY'] = origKey
        }
      }
    })

    it('replaces multiple placeholders across different env vars', async () => {
      const grantManager = createMockGrantManager({
        getGrant: vi.fn().mockReturnValue({
          id: 'grant-1',
          requestId: 'req-1',
          secretUuids: ['uuid-a', 'uuid-b'],
          grantedAt: '2026-01-15T10:00:00.000Z',
          expiresAt: '2026-01-15T10:05:00.000Z',
          used: false,
          revokedAt: null,
        }),
      })
      const secretStore = createMockSecretStore({
        getValue: vi.fn().mockReturnValue('super-secret-value'),
        resolveRef: vi.fn().mockImplementation((ref: string) => {
          if (ref === 'ref-a') return { uuid: 'uuid-a', value: 'value-a' }
          if (ref === 'ref-b') return { uuid: 'uuid-b', value: 'value-b' }
          throw new Error(`Unknown ref: ${ref}`)
        }),
      })
      const injector = new SecretInjector(grantManager, secretStore)

      const mockChild = createMockChild()
      mockedSpawn.mockReturnValue(mockChild as never)

      const origA = process.env['TEST_A']
      const origB = process.env['TEST_B']
      const origC = process.env['TEST_C']
      process.env['TEST_A'] = '2k://ref-a'
      process.env['TEST_B'] = '2k://ref-b'
      process.env['TEST_C'] = 'normal-value'

      try {
        const resultPromise = injector.inject('grant-1', ['echo', 'hello'])

        mockChild.emit('close', 0)
        await resultPromise

        expect(mockedSpawn).toHaveBeenCalledWith('echo', ['hello'], {
          env: expect.objectContaining({
            TEST_A: 'value-a',
            TEST_B: 'value-b',
            TEST_C: 'normal-value',
          }),
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } finally {
        if (origA === undefined) delete process.env['TEST_A']
        else process.env['TEST_A'] = origA
        if (origB === undefined) delete process.env['TEST_B']
        else process.env['TEST_B'] = origB
        if (origC === undefined) delete process.env['TEST_C']
        else process.env['TEST_C'] = origC
      }
    })

    it('throws if placeholder references secret not in grant scope', async () => {
      const grantManager = createMockGrantManager()
      const secretStore = createMockSecretStore({
        getValue: vi.fn().mockReturnValue('super-secret-value'),
        resolveRef: vi.fn().mockReturnValue({ uuid: 'out-of-scope-uuid', value: 'some-value' }),
      })
      const injector = new SecretInjector(grantManager, secretStore)

      const origEnv = process.env['TEST_OOS']
      process.env['TEST_OOS'] = '2k://out-of-scope'

      try {
        await expect(injector.inject('grant-1', ['echo', 'hello'])).rejects.toThrow(
          'Placeholder 2k://out-of-scope in TEST_OOS references secret out-of-scope-uuid which is not covered by the grant',
        )
      } finally {
        if (origEnv === undefined) {
          delete process.env['TEST_OOS']
        } else {
          process.env['TEST_OOS'] = origEnv
        }
      }
    })

    it('throws if placeholder ref cannot be resolved', async () => {
      const grantManager = createMockGrantManager()
      const secretStore = createMockSecretStore({
        getValue: vi.fn().mockReturnValue('super-secret-value'),
        resolveRef: vi.fn().mockImplementation(() => {
          throw new Error('Secret with ref "nonexistent" not found')
        }),
      })
      const injector = new SecretInjector(grantManager, secretStore)

      const origEnv = process.env['TEST_NE']
      process.env['TEST_NE'] = '2k://nonexistent'

      try {
        await expect(injector.inject('grant-1', ['echo', 'hello'])).rejects.toThrow(
          'Secret with ref "nonexistent" not found',
        )
      } finally {
        if (origEnv === undefined) {
          delete process.env['TEST_NE']
        } else {
          process.env['TEST_NE'] = origEnv
        }
      }
    })

    it('does not match partial 2k:// in substring', async () => {
      const grantManager = createMockGrantManager()
      const secretStore = createMockSecretStore()
      const injector = new SecretInjector(grantManager, secretStore)

      const mockChild = createMockChild()
      mockedSpawn.mockReturnValue(mockChild as never)

      const origEnv = process.env['TEST_URL']
      process.env['TEST_URL'] = 'https://2k://something/path'

      try {
        const resultPromise = injector.inject('grant-1', ['echo', 'hello'])

        mockChild.emit('close', 0)
        await resultPromise

        // resolveRef should NOT have been called since it's not a full-value match
        expect(secretStore.resolveRef).not.toHaveBeenCalled()
        expect(mockedSpawn).toHaveBeenCalledWith('echo', ['hello'], {
          env: expect.objectContaining({ TEST_URL: 'https://2k://something/path' }),
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } finally {
        if (origEnv === undefined) {
          delete process.env['TEST_URL']
        } else {
          process.env['TEST_URL'] = origEnv
        }
      }
    })
  })

  describe('inject with placeholder scanning', () => {
    it('scans env and replaces placeholders when no envVarName given', async () => {
      const grantManager = createMockGrantManager()
      const secretStore = createMockSecretStore({
        getValue: vi.fn().mockReturnValue('super-secret-value'),
        resolveRef: vi.fn().mockReturnValue({ uuid: 'secret-uuid-1', value: 'scanned-secret' }),
      })
      const injector = new SecretInjector(grantManager, secretStore)

      const mockChild = createMockChild()
      mockedSpawn.mockReturnValue(mockChild as never)

      const origEnv = process.env['TEST_SCAN_ONLY']
      process.env['TEST_SCAN_ONLY'] = '2k://my-secret'

      try {
        const resultPromise = injector.inject('grant-1', ['echo', 'hello'])

        mockChild.emit('close', 0)
        await resultPromise

        // No explicit envVarName, so getValue should not be called for explicit injection
        expect(secretStore.resolveRef).toHaveBeenCalledWith('my-secret')
        expect(mockedSpawn).toHaveBeenCalledWith('echo', ['hello'], {
          env: expect.objectContaining({ TEST_SCAN_ONLY: 'scanned-secret' }),
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } finally {
        if (origEnv === undefined) {
          delete process.env['TEST_SCAN_ONLY']
        } else {
          process.env['TEST_SCAN_ONLY'] = origEnv
        }
      }
    })

    it('mixed mode: explicit envVarName + placeholder scanning', async () => {
      const grantManager = createMockGrantManager({
        getGrant: vi.fn().mockReturnValue({
          id: 'grant-1',
          requestId: 'req-1',
          secretUuids: ['secret-uuid-1', 'secret-uuid-2'],
          grantedAt: '2026-01-15T10:00:00.000Z',
          expiresAt: '2026-01-15T10:05:00.000Z',
          used: false,
          revokedAt: null,
        }),
      })
      const secretStore = createMockSecretStore({
        getValue: vi.fn().mockReturnValue('explicit-secret-value'),
        resolveRef: vi
          .fn()
          .mockReturnValue({ uuid: 'secret-uuid-2', value: 'placeholder-secret-value' }),
      })
      const injector = new SecretInjector(grantManager, secretStore)

      const mockChild = createMockChild()
      mockedSpawn.mockReturnValue(mockChild as never)

      const origEnv = process.env['TEST_PLACEHOLDER']
      process.env['TEST_PLACEHOLDER'] = '2k://other-secret'

      try {
        const resultPromise = injector.inject('grant-1', ['echo', 'hello'], {
          envVarName: 'EXPLICIT_VAR',
        })

        mockChild.emit('close', 0)
        await resultPromise

        // Both explicit and placeholder should be in the env
        expect(mockedSpawn).toHaveBeenCalledWith('echo', ['hello'], {
          env: expect.objectContaining({
            EXPLICIT_VAR: 'explicit-secret-value',
            TEST_PLACEHOLDER: 'placeholder-secret-value',
          }),
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } finally {
        if (origEnv === undefined) {
          delete process.env['TEST_PLACEHOLDER']
        } else {
          process.env['TEST_PLACEHOLDER'] = origEnv
        }
      }
    })
  })
})
