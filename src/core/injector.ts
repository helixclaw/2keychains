import { spawn } from 'node:child_process'
import type { GrantManager } from './grant.js'
import type { SecretStore } from './secret-store.js'
import type { ProcessResult } from './types.js'

export interface InjectOptions {
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000
export const MAX_BUFFER_BYTES = 10 * 1024 * 1024 // 10 MB

export class SecretInjector {
  constructor(
    private readonly grantManager: GrantManager,
    private readonly secretStore: SecretStore,
  ) {}

  async inject(
    grantId: string,
    envVarName: string,
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

    // 3. Fetch secret value (batch injection is a separate issue; use first UUID)
    if (grant.secretUuids.length > 1) {
      console.warn(
        'Warning: Grant covers multiple secrets but only the first will be injected. Batch injection is not yet supported.',
      )
    }
    let secretValue: string | null = this.secretStore.getValue(grant.secretUuids[0])

    if (secretValue === null) {
      throw new Error(`Secret value not found for UUID: ${grant.secretUuids[0]}`)
    }

    try {
      // 4. Spawn child process with secret in env
      return await this.spawnProcess(
        command,
        envVarName,
        secretValue,
        options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      )
    } finally {
      // 6. Clear local JS reference only -- does not scrub memory.
      //    V8 GC handles actual deallocation (see issue scope boundaries).
      secretValue = null
      try {
        this.grantManager.markUsed(grantId)
      } catch {
        // Grant may already be expired/revoked -- cleanup still completed
      }
    }
  }

  private spawnProcess(
    command: string[],
    envVarName: string,
    secretValue: string,
    timeoutMs: number,
  ): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const [cmd, ...args] = command
      const child = spawn(cmd, args, {
        env: { ...process.env, [envVarName]: secretValue },
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
