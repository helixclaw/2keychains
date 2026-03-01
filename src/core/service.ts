import { join, dirname } from 'node:path'
import type { KeyObject } from 'node:crypto'
import type { AppConfig } from './config.js'
import type { SecretListItem, SecretMetadata, ProcessResult } from './types.js'
import type { AccessRequest, AccessRequestStatus } from './request.js'
import { createAccessRequest, RequestLog } from './request.js'
import type { AccessGrant } from './grant.js'
import type { NotificationChannel } from '../channels/channel.js'
import { RemoteService } from './remote-service.js'
import { EncryptedSecretStore } from './encrypted-store.js'
import { UnlockSession } from './unlock-session.js'
import { GrantManager } from './grant.js'
import { SessionLock } from './session-lock.js'
import { normalizeCommand, hashCommand } from './command-hash.js'
import { WorkflowEngine } from './workflow.js'
import { SecretInjector } from './injector.js'
import { DiscordChannel } from '../channels/discord.js'
import { loadOrGenerateKeyPair } from './key-manager.js'

// SecretSummary aliases existing SecretListItem shape
export type SecretSummary = SecretListItem

export interface Service {
  health(): Promise<{ status: string; uptime?: number }>

  keys: {
    getPublicKey(): Promise<string>
  }

  secrets: {
    list(): Promise<SecretSummary[]>
    add(ref: string, value: string, tags?: string[]): Promise<{ uuid: string }>
    remove(uuid: string): Promise<void>
    getMetadata(uuid: string): Promise<SecretMetadata>
    resolve(refOrUuid: string): Promise<SecretMetadata>
  }

  requests: {
    create(
      secretUuids: string[],
      reason: string,
      taskRef: string,
      duration?: number,
      command?: string,
    ): Promise<AccessRequest>
  }

  grants: {
    getStatus(
      requestId: string,
    ): Promise<{ status: AccessRequestStatus; grant?: AccessGrant; jws?: string }>
    /**
     * Consume a grant and return all secret values in a single atomic operation.
     * The grant is marked as used before secrets are returned (prevents replay).
     * Used by client mode to fetch secrets from the server.
     */
    consume(requestId: string): Promise<{
      grantId: string
      secrets: Record<string, { uuid: string; ref: string; value: string }>
    }>
  }

  inject(
    requestId: string,
    command: string,
    options?: { envVarName?: string },
  ): Promise<ProcessResult>
}

interface LocalServiceDeps {
  store: EncryptedSecretStore
  unlockSession: UnlockSession
  sessionLock: SessionLock
  grantManager: GrantManager
  workflowEngine: WorkflowEngine
  injector: SecretInjector
  requestLog: RequestLog
  startTime: number
  bindCommand: boolean
  publicKey: KeyObject
}

export class LocalService implements Service {
  private readonly onLocked: () => void

  constructor(private readonly deps: LocalServiceDeps) {
    // When session auto-locks (TTL/idle/max-grants), also lock the encrypted store and clear session
    this.onLocked = () => {
      deps.store.lock()
      deps.sessionLock.clear()
    }
    deps.unlockSession.on('locked', this.onLocked)
  }

  destroy(): void {
    this.deps.unlockSession.off('locked', this.onLocked)
  }

  // Called by `2kc unlock` CLI command — not on the Service interface
  async unlock(
    password: string,
    options?: { persist?: boolean; serverMode?: boolean },
  ): Promise<void> {
    await this.deps.store.unlock(password)
    const dek = this.deps.store.getDek()
    if (!dek) throw new Error('Failed to obtain DEK after unlock')
    this.deps.unlockSession.unlock(dek)

    // Server mode: disable TTL/idle timers (stay unlocked until process ends)
    if (options?.serverMode) {
      this.deps.unlockSession.disableTimers()
    }

    // Only persist to session.lock if not in server mode
    if (options?.persist !== false && !options?.serverMode) {
      this.deps.sessionLock.save(dek)
    }
  }

  isUnlocked(): boolean {
    return this.deps.unlockSession.isUnlocked()
  }

  // Called by `2kc lock` CLI command — not on the Service interface
  lock(): void {
    this.deps.unlockSession.lock()
    this.deps.sessionLock.clear()
    // EncryptedSecretStore.lock() is called via the 'locked' event handler above
  }

  async health(): Promise<{ status: string; uptime?: number }> {
    return {
      status: this.deps.unlockSession.isUnlocked() ? 'unlocked' : 'locked',
      uptime: Date.now() - this.deps.startTime,
    }
  }

  keys: Service['keys'] = {
    getPublicKey: async () => this.deps.publicKey.export({ type: 'spki', format: 'pem' }) as string,
  }

  secrets: Service['secrets'] = {
    list: async () => this.deps.store.list(),

    add: async (ref, value, tags) => {
      if (!this.deps.unlockSession.isUnlocked()) {
        throw new Error('Store is locked. Run `2kc unlock` first.')
      }
      const uuid = this.deps.store.add(ref, value, tags)
      return { uuid }
    },

    remove: async (uuid) => {
      this.deps.store.remove(uuid)
    },

    getMetadata: async (uuid) => this.deps.store.getMetadata(uuid),

    resolve: async (refOrUuid) => this.deps.store.resolve(refOrUuid),
  }

  requests: Service['requests'] = {
    create: async (secretUuids, reason, taskRef, duration, command) => {
      let commandHash: string | undefined
      if (this.deps.bindCommand && command) {
        commandHash = hashCommand(normalizeCommand(command))
      }
      const request = createAccessRequest(
        secretUuids,
        reason,
        taskRef,
        duration,
        command,
        commandHash,
      )
      this.deps.requestLog.add(request)
      this.deps.requestLog.save()
      // Fire-and-forget: kick off workflow in background
      this.runWorkflow(request).catch((err: unknown) => {
        console.error('runWorkflow failed unexpectedly:', err)
        request.status = 'denied'
        this.deps.requestLog.save()
      })
      return request // always returns with status: 'pending'
    },
  }

  grants: Service['grants'] = {
    getStatus: async (requestId) => {
      const request = this.deps.requestLog.getById(requestId)
      if (!request) throw new Error(`Request not found: ${requestId}`)
      const grant = this.deps.grantManager.getGrantByRequestId(requestId)
      return {
        status: request.status,
        grant: grant,
        jws: grant?.jws,
      }
    },
    consume: async (requestId) => {
      if (!this.deps.unlockSession.isUnlocked()) {
        throw new Error('Store is locked. Run `2kc unlock` first.')
      }

      const grant = this.deps.grantManager.getGrantByRequestId(requestId)
      if (!grant) {
        throw new Error(`No grant found for request: ${requestId}`)
      }

      // Validate grant (not expired, not already used)
      if (!this.deps.grantManager.validateGrant(grant.id)) {
        throw new Error('Grant is invalid, expired, or already consumed')
      }

      // Mark as used BEFORE returning secrets (prevents concurrent requests)
      this.deps.grantManager.markUsed(grant.id)
      this.deps.unlockSession.recordGrantUsage()

      // Return all secret values covered by the grant
      const secrets: Record<string, { uuid: string; ref: string; value: string }> = {}
      for (const uuid of grant.secretUuids) {
        const meta = this.deps.store.getMetadata(uuid)
        const value = this.deps.store.getValue(uuid)
        secrets[uuid] = { uuid, ref: meta.ref, value }
      }

      return { grantId: grant.id, secrets }
    },
  }

  private async runWorkflow(request: AccessRequest): Promise<void> {
    const outcome = await this.deps.workflowEngine.processRequest(request)
    if (outcome === 'approved') {
      try {
        await this.deps.grantManager.createGrant(request)
      } catch (err: unknown) {
        console.error('createGrant failed after workflow approval:', err)
        request.status = 'error'
      }
    }
    this.deps.requestLog.save()
  }

  async inject(
    requestId: string,
    command: string,
    options?: { envVarName?: string },
  ): Promise<ProcessResult> {
    if (!this.deps.unlockSession.isUnlocked()) {
      throw new Error('Store is locked. Run `2kc unlock` first.')
    }
    const grant = this.deps.grantManager.getGrantByRequestId(requestId)
    if (!grant) throw new Error(`No grant found for request: ${requestId}`)
    if (grant.commandHash) {
      if (hashCommand(normalizeCommand(command)) !== grant.commandHash) {
        throw new Error('Command does not match the approved command hash')
      }
    }
    const result = await this.deps.injector.inject(grant.id, ['/bin/sh', '-c', command], options)
    this.deps.unlockSession.recordGrantUsage()
    return result
  }
}

export async function resolveService(config: AppConfig): Promise<Service> {
  if (config.mode === 'client') {
    // No local store needed in client mode - secrets come from server
    // Create a minimal injector for spawning processes with pre-fetched secrets
    const injector = new SecretInjector(null, null)
    return new RemoteService(config.server, { injector })
  }

  const grantsPath = join(dirname(config.store.path), 'server-grants.json')
  const requestsPath = join(dirname(config.store.path), 'server-requests.json')
  const keysPath = join(dirname(config.store.path), 'server-keys.json')
  const { privateKey, publicKey } = await loadOrGenerateKeyPair(keysPath)

  const store = new EncryptedSecretStore(config.store.path)
  const unlockSession = new UnlockSession(config.unlock)
  const sessionLock = new SessionLock(config.unlock)

  // Restore session from disk if a valid session exists
  const savedDek = sessionLock.load()
  if (savedDek) {
    store.restoreUnlocked(savedDek)
    unlockSession.unlock(savedDek)
    sessionLock.touch()
  }

  const grantManager = new GrantManager(grantsPath, privateKey)

  let channel: NotificationChannel
  if (config.discord) {
    channel = new DiscordChannel(config.discord)
  } else if (config.defaultRequireApproval) {
    throw new Error('Discord must be configured when defaultRequireApproval is true')
  } else {
    channel = {
      async sendApprovalRequest() {
        return 'noop'
      },
      async waitForResponse() {
        return 'approved' as const
      },
      async sendNotification() {},
    }
  }

  const workflowEngine = new WorkflowEngine({ store, channel, config })
  const injector = new SecretInjector(grantManager, store)
  const requestLog = new RequestLog(requestsPath)
  const startTime = Date.now()

  return new LocalService({
    store,
    unlockSession,
    sessionLock,
    grantManager,
    workflowEngine,
    injector,
    requestLog,
    startTime,
    bindCommand: config.bindCommand,
    publicKey,
  })
}
