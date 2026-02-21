import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { homedir } from 'node:os'

export const PID_FILE_PATH = resolve(homedir(), '.2kc', 'server.pid')
export const LOG_FILE_PATH = resolve(homedir(), '.2kc', 'server.log')

export function writePid(pid: number): void {
  mkdirSync(dirname(PID_FILE_PATH), { recursive: true })
  writeFileSync(PID_FILE_PATH, String(pid))
}

export function readPid(): number | null {
  try {
    const content = readFileSync(PID_FILE_PATH, 'utf-8').trim()
    const pid = parseInt(content, 10)
    if (!Number.isFinite(pid) || pid <= 0) {
      removePidFile()
      return null
    }
    return pid
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw err
  }
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ESRCH') {
      return false
    }
    // EPERM means process exists but we don't have permission
    return true
  }
}

export function removePidFile(): void {
  try {
    unlinkSync(PID_FILE_PATH)
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw err
  }
}

export function getRunningPid(): number | null {
  const pid = readPid()
  if (pid === null) return null

  if (isProcessRunning(pid)) {
    return pid
  }

  // Stale PID file: process is dead, clean up
  removePidFile()
  return null
}
