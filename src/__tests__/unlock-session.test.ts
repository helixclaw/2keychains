/// <reference types="vitest/globals" />

import { UnlockSession, type LockReason } from '../core/unlock-session.js'
import type { UnlockConfig } from '../core/config.js'

function makeDek(): Buffer {
  return Buffer.alloc(32, 0xab)
}

describe('UnlockSession', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('unlock / lock basics', () => {
    const config: UnlockConfig = { ttlMs: 60_000 }

    it('isUnlocked() returns false before unlock', () => {
      const session = new UnlockSession(config)
      expect(session.isUnlocked()).toBe(false)
    })

    it('getDek() returns null before unlock', () => {
      const session = new UnlockSession(config)
      expect(session.getDek()).toBeNull()
    })

    it('unlock(dek) makes isUnlocked() true', () => {
      const session = new UnlockSession(config)
      session.unlock(makeDek())
      expect(session.isUnlocked()).toBe(true)
    })

    it('getDek() returns the dek after unlock', () => {
      const session = new UnlockSession(config)
      const dek = makeDek()
      session.unlock(dek)
      expect(session.getDek()).toBe(dek)
    })

    it('lock() makes isUnlocked() false and getDek() null', () => {
      const session = new UnlockSession(config)
      session.unlock(makeDek())
      session.lock()
      expect(session.isUnlocked()).toBe(false)
      expect(session.getDek()).toBeNull()
    })

    it('lock() zeroes out the dek buffer', () => {
      const session = new UnlockSession(config)
      const dek = makeDek()
      session.unlock(dek)
      session.lock()
      expect(dek.every((b) => b === 0)).toBe(true)
    })

    it('lock() when already locked is a no-op (no error)', () => {
      const session = new UnlockSession(config)
      expect(() => session.lock()).not.toThrow()
    })

    it('unlock() when already unlocked calls lock() first then re-unlocks', () => {
      const session = new UnlockSession(config)
      const dek1 = makeDek()
      session.unlock(dek1)
      const dek2 = Buffer.alloc(32, 0xcd)
      session.unlock(dek2)
      expect(session.getDek()).toBe(dek2)
      expect(dek1.every((b) => b === 0)).toBe(true)
    })
  })

  describe('TTL expiry', () => {
    const config: UnlockConfig = { ttlMs: 5000 }

    it('auto-locks after ttlMs expires', () => {
      const session = new UnlockSession(config)
      session.unlock(makeDek())
      vi.advanceTimersByTime(5000)
      expect(session.isUnlocked()).toBe(false)
    })

    it('emits "locked" event with reason "ttl" on expiry', () => {
      const session = new UnlockSession(config)
      const handler = vi.fn<[LockReason], void>()
      session.on('locked', handler)
      session.unlock(makeDek())
      vi.advanceTimersByTime(5000)
      expect(handler).toHaveBeenCalledWith('ttl')
    })

    it('getDek() returns null after TTL expiry', () => {
      const session = new UnlockSession(config)
      session.unlock(makeDek())
      vi.advanceTimersByTime(5000)
      expect(session.getDek()).toBeNull()
    })
  })

  describe('idle TTL', () => {
    const config: UnlockConfig = { ttlMs: 60_000, idleTtlMs: 3000 }

    it('auto-locks after idleTtlMs of inactivity', () => {
      const session = new UnlockSession(config)
      session.unlock(makeDek())
      vi.advanceTimersByTime(3000)
      expect(session.isUnlocked()).toBe(false)
    })

    it('getDek() resets the idle timer', () => {
      const session = new UnlockSession(config)
      session.unlock(makeDek())
      vi.advanceTimersByTime(2000)
      session.getDek()
      vi.advanceTimersByTime(2000)
      expect(session.isUnlocked()).toBe(true)
      vi.advanceTimersByTime(1000)
      expect(session.isUnlocked()).toBe(false)
    })

    it('emits "locked" event with reason "idle" on idle expiry', () => {
      const session = new UnlockSession(config)
      const handler = vi.fn<[LockReason], void>()
      session.on('locked', handler)
      session.unlock(makeDek())
      vi.advanceTimersByTime(3000)
      expect(handler).toHaveBeenCalledWith('idle')
    })

    it('does not auto-lock if getDek() called within idle window', () => {
      const session = new UnlockSession(config)
      session.unlock(makeDek())
      vi.advanceTimersByTime(2500)
      session.getDek()
      vi.advanceTimersByTime(2500)
      expect(session.isUnlocked()).toBe(true)
    })
  })

  describe('max grants', () => {
    const config: UnlockConfig = { ttlMs: 60_000, maxGrantsBeforeRelock: 3 }

    it('auto-locks after maxGrants calls to recordGrantUsage()', () => {
      const session = new UnlockSession(config)
      session.unlock(makeDek())
      session.recordGrantUsage()
      session.recordGrantUsage()
      session.recordGrantUsage()
      expect(session.isUnlocked()).toBe(false)
    })

    it('emits "locked" event with reason "max-grants" when limit reached', () => {
      const session = new UnlockSession(config)
      const handler = vi.fn<[LockReason], void>()
      session.on('locked', handler)
      session.unlock(makeDek())
      session.recordGrantUsage()
      session.recordGrantUsage()
      session.recordGrantUsage()
      expect(handler).toHaveBeenCalledWith('max-grants')
    })

    it('does not lock before reaching maxGrants', () => {
      const session = new UnlockSession(config)
      session.unlock(makeDek())
      session.recordGrantUsage()
      session.recordGrantUsage()
      expect(session.isUnlocked()).toBe(true)
    })

    it('recordGrantUsage() is no-op when locked', () => {
      const session = new UnlockSession(config)
      expect(() => session.recordGrantUsage()).not.toThrow()
    })
  })

  describe('event emission', () => {
    it('emits "locked" exactly once per lock cycle', () => {
      const session = new UnlockSession({ ttlMs: 5000 })
      const handler = vi.fn<[LockReason], void>()
      session.on('locked', handler)
      session.unlock(makeDek())
      session.lock()
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('manual lock() emits "locked" with reason "manual"', () => {
      const session = new UnlockSession({ ttlMs: 60_000 })
      const handler = vi.fn<[LockReason], void>()
      session.on('locked', handler)
      session.unlock(makeDek())
      session.lock()
      expect(handler).toHaveBeenCalledWith('manual')
    })
  })

  describe('timer cleanup', () => {
    it('lock() clears all active timers', () => {
      const session = new UnlockSession({ ttlMs: 5000, idleTtlMs: 3000 })
      session.unlock(makeDek())
      session.lock()
      const handler = vi.fn<[LockReason], void>()
      session.on('locked', handler)
      vi.advanceTimersByTime(10_000)
      expect(handler).not.toHaveBeenCalled()
    })

    it('explicit lock before TTL prevents TTL callback', () => {
      const session = new UnlockSession({ ttlMs: 5000 })
      const handler = vi.fn<[LockReason], void>()
      session.on('locked', handler)
      session.unlock(makeDek())
      session.lock()
      handler.mockClear()
      vi.advanceTimersByTime(5000)
      expect(handler).not.toHaveBeenCalled()
    })
  })
})
