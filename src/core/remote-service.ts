import type { ServerConfig } from './config.js'
import type { Service, SecretSummary } from './service.js'
import type { SecretMetadata, ProcessResult } from './types.js'
import type { AccessRequest } from './request.js'

export class RemoteService implements Service {
  private baseUrl: string
  private authToken: string

  constructor(serverConfig: ServerConfig) {
    const host = serverConfig.host
    const port = serverConfig.port

    if (!serverConfig.authToken) {
      throw new Error('server.authToken is required for client mode')
    }
    this.authToken = serverConfig.authToken
    this.baseUrl = `http://${host}:${port}`
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.authToken}`,
    }

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
    }

    let response: Response
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      })
    } catch (err: unknown) {
      if (err instanceof TypeError) {
        throw new Error('Server not running. Start with `2kc server start`')
      }
      if (err instanceof DOMException || (err instanceof Error && err.name === 'TimeoutError')) {
        throw new Error('Request timed out after 30s. Is the server responding?')
      }
      throw err
    }

    if (response.status === 401) {
      throw new Error('Authentication failed. Check authToken in config')
    }

    if (!response.ok) {
      let message = `Server error: ${response.status} ${response.statusText}`
      try {
        const errorBody = (await response.json()) as { error?: string }
        if (errorBody.error) {
          message = errorBody.error
        }
      } catch {
        // ignore JSON parse failures, use default message
      }
      throw new Error(message)
    }

    // For 204 No Content (e.g., DELETE), return undefined as T
    if (response.status === 204) {
      return undefined as T
    }

    return (await response.json()) as T
  }

  async health() {
    return this.request<{ status: string; uptime?: number }>('GET', '/health')
  }

  secrets: Service['secrets'] = {
    list: () => this.request<SecretSummary[]>('GET', '/api/secrets'),
    add: (ref: string, value: string, tags?: string[]) =>
      this.request<{ uuid: string }>('POST', '/api/secrets', { ref, value, tags }),
    remove: (uuid: string) =>
      this.request<void>('DELETE', `/api/secrets/${encodeURIComponent(uuid)}`),
    getMetadata: (uuid: string) =>
      this.request<SecretMetadata>('GET', `/api/secrets/${encodeURIComponent(uuid)}`),
    resolve: (refOrUuid: string) =>
      this.request<SecretMetadata>('GET', `/api/secrets/resolve/${encodeURIComponent(refOrUuid)}`),
  }

  requests: Service['requests'] = {
    create: (secretUuids: string[], reason: string, taskRef: string, duration?: number) =>
      this.request<AccessRequest>('POST', '/api/requests', {
        secretUuids,
        reason,
        taskRef,
        duration,
      }),
  }

  grants: Service['grants'] = {
    validate: (requestId: string) =>
      this.request<boolean>('GET', `/api/grants/${encodeURIComponent(requestId)}`),
  }

  async inject(requestId: string, envVarName: string, command: string): Promise<ProcessResult> {
    return this.request<ProcessResult>('POST', '/api/inject', {
      requestId,
      envVarName,
      command,
    })
  }
}
