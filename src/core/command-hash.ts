import { createHash } from 'node:crypto'

export function normalizeCommand(cmd: string): string {
  const normalized = cmd.trim().replace(/\s+/g, ' ').toLowerCase()
  if (normalized.length === 0) {
    throw new Error('command must not be empty')
  }
  return normalized
}

export function hashCommand(normalizedCmd: string): string {
  return createHash('sha256').update(normalizedCmd).digest('hex')
}
