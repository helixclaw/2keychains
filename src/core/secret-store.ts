import { v4 as uuidv4 } from 'uuid'
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

import type { SecretEntry, SecretListItem, SecretMetadata, SecretsFile } from './types.js'

const DEFAULT_PATH = join(homedir(), '.2kc', 'secrets.json')

export class SecretStore {
  private readonly filePath: string

  constructor(filePath: string = DEFAULT_PATH) {
    this.filePath = filePath
  }

  private load(): SecretEntry[] {
    if (!existsSync(this.filePath)) {
      return []
    }
    const data = readFileSync(this.filePath, 'utf-8')
    try {
      const file = JSON.parse(data) as SecretsFile
      return file.secrets
    } catch {
      throw new Error(`Failed to parse secrets file at ${this.filePath}. File may be corrupted.`)
    }
  }

  private findEntry(uuid: string): SecretEntry {
    const secrets = this.load()
    const entry = secrets.find((s) => s.uuid === uuid)
    if (!entry) {
      throw new Error(`Secret with UUID ${uuid} not found`)
    }
    return entry
  }

  private save(secrets: SecretEntry[]): void {
    const dir = dirname(this.filePath)
    mkdirSync(dir, { recursive: true })
    const file: SecretsFile = { secrets }
    writeFileSync(this.filePath, JSON.stringify(file, null, 2), 'utf-8')
    chmodSync(this.filePath, 0o600)
  }

  add(name: string, value: string, tags: string[] = []): string {
    const secrets = this.load()
    const existing = secrets.find((s) => s.name === name)
    if (existing) {
      throw new Error(`A secret with the name "${name}" already exists`)
    }
    const uuid = uuidv4()
    const now = new Date().toISOString()
    const entry: SecretEntry = {
      uuid,
      name,
      value,
      tags,
      createdAt: now,
      updatedAt: now,
    }
    secrets.push(entry)
    this.save(secrets)
    return uuid
  }

  remove(uuid: string): boolean {
    this.findEntry(uuid)
    const secrets = this.load()
    const filtered = secrets.filter((s) => s.uuid !== uuid)
    this.save(filtered)
    return true
  }

  list(): SecretListItem[] {
    const secrets = this.load()
    return secrets.map((s) => ({ uuid: s.uuid, tags: s.tags }))
  }

  getMetadata(uuid: string): SecretMetadata {
    const entry = this.findEntry(uuid)
    return { uuid: entry.uuid, name: entry.name, tags: entry.tags }
  }

  getValue(uuid: string): string {
    const entry = this.findEntry(uuid)
    return entry.value
  }
}
