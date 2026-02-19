import { randomUUID } from 'node:crypto'

export type AccessRequestStatus = 'pending' | 'approved' | 'denied' | 'expired'

export interface AccessRequest {
  id: string
  secretUuid: string
  reason: string
  taskRef: string
  durationSeconds: number
  requestedAt: string
  status: AccessRequestStatus
}

const MIN_DURATION_SECONDS = 30
const MAX_DURATION_SECONDS = 3600
const DEFAULT_DURATION_SECONDS = 300

export function createAccessRequest(
  secretUuid: string,
  reason: string,
  taskRef: string,
  durationSeconds: number = DEFAULT_DURATION_SECONDS,
): AccessRequest {
  if (!secretUuid || secretUuid.trim().length === 0) {
    throw new Error('secretUuid is required and must not be empty')
  }

  if (!reason || reason.trim().length === 0) {
    throw new Error('reason is required and must not be empty')
  }

  if (!taskRef || taskRef.trim().length === 0) {
    throw new Error('taskRef is required and must not be empty')
  }

  if (durationSeconds < MIN_DURATION_SECONDS) {
    throw new Error(
      `durationSeconds must be at least ${MIN_DURATION_SECONDS}, got ${durationSeconds}`,
    )
  }

  if (durationSeconds > MAX_DURATION_SECONDS) {
    throw new Error(
      `durationSeconds must be at most ${MAX_DURATION_SECONDS}, got ${durationSeconds}`,
    )
  }

  return {
    id: randomUUID(),
    secretUuid,
    reason,
    taskRef,
    durationSeconds,
    requestedAt: new Date().toISOString(),
    status: 'pending',
  }
}

export class RequestLog {
  private requests: AccessRequest[] = []

  add(request: AccessRequest): void {
    this.requests.push(request)
  }

  getAll(): ReadonlyArray<AccessRequest> {
    return [...this.requests]
  }

  getBySecretUuid(secretUuid: string): ReadonlyArray<AccessRequest> {
    return this.requests.filter((r) => r.secretUuid === secretUuid)
  }

  getById(id: string): AccessRequest | undefined {
    return this.requests.find((r) => r.id === id)
  }

  get size(): number {
    return this.requests.length
  }
}
