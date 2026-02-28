import { v4 as uuidv4 } from 'uuid'
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CONFIG_DIR } from './config.js'

import type { SecretListItem, SecretMetadata } from './types.js'
import type { ISecretStore } from './secret-store.js'
import type { EncryptedValue } from './crypto.js'
import { generateDek, buildAad, encryptValue, decryptValue, wrapDek, unwrapDek } from './crypto.js'
import { deriveKek, generateSalt, DEFAULT_SCRYPT_PARAMS } from './kdf.js'
import type { ScryptParams } from './kdf.js'

const DEFAULT_PATH = join(CONFIG_DIR, 'secrets.enc.json')

const REF_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** On-disk format for an encrypted secret entry. */
export interface EncryptedSecretEntry {
  uuid: string
  ref: string
  tags: string[]
  encryptedValue: EncryptedValue
  createdAt: string
  updatedAt: string
}

/** On-disk format for the encrypted store file. */
export interface EncryptedStoreFile {
  version: 1
  kdf: {
    algorithm: 'scrypt'
    salt: string // base64
    params: ScryptParams
  }
  wrappedDek: EncryptedValue
  secrets: EncryptedSecretEntry[]
}

export class EncryptedSecretStore implements ISecretStore {
  private readonly filePath: string
  private dek: Buffer | null = null

  constructor(filePath: string = DEFAULT_PATH) {
    this.filePath = filePath
  }

  /** Whether the store is currently unlocked (DEK available in memory). */
  get isUnlocked(): boolean {
    return this.dek !== null
  }

  /** Returns a copy of the DEK currently held in memory, or null if locked. */
  getDek(): Buffer | null {
    if (!this.dek) return null
    return Buffer.from(this.dek) // return a copy to prevent callers from zeroing internal buffer
  }

  /** Lock the store by discarding the DEK from memory. */
  lock(): void {
    if (this.dek) {
      // Zero out the buffer before discarding
      this.dek.fill(0)
      this.dek = null
    }
  }

  /** Restore unlocked state from a previously saved DEK (from session persistence). */
  restoreUnlocked(dek: Buffer): void {
    this.dek = Buffer.from(dek)
  }

  /**
   * Initialize a new encrypted store with a password.
   * Creates the file with an empty secrets array.
   */
  async initialize(password: string, params: ScryptParams = DEFAULT_SCRYPT_PARAMS): Promise<void> {
    if (existsSync(this.filePath)) {
      throw new Error(`Store file already exists at ${this.filePath}`)
    }

    const salt = generateSalt()
    const kek = await deriveKek(password, salt, params)
    const dek = generateDek()
    const wrapped = wrapDek(kek, dek)

    const store: EncryptedStoreFile = {
      version: 1,
      kdf: {
        algorithm: 'scrypt',
        salt: salt.toString('base64'),
        params,
      },
      wrappedDek: wrapped,
      secrets: [],
    }

    this.save(store)
    this.dek = dek
  }

  /**
   * Unlock the store by deriving the KEK from a password and unwrapping the DEK.
   */
  async unlock(password: string): Promise<void> {
    const store = this.load()
    const salt = Buffer.from(store.kdf.salt, 'base64')
    const kek = await deriveKek(password, salt, store.kdf.params)

    try {
      this.dek = unwrapDek(
        kek,
        store.wrappedDek.ciphertext,
        store.wrappedDek.nonce,
        store.wrappedDek.tag,
      )
    } catch {
      throw new Error('Failed to unlock store: incorrect password or corrupted data')
    }
  }

  private requireUnlocked(): Buffer {
    if (!this.dek) {
      throw new Error('Store is locked. Call unlock() first.')
    }
    return this.dek
  }

  private load(): EncryptedStoreFile {
    if (!existsSync(this.filePath)) {
      throw new Error(`Encrypted store not found at ${this.filePath}. Run initialize() first.`)
    }
    const data = readFileSync(this.filePath, 'utf-8')
    try {
      const file = JSON.parse(data) as EncryptedStoreFile
      if (file.version !== 1) {
        throw new Error(`Unsupported store version: ${file.version}`)
      }
      return file
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Unsupported store version')) throw err
      throw new Error(`Failed to parse encrypted store at ${this.filePath}. File may be corrupted.`)
    }
  }

  private save(store: EncryptedStoreFile): void {
    const dir = dirname(this.filePath)
    mkdirSync(dir, { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(store, null, 2), 'utf-8')
    chmodSync(this.filePath, 0o600)
  }

  private validateRef(ref: string): void {
    if (!REF_PATTERN.test(ref)) {
      throw new Error(
        `Invalid ref "${ref}". Must be a lowercase alphanumeric slug (a-z, 0-9, hyphens) with no leading or trailing hyphens.`,
      )
    }
    if (UUID_PATTERN.test(ref)) {
      throw new Error(`Invalid ref "${ref}". Refs must not look like UUIDs.`)
    }
  }

  add(ref: string, value: string, tags: string[] = []): string {
    const dek = this.requireUnlocked()
    this.validateRef(ref)

    const store = this.load()
    const existing = store.secrets.find((s) => s.ref === ref)
    if (existing) {
      throw new Error(`A secret with the ref "${ref}" already exists`)
    }

    const uuid = uuidv4()
    const now = new Date().toISOString()
    const aad = buildAad(uuid, ref)
    const encryptedValue = encryptValue(dek, value, aad)

    const entry: EncryptedSecretEntry = {
      uuid,
      ref,
      tags,
      encryptedValue,
      createdAt: now,
      updatedAt: now,
    }

    store.secrets.push(entry)
    this.save(store)
    return uuid
  }

  remove(uuid: string): boolean {
    const store = this.load()
    const idx = store.secrets.findIndex((s) => s.uuid === uuid)
    if (idx === -1) {
      throw new Error(`Secret with UUID ${uuid} not found`)
    }
    store.secrets.splice(idx, 1)
    this.save(store)
    return true
  }

  list(): SecretListItem[] {
    const store = this.load()
    return store.secrets.map((s) => ({ uuid: s.uuid, ref: s.ref, tags: s.tags }))
  }

  getMetadata(uuid: string): SecretMetadata {
    const store = this.load()
    const entry = store.secrets.find((s) => s.uuid === uuid)
    if (!entry) {
      throw new Error(`Secret with UUID ${uuid} not found`)
    }
    return { uuid: entry.uuid, ref: entry.ref, tags: entry.tags }
  }

  getValue(uuid: string): string {
    const dek = this.requireUnlocked()
    const store = this.load()
    const entry = store.secrets.find((s) => s.uuid === uuid)
    if (!entry) {
      throw new Error(`Secret with UUID ${uuid} not found`)
    }
    const aad = buildAad(entry.uuid, entry.ref)
    return decryptValue(
      dek,
      entry.encryptedValue.ciphertext,
      entry.encryptedValue.nonce,
      entry.encryptedValue.tag,
      aad,
    )
  }

  getByRef(ref: string): SecretMetadata {
    const store = this.load()
    const entry = store.secrets.find((s) => s.ref === ref)
    if (!entry) {
      throw new Error(`Secret with ref "${ref}" not found`)
    }
    return { uuid: entry.uuid, ref: entry.ref, tags: entry.tags }
  }

  getValueByRef(ref: string): string {
    const dek = this.requireUnlocked()
    const store = this.load()
    const entry = store.secrets.find((s) => s.ref === ref)
    if (!entry) {
      throw new Error(`Secret with ref "${ref}" not found`)
    }
    const aad = buildAad(entry.uuid, entry.ref)
    return decryptValue(
      dek,
      entry.encryptedValue.ciphertext,
      entry.encryptedValue.nonce,
      entry.encryptedValue.tag,
      aad,
    )
  }

  resolve(refOrUuid: string): SecretMetadata {
    if (UUID_PATTERN.test(refOrUuid)) {
      return this.getMetadata(refOrUuid)
    }
    return this.getByRef(refOrUuid)
  }

  resolveRef(refOrUuid: string): { uuid: string; value: string } {
    const dek = this.requireUnlocked()
    const store = this.load()
    let entry: EncryptedSecretEntry | undefined

    if (UUID_PATTERN.test(refOrUuid)) {
      entry = store.secrets.find((s) => s.uuid === refOrUuid)
    }
    if (!entry) {
      entry = store.secrets.find((s) => s.ref === refOrUuid)
    }
    if (!entry) {
      throw new Error(`Secret with ref "${refOrUuid}" not found`)
    }

    const aad = buildAad(entry.uuid, entry.ref)
    const value = decryptValue(
      dek,
      entry.encryptedValue.ciphertext,
      entry.encryptedValue.nonce,
      entry.encryptedValue.tag,
      aad,
    )
    return { uuid: entry.uuid, value }
  }
}
