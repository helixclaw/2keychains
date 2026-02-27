import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { SessionLock } from '../core/session-lock.js'
import type { UnlockConfig } from '../core/config.js'

describe('SessionLock', () => {
  let tmpDir: string
  let sessionPath: string
  let config: UnlockConfig

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'session-lock-test-'))
    sessionPath = join(tmpDir, 'session.lock')
    config = { ttlMs: 900_000 } // 15 minutes
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('save()', () => {
    it('creates session file with DEK and timestamps', () => {
      const sessionLock = new SessionLock(config, sessionPath)
      const dek = Buffer.alloc(32, 0xab)

      sessionLock.save(dek)

      expect(existsSync(sessionPath)).toBe(true)
      const data = JSON.parse(readFileSync(sessionPath, 'utf-8'))
      expect(data.version).toBe(1)
      expect(data.dek).toBe(dek.toString('base64'))
      expect(data.createdAt).toBeDefined()
      expect(data.expiresAt).toBeDefined()
      expect(data.lastAccessAt).toBeDefined()
    })

    it('sets expiresAt based on ttlMs', () => {
      const shortConfig: UnlockConfig = { ttlMs: 60_000 } // 1 minute
      const sessionLock = new SessionLock(shortConfig, sessionPath)
      const dek = Buffer.alloc(32, 0xab)

      const before = Date.now()
      sessionLock.save(dek)
      const after = Date.now()

      const data = JSON.parse(readFileSync(sessionPath, 'utf-8'))
      const createdAt = new Date(data.createdAt).getTime()
      const expiresAt = new Date(data.expiresAt).getTime()

      expect(createdAt).toBeGreaterThanOrEqual(before)
      expect(createdAt).toBeLessThanOrEqual(after)
      expect(expiresAt).toBe(createdAt + shortConfig.ttlMs)
    })
  })

  describe('load()', () => {
    it('returns DEK when session is valid', () => {
      const sessionLock = new SessionLock(config, sessionPath)
      const dek = Buffer.alloc(32, 0xab)
      sessionLock.save(dek)

      const loadedDek = sessionLock.load()

      expect(loadedDek).toEqual(dek)
    })

    it('returns null when no session file exists', () => {
      const sessionLock = new SessionLock(config, sessionPath)

      const loadedDek = sessionLock.load()

      expect(loadedDek).toBeNull()
    })

    it('returns null and clears when session is expired', () => {
      const expiredConfig: UnlockConfig = { ttlMs: 1 } // 1ms
      const sessionLock = new SessionLock(expiredConfig, sessionPath)
      const dek = Buffer.alloc(32, 0xab)
      sessionLock.save(dek)

      // Wait for expiry
      vi.useFakeTimers()
      vi.advanceTimersByTime(10)

      const loadedDek = sessionLock.load()

      expect(loadedDek).toBeNull()
      expect(existsSync(sessionPath)).toBe(false)

      vi.useRealTimers()
    })

    it('returns null and clears when idle TTL is exceeded', () => {
      const idleConfig: UnlockConfig = { ttlMs: 900_000, idleTtlMs: 1 } // 1ms idle
      const sessionLock = new SessionLock(idleConfig, sessionPath)
      const dek = Buffer.alloc(32, 0xab)
      sessionLock.save(dek)

      // Wait for idle expiry
      vi.useFakeTimers()
      vi.advanceTimersByTime(10)

      const loadedDek = sessionLock.load()

      expect(loadedDek).toBeNull()
      expect(existsSync(sessionPath)).toBe(false)

      vi.useRealTimers()
    })

    it('returns null and clears when file has invalid version', () => {
      const sessionLock = new SessionLock(config, sessionPath)
      const dek = Buffer.alloc(32, 0xab)
      sessionLock.save(dek)

      // Corrupt the version
      const data = JSON.parse(readFileSync(sessionPath, 'utf-8'))
      data.version = 99
      writeFileSync(sessionPath, JSON.stringify(data))

      const loadedDek = sessionLock.load()

      expect(loadedDek).toBeNull()
      expect(existsSync(sessionPath)).toBe(false)
    })

    it('returns null and clears when file is corrupted', () => {
      const sessionLock = new SessionLock(config, sessionPath)
      const dek = Buffer.alloc(32, 0xab)
      sessionLock.save(dek)

      // Corrupt the file
      writeFileSync(sessionPath, 'not valid json{{{')

      const loadedDek = sessionLock.load()

      expect(loadedDek).toBeNull()
      expect(existsSync(sessionPath)).toBe(false)
    })
  })

  describe('clear()', () => {
    it('deletes session file when it exists', () => {
      const sessionLock = new SessionLock(config, sessionPath)
      const dek = Buffer.alloc(32, 0xab)
      sessionLock.save(dek)

      expect(existsSync(sessionPath)).toBe(true)

      sessionLock.clear()

      expect(existsSync(sessionPath)).toBe(false)
    })

    it('does nothing when no session file exists', () => {
      const sessionLock = new SessionLock(config, sessionPath)

      expect(() => sessionLock.clear()).not.toThrow()
    })
  })

  describe('touch()', () => {
    it('updates lastAccessAt timestamp', () => {
      const sessionLock = new SessionLock(config, sessionPath)
      const dek = Buffer.alloc(32, 0xab)
      sessionLock.save(dek)

      const dataBefore = JSON.parse(readFileSync(sessionPath, 'utf-8'))
      const lastAccessBefore = dataBefore.lastAccessAt

      // Wait a bit before touching
      vi.useFakeTimers()
      vi.advanceTimersByTime(1000)

      sessionLock.touch()

      vi.useRealTimers()

      const dataAfter = JSON.parse(readFileSync(sessionPath, 'utf-8'))
      const lastAccessAfter = new Date(dataAfter.lastAccessAt).getTime()
      const lastAccessBeforeTime = new Date(lastAccessBefore).getTime()

      expect(lastAccessAfter).toBeGreaterThan(lastAccessBeforeTime)
    })

    it('does nothing when no session file exists', () => {
      const sessionLock = new SessionLock(config, sessionPath)

      expect(() => sessionLock.touch()).not.toThrow()
    })
  })

  describe('exists()', () => {
    it('returns true when valid session exists', () => {
      const sessionLock = new SessionLock(config, sessionPath)
      const dek = Buffer.alloc(32, 0xab)
      sessionLock.save(dek)

      expect(sessionLock.exists()).toBe(true)
    })

    it('returns false when no session file exists', () => {
      const sessionLock = new SessionLock(config, sessionPath)

      expect(sessionLock.exists()).toBe(false)
    })

    it('returns false when session is expired', () => {
      const expiredConfig: UnlockConfig = { ttlMs: 1 }
      const sessionLock = new SessionLock(expiredConfig, sessionPath)
      const dek = Buffer.alloc(32, 0xab)
      sessionLock.save(dek)

      vi.useFakeTimers()
      vi.advanceTimersByTime(10)

      expect(sessionLock.exists()).toBe(false)

      vi.useRealTimers()
    })
  })
})
