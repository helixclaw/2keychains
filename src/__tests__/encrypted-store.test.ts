import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { EncryptedSecretStore } from '../core/encrypted-store.js'

// Low-cost scrypt params for fast tests
const TEST_PARAMS = { N: 1024, r: 8, p: 1 }
const PASSWORD = 'test-password-123'

describe('EncryptedSecretStore', () => {
  let dir: string
  let storePath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), '2kc-test-'))
    storePath = join(dir, 'secrets.enc.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  async function createStore(): Promise<EncryptedSecretStore> {
    const store = new EncryptedSecretStore(storePath)
    await store.initialize(PASSWORD, TEST_PARAMS)
    return store
  }

  describe('initialize', () => {
    it('creates a new store file and unlocks it', async () => {
      const store = await createStore()
      expect(store.isUnlocked).toBe(true)
      expect(store.list()).toEqual([])
    })

    it('throws if file already exists', async () => {
      await createStore()
      const store2 = new EncryptedSecretStore(storePath)
      await expect(store2.initialize(PASSWORD, TEST_PARAMS)).rejects.toThrow('already exists')
    })
  })

  describe('unlock / lock', () => {
    it('unlocks with correct password', async () => {
      const store = await createStore()
      store.lock()
      expect(store.isUnlocked).toBe(false)

      await store.unlock(PASSWORD)
      expect(store.isUnlocked).toBe(true)
    })

    it('rejects wrong password', async () => {
      const store = await createStore()
      store.lock()

      await expect(store.unlock('wrong-password')).rejects.toThrow('incorrect password')
    })
  })

  describe('add / getValue round-trip', () => {
    it('encrypts and decrypts a secret', async () => {
      const store = await createStore()
      const uuid = store.add('my-api-key', 'super-secret-value')

      expect(uuid).toMatch(/^[0-9a-f-]+$/)
      expect(store.getValue(uuid)).toBe('super-secret-value')
    })

    it('persists across unlock cycles', async () => {
      const store = await createStore()
      const uuid = store.add('persisted-key', 'persisted-value')

      store.lock()
      await store.unlock(PASSWORD)

      expect(store.getValue(uuid)).toBe('persisted-value')
    })

    it('works with unicode values', async () => {
      const store = await createStore()
      const uuid = store.add('unicode-key', '🔑 密码 пароль')
      expect(store.getValue(uuid)).toBe('🔑 密码 пароль')
    })

    it('rejects duplicate ref', async () => {
      const store = await createStore()
      store.add('dup-ref', 'value1')
      expect(() => store.add('dup-ref', 'value2')).toThrow('already exists')
    })
  })

  describe('locked-state rejection', () => {
    it('throws on getValue when locked', async () => {
      const store = await createStore()
      const uuid = store.add('locked-test', 'secret')
      store.lock()

      expect(() => store.getValue(uuid)).toThrow('Store is locked')
    })

    it('throws on add when locked', async () => {
      const store = await createStore()
      store.lock()

      expect(() => store.add('new-key', 'value')).toThrow('Store is locked')
    })

    it('throws on resolveRef when locked', async () => {
      const store = await createStore()
      store.add('resolve-test', 'secret')
      store.lock()

      expect(() => store.resolveRef('resolve-test')).toThrow('Store is locked')
    })
  })

  describe('metadata operations (work while locked)', () => {
    it('list works when locked', async () => {
      const store = await createStore()
      store.add('key-a', 'val-a', ['tag1'])
      store.add('key-b', 'val-b', ['tag2'])
      store.lock()

      const items = store.list()
      expect(items).toHaveLength(2)
      expect(items[0].ref).toBe('key-a')
      expect(items[1].ref).toBe('key-b')
    })

    it('getMetadata works when locked', async () => {
      const store = await createStore()
      const uuid = store.add('meta-test', 'val', ['prod'])
      store.lock()

      const meta = store.getMetadata(uuid)
      expect(meta.ref).toBe('meta-test')
      expect(meta.tags).toEqual(['prod'])
    })

    it('resolve works when locked', async () => {
      const store = await createStore()
      const uuid = store.add('resolve-meta', 'val')
      store.lock()

      expect(store.resolve('resolve-meta').uuid).toBe(uuid)
      expect(store.resolve(uuid).ref).toBe('resolve-meta')
    })
  })

  describe('remove', () => {
    it('removes a secret by uuid', async () => {
      const store = await createStore()
      const uuid = store.add('removable', 'val')
      expect(store.list()).toHaveLength(1)

      store.remove(uuid)
      expect(store.list()).toHaveLength(0)
    })

    it('throws for unknown uuid', async () => {
      const store = await createStore()
      expect(() => store.remove('00000000-0000-0000-0000-000000000000')).toThrow('not found')
    })
  })

  describe('getByRef / getValueByRef', () => {
    it('retrieves by ref', async () => {
      const store = await createStore()
      store.add('by-ref-test', 'ref-value')

      expect(store.getByRef('by-ref-test').ref).toBe('by-ref-test')
      expect(store.getValueByRef('by-ref-test')).toBe('ref-value')
    })

    it('getValueByRef throws for non-existent ref', async () => {
      const store = await createStore()
      store.add('existing-ref', 'val')

      expect(() => store.getValueByRef('no-such-ref')).toThrow(
        'Secret with ref "no-such-ref" not found',
      )
    })

    it('getByRef throws for non-existent ref', async () => {
      const store = await createStore()
      store.add('existing-ref', 'val')

      expect(() => store.getByRef('no-such-ref')).toThrow('Secret with ref "no-such-ref" not found')
    })
  })

  describe('getValue', () => {
    it('throws for non-existent UUID', async () => {
      const store = await createStore()
      store.add('some-ref', 'some-value')

      expect(() => store.getValue('00000000-0000-0000-0000-000000000000')).toThrow(
        'Secret with UUID 00000000-0000-0000-0000-000000000000 not found',
      )
    })
  })

  describe('resolveRef', () => {
    it('resolves by UUID and returns uuid + decrypted value', async () => {
      const store = await createStore()
      const uuid = store.add('resolve-ref-test', 'the-value')

      const result = store.resolveRef(uuid)
      expect(result.uuid).toBe(uuid)
      expect(result.value).toBe('the-value')
    })

    it('resolves by ref and returns uuid + decrypted value', async () => {
      const store = await createStore()
      const uuid = store.add('resolve-by-name', 'name-value')

      const result = store.resolveRef('resolve-by-name')
      expect(result.uuid).toBe(uuid)
      expect(result.value).toBe('name-value')
    })

    it('falls back to ref lookup when UUID is not found', async () => {
      const store = await createStore()
      const uuid = store.add('fallback-ref', 'fb-value')

      // Use a valid UUID format that does not exist in the store
      // It should fall through UUID lookup and find by ref
      const result = store.resolveRef('fallback-ref')
      expect(result.uuid).toBe(uuid)
      expect(result.value).toBe('fb-value')
    })

    it('throws when neither UUID nor ref matches', async () => {
      const store = await createStore()

      expect(() => store.resolveRef('nonexistent')).toThrow(
        'Secret with ref "nonexistent" not found',
      )
    })

    it('throws when locked', async () => {
      const store = await createStore()
      store.add('locked-resolve', 'val')
      store.lock()

      expect(() => store.resolveRef('locked-resolve')).toThrow('Store is locked')
    })
  })

  describe('file format', () => {
    it('stores metadata in plaintext but values encrypted', async () => {
      const store = await createStore()
      store.add('visible-ref', 'hidden-value', ['visible-tag'])

      // Read raw file
      const { readFileSync } = await import('node:fs')
      const raw = readFileSync(storePath, 'utf-8')
      const parsed = JSON.parse(raw)

      expect(parsed.version).toBe(1)
      expect(parsed.kdf.algorithm).toBe('scrypt')
      expect(parsed.secrets[0].ref).toBe('visible-ref')
      expect(parsed.secrets[0].tags).toEqual(['visible-tag'])
      expect(parsed.secrets[0].encryptedValue).toBeDefined()
      expect(parsed.secrets[0].encryptedValue.ciphertext).toBeDefined()
      // Value should NOT appear in plaintext
      expect(raw).not.toContain('hidden-value')
    })
  })
})
