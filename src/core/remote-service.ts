import { createHash } from 'node:crypto'
import type { ServerConfig } from './config.js'
import type { Service, SecretSummary } from './service.js'
import type { SecretMetadata, ProcessResult } from './types.js'
import type { AccessRequest, AccessRequestStatus } from './request.js'
import type { AccessGrant } from './grant.js'
import type { UnlockSession } from './unlock-session.js'
import type { SecretInjector } from './injector.js'
import { GrantVerifier } from './grant-verifier.js'

export interface RemoteServiceDeps {
  unlockSession?: UnlockSession
  injector?: SecretInjector
}

export class RemoteService implements Service {
  private baseUrl: string
  private authToken: string
  private sessionToken: string | null = null
  private grantVerifier: GrantVerifier
  private deps: RemoteServiceDeps

  constructor(serverConfig: ServerConfig, deps: RemoteServiceDeps = {}) {
    const host = serverConfig.host
    const port = serverConfig.port

    if (!serverConfig.authToken) {
      throw new Error('server.authToken is required for client mode')
    }
    this.authToken = serverConfig.authToken
    this.baseUrl = `http://${host}:${port}`
    this.grantVerifier = new GrantVerifier(this.baseUrl, this.authToken)
    this.deps = deps
  }

  private async login(): Promise<void> {
    const url = `${this.baseUrl}/api/auth/login`
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this.authToken }),
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

    if (!response.ok) {
      this.sessionToken = null
      return
    }

    const body = (await response.json().catch(() => null)) as {
      token?: string
      sessionToken?: string
    } | null
    this.sessionToken = body?.token ?? body?.sessionToken ?? null
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    isRetry = false,
  ): Promise<T> {
    // Auto-login on first request if no session token
    if (this.sessionToken === null && !isRetry) {
      await this.login()
    }

    const url = `${this.baseUrl}${path}`
    const authValue =
      this.sessionToken !== null ? `Bearer ${this.sessionToken}` : `Bearer ${this.authToken}`

    const headers: Record<string, string> = {
      Authorization: authValue,
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
      if (!isRetry) {
        // Session expired or rejected — re-login and retry once
        this.sessionToken = null
        await this.login()
        return this.request<T>(method, path, body, true)
      }
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

  keys: Service['keys'] = {
    getPublicKey: () =>
      this.request<{ publicKey: string }>('GET', '/api/keys/public').then((r) => r.publicKey),
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
    getStatus: (requestId: string) =>
      this.request<{ status: AccessRequestStatus; grant?: AccessGrant; jws?: string }>(
        'GET',
        `/api/grants/${encodeURIComponent(requestId)}`,
      ),
  }

  async inject(
    requestId: string,
    command: string,
    options?: { envVarName?: string },
  ): Promise<ProcessResult> {
    // 0. Check deps
    if (!this.deps.unlockSession) {
      throw new Error('unlockSession not configured')
    }

    // 1. Fetch signed grant JWS from server
    const jwsToken = await this.request<string>(
      'GET',
      `/api/grants/${encodeURIComponent(requestId)}/signed`,
    )

    // 2. Verify JWS signature + expiry, binding to this command's hash
    const commandHash = createHash('sha256').update(command).digest('hex')
    const grantPayload = await this.grantVerifier.verifyGrant(jwsToken, commandHash)

    // 3. Check that local store is unlocked
    if (!this.deps.unlockSession.isUnlocked()) {
      throw new Error('Local store is locked. Run `2kc unlock` before requesting secrets.')
    }

    if (!this.deps.injector) {
      throw new Error('Injector not available in client mode')
    }

    // 4. Inject locally using the SecretInjector with the grant ID from the payload
    const result = await this.deps.injector.inject(
      grantPayload.grantId,
      ['/bin/sh', '-c', command],
      options,
    )

    // 5. Record grant usage
    this.deps.unlockSession?.recordGrantUsage()

    return result
  }
}
