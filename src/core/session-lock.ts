import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { CONFIG_DIR, type UnlockConfig } from './config.js'

const DEFAULT_SESSION_PATH = join(CONFIG_DIR, 'session.lock')

interface SessionLockFile {
  version: 1
  createdAt: string
  expiresAt: string
  lastAccessAt: string
  dek: string
}

export class SessionLock {
  private readonly filePath: string
  private readonly config: UnlockConfig

  constructor(config: UnlockConfig, filePath: string = DEFAULT_SESSION_PATH) {
    this.config = config
    this.filePath = filePath
  }

  save(dek: Buffer): void {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + this.config.ttlMs)

    const data: SessionLockFile = {
      version: 1,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      lastAccessAt: now.toISOString(),
      dek: dek.toString('base64'),
    }

    const dir = dirname(this.filePath)
    mkdirSync(dir, { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8')
    chmodSync(this.filePath, 0o600)
  }

  load(): Buffer | null {
    if (!existsSync(this.filePath)) {
      return null
    }

    let data: SessionLockFile
    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      data = JSON.parse(raw) as SessionLockFile
      if (data.version !== 1) {
        this.clear()
        return null
      }
    } catch {
      this.clear()
      return null
    }

    const now = Date.now()
    const expiresAt = new Date(data.expiresAt).getTime()
    if (now >= expiresAt) {
      this.clear()
      return null
    }

    // Check idle TTL if configured
    if (this.config.idleTtlMs !== undefined) {
      const lastAccessAt = new Date(data.lastAccessAt).getTime()
      const idleExpiresAt = lastAccessAt + this.config.idleTtlMs
      if (now >= idleExpiresAt) {
        this.clear()
        return null
      }
    }

    return Buffer.from(data.dek, 'base64')
  }

  clear(): void {
    if (existsSync(this.filePath)) {
      try {
        unlinkSync(this.filePath)
      } catch {
        // Ignore errors during cleanup
      }
    }
  }

  touch(): void {
    if (!existsSync(this.filePath)) {
      return
    }

    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      const data = JSON.parse(raw) as SessionLockFile
      if (data.version !== 1) {
        return
      }

      data.lastAccessAt = new Date().toISOString()
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8')
      chmodSync(this.filePath, 0o600)
    } catch {
      // Ignore errors during touch
    }
  }

  exists(): boolean {
    if (!existsSync(this.filePath)) {
      return false
    }

    // Validate the session is not expired
    const dek = this.load()
    return dek !== null
  }
}
