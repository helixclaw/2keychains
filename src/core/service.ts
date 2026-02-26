import { join, dirname } from 'node:path'
import type { AppConfig } from './config.js'
import type { SecretListItem, SecretMetadata, ProcessResult } from './types.js'
import type { AccessRequest } from './request.js'
import { createAccessRequest, RequestLog } from './request.js'
import type { NotificationChannel } from '../channels/channel.js'
import { RemoteService } from './remote-service.js'
import { EncryptedSecretStore } from './encrypted-store.js'
import { UnlockSession } from './unlock-session.js'
import { GrantManager } from './grant.js'
import { normalizeCommand, hashCommand } from './command-hash.js'
import { WorkflowEngine } from './workflow.js'
import { SecretInjector } from './injector.js'
import { DiscordChannel } from '../channels/discord.js'
import { loadOrGenerateKeyPair } from './key-manager.js'

// SecretSummary aliases existing SecretListItem shape
export type SecretSummary = SecretListItem

export interface Service {
  health(): Promise<{ status: string; uptime?: number }>

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
    validate(requestId: string): Promise<boolean>
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
  grantManager: GrantManager
  workflowEngine: WorkflowEngine
  injector: SecretInjector
  requestLog: RequestLog
  startTime: number
  bindCommand: boolean
}

export class LocalService implements Service {
  private readonly onLocked: () => void

  constructor(private readonly deps: LocalServiceDeps) {
    // When session auto-locks (TTL/idle/max-grants), also lock the encrypted store
    this.onLocked = () => deps.store.lock()
    deps.unlockSession.on('locked', this.onLocked)
  }

  destroy(): void {
    this.deps.unlockSession.off('locked', this.onLocked)
  }

  // Called by `2kc unlock` CLI command — not on the Service interface
  async unlock(password: string): Promise<void> {
    await this.deps.store.unlock(password)
    const dek = this.deps.store.getDek()
    if (!dek) throw new Error('Failed to obtain DEK after unlock')
    this.deps.unlockSession.unlock(dek)
  }

  // Called by `2kc lock` CLI command — not on the Service interface
  lock(): void {
    this.deps.unlockSession.lock()
    // EncryptedSecretStore.lock() is called via the 'locked' event handler above
  }

  async health(): Promise<{ status: string; uptime?: number }> {
    return {
      status: this.deps.unlockSession.isUnlocked() ? 'unlocked' : 'locked',
      uptime: Date.now() - this.deps.startTime,
    }
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
      const outcome = await this.deps.workflowEngine.processRequest(request)
      if (outcome === 'approved') {
        await this.deps.grantManager.createGrant(request)
      }
      return request
    },
  }

  grants: Service['grants'] = {
    validate: async (requestId) => {
      const grant = this.deps.grantManager.getGrantByRequestId(requestId)
      if (!grant) return false
      return this.deps.grantManager.validateGrant(grant.id)
    },
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
    return new RemoteService(config.server)
  }

  const grantsPath = join(dirname(config.store.path), 'grants.json')
  const keysPath = join(dirname(config.store.path), 'server-keys.json')
  const { privateKey } = await loadOrGenerateKeyPair(keysPath)

  const store = new EncryptedSecretStore(config.store.path)
  const unlockSession = new UnlockSession(config.unlock)
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
  const requestLog = new RequestLog()
  const startTime = Date.now()

  return new LocalService({
    store,
    unlockSession,
    grantManager,
    workflowEngine,
    injector,
    requestLog,
    startTime,
    bindCommand: config.bindCommand,
  })
}
