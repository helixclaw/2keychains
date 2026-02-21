import { Command } from 'commander'
import { randomBytes } from 'node:crypto'
import { fork } from 'node:child_process'
import http from 'node:http'
import { resolve, dirname } from 'node:path'
import { openSync, closeSync, mkdirSync } from 'node:fs'

import { loadConfig } from '../core/config.js'
import { writePid, getRunningPid, removePidFile, LOG_FILE_PATH } from '../core/pid-manager.js'

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

server
  .command('start')
  .description('Start the server daemon')
  .option('--foreground', 'Run in foreground (no fork)', false)
  .action(async (opts: { foreground: boolean }) => {
    const config = loadConfig()
    const existingPid = getRunningPid()
    if (existingPid) {
      console.error(`Server already running (PID ${String(existingPid)})`)
      process.exitCode = 1
      return
    }

    if (opts.foreground) {
      await import('../core/server-entry.js')
      return
    }

    // Fork the server-entry as detached process
    mkdirSync(dirname(LOG_FILE_PATH), { recursive: true })
    const logFd = openSync(LOG_FILE_PATH, 'a')
    const entryPoint = resolve(import.meta.dirname, '../core/server-entry.js')
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
    child.disconnect()
    child.unref()
    closeSync(logFd)

    // Brief wait + health check
    await new Promise((r) => setTimeout(r, 1000))

    try {
      await healthCheck(config.server.host, config.server.port)
      console.log(
        `Server started on ${config.server.host}:${String(config.server.port)} (PID ${String(childPid)})`,
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
    const config = loadConfig()
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
