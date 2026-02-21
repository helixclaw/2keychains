export interface SecretEntry {
  uuid: string
  name: string
  value: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface SecretListItem {
  uuid: string
  tags: string[]
}

export interface SecretMetadata {
  uuid: string
  name: string
  tags: string[]
}

export interface SecretsFile {
  secrets: SecretEntry[]
}

/**
 * Legacy AccessRequest shape used by NotificationChannel.
 * The canonical model is in request.ts -- the WorkflowEngine bridges the two.
 */
export interface AccessRequest {
  uuid: string
  requester: string
  justification: string
  durationMs: number
  secretName: string
}

export interface ProcessResult {
  exitCode: number | null
  stdout: string
  stderr: string
}
