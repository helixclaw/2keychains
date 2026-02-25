import { EventEmitter } from 'node:events'
import type { UnlockConfig } from './config.js'

export type LockReason = 'manual' | 'ttl' | 'idle' | 'max-grants'

export interface UnlockSessionEvents {
  locked: [reason: LockReason]
}

export class UnlockSession extends EventEmitter<UnlockSessionEvents> {
  private dek: Buffer | null = null
  private ttlTimer: ReturnType<typeof setTimeout> | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private grantCount = 0
  private readonly config: UnlockConfig

  constructor(config: UnlockConfig) {
    super()
    this.config = config
  }

  unlock(dek: Buffer): void {
    if (this.dek !== null) {
      this.lock('manual')
    }
    this.dek = dek
    this.grantCount = 0
    this.startTtlTimer()
    this.resetIdleTimer()
  }

  lock(reason: LockReason = 'manual'): void {
    if (this.dek === null) return
    this.lockInternal()
    this.emit('locked', reason)
  }

  getDek(): Buffer | null {
    if (this.dek === null) return null
    this.resetIdleTimer()
    return this.dek
  }

  isUnlocked(): boolean {
    return this.dek !== null
  }

  recordGrantUsage(): void {
    if (this.dek === null) return
    this.grantCount++
    if (
      this.config.maxGrantsBeforeRelock !== undefined &&
      this.grantCount >= this.config.maxGrantsBeforeRelock
    ) {
      this.lock('max-grants')
    }
  }

  private lockInternal(): void {
    if (this.dek !== null) {
      this.dek.fill(0)
    }
    this.dek = null
    this.clearTimers()
    this.grantCount = 0
  }

  private clearTimers(): void {
    if (this.ttlTimer !== null) {
      clearTimeout(this.ttlTimer)
      this.ttlTimer = null
    }
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private startTtlTimer(): void {
    if (this.config.ttlMs > 0) {
      this.ttlTimer = setTimeout(() => {
        this.lock('ttl')
      }, this.config.ttlMs)
      this.ttlTimer.unref()
    }
  }

  private resetIdleTimer(): void {
    if (this.config.idleTtlMs === undefined) return
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer)
    }
    this.idleTimer = setTimeout(() => {
      this.lock('idle')
    }, this.config.idleTtlMs)
    this.idleTimer.unref()
  }
}
