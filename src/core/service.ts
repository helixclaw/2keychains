import type { AppConfig } from './config.js'
import type { SecretListItem, SecretMetadata, ProcessResult } from './types.js'
import type { AccessRequest } from './request.js'
import { RemoteService } from './remote-service.js'

// SecretSummary aliases existing SecretListItem shape
export type SecretSummary = SecretListItem

export interface Service {
  health(): Promise<{ status: string; uptime?: number }>

  secrets: {
    list(): Promise<SecretSummary[]>
    add(name: string, value: string, tags?: string[]): Promise<{ uuid: string }>
    remove(uuid: string): Promise<void>
    getMetadata(uuid: string): Promise<SecretMetadata>
  }

  requests: {
    create(
      secretUuid: string,
      reason: string,
      taskRef: string,
      duration?: number,
    ): Promise<AccessRequest>
  }

  grants: {
    validate(requestId: string): Promise<boolean>
  }

  inject(requestId: string, envVarName: string, command: string): Promise<ProcessResult>
}

function notImplemented(): never {
  throw new Error('not implemented')
}

export class LocalService implements Service {
  async health(): Promise<{ status: string; uptime?: number }> {
    notImplemented()
  }

  secrets: Service['secrets'] = {
    async list() {
      notImplemented()
    },
    async add() {
      notImplemented()
    },
    async remove() {
      notImplemented()
    },
    async getMetadata() {
      notImplemented()
    },
  }

  requests: Service['requests'] = {
    async create() {
      notImplemented()
    },
  }

  grants: Service['grants'] = {
    async validate() {
      notImplemented()
    },
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async inject(requestId: string, envVarName: string, command: string): Promise<ProcessResult> {
    notImplemented()
  }
}

export function resolveService(config: AppConfig): Service {
  if (config.mode === 'client') {
    return new RemoteService(config.server)
  }
  return new LocalService()
}
