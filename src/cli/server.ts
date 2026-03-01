import { Command } from 'commander'
import { randomBytes } from 'node:crypto'
import { fork, type ChildProcess } from 'node:child_process'
import http from 'node:http'
import { resolve, dirname } from 'node:path'
import { openSync, closeSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { getConfig } from '../core/config.js'
import { resolveService, LocalService } from '../core/service.js'
import { writePid, getRunningPid, removePidFile, LOG_FILE_PATH } from '../core/pid-manager.js'
import { promptPassword } from './password-prompt.js'

const server = new Command('server').description('Manage the 2kc server daemon')

function healthCheck(
  host: string,
  port: number,
): Promise<{ status: string; pid: number; uptime: number }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://${host}:${port}/health`, { timeout: 3000 }, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString()
      })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data) as { status: string; pid: number; uptime: number })
        } catch {
          reject(new Error('Invalid health response'))
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Health check timed out'))
    })
  })
}

function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now()
    const interval = setInterval(() => {
      try {
        process.kill(pid, 0)
      } catch {
        clearInterval(interval)
        resolve(true)
        return
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(interval)
        resolve(false)
      }
    }, 100)
  })
}

interface UnlockIpcMessage {
  type: 'unlock'
  password: string
}

interface UnlockResultIpcMessage {
  type: 'unlock-result'
  success: boolean
  error?: string
}

interface ReadyIpcMessage {
  type: 'ready'
}

type IpcMessage = UnlockIpcMessage | UnlockResultIpcMessage | ReadyIpcMessage

function sendUnlockViaIpc(child: ChildProcess, password: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    let ready = false

    const cleanup = () => {
      clearTimeout(timeout)
      child.removeListener('message', onMessage)
      child.removeListener('error', onError)
      child.removeListener('exit', onExit)
    }

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        cleanup()
        reject(new Error('IPC unlock timed out'))
      }
    }, timeoutMs)

    const onMessage = (msg: IpcMessage) => {
      if (msg.type === 'ready' && !ready) {
        ready = true
        // Server is ready, now send the unlock message
        child.send({ type: 'unlock', password } as UnlockIpcMessage)
      } else if (msg.type === 'unlock-result') {
        if (!settled) {
          settled = true
          cleanup()
          if (msg.success) {
            resolve()
          } else {
            reject(new Error(msg.error ?? 'Unlock failed'))
          }
        }
      }
    }

    const onError = (err: Error) => {
      if (!settled) {
        settled = true
        cleanup()
        reject(new Error(`Child process error: ${err.message}`))
      }
    }

    const onExit = (code: number | null) => {
      if (!settled) {
        settled = true
        cleanup()
        reject(new Error(`Server exited with code ${code} before unlock completed`))
      }
    }

    child.on('message', onMessage)
    child.on('error', onError)
    child.on('exit', onExit)
  })
}

server
  .command('start')
  .description('Start the server daemon')
  .option('--foreground', 'Run in foreground (no fork)', false)
  .option(
    '--unlock',
    'Start with store unlocked (stays unlocked until server stops, no file persistence)',
    false,
  )
  .action(async (opts: { foreground: boolean; unlock: boolean }) => {
    const config = getConfig()
    const existingPid = getRunningPid()
    if (existingPid) {
      console.error(`Server already running (PID ${String(existingPid)})`)
      process.exitCode = 1
      return
    }

    // Validate --unlock flag
    if (opts.unlock) {
      if (config.mode === 'client') {
        console.error('Error: --unlock is not supported in client mode.')
        process.exitCode = 1
        return
      }

      if (!existsSync(config.store.path)) {
        console.error('Error: Encrypted store not found. Run store initialization first.')
        process.exitCode = 1
        return
      }
    }

    // Get password for unlock
    let password: string | undefined
    if (opts.unlock) {
      password = process.env['2KC_UNLOCK_PASSWORD'] ?? (await promptPassword())
    }

    if (opts.foreground) {
      // For foreground with --unlock, we need to start the server ourselves
      // and unlock using the service
      if (opts.unlock && password !== undefined) {
        const service = (await resolveService(config)) as LocalService
        try {
          await service.unlock(password, { serverMode: true })
        } catch {
          console.error('Incorrect password.')
          process.exitCode = 1
          return
        }
        const { startServer } = await import('../server/app.js')
        await startServer(config, service)
      } else {
        await import('../server/index.js')
      }
      return
    }

    // Fork the server-entry as detached process
    mkdirSync(dirname(LOG_FILE_PATH), { recursive: true })
    const logFd = openSync(LOG_FILE_PATH, 'a')
    const __dirname = dirname(fileURLToPath(import.meta.url))
    const entryPoint = resolve(__dirname, '../server/index.js')
    const child = fork(entryPoint, [], {
      detached: true,
      stdio: ['ignore', logFd, logFd, 'ipc'],
    })

    const childPid = child.pid
    if (childPid === undefined) {
      console.error('Failed to start server process')
      closeSync(logFd)
      process.exitCode = 1
      return
    }

    writePid(childPid)

    // If --unlock, send password via IPC before detaching
    if (opts.unlock && password !== undefined) {
      try {
        await sendUnlockViaIpc(child, password, 10_000)
      } catch (err) {
        console.error(`Failed to unlock: ${err instanceof Error ? err.message : String(err)}`)
        try {
          process.kill(childPid, 'SIGTERM')
        } catch {
          // Process may have already exited
        }
        removePidFile()
        closeSync(logFd)
        process.exitCode = 1
        return
      }
    }

    child.disconnect()
    child.unref()
    closeSync(logFd)

    // Brief wait + health check
    await new Promise((r) => setTimeout(r, 1000))

    try {
      await healthCheck(config.server.host, config.server.port)
      const unlockStatus = opts.unlock ? ' (unlocked)' : ''
      console.log(
        `Server started on ${config.server.host}:${String(config.server.port)} (PID ${String(childPid)})${unlockStatus}`,
      )
    } catch {
      console.error(`Server process started (PID ${String(childPid)}) but health check failed.`)
      console.error(`Check logs at ${LOG_FILE_PATH}`)
      try {
        process.kill(childPid, 'SIGTERM')
      } catch {
        // Process may have already exited
      }
      removePidFile()
      process.exitCode = 1
    }
  })

server
  .command('stop')
  .description('Stop the server daemon')
  .action(async () => {
    const pid = getRunningPid()
    if (!pid) {
      console.log('Server is not running')
      return
    }

    try {
      process.kill(pid, 'SIGTERM')
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && err.code === 'ESRCH') {
        removePidFile()
        console.log(`Server already stopped (PID ${String(pid)}), cleaned up stale PID file`)
        return
      }
      throw err
    }

    const exited = await waitForExit(pid, 5000)
    if (exited) {
      removePidFile()
      console.log(`Server stopped (PID ${String(pid)})`)
    } else {
      console.error(`Server (PID ${String(pid)}) did not stop within 5 seconds`)
      process.exitCode = 1
    }
  })

server
  .command('status')
  .description('Show server daemon status')
  .action(async () => {
    const config = getConfig()
    const pid = getRunningPid()
    if (!pid) {
      console.log('Server is not running')
      return
    }

    try {
      const health = await healthCheck(config.server.host, config.server.port)
      console.log(
        `Server running on ${config.server.host}:${String(config.server.port)} (PID ${String(pid)}), uptime: ${String(Math.floor(health.uptime))}s`,
      )
    } catch {
      console.log(
        `Server running (PID ${String(pid)}) but not responding on ${config.server.host}:${String(config.server.port)}`,
      )
    }
  })

const token = new Command('token').description('Manage server authentication tokens')

token
  .command('generate')
  .description('Generate a random 32-byte hex token for server authentication')
  .action(() => {
    console.log(randomBytes(32).toString('hex'))
  })

server.addCommand(token)

export { server as serverCommand }
