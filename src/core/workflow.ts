import type { NotificationChannel } from '../channels/channel.js'
import type { AccessRequest } from './request.js'
import type { AccessRequest as ChannelAccessRequest } from './types.js'
import type { SecretStore } from './secret-store.js'
import type { SecretMetadata } from './types.js'
import type { AppConfig } from './config.js'

export interface WorkflowDeps {
  store: SecretStore
  channel: NotificationChannel
  config: Pick<AppConfig, 'requireApproval' | 'defaultRequireApproval' | 'approvalTimeoutMs'>
}

function needsApproval(
  tags: string[],
  config: Pick<AppConfig, 'requireApproval' | 'defaultRequireApproval'>,
): boolean {
  for (const tag of tags) {
    const entry = config.requireApproval[tag]
    if (entry === true) return true
    if (entry === false) return false
  }

  return config.defaultRequireApproval
}

function toChannelRequest(request: AccessRequest, metadata: SecretMetadata): ChannelAccessRequest {
  return {
    uuid: request.secretUuid,
    // In the current single-agent design, all secret access requests originate
    // from the AI agent, so 'agent' is always the correct requester identity.
    requester: 'agent',
    justification: request.reason,
    durationMs: request.durationSeconds * 1000,
    secretName: metadata.name,
  }
}

export class WorkflowEngine {
  private store: SecretStore
  private channel: NotificationChannel
  private config: WorkflowDeps['config']

  constructor(deps: WorkflowDeps) {
    this.store = deps.store
    this.channel = deps.channel
    this.config = deps.config
  }

  async processRequest(request: AccessRequest): Promise<'approved' | 'denied' | 'timeout'> {
    try {
      const metadata = await this.store.getMetadata(request.secretUuid)

      if (!needsApproval(metadata.tags, this.config)) {
        request.status = 'approved'
        return 'approved'
      }

      const channelRequest = toChannelRequest(request, metadata)
      const messageId = await this.channel.sendApprovalRequest(channelRequest)
      const result = await this.channel.waitForResponse(messageId, this.config.approvalTimeoutMs)

      request.status = result
      return result
    } catch (error) {
      request.status = 'denied'
      throw error
    }
  }
}
