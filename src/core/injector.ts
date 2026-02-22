import { spawn } from 'node:child_process'
import type { GrantManager } from './grant.js'
import type { SecretStore } from './secret-store.js'
import type { ProcessResult } from './types.js'

export interface InjectOptions {
  timeoutMs?: number
  envVarName?: string
}

const DEFAULT_TIMEOUT_MS = 30_000
export const MAX_BUFFER_BYTES = 10 * 1024 * 1024 // 10 MB

const PLACEHOLDER_RE = /^2k:\/\/(.+)$/

export class SecretInjector {
  constructor(
    private readonly grantManager: GrantManager,
    private readonly secretStore: SecretStore,
  ) {}

  async inject(
    grantId: string,
    command: string[],
    options?: InjectOptions,
  ): Promise<ProcessResult> {
    if (command.length === 0) {
      throw new Error('Command must not be empty')
    }

    // 1. Validate grant -- reject immediately if invalid/expired
    if (!this.grantManager.validateGrant(grantId)) {
      throw new Error(`Grant is not valid: ${grantId}`)
    }

    // 2. Get grant to retrieve secretUuids
    const grant = this.grantManager.getGrant(grantId)
    if (!grant) {
      throw new Error(`Grant not found: ${grantId}`)
    }

    // 3. Build env object
    const env: Record<string, string> = {}
    for (const [key, val] of Object.entries(process.env)) {
      if (val !== undefined) {
        env[key] = val
      }
    }

    // 4. If envVarName is provided, inject the first secret explicitly (existing behavior)
    if (options?.envVarName) {
      if (grant.secretUuids.length === 0) {
        throw new Error('Grant has no secret UUIDs')
      }
      const secretValue = this.secretStore.getValue(grant.secretUuids[0])
      if (secretValue === null) {
        throw new Error(`Secret value not found for UUID: ${grant.secretUuids[0]}`)
      }
      env[options.envVarName] = secretValue
    }

    // 5. Scan and replace 2k:// placeholders
    const finalEnv = this.scanAndReplace(env, grant.secretUuids)

    try {
      // 6. Spawn child process with built env
      return await this.spawnProcess(command, finalEnv, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    } finally {
      try {
        this.grantManager.markUsed(grantId)
      } catch {
        // Grant may already be expired/revoked -- cleanup still completed
      }
    }
  }

  private scanAndReplace(
    env: Record<string, string>,
    allowedSecretUuids: string[],
  ): Record<string, string> {
    const result = { ...env }
    for (const [key, value] of Object.entries(result)) {
      const match = PLACEHOLDER_RE.exec(value)
      if (match) {
        const ref = match[1]
        const resolved = this.secretStore.resolveRef(ref)
        if (!allowedSecretUuids.includes(resolved.uuid)) {
          throw new Error(
            `Placeholder 2k://${ref} in ${key} references secret ${resolved.uuid} which is not covered by the grant`,
          )
        }
        result[key] = resolved.value
      }
    }
    return result
  }

  private spawnProcess(
    command: string[],
    env: Record<string, string>,
    timeoutMs: number,
  ): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const [cmd, ...args] = command
      const child = spawn(cmd, args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''
      let stdoutBytes = 0
      let stderrBytes = 0
      let timedOut = false
      let bufferExceeded = false

      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
      }, timeoutMs)

      child.stdout.on('data', (data: Buffer) => {
        stdoutBytes += data.length
        if (stdoutBytes > MAX_BUFFER_BYTES) {
          bufferExceeded = true
          child.kill('SIGKILL')
          return
        }
        stdout += data.toString()
      })

      child.stderr.on('data', (data: Buffer) => {
        stderrBytes += data.length
        if (stderrBytes > MAX_BUFFER_BYTES) {
          bufferExceeded = true
          child.kill('SIGKILL')
          return
        }
        stderr += data.toString()
      })

      child.on('error', (err: Error) => {
        clearTimeout(timer)
        reject(new Error(`Spawn failure: ${err.message}`))
      })

      child.on('close', (exitCode: number | null) => {
        clearTimeout(timer)
        if (timedOut) {
          reject(new Error(`Process timed out after ${timeoutMs}ms`))
          return
        }
        if (bufferExceeded) {
          reject(new Error(`Process killed: output exceeded ${MAX_BUFFER_BYTES} byte buffer limit`))
          return
        }
        resolve({ exitCode, stdout, stderr })
      })
    })
  }
}
